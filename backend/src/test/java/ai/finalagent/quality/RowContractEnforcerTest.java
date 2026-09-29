package ai.finalagent.quality;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import ai.finalagent.aiclient.dto.QualityResult;
import ai.finalagent.aiclient.dto.QualityResult.Column;
import ai.finalagent.aiclient.dto.QualityResult.Record;
import ai.finalagent.aiclient.dto.QualityResult.Source;

/**
 * The gate between an advisory answer and a trusted dataset, tested from Java's side.
 *
 * <p>Each case is a way the pipeline's verdict could be right about its own work and wrong about
 * the contract: a record the caller called valid that has no evidence, a duplicate whose link points
 * at another duplicate, a conflict that lost the value it rejected. The point is not that Python
 * makes these mistakes — its tests cover them — but that this gate only exists if it can disagree.
 */
class RowContractEnforcerTest {

    private static final DeclaredContract CHANNEL = DeclaredContract.fromFields(List.of(
            Map.of("key", "channel_name", "type", "STRING", "required", true),
            Map.of("key", "subscribers", "type", "NUMBER"),
            Map.of("key", "channel_url", "type", "URL"),
            Map.of("key", "email", "type", "EMAIL"),
            Map.of("key", "monthly_revenue", "type", "CURRENCY"),
            Map.of("key", "created_on", "type", "DATE")),
            List.of("channel_name"));

    @Test
    void aCleanRowPassesAndIsCountedOnce() {
        QualityResult result = result(row(0, Map.of("channel_name", "Coding Cat",
                "subscribers", 250000, "channel_url", "https://youtube.test/c/cat")));

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(result, CHANNEL);

        assertThat(verdict.rowsChecked()).isEqualTo(1);
        assertThat(verdict.valid()).isEqualTo(1);
        assertThat(verdict.invalid()).isZero();
        assertThat(verdict.findings()).isEmpty();
        assertThat(verdict.clean()).isTrue();
        assertThat(verdict.contractBasis()).isEqualTo("plan");
    }

    @Test
    void aRecordThePipelineCalledValidButJavaRejectsIsReportedNotSilentlyAccepted() {
        // The fabricated pass: nothing in the record cites a source a tool retrieved.
        QualityResult result = result(record(0, Map.of("channel_name", "Coding Cat"), true,
                List.of(source("https://model-mentioned.test", false)), null, List.of()));

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(result, CHANNEL);

        assertThat(verdict.valid()).isZero();
        assertThat(verdict.invalid()).isEqualTo(1);
        assertThat(verdict.findings()).extracting(RowContractEnforcer.Finding::ruleCode)
                .contains("SOURCE_EVIDENCE_UNVERIFIED");
        assertThat(verdict.advisoryOnly()).hasSize(1);
        assertThat(verdict.advisoryOnly().get(0).ruleCode()).isEqualTo("ADVISORY_PASSED_HERE_REJECTED");
        assertThat(verdict.clean()).isFalse();
    }

    @Test
    void aRecordBothSidesRejectIsNotAnAdvisoryDisagreement() {
        QualityResult result = result(record(0, Map.of(), false,
                List.of(source("https://youtube.test/c/x", true)), null, List.of()));

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(result, CHANNEL);

        assertThat(verdict.invalid()).isEqualTo(1);
        assertThat(verdict.advisoryOnly()).isEmpty();
        assertThat(verdict.findings()).extracting(RowContractEnforcer.Finding::ruleCode)
                .contains("REQUIRED");
    }

    /** Both directions of the disagreement matter: this one is this gate being stricter than it has
     * to be, and it is reported so the stricter side can be argued with. */
    @Test
    void aRecordThePipelineRejectedThatJavaAcceptsIsReportedInTheOtherDirection() {
        QualityResult result = result(record(0, Map.of("channel_name", "Coding Cat"), false,
                List.of(source("https://youtube.test/c/x", true)), null, List.of()));

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(result, CHANNEL);

        assertThat(verdict.valid()).isEqualTo(1);
        assertThat(verdict.advisoryOnly()).hasSize(1);
        assertThat(verdict.advisoryOnly().get(0).ruleCode())
                .isEqualTo("ADVISORY_REJECTED_HERE_PASSED");
    }

