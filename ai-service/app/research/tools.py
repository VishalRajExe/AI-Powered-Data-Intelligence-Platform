"""Tool execution for the research graph.

Port of `data-enrichment-js/src/enrichment_agent/tools.ts`, with its two web paths
replaced by Firecrawl and four of its defects closed:

* Search was Tavily (`tools.ts:39-42`) and scraping was a bare `await fetch(url)`
  (`tools.ts:44-70`); both are gone — one web engine, per the integration analysis.
* Their scraper never checked `response.ok`, so a 404 or a bot-block page was handed to
  the model as content and later cited as evidence. A non-2xx status or an empty body is
  now an error outcome.
* They deduplicated nothing, so the same URL could be re-scraped until the budget ran
  out. Repeat URLs are refused here — by page identity, not by string equality
  (`app/curation/canonical.py`), so a `?utm_source=` variant is recognised as the same page.
* They injected `__state` into every tool's arguments (`tools.ts:108-114`) while their
  own tool schema declared `additionalProperties: false`, and nothing read it. Not
  reproduced.

Per-call error isolation and concurrent execution from their `toolNode` are kept: one bad
URL must not abort a run.

Phase 5 added the curation stage between "the tool returned results" and "the model is told
about them": domain policy, robots policy, relevance ranking, per-domain diversity and
duplicate collapse. Every drop is recorded on the state, because
`web-research-agent-master`'s scraper logs and skips (`web_scraper_tool.py:10,22`) and leaves
the caller unable to distinguish "the site said no" from "we never asked".
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from app.curation.canonical import canonical_key
from app.curation.policy import SourcePolicy
from app.curation.ranking import rank_hits
from app.curation.relevance import RelevanceTarget
from app.firecrawl.client import (
    Interaction,
    Page,
    SearchHit,
    WebError,
    WebTool,
    supports_interact,
    validated_http_url,
)
from app.research.state import InteractionRecord, ResearchState


@dataclass(slots=True)
class ToolOutcome:
    name: str
    ok: bool
    content: str
    observed_urls: list[str] = field(default_factory=list)
    error: str | None = None


def _format_candidates(candidates, dropped) -> str:
    """Ranked search results, with what was excluded and why shown alongside them.

    The order is the point — a model handed ten undifferentiated URLs scrapes whichever it
    reads first. The exclusions are the other point: telling it "three results were the same
    page, one was below the relevance floor" stops it re-requesting them.
    """
    entries: list[str] = []
    for index, candidate in enumerate(candidates, start=1):
        entry = f"{index}. {candidate.url}"
        if candidate.title:
            entry += f"\n   title: {candidate.title}"
        if candidate.snippet:
            entry += f"\n   snippet: {candidate.snippet[:300]}"
        entry += f"\n   relevance: {candidate.score.value:.2f} ({'; '.join(candidate.score.reasons[:2])})"
        entries.append(entry)

    if dropped:
        summary = "\n".join(f"- {item.code}: {item.url} — {item.reason}" for item in dropped[:8])
        entries.append(
            "Excluded from this search (do not treat these as available sources):\n" + summary
        )
    return "\n\n".join(entries)


def _format_page(page: Page) -> str:
    header = f"URL: {page.url}\nTitle: {page.title}\nHTTP status: {page.status_code}"
    return f"{header}\n\n{page.markdown}".strip()


def _format_interaction(result: Interaction) -> str:
    header = (
        f"Browser session result for {result.url}\n"
        f"Prompt: {result.prompt}\n"
        f"Session: {result.session_id or 'unknown'}"
    )
    flags = []
    if result.truncated:
        flags.append("output was truncated by the collection layer")
    if result.killed:
        flags.append("the session was killed before finishing")
    return f"{header}\n\n{result.output}".strip() + ("\n\n[" + "; ".join(flags) + "]" if flags else "")


async def run_search(
    state: ResearchState,
    web: WebTool,
    query: str,
    *,
    policy: SourcePolicy,
    target: RelevanceTarget,
) -> ToolOutcome:
    """Search, then curate: domain policy first, then dedupe, rank and cap.

    The curated list is what the model sees, and only those URLs are recorded as observed.
    Everything excluded is stated in the tool output with its reason, so the model cannot be
    told "here are 8 results" about a search that returned 12 without learning that four were
    the same page three times.
    """
    if not query.strip():
        return ToolOutcome(name="search", ok=False, content="", error="search requires a query")
    if not state.budget.search_allowed():
        return ToolOutcome(
            name="search",
            ok=False,
            content="",
            error=f"search budget exhausted ({state.budget.max_searches})",
        )

    try:
        hits = await web.search(query, limit=state.limits.max_search_results)
    except WebError as exc:
        return ToolOutcome(name="search", ok=False, content="", error=str(exc))

    state.budget.note_search()
    if not hits:
        return ToolOutcome(name="search", ok=False, content="",
                           error=f"search for {query!r} returned no results")

    permitted: list[SearchHit] = []
    for hit in hits:
        decision = policy.check_domain(hit.url)
        if decision.allowed:
            permitted.append(hit)
        else:
            state.refuse(hit.url, decision.code, decision.reason)

    ranking = rank_hits(
        permitted,
        target,
        already_observed=state.observed_canonicals(),
        min_score=state.limits.min_relevance_score,
        top_n=state.limits.max_candidates_per_search,
        max_per_domain=state.limits.max_sources_per_domain,
    )

    for dropped in ranking.dropped:
        state.note_dropped(dropped.url, dropped.code, dropped.reason, dropped.score)
        if dropped.code in ("duplicate-url", "already-observed"):
            state.duplicates_collapsed += 1

    if not ranking.candidates:
        return ToolOutcome(
            name="search",
            ok=False,
            content="",
            error=f"no usable results for {query!r}: {len(ranking.dropped)} candidate(s) dropped"
                  f" ({ranking.summary() or 'see dropped list'})",
        )

    for candidate in ranking.candidates:
        state.observe(candidate.url, title=candidate.title, snippet=candidate.snippet,
                      source_type="search")

    return ToolOutcome(
        name="search",
        ok=True,
        content=(f"Search results for {query!r}, ranked against this contract:\n\n"
                 + _format_candidates(ranking.candidates, ranking.dropped)),
        observed_urls=[candidate.url for candidate in ranking.candidates],
    )


async def run_scrape(state: ResearchState, web: WebTool, url: str, *, policy: SourcePolicy) -> ToolOutcome:
    try:
        target = validated_http_url(url)
    except WebError as exc:
        return ToolOutcome(name="scrape", ok=False, content="", error=str(exc))

    if not state.budget.scrape_allowed():
        return ToolOutcome(
            name="scrape",
            ok=False,
            content="",
            error=f"scrape budget exhausted ({state.budget.max_scrapes})",
        )

    page_id = canonical_key(target)
    if page_id in state.scraped_pages:
        return ToolOutcome(name="scrape", ok=False, content="", error=f"already retrieved: {target}")

    decision = await policy.check_fetch(target)
    if not decision.allowed:
        state.refuse(target, decision.code, decision.reason)
        return ToolOutcome(name="scrape", ok=False, content="",
                           error=f"refused before fetching: {decision.reason or decision.code}")

    try:
        page = await web.scrape(target)
    except WebError as exc:
        return ToolOutcome(name="scrape", ok=False, content="", error=str(exc))

    state.budget.note_scrape()

    if page.status_code is not None and not 200 <= page.status_code < 300:
        return ToolOutcome(
            name="scrape",
            ok=False,
            content="",
            error=f"server returned HTTP {page.status_code} for {target}; its body is not evidence",
        )
    if not page.markdown.strip():
        return ToolOutcome(name="scrape", ok=False, content="", error=f"no readable content at {target}")

    state.scraped_pages.add(page_id)
    state.observe(target, title=page.title, source_type="scrape")
    # Held so a later browser session on this page can be compared against the state it started
    # from, rather than the run believing the session's own account of what it achieved.
    state.remember_page(target, page.markdown)
    return ToolOutcome(
        name="scrape",
        ok=True,
        content=_format_page(page),
        observed_urls=[page.url or target],
    )


def _verify_interaction(before: str, after: str) -> tuple[str, str]:
    """Did the page visibly move, as far as this run can tell?

    Deliberately weak in one direction and strong in the other. It cannot prove an action worked —
    a session that says "I opened the filter" and returns the same text it would have returned
    anyway is exactly the failure the reference implementation's screenshot judge existed to catch
    (`TheAgenticBrowser-main/core/ss_analysis.py:69`, "you have to visually confirm whether the text
    was actually entered"), and we have no pixels here, only text. So a differing answer is reported
    as *changed*, never as *succeeded*; an identical one is reported as unverified, which is the
    finding that matters, because the run was about to treat a page that never moved as a page it
    had acted on.
    """
    if not before.strip():
        return "UNKNOWN", ("this page was not read before the session, so there is no state to "
                           "compare the session's answer against")
    if _comparable(before) == _comparable(after):
        return "UNCHANGED", ("the session returned the same content the page already had; the action "
                             "may not have taken effect")
    return "CHANGED", "the session returned content that differs from the page as previously read"


def _comparable(text: str) -> str:
    return " ".join(text.casefold().split())


def _interaction_guidance(verdict: str, detail: str) -> str:
    """What the planner is told next to the page content, so a verdict can be acted on.

    The upstream orchestrator re-ran the same plan forever after a step that did not take effect,
    because nothing in its transcript distinguished the two cases
    (`TheAgenticBrowser-main/core/orchestrator.py:606-615`). Naming the verdict where the model
    reads the result is what turns it into a correction instead of a repeat.
    """
    if verdict == "CHANGED":
        return (f"[verification: the page state changed after this action ({detail}). Treat the "
                "content below as the post-action state.]")
    return (f"[verification: {detail}. Do not report this action as done. Either try a different "
            "action on this page, read a source that already states the value, or submit from what "
            "has actually been retrieved — do not infer the value the action was meant to reveal.]")


async def run_interact(state: ResearchState, web: WebTool, url: str, prompt: str, *,
                       policy: SourcePolicy) -> ToolOutcome:
    """Drive a page in a browser session — the only action that acts rather than reads.

    Four gates the read tools do not need, or need less strictly:

    * the tool must be enabled for this run at all (`allowed_tools`), mirroring upstream's
      filtered toolkit (`toolkit.ts:188-204`) — the model is not offered an action it
      cannot take;
    * the source policy must allow the URL, robots included: a session can reach what a
      disallowed path would hide from a crawler;
    * the URL must already have been retrieved by search or scrape this run. An agent that
      can click anything can reach anything, so interact inherits the same evidence rule
      the submission gate enforces, one layer earlier;
    * the attempt spends budget whether or not it succeeds. A session that hangs to the
      deadline is the expensive case, and refunding it would let one page stall the run.
    """
    if "interact" not in state.limits.allowed_tools:
        return ToolOutcome(
            name="interact", ok=False, content="",
            error="interact is not enabled for this run; use search or scrape",
        )
    if not supports_interact(web):
        return ToolOutcome(
            name="interact", ok=False, content="",
            error="the configured web engine has no browser session support",
        )
    if not prompt.strip():
        return ToolOutcome(name="interact", ok=False, content="", error="interact requires a prompt")

    try:
        target = validated_http_url(url)
    except WebError as exc:
        return ToolOutcome(name="interact", ok=False, content="", error=str(exc))

    if not state.budget.interaction_allowed():
        return ToolOutcome(
            name="interact",
            ok=False,
            content="",
            error=f"interaction budget exhausted ({state.budget.max_interactions} browser sessions)",
        )
    decision = await policy.check_fetch(target)
    if not decision.allowed:
        state.refuse(target, decision.code, decision.reason)
        return ToolOutcome(name="interact", ok=False, content="",
                           error=f"refused before opening a session: {decision.reason or decision.code}")

    if target not in state.observed_urls():
        return ToolOutcome(
            name="interact",
            ok=False,
            content="",
            error=f"{target} has not been retrieved this run; search for it and scrape it before "
                  "attempting to drive it",
        )

    state.budget.note_interaction()

    try:
        result = await web.interact(target, prompt)  # type: ignore[attr-defined]
    except WebError as exc:
        return ToolOutcome(name="interact", ok=False, content="", error=str(exc))

    if result.error:
        # Includes the timeout envelope: it arrives as data with fallback advice in it, and
        # the model must read that advice rather than have it collapsed into a stack trace.
        return ToolOutcome(name="interact", ok=False, content="", error=result.error)

    state.observe(target, source_type="interact")
    verdict, detail = _verify_interaction(state.page_for(target), result.output)
    state.note_interaction(InteractionRecord(
        url=target,
        prompt=prompt,
        session_id=result.session_id or "unknown",
        verdict=verdict,
        detail=detail,
    ))
    if verdict == "CHANGED":
        # The post-action state is now the page this run holds, so a second session on the same URL
        # is compared against where the first one left it rather than against the original read.
        state.remember_page(target, result.output)
    body = _format_interaction(result)
    return ToolOutcome(name="interact", ok=True,
                       content=f"{_interaction_guidance(verdict, detail)}\n\n{body}",
                       observed_urls=[target])


async def execute_action(state: ResearchState, web: WebTool, action: dict, *,
                         policy: SourcePolicy, target: RelevanceTarget) -> list[ToolOutcome]:
    """Run the single action the model chose.

    Returns a list for signature parity with the template's concurrent `toolNode`; the
    action schema deliberately permits one action per turn, so cross-turn parallelism
    lives in the collection phase, and the per-request cap stays inside the Firecrawl
    client's semaphore.
    """
    kind = action.get("action")
    if kind == "search":
        return [await run_search(state, web, str(action.get("query", "")),
                                 policy=policy, target=target)]
    if kind == "scrape":
        return [await run_scrape(state, web, str(action.get("url", "")), policy=policy)]
    if kind == "interact":
        return [await run_interact(state, web, str(action.get("url", "")),
                                   str(action.get("prompt", "")), policy=policy)]
    return []


async def execute_many(state: ResearchState, web: WebTool, calls: list[tuple[str, str]], *,
                       policy: SourcePolicy, target: RelevanceTarget) -> list[ToolOutcome]:
    """Concurrent execution with per-call isolation, kept for batch phases.

    `interact` is refused here on principle: upstream gives parallel workers search and
    scrape only, because a browser session is too heavy to multiply
    (`worker/index.ts:61`, `worker/index.ts:69`). Batch callers pass `(kind, value)` pairs,
    which cannot carry an interact prompt anyway, so a refusal is also the only honest
    answer.
    """
    refused = [
        ToolOutcome(name="interact", ok=False, content="",
                    error="interact is not available in parallel batch execution; run it in the "
                          "research loop where its budget and session lifecycle are tracked")
        for kind, _ in calls if kind == "interact"
    ]
    tasks = [
        run_search(state, web, value, policy=policy, target=target)
        if kind == "search" else run_scrape(state, web, value, policy=policy)
        for kind, value in calls if kind != "interact"
    ]
    return list(await asyncio.gather(*tasks)) + refused
