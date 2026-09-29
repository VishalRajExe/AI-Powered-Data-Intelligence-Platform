package ai.finalagent.research;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;

import org.junit.jupiter.api.Test;

import ai.finalagent.aiclient.dto.ResearchRequest;

/**
 * The request-shape rules, tested without a web layer. What is deliberately absent from
 * this list matters as much as what is on it: there is no ceiling here, because
 * {@code ALLOWED_WEB_TOOLS} in the service that runs the tools is the one place that
 * decides which of them exist.
 */
class WebToolPolicyTest {

    private static ResearchRequest.Limits limits(List<String> tools, Integer interactions) {
        return new ResearchRequest.Limits(null, null, null, null, interactions, null,
                List.of(), List.of(), tools);
    }

    @Test
    void absentLimitsAreNobodySBusiness() {
        assertThatCode(() -> WebToolPolicy.validate(null)).doesNotThrowAnyException();
    }

    @Test
    void limitsWithoutAToolListAreAccepted() {
        assertThatCode(() -> WebToolPolicy.validate(limits(null, 2))).doesNotThrowAnyException();
    }

    @Test
    void theThreeImplementedToolsAreAccepted() {
        assertThatCode(() -> WebToolPolicy.validate(limits(List.of("search", "scrape", "interact"), 1)))
                .doesNotThrowAnyException();
    }

    @Test
    void toolNamesAreMatchedCaseInsensitively() {
        assertThatCode(() -> WebToolPolicy.validate(limits(List.of("SEARCH"), null)))
                .doesNotThrowAnyException();
    }

    @Test
    void anEmptyToolListIsRefusedBecauseItWouldGuaranteeANoEvidenceRun() {
        assertThatThrownBy(() -> WebToolPolicy.validate(limits(List.of(), null)))
                .isInstanceOf(WebToolPolicy.InvalidWebToolRequestException.class)
                .hasMessageContaining("names no tool");
    }

    @Test
    void anUnknownToolIsNamedInTheMessage() {
        assertThatThrownBy(() -> WebToolPolicy.validate(limits(List.of("crawl", "map"), null)))
                .isInstanceOf(WebToolPolicy.InvalidWebToolRequestException.class)
                .hasMessageContaining("crawl")
                .hasMessageContaining("map");
    }

    @Test
    void theSessionBudgetHasABound() {
        assertThatThrownBy(() -> WebToolPolicy.validate(limits(List.of("interact"), 21)))
                .isInstanceOf(WebToolPolicy.InvalidWebToolRequestException.class)
                .hasMessageContaining("between 0 and 20");

        assertThatThrownBy(() -> WebToolPolicy.validate(limits(List.of("interact"), -1)))
                .isInstanceOf(WebToolPolicy.InvalidWebToolRequestException.class);
    }

    @Test
    void aSessionBudgetIsAllowedWhenInteractIsRequested() {
        assertThatCode(() -> WebToolPolicy.validate(limits(List.of("search", "INTERACT"), 5)))
                .doesNotThrowAnyException();
    }

    @Test
    void aSessionBudgetWithoutInteractIsAnInconsistentRequest() {
        assertThatThrownBy(() -> WebToolPolicy.validate(limits(List.of("search", "scrape"), 3)))
                .isInstanceOf(WebToolPolicy.InvalidWebToolRequestException.class)
                .hasMessageContaining("does not include 'interact'");
    }

    @Test
    void aZeroBudgetIsNotInconsistentEvenWithoutInteract() {
        assertThatCode(() -> WebToolPolicy.validate(limits(List.of("search"), 0)))
                .doesNotThrowAnyException();
    }

    @Test
    void theKnownSetIsExactlyWhatTheWebClientImplements() {
        assertThat(WebToolPolicy.KNOWN_TOOLS).containsExactlyInAnyOrder("search", "scrape", "interact");
    }
}
