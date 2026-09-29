package ai.finalagent.research;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ResponseStatus;

import ai.finalagent.aiclient.AiServiceClient;
import ai.finalagent.aiclient.dto.ResearchRequest;
import ai.finalagent.aiclient.dto.ResearchResult;
import ai.finalagent.common.ErrorResponse;
import jakarta.validation.Valid;

/**
 * Phase 2 integration surface: Spring receives the request, independently validates the
 * extraction contract, and hands it to the Python research graph.
 *
 * <p>Java re-checks the schema rather than trusting the caller or relying on Python to
 * catch it. A schema with no declared properties, or one that permits extra keys, would
 * make the graph's validation gate pass vacuously — a green result that means nothing —
 * which is the class of defect this project was rebuilt to remove.
 *
 * <p>Nothing is persisted here. Dataset storage arrives with the schema phase; until then
 * this endpoint is a pass-through that proves the Spring to Python to graph chain works.
 */
@RestController
@RequestMapping("/api/v1/research")
public class ResearchController {

    private final AiServiceClient aiServiceClient;

    public ResearchController(AiServiceClient aiServiceClient) {
        this.aiServiceClient = aiServiceClient;
    }

    @PostMapping
    public ResearchResult research(@Valid @RequestBody ResearchRequest request) {
        ExtractionSchemaValidator.validate(request.extractionSchema());
        WebToolPolicy.validate(request.limits());
        SourceCurationPolicy.validate(request.limits());
        return aiServiceClient.research(request);
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

    @ResponseStatus(HttpStatus.BAD_REQUEST)
    @ExceptionHandler(SourceCurationPolicy.InvalidCurationRequestException.class)
    public ErrorResponse handleInvalidCuration(SourceCurationPolicy.InvalidCurationRequestException e) {
        return ErrorResponse.of("INVALID_CURATION_REQUEST", e.getMessage());
    }

    @ExceptionHandler(AiServiceClient.AiServiceException.class)
    public ResponseEntity<ErrorResponse> handleUpstreamFailure(AiServiceClient.AiServiceException e) {
        // Mirror the upstream status when the AI service rejected the request itself; a
        // provider outage upstream is a 502 here, never a fabricated empty 200.
        HttpStatus status = e.upstreamStatus() >= 400 && e.upstreamStatus() < 500
                ? HttpStatus.valueOf(e.upstreamStatus())
                : HttpStatus.BAD_GATEWAY;
        String code = status.is4xxClientError() ? "AI_SERVICE_REJECTED_REQUEST" : "AI_SERVICE_UNAVAILABLE";
        return ResponseEntity.status(status).body(ErrorResponse.of(code,
                "The AI service could not complete the research run: " + e.getMessage()));
    }
}
