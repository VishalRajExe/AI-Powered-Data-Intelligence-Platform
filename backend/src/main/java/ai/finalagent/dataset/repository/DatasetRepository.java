package ai.finalagent.dataset.repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import javax.sql.DataSource;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import ai.finalagent.dataset.domain.DatasetDraft;
import ai.finalagent.dataset.domain.DatasetRows.Dataset;
import ai.finalagent.workflow.support.Json;

/**
 * Writing and reading datasets.
 *
 * <p>One draft, one transaction. The header is upserted on {@code run_id} and every child collection
 * is deleted and re-inserted inside the same transaction, which is what makes the save step
 * replayable: a job reclaimed after a crash, or a step re-executed, replaces its own dataset instead
 * of leaving a second copy or a half-written one. No reader can see the intermediate state, because
 * the delete and the inserts commit together.
 *
 * <p>Row-level counts come from the lists being written, and citation counts are recomputed by the
 * database from the join afterwards. Those are two different things and both are stated: the first
 * cannot drift from the insert that produced it, and the second cannot drift from the rows that
 * actually exist. What is <em>not</em> copied in is the run's own report of its totals — the pipeline
 * numbers stay in the step summary where they were measured, and a dataset that disagreed with its
 * own rows would be a second, quieter source of truth.
 */
@Repository
public class DatasetRepository {

    private final JdbcTemplate jdbc;

