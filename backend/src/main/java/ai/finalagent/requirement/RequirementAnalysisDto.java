package ai.finalagent.requirement;

import ai.finalagent.aiclient.dto.ResearchRequest;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.Map;

/**
 * Response of {@code POST /ai/v1/requirements/analyze}: the requirement, the extraction schema
 * derived from it, and the plain-language brief handed to the research graph.
 */
@JsonIgnoreProperties(ignoreUnknown = false)
public record RequirementAnalysisDto(
        String status,
        RequirementDto requirement,
        Map<String, Object> extractionSchema,
        List<String> searchQueries,
        String researchBrief,
        List<String> clarificationQuestions,
        Map<String, Object> metadata
) {

    /**
     * The body Spring sends to the research graph after validating this analysis. The brief,
     * not the raw user prompt, is what the graph receives: geography, dates, filters and
     * source wishes have already been resolved into collection constraints.
     */
    public ResearchRequest toResearchRequest(ResearchRequest.Limits limits) {
        return new ResearchRequest(researchBrief, extractionSchema, limits, searchQueries);
    }
}
