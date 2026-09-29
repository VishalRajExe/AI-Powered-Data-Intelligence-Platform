"""URL identity: when do two URLs mean the same page?

`web-research-agent-master` deduplicates on the exact string it was given
(`get_relevant_urls.py:16-19`), so `https://x.com/a` and `https://x.com/a/?utm_source=gl` are
two sources, and a search that returns both spends two scrapes on one page. This module
supplies the identity key; the original URL is always kept for fetching, because normalising
what we *send* would change which page we get.
"""
from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Campaign and click identifiers only ever say how the visitor arrived. Two URLs that differ
# solely by these are the same page, so keeping them separate wastes collection budget.
# Deliberately excluded: `ref` (often meaningful), `id`/`q`/`page`/`lang` (they change content).
_TRACKING_PARAM_PREFIXES = (
    "utm_", "hsa_", "gclid", "dclid", "fbclid", "msclkid", "gcl", "_ga", "_gl", "mc_",
    "igshid", "s_kwcid", "yclid", "_branch", "pk_", "piwik_", "matomo_",
)
_TRACKING_PARAMS = frozenset({
    "ref_src", "src", "sourceid", "share", "sharing", "si", "feature", "app", "action",
})


def _is_tracking(param: str) -> bool:
    lowered = param.lower()
    return (lowered.startswith(_TRACKING_PARAM_PREFIXES)
            or lowered in _TRACKING_PARAMS
            or lowered.startswith("spm"))


def canonical_key(url: str) -> str:
    """A stable identity for the page `url` points at.

    Lowercases scheme and host, drops the default port, `www.`, the fragment, campaign
    parameters and an insignificant trailing slash, and sorts what remains so parameter order
    does not create a second source.
    """
    candidate = (url or "").strip()
    if not candidate:
        return ""
    try:
        parts = urlsplit(candidate if "//" in candidate else f"//{candidate}")
    except ValueError:
        return candidate.lower()

    scheme = (parts.scheme or "https").lower()
    host = (parts.hostname or "").lower()
    if not host:
        return candidate.lower()
    host = host.removeprefix("www.")

    port = ""
    if parts.port and not ((scheme == "http" and parts.port == 80)
                           or (scheme == "https" and parts.port == 443)):
        port = f":{parts.port}"

    path = parts.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/") or "/"

    kept = sorted(
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not _is_tracking(key)
    )

    return urlunsplit((scheme, f"{host}{port}", path, urlencode(kept), ""))


def same_page(first: str, second: str) -> bool:
    return canonical_key(first) == canonical_key(second) and bool(canonical_key(first))
