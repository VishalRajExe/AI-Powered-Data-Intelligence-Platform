package ai.finalagent.aiclient.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.Map;

/**
 * Request to the Python research graph: a requirement plus a dynamically generated
 * extraction schema. Nothing here names a domain — the schema is what makes each run
 * collect different fields.
 *
 * <p>Field names are camelCase to mirror {@code app/research/contracts.py}, which is
 * authoritative; Java re-validates rather than trusting the caller or the model.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ResearchRequest(
        @NotBlank @Size(min = 8, max = 2000) String topic,
        Map<String, Object> extractionSchema,
        Limits limits,
        List<String> seedQueries
) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Limits(
            Integer maxLoops,
            Integer maxSearchResults,
            Integer maxSearchesPerRun,
            Integer maxScrapesPerRun,
            Integer maxInteractionsPerRun,
            Integer expectedRecords,
            List<String> allowedDomains,
            List<String> blockedDomains,
            /**
             * Web tools this run wants. The AI service intersects it with its own
             * {@code ALLOWED_WEB_TOOLS}, so a caller can narrow the set but never widen it:
             * {@code interact} is enabled by an operator, not by a request.
             */
            List<String> allowedTools,
            /** The kind of thing being collected. Used to score candidates, never defaulted. */
            String entityType,
            List<String> preferredDomains,
            Integer maxSourcesPerDomain,
            Double minRelevanceScore,
            Integer desiredSources
    ) {
    }
}
