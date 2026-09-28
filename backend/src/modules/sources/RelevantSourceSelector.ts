import type { WorkflowPlan } from "../planner/workflow-plan.schema.js";

export interface RankedSourceCandidate {
  url: string;
  title: string;
  snippet: string;
  score: number;
  originalIndex: number;
}

const STOP_WORDS = new Set(["a", "an", "and", "are", "for", "from", "in", "of", "on", "or", "the", "to", "with", "find", "list", "data", "information"]);
const TRACKING_PARAMETERS = /^(utm_.+|gclid|fbclid|mc_cid|mc_eid)$/iu;

/** TypeScript adaptation of Web Research Agent's query/snippet relevance ranking. */
export class RelevantSourceSelector {
  rank<T>(candidates: T[], plan: WorkflowPlan, limit = plan.searchStrategy.maximumSourceCount): T[] {
    if (candidates.length === 0 || limit <= 0) return [];
    const queryTerms = unique(plan.searchStrategy.queries.flatMap(({ query }) => tokens(query)));
    if (queryTerms.length === 0) return candidates.slice(0, limit);
    const preferredDomains = plan.sourcePolicy.preferredDomains.map(normalizeDomain).filter(Boolean);
    const ranked = candidates.map((item, originalIndex) => {
      const candidate = toCandidate(item);
      const titleTerms = tokens(candidate.title);
      const snippetTerms = tokens(candidate.snippet);
      const urlTerms = tokens(candidate.url);
      const titleCoverage = coverage(queryTerms, titleTerms);
      const snippetCoverage = coverage(queryTerms, snippetTerms);
      const urlCoverage = coverage(queryTerms, urlTerms);
      const phraseBoost = queryTerms.length > 1 && normalizeText(candidate.title).includes(queryTerms.join(" ")) ? 0.25 : 0;
      const domain = host(candidate.url);
      const preferredBoost = preferredDomains.some((entry) => domain === entry || domain.endsWith("." + entry)) ? 0.15 : 0;
      const score = queryTerms.length === 0 ? 0 : Math.min(1, 0.55 * titleCoverage + 0.3 * snippetCoverage + 0.15 * urlCoverage + phraseBoost + preferredBoost);
      return { item, originalIndex, domain, score, canonicalUrl: canonicalize(candidate.url) };
    }).filter(({ canonicalUrl, score }) => canonicalUrl && score >= 0.12);

    const bestByUrl = new Map<string, typeof ranked[number]>();
    for (const candidate of ranked) {
      const previous = bestByUrl.get(candidate.canonicalUrl);
      if (!previous || candidate.score > previous.score) bestByUrl.set(candidate.canonicalUrl, candidate);
    }
    const remaining = [...bestByUrl.values()].sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex);
    const selected: typeof ranked = [];
    const domainCounts = new Map<string, number>();
    while (remaining.length && selected.length < limit) {
      let bestPosition = 0;
      let bestAdjusted = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index]!;
        const repeatPenalty = (domainCounts.get(candidate.domain) ?? 0) * 0.08;
        const adjusted = candidate.score - repeatPenalty;
        if (adjusted > bestAdjusted) { bestAdjusted = adjusted; bestPosition = index; }
      }
      const [candidate] = remaining.splice(bestPosition, 1);
      if (!candidate) break;
      selected.push(candidate);
      domainCounts.set(candidate.domain, (domainCounts.get(candidate.domain) ?? 0) + 1);
    }
    return selected.sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex).map(({ item }) => item);
  }
}

export function sourceCandidate(value: unknown): { url: string; title: string; snippet: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const url = typeof item.url === "string" ? item.url : typeof item.link === "string" ? item.link : undefined;
  if (!url || !canonicalize(url)) return undefined;
  return {
    url,
    title: typeof item.title === "string" ? item.title : "",
    snippet: typeof item.description === "string" ? item.description : typeof item.snippet === "string" ? item.snippet : "",
  };
}

function toCandidate(value: unknown) { return sourceCandidate(value) ?? { url: "", title: "", snippet: "" }; }
function tokens(value: string): string[] { return normalizeText(value).split(" ").filter((token) => token.length > 1 && !STOP_WORDS.has(token)); }
function normalizeText(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " "); }
function coverage(query: string[], target: string[]): number {
  if (!query.length) return 0;
  const targetSet = new Set(target);
  return query.reduce((sum, token) => sum + (targetSet.has(token) ? 1 : 0), 0) / query.length;
}
function unique(values: string[]): string[] { return [...new Set(values)]; }
function host(value: string): string { try { return new URL(value).hostname.toLocaleLowerCase().replace(/^www\./u, ""); } catch { return ""; } }
function normalizeDomain(value: string): string { return value.toLocaleLowerCase().replace(/^\*\./u, "").replace(/^www\./u, ""); }
function canonicalize(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:" || url.username || url.password) return "";
    url.hash = "";
    url.hostname = url.hostname.toLocaleLowerCase().replace(/^www\./u, "");
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMETERS.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString();
  } catch { return ""; }
}
