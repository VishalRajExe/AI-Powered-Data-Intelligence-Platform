"""Validation: does each record satisfy the contract it was collected against?

Advisory by design. Java re-checks required fields, types and evidence before anything is
persisted (`A-final-architecture.md` §A.2: "Python proposes, Java disposes"), so a bug here can
cost a re-run but cannot put an unchecked row in a dataset.

Two behaviours are ported deliberately from `ValidationService.ts`:

* Unimplemented rules are **downgraded to a WARNING that names them**, never silently passed
  (`:63`). A plan that asked for a rule this service cannot execute gets told, in the report,
  rather than getting a green tick.
* A record with no tool-observed source is flagged, not quietly accepted (`:17,26-30`).

One is fixed: the legacy validator overwrote `record.sourceUrls` with only the verified subset
(`:26,:84`), destroying the evidence that a record had cited something nobody fetched. Sources are
read here and never rewritten — the unverified ones stay visible, because "the model claimed a URL
we never saw" is exactly the fact a reviewer needs.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.contracts import QualityIssue
from app.quality.contracts import (
    VERIFICATION_CONFLICTED,
    VERIFICATION_SOURCE_CITED,
    VERIFICATION_UNSUPPORTED,
    VERIFICATION_UNVERIFIED,
    Evidence,
    RecordOut,
)
from app.quality.normalize import FieldMap, fold_key

EMAIL = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")
URL = re.compile(r"^https?://[^\s/$.?#].[^\s]*$", re.IGNORECASE)
DATE_FULL = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# A source that gave only a year or only a month is less precise than one that gave a day, and
# saying so is better than either rejecting it or inventing the missing part. A complete ISO date
# must satisfy this too: it is the most precise form, not an exception.
DATE_PARTIAL = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")
DATETIME = re.compile(r"^\d{4}-\d{2}(-\d{2})?[T ]\d{2}:\d{2}")
CURRENCY_CODE = re.compile(r"^[A-Z]{3}$")

ERROR = "ERROR"
WARNING = "WARNING"
INFO = "INFO"

# Rule codes this service can actually execute. Anything else becomes a WARNING naming the rule,
# which is the honest downgrade the legacy validator already did for RANGE and CUSTOM.
SUPPORTED_RULES = frozenset({
    "required", "not_empty", "type", "format", "url", "email", "date", "enum", "in",
    "min", "max", "range", "between", "regex", "matches", "length", "unique", "country",
})


@dataclass(slots=True)
class ValidationOutcome:
    issues: list[QualityIssue] = field(default_factory=list)
    unexecuted_rules: list[str] = field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return not any(issue.severity == ERROR for issue in self.issues)

    def error_count(self) -> int:
        return sum(1 for issue in self.issues if issue.severity == ERROR)

    def warning_count(self) -> int:
        return sum(1 for issue in self.issues if issue.severity == WARNING)


def evidence_for(record: RecordOut) -> Evidence:
    """Counts only. A record's backing is a fact about its sources, not a formula over them."""
    verified = [source for source in record.sources if source.verified_by_tool]
    unverified = [source for source in record.sources if not source.verified_by_tool]
    domains = {fold_key(_host(source.url)) for source in record.sources if source.url}
    return Evidence(
        source_count=len(record.sources),
        verified_source_count=len(verified),
        unverified_source_count=len(unverified),
        distinct_domains=len({domain for domain in domains if domain}),
        fields_with_evidence=_fields_with_own_source(record),
    )


def _host(url: str) -> str:
    try:
        from urllib.parse import urlsplit

        return urlsplit(url if "//" in url else f"//{url}").hostname or ""
    except ValueError:
        return ""


def _fields_with_own_source(record: RecordOut) -> int:
    """A field carries its own evidence only when the producer said which source it came from.

    The extraction stage returns record-level sources, so today this counts fields whose value is
    itself a URL the run observed — a citation column. Field-level attribution is never inferred
    from a snippet here: that is `SnippetVerifier`'s job in the provenance phase, and doing it in
    two places would give two answers.
    """
    observed = {_canonical(source.url) for source in record.sources if source.verified_by_tool}
    if not observed:
        return 0
    count = 0
    for value in record.values.values():
        if isinstance(value, str) and _canonical(value) in observed:
            count += 1
    return count


