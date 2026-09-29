"""The pipeline: one pass, fixed order, every stage reporting what it did.

    normalize → validate → deduplicate → resolve → merge → score

The order is the brief's and `H-ai-service-design.md` §H.6. It runs **once**. The legacy service
executed the whole chain at both its MERGE and its SAVE steps (`workflow-runner.ts:160,164`), so a
plan containing both normalized, validated and deduplicated the same records twice — harmless only
because deduplication happened to be deterministic, and expensive every time.

Every stage is isolated by `_guarded`: an exception is recorded on that stage and the pipeline
continues with the records it has, because losing fuzzy matching is not a reason to throw away
normalization and validation. Normalization is the exception, and not because it matters more — with
no normalized values there is nothing for a later stage to read, so its failure ends the run. What
every stage owes the caller is an account of **what it actually did**: a stage that did not finish
is a `FAILED` entry in the response, never a missing number somebody has to interpret.

Nothing is dropped between stages. The record count leaving the pipeline is the count that entered
it — duplicates are linked, invalid records are flagged, and the report accounts for every one.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Iterable

from app.config import Settings
from app.quality.contracts import (
    Column,
    Dataset,
    QualityReport,
    QualityRequest,
    QualityResult,
    RecordIn,
    RecordOut,
    Row,
    SourceRef,
    StageReport,
)
from app.quality.dedupe import deduplicate
from app.quality.entity_resolution import MERGE, choose_name_field, pick_canonical, resolve
from app.quality.merge import Link, apply_links
from app.quality.normalize import build_field_map, fold_key, normalize_record
from app.quality.score import assess, assign_confidence
from app.quality.validate import evidence_for, validate_record, verification_status

log = logging.getLogger("finalagent.ai.quality")


def process(request: QualityRequest, settings: Settings) -> QualityResult:
    stages: list[StageReport] = []
    warnings: list[str] = []

    field_map = build_field_map(request.fields, request.extraction_schema, request.required_fields)
    records, normalize_stage = _normalize(request.records, field_map, _declared_places(request))
    stages.append(normalize_stage)
    if normalize_stage.status == "FAILED":
        # The one stage whose failure ends the run, and not because it matters more: with no
        # normalized values nothing downstream has anything to read. The reason is returned, and no
        # record set is substituted for the one that could not be produced.
        return QualityResult(status="FAILED", stages=stages, records=records,
                             failure_reason=normalize_stage.error, warnings=warnings)

    required = sorted({fold_key(key) for key in request.required_fields} | field_map.required)
    stages.append(_validate(records, field_map, required, request.validation_rules))

    threshold = request.entity_match_threshold or settings.entity_match_threshold
    max_block = request.max_block_size or settings.quality_max_block_size

    dedupe_stage, links = _deduplicate(records, request.deduplication_keys, max_block)
    stages.append(dedupe_stage)

    resolve_stage, matches = _resolve(records, field_map, threshold, max_block)
    stages.append(resolve_stage)

    stages.append(_merge(records, links, matches, field_map, required, request.validation_rules))

    score_stage, quality = _score(records, required, field_map.keys, request.raw_record_count)
    stages.append(score_stage)

    for stage in stages:
        warnings.extend(stage.notes)
        if stage.status == "FAILED":
            warnings.append(f"the {stage.stage} stage failed: {stage.error}")
    if not records:
        # An empty input is a legitimate outcome of an empty collection and the counts say so. It is
        # not a failure of this service, and it is not a success either.
        warnings.append("the pipeline received no records, so the dataset is empty")

    failed = any(stage.status == "FAILED" for stage in stages)
    status = "COMPLETED_WITH_WARNINGS" if (failed or warnings) else "COMPLETED"

    return QualityResult(status=status, records=records,
                         dataset=build_dataset(records, field_map, required), stages=stages,
                         quality=quality, warnings=warnings,
                         failure_reason=next((stage.error for stage in stages
                                              if stage.status == "FAILED"), None))


def _guarded(stage: StageReport, work: Callable[[], None]) -> StageReport:
    """Run a stage's body, turning any exception into a reported failure instead of a lost stage."""
    try:
        work()
    except Exception as exc:  # noqa: BLE001 - a stage failure is data for the caller
        log.warning("the %s stage failed: %s", stage.stage, exc.__class__.__name__)
        stage.status = "FAILED"
        stage.error = f"{exc.__class__.__name__}: {exc}"
        stage.notes.append(f"the {stage.stage} stage stopped partway; what it had already done "
                           f"stands, and the caller's own gate runs over every record anyway")
    return stage


def _declared_places(request: QualityRequest) -> list[str]:
    """Places named by the run itself, used to canonicalize a place value to the run's spelling."""
    places: list[str] = []
    for rule in request.validation_rules or []:
        params = rule.get("params") if isinstance(rule, dict) else getattr(rule, "params", None)
        if isinstance(params, dict):
            places.extend(str(item) for item in (params.get("places") or []))
    return [place for place in places if place.strip()]


