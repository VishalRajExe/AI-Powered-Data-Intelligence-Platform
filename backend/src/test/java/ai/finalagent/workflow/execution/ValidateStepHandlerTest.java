package ai.finalagent.workflow.execution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.domain.Records.Plan;
import ai.finalagent.workflow.domain.Records.Run;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.domain.RunStatus;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.support.Json;

/**
 * Java's own enforcement of the contract the AI service claimed to satisfy. The cases are the ones
 * that used to be silently absorbed: a blank required field, a record citing nothing a tool
 * retrieved, the same entity twice, and a collection step that produced no output at all.
 *
 * <p>None of them delete a record. They are counted and reported, because a short dataset with no
 * explanation is indistinguishable from a search that genuinely found little.
 */
class ValidateStepHandlerTest {

    private static final List<String> REQUIRED = List.of("channel_name", "subscribers");
    private static final List<String> DEDUP = List.of("channel_name");

    private StepRepository steps;
    private ValidateStepHandler handler;

    @BeforeEach
    void setUp() {
        steps = mock(StepRepository.class);
        handler = new ValidateStepHandler(steps);
    }

    private static Map<String, Object> record(String name, Object subscribers, boolean verified) {
        Map<String, Object> values = new java.util.LinkedHashMap<>();
        if (name != null) {
            values.put("channel_name", name);
        }
        if (subscribers != null) {
            values.put("subscribers", subscribers);
        }
        List<Map<String, Object>> sources = verified
                ? List.of(Map.of("url", "https://youtube.test/c/" + name, "verifiedByTool", true))
                : List.of(Map.of("url", "https://mentioned.test/x", "verifiedByTool", false));
        return Map.of("values", values, "sources", sources);
    }

    private void collectStep(JobStatus status, Map<String, Object> output) {
        Step collect = new Step("step-collect", "ws-1", "run-1", 1, "collect", 0, "[]", "EXTRACT",
                status, 1, 0, "{}", output == null ? null : Json.write(output), 1200L,
                status == JobStatus.COMPLETED ? null : "RESEARCH_FAILED",
                status == JobStatus.COMPLETED ? null : "the run failed", Instant.now(), Instant.now());
        when(steps.findByKey(anyString(), anyString())).thenReturn(Optional.of(collect));
    }

    private static StepContext context(Map<String, Object> config) {
        Run run = new Run("run-1", "ws-1", "wf-1", "plan-1", RunStatus.RUNNING, 1, 50,
                0, 0, 0, 0, 0, 0, null, null, null, Instant.now(), null, Instant.now());
        Step validate = new Step("step-validate", "ws-1", "run-1", 1, "validate", 1,
                Json.write(List.of("collect")), "VALIDATE", JobStatus.RUNNING, 1, 0, "{}", null,
                null, null, null, Instant.now(), null);
        Plan plan = new Plan("plan-1", "ws-1", "wf-1", 1, "objective", "{}", "{}", "[]", "{}", "{}",
                "{}", "hash", "00000000-0000-0000-0000-000000000000", Instant.now());
        Job job = new Job("job-1", "ws-1", "run-1", null, "WORKFLOW_STEP", "step-validate", "{}",
                JobStatus.RUNNING, 101, 1, 3, Instant.now(), Instant.now().plusSeconds(90),
                "worker-1", 2, null, null, null, Instant.now(), Instant.now(), null, Instant.now());
        return new StepContext(run, validate, plan, job,
                Map.of("stepKey", "validate", "type", "VALIDATE", "config", config), "worker-1",
                () -> true, () -> false);
    }

    private static Map<String, Object> config() {
        return Map.of("extractionSchema", Map.of("type", "object"),
                "requiredFields", REQUIRED, "deduplicationKeys", DEDUP);
    }

