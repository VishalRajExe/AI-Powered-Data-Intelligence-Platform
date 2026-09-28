import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
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

export function isNonPublicHost(host: string): boolean {
  if (!host) return true;
  const lower = host.toLowerCase().replace(/\.$/, "");

  // 1. IP address check
  const ipVer = isIP(lower);
  if (ipVer === 4) return isNonPublicIpv4(lower);
  if (ipVer === 6) return isNonPublicIpv6(lower);

  // 2. Reject single-label internal hosts (e.g. "localhost", "redis", "mysql", "metadata", "instance-data")
  // Public domains must contain at least one dot.
  if (!lower.includes(".")) return true;

  // 3. Prohibited domain names and internal TLD suffixes
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".corp") ||
    lower.endsWith(".lan") ||
    lower.endsWith(".home") ||
    lower.endsWith(".intranet") ||
    lower.endsWith(".localdomain") ||
    lower.endsWith(".docker.internal") ||
    lower.endsWith(".cluster.local")
  ) {
    return true;
  }

  // 4. Cloud metadata endpoints
  if (
    lower === "metadata.google.internal" ||
    lower === "metadata.google" ||
    lower === "metadata" ||
    lower === "instance-data"
  ) {
    return true;
  }

  return false;
}

export function isNonPublicIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;
  const [a = 0, b = 0, c = 0, d = 0] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;

  // 10.0.0.0/8 (Private - RFC 1918)
  if (a === 10) return true;

  // 100.64.0.0/10 (Shared Address Space / CGNAT - RFC 6598)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 127.0.0.0/8 (Loopback - RFC 1122)
  if (a === 127) return true;

  // 169.254.0.0/16 (Link-Local / Cloud Metadata - RFC 3927)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 (Private - RFC 1918)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments - RFC 6890)
  if (a === 192 && b === 0 && c === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1 - RFC 5737)
  if (a === 192 && b === 0 && c === 2) return true;

  // 192.88.99.0/24 (6to4 Relay Anycast - RFC 7526)
  if (a === 192 && b === 88 && c === 99) return true;

  // 192.168.0.0/16 (Private - RFC 1918)
  if (a === 192 && b === 168) return true;

  // 198.18.0.0/15 (Network Benchmark Testing - RFC 2544)
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2 - RFC 5737)
  if (a === 198 && b === 51 && c === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3 - RFC 5737)
  if (a === 203 && b === 0 && c === 113) return true;

  // 224.0.0.0/4 (Multicast - RFC 5771)
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4 (Reserved / Future Use - RFC 1112)
  if (a >= 240) return true;

  // 255.255.255.255 (Broadcast)
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;

  return false;
}

export function isNonPublicIpv6(ip: string): boolean {
  const value = ip.toLowerCase();

  // Unspecified (::) and Loopback (::1)
  if (value === "::" || value === "::1" || value === "0:0:0:0:0:0:0:0" || value === "0:0:0:0:0:0:0:1") return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x or ::ffff:0:x.x.x.x)
  const mappedMatch = value.match(/^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedMatch && mappedMatch[1]) {
    return isNonPublicIpv4(mappedMatch[1]);
  }

  // IPv4-compatible IPv6 (::x.x.x.x)
  const compatMatch = value.match(/^::(\d+\.\d+\.\d+\.\d+)$/i);
  if (compatMatch && compatMatch[1]) {
    return isNonPublicIpv4(compatMatch[1]);
  }

  // Unique Local Addresses (fc00::/7 - fc00 to fdff, covers AWS IPv6 metadata [fd00:ec2::254])
  if (value.startsWith("fc") || value.startsWith("fd")) return true;

  // Link-Local Unicast (fe80::/10 - fe80 to febf)
  if (value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true;

  // Site-Local Unicast (fec0::/10 deprecated)
  if (value.startsWith("fec") || value.startsWith("fed") || value.startsWith("fee") || value.startsWith("fef")) return true;

  // Multicast (ff00::/8)
  if (value.startsWith("ff")) return true;

  // Discard Prefix (100::/64)
  if (value.startsWith("100:")) return true;

  // Documentation Prefix (2001:db8::/32)
  if (value.startsWith("2001:db8:") || value.startsWith("2001:0db8:")) return true;

  // 6to4 (2002::/16)
  if (value.startsWith("2002:")) return true;

  return false;
}

export async function validateDnsResolution(hostname: string): Promise<{ safe: boolean; error?: string }> {
  // If host is already an IP, isNonPublicHost handles it directly
  if (isIP(hostname)) {
    if (isNonPublicHost(hostname)) {
      return { safe: false, error: `Direct IP ${hostname} is non-public or reserved` };
    }
    return { safe: true };
  }

  if (isNonPublicHost(hostname)) {
    return { safe: false, error: `Host ${hostname} is non-public or reserved` };
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses || addresses.length === 0) {
      return { safe: false, error: `DNS resolution failed for ${hostname}` };
    }
    for (const record of addresses) {
      if (record.family === 4 && isNonPublicIpv4(record.address)) {
        return { safe: false, error: `Host ${hostname} resolved to non-public IPv4: ${record.address}` };
      }
      if (record.family === 6 && isNonPublicIpv6(record.address)) {
        return { safe: false, error: `Host ${hostname} resolved to non-public IPv6: ${record.address}` };
      }
    }
    return { safe: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "DNS lookup failed";
    return { safe: false, error: `DNS resolution error for ${hostname}: ${message}` };
  }
}
