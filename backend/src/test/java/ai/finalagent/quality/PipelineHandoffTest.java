package ai.finalagent.quality;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import ai.finalagent.aiclient.dto.QualityRequest;
import ai.finalagent.aiclient.dto.QualityResult;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The real Python answer, run through the real Java gate.
 *
 * <p>{@code wire/quality-process.json} is produced by the pipeline itself over six funded-company
 * records, so this is the one place where both halves of the seam are exercised on data neither side
 * invented for the other. The expectations below are the interesting part: they say what Java
 * concludes about a dataset the pipeline was happy with, and one of them is a disagreement — the case
 * the whole advisory/authoritative split exists for.
 */
class PipelineHandoffTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static QualityResult produced;
    private static QualityRequest asAsked;

    @BeforeAll
    static void loadTheCapturedRun() throws IOException {
        try (InputStream in = PipelineHandoffTest.class.getResourceAsStream(
                "/wire/quality-process.json")) {
            assertThat(in).as("regenerate the fixture from ai-service/tests/test_quality_wire_"
                    + "fixture.py").isNotNull();
            JsonNode document = MAPPER.readTree(new String(in.readAllBytes(),
                    StandardCharsets.UTF_8));
            produced = MAPPER.treeToValue(document.get("response"), QualityResult.class);
            asAsked = MAPPER.treeToValue(document.get("request"), QualityRequest.class);
        }
    }

    private static DeclaredContract planContract() {
        List<Map<String, Object>> fields = MAPPER.convertValue(asAsked.fields(),
                new TypeReference<List<Map<String, Object>>>() {
                });
        return DeclaredContract.fromFields(fields, asAsked.requiredFields());
    }

    @Test
    void the_contract_java_built_from_the_request_covers_every_column_the_pipeline_emitted() {
        DeclaredContract contract = planContract();

        assertThat(contract.basis()).isEqualTo("plan");
        assertThat(contract.keys()).containsExactlyInAnyOrderElementsOf(
                produced.dataset().columns().stream().map(QualityResult.Column::key).toList()
                        .stream().filter(key -> !key.equals("source_page")).toList());
        // `source_page` is the key that arrived with no declaration anywhere. The pipeline kept and
        // reported it; Java has to notice it too rather than treat an emitted column as a declared
        // field.
        assertThat(contract.hasKey("source_page")).isFalse();
        assertThat(contract.required()).containsExactly("company_name");
    }

    @Test
    void java_reaches_its_own_verdict_on_rows_the_pipeline_called_valid() {
        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(produced, planContract());

        // Four canonical rows (two records were linked as duplicates), and none of the four clears
        // Java's rules — the currency amount the pipeline kept as text, the row citing nothing a tool
        // retrieved, the row citing nothing at all, and the row with no name.
        assertThat(verdict.rowsChecked()).isEqualTo(4);
        assertThat(verdict.linkedDuplicates()).isEqualTo(2);
        assertThat(verdict.invalid()).isEqualTo(4);
        assertThat(verdict.valid()).isZero();
        // The pipeline vouched for two of the four. That difference is the finding, in both counts.
        assertThat(verdict.advisoryOnly()).hasSize(1);
        assertThat(verdict.advisoryOnly().get(0).ruleCode())
                .isEqualTo("ADVISORY_PASSED_HERE_REJECTED");
    }

    @Test
    void the_rule_codes_java_derives_are_the_ones_that_fit_the_values_it_was_given() {
        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(produced, planContract());

        assertThat(verdict.findings()).extracting(RowContractEnforcer.Finding::ruleCode)
                .contains("REQUIRED", "FORMAT_URL", "FORMAT_DATE", "SOURCE_EVIDENCE",
                        "SOURCE_EVIDENCE_UNVERIFIED", "TYPE", "EXTRA_FIELD");
        // Every record here has at least one tool-retrieved source except the two the gate exists to
        // catch, so nothing is rejected for a reason the data does not support.
        assertThat(verdict.findings()).allSatisfy(finding -> {
            assertThat(finding.recordIndex()).isBetween(0, 5);
            assertThat(finding.severity()).isIn("ERROR", "WARNING");
        });
    }

    /**
     * The conflicts the pipeline preserved are the ones Java can audit: both values and both source
     * lists present, each resolved by a named rule — so no conflict finding is raised here at all.
     *
     * <p>The lower-case {@code "usd"} in the rejected currency is <em>not</em> re-checked, and that is
     * deliberate. A rejected value is evidence about what a source said, not a value the dataset
     * publishes, so it is kept exactly as it arrived; type-checking the losing half of a disagreement
     * would turn the record invalid all over again for something nobody is claiming.
     */
    @Test
    void every_conflict_that_survived_the_wire_is_a_conflict_java_can_audit() {
        List<QualityResult.Conflict> conflicts = produced.records().stream()
                .flatMap(record -> record.conflicts().stream()).toList();

        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(produced, planContract());

        assertThat(conflicts).isNotEmpty();
        assertThat(conflicts).allSatisfy(conflict -> {
            assertThat(conflict.resolvedBy()).isNotBlank();
            assertThat(conflict.rejectedSources()).isNotEmpty();
            assertThat(conflict.keptSources()).isNotEmpty();
        });
        assertThat(verdict.findings()).extracting(RowContractEnforcer.Finding::ruleCode)
                .noneMatch(code -> code.startsWith("CONFLICT_"));
        assertThat(verdict.structuralFailures()).noneSatisfy(note ->
                assertThat(note).contains("CONFLICT"));
    }

    @Test
    void nothing_the_pipeline_linked_is_counted_as_a_row_twice() {
        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(produced, planContract());

        assertThat(verdict.findings()).extracting(RowContractEnforcer.Finding::ruleCode)
                .doesNotContain("DUPLICATE_LINK_BROKEN", "DUPLICATE_LINK_DANGLING",
                        "DUPLICATE_IS_ALSO_A_ROW");
        // Six in, four rows plus two links out: the "linked, never deleted" guarantee is arithmetic,
        // not a sentence in a design document.
        assertThat(verdict.rowsChecked() + verdict.linkedDuplicates())
                .isEqualTo(produced.records().size());
    }
}
