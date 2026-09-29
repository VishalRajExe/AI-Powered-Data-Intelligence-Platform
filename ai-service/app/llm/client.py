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
from app.extraction.schema_validate import coerce_to_json, strip_const


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
            # Gemini rejects `const`; strip it before the schema reaches the provider.
            response_schema=strip_const(json_schema),
        )

        try:
            response = await asyncio.wait_for(
                self._client.aio.models.generate_content(
                    model=self.model_id,
                    contents=[{"role": "user", "content": prompt}],
                    config=config,
                ),
                timeout=self._settings.llm_request_timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            raise LlmError(
                f"Gemini request timed out after "
                f"{self._settings.llm_request_timeout_seconds}s on model {self.model_id}"
            ) from exc
        except Exception as exc:  # SDK raises many provider-specific types
            # Never interpolate the exception into a returned message: SDK errors can
            # echo request payloads, which carry the API key.
            raise LlmError(f"Gemini request failed: {type(exc).__name__}") from exc

        text = getattr(response, "text", None)
        if not text:
            raise LlmOutputUnparsable("Gemini returned no text content")

        parsed = coerce_to_json(text)
        if not isinstance(parsed, dict):
            raise LlmOutputUnparsable("Gemini output was not a JSON object")
        return parsed


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
