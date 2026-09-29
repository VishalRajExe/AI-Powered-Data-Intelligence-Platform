"""Gemini structured-output client.

One seam for the whole research graph, so a provider swap is a deliberate change here
rather than a silent fallback elsewhere. Output is always constrained by
`response_schema`, and the model is asked for JSON — never free text we then have to
guess at.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Protocol

from app.config import Settings
from app.extraction.schema_validate import coerce_to_json, to_gemini_schema


class LlmError(RuntimeError):
    """Provider unreachable, or its output unusable. Always raised, never swallowed."""


class LlmOutputUnparsable(LlmError):
    """The model replied but the payload is not JSON. This is repairable."""


class LlmClient(Protocol):
    async def generate_json(
        self,
        *,
        system: str,
        prompt: str,
        json_schema: dict[str, Any],
        temperature: float = 0.0,
    ) -> dict[str, Any]:
        ...


class GeminiLlm:
    """Implements :class:`LlmClient` against the `google-genai` SDK."""

    def __init__(self, settings: Settings) -> None:
        from google import genai

        self._settings = settings
        self._client = genai.Client(api_key=settings.gemini_api_key)
        self.model_id = settings.llm_model_id

    async def generate_json(
        self,
        *,
        system: str,
        prompt: str,
        json_schema: dict[str, Any],
        temperature: float = 0.0,
    ) -> dict[str, Any]:
        from google.genai import types

        config = types.GenerateContentConfig(
            temperature=temperature,
            system_instruction=system,
            response_mime_type="application/json",
            # Gemini rejects `const` and has no `additionalProperties` field, so the strict
            # internal schema is projected before it reaches the provider.
            response_schema=to_gemini_schema(json_schema),
        )

        try:
            response = await asyncio.wait_for(
                self._client.aio.models.generate_content(
                    # The SDK takes a string, a Part, or a types.Content — not an
                    # OpenAI-style {"role","content"} dict, which pydantic rejects.
                    model=self.model_id,
                    contents=prompt,
                    config=config,
                ),
                timeout=self._settings.llm_request_timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            raise LlmError(
                f"Gemini request timed out after "
                f"{self._settings.llm_request_timeout_seconds}s on model {self.model_id}"
            ) from exc
        except Exception as exc:
            raise LlmError(f"Gemini request failed: {_detail(exc, self._settings.gemini_api_key)}") from exc

        text = getattr(response, "text", None)
        if not text:
            raise LlmOutputUnparsable("Gemini returned no text content")

        parsed = coerce_to_json(text)
        if not isinstance(parsed, dict):
            raise LlmOutputUnparsable("Gemini output was not a JSON object")
        return parsed


def _detail(exc: BaseException, secret: str) -> str:
    """A bounded, key-scrubbed description of a provider failure.

    Swallowing the detail entirely turns every distinct outage into the same unusable
    message; echoing it raw risks the API key, which some SDK error dumps include. So:
    truncate, then redact the key if it survived into the text.
    """
    text = f"{type(exc).__name__}: {exc}"[:400]
    if secret:
        text = text.replace(secret, "***")
    return text


class RecordingLlm:
    """Test double that replays canned payloads and records every schema it was shown."""

    def __init__(self, payloads: list[dict[str, Any]]) -> None:
        self._payloads = payloads
        self.calls: list[dict[str, Any]] = []

    async def generate_json(
        self,
        *,
        system: str,
        prompt: str,
        json_schema: dict[str, Any],
        temperature: float = 0.0,
    ) -> dict[str, Any]:
        self.calls.append({"system": system, "prompt": prompt, "schema": json_schema})
        if not self._payloads:
            raise AssertionError("RecordingLlm ran out of canned payloads")
        payload = self._payloads.pop(0)
        if isinstance(payload, Exception):
            raise payload
        return payload

    @staticmethod
    def dump(payload: dict[str, Any]) -> str:
        return json.dumps(payload)
