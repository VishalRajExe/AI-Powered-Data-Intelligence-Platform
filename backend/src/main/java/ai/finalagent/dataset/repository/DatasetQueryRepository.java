package ai.finalagent.dataset.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import javax.sql.DataSource;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import ai.finalagent.dataset.domain.DatasetRows;
import ai.finalagent.dataset.domain.DatasetRows.Column;
import ai.finalagent.dataset.domain.DatasetRows.Row;
import ai.finalagent.dataset.domain.DatasetRows.Source;

/**
 * Reading a saved dataset: paginate, search, filter, sort, and follow a value back to a page.
 *
 * <p>Every predicate here is built the same way: the column key is checked against the dataset's own
 * {@code dataset_columns} before it is used, and then handed to MySQL as a <em>bound parameter</em> to
 * {@code JSON_EXTRACT(values_json, ?)} rather than concatenated into the statement. A caller asking
 * for {@code sort=name); DROP} gets "no such column", not a second meaning for the query — which is
 * the only way a filter surface that is defined per-dataset at runtime can be safe.
 *
 * <p>Filtering and sorting over JSON is a scan of that dataset's rows: no functional index exists on
 * a column nobody declared until the run finished, and creating one per dataset would mean DDL on
 * behalf of a prompt. The consequence is recorded in Memory.md with the numbers that show it, rather
 * than being smoothed over by a cache.
 */
@Repository
public class DatasetQueryRepository {

    /** Bound so a request cannot make the repository read a column the dataset does not have. */
    public record Filter(String key, String operator, String value) {

        private static final List<String> VALUELESS = List.of("missing", "present");

        /**
         * Parses {@code key:operator:value}, split on the first two colons only — a URL as a filter
         * value keeps its own colons, which is the common case for this data.
         *
         * <p>The grammar lives here rather than in whichever controller needed it first, because an
         * export is requested with the same scope as the listing it came from. Two parsers of one
         * grammar drift into two behaviours, and the export's stored scope would stop meaning what the
         * rows endpoint means.
         */
        public static Filter parse(String clause) {
            if (clause == null || clause.isBlank()) {
                throw new IllegalArgumentException("a filter is key:operator:value, not blank");
            }
            String[] parts = clause.split(":", 3);
            String key = parts[0].trim();
            String operator = parts.length > 1 ? parts[1].trim().toLowerCase() : "eq";
            String value = parts.length > 2 ? parts[2] : null;
            if (key.isEmpty()) {
                throw new IllegalArgumentException("a filter needs a column key: filter=key:op:value");
            }
            if (!VALUELESS.contains(operator) && (value == null || value.isEmpty())) {
                throw new IllegalArgumentException("filter '" + clause + "' has no value; use"
                        + " 'missing' or 'present' to ask about absence");
            }
            return new Filter(key, operator, value);
        }
    }

    public record RowQuery(String search, List<Filter> filters, String sortKey, boolean sortAscending,
                           Boolean onlyValid, boolean includeDuplicates, int offset, int limit) {

        public static RowQuery of(int offset, int limit) {
            return new RowQuery(null, List.of(), null, true, null, true, offset, limit);
        }

        /**
         * The same query over a different window. The export runner walks a dataset this way, and a
         * copy that lost the filters would write a file that is not the one that was asked for.
         */
        public RowQuery withWindow(int offset, int limit) {
            return new RowQuery(search, filters, sortKey, sortAscending, onlyValid,
                    includeDuplicates, offset, limit);
        }

        /** The requester's scope, without the window: this is what gets stored with the export. */
        public Map<String, Object> asScope() {
            Map<String, Object> scope = new LinkedHashMap<>();
            scope.put("search", search);
            scope.put("filters", filters.stream().map(filter -> {
                Map<String, Object> view = new LinkedHashMap<>();
                view.put("key", filter.key());
                view.put("operator", filter.operator());
                view.put("value", filter.value());
                return view;
            }).toList());
            scope.put("sort", sortKey);
            scope.put("asc", sortAscending);
            scope.put("validOnly", onlyValid);
            scope.put("includeDuplicates", includeDuplicates);
            return scope;
        }
    }

    private static final Set<String> OPERATORS = Set.of("eq", "contains", "gte", "lte", "missing",
            "present");

    private final JdbcTemplate jdbc;

