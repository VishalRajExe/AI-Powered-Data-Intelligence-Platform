"""Normalization: make values comparable without changing what they mean.

Ported from `data-intelligence/NormalizationService.ts` with its defects fixed rather than
reproduced:

* Its URL canonicalizer contained `hostname.replace(/^www\\./u, "www.")` (`:154`) — a no-op that
  replaced `www.` with itself, so "canonical" URLs kept their `www.` while the *deduplicator*
  stripped it (`DeduplicationService.ts:90`). Two normalizers disagreed, which is how one page
  becomes two rows. This module calls the same `canonical_key` the curation stage uses, so there
  is one URL identity in the whole service.
* It discarded a currency's code for numeric fields, keeping a note instead (`:198`). A number
  without its unit is not a normalized value, it is a smaller piece of information, so the code is
  kept in the value.
* It invented `null` for every schema field a record lacked (`:47-49`). Absent stays absent here;
  a missing required field is the validation stage's finding to report, not a value to fabricate.
* It mapped a property's *description* onto a field key when the description was short (`:91-94`),
  so a prose sentence could silently rename a column. Only keys and labels are mapped.

Normalization never guesses. An ambiguous date (`03/04/2024`), a currency with no determinable
code, a phone with an extension: the original value is kept and a note says why. The raw values are
retained on every record so any of it can be undone.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.curation.canonical import canonical_key
from app.quality.contracts import RecordIn

# Values that mean "nothing was here". A literal "null" arriving from a model is an absent value,
# not a string; the legacy pipeline had the same set (`NormalizationService.ts:15`).
_EMPTY_STRINGS = frozenset({"", "-", "--", "n/a", "na", "none", "null", "nil", "unknown", "?"})

_WHITESPACE = re.compile(r"\s+")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")

# Accounting convention: parentheses mean negative. Recognised because a funding or salary table
# that uses it would otherwise normalize to a positive number, which is a wrong value rather than
# an absent one.
_PARENTHESISED = re.compile(r"^\((?P<body>.*)\)$")
_NUMBER_BODY = re.compile(r"^(?P<sign>[-+]?)(?P<digits>[\d,._ ]*)(?P<suffix>[kmbtKMBT])?$")
_CURRENCY_PREFIX = re.compile(
    r"^(?P<symbol>[$€£¥₹₽]|(?P<code>[A-Z]{3})\s?)(?P<rest>.*)$"
)
_CURRENCY_SUFFIX = re.compile(r"^(?P<rest>.*?)(?:\s?(?P<code>[A-Z]{3})|(?P<symbol>[$€£¥₹₽]))$")
_SYMBOL_TO_CODE = {"$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "₽": "RUB"}
# "$" is ambiguous (USD, CAD, AUD, HKD…). It is mapped to USD only when nothing else in the value
# says otherwise, and the guess is recorded in a note rather than passed off as a reading.
_AMBIGUOUS_SYMBOLS = frozenset({"$", "¥"})

_SUFFIX_MULTIPLIERS = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000, "t": 1_000_000_000_000}

_MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4,
    "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9,
    "sept": 9, "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12,
    "december": 12,
}

_PHONE_ALLOWED = re.compile(r"[^\d+]+")
_EXTENSION = re.compile(r"(?:\bext\.?\b|\bx\b|extension|#)\s*(\d{1,6})", re.IGNORECASE)


@dataclass(slots=True)
class FieldMap:
    """Alias → canonical key, built from the declared fields and the extraction schema.

    Both are per-run inputs, so a prompt that asks for `channel_url` and one that asks for
    `application_url` produce different maps. There is no alias table in this file: a hardcoded
    one would be a dataset template wearing a normalizer's clothes.
    """

    by_alias: dict[str, str] = field(default_factory=dict)
    keys: list[str] = field(default_factory=list)
    types: dict[str, str] = field(default_factory=dict)
    labels: dict[str, str] = field(default_factory=dict)
    required: set[str] = field(default_factory=set)


def fold_key(key: str) -> str:
    return _NON_ALNUM.sub("_", (key or "").strip().lower()).strip("_")


def build_field_map(fields: list[Any], extraction_schema: dict[str, Any],
                    required_fields: list[str]) -> FieldMap:
    """The field map is derived from the request, never from a table in this module."""
    result = FieldMap()

    def register(key: str, *, field_type: str = "STRING", label: str = "", required: bool = False,
                 aliases: tuple[str, ...] = ()) -> None:
        canonical = fold_key(key)
        if not canonical:
            return
        if canonical not in result.types:
            result.keys.append(canonical)
        # The more specific declaration wins. The requirement's typed field list is a stronger
        # statement than the extraction schema's `type: string`, and letting the schema overwrite
        # it would silently turn a CURRENCY column into a string nobody parses. Ties go to whichever
        # was declared first, so the requirement's own field list outranks a schema inference.
        if _specificity(field_type) > _specificity(result.types.get(canonical, "")):
            result.types[canonical] = (field_type or "STRING").upper()
        elif canonical not in result.types:
            result.types[canonical] = (field_type or "STRING").upper()
        if label and canonical not in result.labels:
            result.labels[canonical] = label
        if required:
            result.required.add(canonical)
        for alias in (key, label, *aliases):
            folded = fold_key(alias)
            if folded:
                result.by_alias.setdefault(folded, canonical)

    for spec in fields or []:
        key = getattr(spec, "key", None) or (spec.get("key") if isinstance(spec, dict) else None)
        if not key:
            continue
        label = getattr(spec, "label", "") or (spec.get("label", "") if isinstance(spec, dict) else "")
        field_type = getattr(spec, "type", "STRING")
        field_type = field_type.value if hasattr(field_type, "value") else str(field_type)
        required = bool(getattr(spec, "required", False)) or (
            isinstance(spec, dict) and bool(spec.get("required")))
        register(str(key), field_type=field_type, label=str(label or ""), required=required)

    properties = extraction_schema.get("properties") if isinstance(extraction_schema, dict) else None
    if isinstance(properties, dict):
        for name, definition in properties.items():
            folded = fold_key(name)
            if not folded:
                continue
            if isinstance(definition, dict) and definition.get("type") == "array" and isinstance(
                    definition.get("items"), dict):
                definition = definition["items"]
            if not isinstance(definition, dict):
                continue
            inner = definition.get("properties")
            if isinstance(inner, dict):
                for inner_name, inner_definition in inner.items():
                    register(inner_name, field_type=_json_type(inner_definition),
                             label=_title(inner_definition))
            else:
                register(name, field_type=_json_type(definition), label=_title(definition))

    for key in required_fields or []:
        folded = fold_key(key)
        if folded:
            result.required.add(folded)
            if folded in result.types:
                continue
            result.keys.append(folded)
            result.types[folded] = "STRING"

    return result


def _specificity(field_type: str | None) -> int:
    """How much a type declaration says. A tie keeps whichever was declared first.

    `STRING` is what a JSON Schema `type: string` yields, and it is the weakest statement anyone
    makes about a field; `URL`, `CURRENCY` and `DATE` come from the requirement's own field list,
    which is the caller telling us what the value *is*. Letting the weaker one win is how the
    currency amount in the smoke test stayed a string.
    """
    declared = (field_type or "").upper()
    if not declared:
        return -1
    if declared == "STRING":
        return 0
    if declared == "JSON":
        return 1
    return 2


def _json_type(definition: dict[str, Any]) -> str:
    mapping = {"string": "STRING", "integer": "NUMBER", "number": "NUMBER", "boolean": "BOOLEAN",
               "object": "JSON", "array": "JSON"}
    declared = str(definition.get("type", "string")).lower()
    resolved = mapping.get(declared, "STRING")
    # A JSON Schema `format` is a stronger statement than `type: string`, and the extraction
    # schema is the only place the run declares one.
    declared_format = str(definition.get("format", "")).lower()
    if declared_format in {"uri", "url"}:
        return "URL"
    if declared_format == "email":
        return "EMAIL"
    if declared_format in {"date", "date-time"}:
        return "DATETIME" if declared_format == "date-time" else "DATE"
    if resolved == "STRING" and declared_format == "tel":
        return "PHONE"
    return resolved


def _title(definition: dict[str, Any]) -> str:
    value = definition.get("title") or definition.get("label") or ""
    return str(value)


@dataclass(slots=True)
class NormalizedRecord:
    values: dict[str, Any]
    raw_values: dict[str, Any]
    notes: list[str]
    sources: list[Any]
    unmapped_keys: list[str]


def normalize_record(record: RecordIn, field_map: FieldMap, *, places: list[str] | None = None,
                     index: int = 0) -> NormalizedRecord:
    """Normalize one record's values, keeping the originals and reporting every change."""
    notes: list[str] = []
    raw_values = dict(record.values or {})
    values: dict[str, Any] = {}
    unmapped: list[str] = []
    claimed: dict[str, str] = {}
    known_places = {fold_key(place): place for place in (places or []) if str(place).strip()}

    for original_key, value in raw_values.items():
        canonical = field_map.by_alias.get(fold_key(original_key))
        if canonical is None:
            # Not in the contract. Kept under its folded key rather than dropped: a column the
            # schema did not declare is a finding for the validation stage, not a value to hide.
            canonical = fold_key(original_key) or str(original_key)
            unmapped.append(str(original_key))
            field_map.types.setdefault(canonical, "STRING")

        if value is None:
            continue
        if isinstance(value, str) and value.strip().lower() in _EMPTY_STRINGS:
            notes.append(f"{canonical}: empty placeholder {value.strip()!r} treated as absent")
            continue

        previous_alias = claimed.get(canonical)
        if previous_alias is not None:
            existing = values.get(canonical)
            if existing is None:
                values[canonical] = _normalize_value(value, field_map.types[canonical], canonical,
                                                    notes, known_places)
                claimed[canonical] = str(original_key)
                continue
            if _same(existing, value):
                continue
            notes.append(
                f"{canonical}: alias {original_key!r} disagrees with {previous_alias!r} "
                f"({existing!r} kept, {value!r} recorded as a conflict candidate)")
            continue
        claimed[canonical] = str(original_key)
        values[canonical] = _normalize_value(value, field_map.types[canonical], canonical, notes,
                                             known_places)

    return NormalizedRecord(values=values, raw_values=raw_values, notes=notes,
                            sources=list(record.sources or []), unmapped_keys=unmapped)


