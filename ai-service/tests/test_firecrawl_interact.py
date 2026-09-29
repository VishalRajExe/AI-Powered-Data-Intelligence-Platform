"""The Firecrawl browser-session lifecycle, driven against a stub SDK client.

`FirecrawlWeb` is the only place this project touches the Firecrawl SDK, and `interact` is
the only tool in it that owns state outside one request — a browser session with a TTL.
So these tests inject a stand-in for the SDK object itself rather than the `WebTool`
double: they assert on the production code's session handling, which is the part that can
leak credits if it is wrong.

Behaviour ported from `web-agent-main/agent-core/src/toolkit.ts`:
`stripInteractNulls` (25-34), the timeout envelope and its advice (77-91), and the fact a
stuck session must never hang the caller.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.firecrawl.client import (
    FirecrawlWeb,
    Interaction,
    WebError,
    interact_timeout_message,
    normalize_interact,
    strip_interact_nulls,
)
from tests.conftest import build_settings

URL = "https://acme.test/listing/1"


class StubFirecrawl:
    """The three SDK calls `interact` makes, with the shapes `firecrawl-py` returns."""

    def __init__(
        self,
        *,
        session_id: str | None = "brw_1",
        interact_result: object | None = None,
        interact_delay: float = 0.0,
        browser_error: Exception | None = None,
        interact_error: Exception | None = None,
        stop_error: Exception | None = None,
        search_delay: float = 0.0,
    ) -> None:
        self._session_id = session_id
        self._interact_result = interact_result if interact_result is not None else SimpleNamespace(
            success=True,
            output="The listing shows 41 open roles.",
            result=None,
            stdout="",
            stderr=None,
            exit_code=None,
            killed=False,
            truncated=False,
            error=None,
            links=[],
        )
        self._interact_delay = interact_delay
        self._browser_error = browser_error
        self._interact_error = interact_error
        self._stop_error = stop_error
        self._search_delay = search_delay
        self.calls: list[str] = []
        self.stopped: list[str] = []
        self.last_interact_kwargs: dict = {}

    async def browser(self, **kwargs):
        self.calls.append("browser")
        if self._browser_error is not None:
            raise self._browser_error
        return SimpleNamespace(success=True, id=self._session_id, cdp_url="wss://cdp")

    async def interact(self, job_id, code=None, *, prompt=None, language="node", timeout=None, origin=None):
        self.calls.append("interact")
        self.last_interact_kwargs = {"job_id": job_id, "prompt": prompt, "timeout": timeout,
                                     "code": code, "language": language}
        if self._interact_delay:
            await asyncio.sleep(self._interact_delay)
        if self._interact_error is not None:
            raise self._interact_error
        return self._interact_result

    async def search(self, query, **kwargs):
        self.calls.append("search")
        if self._search_delay:
            await asyncio.sleep(self._search_delay)
        return SimpleNamespace(web=[{"url": URL, "title": "Acme"}])

    async def scrape(self, url, **kwargs):
        self.calls.append("scrape")
        return SimpleNamespace(markdown="body", metadata={"url": url, "title": "Acme", "statusCode": 200})

    async def stop_interaction(self, job_id):
        self.calls.append("stop")
        self.stopped.append(job_id)
        if self._stop_error is not None:
            raise self._stop_error


def web_for(stub: StubFirecrawl, **overrides) -> FirecrawlWeb:
    settings = build_settings(**overrides)
    return FirecrawlWeb(settings, app=stub)


# ------------------------------------------------------------------ lifecycle


@pytest.mark.asyncio
async def test_a_session_is_created_used_and_closed_in_that_order():
    stub = StubFirecrawl()
    result = await web_for(stub).interact(URL, "count the open roles")

    assert stub.calls == ["browser", "interact", "stop"]
    assert stub.stopped == ["brw_1"]
    assert result.output == "The listing shows 41 open roles."
    assert result.session_id == "brw_1"
    assert result.error is None and result.ok is True


@pytest.mark.asyncio
async def test_the_prompt_is_sent_as_a_prompt_not_as_code():
    stub = StubFirecrawl()
    await web_for(stub).interact(URL, "expand the salary section")

    assert stub.last_interact_kwargs["prompt"] == "expand the salary section"
    assert stub.last_interact_kwargs["code"] is None


@pytest.mark.asyncio
async def test_the_sdk_is_given_a_deadline_and_the_client_a_wider_one():
    """Both layers of timeout: the SDK's own, and ours, so a hung socket cannot outlive the turn."""
    stub = StubFirecrawl()
    await web_for(stub, interact_timeout_seconds=42.0).interact(URL, "read the price")

    assert stub.last_interact_kwargs["timeout"] == 42


@pytest.mark.asyncio
async def test_the_session_is_closed_even_when_the_sdk_call_raises():
    stub = StubFirecrawl(interact_error=RuntimeError("boom"))

    with pytest.raises(WebError, match="interact failed"):
        await web_for(stub).interact(URL, "click next")

    assert stub.stopped == ["brw_1"]


