package ai.finalagent.workflow.execution;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;

import ai.finalagent.aiclient.AiServiceClient;
import ai.finalagent.aiclient.dto.QualityRequest;
import ai.finalagent.aiclient.dto.QualityResult;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.support.Json;

/**
 * The {@code TRANSFORM} step: the raw collection becomes a dataset through the quality pipeline.
 *
 * <p>The pipeline runs <b>once per run</b>, in one call. The replaced project ran its whole chain at
 * both the MERGE and the SAVE steps ({@code workflow-runner.ts:160,164}), so a plan with both
 * normalized, deduplicated and scored the same records twice; splitting the stages across four
 * workflow steps would reintroduce that in a new shape, and would also serialize the whole record
 * set through a JSON column four times before there is a dataset table to hold it. The stages are
 * separate inside the response — each with its own counts, notes and failure — which is the property
 * that actually matters: being able to see what each one did.
 *
 * <p>What this step's verdict is <em>not</em>: the contract check. {@link InputSteps} pulls the
 * collection output, the AI service proposes a cleaned dataset, and the authoritative re-enforcement
 * is the next step's job in Java. A pipeline that fails to flag a bad record here does not put that
 * record in a dataset.
 */
@Component
public class TransformStepHandler implements StepHandler {

    private final AiServiceClient aiServiceClient;
    private final StepRepository steps;

    public TransformStepHandler(AiServiceClient aiServiceClient, StepRepository steps) {
        this.aiServiceClient = aiServiceClient;
        this.steps = steps;
    }

    @Override
    public String stepType() {
        return "TRANSFORM";
    }

    @Override
    public StepOutcome handle(StepContext context) {
        if (!context.stillHoldsLease().getAsBoolean()) {
            throw JobExecutionException.permanent("LEASE_LOST",
                    "the lease was taken over before this step started; results from a worker that "
                            + "no longer owns the job are never written");
        }
        if (context.cancelRequested().getAsBoolean()) {
            throw new JobExecutionException("RUN_CANCELLED", "cancellation was requested before the "
                    + "step began", false);
        }

        Map<String, Object> config = context.require("config");
        Optional<Map<String, Object>> collected = InputSteps.completedDependencyOutput(context, steps,
                "there is nothing to normalize");
        if (collected.isEmpty()) {
            return StepOutcome.failed("NO_COLLECT_OUTPUT",
                    "the collection step produced no output, so there is nothing to process",
                    StepOutcome.Counters.none());
        }

        List<Map<String, Object>> records = records(collected.get().get("records"));
        if (records.isEmpty()) {
            return StepOutcome.failed("NOTHING_COLLECTED",
                    "the collection step completed with no records, so the pipeline had nothing to "
                            + "process", StepOutcome.Counters.none());
        }

        QualityRequest request = new QualityRequest(
                records,
                Json.map(config.get("extractionSchema")),
                string(config.get("entityType")),
                string(config.get("objective")),
                mapList(config.get("fields")),
                strings(config.get("requiredFields")),
                strings(config.get("deduplicationKeys")),
                mapList(config.get("validationRules")),
                integer(collected.get().get("recordCount")));

        QualityResult result;
        try {
            result = aiServiceClient.processQuality(request);
        } catch (AiServiceClient.AiServiceException e) {
            throw JobExecutionException.fromHttpStatus(e.upstreamStatus(),
                    "the AI service refused the quality run: " + safeMessage(e));
        } catch (ResourceAccessException e) {
            throw JobExecutionException.transientFailure(JobExecutionException.TRANSIENT_NETWORK,
                    "the AI service could not be reached: " + e.getClass().getSimpleName());
        }
        if (result == null) {
            throw JobExecutionException.permanent("EMPTY_UPSTREAM_RESPONSE",
                    "the AI service answered the quality run with no body at all");
        }
        if ("FAILED".equals(result.status())) {
            // The pipeline says what it could not do instead of returning something approximate, so
            // the run stops here rather than persisting an unprocessed record set as if it were clean.
            return StepOutcome.failed("QUALITY_PIPELINE_FAILED",
                    result.failureReason() == null ? "the quality pipeline reported failure"
                            : result.failureReason(),
                    StepOutcome.Counters.none());
        }

        List<String> stageFailures = new ArrayList<>();
        for (QualityResult.Stage stage : result.stages() == null ? List.<QualityResult.Stage>of()
                : result.stages()) {
            if ("FAILED".equals(stage.status())) {
                stageFailures.add(stage.stage() + ": " + stage.error());
            }
        }

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("pipelineStatus", result.status());
        summary.put("recordsIn", records.size());
        summary.put("stages", stageReports(result));
        summary.put("stageFailures", stageFailures);
        summary.put("quality", qualityView(result));
        summary.put("dataset", datasetView(result));
        // The pipeline's records as it sent them, with their provenance and its own verdicts. This is
        // the handoff the next step reads: Java re-decides validity there, so `isValid` on these rows
        // is a proposal on the page of the record that reported it, never the run's answer.
        summary.put("records", result.records() == null ? List.of() : result.records());
        summary.put("validityIsAdvisory", "isValid on these records is the pipeline's opinion; the "
                + "validate step's Java verdict is what the run is judged on");
        if (result.warnings() != null && !result.warnings().isEmpty()) {
            summary.put("pipelineWarnings", result.warnings());
        }
        // Passed through from the collection step, because the dataset that gets saved downstream is
        // built from this step's output and a refused page has to travel with it. "This field is empty
        // because the site refused us" is only answerable if the refusal survives to the dataset.
        summary.put("sourcesRefused", collected.map(output -> output.get("refusedSources"))
                .orElse(List.of()));
        if (!stageFailures.isEmpty()) {
            // A stage that died mid-run means the dataset is thinner than it looks, not wrong.
            // That distinction belongs in the summary, where a reviewer will find it.
            summary.put("partialProcessing", "one or more stages did not complete; the counts in "
                    + "`stages` say which");
        }

        int rows = result.dataset() == null || result.dataset().rows() == null
                ? 0 : result.dataset().rows().size();
        int duplicates = result.quality() == null ? 0 : result.quality().duplicateCount();
        summary.put("datasetRowCount", rows);
        // The only run-level counter this step owns is the duplicates it linked. The collection step
        // already added what it found and what it collected, and a step that added the same records
        // again would report a run of twice the size it ran — which is why the row count goes into
        // the summary, where it is read, and not into the totals, where it would be counted twice.
        return StepOutcome.completed(summary, new StepOutcome.Counters(0, 0, duplicates, 0, 0, 0));
    }

