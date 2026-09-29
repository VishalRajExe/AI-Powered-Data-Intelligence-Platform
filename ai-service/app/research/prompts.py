"""Prompt templates and the fixed schemas that drive the graph's decisions.

Two fixes carried over from reading `data-enrichment-js`:

* Their templates were filled with `String.replace(searchString, replacement)`, which
  interprets `$&`, `` $` `` and `$1` **inside the replacement text** — so a topic or
  schema containing those sequences corrupts the prompt. Substitution here is literal.
* Their checker prompt was hardcoded inline in `graph.ts:185-190` and was not
  configurable even though the main prompt was. All three prompts are now external
  templates.

No template contains a domain-specific field name. The contract comes from the caller,
which derives it from the user's prompt.
"""
from __future__ import annotations

from collections.abc import Iterable
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.research.state import ResearchState

PROMPT_DIR = Path(__file__).parent / "prompts"

DATA_ACTIONS = ("search", "scrape", "interact")
CONTROL_ACTIONS = ("submit", "blocked")

_ACTION_FIELDS: dict[str, dict[str, Any]] = {
    "query": {"type": "string", "description": "Required for action=search."},
    "url": {
        "type": "string",
        "description": "Required for action=scrape and action=interact; must come from a prior "
                       "search result or scraped page.",
    },
    "prompt": {
        "type": "string",
        "description": "Required for action=interact: what to do or read in the browser session, "
                       "as one concrete step.",
    },
}

_ACTION_ARGUMENTS = {"search": ("query",), "scrape": ("url",), "interact": ("url", "prompt")}

_ACTION_HELP = {
    "search": "`search` — issue a web search. Provide `query`.",
    "scrape": "`scrape` — read one page in full. Provide `url`, which must come from a search result "
              "you were given, not from memory.",
    "interact": "`interact` — drive a page in a live browser session (click, expand, paginate, read "
                "what a static scrape cannot). Provide `url`, which you must already have retrieved, "
                "and `prompt` naming one concrete step. It is bounded and slow: prefer `scrape` "
                "unless the page genuinely will not yield its data by being read.",
}


def allowed_data_tools(requested: Any, ceiling: Iterable[str]) -> list[str]:
    """The tools a run may use: what it asked for, narrowed by what the service allows.

    A request can never widen past the ceiling, which is why `interact` cannot be switched
    on by a caller alone. Order follows the ceiling so the prompt reads consistently.
    """
    ceiling_list = [tool.lower() for tool in ceiling]
    wanted = ceiling_list if requested is None else [str(tool).lower() for tool in requested]
    return [tool for tool in ceiling_list if tool in wanted]


def action_schema(allowed_tools: Iterable[str]) -> dict[str, Any]:
    """The plan-action schema for one run, built from that run's enabled tools.

    The template kept one static tool list for every run. Enumerating only the enabled
    actions is what makes the allowlist real: the provider is structurally unable to ask
    for a disabled tool, and `additionalProperties:false` stops it smuggling one in as an
    extra field.
    """
    data_actions = [tool for tool in DATA_ACTIONS if tool in set(allowed_tools)]
    properties: dict[str, Any] = {
        "action": {
            "type": "string",
            "enum": [*data_actions, *CONTROL_ACTIONS],
            "description": "The single next action to take.",
        },
        "reason": {
            "type": "string",
            "description": "Why this action, in one or two sentences, naming what is still missing.",
        },
    }
    for action in data_actions:
        for argument in _ACTION_ARGUMENTS[action]:
            properties[argument] = _ACTION_FIELDS[argument]
    return {
        "type": "object",
        "properties": properties,
        "required": ["action", "reason"],
        "additionalProperties": False,
    }


def actions_help(allowed_tools: Iterable[str]) -> str:
    lines = [_ACTION_HELP[tool] for tool in DATA_ACTIONS if tool in set(allowed_tools)]
    lines.append("`submit` — you believe the gathered material can fill the contract. No further fields.")
    lines.append("`blocked` — the contract cannot be satisfied from public web sources. Explain why.")
    return "\n".join(f"- {line}" for line in lines)


ACTION_SCHEMA = action_schema(("search", "scrape"))

