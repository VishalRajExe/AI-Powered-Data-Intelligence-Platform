package ai.finalagent.requirement;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.Map;

/**
 * Java mirror of {@code app/contracts.py:Requirement}, used to check the AI service's answer
 * before anything downstream runs.
 *
 * <p>The Python service validates first; this is not a duplicate of that work but the second
 * opinion the architecture requires — an AI response that only its producer vouches for is the
 * failure this project was rebuilt to remove.
 *
 * <p>Note on drift: Spring Boot disables {@code FAIL_ON_UNKNOWN_PROPERTIES}, and a class-level
 * {@code ignoreUnknown = false} does not re-enable it, so a key added on the Python side is
 * silently dropped here rather than causing a parse error. Contract drift is therefore caught by
 * {@link RequirementValidator}'s structural rules, not by deserialization — verified in
 * {@code PipelineControllerTest.unknownKeysFromTheAiServiceAreSilentlyDropped}.
 */
@JsonIgnoreProperties(ignoreUnknown = false)
public record RequirementDto(
        String objective,
        String entityType,
        Integer quantity,
        Geography geography,
        TimeRange timeRange,
        List<Filter> filters,
        List<String> constraints,
        List<Field> fields,
        List<String> requiredFields,
        List<String> optionalFields,
        List<String> sourcePreferences,
        List<String> sourceRestrictions,
        List<String> deduplicationKeys,
        List<ValidationRule> validationRules,
        String outputFormat,
        List<String> ambiguities,
        List<String> missingInformation,
        List<String> warnings
) {

    @JsonIgnoreProperties(ignoreUnknown = false)
    public record Field(String key, String label, String type, String description) {
    }

    @JsonIgnoreProperties(ignoreUnknown = false)
    public record Filter(String field, String operator, String value) {
    }

    @JsonIgnoreProperties(ignoreUnknown = false)
    public record ValidationRule(String rule, String field, Map<String, Object> params) {
    }

    @JsonIgnoreProperties(ignoreUnknown = false)
    public record Geography(List<String> places, String scope, Boolean includeSubregions) {
    }

    @JsonIgnoreProperties(ignoreUnknown = false)
    public record TimeRange(String from, String to, String relative) {
    }
}
