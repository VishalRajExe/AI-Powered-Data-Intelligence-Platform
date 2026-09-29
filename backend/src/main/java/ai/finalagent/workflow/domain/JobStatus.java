package ai.finalagent.workflow.domain;

import java.util.Set;

/**
 * The seven states a job or a step may hold — the brief's vocabulary, kept narrow on purpose.
 *
 * <p>The previous project stored status as a bare string and let any code path write any value,
 * so a row could go from {@code COMPLETED} back to {@code RUNNING} on a late callback and nobody
 * could tell afterwards which transition produced it. Here the allowed transitions are declared
 * once, {@link #assertTransition} is the only way through, and the SQL that writes status carries
 * {@code WHERE status = <expected>} as a second, independent guard — because the Java-side check
 * and the database write are separate steps and another worker may have moved the row between them.
 */
public enum JobStatus {
    PENDING,
    RUNNING,
    COMPLETED,
    FAILED,
    SKIPPED,
    BLOCKED,
    CANCELLED;

    private static final JobStatus[] TERMINAL = {COMPLETED, FAILED, SKIPPED, BLOCKED, CANCELLED};

    public boolean isTerminal() {
        for (JobStatus status : TERMINAL) {
            if (this == status) {
                return true;
            }
        }
        return false;
    }

    /** True when the row still holds a lease that somebody intends to honour. */
    public boolean holdsLease() {
        return this == RUNNING;
    }

    public Set<JobStatus> allowedNext() {
        return switch (this) {
            case PENDING -> Set.of(RUNNING, CANCELLED, BLOCKED);
            case RUNNING -> Set.of(COMPLETED, FAILED, CANCELLED, BLOCKED, PENDING, SKIPPED);
            default -> Set.of();
        };
    }

    public JobStatus assertTransition(JobStatus next) {
        if (next == this) {
            return this;
        }
        if (!allowedNext().contains(next)) {
            throw new IllegalJobStateException(this, next);
        }
        return next;
    }

    /** A transition the state machine forbids — a bug or a lost race, never a silent write. */
    public static class IllegalJobStateException extends IllegalStateException {
        public IllegalJobStateException(JobStatus from, JobStatus to) {
            super("Illegal job status transition " + from + " -> " + to
                    + "; terminal states are never reopened, and a reclaimed job goes through"
                    + " RUNNING or is cancelled explicitly");
        }
    }
}
