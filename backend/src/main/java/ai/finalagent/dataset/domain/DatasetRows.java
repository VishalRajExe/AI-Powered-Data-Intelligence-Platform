package ai.finalagent.dataset.domain;

import java.time.Instant;

/**
 * Dataset rows as they exist in MySQL. An anaemic read model over JDBC, in the same shape as
 * {@code workflow.domain.Records}: no entities, no lazy associations, nothing that can issue a query
 * inside a request's hot path unnoticed.
 *
 * <p>Every field here is a fact some stage measured — the pipeline's values, Java's verdict, the
 * collection's provenance — and nothing here carries a default that would stand in for a measurement
 * that did not happen. That is why {@code confidence}, {@code qualityScore} and {@code retrievedAt}
 * are boxed: absent means nobody measured it, and zero means something else entirely.
 */
public final class DatasetRows {

    private DatasetRows() {
    }

    /** One saved dataset, with its counts as they were when the save transaction committed. */
    public record Dataset(String id, String workspaceId, String runId, String workflowId,
                          String planId, String stepId, String objective, String requirementText,
                          String entityType, String extractionSchemaJson, String status,
                          int rowCount, int validRowCount, int invalidRowCount, int duplicateCount,
                          int conflictCount, int sourceCount, int verifiedSourceCount,
                          int unverifiedSourceCount, int blockedSourceCount,
                          int recordsWithoutEvidence, Double qualityScore, String qualityBasis,
                          String qualityJson, String errorCode, String errorMessage,
                          Instant createdAt, Instant updatedAt) {
    }

    /**
     * A column of the dynamic schema.
     *
     * @param origin whether the plan declared it, the extraction schema declared it, the pipeline
     *               emitted it, or only the data has it — the difference between a field someone
     *               asked for and one the web happened to contain
     */
    public record Column(String id, String datasetId, String fieldKey, String label, String type,
                         boolean required, int position, String origin, String description,
                         int populatedCount) {
    }

    /**
     * A saved row.
     *
     * @param valid Java's verdict from {@code RowContractEnforcer}; {@code advisoryValid} is the
     *              pipeline's own and is kept beside it, never merged with it
     * @param duplicateOfRowId the canonical row this one was linked to. A link, not a deletion: the
     *                         row stays readable, which is what makes "nothing was dropped" checkable
     */
    public record Row(String id, String datasetId, String runId, String stepId, int recordIndex,
                      String valuesJson, String rawValuesJson, boolean valid, boolean advisoryValid,
                      String verificationStatus, Double confidence, String duplicateOfRowId,
                      String matchType, String duplicateKey, boolean reviewRequired,
                      String issuesJson, String normalizationNotesJson, int conflictCount,
                      int sourceCount, int verifiedSourceCount, int populatedFieldCount,
                      int evidencedFieldCount, Instant createdAt) {
    }

    /**
     * A page this run touched, including the ones that produced nothing.
     *
     * @param verifiedByTool true only when a tool returned this URL during the run. Nothing else in
     *                       the schema may set it, and nothing may infer it from the URL looking
     *                       plausible in a record
     * @param blockedCode the policy that refused it — robots, domain allowlist, an unreadable file —
     *                    with the reason beside it
     */
    public record Source(String id, String datasetId, String runId, String stepId, String url,
                         String urlHash, String domain, String title, String snippet,
                         String sourceType, Instant retrievedAt, boolean verifiedByTool,
                         String provenance, String blockedCode, String blockedReason,
                         int citationCount, int citedByRows) {

        public boolean blocked() {
            return "REFUSED_BEFORE_FETCH".equals(provenance);
        }
    }

    /**
     * A field-level attribution. Only real ones are stored: the row's other fields are backed by its
     * sources at row level, and saying so per field would be a fabricated mapping.
     */
    public record Evidence(String id, String rowId, String columnKey, String sourceId, String kind,
                           String fieldValue) {
    }

    /** Two sources disagreed, and both values survived with the rule that chose between them. */
    public record Conflict(String id, String rowId, String columnKey, String keptValueJson,
                           String rejectedValueJson, String keptSourcesJson,
                           String rejectedSourcesJson, String resolvedBy, Instant createdAt) {
    }

    /**
     * An export, and how far it has actually got.
     *
     * @param totalRows       the row count taken before the first byte was written
     * @param writtenRows     rows handed to a writer so far; a file that stopped early is visible as
     *                        {@code writtenRows < totalRows}, which is why the count is kept at all
     * @param progressPercent derived from those two, never from the job's status
     * @param checksum        SHA-256 of the finished file, so a download can be checked against what
     *                        was written rather than against what the writer claimed
     */
    public record Export(String id, String workspaceId, String datasetId, String jobId, String runId,
                         String requestedById, String format, String scopeJson, String status,
                         int totalRows, int writtenRows, int progressPercent, String fileName,
                         String filePath, Long fileBytes, String checksum, String errorCode,
                         String errorMessage, Instant createdAt, Instant startedAt,
                         Instant finishedAt) {

        public boolean settled() {
            return "COMPLETED".equals(status) || "FAILED".equals(status)
                    || "CANCELLED".equals(status);
        }
    }
}
