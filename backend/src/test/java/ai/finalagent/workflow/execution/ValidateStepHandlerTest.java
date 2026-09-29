package ai.finalagent.workflow.execution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

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
 * Java's own verdict on the dataset the pipeline proposed, and the disagreement between the two.
 *
 * <p>The cases are the ones where the pipeline's answer is defensible about its own work and not
 * enough for the plan: a record whose only citation was never retrieved, a value of the wrong type,
 * a duplicate that points at another duplicate. None of them delete a record — a short dataset with
 * no explanation is indistinguishable from a search that genuinely found little.
 */
class ValidateStepHandlerTest {

    private static final List<Map<String, Object>> FIELDS = List.of(
            Map.of("key", "channel_name", "label", "Channel", "type", "STRING", "required", true),
            Map.of("key", "subscribers", "label", "Subscribers", "type", "NUMBER"),
            Map.of("key", "channel_url", "label", "URL", "type", "URL"));

    private StepRepository steps;
    private ValidateStepHandler handler;

    @BeforeEach
    void setUp() {
        steps = mock(StepRepository.class);
        handler = new ValidateStepHandler(steps);
    }

    @Test
    void rows_that_satisfy_the_contract_are_counted_by_java_not_by_the_pipeline() {
        transformStep(pipeline(
                record(0, values("Coding Cat", 250000, "https://youtube.test/a"), true),
                record(1, values("Sentdex", 900000, "https://youtube.test/b"), true)));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(outcome.summary()).containsEntry("rowsChecked", 2)
                .containsEntry("javaValid", 2)
                .containsEntry("javaInvalid", 0)
                .containsEntry("enforcedBy", "backend")
                .containsEntry("contractBasis", "plan")
                .containsEntry("advisoryDisagreements", 0);
        assertThat(outcome.counters().recordsValid()).isEqualTo(2);
    }

