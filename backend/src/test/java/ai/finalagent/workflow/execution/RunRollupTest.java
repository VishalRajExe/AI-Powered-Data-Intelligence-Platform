package ai.finalagent.workflow.execution;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.RunStatus;

/**
 * Progress and status are where a run can lie, so the cases here are the ones the previous project
 * got wrong: progress invented from status, a shortfall reported as success, and a step that failed
 * while the run still said RUNNING.
 */
class RunRollupTest {

    @Test
    void progressIsTheFractionOfTerminalStepsAndNothingElse() {
        assertThat(RunRollup.derive(List.of(JobStatus.RUNNING, JobStatus.PENDING), 0, null, false)
                .progress()).isZero();
        assertThat(RunRollup.derive(List.of(JobStatus.COMPLETED, JobStatus.RUNNING), 0, null, false)
                .progress()).isEqualTo(50);
        assertThat(RunRollup.derive(List.of(JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.SKIPPED,
                JobStatus.COMPLETED), 0, null, false).progress()).isEqualTo(100);
    }

    @Test
    void aRunStillWorkingIsRunningEvenWhenItIsNinetyNinePercentDone() {
        RunRollup.Result result = RunRollup.derive(
                List.of(JobStatus.COMPLETED, JobStatus.COMPLETED, JobStatus.RUNNING), 40, null, false);
        assertThat(result.status()).isEqualTo(RunStatus.RUNNING);
        assertThat(result.progress()).isEqualTo(66);
    }

    @Test
    void anyFailedStepFailsTheRunWhateverTheOtherStepsDid() {
        RunRollup.Result result = RunRollup.derive(
                List.of(JobStatus.COMPLETED, JobStatus.FAILED), 100, 10, false);
        assertThat(result.status()).isEqualTo(RunStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("STEP_FAILED");
    }

    @Test
    void aShortfallAgainstThePlansMinimumIsPartialNeverCompleted() {
        RunRollup.Result result = RunRollup.derive(
                List.of(JobStatus.COMPLETED, JobStatus.COMPLETED), 20, 50, false);
        assertThat(result.status()).isEqualTo(RunStatus.PARTIAL);
        assertThat(result.errorCode()).isEqualTo("RECORD_SHORTFALL");
        assertThat(result.errorMessage()).contains("20").contains("50");
    }

    @Test
    void meetingTheMinimumCompletesTheRun() {
        assertThat(RunRollup.derive(List.of(JobStatus.COMPLETED, JobStatus.COMPLETED), 50, 50, false)
                .status()).isEqualTo(RunStatus.COMPLETED);
    }

    @Test
    void aPlanThatImposesNoMinimumCannotReportAShortfall() {
        assertThat(RunRollup.derive(List.of(JobStatus.COMPLETED), 0, null, false).status())
                .isEqualTo(RunStatus.COMPLETED);
    }

    @Test
    void stepsRefusedByPolicyMakeARunPartialRatherThanSucceeded() {
        assertThat(RunRollup.derive(List.of(JobStatus.BLOCKED, JobStatus.COMPLETED), 5, null, false)
                .status()).isEqualTo(RunStatus.PARTIAL);
        assertThat(RunRollup.derive(List.of(JobStatus.BLOCKED, JobStatus.COMPLETED), 5, null, false)
                .progress()).isEqualTo(100);
    }

    @Test
    void aCancellationRequestWinsOverEveryOtherNonFailureOutcome() {
        RunRollup.Result result = RunRollup.derive(
                List.of(JobStatus.COMPLETED, JobStatus.CANCELLED), 0, 10, false);
        assertThat(result.status()).isEqualTo(RunStatus.CANCELLED);
        assertThat(result.errorCode()).isEqualTo("RUN_CANCELLED");
    }

    @Test
    void aStepThatFailedIsReportedAsFailureEvenAfterCancellationWasRequested() {
        // The reason is diagnosis: a run that was cancelled had its work abandoned, while a run
        // whose step failed failed on its own merits, and an operator needs the second answer.
        assertThat(RunRollup.derive(List.of(JobStatus.FAILED, JobStatus.CANCELLED), 0, null, true)
                .status()).isEqualTo(RunStatus.FAILED);
    }

    @Test
    void aPlanWithNoStepsFailsRatherThanReportingProgressAtZeroAndSuccess() {
        RunRollup.Result result = RunRollup.derive(List.of(), 0, null, false);
        assertThat(result.status()).isEqualTo(RunStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("PLAN_HAS_NO_STEPS");
    }

    @Test
    void noRunStatusIsTerminalThatShouldStillBeWorked() {
        assertThat(RunStatus.RUNNING.isTerminal()).isFalse();
        assertThat(RunStatus.PENDING.isTerminal()).isFalse();
        assertThat(RunStatus.PLANNING.isTerminal()).isFalse();
        assertThat(RunStatus.COMPLETED.isTerminal()).isTrue();
        assertThat(RunStatus.PARTIAL.isTerminal()).isTrue();
        assertThat(RunStatus.FAILED.isTerminal()).isTrue();
        assertThat(RunStatus.CANCELLED.isTerminal()).isTrue();
    }
}
