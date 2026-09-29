package ai.finalagent.workflow.execution;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;

import ai.finalagent.aiclient.AiServiceClient;
import ai.finalagent.aiclient.dto.ResearchRequest;
import ai.finalagent.aiclient.dto.ResearchResult;

/**
 * The {@code EXTRACT} step: one call to the AI service, which runs the research graph, which runs
 * Firecrawl. This is the only place Spring reaches the web, and it reaches it through exactly one
 * endpoint — there is no second collector here, and no fallback path that would quietly swap
 * engines if the first one fails.
 *
 * <p>Failure handling is where this class earns its keep. The AI service answers a run that
 * gathered too little with HTTP 200 and {@code status: FAILED} plus a reason, because the request
 * was valid and the work did happen; a 4xx means the request was wrong; a 5xx or a socket failure
 * means the boundary is broken. Those three need different reactions — one is a result to store,
 * one is a caller bug to fail on, and one is worth another attempt — and the previous project
 * collapsed them into a single retry loop that could not tell them apart.
 */
@Component
public class ExtractStepHandler implements StepHandler {

    private final AiServiceClient aiServiceClient;

    public ExtractStepHandler(AiServiceClient aiServiceClient) {
        this.aiServiceClient = aiServiceClient;
    }

    @Override
    public String stepType() {
        return "EXTRACT";
    }

    @Override
    public StepOutcome handle(StepContext context) {
        if (!context.stillHoldsLease().getAsBoolean()) {
            throw JobExecutionException.permanent("LEASE_LOST",
                    "the lease was taken over before this step started; results from a worker that "
                            + "no longer owns the job are never written");
        }
        if (context.cancelRequested().getAsBoolean()) {
            throw new JobExecutionException("RUN_CANCELLED", "cancellation was requested before the "
                    + "step began", false);
        }

        Map<String, Object> config = context.require("config");
        ResearchRequest request = new ResearchRequest(
                string(config.get("topic")),
                object(config.get("extractionSchema")),
                limits(config.get("limits")),
                stringList(config.get("seedQueries")));

        ResearchResult result;
        try {
            result = aiServiceClient.research(request);
        } catch (AiServiceClient.AiServiceException e) {
            throw JobExecutionException.fromHttpStatus(e.upstreamStatus(),
                    "the AI service refused the research run: " + safeMessage(e));
        } catch (ResourceAccessException e) {
            throw JobExecutionException.transientFailure(JobExecutionException.TRANSIENT_NETWORK,
                    "the AI service could not be reached: " + e.getClass().getSimpleName());
        }

        if (result == null) {
            throw JobExecutionException.permanent("EMPTY_UPSTREAM_RESPONSE",
                    "the AI service answered with no body at all");
        }

        return mapResult(result);
    }

    private static StepOutcome mapResult(ResearchResult result) {
        int records = result.records() == null ? 0 : result.records().size();
        int sources = result.sources() == null ? 0 : result.sources().size();
        ValidationData validation = ValidationData.of(result.validation());

        if ("FAILED".equals(result.status())) {
            // Permanent by decision, not by omission: the graph exhausted its bounds or said the
            // contract cannot be met from public sources, and re-running it on the same topic with
            // the same schema re-spends Firecrawl credits for the same answer.
            String reason = result.failureReason() == null ? "the research run reported failure"
                    : result.failureReason();
            // What the run saw is still counted; what it did not achieve is not.
            return StepOutcome.failed("RESEARCH_FAILED", reason,
                    new StepOutcome.Counters(0, 0, 0, sources, validation.refused(), records));
        }

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("researchStatus", result.status());
        summary.put("recordCount", records);
        summary.put("sourceCount", sources);
        summary.put("warnings", validation.warnings());
        summary.put("schemaValid", result.validation() == null ? null : result.validation().schemaValid());
        summary.put("missingFields", validation.missingFields());
        summary.put("unverifiedUrls", validation.unverifiedUrls());
        summary.put("recordsWithoutEvidence", validation.recordsWithoutEvidence());
        summary.put("refusedSources", validation.refusedSources());
        summary.put("droppedCandidates", validation.droppedCandidates());
        summary.put("metadata", result.metadata() == null ? Map.of() : result.metadata());
        // The records themselves: the next step re-checks them in Java, and the dataset tables that
        // will hold them properly belong to the persistence phase.
        summary.put("records", result.records() == null ? List.of() : result.records());

        return StepOutcome.completed(summary,
                new StepOutcome.Counters(records, 0, 0, sources, validation.refused(), records));
    }

    /**
     * The validation block is optional on the wire, and every one of its lists is separately
     * optional. Pulling them out once keeps the null ladder out of the summary below, where each
     * miss would otherwise be a place a count silently became zero.
     */
    private record ValidationData(List<String> warnings, List<String> missingFields,
                                  List<String> unverifiedUrls, List<Integer> recordsWithoutEvidence,
                                  List<ResearchResult.Refusal> refusedSources,
                                  List<Map<String, Object>> droppedCandidates, int refused) {

        static ValidationData of(ResearchResult.Validation validation) {
            if (validation == null) {
                return new ValidationData(List.of(), List.of(), List.of(), List.of(), List.of(),
                        List.of(), 0);
            }
            List<ResearchResult.Refusal> refusals = nz(validation.refusedSources());
            return new ValidationData(nz(validation.warnings()), nz(validation.missingFields()),
                    nz(validation.unverifiedUrls()), nz(validation.recordsWithoutEvidence()),
                    refusals, nz(validation.droppedCandidates()), refusals.size());
        }
    }

    private static <T> List<T> nz(List<T> value) {
        return value == null ? List.of() : value;
    }

    private static String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> object(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    @SuppressWarnings("unchecked")
    private static List<String> stringList(Object value) {
        return value instanceof List<?> list ? list.stream().map(String::valueOf).toList() : List.of();
    }

    @SuppressWarnings("unchecked")
    private static ResearchRequest.Limits limits(Object value) {
        if (!(value instanceof Map<?, ?> map)) {
            return null;
        }
        Map<String, Object> raw = (Map<String, Object>) map;
        return new ResearchRequest.Limits(integer(raw.get("maxLoops")), integer(raw.get("maxSearchResults")),
                integer(raw.get("maxSearchesPerRun")), integer(raw.get("maxScrapesPerRun")),
                integer(raw.get("maxInteractionsPerRun")), integer(raw.get("expectedRecords")),
                stringList(raw.get("allowedDomains")), stringList(raw.get("blockedDomains")),
                raw.get("allowedTools") == null ? null : stringList(raw.get("allowedTools")),
                string(raw.get("entityType")), stringList(raw.get("preferredDomains")),
                integer(raw.get("maxSourcesPerDomain")), number(raw.get("minRelevanceScore")),
                integer(raw.get("desiredSources")));
    }

    private static Integer integer(Object value) {
        return value instanceof Number number ? number.intValue() : null;
    }

    private static Double number(Object value) {
        return value instanceof Number number ? number.doubleValue() : null;
    }

    private static String safeMessage(Exception e) {
        String message = e.getMessage() == null ? "" : e.getMessage();
        return message.length() > 500 ? message.substring(0, 500) : message;
    }
}
