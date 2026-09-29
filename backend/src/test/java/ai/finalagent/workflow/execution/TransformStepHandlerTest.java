package ai.finalagent.workflow.execution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.client.ResourceAccessException;

import ai.finalagent.aiclient.AiServiceClient;
import ai.finalagent.aiclient.dto.QualityRequest;
import ai.finalagent.aiclient.dto.QualityResult;
import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.domain.Records.Plan;
import ai.finalagent.workflow.domain.Records.Run;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.domain.RunStatus;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.support.Json;

/**
 * The step that hands the collected records to the pipeline and stores what comes back.
 *
 * <p>What is tested here is the seam, not the pipeline: what the step sends, what it refuses to send,
 * and what it writes when the answer is a failure, a partial run, a refusal or a socket error. The
 * verdicts themselves are re-checked downstream — this step's job is to hand over the pipeline's
 * records with their provenance intact and to never dress an unprocessed record set up as a dataset.
 */
class TransformStepHandlerTest {

    private static final Map<String, Object> FIELD = Map.of("key", "channel_name", "label",
            "Channel", "type", "STRING", "required", true);

    private AiServiceClient client;
    private StepRepository steps;
    private TransformStepHandler handler;

    @BeforeEach
    void setUp() {
        client = mock(AiServiceClient.class);
        steps = mock(StepRepository.class);
        handler = new TransformStepHandler(client, steps);
    }

