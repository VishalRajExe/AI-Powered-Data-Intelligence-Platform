"""Bounded retry for web calls, driven by the contract that already existed.

`app.contracts.RetryPolicy` and `RETRYABLE_ERRORS` were ported in Phase 0 with **nothing in the
codebase consulting them**. This module is what consults them.

The reference implementation is `web-research-agent-master/utils/web_scraper.py:33-45`:
`await asyncio.sleep(backoff * (2 ** i))`, retrying `(httpx.HTTPError, httpx.RequestError)` —
where `RequestError` is a subclass of `HTTPError`, so the tuple names one class twice. Four
things are wrong with how it is used and one is wrong in the code:

* `web_scraper_tool.py:14` calls `fetch_page(url, 1)`, so **the shipped path retries zero
  times** while its README (`:140`) advertises "retries up to 3 times with exponential backoff".
* There is no ceiling on the delay and no jitter: a shared failure mode makes everyone retry on
  the same schedule and re-collide.
* Its LLM calls have no retry at all (`analyze_query.py:36`, `result_aggregator_tool.py:36`).
* Nothing classifies the failure, so a 404 is retried exactly like a 429.
* The `except Exception` in the tool layer (`web_scraper_tool.py:21-22`) swallows the final
  failure into a log line, so a run of ten failed scrapes returns an empty list that looks like
  "no sources exist".

Here the kind is explicit (`TIMEOUT` / `RATE_LIMIT` / `TRANSIENT_NETWORK` / `SERVER_ERROR` /
`PERMANENT`), read from the provider's own status code where it has one, and only the first four
are retryable — and only those the policy names.
"""
from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable
from typing import TypeVar

from app.contracts import RETRYABLE_ERRORS, RetryPolicy

T = TypeVar("T")

TIMEOUT = "TIMEOUT"
RATE_LIMIT = "RATE_LIMIT"
TRANSIENT_NETWORK = "TRANSIENT_NETWORK"
SERVER_ERROR = "SERVER_ERROR"
PERMANENT = "PERMANENT"


def classify(exc: BaseException) -> str:
    """One label for one failure, from what the provider actually said.

    An explicit `kind` wins, because the caller that raised the error usually knows what it was
    ("this URL is refused") and guessing from the exception's class name would let a deliberate
    refusal be retried like a transient fault.

    `status_code` is read by duck-typing rather than by importing the SDK's exception class,
    because `firecrawl.v2.utils.error_handler` is an internal module path; pinning our control
    flow to it would break on a rename.
    """
    declared = getattr(exc, "kind", None)
    if isinstance(declared, str) and declared:
        return declared

    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return TIMEOUT

    status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        if status == 429:
            return RATE_LIMIT
        if 500 <= status < 600:
            return SERVER_ERROR
        return PERMANENT

    name = type(exc).__name__.lower()
    if "timeout" in name:
        return TIMEOUT
    if "rate" in name or "too_many_requests" in name:
        return RATE_LIMIT
    if "server" in name:
        return SERVER_ERROR
    if "client" in name or "bad_request" in name or "not_found" in name or "unauthorized" in name:
        return PERMANENT
    return TRANSIENT_NETWORK


def backoff_delay(attempt: int, *, base_seconds: float, cap_seconds: float,
                  jitter: bool = True, rng: Callable[[], float] | None = None) -> float:
    """`base * 2**attempt`, capped, then optionally jittered into [0.5x, 1.5x].

    The cap is the part upstream omits: with `base=1.0` and five attempts the final wait is 16 s,
    and with a larger attempt count it grows without bound inside a run that has a deadline.
    """
    raw = base_seconds * (2 ** max(0, attempt))
    bounded = min(raw, cap_seconds)
    if not jitter:
        return bounded
    generator = rng or random.random
    return bounded * (0.5 + generator())


def is_retryable(exc: BaseException, policy: RetryPolicy) -> bool:
    kind = classify(exc)
    return kind in policy.retryable_errors and kind in RETRYABLE_ERRORS


async def run_with_retry(operation: str, factory: Callable[[], Awaitable[T]], *,
                         policy: RetryPolicy, base_seconds: float, cap_seconds: float,
                         sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
                         jitter: bool = True) -> tuple[T | None, int, BaseException | None]:
    """Call `factory()` up to `policy.max_attempts` times.

    Returns `(result, attempts, last_error)` instead of raising, because the caller has two
    different things to say: "it never worked" and "it worked on the third try after two 429s".
    The second is the normal case against a rate-limited API and must be countable.
    """
    attempts = 0
    last_error: BaseException | None = None

    for attempt in range(policy.max_attempts):
        attempts += 1
        try:
            return await factory(), attempts, None
        except Exception as exc:  # noqa: BLE001 - re-raised below when the policy is exhausted
            last_error = exc
            if not is_retryable(exc, policy):
                return None, attempts, exc
            if policy.strategy == "none" or attempt == policy.max_attempts - 1:
                return None, attempts, exc
            delay = backoff_delay(attempt, base_seconds=base_seconds, cap_seconds=cap_seconds,
                                  jitter=jitter)
            await sleeper(delay)

    return None, attempts, last_error


__all__ = ["classify", "backoff_delay", "is_retryable", "run_with_retry", "RetryPolicy",
           "TIMEOUT", "RATE_LIMIT", "TRANSIENT_NETWORK", "SERVER_ERROR", "PERMANENT"]