def _normalize(inputs: list[RecordIn], field_map: Any,
               places: list[str]) -> tuple[list[RecordOut], StageReport]:
    records: list[RecordOut] = []
    unmapped: dict[str, int] = {}
    changed = 0
    stage = StageReport(stage="normalize", input_count=len(inputs))

    def work() -> None:
        nonlocal changed
        for index, record in enumerate(inputs):
            normalized = normalize_record(record, field_map, places=places, index=index)
            for key in normalized.unmapped_keys:
                unmapped[key] = unmapped.get(key, 0) + 1
            if normalized.notes:
                changed += 1
            records.append(RecordOut(
                index=index,
                values=normalized.values,
                raw_values=normalized.raw_values,
                sources=[_as_source_ref(source) for source in normalized.sources],
                normalization_notes=normalized.notes,
            ))
        stage.output_count = len(records)
        stage.metrics = {
            "declaredFields": len(field_map.keys),
            "recordsWithChanges": changed,
            "valuesNormalized": sum(len(record.normalization_notes) for record in records),
            "keysOutsideTheContract": dict(sorted(unmapped.items(),
                                                  key=lambda item: -item[1])[:10]),
        }
        if unmapped:
            stage.notes.append(
                f"{sum(unmapped.values())} value(s) arrived under keys the contract does not "
                f"declare ({', '.join(sorted(unmapped)[:5])}); they were kept and reported, not "
                f"dropped")

    return records, _guarded(stage, work)


def _as_source_ref(source: Any) -> SourceRef:
    if isinstance(source, SourceRef):
        return source
    if isinstance(source, dict):
        return SourceRef.model_validate(source)
    return SourceRef(url=str(getattr(source, "url", "") or ""),
                     title=str(getattr(source, "title", "") or ""),
                     snippet=str(getattr(source, "snippet", "") or ""),
                     source_type=str(getattr(source, "source_type", "") or "search"),
                     retrieved_at=getattr(source, "retrieved_at", None),
                     verified_by_tool=bool(getattr(source, "verified_by_tool", False)))


def _validate(records: list[RecordOut], field_map: Any, required: list[str],
              rules: list[Any]) -> StageReport:
    stage = StageReport(stage="validate", input_count=len(records))
    uniqueness: dict[str, set[Any]] = {}
    unexecuted: dict[str, int] = {}
    judged: list[RecordOut] = []

    def work() -> None:
        for record in records:
            outcome = validate_record(record, field_map, required_fields=required, rules=rules,
                                      uniqueness=uniqueness)
            record.issues = outcome.issues
            record.is_valid = outcome.is_valid
            record.evidence = evidence_for(record)
            record.verification_status = verification_status(record)
            judged.append(record)
            for rule in outcome.unexecuted_rules:
                unexecuted[rule] = unexecuted.get(rule, 0) + 1
        stage.output_count = len(records)
        stage.metrics = {
            "validRecords": sum(1 for record in records if record.is_valid),
            "errors": sum(1 for record in records
                          for issue in record.issues if issue.severity == "ERROR"),
            "warnings": sum(1 for record in records
                            for issue in record.issues if issue.severity == "WARNING"),
            "rulesDeclaredButNotExecuted": unexecuted,
        }
        if unexecuted:
            stage.notes.append(
                f"{sum(unexecuted.values())} declared validation rule(s) could not be executed "
                f"({', '.join(sorted(unexecuted))}); they are reported as warnings and were not "
                f"treated as passing")

    _guarded(stage, work)
    if stage.status == "FAILED":
        # A record this stage never judged must not keep the model's default claim that it is valid.
        # Unjudged is reported as unjudged, and counted as not valid, which is the only honest pair
        # of values available for it.
        for record in records[len(judged):]:
            record.is_valid = False
        stage.metrics = {**(stage.metrics or {}), "validatedBeforeFailure": len(judged),
                         "neverValidated": len(records) - len(judged)}
    return stage


def _deduplicate(records: list[RecordOut], keys: list[str],
                 max_block: int) -> tuple[StageReport, list[tuple[int, int, str, str]]]:
    stage = StageReport(stage="deduplicate", input_count=len(records))
    links: list[tuple[int, int, str, str]] = []

    def work() -> None:
        result = deduplicate(records, keys, max_block_size=max_block)
        stage.output_count = len(records)
        stage.metrics = result.metrics()
        stage.notes.extend(result.notes)
        for block in result.oversized_blocks:
            stage.notes.append(f"deduplication block {block} exceeded the {max_block}-record bound "
                               f"and was left uncompared rather than turned into a quadratic scan")
        links.extend(result.links)

    return _guarded(stage, work), links


