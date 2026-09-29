"""Schema validation — the single source of truth for "does this output match the
schema the caller asked for?".

Ported from `web-agent-main/agent-core/src/schema-validate.ts`, keeping the property
that file argues for explicitly: **one validator backs three paths** — the field
checklist rendered into the prompt, the runtime gate that offers the model a repair
chance, and the post-run assessment reported as `validationState`. If those three
disagreed, "strict adherence" would be a lie.

Two deliberate divergences, both forced by our contract:

* Upstream validated **example-shaped** schemas (a sample object). Our planner emits
  real **JSON Schema** (`type`/`properties`/`required`/`items`, `additionalProperties:
  false`). Walking a JSON Schema literally would treat the words `type` and
  `properties` as required output fields, so this walks the schema properly.
* Upstream's `extra` set was top-level only. Here `additionalProperties: false` is our
  default at every object level, so unexpected keys are reported with their path.

Preserved semantics: arrays are validated item-by-item (a list of 10 records must each
carry every field, not just the first), the walk is depth-capped, and an empty value
counts as missing — a blank string is not evidence of anything.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

MAX_WALK_DEPTH = 6
MAX_CHECKLIST_DEPTH = 4

_PRIMITIVE_TYPES = ("string", "number", "integer", "boolean")


@dataclass(slots=True)
class SchemaValidation:
    missing: list[str] = field(default_factory=list)
    extra: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.missing and not self.extra

    def issues(self) -> list[str]:
        problems = [f"missing required field: {path}" for path in self.missing]
        problems += [f"field not present in the schema: {path}" for path in self.extra]
        return problems

    def as_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "missing": self.missing, "extra": self.extra}


def is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, dict, tuple, set)):
        return len(value) == 0
    return False


def _declares_extra_keys_rejected(schema: dict[str, Any]) -> bool:
    return schema.get("additionalProperties", False) is not True


def _walk(schema: Any, data: Any, prefix: str, result: SchemaValidation) -> None:
    path = prefix or "(root)"

    if isinstance(schema, bool) or schema is None:
        return

    schema_type = schema.get("type")
    if schema_type is None and "properties" in schema:
        schema_type = "object"
    if schema_type is None and "items" in schema:
        schema_type = "array"

    if schema_type == "array":
        if not isinstance(data, list):
            result.missing.append(path)
            return
        # An empty list is not "a value that happens to have no items" — for this
        # platform it means nothing was collected, which must never validate. Upstream
        # applied the same rule (`schema-validate.ts:83-86`).
        if not data:
            result.missing.append(f"{path}[]")
            return
        items = schema.get("items")
        if items is None:
            return
        for index, element in enumerate(data):
            _walk(items, element, f"{prefix}[{index}]", result)
        return

    if schema_type == "object":
        if not isinstance(data, dict):
            result.missing.append(path)
            return
        properties: dict[str, Any] = schema.get("properties", {})
        required = set(schema.get("required", []))
        for key, sub_schema in properties.items():
            child_path = f"{prefix}.{key}" if prefix else key
            if key not in data:
                if key in required:
                    result.missing.append(child_path)
                continue
            _walk(sub_schema, data[key], child_path, result)
        if _declares_extra_keys_rejected(schema):
            for key in data:
                if key not in properties:
                    result.extra.append(f"{prefix}.{key}" if prefix else key)
        return

    if schema_type in _PRIMITIVE_TYPES or "enum" in schema:
        if is_empty(data):
            result.missing.append(path)
        allowed = schema.get("enum")
        if allowed and data not in allowed:
            result.missing.append(f"{path} (not one of {allowed})")
        return


def validate_against_schema(schema: Any, data: Any) -> SchemaValidation:
    """Validate `data` against a JSON Schema `schema`."""
    result = SchemaValidation()
    if not isinstance(schema, dict):
        result.missing.append("(root) schema is not an object")
        return result
    _walk(schema, data, "", result)
    return result


def field_checklist(schema: Any, prefix: str = "", depth: int = 0) -> list[str]:
    """Leaf paths the model must fill, for rendering into a prompt.

    Mirrors upstream's `extractFieldPaths`, including its "get ALL items" hint for
    arrays of primitives, which is what stops a model returning one example item.
    """
    if depth > MAX_CHECKLIST_DEPTH:
        return [prefix or "(nested)"]

    if not isinstance(schema, dict):
        return [prefix] if prefix else []

    schema_type = schema.get("type")
    if schema_type is None and "properties" in schema:
        schema_type = "object"
    if schema_type is None and "items" in schema:
        schema_type = "array"

    if schema_type == "array":
        items = schema.get("items") or {}
        if isinstance(items, dict) and items.get("type") in _PRIMITIVE_TYPES:
            return [f"{prefix}[] (get ALL items)" if prefix else "[] (get ALL items)"]
        return field_checklist(items, f"{prefix}[]", depth + 1)

    if schema_type == "object":
        paths: list[str] = []
        for key, sub in (schema.get("properties") or {}).items():
            child = f"{prefix}.{key}" if prefix else key
            if isinstance(sub, dict) and ("properties" in sub or sub.get("type") in ("object", "array")):
                paths.extend(field_checklist(sub, child, depth + 1))
            else:
                paths.append(child)
        return paths

    return [prefix] if prefix else []


def coerce_to_json(value: Any) -> Any:
    """Best-effort parse of whatever a model produced. `None` means unusable."""
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return json.loads(text)
        except (json.JSONDecodeError, ValueError):
            return None
    return value


def strip_const(schema: Any) -> Any:
    """Remove `const`, which Gemini rejects inside tool/response schemas.

    Recorded upstream as a real failure mode (`agent-core/README.md:399-401`); Gemini is
    our default provider, so this would otherwise surface only at runtime.
    """
    if isinstance(schema, dict):
        cleaned = {}
        for key, value in schema.items():
            if key == "const":
                if value not in (None, ""):
                    cleaned.setdefault("enum", [value])
                continue
            cleaned[key] = strip_const(value)
        return cleaned
    if isinstance(schema, list):
        return [strip_const(item) for item in schema]
    return schema
