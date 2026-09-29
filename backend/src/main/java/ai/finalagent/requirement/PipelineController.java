package ai.finalagent.requirement;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import ai.finalagent.aiclient.AiServiceClient;
import ai.finalagent.aiclient.dto.ResearchRequest;
import ai.finalagent.aiclient.dto.ResearchResult;
import ai.finalagent.common.ErrorResponse;
import ai.finalagent.research.ExtractionSchemaValidator;
import ai.finalagent.research.WebToolPolicy;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The natural-language front door: prompt → AI requirement → data contract → extraction
 * schema → research graph, with Spring's validation gate between the stages.
 *
 * <p>Two calls to the AI service, deliberately not one. Python proposes a contract; Spring
 * checks it; only then is collection allowed to start. If Python did the whole chain in one
 * request, this service would be forwarding an unverified AI answer straight into a web
 * collection run — which is precisely the shape that produced the old project's behaviour of
 * answering every prompt with the same hardcoded startup schema.
 */
@RestController
@RequestMapping("/api/v1")
public class PipelineController {

    private final AiServiceClient aiServiceClient;

    public PipelineController(AiServiceClient aiServiceClient) {
        this.aiServiceClient = aiServiceClient;
    }

    public record PromptRequest(
            @NotBlank @Size(min = 8, max = 4000) String prompt,
            ResearchRequest.Limits limits
    ) {
    }

    /** Analyses and validates, but collects nothing: the caller sees the contract first. */
    @PostMapping("/requirements/parse")
    public RequirementAnalysisDto parse(@Valid @RequestBody PromptRequest request) {
        return analysedAndValidated(request);
    }

    /** The full flow, gated. Returns {@code NEEDS_CLARIFICATION} without collecting. */
    @PostMapping("/research/from-prompt")
    public Map<String, Object> fromPrompt(@Valid @RequestBody PromptRequest request) {
        RequirementAnalysisDto analysis = analysedAndValidated(request);

        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("status", analysis.status());
        envelope.put("requirement", analysis.requirement());
        envelope.put("extractionSchema", analysis.extractionSchema());
        envelope.put("metadata", analysis.metadata());
        envelope.put("clarificationQuestions", analysis.clarificationQuestions());

        RequirementValidator.Verdict verdict = RequirementValidator.validate(analysis.requirement()).verdict();
        if (verdict != RequirementValidator.Verdict.VALID) {
            envelope.put("research", null);
            envelope.put("status", "NEEDS_CLARIFICATION");
            return envelope;
        }

        ResearchResult result = aiServiceClient.research(analysis.toResearchRequest(request.limits()));
        envelope.put("status", result.status());
        envelope.put("research", result);
        envelope.put("clarificationQuestions", List.of());
        return envelope;
    }

    private RequirementAnalysisDto analysedAndValidated(PromptRequest request) {
        // Checked before anything is spent: a request that names a tool this build does not
        // have, or a session budget it did not ask for, is the caller's mistake to fix.
        WebToolPolicy.validate(request.limits());

        RequirementAnalysisDto analysis;
        try {
            analysis = aiServiceClient.analyzeRequirement(request.prompt());
        } catch (AiServiceClient.AiServiceException e) {
            throw e;
        }

        // Structural validity first, then collectability: both are Java's own checks, not
        // Python's opinion echoed back.
        ExtractionSchemaValidator.validate(analysis.extractionSchema());
        RequirementValidator.validate(analysis.requirement());
        return analysis;
    }

    @ResponseStatus(HttpStatus.BAD_REQUEST)
    @ExceptionHandler(RequirementValidator.InvalidRequirementException.class)
    public ErrorResponse handleInvalidRequirement(RequirementValidator.InvalidRequirementException e) {
        return ErrorResponse.of("INVALID_REQUIREMENT", e.getMessage());
    }

    @ResponseStatus(HttpStatus.BAD_REQUEST)
    @ExceptionHandler(ExtractionSchemaValidator.InvalidExtractionSchemaException.class)
    public ErrorResponse handleInvalidSchema(ExtractionSchemaValidator.InvalidExtractionSchemaException e) {
        return ErrorResponse.of("INVALID_EXTRACTION_SCHEMA", e.getMessage());
    }

    @ResponseStatus(HttpStatus.BAD_REQUEST)
    @ExceptionHandler(WebToolPolicy.InvalidWebToolRequestException.class)
    public ErrorResponse handleInvalidWebTools(WebToolPolicy.InvalidWebToolRequestException e) {
        return ErrorResponse.of("INVALID_WEB_TOOLS", e.getMessage());
    }

    @ExceptionHandler(AiServiceClient.AiServiceException.class)
    public ResponseEntity<ErrorResponse> handleUpstream(AiServiceClient.AiServiceException e) {
        HttpStatus status = e.upstreamStatus() >= 400 && e.upstreamStatus() < 500
                ? HttpStatus.valueOf(e.upstreamStatus())
                : HttpStatus.BAD_GATEWAY;
        String code = status.is4xxClientError() ? "AI_SERVICE_REJECTED_REQUEST" : "AI_SERVICE_UNAVAILABLE";
        return ResponseEntity.status(status).body(ErrorResponse.of(code,
                "The AI service could not analyse the request: " + e.getMessage()));
    }
}
