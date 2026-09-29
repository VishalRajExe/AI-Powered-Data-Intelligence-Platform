package ai.finalagent.workflow.plan;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import ai.finalagent.requirement.RequirementAnalysisDto;
import ai.finalagent.requirement.RequirementDto;
import ai.finalagent.workflow.support.Json;

/**
 * Requirement → the plan a run executes.
 *
 * <p><b>No language model is involved.</b> The AI service already produced the requirement, the
 * extraction schema and the search queries in Phase 3's structured call; the plan is derived from
 * those deterministically, so the same requirement always yields the same steps and the same
 * {@code planHash}. An LLM planner is a later, additive option — it is not what makes this layer
 * work, and pretending otherwise would put a model between the contract and the queue.
 *
 * <p><b>The step list contains only steps this build can execute.</b> {@code SAVE} and
 * {@code EXPORT} are absent, not skipped: the previous project emitted
 * {@code EXPORT_NOT_IN_PHASE} placeholders for a step its runner never implemented
 * ({@code workflow-runner.ts:167-169}), which is how a plan came to look complete while doing
 * nothing. They appear when dataset persistence and export exist.
 *
 * <p>The chain is {@code collect → transform → validate}, and the two ends are not interchangeable.
 * {@code transform} is the pipeline's single pass over the raw records — one call, because running
 * the same chain twice is exactly the bug the legacy runner had — and {@code validate} is Java's
 * independent verdict on the dataset that came out of it. Both steps carry the plan's own field list,
 * so neither has to ask the AI service what the contract was.
 */
public final class WorkflowPlanner {

    /** One node of the plan DAG, as stored in the plan's {@code steps} JSON column. */
    public record PlanStep(String key, String type, List<String> dependsOn, Map<String, Object> config) {
    }

    public record Planned(String objective, String requirementJson, String extractionSchemaJson,
                          String stepsJson, String searchStrategyJson, String sourcePolicyJson,
                          String completionCriteriaJson, String planHash, List<PlanStep> steps) {
    }

    public static final String COLLECT_STEP = "collect";
    public static final String TRANSFORM_STEP = "transform";
    public static final String VALIDATE_STEP = "validate";

    private WorkflowPlanner() {
    }

    public static Planned plan(RequirementAnalysisDto analysis) {
        RequirementDto requirement = analysis.requirement();
        Map<String, Object> schema = analysis.extractionSchema();
        Map<String, Object> policy = analysis.collectionPolicy() == null
                ? Map.of() : analysis.collectionPolicy();

        int quantity = clamp(requirement.quantity() == null ? 10 : requirement.quantity(), 1, 500);

        Map<String, Object> limits = new LinkedHashMap<>();
        limits.put("expectedRecords", quantity);
        limits.put("desiredSources", quantity);
        // Starting bounds, both overridable per workflow by an operator: searches are cheap and
        // scrapes are what Firecrawl bills, so scrapes scale at roughly one per two records.
        limits.put("maxSearchesPerRun", clamp(2 + quantity / 10, 2, 12));
        limits.put("maxScrapesPerRun", clamp(4 + quantity / 2, 4, 40));
        limits.put("entityType", requirement.entityType());
        putIfPresent(limits, "preferredDomains", policy.get("preferredDomains"));
        putIfPresent(limits, "blockedDomains", policy.get("blockedDomains"));

        Map<String, Object> collectConfig = new LinkedHashMap<>();
        collectConfig.put("topic", requirement.objective());
        collectConfig.put("extractionSchema", schema);
        collectConfig.put("limits", limits);
        collectConfig.put("seedQueries", analysis.searchQueries() == null ? List.of() : analysis.searchQueries());

        // The pipeline builds its field map from what it is sent, so the typed field list travels
        // into the step's own payload. `required` is derived here from the requirement's required
        // list rather than trusted from the model's per-field flag, which is the same field the
        // validator already had an opinion about.
        List<Map<String, Object>> fieldSpecs = fieldSpecs(requirement);

        Map<String, Object> transformConfig = new LinkedHashMap<>();
        transformConfig.put("extractionSchema", schema);
        transformConfig.put("entityType", requirement.entityType());
        transformConfig.put("objective", requirement.objective());
        transformConfig.put("fields", fieldSpecs);
        transformConfig.put("requiredFields", requirement.requiredFields());
        transformConfig.put("deduplicationKeys", requirement.deduplicationKeys());
        transformConfig.put("validationRules", requirement.validationRules());

        // Java enforces the contract against its own reading of the plan, so the same field list is
        // handed to the validating step too — independently, from the same authoritative source.
        Map<String, Object> validateConfig = new LinkedHashMap<>();
        validateConfig.put("extractionSchema", schema);
        validateConfig.put("fields", fieldSpecs);
        validateConfig.put("requiredFields", requirement.requiredFields());
        validateConfig.put("deduplicationKeys", requirement.deduplicationKeys());

        List<PlanStep> steps = List.of(
                new PlanStep(COLLECT_STEP, "EXTRACT", List.of(), collectConfig),
                new PlanStep(TRANSFORM_STEP, "TRANSFORM", List.of(COLLECT_STEP), transformConfig),
                new PlanStep(VALIDATE_STEP, "VALIDATE", List.of(TRANSFORM_STEP), validateConfig));

        Map<String, Object> completion = Map.of(
                "requireSourceEvidence", true,
                "minimumRecords", quantity,
                // Java re-checks evidence rather than trusting the AI service's own verdict; the
                // run is only COMPLETED if a step did not quietly disagree.
                "enforcedBy", "backend");

        Map<String, Object> canonical = new LinkedHashMap<>();
        canonical.put("objective", requirement.objective());
        canonical.put("requirement", analysis.requirement());
        canonical.put("extractionSchema", schema);
        canonical.put("steps", steps);
        canonical.put("searchStrategy", Map.of("queries", analysis.searchQueries() == null
                ? List.of() : analysis.searchQueries()));
        canonical.put("sourcePolicy", safetyPolicy(policy));
        canonical.put("completionCriteria", completion);

        String document = Json.write(canonical);
        return new Planned(
                requirement.objective(),
                Json.write(analysis.requirement()),
                Json.write(schema),
                Json.write(steps),
                Json.write(Map.of("queries", analysis.searchQueries() == null ? List.of()
                        : analysis.searchQueries())),
                Json.write(safetyPolicy(policy)),
                Json.write(completion),
                Json.shortHash(document),
                steps);
    }

