import type { RobotsDecision } from "./source-governance.types.js";

export interface RobotsFetchResponse {
  status: number;
  text(): Promise<string>;
}

export type RobotsFetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string>; redirect: "manual" }) => Promise<RobotsFetchResponse>;

interface CachedPolicy { expiresAt: number; groups: RobotsGroup[]; result?: RobotsDecision; }
export interface RobotsGroup { agents: string[]; rules: Array<{ allow: boolean; path: string }>; crawlDelayMs?: number; }

export interface RobotsPolicyServiceOptions {
  userAgent?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetcher?: RobotsFetch;
  now?: () => Date;
}

export class RobotsPolicyService {
  private readonly cache = new Map<string, CachedPolicy>();
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly fetcher: RobotsFetch;
  private readonly now: () => Date;

  constructor(options: RobotsPolicyServiceOptions = {}) {
    this.userAgent = options.userAgent ?? "ScoutlyBot";
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.cacheTtlMs = options.cacheTtlMs ?? 15 * 60_000;
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.now = options.now ?? (() => new Date());
  }

  async check(urlValue: string): Promise<RobotsDecision> {
    const url = new URL(urlValue);
    const origin = url.origin;
    let cached = this.cache.get(origin);
    if (cached && cached.expiresAt <= this.now().getTime()) {
      this.cache.delete(origin);
      cached = undefined;
    }
    if (!cached) {
      cached = await this.load(origin);
      this.cache.set(origin, cached);
    }
    if (cached.result) return { ...cached.result, checkedAt: this.now() };

    const group = chooseGroup(cached.groups, this.userAgent);
    if (!group) return { allowed: true, status: "ALLOWED", reason: "robots.txt has no matching directives.", checkedAt: this.now() };
    const target = `${url.pathname}${url.search}` || "/";
    const matchingRules = group.rules
      .filter(({ path }) => matchesRobotsPath(target, path))
      .sort((left, right) => right.path.replace(/[*$]/g, "").length - left.path.replace(/[*$]/g, "").length || Number(right.allow) - Number(left.allow));
    const strongest = matchingRules[0];
    if (strongest && !strongest.allow) {
      return {
        allowed: false, status: "DISALLOWED", reason: "robots.txt disallows the requested path.",
        checkedAt: this.now(), ...(group.crawlDelayMs === undefined ? {} : { crawlDelayMs: group.crawlDelayMs }),
      };
    }
    return {
      allowed: true, status: "ALLOWED", reason: "robots.txt permits the requested path.", checkedAt: this.now(),
      ...(group.crawlDelayMs === undefined ? {} : { crawlDelayMs: group.crawlDelayMs }),
    };
  }

  clearCache(): void { this.cache.clear(); }

  private async load(origin: string): Promise<CachedPolicy> {
    const checkedAt = this.now();
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const response = await this.fetcher(robotsUrl, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { "user-agent": this.userAgent, accept: "text/plain,*/*;q=0.1" },
        redirect: "manual",
      });
      if (response.status === 404 || response.status === 410) {
        return {
          expiresAt: checkedAt.getTime() + this.cacheTtlMs, groups: [],
          result: { allowed: true, status: "NOT_FOUND", reason: "robots.txt does not exist; no robots restriction was found.", checkedAt },
        };
      }
      if (response.status < 200 || response.status >= 300) {
        return {
          expiresAt: checkedAt.getTime() + Math.min(this.cacheTtlMs, 30_000), groups: [],
          result: { allowed: false, status: "UNAVAILABLE", reason: `robots.txt returned HTTP ${response.status}; source access fails closed.`, checkedAt },
        };
      }
      return { expiresAt: checkedAt.getTime() + this.cacheTtlMs, groups: parseRobots(await response.text()) };
    } catch (error) {
      const message = error instanceof Error && error.name === "TimeoutError" ? "robots.txt request timed out" : "robots.txt could not be fetched";
      return {
        expiresAt: checkedAt.getTime() + Math.min(this.cacheTtlMs, 30_000), groups: [],
        result: { allowed: false, status: "UNAVAILABLE", reason: `${message}; source access fails closed.`, checkedAt },
      };
    }
  }
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | undefined;
  let hasDirective = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const separator = line.indexOf(":");
    if (!line || separator < 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === "user-agent") {
      if (!current || hasDirective) {
        current = { agents: [], rules: [] };
        groups.push(current);
        hasDirective = false;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    hasDirective = true;
    if ((name === "allow" || name === "disallow") && value) current.rules.push({ allow: name === "allow", path: value });
    if (name === "crawl-delay" && /^\d+(?:\.\d+)?$/.test(value)) current.crawlDelayMs = Math.min(60_000, Number(value) * 1_000);
  }
  return groups;
}

function chooseGroup(groups: RobotsGroup[], userAgent: string): RobotsGroup | undefined {
  const agent = userAgent.toLowerCase().split(/[\s/]/)[0] ?? "*";
  const specific = groups.filter((group) => group.agents.some((token) => token !== "*" && agent.includes(token)));
  const matches = specific.length ? specific : groups.filter((group) => group.agents.includes("*"));
  if (!matches.length) return undefined;
  return {
    agents: matches.flatMap(({ agents }) => agents),
    rules: matches.flatMap(({ rules }) => rules),
    ...(matches.some(({ crawlDelayMs }) => crawlDelayMs !== undefined)
      ? { crawlDelayMs: Math.max(...matches.map(({ crawlDelayMs }) => crawlDelayMs ?? 0)) }
      : {}),
  };
}

function matchesRobotsPath(target: string, pattern: string): boolean {
  const anchoredEnd = pattern.endsWith("$");
  const body = anchoredEnd ? pattern.slice(0, -1) : pattern;
  const escaped = body.split("*").map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")).join(".*");
  try { return new RegExp(`^${escaped}${anchoredEnd ? "$" : ""}`).test(target); }
  catch { return target.startsWith(body); }
}

const defaultFetcher: RobotsFetch = (url, init) => fetch(url, init);
