package ai.finalagent.workflow.execution;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * Which failures are worth another attempt is a cost decision, not a style one: retrying a refusal
 * re-spends Firecrawl credits to reach the same answer, while not retrying a blip fails a run that
 * would have succeeded a second later.
 */
class JobExecutionExceptionTest {

    @Test
    void statusCodesThatMeanWaitAreRetryable() {
        assertThat(JobExecutionException.fromHttpStatus(408, "m").retryable()).isTrue();
        assertThat(JobExecutionException.fromHttpStatus(429, "m").retryable()).isTrue();
        assertThat(JobExecutionException.fromHttpStatus(502, "m").retryable()).isTrue();
        assertThat(JobExecutionException.fromHttpStatus(503, "m").retryable()).isTrue();
        assertThat(JobExecutionException.fromHttpStatus(504, "m").retryable()).isTrue();
        assertThat(JobExecutionException.fromHttpStatus(408, "m").code()).isEqualTo(JobExecutionException.TIMEOUT);
        assertThat(JobExecutionException.fromHttpStatus(429, "m").code())
                .isEqualTo(JobExecutionException.RATE_LIMIT);
        assertThat(JobExecutionException.fromHttpStatus(503, "m").code())
                .isEqualTo(JobExecutionException.SERVER_ERROR);
    }

    @Test
    void aRejectedRequestIsPermanentBecauseTheSameBytesWillBeRejectedAgain() {
        assertThat(JobExecutionException.fromHttpStatus(400, "bad schema").retryable()).isFalse();
        assertThat(JobExecutionException.fromHttpStatus(422, "unparseable").retryable()).isFalse();
        assertThat(JobExecutionException.fromHttpStatus(400, "m").code()).isEqualTo("AI_SERVICE_REJECTED");
    }

    @Test
    void aServiceCrashIsPermanentSoTheFaultIsReportedInsteadOfLoopedOn() {
        assertThat(JobExecutionException.fromHttpStatus(500, "crash").retryable()).isFalse();
    }

    @Test
    void anUnlistedStatusCodeIsPermanentRatherThanDefaultingToRetry() {
        assertThat(JobExecutionException.fromHttpStatus(418, "m").retryable()).isFalse();
        assertThat(JobExecutionException.fromHttpStatus(-1, "m").retryable()).isFalse();
    }

    @Test
    void theTimeoutAndInterruptCodesAreRetryableBecauseAnotherAttemptMayNotHitThem() {
        assertThat(JobExecutionException.transientFailure(JobExecutionException.TIMEOUT, "m").retryable())
                .isTrue();
        assertThat(new JobExecutionException("WORKER_INTERRUPTED", "m", true).retryable()).isTrue();
        assertThat(JobExecutionException.permanent("LEASE_LOST", "m").retryable()).isFalse();
    }
}