def _same(existing: Any, incoming: Any) -> bool:
    if isinstance(existing, str) and isinstance(incoming, str):
        return existing.strip().casefold() == incoming.strip().casefold()
    return existing == incoming


def _normalize_value(value: Any, field_type: str, key: str, notes: list[str],
                     known_places: dict[str, str]) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if field_type == "NUMBER":
        return _number(value, key, notes)
    if field_type == "CURRENCY":
        return _currency(value, key, notes)
    if field_type in {"DATE", "DATETIME"}:
        return _date(value, key, notes, want_time=field_type == "DATETIME")
    if field_type == "URL":
        return _url(value, key, notes)
    if field_type == "EMAIL":
        return _email(value, key, notes)
    if field_type == "PHONE":
        return _phone(value, key, notes)
    if field_type == "BOOLEAN":
        return _boolean(value, key, notes)
    return _string(value, key, notes, known_places)


def _string(value: Any, key: str, notes: list[str], known_places: dict[str, str]) -> Any:
    text = _collapse(value)
    if not text:
        return None
    # A place name is canonicalized against the places the requirement itself declared, so the
    # spelling comes from the run's own input rather than from a table shipped in this file.
    folded = fold_key(text)
    if folded in known_places and known_places[folded] != text:
        notes.append(f"{key}: place name {text!r} matched the requirement's "
                     f"{known_places[folded]!r}")
        return known_places[folded]
    return text


