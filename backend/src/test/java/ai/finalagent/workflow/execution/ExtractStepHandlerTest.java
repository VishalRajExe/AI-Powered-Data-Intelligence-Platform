package ai.finalagent.workflow.execution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.client.ResourceAccessException;

import ai.finalagent.aiclient.AiServiceClient;
import ai.finalagent.aiclient.dto.ResearchRequest;
import ai.finalagent.aiclient.dto.ResearchResult;
import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.domain.Records.Plan;
import ai.finalagent.workflow.domain.Records.Run;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.domain.RunStatus;

/**
 * The classify-then-decide rule this step exists for: a 200 whose body says FAILED is a result, a
 * 4xx is a caller bug, a 5xx or a socket is worth another attempt. Collapsing them — which is what
 * the replaced project did — either retries a refusal forever or reports a broken boundary as an
 * empty dataset.
 */
@ExtendWith(MockitoExtension.class)
class ExtractStepHandlerTest {

    @Mock
    private AiServiceClient aiServiceClient;

    private static Run run() {
        return new Run("run-1", "ws-1", "wf-1", "plan-1", RunStatus.RUNNING, 1, 0,
                0, 0, 0, 0, 0, 0, null, null, null, Instant.now(), null, Instant.now());
    }

    private static Step step() {
        return new Step("step-1", "ws-1", "run-1", 1, "collect", 0, "[]", "EXTRACT",
                JobStatus.RUNNING, 1, 0, "{}", null, null, null, null, Instant.now(), null);
    }

    private static Job job() {
        return new Job("job-1", "ws-1", "run-1", null, "WORKFLOW_STEP", "step-1", "{}",
                JobStatus.RUNNING, 100, 1, 3, Instant.now(), Instant.now().plusSeconds(90),
                "worker-1", 2, null, null, null, Instant.now(), Instant.now(), null, Instant.now());
    }

    private static StepContext context(Map<String, Object> payload) {
        return new StepContext(run(), step(), plan(), job(), payload, "worker-1",
                () -> true, () -> false);
    }

    private static Plan plan() {
        return new Plan("plan-1", "ws-1", "wf-1", 1, "objective", "{}", "{}", "[]", "{}", "{}",
                "{}", "hash", "00000000-0000-0000-0000-000000000000", Instant.now());
    }

    private static Map<String, Object> payload() {
        return Map.of("stepKey", "collect", "type", "EXTRACT", "config", Map.of(
                "topic", "list coding youtube channels",
                "extractionSchema", Map.of("type", "object"),
                "seedQueries", List.of("best coding channels"),
                "limits", Map.of("maxLoops", 6, "expectedRecords", 20, "maxScrapesPerRun", 14,
                        "allowedDomains", List.of("youtube.com"), "entityType", "youtube_channel",
                        "minRelevanceScore", 0.2)));
    }

    private static ResearchResult result(String status, int records, ResearchResult.Validation validation,
                                         String failureReason) {
        List<ResearchResult.Record> list = new java.util.ArrayList<>();
        for (int i = 0; i < records; i++) {
            list.add(new ResearchResult.Record(Map.of("channel_name", "c" + i), List.of()));
        }
        return new ResearchResult(status, list, List.of(), Map.of("loopsUsed", 2), validation, failureReason);
    }

    private static ResearchResult.Validation validation(List<String> warnings) {
        return new ResearchResult.Validation(true, List.of(), List.of(), 0, true, List.of(),
                List.of("https://unseen.test/x"), List.of(1), 2,
                List.of(new ResearchResult.Refusal("https://blocked.test/y", "ROBOTS_DISALLOWED", "disallow")),
                List.of(Map.of("url", "https://off.test/z", "code", "IRRELEVANT")), warnings);
    }

    private ExtractStepHandler handler;

    @BeforeEach
    void setUp() {
        handler = new ExtractStepHandler(aiServiceClient);
    }

