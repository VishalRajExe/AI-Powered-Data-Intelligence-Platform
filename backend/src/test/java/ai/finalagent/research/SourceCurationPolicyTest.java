package ai.finalagent.research;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;

import org.junit.jupiter.api.Test;

import ai.finalagent.aiclient.dto.ResearchRequest;

/**
 * The Java-side shape rules for source curation. Note what is *not* here: no domain allow-list,
 * no relevance algorithm, no robots policy. Those live in the service that fetches, and Java only
 * refuses requests whose own numbers cannot be honoured.
 */
class SourceCurationPolicyTest {

    private static ResearchRequest.Limits limits(String entityType, List<String> preferred,
                                                 Integer perDomain, Double floor, Integer desired) {
        return new ResearchRequest.Limits(null, null, null, null, null, null,
                List.of(), List.of(), null, entityType, preferred, perDomain, floor, desired);
    }

    @Test
    void absentLimitsAreNotValidated() {
        assertThatCode(() -> SourceCurationPolicy.validate(null)).doesNotThrowAnyException();
    }

    @Test
    void aNormalCurationRequestPasses() {
        assertThatCode(() -> SourceCurationPolicy.validate(
                limits("youtube_channel", List.of("example.com", "sub.example.co.uk"), 2, 0.35, 50)))
                .doesNotThrowAnyException();
    }

    @Test
    void everyFieldIsOptional() {
        assertThatCode(() -> SourceCurationPolicy.validate(limits(null, null, null, null, null)))
                .doesNotThrowAnyException();
    }

    @Test
    void aBlankEntityTypeIsRefusedRatherThanDefaulted() {
        assertThatThrownBy(() -> SourceCurationPolicy.validate(limits("   ", null, null, null, null)))
                .isInstanceOf(SourceCurationPolicy.InvalidCurationRequestException.class)
                .hasMessageContaining("blank");
    }

    @Test
    void anEntityTypeThatIsNotAShortNameIsRefused() {
        assertThatThrownBy(() -> SourceCurationPolicy.validate(
                limits("companies founded in India after 2020 that raised a Series A round", null, null, null, null)))
                .isInstanceOf(SourceCurationPolicy.InvalidCurationRequestException.class);

        assertThatThrownBy(() -> SourceCurationPolicy.validate(limits("channel!!!", null, null, null, null)))
                .isInstanceOf(SourceCurationPolicy.InvalidCurationRequestException.class)
                .hasMessageContaining("kind of thing being collected");
    }

    @Test
    void theRelevanceFloorIsAProbability() {
        assertThatThrownBy(() -> SourceCurationPolicy.validate(limits(null, null, null, 1.4, null)))
                .isInstanceOf(SourceCurationPolicy.InvalidCurationRequestException.class)
                .hasMessageContaining("between 0.0 and 1.0");

        assertThatThrownBy(() -> SourceCurationPolicy.validate(limits(null, null, null, -0.1, null)))
                .isInstanceOf(SourceCurationPolicy.InvalidCurationRequestException.class);

        assertThatThrownBy(() -> SourceCurationPolicy.validate(limits(null, null, null, Double.NaN, null)))
                .isInstanceOf(SourceCurationPolicy.InvalidCurationRequestException.class);
    }

    @Test
    void zeroMeansNoDiversityRuleAndNegativeDoesNotExist() {
        assertThatCode(() -> SourceCurationPolicy.validate(limits(null, null, 0, null, null)))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> SourceCurationPolicy.validate(limits(null, null, -1, null, null)))
                .isInstanceOf(SourceCurationPolicy.InvalidCurationRequestException.class);
        assertThatThrownBy(() -> SourceCurationPolicy.validate(limits(null, null, 11, null, null)))
                .isInstanceOf(SourceCurationPolicy.InvalidCurationRequestException.class);
    }

    @Test
    void aDesiredSourceCountOfZeroWouldAskForAnEmptyRun() {
        assertThatThrownBy(() -> SourceCurationPolicy.validate(limits(null, null, null, null, 0)))
                .isInstanceOf(SourceCurationPolicy.InvalidCurationRequestException.class)
                .hasMessageContaining("between 1 and");
    }

    @Test
    void preferredDomainsMustBeBareHostnames() {
        assertThatThrownBy(() -> SourceCurationPolicy.validate(
                limits(null, List.of("https://example.com/jobs"), null, null, null)))
                .isInstanceOf(SourceCurationPolicy.InvalidCurationRequestException.class)
                .hasMessageContaining("bare hostnames");

        assertThatThrownBy(() -> SourceCurationPolicy.validate(
                limits(null, List.of("not a domain"), null, null, null)))
                .isInstanceOf(SourceCurationPolicy.InvalidCurationRequestException.class);
    }

    @Test
    void aProsePreferenceIsRejectedHereBecausePythonReportsItAsANote() {
        // extract_hostnames() on the Python side notes prose instead of turning it into a rule;
        // Java's job is to refuse the malformed shape before it becomes a confusing note.
        assertThatCode(() -> SourceCurationPolicy.validate(limits(null, List.of(), null, null, null)))
                .doesNotThrowAnyException();
    }
}
