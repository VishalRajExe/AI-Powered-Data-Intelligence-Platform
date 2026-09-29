"""Lexical relevance: how much of what we asked for does this result actually mention?

`web-research-agent-master` answers this by cosine-similating the query against each snippet's
embedding (`get_relevant_urls.py:7-12`) and sorting. Two things follow from that code that this
module deliberately does not reproduce:

* **It has no threshold.** `get_relevant_urls.py:20-23` sorts and slices the top M, so the
  weakest result is scraped anyway when fewer than M candidates exist — the score is computed
  and then never consulted as a decision.
* **Snippet is the only text it looks at.** Title, URL path and the site's own domain contribute
  nothing, and a snippet that is empty scores as a zero vector.

So this is a different mechanism, and a weaker one in kind: it counts vocabulary, not meaning.
It will rank a page about "10 best VR games" above a page about "VR headset developer
documentation" for a query whose terms include *developer*, because both contain the word. What
it buys is determinism, zero provider calls, and a reason string a reviewer can read — which is
what the ranking step of a bounded research loop actually needs. If semantic ranking turns out
to matter, the honest way to add it is a Gemini call over the ranked candidate list, not a
second embedding provider.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

# Kept short on purpose: this list only decides which words are *worth matching*, so an
# over-broad stop list would silently discard real terms like "founded" or "remote".
_STOPWORDS = frozenset({
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "get", "has",
    "have", "in", "into", "is", "it", "its", "of", "on", "or", "that", "the", "their",
    "them", "then", "there", "these", "this", "to", "was", "were", "with", "you", "your",
    "find", "list", "please", "need", "want", "data", "information", "about", "which",
    "who", "what", "when", "where", "how", "all", "any", "some", "most", "more",
})

_WORD = re.compile(r"[a-z0-9]+")
# Path segments arrive like `remote-react-developer-2024`; splitting on both separators keeps
# the meaningful parts.
_PATH_SPLIT = re.compile(r"[/\-_]+")

_WEIGHTS = {"title": 3, "snippet": 2, "path": 2, "phrase": 4, "preferred_domain": 5,
            "not_preferred": -3}
_PER_TERM_MAX = _WEIGHTS["title"] + _WEIGHTS["snippet"] + _WEIGHTS["path"] + _WEIGHTS["phrase"]

# A result is scored against a fixed saturation point, not against the whole target vocabulary.
# Dividing by `len(terms)` asks a single page to mention every field the contract wants, which
# no real page does: a job listing that names the role, the location and the salary would score
# 0.2 because it does not also say "company", "records" and "website". Four saturated terms is
# the point where a page has clearly demonstrated it is about what was asked, so the score
# means: "a page carrying four of the requested terms in its title, snippet or URL path scores
# 1.0". It is a ranking signal with a stated reference point, not a coverage percentage.
_SATURATING_TERMS = 4
_REFERENCE = _PER_TERM_MAX * _SATURATING_TERMS


def tokens(text: str) -> list[str]:
    return [word for word in _WORD.findall((text or "").lower()) if word not in _STOPWORDS and len(word) > 1]


def _host(url: str) -> str:
    try:
        return (urlsplit(url).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def _path_tokens(url: str) -> list[str]:
    try:
        path = urlsplit(url).path or ""
    except ValueError:
        return []
    return [part for chunk in _PATH_SPLIT.split(path.lower()) for part in tokens(chunk)]


def _matches_any(needles: list[str], haystack: str) -> list[str]:
    """Whole-word matching, so `ai` does not match inside `maintenance`."""
    found = []
    lowered = haystack.lower()
    for needle in needles:
        if re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", lowered):
            found.append(needle)
    return found


@dataclass(slots=True)
class RelevanceTarget:
    context_terms: list[str] = field(default_factory=list)
    entity_terms: list[str] = field(default_factory=list)
    field_terms: list[str] = field(default_factory=list)
    preferred_domains: list[str] = field(default_factory=list)
    blocked_domains: list[str] = field(default_factory=list)

    @property
    def all_terms(self) -> list[str]:
        return list(dict.fromkeys([*self.entity_terms, *self.context_terms, *self.field_terms]))

    @property
    def is_empty(self) -> bool:
        return not self.all_terms

    def phrases(self) -> list[str]:
        """Multi-word entity terms, matched as phrases: `youtube channel` means more than
        `youtube` plus `channel`."""
        return [term for term in self.entity_terms if " " in term]


def target_from(*, topic: str = "", entity_type: str | None = None,
               extraction_schema: dict | None = None,
               preferred_domains: list[str] | None = None,
               blocked_domains: list[str] | None = None) -> RelevanceTarget:
    """Build the matching target from what the run was asked for.

    Every term comes from the request: the objective text, the entity type, and the extraction
    schema's own property names and descriptions. Nothing here hardcodes a domain, an entity or
    a field list — change the requirement and this target changes with it.
    """
    schema_terms: list[str] = []
    for name, definition in ((extraction_schema or {}).get("properties") or {}).items():
        schema_terms.extend([name.replace("_", " "), name])
        if isinstance(definition, dict) and definition.get("description"):
            schema_terms.append(str(definition["description"]))
        items = definition.get("items") if isinstance(definition, dict) else None
        if isinstance(items, dict):
            for key, sub in (items.get("properties") or {}).items():
                schema_terms.append(str(key).replace("_", " "))
                if isinstance(sub, dict) and sub.get("description"):
                    schema_terms.append(str(sub["description"]))

    entity = (entity_type or "").strip().lower().replace("_", " ")
    return RelevanceTarget(
        context_terms=tokens(topic),
        entity_terms=([entity] if entity else []) + tokens(entity),
        field_terms=[part for chunk in schema_terms for part in tokens(chunk)],
        preferred_domains=[d.lower() for d in (preferred_domains or []) if d],
        blocked_domains=[d.lower() for d in (blocked_domains or []) if d],
    )


@dataclass(slots=True)
class Score:
    value: float
    matched: list[str]
    missed: list[str]
    reasons: list[str]

    def as_dict(self) -> dict[str, object]:
        return {"score": round(self.value, 4), "matched": list(self.matched),
                "missed": list(self.missed), "reasons": list(self.reasons)}


def score_hit(url: str, title: str, snippet: str, target: RelevanceTarget) -> Score:
    """0.0 – 1.0. How strongly the requested vocabulary appears in this result.

    Saturation, not coverage: four terms in title, snippet or path reach 1.0 (see
    `_SATURATING_TERMS`). A result matching nothing scores 0.0. An empty target scores 0.5 for
    everything: with no terms to compare there is genuinely no basis to rank one result over
    another, and inventing a preference would be worse than saying "unordered".
    """
    terms = target.all_terms
    if not terms:
        return Score(value=0.5, matched=[], missed=[], reasons=["no target vocabulary to match"])

    host = _host(url)
    title_text, snippet_text, path_text = title or "", snippet or "", " ".join(_path_tokens(url))

    raw = 0.0
    matched: list[str] = []
    for term in terms:
        term_hits = _matches_any([term], title_text)
        contribution = _WEIGHTS["title"] if term_hits else 0
        if _matches_any([term], snippet_text):
            contribution += _WEIGHTS["snippet"]
        if _matches_any([term], path_text):
            contribution += _WEIGHTS["path"]
        if term_hits:
            matched.append(term)
        raw += contribution

    phrase_matched = [phrase for phrase in target.phrases() if _matches_any([phrase], f"{title_text} {snippet_text}")]
    raw += _WEIGHTS["phrase"] * len(phrase_matched)

    reasons = [f"{len(matched)}/{len(terms)} target terms present",
               f"matched: {', '.join(matched[:6]) or 'none'}"]
    if phrase_matched:
        reasons.append(f"entity phrase in title or snippet: {', '.join(phrase_matched)}")

    value = max(0.0, min(1.0, raw / _REFERENCE))

    if target.preferred_domains and host:
        preferred = any(host == d or host.endswith("." + d) for d in target.preferred_domains)
        if preferred:
            value = min(1.0, value + _WEIGHTS["preferred_domain"] / 10)
            reasons.append(f"host {host} is preferred by the request")
        else:
            value = max(0.0, value + _WEIGHTS["not_preferred"] / 10)
            reasons.append(f"host {host} is not among the request's preferred sources")

    return Score(value=value, matched=matched,
                 missed=[term for term in terms if term not in matched], reasons=reasons)
