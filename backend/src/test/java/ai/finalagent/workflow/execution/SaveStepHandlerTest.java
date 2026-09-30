package ai.finalagent.workflow.execution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
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
import java.util.function.BooleanSupplier;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import ai.finalagent.aiclient.dto.QualityResult;
import ai.finalagent.dataset.domain.DatasetDraft;
import ai.finalagent.dataset.repository.DatasetRepository;
import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.domain.Records.Plan;
import ai.finalagent.workflow.domain.Records.Run;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.domain.Records.Workflow;
import ai.finalagent.workflow.domain.RunStatus;
import ai.finalagent.workflow.repository.ActivityRepository;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.repository.WorkflowRepository;
import ai.finalagent.workflow.support.Json;

/**
 * The save step: reading the two steps before it, and writing one dataset.
 *
 * <p>The unit being tested here is the handoff, not the schema — {@code DatasetPlatformMySqlTest}
 * covers the rows against a real database. What this class must get right is which inputs it reads,
 * what it refuses to write when one of them is missing, and what it does with a worker that no longer
 * owns the job.
 */
class SaveStepHandlerTest {

    private StepRepository steps;
    private WorkflowRepository workflows;
    private ActivityRepository activity;
    private DatasetRepository datasets;
    private SaveStepHandler handler;

    @BeforeEach
    void setUp() {
        steps = mock(StepRepository.class);
        workflows = mock(WorkflowRepository.class);
        activity = mock(ActivityRepository.class);
        datasets = mock(DatasetRepository.class);
        handler = new SaveStepHandler(steps, workflows, activity, datasets);
        when(workflows.findById(anyString())).thenReturn(Optional.of(new Workflow("wf-1", "ws-1",
                "user-1", "list postings", "list job postings with salary", "ACTIVE", "PLANNED",
                null, null, Instant.now(), Instant.now())));
    }

    @Test
    void itReadsThePipelineRecordsAndJavasVerdictsAndWritesOneDataset() {
        transformStep(JobStatus.COMPLETED, transformOutput());
        validateStep(JobStatus.COMPLETED, validateOutput(Map.of(0, true, 1, false)));

        StepOutcome outcome = handler.handle(context(Map.of(), () -> true, () -> false));

        assertThat(outcome.status()).isEqualTo(JobStatus.COMPLETED);
        DatasetDraft draft = captured();
        assertThat(draft.rows()).hasSize(2);
        assertThat(draft.header().runId()).isEqualTo("run-1");
        assertThat(draft.header().stepId()).isEqualTo("step-save");
        assertThat(draft.header().workflowId()).isEqualTo("wf-1");
        assertThat(draft.header().planId()).isEqualTo("plan-1");
        // Java's verdict is what lands on the row, and the pipeline's is kept beside it.
        assertThat(draft.rows().get(1).valid()).isFalse();
        assertThat(draft.rows().get(1).advisoryValid()).isTrue();
        assertThat(draft.header().requirementText()).isEqualTo("list job postings with salary");
        // No run-level counter belongs to this step. Collection added what it found, the pipeline
        // added what it linked, validation added the verdicts — a save adding `validRowCount` again
        // reported a run of twice the rows it had, which is what the first four-step run showed.
        assertThat(outcome.counters().recordsValid()).isZero();
        assertThat(outcome.counters().recordsFound()).isZero();
        assertThat(outcome.counters().recordsRaw()).isZero();
        assertThat(outcome.counters().sourcesProcessed()).isZero();
        assertThat(outcome.summary()).containsEntry("rowCount", 2)
                .containsEntry("validRowCount", 1)
                .containsEntry("invalidRowCount", 1)
                .containsEntry("sourceCount", 1);
    }

    @Test
    void theDatasetIdOfAnEarlierAttemptIsReusedRatherThanAbandoned() {
        transformStep(JobStatus.COMPLETED, transformOutput());
        validateStep(JobStatus.COMPLETED, validateOutput(Map.of(0, true, 1, true)));
        when(datasets.findByRun("ws-1", "run-1")).thenReturn(Optional.of(
                new ai.finalagent.dataset.domain.DatasetRows.Dataset("dataset-existing", "ws-1",
                        "run-1", "wf-1", "plan-1", "step-save", "objective", null, null, "{}",
                        "READY", 2, 2, 0, 0, 0, 1, 1, 0, 0, 0, 0.5, "basis", null, null, null,
                        Instant.now(), Instant.now())));

        StepOutcome outcome = handler.handle(context(Map.of(), () -> true, () -> false));

        ArgumentCaptor<String> ids = ArgumentCaptor.forClass(String.class);
        verify(datasets).save(ids.capture(), any());
        assertThat(ids.getValue()).isEqualTo("dataset-existing");
        assertThat(outcome.summary()).containsEntry("datasetId", "dataset-existing");
    }

