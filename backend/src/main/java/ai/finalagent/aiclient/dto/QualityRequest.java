package ai.finalagent.aiclient.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.Map;

/**
 * Body of {@code POST /ai/v1/quality/process}. The records are passed through as the collection run
 * produced them — {@code {values, sources}} — so the pipeline sees the same provenance object Java
 * already holds rather than a Java-shaped reinterpretation of it.
 *
 * <p>{@code rawRecordCount} is sent deliberately and separately from the list length. The legacy
 * report fell back to the count it was given
 * ({@code DataQualityService.ts:36}), so records lost before the pipeline reached it were
 * arithmetically invisible; a caller that says how many it collected makes that loss visible.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record QualityRequest(
        List<Map<String, Object>> records,
        Map<String, Object> extractionSchema,
        String entityType,
        String objective,
        List<Map<String, Object>> fields,
        List<String> requiredFields,
        List<String> deduplicationKeys,
        List<Map<String, Object>> validationRules,
        Integer rawRecordCount
) {
}
