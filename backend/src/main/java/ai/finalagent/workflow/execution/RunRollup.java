package ai.finalagent.workflow.execution;

import java.util.List;

import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.RunStatus;

/**
 * Deriving a run's status and progress from its steps — in one place, because it is the place a
 * system like this lies.
 *
 * <p>Two failure modes this rules out, both observed in the project being replaced: progress
 * invented from status ({@code RUNNING→50}, so a wedged run looked half-done), and a run reported
 * as plain success while rows went missing. A shortfall is {@code PARTIAL}, never {@code COMPLETED},
 * and it is the *counts* that say so — not a message somebody has to read.
 */
public final class RunRollup {

    public record Result(RunStatus status, int progress, String errorCode, String errorMessage) {
    }

    private RunRollup() {
    }

    public static Result derive(List<JobStatus> stepStatuses, int recordsValid, Integer minimumRecords,
                                boolean cancelRequested) {
        if (stepStatuses.isEmpty()) {
            return new Result(RunStatus.FAILED, 0, "PLAN_HAS_NO_STEPS",
                    "the plan produced no steps, so the run could not do anything");
        }

        long total = stepStatuses.size();
        long finished = stepStatuses.stream().filter(JobStatus::isTerminal).count();
        int progress = (int) Math.floor(finished * 100.0 / total);

        boolean failed = stepStatuses.contains(JobStatus.FAILED);
        boolean cancelled = stepStatuses.contains(JobStatus.CANCELLED);
        boolean blocked = stepStatuses.contains(JobStatus.BLOCKED);
        boolean skipped = stepStatuses.contains(JobStatus.SKIPPED);

        if (failed) {
            return new Result(RunStatus.FAILED, progress, "STEP_FAILED",
                    "at least one step failed; see its step row for the reason");
        }
        if (cancelRequested || cancelled) {
            return new Result(RunStatus.CANCELLED, progress, "RUN_CANCELLED",
                    "cancellation was requested and unstarted work was abandoned");
        }
        if (finished < total) {
            // Not finished: still running. Progress is real, so it is below 100 by construction.
            return new Result(RunStatus.RUNNING, progress, null, null);
        }
        if (blocked || skipped) {
            return new Result(RunStatus.PARTIAL, 100, "STEPS_BLOCKED_OR_SKIPPED",
                    blockedCount(blocked, skipped));
        }
        if (minimumRecords != null && recordsValid < minimumRecords) {
            return new Result(RunStatus.PARTIAL, 100, "RECORD_SHORTFALL",
                    "collected " + recordsValid + " valid records against a required " + minimumRecords);
        }
        return new Result(RunStatus.COMPLETED, 100, null, null);
    }

    private static String blockedCount(boolean blocked, boolean skipped) {
        if (blocked && skipped) {
            return "some steps were blocked by policy and others were skipped";
        }
        return blocked ? "some steps were refused by policy before collecting"
                : "some steps were skipped";
    }
}