    @Test
    void a_refused_page_travels_from_the_collection_through_the_pipeline_into_the_dataset() {
        Map<String, Object> output = transformOutput();
        output.put("sourcesRefused", List.of(Map.of("url", "https://blocked.test/postings",
                "code", "ROBOTS_DISALLOWED", "reason", "robots.txt disallows /postings")));
        transformStep(JobStatus.COMPLETED, output);
        validateStep(JobStatus.COMPLETED, validateOutput(Map.of(0, true, 1, true)));

        handler.handle(context(Map.of(), () -> true, () -> false));

        DatasetDraft draft = captured();
        assertThat(draft.blockedSourceCount()).isEqualTo(1);
        assertThat(draft.sources()).anySatisfy(source -> {
            assertThat(source.url()).isEqualTo("https://blocked.test/postings");
            assertThat(source.provenance()).isEqualTo("REFUSED_BEFORE_FETCH");
            assertThat(source.blockedCode()).isEqualTo("ROBOTS_DISALLOWED");
        });
    }

    @Test
    void noVerdictsFromTheValidatingStepMeansNothingIsWritten() {
        transformStep(JobStatus.COMPLETED, transformOutput());
        validateStep(JobStatus.COMPLETED, Map.of("pipelineStatus", "COMPLETED"));

        StepOutcome outcome = handler.handle(context(Map.of(), () -> true, () -> false));

        assertThat(outcome.status()).isEqualTo(JobStatus.FAILED);
        assertThat(outcome.errorCode()).isEqualTo("NO_ROW_VERDICTS");
        verify(datasets, never()).save(anyString(), any());
    }

    @Test
    void aMissingPipelineStepLeavesNothingToSaveAndSaysWhichOneIsMissing() {
        when(steps.findByKey(eq("run-1"), eq("transform"))).thenReturn(Optional.empty());
        validateStep(JobStatus.COMPLETED, validateOutput(Map.of(0, true)));

        StepOutcome outcome = handler.handle(context(Map.of(), () -> true, () -> false));

        assertThat(outcome.errorCode()).isEqualTo("NO_DATASET_INPUT");
        verify(datasets, never()).save(anyString(), any());
    }

    @Test
    void aDependencyThatDidNotFinishIsAnErrorRatherThanAnEmptyDataset() {
        transformStep(JobStatus.FAILED, null);
        validateStep(JobStatus.COMPLETED, validateOutput(Map.of(0, true)));

        assertThatThrownBy(() -> handler.handle(context(Map.of(), () -> true, () -> false)))
                .isInstanceOfSatisfying(JobExecutionException.class, e -> {
                    assertThat(e.code()).isEqualTo("DEPENDENCY_NOT_COMPLETED");
                    assertThat(e.getMessage()).contains("transform").contains("QUALITY_PIPELINE_FAILED");
                });
        verify(datasets, never()).save(anyString(), any());
    }

    @Test
    void aWorkerThatLostItsLeaseNeverWritesADataset() {
        transformStep(JobStatus.COMPLETED, transformOutput());
        validateStep(JobStatus.COMPLETED, validateOutput(Map.of(0, true)));

        assertThatThrownBy(() -> handler.handle(context(Map.of(), () -> false, () -> false)))
                .isInstanceOfSatisfying(JobExecutionException.class, e -> {
                    assertThat(e.code()).isEqualTo("LEASE_LOST");
                    assertThat(e.retryable()).isFalse();
                });
        verify(datasets, never()).save(anyString(), any());
    }

    @Test
    void aCancelledRunStopsBeforeTheWrite() {
        transformStep(JobStatus.COMPLETED, transformOutput());
        validateStep(JobStatus.COMPLETED, validateOutput(Map.of(0, true)));

        assertThatThrownBy(() -> handler.handle(context(Map.of(), () -> true, () -> true)))
                .isInstanceOfSatisfying(JobExecutionException.class, e ->
                        assertThat(e.code()).isEqualTo("RUN_CANCELLED"));
        verify(datasets, never()).save(anyString(), any());
    }

    @Test
    void aStepWithNoEdgesWritesNothingBecauseItHasNoInputsToRead() {
        Step orphan = new Step("step-save", "ws-1", "run-1", 1, "save", 3, "[]", "SAVE",
                JobStatus.RUNNING, 1, 0, "{}", null, null, null, null, Instant.now(), null);

        StepOutcome outcome = handler.handle(context(Map.of(), () -> true, () -> false, orphan));

        assertThat(outcome.errorCode()).isEqualTo("NO_DATASET_INPUT");
    }

    // ------------------------------------------------------------------------ fixtures

    private DatasetDraft captured() {
        ArgumentCaptor<DatasetDraft> captor = ArgumentCaptor.forClass(DatasetDraft.class);
        verify(datasets).save(anyString(), captor.capture());
        return captor.getValue();
    }