def _collapse(value: Any) -> str:
    return _WHITESPACE.sub(" ", str(value)).strip()


def _strip_currency_on_a_number(key: str, text: str, notes: list[str]) -> str:
    """Read a number that arrived wearing a currency sign, and say that the sign had nowhere to go.

    A `NUMBER` column has no place to keep a unit, and refusing the whole value over a leading
    symbol would throw away the part that was unambiguous — a scraped salary column declared
    `NUMBER` arriving as `₹18,00,000` is ordinary. The unit is not silently dropped either: it is
    named in a note on the record, which is where every other loss in this pipeline is reported.
    """
    prefix = _CURRENCY_PREFIX.match(text)
    if prefix and (prefix.group("symbol") or prefix.group("code")):
        unit = prefix.group("code") or _SYMBOL_TO_CODE.get(prefix.group("symbol") or "",
                                                           prefix.group("symbol"))
        notes.append(f"{key}: {unit} seen on a numeric field with no unit of its own; the amount "
                     f"was read and the unit recorded here only")
        return prefix.group("rest").strip()
    return text


def _url(value: Any, key: str, notes: list[str]) -> Any:
    text = _collapse(value)
    if not text:
        return None
    # `canonical_key` will happily build a URL out of almost any string ("not a url" becomes
    # "https://not a url/"), so the value has to look like one before it is canonicalized.
    # Inventing a URL from a phrase is exactly the fabrication this pipeline exists to prevent.
    if not _looks_like_url(text):
        notes.append(f"{key}: {text!r} is not an absolute URL; kept as written")
        return text
    canonical = canonical_key(text)
    if canonical != text:
        notes.append(f"{key}: URL canonicalized to {canonical!r}")
    return canonical