def _canonical(url: str) -> str:
    from app.curation.canonical import canonical_key

    return canonical_key(url)


def verification_status(record: RecordOut) -> str:
    """The four states the schema allows, derived from what was actually observed."""
    if record.conflicts:
        return VERIFICATION_CONFLICTED
    if not record.sources:
        return VERIFICATION_UNSUPPORTED
    if any(source.verified_by_tool for source in record.sources):
        return VERIFICATION_SOURCE_CITED
    return VERIFICATION_UNVERIFIED


def validate_record(record: RecordOut, field_map: FieldMap, *, required_fields: list[str],
                    rules: list[Any], uniqueness: dict[str, set[Any]] | None = None) -> ValidationOutcome:
    outcome = ValidationOutcome()

    for key in required_fields:
        folded = fold_key(key)
        if _is_absent(record.values.get(folded)):
            outcome.issues.append(QualityIssue(rule_code="REQUIRED", severity=ERROR, field_key=folded,
                                               message=f"required field {folded!r} is absent or empty"))

    declared = set(field_map.types)
    for key, value in record.values.items():
        if declared and key not in declared:
            # Reported, not removed: an extra column is a contract mismatch the caller decides on.
            outcome.issues.append(QualityIssue(
                rule_code="EXTRA_FIELD", severity=WARNING, field_key=key,
                message=f"{key!r} is not declared by the extraction schema or the requirement"))
        if value is None:
            continue
        outcome.issues.extend(_type_issues(key, value, field_map.types.get(key, "STRING")))

    for rule in rules or []:
        outcome.issues.extend(_apply_rule(rule, record, field_map, uniqueness))
        if not _rule_executed(rule):
            outcome.unexecuted_rules.append(_rule_name(rule))

    if not record.sources:
        outcome.issues.append(QualityIssue(
            rule_code="SOURCE_EVIDENCE", severity=ERROR,
            message="the record cites no source at all, so nothing about it can be checked"))
    elif not any(source.verified_by_tool for source in record.sources):
        outcome.issues.append(QualityIssue(
            rule_code="SOURCE_EVIDENCE_UNVERIFIED", severity=WARNING,
            message="every source this record cites was reported by the model and never returned "
                    "by a tool during the run"))
    return outcome


def _is_absent(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, dict)):
        return not value
    return False


def _type_issues(key: str, value: Any, field_type: str) -> list[QualityIssue]:
    issues: list[QualityIssue] = []

    def wrong(expected: str) -> QualityIssue:
        return QualityIssue(rule_code="TYPE", severity=ERROR, field_key=key,
                            message=f"{key!r} should be {expected}, found "
                                    f"{type(value).__name__}: {str(value)[:120]!r}")

    if field_type == "NUMBER":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            issues.append(wrong("a number"))
    elif field_type == "BOOLEAN":
        if not isinstance(value, bool):
            issues.append(wrong("a boolean"))
    elif field_type == "STRING":
        if not isinstance(value, str):
            issues.append(wrong("a string"))
    elif field_type == "URL":
        if not isinstance(value, str) or not URL.match(value):
            issues.append(QualityIssue(rule_code="FORMAT_URL", severity=ERROR, field_key=key,
                                       message=f"{key!r} is not an absolute http(s) URL: "
                                               f"{str(value)[:160]!r}"))
    elif field_type == "EMAIL":
        if not isinstance(value, str) or not EMAIL.match(value):
            issues.append(QualityIssue(rule_code="FORMAT_EMAIL", severity=ERROR, field_key=key,
                                       message=f"{key!r} is not a usable email address: "
                                               f"{str(value)[:160]!r}"))
    elif field_type == "DATE":
        if not isinstance(value, str) or not DATE_PARTIAL.match(value):
            issues.append(QualityIssue(rule_code="FORMAT_DATE", severity=ERROR, field_key=key,
                                       message=f"{key!r} is not an ISO date: {str(value)[:80]!r}"))
        elif not DATE_FULL.match(value):
            issues.append(QualityIssue(
                rule_code="DATE_PRECISION", severity=INFO, field_key=key,
                message=f"{key!r} is {value!r}: the source gave less than a full day, and the "
                        f"missing part was not invented"))
    elif field_type == "DATETIME":
        if not isinstance(value, str) or not (DATETIME.match(value) or DATE_PARTIAL.match(value)):
            issues.append(QualityIssue(rule_code="FORMAT_DATETIME", severity=ERROR, field_key=key,
                                       message=f"{key!r} is not an ISO date-time: "
                                               f"{str(value)[:80]!r}"))
    elif field_type == "CURRENCY":
        if not isinstance(value, dict):
            issues.append(wrong("an amount with its currency"))
        elif value.get("raw") is not None:
            # Normalization gave up on this value and kept the text. The record is not thereby
            # invalid — a missing price is a gap, not a lie — but a reader must be able to see that
            # the gap came from an unresolvable number rather than from an empty source.
            issues.append(QualityIssue(
                rule_code="CURRENCY_UNREADABLE", severity=WARNING, field_key=key,
                message=f"{key!r} could not be read as an amount: {str(value.get('raw'))[:80]!r} "
                        f"was left as written rather than guessed"))
        else:
            amount = value.get("amount")
            if amount is not None and (isinstance(amount, bool) or not isinstance(amount, (int, float))):
                issues.append(QualityIssue(rule_code="TYPE", severity=ERROR, field_key=key,
                                           message=f"{key!r} has a non-numeric amount: {amount!r}"))
            code = value.get("currency")
            if code is None:
                issues.append(QualityIssue(
                    rule_code="CURRENCY_CODE_MISSING", severity=WARNING, field_key=key,
                    message=f"{key!r} has an amount with no currency; one was not assumed"))
            elif not CURRENCY_CODE.match(str(code)):
                issues.append(QualityIssue(rule_code="CURRENCY_CODE", severity=ERROR, field_key=key,
                                           message=f"{key!r} carries {code!r}, which is not an "
                                                   f"ISO-4217 three-letter code"))
    return issues