@pytest.mark.asyncio
async def test_a_failure_to_close_the_session_does_not_replace_the_result():
    """`stop` errors are logged, not raised: the caller's answer must not become an error."""
    stub = StubFirecrawl(stop_error=RuntimeError("already expired"))
    result = await web_for(stub).interact(URL, "read the price")

    assert result.ok is True
    assert stub.stopped == ["brw_1"]


@pytest.mark.asyncio
async def test_a_session_without_an_id_is_refused_rather_than_tracked_as_open():
    stub = StubFirecrawl(session_id=None)

    with pytest.raises(WebError, match="no id"):
        await web_for(stub).interact(URL, "read the price")

    assert stub.calls == ["browser"], "nothing was created, so there is nothing to close"


# ------------------------------------------------------------------ timeout


@pytest.mark.asyncio
async def test_a_stuck_session_returns_a_structured_timeout_instead_of_hanging():
    stub = StubFirecrawl(interact_delay=2.0)
    result = await web_for(stub, interact_timeout_seconds=0.05).interact(URL, "paginate to page 9")

    assert result.timed_out is True
    assert result.ok is False
    assert "fall back to scrape" in (result.error or "")
    assert result.prompt == "paginate to page 9"


@pytest.mark.asyncio
async def test_the_timeout_path_still_closes_the_session():
    """Upstream aborts the request and lets the session expire on its own TTL; ours stops it,
    because an abandoned session keeps billing credits for the rest of `ttl`."""
    stub = StubFirecrawl(interact_delay=2.0)
    await web_for(stub, interact_timeout_seconds=0.05).interact(URL, "paginate")

    assert stub.stopped == ["brw_1"]


@pytest.mark.asyncio
async def test_browser_creation_timeout_is_an_error_not_an_envelope():
    """No session exists yet, so there is nothing to report to the model as data."""
    stub = StubFirecrawl(browser_error=asyncio.TimeoutError())
    with pytest.raises(WebError):
        await web_for(stub, interact_timeout_seconds=0.05).interact(URL, "anything")


def test_the_timeout_message_names_the_alternative():
    assert "scrape" in interact_timeout_message(60.0)
    assert "60.0" in interact_timeout_message(60.0)


# ------------------------------------------------------------------ normalisation


def test_null_and_empty_fields_are_stripped_so_the_model_stops_echoing_them():
    assert strip_interact_nulls({"a": 1, "b": None, "c": "", "d": [], "e": {}}) == {"a": 1, "d": [], "e": {}}


def test_non_dict_results_pass_through_untouched():
    assert strip_interact_nulls(["one", "two"]) == ["one", "two"]
    assert strip_interact_nulls(None) is None


@pytest.mark.asyncio
async def test_prompt_mode_fields_are_not_carried_into_the_tool_output():
    stub = StubFirecrawl()
    result = await web_for(stub).interact(URL, "read the price")

    assert "stdout" not in result.fields
    assert "result" not in result.fields
    assert "error" not in result.fields
    assert "links" in result.fields, "an empty list is a claim that there were none"


@pytest.mark.asyncio
async def test_a_non_http_target_is_refused_before_a_session_is_created():
    stub = StubFirecrawl()
    with pytest.raises(WebError, match="non-http"):
        await web_for(stub).interact("file:///etc/passwd", "read it")

    assert stub.calls == []


@pytest.mark.asyncio
async def test_an_empty_prompt_is_refused_before_a_session_is_created():
    stub = StubFirecrawl()
    with pytest.raises(WebError, match="requires a prompt"):
        await web_for(stub).interact(URL, "   ")

    assert stub.calls == []


def test_long_interact_output_is_truncated_with_a_marker():
    result = normalize_interact(
        {"output": "x" * 80, "url": URL},
        url=URL,
        prompt="read everything",
        session_id="brw_1",
        truncate_chars=20,
    )
    assert result.output.startswith("x" * 20)
    assert "x" * 21 not in result.output
    assert "truncated by the collection layer" in result.output


def test_stdout_is_used_when_prompt_mode_returns_no_output():
    """Code-mode sessions answer on stdout; reading only `output` would report an empty result."""
    result = normalize_interact(
        {"stdout": "printed answer", "output": None},
        url=URL,
        prompt="run it",
        session_id="brw_1",
        truncate_chars=1000,
    )
    assert result.output == "printed answer"


# ------------------------------------------------------------------ other tools


@pytest.mark.asyncio
async def test_search_uses_the_search_deadline():
    """`search` had been given the interact deadline, which is both the wrong length and
    the wrong name for a budget anyone might have to reason about."""
    stub = StubFirecrawl(search_delay=1.0)
    with pytest.raises(WebError, match="search timed out after 0.05s"):
        await web_for(stub, search_timeout_seconds=0.05).search("any query", limit=3)


def test_interaction_serializes_for_the_wire():
    payload = Interaction(url=URL, prompt="read", output="41 roles", session_id="brw_1").as_dict()
    assert payload["sessionId"] == "brw_1"
    assert payload["timedOut"] is False
    assert "error" not in payload