    @Test
    void aSuccessfulRunBecomesACompletedStepWhoseSummaryKeepsTheRecordsForTheNextStep() {
        when(aiServiceClient.research(any())).thenReturn(result("COMPLETED", 3, validation(List.of()), null));

        StepOutcome outcome = handler.handle(context(payload()));

        assertThat(outcome.status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(outcome.summary()).containsEntry("recordCount", 3)
                .containsEntry("researchStatus", "COMPLETED");
        assertThat(outcome.summary().get("records")).isInstanceOf(List.class);
        assertThat(outcome.counters().recordsFound()).isEqualTo(3);
        assertThat(outcome.counters().recordsRaw()).isEqualTo(3);
    }

    @Test
    void theCurationVerdictsAreCarriedIntoTheStepSummaryRatherThanDropped() {
        when(aiServiceClient.research(any()))
                .thenReturn(result("COMPLETED_WITH_WARNINGS", 2, validation(
                        List.of("expected at least 20 records, collected 2")), null));

        Map<String, Object> summary = handler.handle(context(payload())).summary();

        assertThat(summary).containsEntry("recordsWithoutEvidence", List.of(1))
                .containsEntry("unverifiedUrls", List.of("https://unseen.test/x"));
        assertThat(summary.get("refusedSources")).isInstanceOf(List.class);
        assertThat((List<?>) summary.get("refusedSources")).hasSize(1);
        assertThat((List<?>) summary.get("droppedCandidates")).hasSize(1);
    }

    @Test
    void refusedSourcesCountAsSourcesThatDidNotWorkButRecordsStillCount() {
        when(aiServiceClient.research(any())).thenReturn(result("COMPLETED", 2, validation(List.of()), null));

        StepOutcome.Counters counters = handler.handle(context(payload())).counters();

        assertThat(counters.sourcesFailed()).isEqualTo(1);
        assertThat(counters.recordsFound()).isEqualTo(2);
    }

    @Test
    void aRunThatFailedAtHttp200IsAPermanentStepFailureWithTheUpstreamReason() {
        when(aiServiceClient.research(any())).thenReturn(
                result("FAILED", 0, null, "the graph exhausted its loop budget"));

        StepOutcome outcome = handler.handle(context(payload()));

        assertThat(outcome.status()).isEqualTo(JobStatus.FAILED);
        assertThat(outcome.errorCode()).isEqualTo("RESEARCH_FAILED");
        assertThat(outcome.errorMessage()).contains("exhausted its loop budget");
        // Nothing was collected, so nothing may be counted; the raw submission is still recorded.
        assertThat(outcome.counters().recordsFound()).isZero();
    }

    @Test
    void aRefusedRequestIsPermanentBecauseAnotherAttemptSendsTheSameBytes() {
        when(aiServiceClient.research(any()))
                .thenThrow(new AiServiceClient.AiServiceException(422, "schema rejected", null));

        assertThatThrownBy(() -> handler.handle(context(payload())))
                .isInstanceOf(JobExecutionException.class)
                .satisfies(e -> assertThat(((JobExecutionException) e).retryable()).isFalse())
                .hasMessageContaining("schema rejected");
    }

    @Test
    void aRateLimitedUpstreamIsRetryable() {
        when(aiServiceClient.research(any()))
                .thenThrow(new AiServiceClient.AiServiceException(429, "slow down", null));

        assertThatThrownBy(() -> handler.handle(context(payload())))
                .isInstanceOf(JobExecutionException.class)
                .satisfies(e -> {
                    JobExecutionException failure = (JobExecutionException) e;
                    assertThat(failure.retryable()).isTrue();
                    assertThat(failure.code()).isEqualTo(JobExecutionException.RATE_LIMIT);
                });
    }

    @Test
    void anUnreachableUpstreamIsRetryableAndNamesNoResponseDetail() {
        when(aiServiceClient.research(any())).thenThrow(new ResourceAccessException("connect timed out"));

        assertThatThrownBy(() -> handler.handle(context(payload())))
                .isInstanceOf(JobExecutionException.class)
                .satisfies(e -> assertThat(((JobExecutionException) e).code())
                        .isEqualTo(JobExecutionException.TRANSIENT_NETWORK));
    }

    @Test
    void anEmptyBodyIsReportedRatherThanReadAsZeroRecords() {
        when(aiServiceClient.research(any())).thenReturn(null);

        assertThatThrownBy(() -> handler.handle(context(payload())))
                .isInstanceOf(JobExecutionException.class)
                .hasMessageContaining("no body");
    }

    @Test
    void theRequestThatLeavesSpringIsBuiltFromTheJobPayloadNotFromMutablePlanState() {
        when(aiServiceClient.research(any())).thenReturn(result("COMPLETED", 1, validation(List.of()), null));

        handler.handle(context(payload()));

        ArgumentCaptor<ResearchRequest> captor = ArgumentCaptor.forClass(ResearchRequest.class);
        verify(aiServiceClient).research(captor.capture());
        ResearchRequest sent = captor.getValue();
        assertThat(sent.topic()).isEqualTo("list coding youtube channels");
        assertThat(sent.seedQueries()).containsExactly("best coding channels");
        assertThat(sent.limits().expectedRecords()).isEqualTo(20);
        assertThat(sent.limits().maxScrapesPerRun()).isEqualTo(14);
        assertThat(sent.limits().allowedDomains()).containsExactly("youtube.com");
        assertThat(sent.limits().minRelevanceScore()).isEqualTo(0.2);
    }

    @Test
    void aWorkerThatNoLongerHoldsTheLeaseRefusesToRunTheStepAtAll() {
        StepContext lost = new StepContext(run(), step(), plan(), job(), payload(), "worker-1",
                () -> false, () -> false);

        assertThatThrownBy(() -> handler.handle(lost))
                .isInstanceOf(JobExecutionException.class)
                .hasMessageContaining("never written");
        verify(aiServiceClient, never()).research(any());
    }

    @Test
    void aCancelledRunDoesNotSpendCollectionCreditsOnStepStart() {
        StepContext cancelled = new StepContext(run(), step(), plan(), job(), payload(), "worker-1",
                () -> true, () -> true);

        assertThatThrownBy(() -> handler.handle(cancelled))
                .isInstanceOf(JobExecutionException.class)
                .hasMessageContaining("cancellation was requested");
        verify(aiServiceClient, never()).research(any());
    }

    @Test
    void aPayloadWithoutItsConfigFailsLoudlyInsteadOfCallingTheServiceWithNulls() {
        assertThatThrownBy(() -> handler.handle(context(Map.of())))
                .isInstanceOf(JobExecutionException.class)
                .hasMessageContaining("no 'config' object");
    }
}
