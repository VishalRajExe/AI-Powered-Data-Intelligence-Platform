package ai.finalagent.workflow.execution;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import ai.finalagent.workflow.support.Json;

/**
 * The plan's {@code steps} JSON, indexed by step key.
 *
 * <p>A job payload is a step's own config, copied at enqueue time rather than looked up at
 * execution time. That is what makes a job self-contained: a worker executing a job reclaimed an
 * hour later is running the config that was current when the job was created, not whatever the plan
 * says now.
 */
public final class PlanSteps {

    private final Map<String, Map<String, Object>> byKey;
    private final List<String> order;

    private PlanSteps(Map<String, Map<String, Object>> byKey, List<String> order) {
        this.byKey = byKey;
        this.order = order;
    }

    @SuppressWarnings("unchecked")
    public static PlanSteps parse(String stepsJson) {
        Map<String, Map<String, Object>> byKey = new LinkedHashMap<>();
        List<String> order = new java.util.ArrayList<>();
        if (stepsJson == null || stepsJson.isBlank()) {
            return new PlanSteps(byKey, order);
        }
        Object parsed;
        try {
            parsed = new com.fasterxml.jackson.databind.ObjectMapper().readValue(stepsJson, List.class);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("plan steps column is not a JSON array", e);
        }
        for (Object item : (List<Object>) parsed) {
            Map<String, Object> step = Json.map(item);
            String key = String.valueOf(step.get("key"));
            byKey.put(key, step);
            order.add(key);
        }
        return new PlanSteps(byKey, order);
    }

    public Map<String, Object> configFor(String stepKey) {
        Map<String, Object> step = byKey.get(stepKey);
        if (step == null) {
            return Map.of();
        }
        return Json.map(step.getOrDefault("config", Map.of()));
    }

    public Map<String, Object> payloadFor(String stepKey, String type) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("stepKey", stepKey);
        payload.put("type", type);
        payload.put("config", configFor(stepKey));
        return payload;
    }

    /** A plan node as materialised into a {@code workflow_steps} row. */
    public record Node(String key, String type, List<String> dependsOn, Map<String, Object> config) {
    }

    public List<Node> nodes() {
        List<Node> nodes = new java.util.ArrayList<>();
        for (String key : order) {
            Map<String, Object> step = byKey.get(key);
            nodes.add(new Node(key, String.valueOf(step.getOrDefault("type", "")),
                    Json.strings(step.get("dependsOn")), Json.map(step.get("config"))));
        }
        return List.copyOf(nodes);
    }

    public List<String> order() {
        return order;
    }

    public boolean isEmpty() {
        return byKey.isEmpty();
    }
}
