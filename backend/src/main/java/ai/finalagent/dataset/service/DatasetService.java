package ai.finalagent.dataset.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import ai.finalagent.config.Workspace;
import ai.finalagent.dataset.domain.DatasetRows.Column;
import ai.finalagent.dataset.domain.DatasetRows.Dataset;
import ai.finalagent.dataset.domain.DatasetRows.Row;
import ai.finalagent.dataset.domain.DatasetRows.Source;
import ai.finalagent.dataset.repository.DatasetQueryRepository;
import ai.finalagent.dataset.repository.DatasetQueryRepository.Filter;
import ai.finalagent.dataset.repository.DatasetQueryRepository.RowQuery;
import ai.finalagent.dataset.repository.DatasetRepository;
import ai.finalagent.workflow.support.Json;

/**
 * Reading the dataset platform: what a run saved, what is in it, and where each value came from.
 *
 * <p>Tenancy is server-side, exactly as in {@code WorkflowService}: the workspace comes from
 * configuration and never from the request, and a foreign dataset id answers as not-found rather than
 * as forbidden — confirming that someone else's dataset exists is itself a leak. The previous project
 * read {@code workspaceId} off the request on dataset routes whose auth middleware was optional
 * ({@code docs/audit/00-FORENSIC-AUDIT.md} §5 item 1); this layer is the one that stores datasets, so
 * it is where that mistake would have landed.
 */
@Service
public class DatasetService {

    /** Page sizes are bounded twice over: a caller asking for everything gets a page and a note. */
    public static final int MAX_PAGE_SIZE = 500;
    private static final int DEFAULT_PAGE_SIZE = 50;
    private static final int MAX_FACET_VALUES = 40;

    private final DatasetRepository datasets;
    private final DatasetQueryRepository queries;
    private final Workspace currentWorkspace;

    public DatasetService(DatasetRepository datasets, DatasetQueryRepository queries,
                          Workspace currentWorkspace) {
        this.datasets = datasets;
        this.queries = queries;
        this.currentWorkspace = currentWorkspace;
    }

    public String workspace() {
        return currentWorkspace.current();
    }

    public Dataset require(String datasetId) {
        return datasets.findById(workspace(), datasetId).orElseThrow(() ->
                new UnknownDatasetException(datasetId));
    }