    @Test
    void aValueOfTheWrongTypeForItsDeclaredFieldIsAnErrorUnderThatFieldName() {
        QualityResult result = result(row(0, Map.of("channel_name", "Cat", "subscribers", "250K")));

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(result, CHANNEL);

        assertThat(verdict.findings()).anySatisfy(finding -> {
            assertThat(finding.ruleCode()).isEqualTo("TYPE");
            assertThat(finding.fieldKey()).isEqualTo("subscribers");
            assertThat(finding.severity()).isEqualTo("ERROR");
        });
        assertThat(verdict.invalid()).isEqualTo(1);
    }

    @Test
    void formats_are_checked_against_their_own_rules_and_only_theirs() {
        QualityResult result = result(row(0, Map.of("channel_name", "Cat",
                "channel_url", "youtube.test/c/x", "email", "cat[at]test",
                "created_on", "15/06/2024")));

        assertThat(RowContractEnforcer.enforce(result, CHANNEL).findings())
                .extracting(RowContractEnforcer.Finding::ruleCode)
                .containsExactlyInAnyOrder("FORMAT_URL", "FORMAT_EMAIL", "FORMAT_DATE");
    }

    @Test
    void a_currency_amount_that_is_not_a_number_or_a_unit_that_is_not_iso4217_is_rejected() {
        QualityResult result = result(row(0, Map.of("channel_name", "Cat",
                "monthly_revenue", Map.of("amount", "4.5M", "currency", "usd"))));

        assertThat(RowContractEnforcer.enforce(result, CHANNEL).findings())
                .extracting(RowContractEnforcer.Finding::ruleCode)
                .contains("CURRENCY_CODE", "TYPE");
    }

    /** An amount and no unit is a value with a missing half, not a currency violation — and neither
     * is a guess about which half was meant. */
    @Test
    void a_currency_with_only_an_amount_is_accepted_because_the_unit_was_never_claimed() {
        QualityResult result = result(row(0, Map.of("channel_name", "Cat",
                "monthly_revenue", Map.of("amount", 1200))));

        assertThat(RowContractEnforcer.enforce(result, CHANNEL).valid()).isEqualTo(1);
    }

    @Test
    void a_key_the_plan_never_declared_is_reported_and_kept_and_never_type_checked() {
        QualityResult result = result(row(0, Map.of("channel_name", "Cat",
                "sentiment_score", 0.87)));

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(result, CHANNEL);

        assertThat(verdict.findings()).hasSize(1);
        assertThat(verdict.findings().get(0).ruleCode()).isEqualTo("EXTRA_FIELD");
        assertThat(verdict.findings().get(0).severity()).isEqualTo("WARNING");
        // A warning, not an error: the value is kept, the row stays valid, and the caller is told.
        assertThat(verdict.valid()).isEqualTo(1);
    }

    @Test
    void keys_are_folded_the_way_the_pipeline_folds_them_before_being_compared() {
        DeclaredContract contract = DeclaredContract.fromFields(
                List.of(Map.of("key", "Channel Name", "type", "string")), List.of("Channel  Name"));
        QualityResult result = result(row(0, Map.of("channel_name", "Cat")));

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(result, contract);

        assertThat(verdict.valid()).isEqualTo(1);
        assertThat(verdict.findings()).isEmpty();
    }

    @Test
    void a_linked_duplicate_is_counted_as_a_link_and_not_as_a_row() {
        List<Record> records = List.of(
                record(0, Map.of("channel_name", "Cat"), true,
                        List.of(source("https://youtube.test/c/cat", true)), null, List.of()),
                record(1, Map.of("channel_name", "Cat"), true,
                        List.of(source("https://youtube.test/c/cat?ref=x", true)), 0, List.of()));

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(
                new QualityResult("COMPLETED", records, dataset(0), List.of(), null,
                        List.of(), null), CHANNEL);

        assertThat(verdict.rowsChecked()).isEqualTo(1);
        assertThat(verdict.linkedDuplicates()).isEqualTo(1);
        assertThat(verdict.findings()).isEmpty();
    }

