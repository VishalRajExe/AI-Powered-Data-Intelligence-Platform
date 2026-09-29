package ai.finalagent.workflow.domain;

import java.time.Instant;

/**
 * Rows as they exist in the database. Deliberately an anaemic read model over JDBC: no entities,
 * no lazy associations, nothing that can issue a query inside a worker's hot path. Every field
 * here was in the row the claim query returned, which is what makes a job self-contained enough
 * to execute without re-reading mutable state.
 */
public final class Records {

    private Records() {
    }

    /** A user's standing request: the prompt verbatim plus the latest planning verdict. */
    public record Workflow(String id, String workspaceId, String createdById, String name,
                           String requirementText, String status, String planningStatus,
                           String planningErrorCode, String planningErrorMessage,
                           Instant createdAt, Instant updatedAt) {
    }

    /** An immutable, versioned plan. {@code document} is the canonical JSON the executor reads. */
    public record Plan(String id, String workspaceId, String workflowId, int version,
                       String objective, String requirementJson, String extractionSchemaJson,
                       String stepsJson, String searchStrategyJson, String sourcePolicyJson,
                       String completionCriteriaJson, String planHash, String createdById,
                       Instant createdAt) {
    }

    public record Run(String id, String workspaceId, String workflowId, String planId,
                      RunStatus status, int attempt, int progress,
                      int recordsRaw, int recordsFound, int recordsValid, int duplicateCount,
                      int sourcesProcessed, int sourcesFailed,
                      String errorCode, String errorMessage, Instant cancelRequestedAt,
                      Instant startedAt, Instant finishedAt, Instant createdAt) {
    }

    public record Step(String id, String workspaceId, String runId, int planVersion, String stepKey,
                       int sequence, String dependsOnJson, String type, JobStatus status,
                       int attempt, int retryCount, String inputJson, String outputSummaryJson,
                       Long durationMs, String errorCode, String errorMessage,
                       Instant startedAt, Instant finishedAt) {
    }

    public record Job(String id, String workspaceId, String runId, String parentJobId, String jobType,
                      String stepId, String payloadJson, JobStatus status, int priority,
                      int attemptCount, int maxAttempts, Instant lockedAt, Instant leaseExpiresAt,
                      String workerId, long version, String lastErrorCode, String lastErrorMessage,
                      String resultSummaryJson, Instant scheduledFor, Instant startedAt,
                      Instant finishedAt, Instant createdAt) {

        public boolean exhausted() {
            return attemptCount >= maxAttempts;
        }
    }
}
