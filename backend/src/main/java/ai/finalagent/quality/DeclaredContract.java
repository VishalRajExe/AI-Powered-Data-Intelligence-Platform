package ai.finalagent.quality;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Java's own reading of the field contract, taken from the plan rather than from the pipeline's
 * answer.
 *
 * <p>The order matters and is the whole point of the class: the plan's declared {@code fields} and
 * {@code requiredFields} were fixed by Java before the run started (Phase 3's validator rejected an
 * unknown type, a duplicate key or an empty field list), so they are the standard the dataset is
 * measured against. The pipeline's dataset columns are a report of what the pipeline chose to emit,
 * and a checker that reads its spec from the thing it is checking confirms whatever the other side
 * decided.
 *
 * <p>Keys are folded the way {@code app/quality/normalize.py:fold_key} folds them — lowercase, every
 * run of non-alphanumerics collapsed to a single underscore, outer underscores stripped. Without
 * that, "Channel Name" in a plan and {@code channel_name} in a normalized record are two different
 * words to two different languages, and every field would read as undeclared.
 */
public record DeclaredContract(List<String> keys, Map<String, String> types, Set<String> required,
                               String basis) {

    /**
     * @param basis where the spec came from: {@code plan} when the plan declared fields,
     *              {@code pipeline-columns} when Java had nothing to check against and is using
     *              the shape the pipeline reported, which is weaker and has to be said out loud.
     */
    public DeclaredContract {
        keys = List.copyOf(keys);
        types = Map.copyOf(types);
        required = Set.copyOf(required);
    }

    @SuppressWarnings("unchecked")
    public static DeclaredContract fromConfig(Map<String, Object> config) {
        Map<String, Object> source = config == null ? Map.of() : config;
        return fromFields(JsonMaps.list(source.get("fields")),
                JsonMaps.strings(source.get("requiredFields")));
    }

    /** The plan's field list plus its required-field list, which is the contract of record. */
    public static DeclaredContract fromFields(List<Map<String, Object>> fields,
                                              List<String> requiredFields) {
        List<String> keys = new ArrayList<>();
        Map<String, String> types = new LinkedHashMap<>();
        Set<String> required = new LinkedHashSet<>();
        for (Map<String, Object> field : fields) {
            String key = fold(String.valueOf(field.getOrDefault("key", "")));
            if (key.isEmpty() || types.containsKey(key)) {
                continue;
            }
            keys.add(key);
            types.put(key, type(field.get("type")));
            if (Boolean.TRUE.equals(field.get("required"))) {
                required.add(key);
            }
        }
        for (String raw : requiredFields) {
            String key = fold(raw);
            if (key.isEmpty()) {
                continue;
            }
            // A required field the plan never typed is still required; the empty type is not an
            // assumption of STRING, it is the absence of one, so no type rule is checked for it.
            if (types.putIfAbsent(key, "") == null) {
                keys.add(key);
            }
            required.add(key);
        }
        return new DeclaredContract(keys, types, required, keys.isEmpty() ? "none" : "plan");
    }

    /**
     * The fallback: a pipeline column list, used only when the plan declared no fields at all. The
     * types here describe what the pipeline emitted rather than what was asked for, so a field the
     * pipeline mis-typed stops being a disagreement and becomes the rule — which is why the basis is
     * carried on the record and printed in every summary.
     */
    public static DeclaredContract fromColumns(List<Map<String, Object>> columns,
                                               List<String> requiredFields) {
        List<Map<String, Object>> fields = new ArrayList<>();
        for (Map<String, Object> column : columns) {
            Map<String, Object> asField = new LinkedHashMap<>();
            asField.put("key", column.getOrDefault("key", ""));
            asField.put("type", column.getOrDefault("type", ""));
            asField.put("required", Boolean.TRUE.equals(column.get("required")));
            fields.add(asField);
        }
        DeclaredContract fromColumns = fromFields(fields, requiredFields);
        return new DeclaredContract(fromColumns.keys(), fromColumns.types(), fromColumns.required(),
                columns.isEmpty() ? "none" : "pipeline-columns");
    }

    public static String fold(String key) {
        if (key == null) {
            return "";
        }
        String lowered = key.trim().toLowerCase(Locale.ROOT);
        StringBuilder folded = new StringBuilder(lowered.length());
        boolean pending = false;
        for (int i = 0; i < lowered.length(); i++) {
            char c = lowered.charAt(i);
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
                if (pending && folded.length() > 0) {
                    folded.append('_');
                }
                folded.append(c);
                pending = false;
                continue;
            }
            pending = true;
        }
        return folded.toString();
    }

    public boolean hasKey(String foldedKey) {
        return types.containsKey(foldedKey);
    }

    /** The declared type, or empty when nothing was declared — and empty means "no rule to check". */
    public String typeOf(String foldedKey) {
        return types.getOrDefault(foldedKey, "");
    }

    private static String type(Object raw) {
        if (raw == null) {
            return "";
        }
        String value = String.valueOf(raw).trim().toUpperCase(Locale.ROOT);
        if (value.isEmpty()) {
            return "";
        }
        return switch (value) {
            case "INT", "INTEGER", "FLOAT", "DOUBLE", "NUMBER" -> "NUMBER";
            case "STR", "STRING" -> "STRING";
            case "BOOL", "BOOLEAN" -> "BOOLEAN";
            case "URI", "URL" -> "URL";
            case "EMAIL" -> "EMAIL";
            case "DATE" -> "DATE";
            case "DATETIME", "TIMESTAMP" -> "DATETIME";
            case "PHONE", "TEL" -> "PHONE";
            case "CURRENCY", "MONEY", "AMOUNT" -> "CURRENCY";
            case "OBJECT", "ARRAY", "JSON" -> "JSON";
            default -> value;
        };
    }

    /** Small local readers, so this class can be built from a plain map without pulling in a layer. */
    private static final class JsonMaps {

        private JsonMaps() {
        }

        @SuppressWarnings("unchecked")
        static List<Map<String, Object>> list(Object value) {
            if (!(value instanceof List<?> raw)) {
                return List.of();
            }
            List<Map<String, Object>> typed = new ArrayList<>();
            for (Object item : raw) {
                if (item instanceof Map<?, ?> map) {
                    typed.add((Map<String, Object>) map);
                }
            }
            return typed;
        }

        static List<String> strings(Object value) {
            return value instanceof List<?> raw ? raw.stream().map(String::valueOf).toList()
                    : List.of();
        }
    }
}