    public Map<String, Object> list(String status, String workflowId, int limit, int page) {
        int size = bound(limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        int offset = Math.max(page, 0) * size;
        List<Dataset> rows = datasets.list(workspace(), status, workflowId, size, offset);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("datasets", rows.stream().map(DatasetService::view).toList());
        body.put("total", datasets.countAll(workspace(), status, workflowId));
        body.put("page", Math.max(page, 0));
        body.put("pageSize", size);
        return body;
    }

    public Map<String, Object> details(String datasetId) {
        Dataset dataset = require(datasetId);
        Map<String, Object> body = new LinkedHashMap<>(view(dataset));
        body.put("extractionSchema", Json.object(dataset.extractionSchemaJson()));
        body.put("quality", dataset.qualityJson() == null ? Map.of() : Json.object(dataset.qualityJson()));
        body.put("error", dataset.errorCode() == null ? null
                : Map.of("code", dataset.errorCode(), "message", nullToEmpty(dataset.errorMessage())));
        return body;
    }

    /** The dynamic schema, in the order the run declared it. */
    public Map<String, Object> schema(String datasetId) {
        Dataset dataset = require(datasetId);
        List<Column> columns = queries.columns(dataset.id());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("datasetId", dataset.id());
        body.put("entityType", dataset.entityType());
        body.put("columnCount", columns.size());
        body.put("columns", columns.stream().map(DatasetService::view).toList());
        body.put("note", "the columns below are this run's own contract plus whatever its records "
                + "contained; 'origin' says which of the two declared each one");
        return body;
    }

    public Map<String, Object> rows(String datasetId, String search, List<Filter> filters,
                                    String sortKey, boolean ascending, Boolean onlyValid,
                                    boolean includeDuplicates, int pageSize, int page) {
        Dataset dataset = require(datasetId);
        RowQuery query = new RowQuery(search, filters == null ? List.of() : filters, sortKey, ascending,
                onlyValid, includeDuplicates, Math.max(page, 0) * bound(pageSize, DEFAULT_PAGE_SIZE,
                        MAX_PAGE_SIZE), bound(pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
        List<Row> rows = queries.rows(dataset.id(), query);
        int total = queries.countRows(dataset.id(), query);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("datasetId", dataset.id());
        body.put("rows", rows.stream().map(row -> view(row, dataset.id())).toList());
        body.put("matchedRows", total);
        body.put("page", Math.max(page, 0));
        body.put("pageSize", query.limit());
        body.put("appliedFilters", filters == null ? List.of() : filters.stream()
                .map(DatasetService::view).toList());
        if (sortKey != null && !sortKey.isBlank()) {
            body.put("sortedBy", Map.of("key", sortKey, "direction", ascending ? "asc" : "desc"));
        }
        return body;
    }

    /**
     * Search results, with the columns that matched named. A caller asking "where does 'Northwind'
     * appear" gets field names back, not just rows, because that is what makes the hit checkable.
     */
    public Map<String, Object> search(String datasetId, String term, int pageSize, int page) {
        Dataset dataset = require(datasetId);
        if (term == null || term.isBlank()) {
            throw new IllegalArgumentException("a search needs a term");
        }
        String needle = term.toLowerCase().trim();
        List<Column> columns = queries.columns(dataset.id());
        Map<String, Object> body = rows(datasetId, term, List.of(), null, true, null, false,
                pageSize, page);
        List<Map<String, Object>> hits = new ArrayList<>();
        for (Map<String, Object> row : listOfRows(body)) {
            @SuppressWarnings("unchecked")
            Map<String, Object> values = (Map<String, Object>) row.get("values");
            List<String> matched = columns.stream()
                    .filter(column -> values.containsKey(column.fieldKey())
                            && String.valueOf(values.get(column.fieldKey())).toLowerCase()
                                    .contains(needle))
                    .map(Column::fieldKey).toList();
            Map<String, Object> hit = new LinkedHashMap<>(row);
            hit.put("matchedFields", matched);
            hits.add(hit);
        }
        body.put("rows", hits);
        body.put("term", term);
        return body;
    }

    /** What can be filtered on, and what is actually in each filterable column. */
    public Map<String, Object> filters(String datasetId, List<String> keys) {
        Dataset dataset = require(datasetId);
        List<Column> columns = queries.columns(dataset.id());
        List<String> wanted = keys == null || keys.isEmpty()
                ? columns.stream().map(Column::fieldKey).toList() : keys;
        List<Map<String, Object>> facets = new ArrayList<>();
        for (String key : wanted) {
            facets.add(queries.facet(dataset.id(), key, MAX_FACET_VALUES));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("datasetId", dataset.id());
        body.put("rowCount", dataset.rowCount());
        body.put("filters", facets);
        body.put("operators", Map.of("text", List.of("eq", "contains", "missing", "present"),
                "number", List.of("eq", "gte", "lte", "missing", "present")));
        return body;
    }

    public Map<String, Object> sources(String datasetId, Boolean verified, String domain, String search,
                                       int pageSize, int page) {
        Dataset dataset = require(datasetId);
        int size = bound(pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        List<Source> sources = queries.sources(dataset.id(), verified, domain, search, size,
                Math.max(page, 0) * size);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("datasetId", dataset.id());
        body.put("total", queries.countSources(dataset.id(), verified, domain, search));
        body.put("page", Math.max(page, 0));
        body.put("pageSize", size);
        body.put("sources", sources.stream().map(DatasetService::view).toList());
        body.put("counts", Map.of("all", dataset.sourceCount(),
                "verifiedByTool", dataset.verifiedSourceCount(),
                "modelCitedOnly", dataset.unverifiedSourceCount(),
                "blockedBeforeFetch", dataset.blockedSourceCount()));
        return body;
    }

    /**
     * Dataset-level evidence: coverage per column, the rows that cite nothing, and the pages that were
     * cited but never retrieved. These three answer "how much of this can I trust" without a caller
     * having to page through every row to work it out.
     */
    public Map<String, Object> evidence(String datasetId) {
        Dataset dataset = require(datasetId);
        List<Row> withoutEvidence = queries.rowsWithoutEvidence(dataset.id(), 100);
        List<Source> unverified = queries.unverifiedSources(dataset.id(), 100);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("datasetId", dataset.id());
        body.put("rowCount", dataset.rowCount());
        body.put("recordsWithoutEvidence", dataset.recordsWithoutEvidence());
        body.put("coverage", queries.coverage(dataset.id()));
        body.put("rowsWithoutEvidence", withoutEvidence.stream()
                .map(row -> Map.of("id", row.id(), "recordIndex", row.recordIndex())).toList());
        body.put("citedButNeverRetrieved", unverified.stream()
                .map(source -> Map.of("id", source.id(), "url", source.url(),
                        "citedByRows", source.citedByRows())).toList());
        body.put("truncation", Map.of("rowsWithoutEvidence", withoutEvidence.size() >= 100,
                "citedButNeverRetrieved", unverified.size() >= 100));
        return body;
    }

    /**
     * One row's traceability: every field, and for each either its attributed source or the honest
     * statement that the row's sources back it at row level only.
     */
    public Map<String, Object> rowEvidence(String datasetId, String rowId) {
        Dataset dataset = require(datasetId);
        Row row = queries.row(dataset.id(), rowId)
                .orElseThrow(() -> new UnknownRowException(datasetId, rowId));
        List<Map<String, Object>> rowSources = queries.rowSources(dataset.id(), rowId);
        List<Map<String, Object>> fieldEvidence = queries.fieldEvidence(dataset.id(), rowId);
        Map<String, Object> values = Json.object(row.valuesJson());

        List<Map<String, Object>> fields = new ArrayList<>();
        values.forEach((key, value) -> {
            List<Map<String, Object>> attributed = fieldEvidence.stream()
                    .filter(entry -> key.equals(entry.get("columnKey"))).toList();
            Map<String, Object> field = new LinkedHashMap<>();
            field.put("key", key);
            field.put("value", value);
            field.put("attributed", !attributed.isEmpty());
            field.put("attributedSources", attributed);
            // Row-level backing is offered as context and labelled as such. Attaching it per field as
            // though it proved the field would be the fabrication this endpoint exists to prevent.
            field.put("rowLevelSources", rowSources);
            fields.add(field);
        });

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("datasetId", dataset.id());
        body.put("rowId", row.id());
        body.put("recordIndex", row.recordIndex());
        body.put("runId", row.runId());
        body.put("stepId", row.stepId());
        body.put("valid", row.valid());
        body.put("advisoryValid", row.advisoryValid());
        body.put("verificationStatus", row.verificationStatus());
        body.put("confidence", row.confidence());
        body.put("duplicateOf", row.duplicateOfRowId());
        body.put("matchType", row.matchType());
        body.put("reviewRequired", row.reviewRequired());
        body.put("evidencedFieldCount", row.evidencedFieldCount());
        body.put("populatedFieldCount", row.populatedFieldCount());
        body.put("fields", fields);
        body.put("conflicts", queries.conflicts(dataset.id(), rowId).stream().map(conflict -> {
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("columnKey", conflict.columnKey());
            view.put("keptValue", Json.parse(conflict.keptValueJson()));
            view.put("rejectedValue", Json.parse(conflict.rejectedValueJson()));
            view.put("keptSources", Json.parse(conflict.keptSourcesJson()));
            view.put("rejectedSources", Json.parse(conflict.rejectedSourcesJson()));
            view.put("resolvedBy", conflict.resolvedBy());
            return view;
        }).toList());
        body.put("issues", Json.parse(row.issuesJson()));
        body.put("normalizationNotes", Json.parse(row.normalizationNotesJson()));
        return body;
    }

    /** The rows a source supports — the traceability question asked from the other end. */
    public Map<String, Object> sourceRows(String datasetId, String sourceId, int pageSize, int page) {
        Dataset dataset = require(datasetId);
        Source source = queries.source(dataset.id(), sourceId)
                .orElseThrow(() -> new UnknownSourceException(datasetId, sourceId));
        int size = bound(pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        List<String> rowIds = rowIdsFor(dataset.id(), sourceId);
        List<Row> rows = queries.rowsByIds(dataset.id(),
                rowIds.subList(Math.min(Math.max(page, 0) * size, rowIds.size()),
                        Math.min((Math.max(page, 0) + 1) * size, rowIds.size())));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("datasetId", dataset.id());
        body.put("source", view(source));
        body.put("rows", rows.stream().map(row -> view(row, dataset.id())).toList());
        body.put("matchedRows", rowIds.size());
        body.put("page", Math.max(page, 0));
        body.put("pageSize", size);
        return body;
    }

    private List<String> rowIdsFor(String datasetId, String sourceId) {
        return queries.rowIdsForSource(datasetId, sourceId);
    }

    // ---------------------------------------------------------------------- views

    private static Map<String, Object> view(Dataset dataset) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", dataset.id());
        view.put("runId", dataset.runId());
        view.put("workflowId", dataset.workflowId());
        view.put("planId", dataset.planId());
        view.put("stepId", dataset.stepId());
        view.put("objective", dataset.objective());
        view.put("entityType", dataset.entityType());
        view.put("status", dataset.status());
        view.put("rowCount", dataset.rowCount());
        view.put("validRowCount", dataset.validRowCount());
        view.put("invalidRowCount", dataset.invalidRowCount());
        view.put("duplicateCount", dataset.duplicateCount());
        view.put("conflictCount", dataset.conflictCount());
        view.put("sourceCount", dataset.sourceCount());
        view.put("verifiedSourceCount", dataset.verifiedSourceCount());
        view.put("unverifiedSourceCount", dataset.unverifiedSourceCount());
        view.put("blockedSourceCount", dataset.blockedSourceCount());
        view.put("recordsWithoutEvidence", dataset.recordsWithoutEvidence());
        view.put("qualityScore", dataset.qualityScore());
        view.put("qualityBasis", dataset.qualityBasis());
        view.put("createdAt", dataset.createdAt());
        view.put("updatedAt", dataset.updatedAt());
        return view;
    }

    private static Map<String, Object> view(Column column) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("key", column.fieldKey());
        view.put("label", column.label());
        view.put("type", column.type());
        view.put("required", column.required());
        view.put("position", column.position());
        view.put("origin", column.origin());
        view.put("populatedCount", column.populatedCount());
        return view;
    }

    private static Map<String, Object> view(Row row, String datasetId) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", row.id());
        view.put("datasetId", datasetId);
        view.put("recordIndex", row.recordIndex());
        view.put("values", Json.object(row.valuesJson()));
        view.put("rawValues", row.rawValuesJson() == null ? Map.of() : Json.object(row.rawValuesJson()));
        view.put("valid", row.valid());
        view.put("advisoryValid", row.advisoryValid());
        view.put("verificationStatus", row.verificationStatus());
        view.put("confidence", row.confidence());
        view.put("duplicateOf", row.duplicateOfRowId());
        view.put("matchType", row.matchType());
        view.put("reviewRequired", row.reviewRequired());
        view.put("conflictCount", row.conflictCount());
        view.put("sourceCount", row.sourceCount());
        view.put("verifiedSourceCount", row.verifiedSourceCount());
        view.put("evidencedFieldCount", row.evidencedFieldCount());
        view.put("populatedFieldCount", row.populatedFieldCount());
        view.put("runId", row.runId());
        view.put("stepId", row.stepId());
        return view;
    }

    private static Map<String, Object> view(Source source) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", source.id());
        view.put("url", source.url());
        view.put("domain", source.domain());
        view.put("title", source.title());
        view.put("snippet", source.snippet());
        view.put("sourceType", source.sourceType());
        view.put("retrievedAt", source.retrievedAt());
        view.put("verifiedByTool", source.verifiedByTool());
        view.put("provenance", source.provenance());
        view.put("blockedCode", source.blockedCode());
        view.put("blockedReason", source.blockedReason());
        view.put("citationCount", source.citationCount());
        view.put("citedByRows", source.citedByRows());
        return view;
    }

    private static Map<String, Object> view(Filter filter) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("key", filter.key());
        view.put("operator", filter.operator());
        view.put("value", filter.value());
        return view;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> listOfRows(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("rows");
    }

    private static int bound(int requested, int fallback, int max) {
        if (requested <= 0) {
            return fallback;
        }
        return Math.min(requested, max);
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    /** A foreign dataset id and an absent one answer identically, by design. */
    public static class UnknownDatasetException extends RuntimeException {
        public UnknownDatasetException(String id) {
            super("no dataset " + id + " is visible to this workspace");
        }
    }

    public static class UnknownRowException extends RuntimeException {
        public UnknownRowException(String datasetId, String rowId) {
            super("dataset " + datasetId + " has no row " + rowId);
        }
    }

    public static class UnknownSourceException extends RuntimeException {
        public UnknownSourceException(String datasetId, String sourceId) {
            super("dataset " + datasetId + " has no source " + sourceId);
        }
    }
}
