package ai.finalagent.workflow.execution;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Component;

import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.support.Json;

/**
 * Java re-checks what the AI service said it collected.
 *
 * <p>This is the rule the architecture is built on: Python's verdict is advisory and the side that
 * owns the data enforces the contract. Concretely, a record whose required field is missing or
 * blank, or which cites no source a tool actually retrieved, does not become valid because the
 * graph reported {@code COMPLETED}.
 *
 * <p>Nothing is deleted here. Failing records are counted and reported with their index, because
 * the previous project's {@code persistDataset} dropped unevidenced rows in silence
 * ({@code docs/audit/00-FORENSIC-AUDIT.md} §5 item 8) and a short dataset with no explanation is
 * indistinguishable from a search that genuinely found little.
 */
@Component
public class ValidateStepHandler implements StepHandler {

    private static final int MAX_REPORTED_ISSUES = 50;

    private final StepRepository steps;

    public ValidateStepHandler(StepRepository steps) {
        this.steps = steps;
    }

    @Override
    public String stepType() {
        return "VALIDATE";
    }

    @Override
    public StepOutcome handle(StepContext context) {
        Map<String, Object> config = context.require("config");
        List<String> requiredFields = Json.strings(config.get("requiredFields"));
        List<String> deduplicationKeys = Json.strings(config.get("deduplicationKeys"));

        Step source = collectSource(context);
        if (source == null) {
            return StepOutcome.failed("NO_COLLECT_OUTPUT",
                    "the collection step produced no output to validate", StepOutcome.Counters.none());
        }
        if (source.status() != JobStatus.COMPLETED) {
            return StepOutcome.failed("COLLECT_NOT_COMPLETED",
                    "collection ended " + source.status() + " (" + nullToEmpty(source.errorCode())
                            + "), so there is nothing to validate", StepOutcome.Counters.none());
        }

        Map<String, Object> output = Json.object(source.outputSummaryJson());
        List<Map<String, Object>> records = records(output.get("records"));

        if (records.isEmpty()) {
            return StepOutcome.failed("NO_RECORDS", "the research run returned no records at all",
                    StepOutcome.Counters.none());
        }

        List<Map<String, Object>> issues = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        int valid = 0;
        int duplicates = 0;

        for (int index = 0; index < records.size(); index++) {
            Map<String, Object> record = records.get(index);
            List<String> reasons = new ArrayList<>();

            Map<String, Object> values = Json.map(record.get("values"));
            for (String field : requiredFields) {
                Object value = values.get(field);
                if (value == null || String.valueOf(value).isBlank()) {
                    reasons.add("required field '" + field + "' is absent or blank");
                }
            }
            if (!hasVerifiedSource(record)) {
                reasons.add("cites no source a tool retrieved during this run");
            }

            String identity = identity(values, deduplicationKeys);
            boolean duplicate = identity != null && !seen.add(identity);
            if (duplicate) {
                reasons.add("same identity as an earlier record on " + String.join("+", deduplicationKeys));
                duplicates++;
            }

            if (reasons.isEmpty()) {
                valid++;
            } else if (issues.size() < MAX_REPORTED_ISSUES) {
                issues.add(Map.of("index", index, "reasons", reasons, "duplicate", duplicate));
            }
        }

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("recordsFound", records.size());
        summary.put("recordsValid", valid);
        summary.put("duplicates", duplicates);
        summary.put("issues", issues);
        summary.put("issuesTruncated", issues.size() >= MAX_REPORTED_ISSUES);
        summary.put("enforcedBy", "backend");

        // The run's records_found / records_raw were already added by the collection step; this step
        // contributes only the verdicts, or a two-step plan would report its records twice.
        StepOutcome.Counters counters = new StepOutcome.Counters(0, valid, duplicates, 0, 0, 0);

        if (valid == 0) {
            // Keep the findings: a FAILED step whose summary is empty tells nobody why.
            return new StepOutcome(JobStatus.FAILED, summary, counters, "NO_VALID_RECORDS",
                    "all " + records.size() + " collected records failed Java's contract check");
        }
        return StepOutcome.completed(summary, counters);
    }

    /**
     * The step this one depends on, found by dependency edge rather than by name — so renaming or
     * reordering a plan cannot quietly make validation read the wrong output.
     */
    private Step collectSource(StepContext context) {
        List<String> dependsOn = Json.stringList(context.step().dependsOnJson());
        if (dependsOn.isEmpty()) {
            return null;
        }
        return steps.findByKey(context.run().id(), dependsOn.get(0)).orElse(null);
    }

    private static boolean hasVerifiedSource(Map<String, Object> record) {
        if (!(record.get("sources") instanceof List<?> list) || list.isEmpty()) {
            return false;
        }
        for (Object entry : list) {
            if (entry instanceof Map<?, ?> map && Boolean.TRUE.equals(map.get("verifiedByTool"))) {
                return true;
            }
        }
        return false;
    }

    private static String identity(Map<String, Object> values, List<String> keys) {
        if (keys.isEmpty()) {
            return null;
        }
        StringBuilder builder = new StringBuilder();
        for (String key : keys) {
            Object value = values.get(key);
            if (value == null || String.valueOf(value).isBlank()) {
                return null;
            }
            builder.append(String.valueOf(value).trim().toLowerCase()).append('\u0000');
        }
        return builder.toString();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> records(Object value) {
        if (value instanceof List<?> list) {
            List<Map<String, Object>> typed = new ArrayList<>();
            for (Object item : list) {
                if (item instanceof Map<?, ?> map) {
                    typed.add((Map<String, Object>) map);
                }
            }
            return typed;
        }
        return List.of();
    }

    private static String nullToEmpty(String value) {
        return value == null ? "no code" : value;
    }
}