CRITIQUE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "reason": {
            "type": "array",
            "items": {"type": "string"},
            "description": "At least three distinct reasons for the verdict.",
        },
        "is_satisfactory": {"type": "boolean"},
        "improvement_instructions": {
            "type": "string",
            "description": "Required and concrete when is_satisfactory is false.",
        },
    },
    "required": ["reason", "is_satisfactory", "improvement_instructions"],
    "additionalProperties": False,
}


@lru_cache(maxsize=16)
def load(name: str) -> str:
    return (PROMPT_DIR / name).read_text(encoding="utf-8")


def render(template: str, values: dict[str, Any]) -> str:
    """Literal placeholder substitution.

    `split(sep).join(...)` inverted — the pieces are joined *by* the replacement text —
    so this is immune to `$&`, `` $` `` and `$1`, which `String.replace` in the original
    template would have interpreted. Values are coerced to text so a caller cannot pass a
    list into a prompt by accident.
    """
    rendered = template
    for key, value in values.items():
        text = value if isinstance(value, str) else str(value)
        rendered = text.join(rendered.split("{" + key + "}"))
    return rendered


def _schema_text(schema: dict[str, Any]) -> str:
    import json

    return json.dumps(schema, indent=2, ensure_ascii=False)


def _feedback_block(state: ResearchState) -> str:
    if not state.feedback:
        return ""
    return (
        "## Feedback from the previous attempt — address this\n\n"
        f"{state.feedback}\n\n"
        "Do not resubmit the same material unchanged."
    )


def _playbooks_block(playbooks: list[tuple[str, str]]) -> str:
    if not playbooks:
        return ""
    header = (
        "## Site playbooks for the domains in this run\n\n"
        "These describe how a specific site lays out its pages, written by whoever maintains "
        "this deployment. Follow them over generic guesses, but treat their claims as leads to "
        "verify against retrieved content, not as data you may submit."
    )
    blocks = [f"### {name}\n\n{body.strip()}" for name, body in playbooks]
    return header + "\n\n" + "\n\n".join(blocks)


def research_prompt(state: ResearchState, checklist: list[str],
                    playbooks: list[tuple[str, str]] | None = None) -> str:
    return render(
        load("research.md"),
        {
            "topic": state.topic,
            "schema": _schema_text(state.extraction_schema),
            "checklist": "\n".join(f"- {path}" for path in checklist) or "- (schema declares no fields)",
            "actions": actions_help(state.limits.allowed_tools),
            "transcript": transcript_text(state),
            "playbooks": _playbooks_block(playbooks or []),
            "feedback": _feedback_block(state),
        },
    )


def submission_prompt(state: ResearchState, checklist: list[str]) -> str:
    return render(
        load("submit.md"),
        {
            "topic": state.topic,
            "schema": _schema_text(state.extraction_schema),
            "checklist": "\n".join(f"- {path}" for path in checklist) or "- (schema declares no fields)",
            "expected_records": str(state.limits.expected_records or "not specified"),
            "transcript": transcript_text(state),
        },
    )


def critique_prompt(state: ResearchState, checklist: list[str], proposed: dict[str, Any]) -> str:
    import json

    return render(
        load("critique.md"),
        {
            "topic": state.topic,
            "schema": _schema_text(state.extraction_schema),
            "checklist": "\n".join(f"- {path}" for path in checklist),
            "expected_records": str(state.limits.expected_records or "not specified"),
            "sources": "\n".join(f"- {source.url} ({source.source_type})" for source in state.sources.values())
            or "- (no sources were retrieved)",
            "result": json.dumps(proposed, indent=2, ensure_ascii=False),
        },
    )


def transcript_text(state: ResearchState) -> str:
    """The gathered evidence handed to the submission node.

    `data-enrichment-js` spent a second LLM call summarising each scraped page
    (`tools.ts:60-69`). That call is not reproduced: summarising through the same model
    that then extracts invites it to paraphrase facts into existence, and it doubles cost
    per page. Pages are carried as retrieved, already truncated by the collection layer.
    """
    blocks: list[str] = []
    for message in state.messages:
        if message.role == "tool" and message.status == "success":
            blocks.append(f"[{message.name}]\n{message.content}")
    return "\n\n---\n\n".join(blocks) or "(nothing was retrieved)"