    @Test
    void a_duplicate_pointing_at_another_duplicate_is_a_broken_promise_and_says_so() {
        // A → B → C: the value has no home, because B is itself not a row.
        List<Record> records = List.of(
                record(0, Map.of("channel_name", "Cat"), true, verified(), 1, List.of()),
                record(1, Map.of("channel_name", "Cat"), true, verified(), 2, List.of()),
                record(2, Map.of("channel_name", "Cat"), true, verified(), null, List.of()));

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(
                new QualityResult("COMPLETED", records, dataset(2), List.of(), null,
                        List.of(), null), CHANNEL);

        assertThat(verdict.findings()).extracting(RowContractEnforcer.Finding::ruleCode)
                .contains("DUPLICATE_LINK_DANGLING");
    }

    @Test
    void a_duplicate_that_is_also_still_a_row_would_count_the_same_entity_twice() {
        List<Record> records = List.of(
                record(0, Map.of("channel_name", "Cat"), true, verified(), null, List.of()),
                record(1, Map.of("channel_name", "Cat"), true, verified(), 0, List.of()));

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(
                new QualityResult("COMPLETED", records, dataset(0, 1), List.of(), null, List.of(),
                        null), CHANNEL);

        assertThat(verdict.findings()).extracting(RowContractEnforcer.Finding::ruleCode)
                .contains("DUPLICATE_IS_ALSO_A_ROW");
        assertThat(verdict.rowsChecked()).isEqualTo(1);
    }

    @Test
    void a_record_that_is_neither_a_row_nor_a_link_would_vanish_and_that_is_structural() {
        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(
                new QualityResult("COMPLETED", List.of(record(0, Map.of("channel_name", "Cat"),
                        true, verified(), null, List.of())), dataset(), List.of(), null, List.of(),
                        null), CHANNEL);

        assertThat(verdict.structuralFailures()).hasSize(1);
        assertThat(verdict.structuralFailures().get(0)).contains("neither a dataset row nor linked");
    }

    @Test
    void a_conflict_that_lost_its_rejected_value_reads_as_an_overwrite_and_is_an_error() {
        QualityResult.Conflict conflict = conflict("subscribers", 42, null, "evidence-count",
                List.of("https://a.test"), List.of());

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(
                result(record(0, Map.of("channel_name", "Cat"), true, verified(), null,
                        List.of(conflict))), CHANNEL);

        assertThat(verdict.findings()).extracting(RowContractEnforcer.Finding::ruleCode)
                .contains("CONFLICT_NOT_PRESERVED", "CONFLICT_PROVENANCE_LOST");
        assertThat(verdict.invalid()).isEqualTo(1);
    }

    @Test
    void a_conflict_resolved_by_an_unnamed_rule_is_reported_as_a_warning_not_a_rejection() {
        QualityResult.Conflict conflict = conflict("subscribers", 42, 39, "",
                List.of("https://a.test"), List.of("https://b.test"));

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(
                result(record(0, Map.of("channel_name", "Cat"), true, verified(), null,
                        List.of(conflict))), CHANNEL);

        assertThat(verdict.findings()).extracting(RowContractEnforcer.Finding::ruleCode)
                .containsExactly("CONFLICT_UNEXPLAINED");
        assertThat(verdict.valid()).isEqualTo(1);
    }

    @Test
    void a_required_field_the_dataset_never_exported_is_a_structural_failure() {
        List<Column> columns = List.of(column("subscribers", "NUMBER", false));

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(
                new QualityResult("COMPLETED", List.of(), new QualityResult.Dataset(columns,
                        List.of()), List.of(), null, List.of(), null), CHANNEL);

        assertThat(verdict.structuralFailures()).hasSize(1);
        assertThat(verdict.structuralFailures().get(0)).contains("channel_name");
    }