    /**
     * The fabricated pass, in Java's reading: the pipeline vouched for the record because it applied
     * its own rules, and its one cited URL was never retrieved by anything. This is the case where
     * the two verdicts must not be merged into whichever ran last — both are reported.
     */
    @Test
    void a_record_the_pipeline_passed_that_cites_nothing_a_tool_retrieved_is_rejected_here() {
        transformStep(pipeline(record(0, values("Coding Cat", 250000,
                "https://youtube.test/a"), true, source("https://model-mentioned.test", false))));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.status()).isEqualTo(JobStatus.FAILED);
        assertThat(outcome.errorCode()).isEqualTo("NO_VALID_ROWS");
        assertThat(outcome.summary()).containsEntry("javaInvalid", 1)
                .containsEntry("advisoryDisagreements", 1);
        assertThat(findings(outcome)).extracting(finding -> finding.get("ruleCode"))
                .contains("SOURCE_EVIDENCE_UNVERIFIED");
        assertThat(advisory(outcome)).extracting(finding -> finding.get("ruleCode"))
                .containsExactly("ADVISORY_PASSED_HERE_REJECTED");
    }

    @Test
    void a_value_of_the_wrong_type_for_its_declared_field_fails_the_row_under_that_field_name() {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("channel_name", "Coding Cat");
        values.put("subscribers", "250K");

        transformStep(pipeline(record(0, values, true)));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(findings(outcome)).anySatisfy(finding -> {
            assertThat(finding).containsEntry("ruleCode", "TYPE")
                    .containsEntry("fieldKey", "subscribers")
                    .containsEntry("severity", "ERROR");
        });
        assertThat(outcome.summary()).containsEntry("javaValid", 0);
    }

    @Test
    void a_key_the_plan_never_declared_is_reported_as_a_warning_and_the_row_survives() {
        Map<String, Object> values = values("Coding Cat", 250000, "https://youtube.test/a");
        values.put("vibes", 0.9);

        transformStep(pipeline(record(0, values, true)));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(findings(outcome)).extracting(finding -> finding.get("ruleCode"))
                .containsExactly("EXTRA_FIELD");
        assertThat(outcome.summary()).containsEntry("javaValid", 1);
    }

    @Test
    void linked_duplicates_count_as_links_and_are_not_rows_of_the_dataset() {
        transformStep(pipeline(
                record(0, values("Coding Cat", 250000, "https://youtube.test/a"), true),
                duplicate(1, 0, values("Coding Cat", 250000, "https://youtube.test/a"))));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.summary()).containsEntry("rowsChecked", 1)
                .containsEntry("linkedDuplicates", 1);
        assertThat(outcome.counters().recordsValid()).isEqualTo(1);
        assertThat(outcome.counters().duplicates()).isEqualTo(1);
    }

    @Test
    void a_duplicate_linking_on_to_another_duplicate_is_a_broken_link_and_an_error() {
        transformStep(pipeline(
                record(0, values("A", 1, "https://youtube.test/a"), true),
                // 1 → 2 → 1: a chain, so neither link has a home in the dataset.
                duplicate(1, 2, values("A", 1, "https://youtube.test/a")),
                duplicate(2, 1, values("A", 1, "https://youtube.test/a")),
                // And a link to a record that is not in the result at all.
                duplicate(3, 9, values("A", 1, "https://youtube.test/a"))));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(findings(outcome)).extracting(finding -> finding.get("ruleCode"))
                .contains("DUPLICATE_LINK_BROKEN", "DUPLICATE_LINK_DANGLING");
        assertThat(outcome.status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(outcome.summary()).containsEntry("linkedDuplicates", 3)
                .containsEntry("javaValid", 1);
    }

    /**
     * The counter ownership rule across three steps: collection added what it found, the pipeline
     * added what it linked, and this step adds only Java's verdict on validity.
     */
    @Test
    void the_validator_contributes_only_its_own_verdicts_to_the_run_counters() {
        transformStep(pipeline(record(0, values("Coding Cat", 250000,
                "https://youtube.test/a"), true)));

        StepOutcome.Counters counters = handler.handle(context(config())).counters();

        assertThat(counters.recordsFound()).isZero();
        assertThat(counters.recordsRaw()).isZero();
        assertThat(counters.sourcesProcessed()).isZero();
        assertThat(counters.recordsValid()).isEqualTo(1);
    }

    @Test
    void a_pipeline_step_that_did_not_finish_cannot_produce_a_validated_result() {
        Step transform = step("transform", 1, JobStatus.FAILED,
                Json.write(Map.of()), "QUALITY_PIPELINE_FAILED");
        when(steps.findByKey(anyString(), anyString())).thenReturn(Optional.of(transform));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.status()).isEqualTo(JobStatus.FAILED);
        assertThat(outcome.errorCode()).isEqualTo("PIPELINE_NOT_COMPLETED");
        assertThat(outcome.errorMessage()).contains("FAILED").contains("QUALITY_PIPELINE_FAILED");
    }

    @Test
    void a_step_with_no_dependency_edge_has_nothing_to_check_and_says_so() {
        when(steps.findByKey(anyString(), anyString())).thenReturn(Optional.empty());

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.errorCode()).isEqualTo("NO_PIPELINE_OUTPUT");
    }

    @Test
    void an_empty_record_set_is_a_failure_rather_than_a_vacuous_success() {
        transformStep(pipeline());

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.status()).isEqualTo(JobStatus.FAILED);
        assertThat(outcome.errorCode()).isEqualTo("NO_RECORDS");
    }

    @Test
    void the_output_survives_the_json_column_it_was_written_to() {
        // The whole handoff is a JSON column round trip, so a shape that only works in memory is not
        // a shape that works at all.
        QualityResult produced = pipeline(
                record(0, values("Coding Cat", 250000, "https://youtube.test/a"), true),
                record(1, values("Sentdex", 900000, "https://youtube.test/b"), true));
        String column = Json.write(new LinkedHashMap<>(rawOutput(produced)));

        when(steps.findByKey(anyString(), anyString())).thenReturn(Optional.of(
                step("transform", 1, JobStatus.COMPLETED, column, null)));

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.summary()).containsEntry("javaValid", 2).containsEntry("rowsChecked", 2);
    }

    @Test
    void with_no_fields_in_the_plan_the_weaker_fallback_is_announced_rather_than_assumed() {
        transformStep(pipeline(record(0, values("Coding Cat", 250000,
                "https://youtube.test/a"), true)));

        StepOutcome outcome = handler.handle(context(Map.of("requiredFields", List.of(),
                "extractionSchema", Map.of("type", "object"))));

        assertThat(outcome.summary()).containsEntry("contractBasis", "pipeline-columns");
        assertThat(outcome.summary().get("contractWarning")).toString()
                .contains("declared no typed fields");
    }

    @Test
    void a_required_field_the_dataset_never_exported_is_a_structural_fault() {
        QualityResult produced = new QualityResult("COMPLETED",
                List.of(record(0, values("Coding Cat", 250000, "https://youtube.test/a"), true)),
                new QualityResult.Dataset(List.of(new QualityResult.Column("channel_name",
                        "Channel", "STRING", true, 0)),
                        List.of(new QualityResult.Row(0, Map.of()))),
                List.of(), null, List.of(), null);
        // A dataset with no column for a field the plan requires: the rows here are fine, the
        // export would silently not contain what the user asked for.
        QualityResult missingColumns = new QualityResult(produced.status(), produced.records(),
                new QualityResult.Dataset(List.of(), produced.dataset().rows()), List.of(), null,
                List.of(), null);
        transformStep(missingColumns);

        StepOutcome outcome = handler.handle(context(config()));

        assertThat(outcome.summary().get("structuralFailures").toString())
                .contains("channel_name").contains("no column");
    }

    // ------------------------------------------------------------------------ fixtures

    /** A pipeline result whose dataset has one row per canonical record and the plan's columns. */
    private static QualityResult pipeline(QualityResult.Record... records) {
        List<QualityResult.Record> list = List.of(records);
        List<QualityResult.Row> rows = new ArrayList<>();
        List<QualityResult.Column> columns = new ArrayList<>();
        for (Map<String, Object> field : FIELDS) {
            columns.add(new QualityResult.Column(String.valueOf(field.get("key")),
                    String.valueOf(field.get("label")), String.valueOf(field.get("type")),
                    Boolean.TRUE.equals(field.get("required")), columns.size()));
        }
        for (QualityResult.Record record : list) {
            if (record.duplicateOf() == null) {
                rows.add(new QualityResult.Row(record.index(), record.values()));
            }
        }
        int valid = (int) list.stream().filter(QualityResult.Record::isValid).count();
        QualityResult.Quality quality = new QualityResult.Quality(list.size(), list.size(), valid,
                list.size() - valid, list.size() - rows.size(), 0, 0, valid, 0.5,
                "equal-weight mean of five measured ratios", Map.of("completeness", 1.0),
                Map.of());
        return new QualityResult("COMPLETED", list, new QualityResult.Dataset(columns, rows),
                List.of(), quality, List.of(), null);
    }

    private Map<String, Object> config() {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("extractionSchema", Map.of("type", "object"));
        config.put("fields", FIELDS);
        config.put("requiredFields", List.of("channel_name"));
        config.put("deduplicationKeys", List.of("channel_url"));
        return config;
    }

    private void transformStep(QualityResult produced) {
        when(steps.findByKey(anyString(), anyString())).thenReturn(Optional.of(
                step("transform", 1, JobStatus.COMPLETED, Json.write(rawOutput(produced)), null)));
    }

    /** The transform step's output summary, in the shape it writes it — records first, dataset as
     * columns plus row indexes. */
    private static Map<String, Object> rawOutput(QualityResult produced) {
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("pipelineStatus", produced.status());
        output.put("recordsIn", produced.records().size());
        output.put("stages", produced.stages());
        output.put("quality", produced.quality());
        Map<String, Object> dataset = new LinkedHashMap<>();
        dataset.put("columns", produced.dataset().columns());
        dataset.put("rowCount", produced.dataset().rows().size());
        dataset.put("rowRecordIndexes", produced.dataset().rows().stream()
                .map(QualityResult.Row::recordIndex).toList());
        output.put("dataset", dataset);
        output.put("records", produced.records());
        return output;
    }

    private static Map<String, Object> values(String name, Integer subscribers, String url) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("channel_name", name);
        if (subscribers != null) {
            values.put("subscribers", subscribers);
        }
        values.put("channel_url", url);
        return values;
    }

    private static QualityResult.Source source(String url, boolean verified) {
        return new QualityResult.Source(url, "t", "s", "scrape", "2026-02-01T00:00:00Z", verified);
    }

    private static QualityResult.Record record(int index, Map<String, Object> values, boolean valid) {
        return record(index, values, valid, source("https://youtube.test/row" + index, true));
    }

    private static QualityResult.Record record(int index, Map<String, Object> values, boolean valid,
                                               QualityResult.Source source) {
        return new QualityResult.Record(index, values, values, List.of(source), valid, List.of(),
                "SOURCE_CITED", null, null, null, null, null, false, List.of(), List.of(), List.of());
    }

    private static QualityResult.Record duplicate(int index, Integer duplicateOf,
                                                 Map<String, Object> values) {
        return new QualityResult.Record(index, values, values,
                List.of(source("https://youtube.test/dup", true)), true, List.of(), "SOURCE_CITED",
                null, null, duplicateOf, "channel_url", duplicateOf == null ? null : "EXACT", false,
                List.of(), List.of(), List.of());
    }

    private static Step step(String key, int sequence, JobStatus status, String output,
                             String errorCode) {
        return new Step("step-" + key, "ws-1", "run-1", 1, key, sequence,
                Json.write(List.of("collect")), "TRANSFORM", status, 1, 0, "{}", output, 1200L,
                errorCode, errorCode == null ? null : "the pipeline failed", Instant.now(),
                Instant.now());
    }

    private static StepContext context(Map<String, Object> config) {
        Run run = new Run("run-1", "ws-1", "wf-1", "plan-1", RunStatus.RUNNING, 1, 50,
                0, 0, 0, 0, 0, 0, null, null, null, Instant.now(), null, Instant.now());
        Step validate = new Step("step-validate", "ws-1", "run-1", 1, "validate", 2,
                Json.write(List.of("transform")), "VALIDATE", JobStatus.RUNNING, 1, 0, "{}", null,
                null, null, null, Instant.now(), null);
        Plan plan = new Plan("plan-1", "ws-1", "wf-1", 1, "objective", "{}", "{}", "[]", "{}",
                "{}", "{}", "hash", "00000000-0000-0000-0000-000000000000", Instant.now());
        Job job = new Job("job-1", "ws-1", "run-1", null, "WORKFLOW_STEP", "step-validate", "{}",
                JobStatus.RUNNING, 102, 1, 3, Instant.now(), Instant.now().plusSeconds(90),
                "worker-1", 2, null, null, null, Instant.now(), Instant.now(), null, Instant.now());
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("stepKey", "validate");
        payload.put("type", "VALIDATE");
        payload.put("config", config);
        return new StepContext(run, validate, plan, job, payload, "worker-1", () -> true,
                () -> false);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> findings(StepOutcome outcome) {
        return (List<Map<String, Object>>) outcome.summary().get("findings");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> advisory(StepOutcome outcome) {
        return (List<Map<String, Object>>) outcome.summary().get("advisoryDisagreementList");
    }
}
