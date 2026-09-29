package ai.finalagent.workflow.plan;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import ai.finalagent.requirement.RequirementAnalysisDto;
import ai.finalagent.requirement.RequirementDto;
import ai.finalagent.workflow.execution.PlanSteps;
import ai.finalagent.workflow.support.Json;

/**
 * The plan is the contract between "what the user asked for" and "what the queue executes", so
 * these tests are about its two properties: it must be derived rather than invented, and it must
 * contain only work this build can actually do.
 */
class WorkflowPlannerTest {

    private static final Map<String, Object> SCHEMA = Map.of(
            "type", "object",
            "properties", Map.of("channels", Map.of("type", "array")));

    private static RequirementAnalysisDto analysis(int quantity, Map<String, Object> collectionPolicy) {
        RequirementDto requirement = new RequirementDto(
                "list popular YouTube channels that teach programming", "youtube_channel", quantity,
                new RequirementDto.Geography(List.of("India"), "country", true),
                new RequirementDto.TimeRange(null, null, "last 12 months"),
                List.of(new RequirementDto.Filter("subscribers", ">=", "100000")),
                List.of("public channels only"),
                List.of(new RequirementDto.Field("channel_name", "Channel", "string", "the channel name"),
                        new RequirementDto.Field("subscribers", "Subscribers", "integer", "count")),
                List.of("channel_name", "subscribers"), List.of("channel_url"),
                List.of("youtube.com"), List.of("reddit.com"),
                List.of("channel_name"),
                List.of(new RequirementDto.ValidationRule("min", "subscribers", Map.of("value", 1000))),
                "table", List.of(), List.of(), List.of());
        return new RequirementAnalysisDto("valid", requirement, SCHEMA,
                List.of("best coding youtube channels", "programming tutorial channels india"),
                "List 20 YouTube channels teaching programming, India, last 12 months.",
                collectionPolicy, List.of(), Map.of("model", "gemini-2.5-flash"));
    }

    private static Map<String, Object> policyWith(List<String> preferred, List<String> blocked) {
        return Map.of("preferredDomains", preferred, "blockedDomains", blocked,
                "unenforceablePreferences", List.of("the channel's own site"),
                "respectRobotsTxt", true, "allowAuthentication", false, "allowCaptchaBypass", false);
    }

    @Test
    void theSameRequirementAlwaysProducesTheSamePlanAndTheSameHash() {
        WorkflowPlanner.Planned first = WorkflowPlanner.plan(analysis(20, policyWith(
                List.of("youtube.com"), List.of("reddit.com"))));
        WorkflowPlanner.Planned second = WorkflowPlanner.plan(analysis(20, policyWith(
                List.of("youtube.com"), List.of("reddit.com"))));

        assertThat(first.planHash()).isEqualTo(second.planHash());
        assertThat(first.stepsJson()).isEqualTo(second.stepsJson());
    }

    @Test
    void aDifferentQuantityProducesADifferentHashBecauseTheBoundsReallyChanged() {
        assertThat(WorkflowPlanner.plan(analysis(20, Map.of())).planHash())
                .isNotEqualTo(WorkflowPlanner.plan(analysis(50, Map.of())).planHash());
    }

    @Test
    void thePlanHoldsOnlyStepsThisBuildExecutes() {
        // SAVE and EXPORT do not exist yet. Emitting them as skipped placeholders is how the
        // previous project's plans looked complete while doing nothing.
        assertThat(WorkflowPlanner.stepKeys(WorkflowPlanner.plan(analysis(20, Map.of())).steps()))
                .containsExactly(WorkflowPlanner.COLLECT_STEP, WorkflowPlanner.VALIDATE_STEP);
        assertThat(WorkflowPlanner.plan(analysis(20, Map.of())).steps())
                .extracting(WorkflowPlanner.PlanStep::type).containsExactly("EXTRACT", "VALIDATE");
        assertThat(WorkflowPlanner.plan(analysis(20, Map.of())).steps())
                .extracting(WorkflowPlanner.PlanStep::dependsOn)
                .containsExactly(List.of(), List.of(WorkflowPlanner.COLLECT_STEP));
    }

    @Test
    void theCollectStepCarriesEverythingTheResearchRunNeedsWithoutReReadingThePlan() {
        WorkflowPlanner.PlanStep collect = WorkflowPlanner.plan(analysis(20, policyWith(
                List.of("youtube.com"), List.of("reddit.com")))).steps().get(0);

        assertThat(collect.config()).containsKeys("topic", "extractionSchema", "limits", "seedQueries");
        assertThat(collect.config().get("topic"))
                .isEqualTo("list popular YouTube channels that teach programming");
        assertThat(collect.config().get("extractionSchema")).isEqualTo(SCHEMA);
        assertThat(collect.config().get("seedQueries")).isInstanceOf(List.class);
        assertThat((List<?>) collect.config().get("seedQueries")).hasSize(2);
    }

