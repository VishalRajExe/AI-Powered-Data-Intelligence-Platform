package ai.finalagent.workflow.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/**
 * The state machine is the reason a late callback cannot resurrect a finished job. Each case here
 * is a transition some code path could otherwise attempt: the guards in the SQL are a second,
 * independent check, not a substitute for declaring the rules once.
 */
class JobStatusTest {

    @Test
    void pendingWorkCanStartBeBlockedOrBeCancelledButNothingElse() {
        assertThat(JobStatus.PENDING.allowedNext()).containsExactlyInAnyOrder(
                JobStatus.RUNNING, JobStatus.CANCELLED, JobStatus.BLOCKED);
    }

    @Test
    void runningWorkHasTheWidestSetBecauseItsOutcomeIsStillUnknown() {
        assertThat(JobStatus.RUNNING.allowedNext()).containsExactlyInAnyOrder(
                JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.BLOCKED,
                JobStatus.PENDING, JobStatus.SKIPPED);
    }

    @Test
    void terminalStatesNeverReopen() {
        for (JobStatus terminal : JobStatus.values()) {
            if (!terminal.isTerminal()) {
                continue;
            }
            assertThat(terminal.allowedNext()).isEmpty();
            assertThatThrownBy(() -> terminal.assertTransition(JobStatus.RUNNING))
                    .isInstanceOf(JobStatus.IllegalJobStateException.class)
                    .hasMessageContaining(terminal.name() + " -> RUNNING");
        }
    }

    @Test
    void aRequeuedJobGoesBackToPendingWhichIsHowRetryAndLeaseRecoveryBothLook() {
        assertThat(JobStatus.RUNNING.assertTransition(JobStatus.PENDING)).isEqualTo(JobStatus.PENDING);
    }

    @Test
    void writingTheStatusTheRowAlreadyHoldsIsNotAnError() {
        // The executor can be told to write COMPLETED for a step an earlier attempt already
        // completed; treating that as illegal would fail a job that is genuinely finished.
        assertThat(JobStatus.COMPLETED.assertTransition(JobStatus.COMPLETED)).isEqualTo(JobStatus.COMPLETED);
    }

    @Test
    void onlyRunningHoldsALease() {
        assertThat(JobStatus.RUNNING.holdsLease()).isTrue();
        assertThat(JobStatus.PENDING.holdsLease()).isFalse();
        assertThat(JobStatus.BLOCKED.holdsLease()).isFalse();
    }

    @Test
    void theSevenStatesTheBriefNamesAreAllPresent() {
        assertThat(JobStatus.values()).extracting(Enum::name).containsExactly(
                "PENDING", "RUNNING", "COMPLETED", "FAILED", "SKIPPED", "BLOCKED", "CANCELLED");
    }
}