def _rule_name(rule: Any) -> str:
    if isinstance(rule, dict):
        return str(rule.get("rule", ""))
    return str(getattr(rule, "rule", ""))


def _rule_field(rule: Any) -> str | None:
    value = rule.get("field") if isinstance(rule, dict) else getattr(rule, "field", None)
    return fold_key(value) if value else None


def _rule_params(rule: Any) -> dict[str, Any]:
    value = rule.get("params") if isinstance(rule, dict) else getattr(rule, "params", None)
    return value if isinstance(value, dict) else {}


def _rule_executed(rule: Any) -> bool:
    return _rule_name(rule).strip().lower() in SUPPORTED_RULES


def _apply_rule(rule: Any, record: RecordOut, field_map: FieldMap,
                uniqueness: dict[str, set[Any]] | None) -> list[QualityIssue]:
    name = _rule_name(rule).strip().lower()
    key = _rule_field(rule)
    params = _rule_params(rule)
    if not name:
        return [QualityIssue(rule_code="RULE_UNNAMED", severity=WARNING,
                             message="a validation rule was declared with no rule code, so it was "
                                     "not executed")]
    if name not in SUPPORTED_RULES:
        return [QualityIssue(rule_code="RULE_NOT_EXECUTED", severity=WARNING, field_key=key,
                             message=f"validation rule {name!r} is not implemented by this service "
                                     f"and was not executed; it was not treated as passing")]

    value = record.values.get(key) if key else None
    if name in {"required", "not_empty"} and key:
        if _is_absent(value):
            return [QualityIssue(rule_code=name.upper(), severity=ERROR, field_key=key,
                                 message=f"rule {name!r} failed: {key!r} is absent or empty")]
        return []
    if _is_absent(value):
        # A rule about a value that is not there is the REQUIRED rule's business, not this one's.
        return []

    if name == "type":
        expected = str(params.get("type", field_map.types.get(key or "", "STRING"))).upper()
        return _type_issues(key or "", value, expected)
    if name in {"url", "email", "date"}:
        return _type_issues(key or "", value, {"url": "URL", "email": "EMAIL", "date": "DATE"}[name])
    if name in {"enum", "in"}:
        allowed = params.get("values") or params.get("enum") or []
        if allowed and value not in allowed:
            return [QualityIssue(rule_code="ENUM", severity=ERROR, field_key=key,
                                 message=f"{key!r} is {value!r}, which is not one of {allowed}")]
        return []
    if name in {"min", "max", "range", "between"}:
        return _range_issues(name, key, value, params)
    if name in {"regex", "matches"}:
        pattern = params.get("pattern") or params.get("regex")
        if not pattern:
            return [QualityIssue(rule_code="RULE_NOT_EXECUTED", severity=WARNING, field_key=key,
                                 message=f"rule {name!r} declared no pattern, so it was not executed")]
        try:
            if not re.search(str(pattern), str(value)):
                return [QualityIssue(rule_code="REGEX", severity=ERROR, field_key=key,
                                     message=f"{key!r} does not match /{pattern}/")]
        except re.error as exc:
            return [QualityIssue(rule_code="RULE_NOT_EXECUTED", severity=WARNING, field_key=key,
                                 message=f"rule {name!r} has an unusable pattern ({exc}); it was "
                                         f"not executed")]
        return []
    if name == "length":
        return _length_issues(key, value, params)
    if name == "unique":
        return _unique_issues(key, value, params, uniqueness)
    if name == "country":
        return _country_issues(key, value, params)
    if name == "format":
        declared = str(params.get("format", field_map.types.get(key or "", "STRING"))).upper()
        return _type_issues(key or "", value, declared)
    return []