    @Test
    void recordsThatSatisfyTheContractAreCountedValidAndTheStepCompletes() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(
                record("coding-cat", 250000, true), record("sentdex", 900000, true))));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(outcome.summary()).containsEntry("recordsFound", 2)
                .containsEntry("recordsValid", 2)
                .containsEntry("issues", List.of())
                .containsEntry("enforcedBy", "backend");
    }

    /**
     * The counter ownership rule: the collection step already added what it found, so a validator
     * that added it again would report twice the records the run ever collected.
     */
    @Test
    void theValidatorContributesOnlyTheVerdictsToTheRunCounters() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(
                record("coding-cat", 1, true), record("duplicate-cat", 2, true),
                record("duplicate-cat", 3, true))));

        StepOutcome.Counters counters = handler.handle(context(config())).counters();

        assertThat(counters.recordsFound()).isZero();
        assertThat(counters.recordsRaw()).isZero();
        assertThat(counters.recordsValid()).isEqualTo(2);
        assertThat(counters.duplicates()).isEqualTo(1);
        assertThat(counters.sourcesProcessed()).isZero();
    }

    @Test
    void aBlankRequiredFieldIsAFindingNotADroppedRow() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(
                record("coding-cat", "   ", true))));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.status()).isEqualTo(JobStatus.FAILED);
        assertThat(outcome.errorCode()).isEqualTo("NO_VALID_RECORDS");
        assertThat(findings(outcome).get(0).get("reasons").toString()).contains("subscribers");
        // Kept, and counted as collected, so the shortfall is visible instead of invisible.
        assertThat(outcome.summary()).containsEntry("recordsFound", 1);
    }

    @Test
    void aMissingRequiredFieldIsReportedByItsName() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(
                Map.of("values", Map.of("subscribers", 10), "sources", List.of(
                        Map.of("url", "https://youtube.test/c/x", "verifiedByTool", true))))));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(findings(outcome).get(0).get("reasons").toString()).contains("channel_name");
    }

    @Test
    void aRecordWhoseCitedSourceWasNeverRetrievedByAToolIsNotValid() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(
                record("coding-cat", 100, false))));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.status()).isEqualTo(JobStatus.FAILED);
        assertThat(findings(outcome).get(0).get("reasons").toString())
                .contains("cites no source a tool retrieved");
    }

    @Test
    void aDuplicateIdentityIsCountedAndFlaggedButTheRecordSurvives() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(
                record("same-cat", 100, true), record("same-cat", 200, true),
                record("other-cat", 300, true))));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.summary()).containsEntry("duplicates", 1).containsEntry("recordsValid", 2);
        Map<String, Object> duplicate = findings(outcome).get(0);
        assertThat(duplicate).containsEntry("index", 1).containsEntry("duplicate", true);
        assertThat(duplicate.get("reasons").toString()).contains("same identity");
    }

    @Test
    void deduplicationIsCaseAndWhitespaceInsensitiveBecauseThatIsWhatADuplicateMeans() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of(
                record("Coding-Cat", 100, true), record("  coding-cat ", 200, true))));

        assertThat(handler.handle(context(config())).summary()).containsEntry("duplicates", 1);
    }

    @Test
    void aCollectionStepThatDidNotCompleteCannotProduceAValidatedResult() {
        collectStep(JobStatus.FAILED, null);

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.status()).isEqualTo(JobStatus.FAILED);
        assertThat(outcome.errorCode()).isEqualTo("COLLECT_NOT_COMPLETED");
        assertThat(outcome.errorMessage()).contains("FAILED").contains("RESEARCH_FAILED");
    }

    @Test
    void aCollectionStepWithNoOutputAtAllIsReportedAsSuch() {
        when(steps.findByKey(anyString(), anyString())).thenReturn(Optional.empty());

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.errorCode()).isEqualTo("NO_COLLECT_OUTPUT");
    }

    @Test
    void emptyRecordsAreAFailureRatherThanAVacuousSuccess() {
        collectStep(JobStatus.COMPLETED, Map.of("records", List.of()));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.status()).isEqualTo(JobStatus.FAILED);
        assertThat(outcome.errorCode()).isEqualTo("NO_RECORDS");
    }

    @Test
    void aStepWithNoDependencyEdgeCannotValidateAnything() {
        Run run = new Run("run-1", "ws-1", "wf-1", "plan-1", RunStatus.RUNNING, 1, 0,
                0, 0, 0, 0, 0, 0, null, null, null, Instant.now(), null, Instant.now());
        Step orphan = new Step("step-validate", "ws-1", "run-1", 1, "validate", 1, "[]", "VALIDATE",
                JobStatus.RUNNING, 1, 0, "{}", null, null, null, null, Instant.now(), null);
        Plan plan = new Plan("plan-1", "ws-1", "wf-1", 1, "objective", "{}", "{}", "[]", "{}", "{}",
                "{}", "hash", "00000000-0000-0000-0000-000000000000", Instant.now());
        Job job = new Job("job-1", "ws-1", "run-1", null, "WORKFLOW_STEP", "step-validate", "{}",
                JobStatus.RUNNING, 101, 1, 3, Instant.now(), Instant.now().plusSeconds(90),
                "worker-1", 2, null, null, null, Instant.now(), Instant.now(), null, Instant.now());

        StepOutcome outcome = handler.handle(new StepContext(run, orphan, plan, job,
                Map.of("config", config()), "worker-1", () -> true, () -> false));

        assertThat(outcome.errorCode()).isEqualTo("NO_COLLECT_OUTPUT");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> findings(StepOutcome outcome) {
        return (List<Map<String, Object>>) outcome.summary().get("issues");
    }
}
