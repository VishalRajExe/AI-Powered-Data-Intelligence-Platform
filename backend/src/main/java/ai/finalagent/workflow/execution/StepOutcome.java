package ai.finalagent.workflow.execution;

import java.util.Map;

import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.support.Json;

/**
 * What a step handler decided.
 *
 * <p>{@link #blocked} exists separately from {@link #failed} because "this source refuses us" and
 * "we could not do the work" are different answers to a user, and collapsing them into FAILED is
 * how a system ends up retrying a policy refusal forever.
 */
public record StepOutcome(JobStatus status, Map<String, Object> summary, Counters counters,
                          String errorCode, String errorMessage) {

    /** Run-level counters. Absent means absent — nothing here defaults a count to a plausible one. */
    public record Counters(int recordsFound, int recordsValid, int duplicates, int sourcesProcessed,
                           int sourcesFailed, int recordsRaw) {

        public static Counters none() {
            return new Counters(0, 0, 0, 0, 0, 0);
        }

        public Counters plus(Counters other) {
            return new Counters(recordsFound + other.recordsFound(), recordsValid + other.recordsValid(),
                    duplicates + other.duplicates(), sourcesProcessed + other.sourcesProcessed(),
                    sourcesFailed + other.sourcesFailed(), recordsRaw + other.recordsRaw());
        }
    }

    public static StepOutcome completed(Map<String, Object> summary, Counters counters) {
        return new StepOutcome(JobStatus.COMPLETED, summary, counters, null, null);
    }

    public static StepOutcome failed(String code, String message, Counters counters) {
        return new StepOutcome(JobStatus.FAILED, Map.of(), counters, code, message);
    }

    public static StepOutcome blocked(String code, String message, Counters counters) {
        return new StepOutcome(JobStatus.BLOCKED, Map.of(), counters, code, message);
    }

    public String summaryJson() {
        return Json.write(summary);
    }
}