    /**
     * The safety literals. They are constants written here, never values read from the model — the
     * old schema declared them as Zod literals for the same reason
     * ({@code workflow-plan.schema.ts:61-64}): a plan that can relax its own constraints is not a
     * constraint.
     */
    public static Map<String, Object> safetyPolicy(Map<String, Object> fromAnalysis) {
        Map<String, Object> policy = new LinkedHashMap<>();
        policy.put("respectRobotsTxt", true);
        policy.put("respectSiteTerms", true);
        policy.put("allowAuthentication", false);
        policy.put("allowCaptchaBypass", false);
        policy.put("preferredDomains", fromAnalysis.getOrDefault("preferredDomains", List.of()));
        policy.put("blockedDomains", fromAnalysis.getOrDefault("blockedDomains", List.of()));
        policy.put("unenforceablePreferences",
                fromAnalysis.getOrDefault("unenforceablePreferences", List.of()));
        return policy;
    }

    public static List<String> stepKeys(List<PlanStep> steps) {
        List<String> keys = new ArrayList<>();
        for (PlanStep step : steps) {
            keys.add(step.key());
        }
        return keys;
    }

    /**
     * The plan's field list, as a plain map per field.
     *
     * <p>{@code required} is derived from the requirement's own required-field list instead of read
     * off the model's per-field flag: the validator treats that list as the statement of what must be
     * present, and a field list that disagrees with it would make the run's contract depend on which
     * of the two happened to be consulted.
     */
    private static List<Map<String, Object>> fieldSpecs(RequirementDto requirement) {
        Set<String> required = new HashSet<>(requirement.requiredFields() == null
                ? List.of() : requirement.requiredFields());
        List<Map<String, Object>> specs = new ArrayList<>();
        for (RequirementDto.Field field : requirement.fields() == null
                ? List.<RequirementDto.Field>of() : requirement.fields()) {
            Map<String, Object> spec = new LinkedHashMap<>();
            spec.put("key", field.key());
            spec.put("label", field.label() == null ? "" : field.label());
            spec.put("type", field.type() == null ? "STRING" : field.type());
            spec.put("required", required.contains(field.key()));
            specs.add(spec);
        }
        return specs;
    }

    private static void putIfPresent(Map<String, Object> target, String key, Object value) {
        if (value instanceof List<?> list && !list.isEmpty()) {
            target.put(key, list);
        }
    }

    private static int clamp(int value, int low, int high) {
        return Math.max(low, Math.min(high, value));
    }
}