    private static List<Map<String, Object>> stageReports(QualityResult result) {
        List<Map<String, Object>> stages = new ArrayList<>();
        for (QualityResult.Stage stage : result.stages() == null ? List.<QualityResult.Stage>of()
                : result.stages()) {
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("stage", stage.stage());
            view.put("status", stage.status());
            view.put("inputCount", stage.inputCount());
            view.put("outputCount", stage.outputCount());
            view.put("metrics", stage.metrics() == null ? Map.of() : stage.metrics());
            view.put("notes", stage.notes() == null ? List.of() : stage.notes());
            if (stage.error() != null) {
                view.put("error", stage.error());
            }
            stages.add(view);
        }
        return stages;
    }

    private static Map<String, Object> qualityView(QualityResult result) {
        QualityResult.Quality quality = result.quality();
        if (quality == null) {
            return Map.of("reportMissing", "the pipeline returned no quality report");
        }
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("rawCount", quality.rawCount());
        view.put("normalizedCount", quality.normalizedCount());
        view.put("advisoryValidCount", quality.validCount());
        view.put("advisoryInvalidCount", quality.invalidCount());
        view.put("duplicateCount", quality.duplicateCount());
        view.put("reviewRequiredCount", quality.reviewRequiredCount());
        view.put("conflictCount", quality.conflictCount());
        view.put("sourceBackedCount", quality.sourceBackedCount());
        view.put("qualityScore", quality.qualityScore());
        view.put("scoreBasis", quality.scoreBasis());
        view.put("scoreComponents", quality.scoreComponents() == null ? Map.of()
                : quality.scoreComponents());
        view.put("metrics", quality.metrics() == null ? Map.of() : quality.metrics());
        return view;
    }

    private static Map<String, Object> datasetView(QualityResult result) {
        if (result.dataset() == null) {
            return Map.of("columns", List.of(), "rowCount", 0);
        }
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("columns", result.dataset().columns() == null ? List.of()
                : result.dataset().columns());
        view.put("rowCount", result.dataset().rows() == null ? 0 : result.dataset().rows().size());
        view.put("rowRecordIndexes", result.dataset().rows() == null ? List.of()
                : result.dataset().rows().stream().map(QualityResult.Row::recordIndex).toList());
        return view;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> records(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        List<Map<String, Object>> typed = new ArrayList<>();
        for (Object item : list) {
            if (item instanceof Map<?, ?> map) {
                typed.add((Map<String, Object>) map);
            }
        }
        return typed;
    }

    private static List<Map<String, Object>> mapList(Object value) {
        return value == null ? List.of() : records(value);
    }

    private static List<String> strings(Object value) {
        return value instanceof List<?> list ? list.stream().map(String::valueOf).toList() : List.of();
    }

    private static String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static Integer integer(Object value) {
        return value instanceof Number number ? number.intValue() : null;
    }

    private static String safeMessage(Exception e) {
        String message = e.getMessage() == null ? "" : e.getMessage();
        return message.length() > 500 ? message.substring(0, 500) : message;
    }
}
