package ai.finalagent.workflow.execution;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Component;

import ai.finalagent.aiclient.dto.QualityResult;
import ai.finalagent.dataset.domain.DatasetDraft;
import ai.finalagent.dataset.repository.DatasetRepository;
import ai.finalagent.dataset.service.DatasetAssembler;
import ai.finalagent.quality.DeclaredContract;
import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.repository.ActivityRepository;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.repository.WorkflowRepository;
import ai.finalagent.workflow.support.Json;

/**
 * The {@code SAVE} step: the dataset the run produced becomes queryable rows in MySQL.
 *
 * <p>This step exists because there is now something worth saving. Until Phase 8 the run's answer was
 * a report; since then it is a typed dataset — columns from the run's own contract, canonical rows
 * with duplicates linked rather than deleted, per-record provenance, conflicts with both values kept,
 * and Java's verdict per row next to the pipeline's. Reading two steps to assemble it is deliberate:
 * {@code transform} holds what the pipeline proposed and {@code validate} holds what Java decided
 * about it, and a save that read only one of them would persist either an unverified proposal or a
 * verdict with nothing to attach it to.
 *
 * <p><b>Idempotent by design.</b> A reclaimed or retried job saves under the same dataset id and
 * replaces its own children in one transaction, so a run has one dataset rather than one per attempt.
 * The unique key on {@code run_id} is what enforces that; nothing here checks first and hopes.
 */
@Component
public class SaveStepHandler implements StepHandler {

    private final StepRepository steps;
    private final WorkflowRepository workflows;
    private final ActivityRepository activity;
    private final DatasetRepository datasets;

    public SaveStepHandler(StepRepository steps, WorkflowRepository workflows,
                           ActivityRepository activity, DatasetRepository datasets) {
        this.steps = steps;
        this.workflows = workflows;
        this.activity = activity;
        this.datasets = datasets;
    }

    @Override
    public String stepType() {
        return "SAVE";
    }

    @Override
    public StepOutcome handle(StepContext context) {
        if (!context.stillHoldsLease().getAsBoolean()) {
            throw JobExecutionException.permanent("LEASE_LOST",
                    "the lease was taken over before this step started; a worker that no longer owns "
                            + "the job never writes a dataset");
        }
        if (context.cancelRequested().getAsBoolean()) {
            throw new JobExecutionException("RUN_CANCELLED", "cancellation was requested before the "
                    + "step began", false);
        }

        Map<String, Object> config = context.require("config");
        Optional<Map<String, Object>> transformed = InputSteps.completedDependencyOutput(context, steps,
                "transform", "there is no processed record set to save");
        Optional<Map<String, Object>> validated = InputSteps.completedDependencyOutput(context, steps,
                "validate", "there is no verdict on the records to save");
        if (transformed.isEmpty() || validated.isEmpty()) {
            return StepOutcome.failed("NO_DATASET_INPUT",
                    "the pipeline output or Java's verdict on it is missing, so nothing can be saved",
                    StepOutcome.Counters.none());
        }

        QualityResult produced = reconstruct(transformed.get());
        Map<Integer, Boolean> javaVerdicts = verdicts(validated.get());
        if (javaVerdicts.isEmpty()) {
            // The validator ran but recorded no per-row verdict. Saving anyway would mean writing rows
            // whose validity nobody established, which is the failure this whole layer replaced.
            return StepOutcome.failed("NO_ROW_VERDICTS",
                    "the validating step stored no per-row verdict, so no row here can be called valid",
                    StepOutcome.Counters.none());
        }

        String datasetId = datasetsForRun(context).orElseGet(() -> UUID.randomUUID().toString());
        DatasetAssembler.Origin origin = new DatasetAssembler.Origin(
                context.run().workspaceId(), context.run().id(), context.run().workflowId(),
                context.run().planId(), context.step().id(), objectiveOf(config, context),
                requirementOf(context), str(config.get("entityType")),
                Json.map(config.get("extractionSchema")));
        DatasetDraft draft = DatasetAssembler.assemble(origin, produced, javaVerdicts,
                DeclaredContract.fromConfig(config),
                mapList(transformed.get().get("sourcesRefused")));

        datasets.save(datasetId, draft);
        activity.record(context.run().workspaceId(), context.run().id(), null, "workflow.dataset.saved",
                "dataset", datasetId,
                "dataset saved with " + draft.rowCount() + " row(s), " + draft.validRowCount()
                        + " of them valid under Java's contract check",
                Map.of("datasetId", datasetId, "columns", draft.columns().size(),
                        "sources", draft.sourceCount(), "duplicates", draft.duplicateCount()));

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("datasetId", datasetId);
        summary.put("rowCount", draft.rowCount());
        summary.put("validRowCount", draft.validRowCount());
        summary.put("invalidRowCount", draft.invalidRowCount());
        summary.put("duplicateCount", draft.duplicateCount());
        summary.put("columnCount", draft.columns().size());
        summary.put("sourceCount", draft.sourceCount());
        summary.put("verifiedSourceCount", draft.verifiedSourceCount());
        summary.put("blockedSourceCount", draft.blockedSourceCount());
        summary.put("conflictCount", draft.conflictCount());
        summary.put("recordsWithoutEvidence", draft.recordsWithoutEvidence());
        summary.put("status", draft.header().status());
        // Nothing at run level. Collection added the records it found, the pipeline added the
        // duplicates it linked, and validation added the verdicts — a save that added its own
        // `validRowCount` would report a run of twice the rows it had, which is exactly what the
        // first four-step run measured. What this step owns is the dataset table itself.
        return StepOutcome.completed(summary, StepOutcome.Counters.none());
    }

