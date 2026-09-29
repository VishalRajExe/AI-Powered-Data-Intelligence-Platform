package ai.finalagent.research;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Standalone checks for the extraction JSON Schema the AI service derives.
 *
 * <p>Shared by the direct research endpoint and the prompt-to-result pipeline, because both
 * must refuse a contract that would let the graph's validation gate pass vacuously.
 */
public final class ExtractionSchemaValidator {

    private ExtractionSchemaValidator() {
    }

    public static void validate(Map<String, Object> schema) {
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

    public static class InvalidExtractionSchemaException extends RuntimeException {
        public InvalidExtractionSchemaException(String message) {
            super(message);
        }
    }
}
