package ai.finalagent.requirement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;

import org.junit.jupiter.api.Test;

import ai.finalagent.requirement.RequirementDto.Field;
import ai.finalagent.requirement.RequirementDto.Geography;
import ai.finalagent.requirement.RequirementDto.TimeRange;

class RequirementValidatorTest {

    private static RequirementDto of(List<Field> fields, List<String> required, List<String> optional,
                                     List<String> dedup, List<String> missing) {
        return new RequirementDto(
                "List popular coding channels", "youtube_channel", 20,
                new Geography(List.of(), null, null), new TimeRange(null, null, null),
                List.of(), List.of(), fields, required, optional,
                List.of(), List.of(), dedup, List.of(), "unspecified",
                List.of(), missing, List.of());
    }

    private static Field field(String key, String type) {
        return new Field(key, key, type, null);
    }

    @Test
    void acceptsAWellFormedRequirement() {
        var requirement = of(List.of(field("channel_name", "STRING"), field("subscribers", "NUMBER")),
                List.of("channel_name"), List.of("subscribers"), List.of("channel_name"), List.of());

        assertThatCode(() -> RequirementValidator.validate(requirement)).doesNotThrowAnyException();
    }

    @Test
    void partitionMustCoverEveryFieldExactlyOnce() {
        var requirement = of(List.of(field("a", "STRING"), field("b", "STRING")),
                List.of("a"), List.of(), List.of(), List.of());

        assertThatThrownBy(() -> RequirementValidator.validate(requirement))
                .isInstanceOf(RequirementValidator.InvalidRequirementException.class)
                .hasMessageContaining("exactly one of requiredFields / optionalFields");
    }

    @Test
    void duplicateFieldKeysAreRejected() {
        var requirement = of(List.of(field("a", "STRING"), field("a", "STRING")),
                List.of("a"), List.of("a"), List.of(), List.of());

        assertThatThrownBy(() -> RequirementValidator.validate(requirement))
                .hasMessageContaining("duplicate field key");
    }

    @Test
    void camelCaseKeysAreRejectedBecauseTheContractIsSnakeCase() {
        var requirement = of(List.of(field("channelName", "STRING")),
                List.of("channelName"), List.of(), List.of(), List.of());

        assertThatThrownBy(() -> RequirementValidator.validate(requirement))
                .hasMessageContaining("snake_case");
    }

    @Test
    void unknownFieldTypeIsRejected() {
        var requirement = of(List.of(field("a", "MONEY")), List.of("a"), List.of(), List.of(), List.of());

        assertThatThrownBy(() -> RequirementValidator.validate(requirement))
                .hasMessageContaining("unknown type MONEY");
    }

    @Test
    void anEmptyFieldListMeansTheRequestWasNeverAnalysed() {
        var requirement = of(List.of(), List.of(), List.of(), List.of(), List.of());

        assertThatThrownBy(() -> RequirementValidator.validate(requirement))
                .hasMessageContaining("at least one attribute");
    }

    @Test
    void deduplicationKeysMustNameDeclaredFields() {
        var requirement = of(List.of(field("a", "STRING")), List.of("a"), List.of(),
                List.of("website"), List.of());

        assertThatThrownBy(() -> RequirementValidator.validate(requirement))
                .hasMessageContaining("deduplicationKeys names undeclared field: website");
    }

    @Test
    void missingInformationStopsTheRunRatherThanGuessing() {
        var requirement = of(List.of(field("a", "STRING")), List.of("a"), List.of(), List.of(),
                List.of("which country?"));

        var outcome = RequirementValidator.validate(requirement);

        assertThat(outcome.verdict()).isEqualTo(RequirementValidator.Verdict.NEEDS_CLARIFICATION);
        assertThat(outcome.mayProceed()).isFalse();
        assertThat(outcome.questions()).containsExactly("which country?");
    }

    @Test
    void anImplausibleQuantityIsRejected() {
        var requirement = new RequirementDto("objective text", "company", 5_000_000,
                new Geography(List.of(), null, null), new TimeRange(null, null, null),
                List.of(), List.of(), List.of(field("a", "STRING")), List.of("a"), List.of(),
                List.of(), List.of(), List.of(), List.of(), "unspecified",
                List.of(), List.of(), List.of());

        assertThatThrownBy(() -> RequirementValidator.validate(requirement))
                .hasMessageContaining("quantity must be between 1 and");
    }
}