def _looks_like_url(text: str) -> bool:
    if " " in text:
        return False
    if "://" in text:
        return text.split("://", 1)[0].lower() in {"http", "https", "ftp", "ftps"}
    return text.lower().startswith("www.") and "." in text[4:]


def _email(value: Any, key: str, notes: list[str]) -> Any:
    text = _collapse(value).lower()
    return text or None


def _phone(value: Any, key: str, notes: list[str]) -> Any:
    text = _collapse(value)
    if not text:
        return None
    extension = _EXTENSION.search(text)
    digits = _PHONE_ALLOWED.sub("", _EXTENSION.sub("", text))
    if not digits:
        notes.append(f"{key}: {text!r} contains no digits; kept as written")
        return text
    normalized = digits if digits.startswith("+") else digits.lstrip("+")
    if extension:
        # The legacy normalizer dropped extensions silently (`:173-177`). Kept, and said so.
        notes.append(f"{key}: extension {extension.group(1)} preserved from {text!r}")
        return f"{normalized} x{extension.group(1)}"
    if normalized != text:
        notes.append(f"{key}: phone normalized to {normalized!r}")
    return normalized


def _boolean(value: Any, key: str, notes: list[str]) -> Any:
    if isinstance(value, bool):
        return value
    text = _collapse(value).lower()
    if text in {"true", "yes", "y", "1", "on"}:
        return True
    if text in {"false", "no", "n", "0", "off"}:
        return False
    notes.append(f"{key}: {value!r} is not a recognizable boolean; kept as written")
    return text or None


def _number(value: Any, key: str, notes: list[str]) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    text = _collapse(value)
    if not text:
        return None
    text = _strip_currency_on_a_number(key, text, notes)
    match = _PARENTHESISED.match(text)
    sign = -1 if match else 1
    body = (match.group("body") if match else text).replace("%", "").strip()
    parsed_match = _NUMBER_BODY.match(body)
    if not parsed_match or not parsed_match.group("digits"):
        notes.append(f"{key}: {value!r} is not a number; kept as written")
        return text
    digits, ambiguous = _decimal_body(parsed_match.group("digits"))
    if ambiguous:
        # "79,90" is a European decimal and "1,234" is a thousands separator, and both shapes can
        # appear in one dataset. Reading it either way is a 100× error half the time, so the value
        # is left alone and the choice goes to whoever can see the source.
        notes.append(f"{key}: {text!r} uses a comma that could be a decimal point or a thousands "
                     f"separator; the number was not guessed")
        return text
    try:
        parsed = float(digits)
    except ValueError:
        notes.append(f"{key}: {value!r} is not a number; kept as written")
        return text
    suffix = (parsed_match.group("suffix") or "").lower()
    if suffix:
        parsed *= _SUFFIX_MULTIPLIERS[suffix]
        notes.append(f"{key}: suffix {suffix.upper()} expanded ({value!r} → {parsed:g})")
    parsed *= sign
    if sign == -1:
        notes.append(f"{key}: parenthesised value read as negative ({value!r} → {parsed:g})")
    return int(parsed) if parsed.is_integer() else parsed


def _decimal_body(text: str) -> tuple[str, bool]:
    """Rewrite a numeric string into something `float` understands, or admit it cannot be read.

    When both separators appear, the right-most one is the decimal marker and the other groups
    thousands — that is a convention, not a guess, and it makes "1,250.00" and "1.250,00" both
    read as 1250. With a single separator, a three-digit final group means thousands and anything
    else means a decimal point. A lone comma followed by one or two digits is the one shape that
    genuinely cannot be resolved, and it is reported rather than resolved.
    """
    cleaned = text.replace("_", "").replace(" ", "")
    has_comma, has_dot = "," in cleaned, "." in cleaned
    if has_comma and has_dot:
        if cleaned.rfind(",") > cleaned.rfind("."):
            return cleaned.replace(".", "").replace(",", "."), False
        return cleaned.replace(",", ""), False
    if has_comma:
        groups = cleaned.split(",")
        if len(groups) == 2 and len(groups[-1]) <= 2:
            return cleaned, True
        return cleaned.replace(",", ""), False
    return cleaned, False