    @Test
    void the_step_sends_the_contract_it_was_configured_with_and_what_the_run_collected() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(
                collected("Coding Cat"), collected("Sentdex")), "recordCount", 2));
        when(client.processQuality(any())).thenReturn(pipelineResult("COMPLETED", 2, 0));

        handler.handle(context(Map.of(), () -> true, () -> false));

        ArgumentCaptor<QualityRequest> sent = ArgumentCaptor.forClass(QualityRequest.class);
        verify(client).processQuality(sent.capture());
        QualityRequest request = sent.getValue();
        assertThat(request.records()).hasSize(2);
        assertThat(request.entityType()).isEqualTo("youtube_channel");
        assertThat(request.objective()).isEqualTo("list coding channels");
        assertThat(request.fields()).containsExactly(FIELD);
        assertThat(request.requiredFields()).containsExactly("channel_name");
        assertThat(request.deduplicationKeys()).containsExactly("channel_url");
        assertThat(request.validationRules()).hasSize(1);
        assertThat(request.extractionSchema()).containsEntry("type", "object");
        // The count the collection step reported, not the length of the list it happened to receive:
        // a caller that says how many it sent is what makes an earlier loss visible.
        assertThat(request.rawRecordCount()).isEqualTo(2);
    }

    @Test
    void an_absent_raw_count_is_sent_as_absent_rather_than_backfilled_with_the_list_length() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(collected("Coding Cat"))));
        when(client.processQuality(any())).thenReturn(pipelineResult("COMPLETED", 1, 0));

        handler.handle(context(Map.of(), () -> true, () -> false));

        ArgumentCaptor<QualityRequest> sent = ArgumentCaptor.forClass(QualityRequest.class);
        verify(client).processQuality(sent.capture());
        assertThat(sent.getValue().rawRecordCount()).isNull();
    }

    @Test
    void a_completed_run_stores_the_pipeline_records_with_their_provenance_and_its_own_counts() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(
                collected("Coding Cat"), collected("Sentdex")), "recordCount", 2));
        when(client.processQuality(any())).thenReturn(pipelineResult("COMPLETED", 2, 1));

        StepOutcome outcome = handler.handle(context(Map.of(), () -> true, () -> false));

        assertThat(outcome.status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(outcome.summary()).containsEntry("pipelineStatus", "COMPLETED")
                .containsEntry("recordsIn", 2);
        assertThat(outcome.summary()).containsKey("stages").containsKey("quality")
                .containsKey("dataset").containsKey("records");
        assertThat(outcome.summary().get("validityIsAdvisory")).isNotNull();
        assertThat(outcome.summary()).containsEntry("datasetRowCount", 2);
        assertThat(outcome.counters().duplicates()).isEqualTo(1);
        // The counter ownership rule: the collection step already reported what it found and what it
        // collected, so a step that added the same records again would double the run's size.
        assertThat(outcome.counters().recordsFound()).isZero();
        assertThat(outcome.counters().recordsRaw()).isZero();
        assertThat(outcome.counters().recordsValid()).isZero();
    }

    @Test
    void the_records_are_stored_as_the_pipeline_sent_them_so_the_next_step_can_read_the_typed_shape() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(collected("Coding Cat")),
                "recordCount", 1));
        when(client.processQuality(any())).thenReturn(pipelineResult("COMPLETED", 1, 1));

        StepOutcome outcome = handler.handle(context(Map.of(), () -> true, () -> false));

        // Round-trip through the JSON column, which is exactly what the validate step will do.
        String stored = Json.write(outcome.summary());
        Map<String, Object> reread = Json.object(stored);
        List<QualityResult.Record> records =
                Json.list(reread.get("records"), QualityResult.Record.class);

        assertThat(records).hasSize(2);
        assertThat(records.get(0).values()).containsEntry("channel_name", "Coding Cat");
        assertThat(records.get(0).sources()).hasSize(1);
        assertThat(records.get(0).sources().get(0).verifiedByTool()).isTrue();
        assertThat(records.get(1).duplicateOf()).isZero();
        Map<String, Object> dataset = Json.map(reread.get("dataset"));
        assertThat(Json.list(dataset.get("columns"), QualityResult.Column.class))
                .extracting(QualityResult.Column::key).containsExactly("channel_name");
        assertThat(dataset.get("rowRecordIndexes")).isEqualTo(List.of(0));
    }

    @Test
    void a_pipeline_that_failed_stops_the_run_instead_of_passing_the_raw_records_on_as_clean() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(collected("Coding Cat")),
                "recordCount", 1));
        when(client.processQuality(any())).thenReturn(new QualityResult("FAILED", List.of(), null,
                List.of(stage("normalize", "FAILED", "ValueError: bad field map")), null, List.of(),
                "normalization did not complete"));

        StepOutcome outcome = handler.handle(context(Map.of(), () -> true, () -> false));

        assertThat(outcome.status()).isEqualTo(JobStatus.FAILED);
        assertThat(outcome.errorCode()).isEqualTo("QUALITY_PIPELINE_FAILED");
        // The pipeline's own reason, not a generic one: whoever reads the run row should not have to
        // guess which stage died.
        assertThat(outcome.errorMessage()).isEqualTo("normalization did not complete");
    }

    @Test
    void a_stage_that_died_mid_run_is_a_completed_step_that_says_it_is_partial() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(collected("Coding Cat")),
                "recordCount", 1));
        when(client.processQuality(any())).thenReturn(new QualityResult("COMPLETED_WITH_WARNINGS",
                List.of(record(0, "Coding Cat", true, null)),
                new QualityResult.Dataset(List.of(), List.of()),
                List.of(stage("normalize", "COMPLETED", null),
                        stage("resolve", "FAILED", "KeyError: values")),
                quality(1, 1, 0), List.of("the resolve stage failed"), null));

        StepOutcome outcome = handler.handle(context(Map.of(), () -> true, () -> false));

        assertThat(outcome.status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(outcome.summary().get("stageFailures").toString()).contains("resolve")
                .contains("KeyError");
        assertThat(outcome.summary()).containsKey("partialProcessing");
        assertThat(outcome.summary()).containsEntry("pipelineWarnings",
                List.of("the resolve stage failed"));
    }

    @Test
    void nothing_collected_is_a_failure_the_step_names_instead_of_an_empty_pipeline_call() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(), "recordCount", 0));

        StepOutcome outcome = handler.handle(context(Map.of(), () -> true, () -> false));

        assertThat(outcome.status()).isEqualTo(JobStatus.FAILED);
        assertThat(outcome.errorCode()).isEqualTo("NOTHING_COLLECTED");
        verify(client, never()).processQuality(any());
    }

    @Test
    void a_dependency_that_produced_no_output_is_reported_as_such() {
        when(steps.findByKey(anyString(), anyString())).thenReturn(Optional.empty());

        StepOutcome outcome = handler.handle(context(Map.of(), () -> true, () -> false));

        assertThat(outcome.errorCode()).isEqualTo("NO_COLLECT_OUTPUT");
        verify(client, never()).processQuality(any());
    }

    @Test
    void a_dependency_that_did_not_finish_is_an_error_rather_than_a_silently_empty_dataset() {
        collectStep(JobStatus.FAILED, null);

        assertThatThrownBy(() -> handler.handle(context(Map.of(), () -> true, () -> false)))
                .isInstanceOf(JobExecutionException.class)
                .extracting(e -> ((JobExecutionException) e).code())
                .isEqualTo("DEPENDENCY_NOT_COMPLETED");
    }

    @Test
    void a_422_from_the_boundary_is_permanent_because_retrying_sends_the_same_rejected_bytes() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(collected("Coding Cat")),
                "recordCount", 1));
        when(client.processQuality(any())).thenThrow(new AiServiceClient.AiServiceException(422,
                "schema rejected the record shape", null));

        assertThatThrownBy(() -> handler.handle(context(Map.of(), () -> true, () -> false)))
                .isInstanceOfSatisfying(JobExecutionException.class, e -> {
                    assertThat(e.code()).isEqualTo("AI_SERVICE_REJECTED");
                    assertThat(e.retryable()).isFalse();
                    assertThat(e.getMessage()).contains("schema rejected the record shape");
                });
    }

    @Test
    void a_service_unavailable_is_transient_so_the_worker_tries_again_under_the_backoff() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(collected("Coding Cat")),
                "recordCount", 1));
        when(client.processQuality(any())).thenThrow(new AiServiceClient.AiServiceException(503,
                "maintenance", null));

        assertThatThrownBy(() -> handler.handle(context(Map.of(), () -> true, () -> false)))
                .isInstanceOfSatisfying(JobExecutionException.class, e -> {
                    assertThat(e.code()).isEqualTo(JobExecutionException.SERVER_ERROR);
                    assertThat(e.retryable()).isTrue();
                });
    }

    @Test
    void an_unreachable_boundary_is_transient_and_names_the_failure_kind_not_a_stack() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(collected("Coding Cat")),
                "recordCount", 1));
        when(client.processQuality(any())).thenThrow(new ResourceAccessException("connect refused"));

        assertThatThrownBy(() -> handler.handle(context(Map.of(), () -> true, () -> false)))
                .isInstanceOfSatisfying(JobExecutionException.class, e -> {
                    assertThat(e.code()).isEqualTo(JobExecutionException.TRANSIENT_NETWORK);
                    assertThat(e.retryable()).isTrue();
                    assertThat(e.getMessage()).doesNotContain("connect refused\n");
                });
    }

    @Test
    void a_null_body_is_a_fault_said_out_loud_rather_than_an_empty_successful_dataset() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(collected("Coding Cat")),
                "recordCount", 1));
        when(client.processQuality(any())).thenReturn(null);

        assertThatThrownBy(() -> handler.handle(context(Map.of(), () -> true, () -> false)))
                .isInstanceOfSatisfying(JobExecutionException.class, e -> {
                    assertThat(e.code()).isEqualTo("EMPTY_UPSTREAM_RESPONSE");
                    assertThat(e.retryable()).isFalse();
                });
    }

    @Test
    void a_worker_that_lost_its_lease_never_starts_a_billable_run_it_cannot_report() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(collected("Coding Cat")),
                "recordCount", 1));

        assertThatThrownBy(() -> handler.handle(context(Map.of(), () -> false, () -> false)))
                .isInstanceOfSatisfying(JobExecutionException.class, e -> {
                    assertThat(e.code()).isEqualTo("LEASE_LOST");
                    assertThat(e.retryable()).isFalse();
                });
        verify(client, never()).processQuality(any());
    }

    @Test
    void a_cancelled_run_stops_at_the_step_boundary_before_sending_anything() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(collected("Coding Cat")),
                "recordCount", 1));

        assertThatThrownBy(() -> handler.handle(context(Map.of(), () -> true, () -> true)))
                .isInstanceOfSatisfying(JobExecutionException.class, e ->
                        assertThat(e.code()).isEqualTo("RUN_CANCELLED"));
        verify(client, never()).processQuality(any());
    }

    @Test
    void config_the_step_cannot_read_without_guessing_is_reported_as_missing() {
        Run run = run();
        Step step = step();
        Job job = job();
        StepContext context = new StepContext(run, step, plan(), job, Map.of("stepKey", "transform",
                "type", "TRANSFORM"), "worker-1", () -> true, () -> false);

        assertThatThrownBy(() -> handler.handle(context)).isInstanceOf(JobExecutionException.class);
    }

    // ------------------------------------------------------------------------ fixtures

    private Map<String, Object> configExtra() {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("extractionSchema", Map.of("type", "object"));
        config.put("entityType", "youtube_channel");
        config.put("objective", "list coding channels");
        config.put("fields", List.of(FIELD));
        config.put("requiredFields", List.of("channel_name"));
        config.put("deduplicationKeys", List.of("channel_url"));
        config.put("validationRules", List.of(Map.of("rule", "min", "field", "subscribers",
                "params", Map.of("value", 1))));
        return config;
    }

    private StepContext context(Map<String, Object> ignored, java.util.function.BooleanSupplier lease,
                               java.util.function.BooleanSupplier cancel) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("stepKey", "transform");
        payload.put("type", "TRANSFORM");
        payload.put("config", configExtra());
        return new StepContext(run(), step(), plan(), job(), payload, "worker-1", lease, cancel);
    }

    private void collectStep(JobStatus status, Map<String, Object> output) {
        Step collect = new Step("step-collect", "ws-1", "run-1", 1, "collect", 0, "[]", "EXTRACT",
                status, 1, 0, "{}", output == null ? null : Json.write(output), 900L,
                status == JobStatus.COMPLETED ? null : "RESEARCH_FAILED",
                status == JobStatus.COMPLETED ? null : "nothing collected", Instant.now(),
                Instant.now());
        when(steps.findByKey(anyString(), anyString())).thenReturn(Optional.of(collect));
    }

    private static Map<String, Object> collected(String name) {
        return Map.of("values", Map.of("channel_name", name, "channel_url",
                        "https://youtube.test/" + name),
                "sources", List.of(Map.of("url", "https://youtube.test/" + name,
                        "verifiedByTool", true, "sourceType", "scrape")));
    }

    private static QualityResult pipelineResult(String status, int canonical, int duplicates) {
        List<QualityResult.Record> records = new ArrayList<>();
        List<QualityResult.Row> rows = new ArrayList<>();
        for (int index = 0; index < canonical; index++) {
            records.add(record(index, "Coding Cat", true, null));
            rows.add(new QualityResult.Row(index, Map.of("channel_name", "Coding Cat")));
        }
        for (int extra = 0; extra < duplicates; extra++) {
            records.add(record(canonical + extra, "Coding Cat", true, canonical - 1 - extra));
        }
        return new QualityResult(status, records,
                new QualityResult.Dataset(List.of(new QualityResult.Column("channel_name",
                        "Channel", "STRING", true, 0)), rows),
                List.of(stage("normalize", "COMPLETED", null), stage("score", "COMPLETED", null)),
                quality(records.size(), records.size(), duplicates), List.of(), null);
    }

    private static QualityResult.Record record(int index, String name, boolean valid,
                                               Integer duplicateOf) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("channel_name", name);
        return new QualityResult.Record(index, values, values,
                List.of(new QualityResult.Source("https://youtube.test/" + index, "t", "s", "scrape",
                        "2026-02-01T00:00:00Z", true)),
                valid, List.of(), "SOURCE_CITED", null, null, duplicateOf, null,
                duplicateOf == null ? null : "EXACT", false, List.of(), List.of(), List.of());
    }

    private static QualityResult.Stage stage(String name, String status, String error) {
        return new QualityResult.Stage(name, status, 1, 1, Map.of(), List.of(), error);
    }

    private static QualityResult.Quality quality(int raw, int normalized, int duplicates) {
        return new QualityResult.Quality(raw, normalized, normalized, 0, duplicates, 0, 0, raw,
                0.5, "equal-weight mean of five measured ratios",
                Map.of("completeness", 1.0), Map.of());
    }

    private static Run run() {
        return new Run("run-1", "ws-1", "wf-1", "plan-1", RunStatus.RUNNING, 1, 0,
                0, 0, 0, 0, 0, 0, null, null, null, Instant.now(), null, Instant.now());
    }

    private static Step step() {
        return new Step("step-transform", "ws-1", "run-1", 1, "transform", 1,
                Json.write(List.of("collect")), "TRANSFORM", JobStatus.RUNNING, 1, 0, "{}", null,
                null, null, null, Instant.now(), null);
    }

    private static Plan plan() {
        return new Plan("plan-1", "ws-1", "wf-1", 1, "objective", "{}", "{}", "[]", "{}", "{}",
                "{}", "hash", "00000000-0000-0000-0000-000000000000", Instant.now());
    }

    private static Job job() {
        return new Job("job-1", "ws-1", "run-1", null, "WORKFLOW_STEP", "step-transform", "{}",
                JobStatus.RUNNING, 101, 1, 3, Instant.now(), Instant.now().plusSeconds(90),
                "worker-1", 2, null, null, null, Instant.now(), Instant.now(), null, Instant.now());
    }
}
