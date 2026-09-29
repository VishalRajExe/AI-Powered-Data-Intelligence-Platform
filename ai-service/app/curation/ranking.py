"""Ranking: order the candidates, collapse the duplicates, spread them over domains.

Upstream ranks by descending cosine and slices the top M (`get_relevant_urls.py:20-23`). That
is the right shape and the wrong detail: because the dedup keys on the raw URL, a search that
returns one page three ways fills three of M slots; and because there is no per-domain rule,
all M can land on a single site. Both waste the scrape budget of a run that has ~12 scrapes.

Ordering is `score desc, canonical url asc`, so two runs over the same results get the same
order. Ties on score are broken by the URL rather than by insertion order, which is what makes
the ranking reproducible in tests.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import urlsplit

from app.curation.canonical import canonical_key
from app.curation.relevance import RelevanceTarget, Score, score_hit
from app.firecrawl.client import SearchHit


@dataclass(slots=True)
class Candidate:
    url: str
    title: str
    snippet: str
    canonical: str
    score: Score

    @property
    def value(self) -> float:
        return self.score.value


@dataclass(slots=True)
class Dropped:
    url: str
    reason: str
    code: str
    score: float | None = None


@dataclass(slots=True)
class Ranking:
    candidates: list[Candidate] = field(default_factory=list)
    dropped: list[Dropped] = field(default_factory=list)

    def summary(self) -> str:
        if not self.dropped:
            return ""
        return "; ".join(f"{item.code}:{item.url}" for item in self.dropped[:6])


def root_domain(url: str) -> str:
    """The last two labels of the host.

    A heuristic, not a public-suffix list: it treats `example.co.uk` as `co.uk`, which means one
    such site is counted as one publisher when it may be several. Accepted because the only
    consumer is a per-domain diversity cap, where being slightly conservative about how many
    scrapes one publisher gets is the safer direction.
    """
    try:
        host = (urlsplit(url).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""
    labels = host.split(".")
    return ".".join(labels[-2:]) if len(labels) >= 2 else host


def rank_hits(
    hits: list[SearchHit],
    target: RelevanceTarget,
    *,
    already_observed: set[str] | None = None,
    min_score: float = 0.0,
    top_n: int = 8,
    max_per_domain: int = 0,
) -> Ranking:
    """Score every hit, then drop duplicates, sub-floor results, and over-cap domains.

    `max_per_domain=0` means no diversity rule is applied. `min_score=0.0` means relevance never
    drops a candidate — ranking still decides the order, and the scrape budget decides how many
    are read. Both exist so an operator can tighten either without changing code.
    """
    observed = already_observed or set()
    ranking = Ranking()
    seen_canonical: set[str] = set()
    per_domain: dict[str, int] = {}

    scored: list[Candidate] = []
    for hit in hits:
        canonical = canonical_key(hit.url)
        if not canonical:
            ranking.dropped.append(Dropped(url=hit.url, reason="url has no host to compare against",
                                           code="unviable-url"))
            continue
        if canonical in observed:
            ranking.dropped.append(Dropped(url=hit.url, reason=f"already retrieved this run as {hit.url}",
                                           code="already-observed"))
            continue
        if canonical in seen_canonical:
            ranking.dropped.append(Dropped(url=hit.url, reason=f"same page as an earlier result: {canonical}",
                                           code="duplicate-url"))
            continue
        seen_canonical.add(canonical)
        scored.append(Candidate(url=hit.url, title=hit.title, snippet=hit.snippet,
                                canonical=canonical, score=score_hit(hit.url, hit.title, hit.snippet, target)))

    scored.sort(key=lambda item: (-item.score.value, item.canonical))

    for candidate in scored:
        if min_score > 0 and candidate.score.value < min_score:
            ranking.dropped.append(Dropped(
                url=candidate.url,
                reason=f"relevance {candidate.score.value:.2f} below the floor of {min_score:.2f} "
                       f"({'; '.join(candidate.score.reasons)})",
                code="low-relevance", score=candidate.score.value))
            continue

        if max_per_domain > 0:
            domain = root_domain(candidate.url)
            if per_domain.get(domain, 0) >= max_per_domain:
                ranking.dropped.append(Dropped(
                    url=candidate.url,
                    reason=f"{domain} already has {max_per_domain} candidates in this batch",
                    code="domain-cap", score=candidate.score.value))
                continue
            per_domain[domain] = per_domain.get(domain, 0) + 1

        if len(ranking.candidates) >= top_n:
            ranking.dropped.append(Dropped(url=candidate.url,
                                           reason=f"beyond the top {top_n} candidates",
                                           code="over-candidate-limit", score=candidate.score.value))
            continue

        ranking.candidates.append(candidate)

    return ranking
