package ai.finalagent.research;

import java.util.List;
import java.util.Map;
import java.util.Set;

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
        validateExtractionSchema(request.extractionSchema());
        return aiServiceClient.research(request);
    }

    static void validateExtractionSchema(Map<String, Object> schema) {
        if (schema == null || schema.isEmpty()) {
            throw new InvalidExtractionSchemaException("extractionSchema is required");
        }
        if (!"object".equals(schema.get("type"))) {
            throw new InvalidExtractionSchemaException(
                    "extractionSchema.type must be 'object' — the contract describes one result");
        }
        if (!(schema.get("properties") instanceof Map<?, ?> properties) || properties.isEmpty()) {
            throw new InvalidExtractionSchemaException(
                    "extractionSchema.properties must declare at least one field; an empty schema "
                            + "would make validation pass vacuously");
        }
        if (!Boolean.FALSE.equals(schema.get("additionalProperties"))) {
            throw new InvalidExtractionSchemaException(
                    "extractionSchema must set additionalProperties:false so invented fields are caught");
        }
        if (schema.get("required") instanceof List<?> required) {
            Set<?> declared = properties.keySet();
            List<?> unknown = required.stream().filter(name -> !declared.contains(name)).toList();
            if (!unknown.isEmpty()) {
                throw new InvalidExtractionSchemaException(
                        "extractionSchema.required names undeclared properties: " + unknown);
            }
        }
    }

    @ResponseStatus(HttpStatus.BAD_REQUEST)
    @ExceptionHandler(InvalidExtractionSchemaException.class)
    public ErrorResponse handleInvalidSchema(InvalidExtractionSchemaException e) {
        return ErrorResponse.of("INVALID_EXTRACTION_SCHEMA", e.getMessage());
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

    public static class InvalidExtractionSchemaException extends RuntimeException {
        public InvalidExtractionSchemaException(String message) {
            super(message);
        }
    }
}