def _resolve(records: list[RecordOut], field_map: Any, threshold: float,
             max_block: int) -> tuple[StageReport, list[Any]]:
    stage = StageReport(stage="resolve", input_count=len(records))
    matches: list[Any] = []

    def work() -> None:
        name_field = choose_name_field(records, list(field_map.keys))
        result, found = resolve(records, name_field=name_field, threshold=threshold,
                                max_block_size=max_block)
        stage.output_count = len(records)
        stage.metrics = {**result.metrics(), "threshold": threshold}
        stage.notes.extend(result.notes)
        for block in result.oversized_blocks:
            stage.notes.append(f"entity block {block} exceeded the {max_block}-record bound and "
                               f"was left uncompared")
        matches.extend(found)

    return _guarded(stage, work), matches


def _links(dedupe_links: list[tuple[int, int, str, str]],
           matches: list[Any]) -> list[Link]:
    links = [Link(canonical_index=canonical, duplicate_index=duplicate, match_type=match_type,
                  reason=reason)
             for canonical, duplicate, match_type, reason in dedupe_links]
    for record, candidate in matches:
        if candidate.decision != MERGE:
            continue
        canonical = pick_canonical(record, candidate.other)
        duplicate = candidate.other if canonical.index == record.index else record
        links.append(Link(canonical_index=canonical.index, duplicate_index=duplicate.index,
                          match_type="ENTITY", reason=",".join(candidate.matched_identifiers[:3])))
    return links


def _merge(records: list[RecordOut], dedupe_links: list[tuple[int, int, str, str]],
           matches: list[Any], field_map: Any, required: list[str],
           rules: list[Any]) -> StageReport:
    links = _links(dedupe_links, matches)
    stage = StageReport(stage="merge", input_count=len(records))

    def work() -> None:
        result = apply_links(records, links)

        # A merge fills fields that were missing and records conflicts, so the verdict on every
        # record it touched is recomputed rather than left describing a row that no longer exists.
        touched = {index for link in links
                   for index in (link.canonical_index, link.duplicate_index)}
        uniqueness: dict[str, set[Any]] = {}
        revalidated = 0
        for record in records:
            if record.index not in touched:
                continue
            outcome = validate_record(record, field_map, required_fields=required, rules=rules,
                                      uniqueness=uniqueness)
            record.issues = outcome.issues
            record.is_valid = outcome.is_valid
            record.evidence = evidence_for(record)
            record.verification_status = verification_status(record)
            revalidated += 1

        stage.output_count = len(records)
        stage.metrics = {**result.metrics(), "linksApplied": len(links),
                         "revalidatedRecords": revalidated}
        stage.notes.extend(result.notes)

    return _guarded(stage, work)


def _score(records: list[RecordOut], required: list[str], declared: list[str],
           raw_count: int | None) -> tuple[StageReport, QualityReport]:
    stage = StageReport(stage="score", input_count=len(records))
    measured: list[QualityReport] = []

    def work() -> None:
        formula = assign_confidence(records)
        report, _ = assess(records, required_fields=required, declared_fields=declared,
                           raw_count=raw_count)
        measured.append(report)
        stage.output_count = len(records)
        stage.metrics = {
            "qualityScore": report.quality_score,
            "dimensions": report.score_components,
            "scoreBasis": report.score_basis,
            "recordConfidenceFormula": formula,
        }
        if raw_count is None:
            stage.notes.append(
                "the caller did not say how many records it sent, so rawCount is the number this "
                "service received and any earlier loss is not visible here")
        if report.quality_score is None:
            stage.notes.append("no score was computed: there are no records to score")

    _guarded(stage, work)
    if measured:
        return stage, measured[0]
    # A withheld report is worse than an incomplete one: the caller would have to guess whether the
    # counts were zero or never computed.
    return stage, QualityReport(raw_count=raw_count if raw_count is not None else len(records),
                                normalized_count=len(records),
                                metrics={"reportIncomplete": "the score stage did not finish"})


def build_dataset(records: list[RecordOut], field_map: Any, required: Iterable[str]) -> Dataset:
    """The final dataset: declared columns, and one row per canonical record.

    Linked duplicates are not rows — they stay in `records`, pointed at by `duplicate_of`, which is
    the difference between "deduplicated" and "deleted". Invalid records are still rows, flagged,
    because the caller decides what a dataset may contain.
    """
    required_keys = {fold_key(key) for key in required}
    columns: list[Column] = []
    for position, key in enumerate(field_map.keys):
        columns.append(Column(key=key, label=field_map.labels.get(key, key),
                              type=field_map.types.get(key, "STRING"),
                              required=key in field_map.required or key in required_keys,
                              position=position))
    known = {column.key for column in columns}
    # A column the contract did not declare but the data contains is still a column: dropping it
    # here would be the silent loss this pipeline exists to prevent.
    for key in sorted({key for record in records for key in record.values} - known):
        columns.append(Column(key=key, label=key, type=field_map.types.get(key, "STRING"),
                              required=False, position=len(columns)))

    rows = [Row(record_index=record.index, values=record.values)
            for record in records if record.duplicate_of is None]
    return Dataset(columns=columns, rows=rows)