    @Test
    void theCollectionBoundsScaleWithTheRequestedQuantity() {
        assertThat(limitsOf(5)).containsEntry("maxSearchesPerRun", 2)
                .containsEntry("maxScrapesPerRun", 6)
                .containsEntry("expectedRecords", 5);
        assertThat(limitsOf(20)).containsEntry("maxSearchesPerRun", 4)
                .containsEntry("maxScrapesPerRun", 14);
        assertThat(limitsOf(400)).containsEntry("maxSearchesPerRun", 12)
                .containsEntry("maxScrapesPerRun", 40);
        assertThat(limitsOf(5000)).containsEntry("maxSearchesPerRun", 12)
                .containsEntry("maxScrapesPerRun", 40);
    }

    @Test
    void theMinimumRecordsForTheRunIsTheQuantityTheUserAskedFor() {
        Map<String, Object> completion = Json.object(
                WorkflowPlanner.plan(analysis(37, Map.of())).completionCriteriaJson());
        assertThat(completion).containsEntry("minimumRecords", 37)
                .containsEntry("requireSourceEvidence", true)
                .containsEntry("enforcedBy", "backend");
    }

    @Test
    void resolvedDomainsTravelIntoTheCollectionLimitsAndTheStoredPolicy() {
        WorkflowPlanner.Planned planned = WorkflowPlanner.plan(analysis(20, policyWith(
                List.of("youtube.com"), List.of("reddit.com"))));

        assertThat(limitsOf(planned)).containsEntry("preferredDomains", List.of("youtube.com"))
                .containsEntry("blockedDomains", List.of("reddit.com"));
        Map<String, Object> policy = Json.object(planned.sourcePolicyJson());
        assertThat(policy).containsEntry("preferredDomains", List.of("youtube.com"))
                .containsEntry("blockedDomains", List.of("reddit.com"));
    }

    @Test
    void anAbsentSourceWishIsStoredAsEmptyRatherThanInventingADomain() {
        Map<String, Object> policy = Json.object(WorkflowPlanner.plan(analysis(20, Map.of()))
                .sourcePolicyJson());
        assertThat(policy).containsEntry("preferredDomains", List.of())
                .containsEntry("blockedDomains", List.of());
    }

    @Test
    void theSafetyLiteralsAreConstantsNoModelCanRelax() {
        Map<String, Object> policy = WorkflowPlanner.safetyPolicy(Map.of(
                "respectRobotsTxt", false, "allowAuthentication", true, "allowCaptchaBypass", true));

        assertThat(policy).containsEntry("respectRobotsTxt", true)
                .containsEntry("respectSiteTerms", true)
                .containsEntry("allowAuthentication", false)
                .containsEntry("allowCaptchaBypass", false);
    }

    @Test
    void theValidateStepCarriesTheContractJavaWillReEnforce() {
        Map<String, Object> config = WorkflowPlanner.plan(analysis(20, Map.of())).steps().get(1).config();
        assertThat(config).containsEntry("requiredFields", List.of("channel_name", "subscribers"))
                .containsEntry("deduplicationKeys", List.of("channel_name"));
        assertThat(config.get("extractionSchema")).isEqualTo(SCHEMA);
    }

    @Test
    void aQuantityOfOneStillGetsRealBoundsInsteadOfAPlanThatCanDoNothing() {
        Map<String, Object> limits = limitsOf(WorkflowPlanner.plan(analysis(1, Map.of())));
        assertThat(limits).containsEntry("expectedRecords", 1)
                .containsEntry("maxSearchesPerRun", 2)
                .containsEntry("maxScrapesPerRun", 4);
    }

    @Test
    void theStoredStepsJsonParsesBackIntoTheSameNodesThePlannerBuilt() {
        WorkflowPlanner.Planned planned = WorkflowPlanner.plan(analysis(20, Map.of()));
        assertThat(PlanSteps.parse(planned.stepsJson()).order()).containsExactly("collect", "validate");
    }

    private static Map<String, Object> limitsOf(WorkflowPlanner.Planned planned) {
        return Json.map(PlanSteps.parse(planned.stepsJson()).configFor("collect").get("limits"));
    }

    private static Map<String, Object> limitsOf(int quantity) {
        return limitsOf(WorkflowPlanner.plan(analysis(quantity, Map.of())));
    }
}