def _range_issues(name: str, key: str | None, value: Any, params: dict[str, Any]) -> list[QualityIssue]:
    if isinstance(value, dict):
        value = value.get("amount")
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return [QualityIssue(rule_code="RANGE", severity=WARNING, field_key=key,
                             message=f"rule {name!r} could not be applied to a non-numeric "
                                     f"{key!r}: {str(value)[:80]!r}")]
    low = params.get("min", params.get("from", params.get("gte")))
    high = params.get("max", params.get("to", params.get("lte")))
    if name in {"min"} and low is None:
        low = params.get("value")
    if name in {"max"} and high is None:
        high = params.get("value")
    if low is not None and _number(low) is not None and value < _number(low):
        return [QualityIssue(rule_code="RANGE", severity=ERROR, field_key=key,
                             message=f"{key!r} is {value}, below the declared minimum {low}")]
    if high is not None and _number(high) is not None and value > _number(high):
        return [QualityIssue(rule_code="RANGE", severity=ERROR, field_key=key,
                             message=f"{key!r} is {value}, above the declared maximum {high}")]
    return []


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _length_issues(key: str | None, value: Any, params: dict[str, Any]) -> list[QualityIssue]:
    length = len(value) if isinstance(value, (str, list, dict)) else len(str(value))
    low, high = params.get("min"), params.get("max")
    if low is not None and length < int(low):
        return [QualityIssue(rule_code="LENGTH", severity=ERROR, field_key=key,
                             message=f"{key!r} is {length} long, below the minimum {low}")]
    if high is not None and length > int(high):
        return [QualityIssue(rule_code="LENGTH", severity=ERROR, field_key=key,
                             message=f"{key!r} is {length} long, above the maximum {high}")]
    return []


def _unique_issues(key: str | None, value: Any, params: dict[str, Any],
                   uniqueness: dict[str, set[Any]] | None) -> list[QualityIssue]:
    if not key or uniqueness is None:
        return [QualityIssue(rule_code="RULE_NOT_EXECUTED", severity=WARNING, field_key=key,
                             message="a uniqueness rule needs the whole record set, which this "
                                     "call did not receive; it was not executed")]
    seen = uniqueness.setdefault(key, set())
    identity = value if not isinstance(value, str) else value.strip().casefold()
    if identity in seen:
        return [QualityIssue(rule_code="UNIQUE", severity=ERROR, field_key=key,
                             message=f"{key!r} repeats the value {str(value)[:80]!r} declared unique")]
    seen.add(identity)
    return []


def _country_issues(key: str | None, value: Any, params: dict[str, Any]) -> list[QualityIssue]:
    allowed = [str(item).strip().casefold() for item in (params.get("places") or [])]
    if not allowed:
        return [QualityIssue(rule_code="RULE_NOT_EXECUTED", severity=WARNING, field_key=key,
                             message="a country rule declared no places to check against, so it was "
                                     "not executed rather than assumed to pass")]
    if str(value).strip().casefold() not in allowed:
        return [QualityIssue(rule_code="COUNTRY", severity=WARNING, field_key=key,
                             message=f"{key!r} is {str(value)!r}, outside the places this run "
                                     f"declared ({', '.join(sorted(set(allowed))[:6])})")]
    return []