    public DatasetRepository(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    /**
     * Writes the draft under a caller-chosen id, replacing whatever that run saved before.
     *
     * <p>The id is minted by the save step, not here, so a replay of the same step keeps the dataset
     * id a caller may already have linked to — the unique key on {@code run_id} is what turns a
     * second execution into an update rather than a duplicate.
     */
    @Transactional
    public void save(String datasetId, DatasetDraft draft) {
        upsertHeader(datasetId, draft);
        clearChildren(datasetId);
        insertColumns(datasetId, draft);
        Map<String, String> sourceIds = insertSources(datasetId, draft);
        Map<Integer, String> rowIds = insertRows(datasetId, draft);
        linkDuplicates(datasetId, draft, rowIds);
        connectRowSources(datasetId, draft, rowIds, sourceIds);
        insertFieldEvidence(datasetId, draft, rowIds, sourceIds);
        insertConflicts(datasetId, draft, rowIds);
        refreshCitationCounts(datasetId);
    }

    private static final RowMapper<Dataset> DATASET_ROW = DatasetRepository::mapDataset;

    private static Dataset mapDataset(ResultSet rs, int n) throws SQLException {
        return new Dataset(rs.getString("id"), rs.getString("workspace_id"), rs.getString("run_id"),
                rs.getString("workflow_id"), rs.getString("plan_id"), rs.getString("step_id"),
                rs.getString("objective"), rs.getString("requirement_text"),
                rs.getString("entity_type"), rs.getString("extraction_schema"), rs.getString("status"),
                rs.getInt("row_count"), rs.getInt("valid_row_count"), rs.getInt("invalid_row_count"),
                rs.getInt("duplicate_count"), rs.getInt("conflict_count"), rs.getInt("source_count"),
                rs.getInt("verified_source_count"), rs.getInt("unverified_source_count"),
                rs.getInt("blocked_source_count"), rs.getInt("records_without_evidence"),
                decimal(rs.getBigDecimal("quality_score")), rs.getString("quality_basis"),
                rs.getString("quality_json"), rs.getString("error_code"), rs.getString("error_message"),
                instant(rs.getTimestamp("created_at")), instant(rs.getTimestamp("updated_at")));
    }

    private static Double decimal(BigDecimal value) {
        return value == null ? null : value.doubleValue();
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    private void upsertHeader(String datasetId, DatasetDraft draft) {
        DatasetDraft.Header header = draft.header();
        jdbc.update("""
                INSERT INTO datasets
                  (id, workspace_id, run_id, workflow_id, plan_id, step_id, objective,
                   requirement_text, entity_type, extraction_schema, status,
                   row_count, valid_row_count, invalid_row_count, duplicate_count, conflict_count,
                   source_count, verified_source_count, unverified_source_count,
                   blocked_source_count, records_without_evidence, quality_score, quality_json,
                   quality_basis)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        CAST(? AS JSON), ?)
                ON DUPLICATE KEY UPDATE
                  workflow_id = VALUES(workflow_id), plan_id = VALUES(plan_id),
                  step_id = VALUES(step_id), objective = VALUES(objective),
                  requirement_text = VALUES(requirement_text), entity_type = VALUES(entity_type),
                  extraction_schema = VALUES(extraction_schema), status = VALUES(status),
                  row_count = VALUES(row_count), valid_row_count = VALUES(valid_row_count),
                  invalid_row_count = VALUES(invalid_row_count), duplicate_count = VALUES(duplicate_count),
                  conflict_count = VALUES(conflict_count), source_count = VALUES(source_count),
                  verified_source_count = VALUES(verified_source_count),
                  unverified_source_count = VALUES(unverified_source_count),
                  blocked_source_count = VALUES(blocked_source_count),
                  records_without_evidence = VALUES(records_without_evidence),
                  quality_score = VALUES(quality_score), quality_json = VALUES(quality_json),
                  quality_basis = VALUES(quality_basis)
                """, datasetId, header.workspaceId(), header.runId(), header.workflowId(),
                header.planId(), header.stepId(), header.objective(), header.requirementText(),
                header.entityType(), header.extractionSchemaJson(), header.status(),
                draft.rowCount(), draft.validRowCount(), draft.invalidRowCount(),
                draft.duplicateCount(), draft.conflictCount(), draft.sourceCount(),
                draft.verifiedSourceCount(), draft.unverifiedSourceCount(), draft.blockedSourceCount(),
                draft.recordsWithoutEvidence(), header.qualityScore(), header.qualityJson(),
                header.qualityBasis());
    }

    private void clearChildren(String datasetId) {
        jdbc.update("DELETE FROM dataset_conflicts WHERE dataset_id = ?", datasetId);
        jdbc.update("DELETE FROM dataset_field_evidence WHERE dataset_id = ?", datasetId);
        jdbc.update("DELETE FROM dataset_row_sources WHERE dataset_id = ?", datasetId);
        // Rows first would break the evidence and conflict inserts below, which reference ids that
        // still have to exist; children are deleted leaf-up and never cascaded from here.
        jdbc.update("DELETE FROM dataset_sources WHERE dataset_id = ?", datasetId);
        jdbc.update("DELETE FROM dataset_columns WHERE dataset_id = ?", datasetId);
        jdbc.update("DELETE FROM dataset_rows WHERE dataset_id = ?", datasetId);
    }

    private void insertColumns(String datasetId, DatasetDraft draft) {
        for (DatasetDraft.DraftColumn column : draft.columns()) {
            jdbc.update("""
                    INSERT INTO dataset_columns
                      (id, dataset_id, workspace_id, field_key, label, type, required, position,
                       origin, description, populated_count)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, UUID.randomUUID().toString(), datasetId, draft.header().workspaceId(),
                    column.fieldKey(), column.label(), column.type(), column.required() ? 1 : 0,
                    column.position(), column.origin(), column.description(), column.populatedCount());
        }
    }

    private Map<String, String> insertSources(String datasetId, DatasetDraft draft) {
        Map<String, String> idsByHash = new HashMap<>();
        for (DatasetDraft.DraftSource source : draft.sources()) {
            String id = UUID.randomUUID().toString();
            idsByHash.put(source.urlHash(), id);
            jdbc.update("""
                    INSERT INTO dataset_sources
                      (id, dataset_id, workspace_id, run_id, step_id, url, url_hash, domain, title,
                       snippet, source_type, retrieved_at, verified_by_tool, provenance,
                       blocked_code, blocked_reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, id, datasetId, draft.header().workspaceId(), draft.header().runId(),
                    draft.header().stepId(), source.url(), source.urlHash(), source.domain(),
                    truncate(source.title(), 500), source.snippet(), source.sourceType(),
                    asTimestamp(source.retrievedAt()), source.verifiedByTool() ? 1 : 0,
                    source.provenance(), source.blockedCode(), truncate(source.blockedReason(), 1000));
        }
        return idsByHash;
    }

    private Map<Integer, String> insertRows(String datasetId, DatasetDraft draft) {
        Map<Integer, String> idsByIndex = new HashMap<>();
        for (DatasetDraft.DraftRow row : draft.rows()) {
            String id = UUID.randomUUID().toString();
            idsByIndex.put(row.recordIndex(), id);
            jdbc.update("""
                    INSERT INTO dataset_rows
                      (id, dataset_id, workspace_id, run_id, step_id, record_index, values_json,
                       raw_values_json, search_text, valid, advisory_valid, verification_status,
                       confidence, match_type, duplicate_key, review_required, review_reasons,
                       issues, normalization_notes, conflict_count, source_count,
                       verified_source_count, populated_field_count, evidenced_field_count)
                    VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?,
                            ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?, ?)
                    """, id, datasetId, draft.header().workspaceId(), draft.header().runId(),
                    draft.header().stepId(), row.recordIndex(), Json.write(row.values()),
                    Json.write(row.rawValues()), row.searchText(), row.valid() ? 1 : 0,
                    row.advisoryValid() ? 1 : 0, row.verificationStatus(), row.confidence(),
                    row.matchType(), truncate(row.duplicateKey(), 200), row.reviewRequired() ? 1 : 0,
                    Json.write(row.reviewReasons()), Json.write(row.issues()),
                    Json.write(row.normalizationNotes()), row.conflicts().size(),
                    row.sourceUrlHashes().size(), verifiedSources(row, draft),
                    row.populatedFieldCount(), row.evidencedFieldCount());
        }
        return idsByIndex;
    }

    private static int verifiedSources(DatasetDraft.DraftRow row, DatasetDraft draft) {
        Map<String, Boolean> verified = new HashMap<>();
        draft.sources().forEach(source -> verified.put(source.urlHash(), source.verifiedByTool()));
        return (int) row.sourceUrlHashes().stream()
                .filter(hash -> Boolean.TRUE.equals(verified.get(hash))).count();
    }

    /**
     * A duplicate points at the canonical row the same save inserted.
     *
     * <p>An index that resolves to nothing is an error, not something to route around: silently
     * dropping the link would leave the row readable as though it were canonical, which is how a
     * dataset comes to count one entity twice.
     */
    private void linkDuplicates(String datasetId, DatasetDraft draft, Map<Integer, String> rowIds) {
        for (DatasetDraft.DraftRow row : draft.rows()) {
            if (row.duplicateOfRecordIndex() == null) {
                continue;
            }
            String rowId = rowIds.get(row.recordIndex());
            String canonicalId = rowIds.get(row.duplicateOfRecordIndex());
            if (canonicalId == null) {
                throw new IllegalStateException("dataset " + datasetId + ": record " + row.recordIndex()
                        + " links to record " + row.duplicateOfRecordIndex() + ", which the result does"
                        + " not contain");
            }
            jdbc.update("UPDATE dataset_rows SET duplicate_of_row_id = ? WHERE id = ?", canonicalId,
                    rowId);
        }
    }

    private void connectRowSources(String datasetId, DatasetDraft draft, Map<Integer, String> rowIds,
                                   Map<String, String> sourceIds) {
        for (DatasetDraft.DraftRow row : draft.rows()) {
            String rowId = rowIds.get(row.recordIndex());
            for (String urlHash : row.sourceUrlHashes()) {
                String sourceId = sourceIds.get(urlHash);
                if (sourceId == null) {
                    throw new IllegalStateException("dataset " + datasetId + ": record "
                            + row.recordIndex() + " cites a source that was not written: " + urlHash);
                }
                jdbc.update("""
                        INSERT INTO dataset_row_sources
                          (id, dataset_id, workspace_id, row_id, source_id, cited_by_record)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """, UUID.randomUUID().toString(), datasetId, draft.header().workspaceId(),
                        rowId, sourceId, 1);
            }
        }
    }

    /**
     * Field-level attributions only. {@code INSERT IGNORE} because the unique key is
     * (row, column, source, kind) and two different fields can legitimately point at the same page —
     * a repeat of the same attribution is a replay, not a second fact.
     */
    private void insertFieldEvidence(String datasetId, DatasetDraft draft, Map<Integer, String> rowIds,
                                     Map<String, String> sourceIds) {
        for (DatasetDraft.DraftRow row : draft.rows()) {
            String rowId = rowIds.get(row.recordIndex());
            for (DatasetDraft.DraftEvidence evidence : row.fieldEvidence()) {
                String sourceId = sourceIds.get(evidence.urlHash());
                if (sourceId == null) {
                    continue;
                }
                jdbc.update("""
                        INSERT IGNORE INTO dataset_field_evidence
                          (id, dataset_id, workspace_id, row_id, column_key, source_id, kind,
                           field_value)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """, UUID.randomUUID().toString(), datasetId, draft.header().workspaceId(),
                        rowId, evidence.columnKey(), sourceId, evidence.kind(),
                        truncate(evidence.fieldValue(), 500));
            }
        }
    }

    private void insertConflicts(String datasetId, DatasetDraft draft, Map<Integer, String> rowIds) {
        for (DatasetDraft.DraftRow row : draft.rows()) {
            String rowId = rowIds.get(row.recordIndex());
            for (DatasetDraft.DraftConflict conflict : row.conflicts()) {
                jdbc.update("""
                        INSERT INTO dataset_conflicts
                          (id, dataset_id, workspace_id, row_id, column_key, kept_value_json,
                           rejected_value_json, kept_sources_json, rejected_sources_json, resolved_by)
                        VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON),
                                CAST(? AS JSON), ?)
                        """, UUID.randomUUID().toString(), datasetId, draft.header().workspaceId(),
                        rowId, conflict.columnKey(), Json.write(conflict.keptValue()),
                        Json.write(conflict.rejectedValue()), Json.write(conflict.keptSourceUrls()),
                        Json.write(conflict.rejectedSourceUrls()), conflict.resolvedBy());
            }
        }
    }

    /**
     * Citation counts, derived by the database from the join rather than carried in from the run's
     * report. A page that was retrieved and then not used says so here, with {@code citedByRows} 0 —
     * which is a fact about the run, not a rounding error.
     */
    private void refreshCitationCounts(String datasetId) {
        jdbc.update("""
                UPDATE dataset_sources s
                   SET s.citation_count = (SELECT COUNT(*) FROM dataset_row_sources rs
                                            WHERE rs.source_id = s.id),
                       s.cited_by_rows  = (SELECT COUNT(DISTINCT rs.row_id) FROM dataset_row_sources rs
                                            WHERE rs.source_id = s.id)
                 WHERE s.dataset_id = ?
                """, datasetId);
    }

    // ---------------------------------------------------------------------- reads

    public Optional<Dataset> findById(String workspaceId, String datasetId) {
        return jdbc.query("SELECT * FROM datasets WHERE id = ? AND workspace_id = ?", DATASET_ROW,
                datasetId, workspaceId).stream().findFirst();
    }

    public Optional<Dataset> findByRun(String workspaceId, String runId) {
        return jdbc.query("SELECT * FROM datasets WHERE run_id = ? AND workspace_id = ?", DATASET_ROW,
                runId, workspaceId).stream().findFirst();
    }

    public List<Dataset> list(String workspaceId, String status, String workflowId, int limit,
                              int offset) {
        Query filter = scope(workspaceId, status, workflowId);
        List<Object> args = new ArrayList<>(filter.args());
        args.add(limit);
        args.add(offset);
        return jdbc.query("SELECT * FROM datasets WHERE " + filter.where()
                + " ORDER BY created_at DESC, id LIMIT ? OFFSET ?", DATASET_ROW, args.toArray());
    }

    public int countAll(String workspaceId, String status, String workflowId) {
        Query filter = scope(workspaceId, status, workflowId);
        Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM datasets WHERE " + filter.where(),
                Integer.class, filter.args().toArray());
        return total == null ? 0 : total;
    }

    private record Query(String where, List<Object> args) {
    }

    /**
     * Rows, valid rows and sources across the workspace, summed from the tables that hold them.
     *
     * <p>From {@code dataset_rows} and {@code dataset_sources}, not from the {@code row_count} columns
     * on the dataset headers: a monitoring figure has to be the count of the things, or it reports what
     * the writer last believed rather than what is on disk.
     */
    public Map<String, Integer> rowTotals(String workspaceId) {
        Map<String, Integer> totals = new LinkedHashMap<>();
        jdbc.query("""
                SELECT (SELECT COUNT(*) FROM dataset_rows WHERE workspace_id = ?) AS rows_stored,
                       (SELECT COUNT(*) FROM dataset_rows WHERE workspace_id = ? AND valid = 1
                          AND duplicate_of_row_id IS NULL) AS rows_valid,
                       (SELECT COUNT(*) FROM dataset_sources WHERE workspace_id = ?) AS sources,
                       (SELECT COUNT(*) FROM dataset_sources WHERE workspace_id = ?
                          AND verified_by_tool = 1) AS sources_verified
                """, rs -> {
            totals.put("rows", rs.getInt("rows_stored"));
            totals.put("validRows", rs.getInt("rows_valid"));
            totals.put("sources", rs.getInt("sources"));
            totals.put("verifiedSources", rs.getInt("sources_verified"));
        }, workspaceId, workspaceId, workspaceId, workspaceId);
        return totals;
    }

    /**
     * Filtering the list by placeholders only — never by splicing a caller's value into the SQL, and
     * never by a workspace id that came from the request.
     */
    private static Query scope(String workspaceId, String status, String workflowId) {
        List<String> where = new ArrayList<>(List.of("workspace_id = ?"));
        List<Object> args = new ArrayList<>(List.of(workspaceId));
        if (status != null && !status.isBlank()) {
            where.add("status = ?");
            args.add(status);
        }
        if (workflowId != null && !workflowId.isBlank()) {
            where.add("workflow_id = ?");
            args.add(workflowId);
        }
        return new Query(String.join(" AND ", where), args);
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() <= max ? value : value.substring(0, max - 1) + "…";
    }

    /**
     * An ISO-8601 retrieval stamp as a SQL timestamp, or null.
     *
     * <p>Unparseable means no time was recorded, not that the run's clock can stand in for it: a
     * source dated by guesswork would be indistinguishable from one dated by the fetch that happened.
     */
    private static Timestamp asTimestamp(String iso) {
        if (iso == null || iso.isBlank()) {
            return null;
        }
        try {
            return Timestamp.from(OffsetDateTime.parse(iso).toInstant());
        } catch (java.time.format.DateTimeParseException e) {
            return null;
        }
    }
}
