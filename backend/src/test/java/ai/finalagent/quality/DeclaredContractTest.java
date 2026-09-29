package ai.finalagent.quality;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

/**
 * Java's reading of the plan's field list, which is the spec the dataset is judged against.
 *
 * <p>The folding matters more than it looks: Python canonicalizes every key before it emits a
 * record, so a plan that says {@code Channel Name} and a record that says {@code channel_name} are
 * the same field to one side of the boundary and two different fields to the other. If the two
 * foldings ever diverge, every field in the run reads as undeclared and the gate quietly stops
 * gating.
 */
class DeclaredContractTest {

    @Test
    void keys_fold_lowercase_and_collapse_runs_of_punctuation_just_like_the_python_side() {
        assertThat(DeclaredContract.fold("Channel Name")).isEqualTo("channel_name");
        assertThat(DeclaredContract.fold("  SUBSCRIBER  ")).isEqualTo("subscriber");
        assertThat(DeclaredContract.fold("last__round!!")).isEqualTo("last_round");
        assertThat(DeclaredContract.fold("€uro Amount")).isEqualTo("uro_amount");
        assertThat(DeclaredContract.fold("2024-Q1")).isEqualTo("2024_q1");
        assertThat(DeclaredContract.fold("   ")).isEmpty();
        assertThat(DeclaredContract.fold(null)).isEmpty();
    }

    @Test
    void the_plan_is_the_source_of_the_spec_and_carries_its_types_through() {
        DeclaredContract contract = DeclaredContract.fromFields(List.of(
                Map.of("key", "company_name", "type", "STRING", "required", true),
                Map.of("key", "last round", "type", "currency"),
                Map.of("key", "employees", "type", "integer")),
                List.of("company_name"));

        assertThat(contract.basis()).isEqualTo("plan");
        assertThat(contract.keys()).containsExactly("company_name", "last_round", "employees");
        assertThat(contract.typeOf("last_round")).isEqualTo("CURRENCY");
        assertThat(contract.typeOf("employees")).isEqualTo("NUMBER");
        assertThat(contract.required()).containsExactly("company_name");
    }

    @Test
    void a_required_field_the_plan_never_typed_is_required_and_type_unchecked() {
        DeclaredContract contract = DeclaredContract.fromFields(
                List.of(Map.of("key", "channel_name", "type", "STRING")),
                List.of("channel_name", "subscriber_count"));

        assertThat(contract.required()).containsExactlyInAnyOrder("channel_name",
                "subscriber_count");
        assertThat(contract.hasKey("subscriber_count")).isTrue();
        assertThat(contract.typeOf("subscriber_count")).isEmpty();
    }

    @Test
    void a_duplicate_key_is_registered_once_so_a_plan_cannot_count_a_field_twice() {
        DeclaredContract contract = DeclaredContract.fromFields(List.of(
                Map.of("key", "name", "type", "STRING"),
                Map.of("key", "Name", "type", "URL")), List.of());

        assertThat(contract.keys()).containsExactly("name");
        assertThat(contract.typeOf("name")).isEqualTo("STRING");
    }

    @Test
    void a_field_type_this_build_has_no_rule_for_is_kept_and_left_unchecked() {
        DeclaredContract contract = DeclaredContract.fromFields(
                List.of(Map.of("key", "payload", "type", "json")), List.of());

        assertThat(contract.typeOf("payload")).isEqualTo("JSON");
        assertThat(contract.hasKey("payload")).isTrue();
    }

    @Test
    void a_plan_that_declared_nothing_says_none_rather_than_passing_as_a_contract() {
        assertThat(DeclaredContract.fromConfig(Map.of()).basis()).isEqualTo("none");
        assertThat(DeclaredContract.fromConfig(null).keys()).isEmpty();
        assertThat(DeclaredContract.fromConfig(Map.of("fields", "not a list")).basis())
                .isEqualTo("none");
    }

    @Test
    void the_pipeline_column_fallback_is_labelled_as_the_weaker_check_that_it_is() {
        DeclaredContract contract = DeclaredContract.fromColumns(List.of(
                Map.of("key", "channel_name", "type", "STRING", "required", true),
                Map.of("key", "subscribers", "type", "NUMBER", "required", false)), List.of());

        assertThat(contract.basis()).isEqualTo("pipeline-columns");
        assertThat(contract.required()).containsExactly("channel_name");
        assertThat(contract.typeOf("subscribers")).isEqualTo("NUMBER");
        assertThat(DeclaredContract.fromColumns(List.of(), List.of()).basis()).isEqualTo("none");
    }

    @Test
    void a_config_read_from_a_stored_job_payload_behaves_like_a_hand_written_one() {
        Map<String, Object> config = Map.of(
                "fields", List.of(Map.of("key", "Channel", "label", "Channel", "type", "string",
                        "required", true)),
                "requiredFields", List.of("Channel"));

        DeclaredContract fromConfig = DeclaredContract.fromConfig(config);

        assertThat(fromConfig.keys()).containsExactly("channel");
        assertThat(fromConfig.required()).containsExactly("channel");
        assertThat(fromConfig.typeOf("channel")).isEqualTo("STRING");
    }
}