    /** The dataset this run already owns, if a previous attempt of this step wrote one. */
    private Optional<String> datasetsForRun(StepContext context) {
        return datasets.findByRun(context.run().workspaceId(), context.run().id())
                .map(dataset -> dataset.id());
    }

    /**
     * The pipeline's records and dataset, read back out of the JSON column the transform step wrote.
     * Same reconstruction the validating step uses, so both read one shape rather than two guesses.
     */
    private static QualityResult reconstruct(Map<String, Object> output) {
        List<QualityResult.Record> records = Json.list(output.get("records"), QualityResult.Record.class);
        Map<String, Object> dataset = Json.map(output.get("dataset"));
        List<QualityResult.Row> rows = new ArrayList<>();
        if (dataset.get("rowRecordIndexes") instanceof List<?> indexes) {
            for (Object index : indexes) {
                if (index instanceof Number number) {
                    rows.add(new QualityResult.Row(number.intValue(), Map.of()));
                }
            }
        }
        return new QualityResult(String.valueOf(output.get("pipelineStatus")), records,
                new QualityResult.Dataset(
                        Json.list(dataset.get("columns"), QualityResult.Column.class), rows),
                List.of(), null, List.of(), null);
    }

    /**
     * Java's verdict per record index. A record absent from this map is not treated as valid — the
     * assembler applies the same rule, and both are stated because a default here would be a silent
     * claim that the gate passed something it never saw.
     */
    private static Map<Integer, Boolean> verdicts(Map<String, Object> validated) {
        Map<Integer, Boolean> verdicts = new LinkedHashMap<>();
        if (!(validated.get("rowVerdicts") instanceof List<?> list)) {
            return Map.of();
        }
        for (Object item : list) {
            Map<String, Object> row = Json.map(item);
            Object index = row.get("index");
            if (index instanceof Number number) {
                verdicts.put(number.intValue(), Boolean.TRUE.equals(row.get("javaValid")));
            }
        }
        return verdicts;
    }

    private String objectiveOf(Map<String, Object> config, StepContext context) {
        Object objective = config.get("objective");
        if (objective != null && !String.valueOf(objective).isBlank()) {
            return String.valueOf(objective);
        }
        return workflows.findPlan(context.run().planId()).map(plan -> plan.objective())
                .orElse(context.run().id());
    }

    private String requirementOf(StepContext context) {
        return workflows.findById(context.run().workflowId())
                .map(workflow -> workflow.requirementText())
                .orElse(null);
    }

    private static List<Map<String, Object>> mapList(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        List<Map<String, Object>> typed = new ArrayList<>();
        for (Object item : list) {
            if (item instanceof Map<?, ?> map) {
                typed.add(Json.map(map));
            }
        }
        return typed;
    }

    private static String str(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
