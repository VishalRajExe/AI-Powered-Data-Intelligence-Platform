package ai.finalagent.workflow.support;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The one place JSON columns are read and written.
 *
 * <p>Stored JSON is never parsed speculatively: a malformed column is a data fault to report, not
 * a reason to substitute an empty value and carry on, because the two look identical to whoever
 * reads the run afterwards.
 */
public final class Json {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private Json() {
    }

    public static String write(Object value) {
        try {
            return MAPPER.writeValueAsString(value == null ? Map.of() : value);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("value cannot be stored as JSON", e);
        }
    }

    public static Map<String, Object> object(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return MAPPER.readValue(json, MAPPER.getTypeFactory()
                    .constructMapType(java.util.LinkedHashMap.class, String.class, Object.class));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("stored JSON column is not an object: " + e.getOriginalMessage(), e);
        }
    }

    /** A decoded JSON value that is already a map, as a map. Anything else is a contract fault. */
    public static Map<String, Object> map(Object value) {
        if (value == null) {
            return Map.of();
        }
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> typed = new java.util.LinkedHashMap<>();
            map.forEach((k, v) -> typed.put(String.valueOf(k), v));
            return typed;
        }
        throw new IllegalStateException("expected a JSON object, found " + value.getClass().getSimpleName());
    }

    /** Strings from either a decoded array or a stored JSON column; absent means empty. */
    public static List<String> strings(Object value) {
        if (value == null) {
            return List.of();
        }
        if (value instanceof String json) {
            return stringList(json);
        }
        if (value instanceof List<?> list) {
            return list.stream().map(String::valueOf).toList();
        }
        throw new IllegalStateException("expected a JSON array of strings, found "
                + value.getClass().getSimpleName());
    }

    @SuppressWarnings("unchecked")
    public static List<String> stringList(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            Object parsed = MAPPER.readValue(json, Object.class);
            if (parsed instanceof List<?> list) {
                return list.stream().map(String::valueOf).toList();
            }
            throw new IllegalStateException("expected a JSON array of strings");
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("stored JSON column is not a list: " + e.getOriginalMessage(), e);
        }
    }

    public static String shortHash(String canonical) {
        try {
            var digest = java.security.MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(canonical.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            var hex = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the plan hash", e);
        }
    }
}