    @Test
    void a_column_the_pipeline_marked_required_that_the_plan_never_asked_for_is_reported() {
        DeclaredContract contract = DeclaredContract.fromFields(
                List.of(Map.of("key", "channel_name", "type", "STRING")), List.of());
        QualityResult result = new QualityResult("COMPLETED",
                List.of(record(0, Map.of("channel_name", "Cat"), true, verified(), null, List.of())),
                new QualityResult.Dataset(List.of(column("channel_name", "STRING", true),
                        column("subscribers", "NUMBER", true)), List.of(new QualityResult.Row(0,
                        Map.of()))), List.of(), null, List.of(), null);

        assertThat(RowContractEnforcer.enforce(result, contract).structuralFailures())
                .anySatisfy(note -> assertThat(note).contains("subscribers").contains("never "
                        + "asked for"));
    }

    /**
     * When the plan declared no fields there is nothing here to enforce against, and the summary has
     * to say which spec was used rather than leaving a reader to assume it was the plan's.
     */
    @Test
    void with_no_declared_fields_the_fallback_spec_is_named_in_the_verdict() {
        DeclaredContract none = DeclaredContract.fromConfig(Map.of());
        assertThat(none.basis()).isEqualTo("none");

        QualityResult result = result(row(0, Map.of("channel_name", "Cat")));
        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(result, none);

        assertThat(verdict.contractBasis()).isEqualTo("none");
        assertThat(verdict.valid()).isEqualTo(1);
    }

    @Test
    void the_summary_bounds_what_it_prints_without_losing_the_count_it_truncated() {
        List<Record> records = new ArrayList<>();
        for (int index = 0; index < 12; index++) {
            records.add(record(index, Map.of(), false, verified(), null, List.of()));
        }
        QualityResult result = new QualityResult("COMPLETED", records, dataset(), List.of(), null,
                List.of(), null);

        Map<String, Object> summary = RowContractEnforcer.enforce(result, CHANNEL)
                .asSummary(5);

        assertThat(summary).containsEntry("findingsTruncated", true)
                .containsEntry("findingsTotal", 12)
                .containsEntry("javaInvalid", 12);
        assertThat((List<?>) summary.get("findings")).hasSize(5);
    }

    // ------------------------------------------------------------------------ builders

    private static QualityResult result(Record record) {
        return new QualityResult("COMPLETED", List.of(record),
                dataset(record.duplicateOf() == null ? record.index() : null), List.of(), null,
                List.of(), null);
    }

    private static QualityResult.Dataset dataset(Integer... rowIndexes) {
        List<QualityResult.Row> rows = new ArrayList<>();
        for (Integer index : rowIndexes) {
            if (index != null) {
                rows.add(new QualityResult.Row(index, Map.of()));
            }
        }
        return new QualityResult.Dataset(List.of(column("channel_name", "STRING", true)), rows);
    }

    private static Column column(String key, String type, boolean required) {
        return new Column(key, key, type, required, 0);
    }

    private static List<Source> verified() {
        return List.of(source("https://youtube.test/c/cat", true));
    }

    private static Source source(String url, boolean verifiedByTool) {
        return new Source(url, "title", "snippet", "scrape", "2026-02-01T00:00:00Z", verifiedByTool);
    }

    private static QualityResult.Conflict conflict(String fieldKey, Object kept, Object rejected,
                                                   String resolvedBy, List<String> keptSources,
                                                   List<String> rejectedSources) {
        return new QualityResult.Conflict(fieldKey, kept, rejected, keptSources, rejectedSources,
                resolvedBy);
    }

    private static QualityResult.Record record(int index, Map<String, Object> values, boolean valid,
                                               List<Source> sources, Integer duplicateOf,
                                               List<QualityResult.Conflict> conflicts) {
        Map<String, Object> typed = new LinkedHashMap<>(values);
        return new Record(index, typed, typed, sources, valid, List.of(), "SOURCE_CITED", null, null,
                duplicateOf, null, duplicateOf == null ? null : "EXACT", false, List.of(), conflicts,
                List.of());
    }

    private static Record row(int index, Map<String, Object> values) {
        return record(index, values, true, verified(), null, List.of());
    }
}
