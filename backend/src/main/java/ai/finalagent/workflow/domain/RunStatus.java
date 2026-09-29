package ai.finalagent.workflow.domain;

/**
 * A run's lifecycle. Distinct from {@link JobStatus} on purpose: a run is an aggregate whose
 * state is derived from its steps, while a job is a unit of work one worker holds.
 *
 * <p>{@code PARTIAL} is a first-class outcome rather than a euphemism — a run that produced valid
 * records but had sources blocked, or collected fewer entities than the contract asked for, must
 * not be reported as plain success. The audit found the previous project doing exactly that
 * ({@code docs/audit/00-FORENSIC-AUDIT.md} §5 item 8: datasets landing {@code PARTIAL} with no
 * explanation, because rows were dropped quietly). Here the shortfall is counted and the status
 * says so.
 */
public enum RunStatus {
    PENDING,
    PLANNING,
    RUNNING,
    COMPLETED,
    PARTIAL,
    FAILED,
    CANCELLED;

    public boolean isTerminal() {
        return this == COMPLETED || this == PARTIAL || this == FAILED || this == CANCELLED;
    }
}
