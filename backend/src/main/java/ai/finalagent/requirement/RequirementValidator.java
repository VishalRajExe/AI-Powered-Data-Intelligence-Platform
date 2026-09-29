package ai.finalagent.requirement;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import ai.finalagent.requirement.RequirementDto.Field;
import ai.finalagent.requirement.RequirementDto.ValidationRule;

/**
 * Independently checks the requirement the AI service returned before anything continues.
 *
 * <p>Mirrors {@code Requirement.cross_validate} in Python. That duplication is intentional:
 * Java is the system of record and must not persist, plan or collect against a contract only
 * the model vouched for. The rules are the same ones the old project's schema enforced
 * ({@code requirement.schema.ts}); the enforcement is where it was missing.
 */
public final class RequirementValidator {

    private static final Pattern SNAKE = Pattern.compile("^[a-z][a-z0-9_]*$");
    private static final Set<String> FIELD_TYPES = Set.of(
            "STRING", "NUMBER", "BOOLEAN", "DATE", "DATETIME", "URL", "EMAIL", "PHONE", "CURRENCY", "JSON");
    private static final int MAX_QUANTITY = 10_000;

    private RequirementValidator() {
    }

    public enum Verdict {
        VALID,
        NEEDS_CLARIFICATION
    }

    public record Outcome(Verdict verdict, List<String> questions) {
        public boolean mayProceed() {
            return verdict == Verdict.VALID;
        }
    }

    /** @throws InvalidRequirementException when the AI response is structurally unusable. */
    public static Outcome validate(RequirementDto requirement) {
        if (requirement == null) {
            throw new InvalidRequirementException("the AI service returned no requirement");
        }

        List<String> problems = new ArrayList<>();

        requireText(problems, requirement.objective(), "objective");
        requireText(problems, requirement.entityType(), "entityType");

        if (requirement.fields() == null || requirement.fields().isEmpty()) {
            problems.add("fields must declare at least one attribute; an empty field list means the "
                    + "requirement was not actually analysed");
        } else {
            Map<String, Integer> occurrences = new HashMap<>();
            for (Field field : requirement.fields()) {
                if (field.key() == null || !SNAKE.matcher(field.key()).matches()) {
                    problems.add("field key must be snake_case: " + field.key());
                    continue;
                }
                occurrences.merge(field.key(), 1, Integer::sum);
                if (field.type() != null && !FIELD_TYPES.contains(field.type().toUpperCase(Locale.ROOT))) {
                    problems.add("field " + field.key() + " has unknown type " + field.type());
                }
            }
            occurrences.forEach((key, count) -> {
                if (count > 1) {
                    problems.add("duplicate field key: " + key);
                }
            });

            List<String> keys = requirement.fields().stream().map(Field::key).filter(java.util.Objects::nonNull)
                    .toList();
            List<String> partition = new ArrayList<>();
            partition.addAll(safe(requirement.requiredFields()));
            partition.addAll(safe(requirement.optionalFields()));
            if (!sortedCopy(partition).equals(sortedCopy(keys))) {
                problems.add("every field must appear in exactly one of requiredFields / optionalFields");
            }

            for (String key : safe(requirement.deduplicationKeys())) {
                if (!keys.contains(key)) {
                    problems.add("deduplicationKeys names undeclared field: " + key);
                }
            }

            if (requirement.validationRules() != null) {
                for (ValidationRule rule : requirement.validationRules()) {
                    if (rule.field() != null && !keys.contains(rule.field())) {
                        problems.add("validationRule references unknown field: " + rule.field());
                    }
                }
            }
        }

        if (requirement.quantity() != null
                && (requirement.quantity() < 1 || requirement.quantity() > MAX_QUANTITY)) {
            problems.add("quantity must be between 1 and " + MAX_QUANTITY);
        }

        if (!problems.isEmpty()) {
            throw new InvalidRequirementException(
                    "the AI requirement failed validation: " + String.join("; ", problems));
        }

        List<String> missing = safe(requirement.missingInformation());
        if (!missing.isEmpty()) {
            return new Outcome(Verdict.NEEDS_CLARIFICATION, missing);
        }
        return new Outcome(Verdict.VALID, List.of());
    }

    private static void requireText(List<String> problems, String value, String name) {
        if (value == null || value.isBlank()) {
            problems.add(name + " is required");
        }
    }

    private static List<String> safe(List<String> value) {
        return value == null ? List.of() : value;
    }

    private static List<String> sortedCopy(List<String> value) {
        return value.stream().sorted().toList();
    }

    public static class InvalidRequirementException extends RuntimeException {
        public InvalidRequirementException(String message) {
            super(message);
        }
    }
}
