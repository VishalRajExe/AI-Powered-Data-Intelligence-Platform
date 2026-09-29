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

from functools import lru_cache
from pathlib import Path
from typing import Any

from app.research.state import ResearchState

PROMPT_DIR = Path(__file__).parent / "prompts"

ACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["search", "scrape", "submit", "blocked"],
            "description": "The single next action to take.",
        },
        "reason": {
            "type": "string",
            "description": "Why this action, in one or two sentences, naming what is still missing.",
        },
        "query": {"type": "string", "description": "Required for action=search."},
        "url": {"type": "string", "description": "Required for action=scrape; must come from a prior search result."},
    },
    "required": ["action", "reason"],
    "additionalProperties": False,
}

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


def research_prompt(state: ResearchState, checklist: list[str]) -> str:
    return render(
        load("research.md"),
        {
            "topic": state.topic,
            "schema": _schema_text(state.extraction_schema),
            "checklist": "\n".join(f"- {path}" for path in checklist) or "- (schema declares no fields)",
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