    private void transformStep(JobStatus status, Map<String, Object> output) {
        when(steps.findByKey(eq("run-1"), eq("transform"))).thenReturn(Optional.of(
                step("transform", 1, List.of("collect"), "TRANSFORM", status,
                        output == null ? null : Json.write(output), "QUALITY_PIPELINE_FAILED")));
    }

    private void validateStep(JobStatus status, Map<String, Object> output) {
        when(steps.findByKey(eq("run-1"), eq("validate"))).thenReturn(Optional.of(
                step("validate", 2, List.of("transform"), "VALIDATE", status,
                        Json.write(output), "NO_VALID_ROWS")));
    }

    private static Step step(String key, int sequence, List<String> dependsOn, String type,
                             JobStatus status, String output, String errorCode) {
        return new Step("step-" + key, "ws-1", "run-1", 1, key, sequence, Json.write(dependsOn),
                type, status, 1, 0, "{}", output, 500L,
                status == JobStatus.COMPLETED ? null : errorCode,
                status == JobStatus.COMPLETED ? null : "the step failed", Instant.now(),
                Instant.now());
    }

    /** What the transform step stores: the pipeline's records, in the shape the service sent them. */
    private static Map<String, Object> transformOutput() {
        List<QualityResult.Record> records = new ArrayList<>();
        for (int index = 0; index < 2; index++) {
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("role_title", index == 0 ? "Backend engineer" : "Data engineer");
            values.put("posting_url", "https://jobs.test/b/" + (index + 1));
            records.add(new QualityResult.Record(index, values, values,
                    List.of(new QualityResult.Source("https://jobs.test/b/1", "A posting", "s",
                            "scrape", "2026-02-01T09:00:00Z", true)),
                    true, List.of(), "SOURCE_CITED", null, 0.8, null, null, null, false, List.of(),
                    List.of(), List.of()));
        }
        Map<String, Object> dataset = new LinkedHashMap<>();
        dataset.put("columns", List.of(new QualityResult.Column("role_title", "Role", "STRING",
                true, 0)));
        dataset.put("rowCount", 2);
        dataset.put("rowRecordIndexes", List.of(0, 1));
        Map<String, Object> quality = new LinkedHashMap<>();
        quality.put("advisoryValidCount", 2);
        quality.put("qualityScore", 0.62);
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("pipelineStatus", "COMPLETED");
        output.put("records", records);
        output.put("dataset", dataset);
        output.put("quality", quality);
        return output;
    }

    private static Map<String, Object> validateOutput(Map<Integer, Boolean> javaVerdicts) {
        List<Map<String, Object>> rows = new ArrayList<>();
        javaVerdicts.forEach((index, valid) -> {
            Map<String, Object> verdict = new LinkedHashMap<>();
            verdict.put("index", index);
            verdict.put("javaValid", valid);
            verdict.put("advisoryValid", true);
            verdict.put("errors", valid ? 0 : 1);
            verdict.put("warnings", 0);
            rows.add(verdict);
        });
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("pipelineStatus", "COMPLETED");
        output.put("contractBasis", "plan");
        output.put("rowVerdicts", rows);
        return output;
    }

    private static Map<String, Object> config() {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("extractionSchema", Map.of("type", "object"));
        config.put("entityType", "job_posting");
        config.put("objective", "list job postings");
        config.put("fields", List.of(
                Map.of("key", "role_title", "type", "STRING", "required", true),
                Map.of("key", "posting_url", "type", "URL", "required", true)));
        config.put("requiredFields", List.of("role_title", "posting_url"));
        return config;
    }

    private StepContext context(Map<String, Object> ignored, BooleanSupplier lease,
                                BooleanSupplier cancel) {
        return context(ignored, lease, cancel, step("save", 3,
                List.of("transform", "validate"), "SAVE", JobStatus.RUNNING, null, null));
    }

    private StepContext context(Map<String, Object> ignored, BooleanSupplier lease,
                                BooleanSupplier cancel, Step saveStep) {
        Run run = new Run("run-1", "ws-1", "wf-1", "plan-1", RunStatus.RUNNING, 1, 75,
                2, 2, 1, 0, 1, 0, null, null, null, Instant.now(), null, Instant.now());
        Plan plan = new Plan("plan-1", "ws-1", "wf-1", 1, "list job postings", "{}", "{}", "[]",
                "{}", "{}", "{}", "hash", "user-1", Instant.now());
        Job job = new Job("job-1", "ws-1", "run-1", null, "WORKFLOW_STEP", "step-save", "{}",
                JobStatus.RUNNING, 103, 1, 3, Instant.now(), Instant.now().plusSeconds(90),
                "worker-1", 2, null, null, null, Instant.now(), Instant.now(), null, Instant.now());
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("stepKey", "save");
        payload.put("type", "SAVE");
        payload.put("config", config());
        return new StepContext(run, saveStep, plan, job, payload, "worker-1", lease, cancel);
    }
}
