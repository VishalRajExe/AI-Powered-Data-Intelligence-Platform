package ai.finalagent.dataset.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A dataset assembled and ready to be written — the only object the save step builds.
 *
 * <p>It is a value, not an entity: nothing here knows about JDBC, and the counts on the header are
 * computed from the rows and sources this draft actually carries rather than copied from a report.
 * That is what makes the invariant in the write test meaningful — the stored counts equal the stored
 * rows because both come from the same list, so a mismatch is a bug rather than a drift between two
 * sources of truth.
 *
 * <p>A duplicate row links to another row by <em>record index</em> rather than by id, because ids are
 * minted while writing. The repository resolves the index to the row it inserted, which keeps the
 * assembly pure and the link real.
 *
 * @param sourcesWithoutUrl citations that named no page at all and so could not become a source row.
 *                          Counted rather than quietly dropped: a dataset that lost two citations
 *                          without saying so is the silent-loss defect this rebuild removed.
 */
public record DatasetDraft(Header header, List<DraftColumn> columns, List<DraftRow> rows,
                           List<DraftSource> sources, int sourcesWithoutUrl) {

    public DatasetDraft {
        columns = List.copyOf(columns);
        rows = List.copyOf(rows);
        sources = List.copyOf(sources);
    }

    /** The dataset header: what the run asked for, and the verdict it reached. */
    public record Header(String workspaceId, String runId, String workflowId, String planId,
                         String stepId, String objective, String requirementText, String entityType,
                         String extractionSchemaJson, String status, String qualityBasis,
                         String qualityJson, Double qualityScore) {
    }

    public record DraftColumn(String fieldKey, String label, String type, boolean required,
                              int position, String origin, String description, int populatedCount) {
    }

    /**
     * @param duplicateOfRecordIndex the canonical row's record index, or null when this row is one
     * @param sourceUrlHashes        the sources this row cites, by join key, already deduplicated
     */
    public record DraftRow(int recordIndex, Map<String, Object> values, Map<String, Object> rawValues,
                           boolean valid, boolean advisoryValid, String verificationStatus,
                           Double confidence, Integer duplicateOfRecordIndex, String matchType,
                           String duplicateKey, boolean reviewRequired, List<Map<String, Object>> issues,
                           List<String> normalizationNotes, List<DraftConflict> conflicts,
                           List<String> sourceUrlHashes, List<DraftEvidence> fieldEvidence,
                           String searchText, List<String> reviewReasons) {

        public boolean canonical() {
            return duplicateOfRecordIndex == null;
        }

        public int populatedFieldCount() {
            return (int) values.entrySet().stream()
                    .filter(entry -> !absent(entry.getValue())).count();
        }

        public int evidencedFieldCount() {
            return (int) fieldEvidence.stream().map(DraftEvidence::columnKey).distinct().count();
        }

        private static boolean absent(Object value) {
            if (value == null) {
                return true;
            }
            if (value instanceof String text) {
                return text.isBlank();
            }
            if (value instanceof List<?> list) {
                return list.isEmpty();
            }
            if (value instanceof Map<?, ?> map) {
                return map.isEmpty();
            }
            return false;
        }
    }

    public record DraftSource(String url, String urlHash, String domain, String title, String snippet,
                              String sourceType, String retrievedAt, boolean verifiedByTool,
                              String provenance, String blockedCode, String blockedReason) {
    }

    public record DraftEvidence(String columnKey, String urlHash, String kind, String fieldValue) {
    }

    public record DraftConflict(String columnKey, Object keptValue, Object rejectedValue,
                                List<String> keptSourceUrls, List<String> rejectedSourceUrls,
                                String resolvedBy) {
    }

    // ------------------------------------------------------------------ derived counts

    public int rowCount() {
        return rows.size();
    }

    public int validRowCount() {
        return (int) rows.stream().filter(row -> row.valid() && row.canonical()).count();
    }

    public int invalidRowCount() {
        return (int) rows.stream().filter(row -> !row.valid() && row.canonical()).count();
    }

    public int duplicateCount() {
        return (int) rows.stream().filter(row -> !row.canonical()).count();
    }

    public int conflictCount() {
        return rows.stream().mapToInt(row -> row.conflicts().size()).sum();
    }

    public int sourceCount() {
        return sources.size();
    }

    public int verifiedSourceCount() {
        return (int) sources.stream().filter(DraftSource::verifiedByTool).count();
    }

    public int unverifiedSourceCount() {
        return sources.size() - verifiedSourceCount();
    }

    public int blockedSourceCount() {
        return (int) sources.stream()
                .filter(source -> "REFUSED_BEFORE_FETCH".equals(source.provenance())).count();
    }

    /**
     * Canonical rows with no source at all. Counted over rows the dataset keeps, not over links:
     * a duplicate's evidence is its canonical's, so counting it separately would double the shortfall.
     */
    public int recordsWithoutEvidence() {
        return (int) rows.stream()
                .filter(DraftRow::canonical)
                .filter(row -> row.sourceUrlHashes().isEmpty())
                .count();
    }

    // ------------------------------------------------------------------ builder

    public static final class Builder {

        private final Header header;
        private final List<DraftColumn> columns = new ArrayList<>();
        private final List<DraftRow> rows = new ArrayList<>();
        private final Map<String, DraftSource> sources = new LinkedHashMap<>();
        private int sourcesWithoutUrl;

        public Builder(Header header) {
            this.header = header;
        }

        public Builder column(DraftColumn column) {
            columns.add(column);
            return this;
        }

        public Builder row(DraftRow row) {
            rows.add(row);
            return this;
        }

        /** One source per join key. A second sighting of the same page upgrades, never duplicates. */
        public Builder source(DraftSource source) {
            if (source.urlHash() == null || source.urlHash().isEmpty()) {
                // Counted, not stored: a row keyed on the empty string would merge every URL-less
                // citation into one page that does not exist.
                sourcesWithoutUrl++;
                return this;
            }
            DraftSource existing = sources.get(source.urlHash());
            if (existing == null) {
                sources.put(source.urlHash(), source);
                return this;
            }
            sources.put(source.urlHash(), upgrade(existing, source));
            return this;
        }

        private static DraftSource upgrade(DraftSource held, DraftSource incoming) {
            // A searched URL that was then scraped, then acted on, is stronger evidence than any one
            // of those mentions — and the order it happened in is the story a reviewer reads.
            String type = held.sourceType().contains(incoming.sourceType()) ? held.sourceType()
                    : held.sourceType() + "+" + incoming.sourceType();
            return new DraftSource(held.url(), held.urlHash(),
                            incoming.domain() == null ? held.domain() : incoming.domain(),
                            held.title() == null || held.title().isBlank() ? incoming.title() : held.title(),
                            held.snippet() == null || held.snippet().isBlank() ? incoming.snippet()
                                    : held.snippet(),
                            type,
                            later(held.retrievedAt(), incoming.retrievedAt()),
                            held.verifiedByTool() || incoming.verifiedByTool(),
                            "TOOL_RETURNED".equals(held.provenance()) || "TOOL_RETURNED"
                                    .equals(incoming.provenance())
                                    ? "TOOL_RETURNED" : incoming.provenance(),
                            held.blockedCode() == null ? incoming.blockedCode() : held.blockedCode(),
                            held.blockedReason() == null ? incoming.blockedReason()
                                    : held.blockedReason());
        }

        private static String later(String left, String right) {
            if (left == null) {
                return right;
            }
            if (right == null) {
                return left;
            }
            return left.compareTo(right) >= 0 ? left : right;
        }

        public DatasetDraft build() {
            return new DatasetDraft(header, columns, rows, List.copyOf(sources.values()),
                    sourcesWithoutUrl);
        }
    }
}