def _currency(value: Any, key: str, notes: list[str]) -> Any:
    """An amount and its unit. The unit is part of the value, never a note about it."""
    if isinstance(value, dict):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        notes.append(f"{key}: {value!r} carries no currency; amount kept, currency left absent")
        return {"amount": value, "currency": None}

    text = _collapse(value)
    if not text:
        return None

    prefix = _CURRENCY_PREFIX.match(text)
    suffix = _CURRENCY_SUFFIX.match(text)
    code: str | None = None
    rest = text
    if prefix:
        rest = prefix.group("rest")
        code = prefix.group("code") or _SYMBOL_TO_CODE.get(prefix.group("symbol") or "")
        if prefix.group("symbol") in _AMBIGUOUS_SYMBOLS:
            notes.append(f"{key}: {prefix.group('symbol')} read as {code}; the symbol is used by "
                         f"several currencies")
    elif suffix and suffix.group("rest"):
        rest = suffix.group("rest")
        code = suffix.group("code") or _SYMBOL_TO_CODE.get(suffix.group("symbol") or "")

    amount = _number(rest.strip(), key, notes)
    if isinstance(amount, str):
        return {"amount": None, "currency": code, "raw": text}
    if code is None:
        notes.append(f"{key}: {text!r} names no currency; amount kept, currency left absent")
    return {"amount": amount, "currency": code}


def _date(value: Any, key: str, notes: list[str], *, want_time: bool) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    text = _collapse(value)
    if not text:
        return None

    for pattern, handler in (
        (r"^(?P<y>\d{4})-(?P<m>\d{1,2})-(?P<d>\d{1,2})(?:[T ](?P<time>\d{1,2}:\d{2}(?::\d{2})?)"
         r"(?P<offset>Z|[+-]\d{2}:?\d{2})?)?$", _from_parts),
        (r"^(?P<y>\d{4})/(?P<m>\d{1,2})/(?P<d>\d{1,2})$", _from_parts),
        (r"^(?P<d>\d{1,2})\s+(?P<month>[A-Za-z]{3,9})\.?,?\s+(?P<y>\d{4})$", _from_month_name),
        (r"^(?P<month>[A-Za-z]{3,9})\.?\s+(?P<d>\d{1,2}),?\s+(?P<y>\d{4})$", _from_month_name),
        (r"^(?P<month>[A-Za-z]{3,9})\.?\s+(?P<y>\d{4})$", _from_month_only),
    ):
        match = re.match(pattern, text)
        if match:
            parsed = handler(match, want_time)
            if parsed is not None:
                if parsed != text:
                    notes.append(f"{key}: date normalized to {parsed!r}")
                return parsed

    if re.match(r"^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$", text):
        # 03/04/2024 is the 3rd of April or the 4th of March, and picking one would be inventing
        # a fact. The legacy normalizer passed such values through silently; this says so.
        notes.append(f"{key}: {text!r} is an ambiguous day/month order; kept as written")
        return text
    notes.append(f"{key}: {text!r} is not a recognized date; kept as written")
    return text


def _from_parts(match: re.Match[str], want_time: bool) -> str | None:
    year, month, day = int(match.group("y")), int(match.group("m")), int(match.group("d"))
    if not _valid(year, month, day):
        return None
    if not want_time:
        return f"{year:04d}-{month:02d}-{day:02d}"
    time = (match.groupdict().get("time") or "00:00:00").ljust(8, "0")
    offset = match.groupdict().get("offset") or ""
    return f"{year:04d}-{month:02d}-{day:02d}T{time}{'Z' if offset in ('', 'Z') else offset}"


def _from_month_name(match: re.Match[str], want_time: bool) -> str | None:
    month = _MONTHS.get(match.group("month").lower().rstrip("."))
    if month is None:
        return None
    year, day = int(match.group("y")), int(match.group("d"))
    if not _valid(year, month, day):
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def _from_month_only(match: re.Match[str], want_time: bool) -> str | None:
    month = _MONTHS.get(match.group("month").lower().rstrip("."))
    if month is None:
        return None
    year = int(match.group("y"))
    # "March 2024" has no day. Publishing "2024-03-01" would invent one, so the year and month
    # are kept at the precision the source actually gave.
    return f"{year:04d}-{month:02d}"


def _valid(year: int, month: int, day: int) -> bool:
    try:
        datetime(year, month, day)
    except ValueError:
        return False
    return 1900 <= year <= 2200