    public DatasetQueryRepository(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    // ---------------------------------------------------------------------- rows

    private static final RowMapper<Row> ROW_MAPPER = DatasetQueryRepository::mapRow;

    private static Row mapRow(ResultSet rs, int n) throws SQLException {
        return new Row(rs.getString("id"), rs.getString("dataset_id"), rs.getString("run_id"),
                rs.getString("step_id"), rs.getInt("record_index"), rs.getString("values_json"),
                rs.getString("raw_values_json"), rs.getInt("valid") == 1,
                rs.getInt("advisory_valid") == 1, rs.getString("verification_status"),
                rs.getObject("confidence") == null ? null : rs.getBigDecimal("confidence").doubleValue(),
                rs.getString("duplicate_of_row_id"), rs.getString("match_type"),
                rs.getString("duplicate_key"), rs.getInt("review_required") == 1,
                rs.getString("issues"), rs.getString("normalization_notes"),
                rs.getInt("conflict_count"), rs.getInt("source_count"),
                rs.getInt("verified_source_count"), rs.getInt("populated_field_count"),
                rs.getInt("evidenced_field_count"), instant(rs.getTimestamp("created_at")));
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    public List<Row> rows(String datasetId, RowQuery query) {
        Predicate where = predicate(datasetId, query);
        Sortation order = order(datasetId, query);
        List<Object> args = new ArrayList<>(where.args());
        // The order clause carries its own bound path parameter, and it sits between the WHERE
        // parameters and the page window. Dropping it is not a syntax error in MySQL — it is
        // "No value specified for parameter 3" at execution time, which is how this was first caught.
        args.addAll(order.args());
        args.add(query.limit());
        args.add(query.offset());
        return jdbc.query("SELECT * FROM dataset_rows r WHERE " + where.sql()
                + " " + order.sql() + " LIMIT ? OFFSET ?", ROW_MAPPER, args.toArray());
    }

    public int countRows(String datasetId, RowQuery query) {
        Predicate where = predicate(datasetId, query);
        Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM dataset_rows r WHERE " + where.sql(),
                Integer.class, where.args().toArray());
        return total == null ? 0 : total;
    }

    /**
     * The row listing's WHERE clause, scoped to one dataset first and always with that scope as the
     * leading parameter, so a query that forgot it could not read across datasets.
     *
     * <p>{@code includeDuplicates} is the difference between "the dataset" and "the rows the dataset
     * keeps": duplicates are stored and readable, and a caller asking for content gets canonical rows
     * unless they say otherwise.
     */
    private Predicate predicate(String datasetId, RowQuery query) {
        StringBuilder sql = new StringBuilder("r.dataset_id = ?");
        List<Object> args = new ArrayList<>(List.of(datasetId));
        if (!query.includeDuplicates()) {
            sql.append(" AND r.duplicate_of_row_id IS NULL");
        }
        if (query.onlyValid() != null) {
            sql.append(" AND r.valid = ?");
            args.add(query.onlyValid() ? 1 : 0);
        }
        if (query.search() != null && !query.search().isBlank()) {
            sql.append(" AND LOWER(COALESCE(r.search_text, '')) LIKE ?");
            args.add("%" + query.search().toLowerCase().trim() + "%");
        }
        Map<String, String> columns = columnTypes(datasetId);
        for (Filter filter : query.filters()) {
            String type = columns.get(filter.key());
            if (type == null) {
                throw new UnknownColumnException(filter.key(), columns.keySet());
            }
            String operator = filter.operator() == null ? "eq" : filter.operator().toLowerCase();
            if (!OPERATORS.contains(operator)) {
                throw new IllegalArgumentException("unsupported filter operator: " + filter.operator());
            }
            appendFilter(sql, args, type, operator, filter);
        }
        return new Predicate(sql.toString(), args);
    }

    private record Predicate(String sql, List<Object> args) {
    }

    private record Sortation(String sql, List<Object> args) {
    }

    /**
     * One filter. The JSON path is a bound parameter; the comparison form depends on the column's
     * declared type, because {@code "9" > "10"} as text and {@code 9 > 10} as a number are different
     * answers to the same question and only one of them is what the user meant.
     */
    private static void appendFilter(StringBuilder sql, List<Object> args, String type,
                                     String operator, Filter filter) {
        String path = "$." + filter.key();
        boolean numeric = "NUMBER".equals(type);
        if ("missing".equals(operator) || "present".equals(operator)) {
            sql.append(" AND JSON_CONTAINS_PATH(r.values_json, 'one', ?) = ?");
            args.add(path);
            args.add("missing".equals(operator) ? 0 : 1);
            return;
        }
        if ("contains".equals(operator) && !numeric) {
            sql.append(" AND JSON_UNQUOTE(JSON_EXTRACT(r.values_json, ?)) LIKE ?");
            args.add(path);
            args.add("%" + filter.value() + "%");
            return;
        }
        if (numeric && ("gte".equals(operator) || "lte".equals(operator))) {
            sql.append(" AND CAST(JSON_EXTRACT(r.values_json, ?) AS DECIMAL(20,6)) ")
                    .append("gte".equals(operator) ? ">= ?" : "<= ?");
            args.add(path);
            args.add(filter.value());
            return;
        }
        if (numeric) {
            sql.append(" AND CAST(JSON_EXTRACT(r.values_json, ?) AS DECIMAL(20,6)) = CAST(? AS DECIMAL(20,6))");
            args.add(path);
            args.add(filter.value());
            return;
        }
        sql.append(" AND JSON_UNQUOTE(JSON_EXTRACT(r.values_json, ?)) = ?");
        args.add(path);
        args.add(filter.value());
    }

    private Sortation order(String datasetId, RowQuery query) {
        if (query.sortKey() == null || query.sortKey().isBlank()) {
            return new Sortation("ORDER BY r.record_index "
                    + (query.sortAscending() ? "ASC" : "DESC"), List.of());
        }
        Map<String, String> columns = columnTypes(datasetId);
        String type = columns.get(query.sortKey());
        if (type == null) {
            throw new UnknownColumnException(query.sortKey(), columns.keySet());
        }
        String expression = "NUMBER".equals(type) || "BOOLEAN".equals(type) || "CURRENCY".equals(type)
                ? "CAST(JSON_EXTRACT(r.values_json, ?) AS DECIMAL(20,6))"
                : "JSON_UNQUOTE(JSON_EXTRACT(r.values_json, ?))";
        // record_index breaks ties, so page N and page N+1 of a column with repeated values cannot
        // disagree about which row was 40th.
        return new Sortation("ORDER BY " + expression + " "
                + (query.sortAscending() ? "ASC" : "DESC") + ", r.record_index ASC",
                List.of("$." + query.sortKey()));
    }

    private Map<String, String> columnTypes(String datasetId) {
        Map<String, String> types = new LinkedHashMap<>();
        jdbc.query("SELECT field_key, type FROM dataset_columns WHERE dataset_id = ? "
                + "ORDER BY position", rs -> {
            types.put(rs.getString("field_key"), rs.getString("type"));
        }, datasetId);
        return types;
    }

    public List<Column> columns(String datasetId) {
        return jdbc.query("SELECT * FROM dataset_columns WHERE dataset_id = ? ORDER BY position",
                (ResultSet rs, int n) -> new Column(rs.getString("id"), rs.getString("dataset_id"),
                        rs.getString("field_key"), rs.getString("label"), rs.getString("type"),
                        rs.getInt("required") == 1, rs.getInt("position"), rs.getString("origin"),
                        rs.getString("description"), rs.getInt("populated_count")),
                datasetId);
    }

    // ------------------------------------------------------------------- facets

    /**
     * What a column can be filtered on, and what is in it.
     *
     * <p>Distinct values are listed only while they stay few: a column with three values is a filter
     * a caller can use, and a column with ten thousand is a list of everything. Either way the counts
     * come from the rows, not from what the run reported about them.
     */
    public Map<String, Object> facet(String datasetId, String key, int maxDistinct) {
        Map<String, String> columns = columnTypes(datasetId);
        String type = columns.get(key);
        if (type == null) {
            throw new UnknownColumnException(key, columns.keySet());
        }
        Map<String, Object> facet = new LinkedHashMap<>();
        facet.put("key", key);
        facet.put("type", type);
        String path = "$." + key;
        Integer populated = jdbc.queryForObject("SELECT COUNT(*) FROM dataset_rows r WHERE r.dataset_id = ?"
                + " AND JSON_CONTAINS_PATH(r.values_json, 'one', ?) = 1"
                + " AND JSON_UNQUOTE(JSON_EXTRACT(r.values_json, ?)) NOT IN ('', 'null')",
                Integer.class, datasetId, path, path);
        facet.put("populatedCount", populated == null ? 0 : populated);

        if ("NUMBER".equals(type) || "CURRENCY".equals(type) || "BOOLEAN".equals(type)) {
            facet.put("sortable", true);
            facet.put("operators", List.of("eq", "gte", "lte", "missing", "present"));
            if ("NUMBER".equals(type) || "CURRENCY".equals(type)) {
                // Parameter order follows the statement, not the reading order of the Java: the two
                // path placeholders appear in the SELECT list, before the dataset scope in WHERE.
                Map<String, Object> range = jdbc.queryForMap("SELECT"
                        + " MIN(CAST(JSON_EXTRACT(r.values_json, ?) AS DECIMAL(20,6))) AS lo,"
                        + " MAX(CAST(JSON_EXTRACT(r.values_json, ?) AS DECIMAL(20,6))) AS hi"
                        + " FROM dataset_rows r WHERE r.dataset_id = ?", path, path, datasetId);
                facet.put("min", range.get("lo"));
                facet.put("max", range.get("hi"));
            }
            return facet;
        }

        List<Map<String, Object>> values = new ArrayList<>();
        jdbc.query("SELECT JSON_UNQUOTE(JSON_EXTRACT(r.values_json, ?)) AS value, COUNT(*) AS occurrences"
                + " FROM dataset_rows r WHERE r.dataset_id = ? AND JSON_CONTAINS_PATH(r.values_json,"
                + " 'one', ?) = 1 GROUP BY value ORDER BY occurrences DESC, value LIMIT ?", rs -> {
            values.add(Map.of("value", Optional.ofNullable(rs.getString("value")).orElse(""),
                    "count", rs.getInt("occurrences")));
        }, path, datasetId, path, maxDistinct + 1);
        facet.put("sortable", true);
        facet.put("operators", List.of("eq", "contains", "missing", "present"));
        facet.put("distinctListed", values.size() <= maxDistinct);
        facet.put("values", values.size() <= maxDistinct ? values : List.of());
        return facet;
    }

    // ------------------------------------------------------------------ sources

    private static final RowMapper<Source> SOURCE_MAPPER = (ResultSet rs, int n) -> new Source(
            rs.getString("id"), rs.getString("dataset_id"), rs.getString("run_id"),
            rs.getString("step_id"), rs.getString("url"), rs.getString("url_hash"),
            rs.getString("domain"), rs.getString("title"), rs.getString("snippet"),
            rs.getString("source_type"), instant(rs.getTimestamp("retrieved_at")),
            rs.getInt("verified_by_tool") == 1, rs.getString("provenance"),
            rs.getString("blocked_code"), rs.getString("blocked_reason"),
            rs.getInt("citation_count"), rs.getInt("cited_by_rows"));

    public List<Source> sources(String datasetId, Boolean verified, String domain, String search,
                                int limit, int offset) {
        StringBuilder sql = new StringBuilder("SELECT * FROM dataset_sources s WHERE s.dataset_id = ?");
        List<Object> args = new ArrayList<>(List.of(datasetId));
        if (verified != null) {
            sql.append(" AND s.verified_by_tool = ?");
            args.add(verified ? 1 : 0);
        }
        if (domain != null && !domain.isBlank()) {
            sql.append(" AND s.domain = ?");
            args.add(domain.toLowerCase());
        }
        if (search != null && !search.isBlank()) {
            sql.append(" AND (LOWER(s.url) LIKE ? OR LOWER(COALESCE(s.title, '')) LIKE ?)");
            String like = "%" + search.toLowerCase() + "%";
            args.add(like);
            args.add(like);
        }
        // Verified first, then most-cited: a caller asking "what supports this dataset" should see the
        // pages that were actually returned by a tool, not the ones the model mentioned, first.
        sql.append(" ORDER BY s.verified_by_tool DESC, s.cited_by_rows DESC, s.domain, s.url"
                + " LIMIT ? OFFSET ?");
        args.add(limit);
        args.add(offset);
        return jdbc.query(sql.toString(), SOURCE_MAPPER, args.toArray());
    }

    public int countSources(String datasetId, Boolean verified, String domain, String search) {
        List<Object> args = new ArrayList<>(List.of(datasetId));
        StringBuilder sql = new StringBuilder("SELECT COUNT(*) FROM dataset_sources s"
                + " WHERE s.dataset_id = ?");
        if (verified != null) {
            sql.append(" AND s.verified_by_tool = ?");
            args.add(verified ? 1 : 0);
        }
        if (domain != null && !domain.isBlank()) {
            sql.append(" AND s.domain = ?");
            args.add(domain.toLowerCase());
        }
        if (search != null && !search.isBlank()) {
            sql.append(" AND (LOWER(s.url) LIKE ? OR LOWER(COALESCE(s.title, '')) LIKE ?)");
            String like = "%" + search.toLowerCase() + "%";
            args.add(like);
            args.add(like);
        }
        Integer total = jdbc.queryForObject(sql.toString(), Integer.class, args.toArray());
        return total == null ? 0 : total;
    }

    public Optional<Source> source(String datasetId, String sourceId) {
        return jdbc.query("SELECT * FROM dataset_sources s WHERE s.dataset_id = ? AND s.id = ?",
                SOURCE_MAPPER, datasetId, sourceId).stream().findFirst();
    }

    public Optional<Row> row(String datasetId, String rowId) {
        return jdbc.query("SELECT * FROM dataset_rows r WHERE r.dataset_id = ? AND r.id = ?",
                ROW_MAPPER, datasetId, rowId).stream().findFirst();
    }

    public List<Row> rowsByIds(String datasetId, List<String> rowIds) {
        if (rowIds.isEmpty()) {
            return List.of();
        }
        String placeholders = String.join(", ", rowIds.stream().map(id -> "?").toList());
        List<Object> args = new ArrayList<>();
        args.add(datasetId);
        args.addAll(rowIds);
        return jdbc.query("SELECT * FROM dataset_rows r WHERE r.dataset_id = ? AND r.id IN ("
                + placeholders + ") ORDER BY r.record_index", ROW_MAPPER, args.toArray());
    }

    /** Row ids citing this source, in record order — traceability asked from the source's end. */
    public List<String> rowIdsForSource(String datasetId, String sourceId) {
        return jdbc.queryForList("SELECT r.id FROM dataset_row_sources rs"
                + " JOIN dataset_rows r ON r.id = rs.row_id"
                + " WHERE rs.dataset_id = ? AND rs.source_id = ? ORDER BY r.record_index",
                String.class, datasetId, sourceId);
    }

    // ------------------------------------------------------------------ evidence

    /** The pages behind one row, and what each of them is claimed to support. */
    public List<Map<String, Object>> rowSources(String datasetId, String rowId) {
        List<Map<String, Object>> out = new ArrayList<>();
        jdbc.query("""
                SELECT s.*, rs.cited_by_record FROM dataset_row_sources rs
                  JOIN dataset_sources s ON s.id = rs.source_id
                 WHERE rs.row_id = ? AND s.dataset_id = ?
                 ORDER BY s.verified_by_tool DESC, s.cited_by_rows DESC, s.url
                """, rs -> {
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("id", rs.getString("id"));
            view.put("url", rs.getString("url"));
            view.put("domain", rs.getString("domain"));
            view.put("title", rs.getString("title"));
            view.put("sourceType", rs.getString("source_type"));
            view.put("retrievedAt", instant(rs.getTimestamp("retrieved_at")));
            view.put("verifiedByTool", rs.getInt("verified_by_tool") == 1);
            view.put("provenance", rs.getString("provenance"));
            view.put("citedByRecord", rs.getInt("cited_by_record") == 1);
            out.add(view);
        }, rowId, datasetId);
        return out;
    }

    /**
     * Field-level attributions for one row. Only attributions that were real at save time are here;
     * the response pairs each populated field with either its attribution or the statement that the
     * row's sources support it at row level, which is what the data actually says.
     */
    public List<Map<String, Object>> fieldEvidence(String datasetId, String rowId) {
        List<Map<String, Object>> out = new ArrayList<>();
        jdbc.query("""
                SELECT e.column_key, e.kind, e.field_value, s.id AS source_id, s.url, s.domain,
                       s.verified_by_tool, s.retrieved_at, s.title
                  FROM dataset_field_evidence e
                  JOIN dataset_sources s ON s.id = e.source_id
                 WHERE e.row_id = ? AND e.dataset_id = ?
                 ORDER BY e.column_key, s.url
                """, rs -> {
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("columnKey", rs.getString("column_key"));
            view.put("kind", rs.getString("kind"));
            view.put("fieldValue", rs.getString("field_value"));
            Map<String, Object> source = new LinkedHashMap<>();
            source.put("id", rs.getString("source_id"));
            source.put("url", rs.getString("url"));
            source.put("domain", rs.getString("domain"));
            source.put("title", rs.getString("title"));
            source.put("verifiedByTool", rs.getInt("verified_by_tool") == 1);
            source.put("retrievedAt", instant(rs.getTimestamp("retrieved_at")));
            view.put("source", source);
            out.add(view);
        }, rowId, datasetId);
        return out;
    }

    public List<DatasetRows.Conflict> conflicts(String datasetId, String rowId) {
        return jdbc.query("SELECT * FROM dataset_conflicts WHERE dataset_id = ? AND row_id = ?"
                        + " ORDER BY column_key, created_at",
                (ResultSet rs, int n) -> new DatasetRows.Conflict(rs.getString("id"),
                        rs.getString("row_id"), rs.getString("column_key"),
                        rs.getString("kept_value_json"), rs.getString("rejected_value_json"),
                        rs.getString("kept_sources_json"), rs.getString("rejected_sources_json"),
                        rs.getString("resolved_by"), instant(rs.getTimestamp("created_at"))),
                datasetId, rowId);
    }

    /**
     * Per-column coverage: how many canonical rows have a value here, and of those, how many carry a
     * field-level attribution. A column can be fully populated and still entirely unattributed, and
     * only these two numbers say so together.
     */
    public List<Map<String, Object>> coverage(String datasetId) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Column column : columns(datasetId)) {
            String path = "$." + column.fieldKey();
            jdbc.query("""
                    SELECT COUNT(*) AS rows_with_value,
                           SUM(CASE WHEN EXISTS (SELECT 1 FROM dataset_field_evidence e
                                                   WHERE e.row_id = r.id AND e.column_key = ?)
                                    THEN 1 ELSE 0 END) AS rows_attributed
                      FROM dataset_rows r
                     WHERE r.dataset_id = ? AND r.duplicate_of_row_id IS NULL
                       AND JSON_CONTAINS_PATH(r.values_json, 'one', ?) = 1
                    """, rs -> {
                Map<String, Object> view = new LinkedHashMap<>();
                view.put("key", column.fieldKey());
                view.put("type", column.type());
                view.put("rowsWithValue", rs.getInt("rows_with_value"));
                view.put("rowsAttributed", rs.getInt("rows_attributed"));
                out.add(view);
            }, column.fieldKey(), datasetId, path);
        }
        return out;
    }

    /** Rows the dataset keeps that cite no source at all — the traceability shortfall, named. */
    public List<Row> rowsWithoutEvidence(String datasetId, int limit) {
        return jdbc.query("SELECT * FROM dataset_rows r WHERE r.dataset_id = ?"
                        + " AND r.duplicate_of_row_id IS NULL AND r.source_count = 0"
                        + " ORDER BY r.record_index LIMIT ?", ROW_MAPPER, datasetId, limit);
    }

    /** Sources that were cited but never returned by a tool, kept visible rather than filtered out. */
    public List<Source> unverifiedSources(String datasetId, int limit) {
        return jdbc.query("SELECT * FROM dataset_sources s WHERE s.dataset_id = ?"
                + " AND s.verified_by_tool = 0 ORDER BY s.cited_by_rows DESC, s.url LIMIT ?",
                SOURCE_MAPPER, datasetId, limit);
    }

    /**
     * A filter or sort key the dataset does not declare. The available keys are named, because the
     * caller has just asked about a field of a schema they did not write and the useful answer is
     * what the run actually produced — not an empty page that looks like a search that found nothing.
     */
    public static class UnknownColumnException extends RuntimeException {
        public UnknownColumnException(String key, java.util.Collection<String> available) {
            super("the dataset declares no column named '" + key + "'; this run produced"
                    + (available.isEmpty() ? " no columns at all" : ": " + String.join(", ", available)));
        }
    }
}
