import { isIP } from "node:net";
import { createHash } from "node:crypto";
import type { SourceDecision, SourceRuleSet } from "./source-governance.types.js";

export class SourceValidator {
  normalize(value: string): { canonicalUrl: string; domain: string; hash: string } | { error: string; code: string } {
    let url: URL;
    try { url = new URL(value); }
    catch { return { code: "INVALID_URL", error: "Source URL is not a valid absolute URL." }; }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { code: "UNSUPPORTED_SCHEME", error: "Only public HTTP and HTTPS source URLs are permitted." };
    }
    if (url.username || url.password) return { code: "URL_CREDENTIALS_BLOCKED", error: "URLs containing credentials are not permitted." };

    const domain = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!domain || isNonPublicHost(domain)) return { code: "NON_PUBLIC_HOST_BLOCKED", error: "Local, private, and reserved network hosts are not permitted." };

    url.hostname = domain;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|gclid|fbclid|mc_cid|mc_eid|token|access_token|api_key|apikey|key|session|sessionid|auth)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    const canonicalUrl = url.toString();
    return { canonicalUrl, domain, hash: createHash("sha256").update(canonicalUrl).digest("hex") };
  }

  validate(value: string, rules: SourceRuleSet): SourceDecision {
    const normalized = this.normalize(value);
    if ("error" in normalized) {
      return {
        allowed: false, status: "BLOCKED", code: normalized.code, reason: normalized.error,
        canonicalUrl: this.safeUrl(value), domain: safeDomain(value),
      };
    }

    const denied = rules.blockedDomains.find((rule) => matchesDomain(normalized.domain, rule));
    if (denied) return {
      ...normalized, allowed: false, status: "BLOCKED", code: "DOMAIN_DENYLISTED",
      reason: `Domain ${normalized.domain} matches the blocked domain rule ${denied}.`,
    };

    if (rules.allowedDomains.length && !rules.allowedDomains.some((rule) => matchesDomain(normalized.domain, rule))) {
      return {
        ...normalized, allowed: false, status: "BLOCKED", code: "DOMAIN_NOT_ALLOWLISTED",
        reason: `Domain ${normalized.domain} does not match the configured source allowlist.`,
      };
    }

    return { ...normalized, allowed: true, status: "ALLOWED", reason: "Source URL and domain satisfy source policy." };
  }

  safeUrl(value: string): string {
    try {
      const url = new URL(value);
      url.username = "";
      url.password = "";
      url.hash = "";
      for (const key of [...url.searchParams.keys()]) {
        if (/^(token|access_token|api_key|apikey|key|session|sessionid|auth)$/i.test(key)) url.searchParams.delete(key);
      }
      return url.toString().slice(0, 2_000);
    } catch { return "[invalid-source-url]"; }
  }
}

export function matchesDomain(domain: string, rule: string): boolean {
  const normalizedRule = rule.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/:?#]/, 1)[0]!.replace(/\.$/, "");
  if (normalizedRule.startsWith("*.")) {
    const base = normalizedRule.slice(2);
    return domain === base || domain.endsWith(`.${base}`);
  }
  return domain === normalizedRule || domain.endsWith(`.${normalizedRule}`);
}

function safeDomain(value: string): string {
  try { return new URL(value).hostname.toLowerCase().slice(0, 255); }
  catch { return ""; }
}

function isNonPublicHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test")) return true;
  const version = isIP(host);
  if (version === 4) {
    const [a = 0, b = 0] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 203 && b === 0);
  }
  if (version === 6) {
    const value = host.toLowerCase();
    return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
      value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("::ffff:127.");
  }
  return false;
}
