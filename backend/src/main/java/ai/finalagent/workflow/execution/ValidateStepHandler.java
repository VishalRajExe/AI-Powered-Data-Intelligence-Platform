package ai.finalagent.workflow.execution;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import ai.finalagent.aiclient.dto.QualityResult;
import ai.finalagent.quality.DeclaredContract;
import ai.finalagent.quality.RowContractEnforcer;
import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.support.Json;

/**
 * Java re-checks the dataset the pipeline proposed, against the plan's own contract.
 *
 * <p>This is the rule the architecture is built on: Python's verdict is advisory and the side that
 * owns the data enforces the contract. Concretely, a record whose required field is missing or blank,
 * whose value does not match the type the plan declared for it, or which cites no source a tool
 * actually retrieved, does not become valid because the pipeline reported {@code COMPLETED}.
 *
 * <p>Two properties make the check worth running: it reads the <b>plan's</b> field list
 * ({@link DeclaredContract}) rather than the columns the pipeline emitted — a checker that takes its
 * spec from the thing it is checking confirms whatever the other side decided — and it compares the
 * two verdicts row by row, so a record the pipeline passed and Java rejects is reported as a
 * disagreement instead of quietly becoming a valid row or quietly disappearing.
 *
 * <p>Nothing is deleted here. Failing records are counted and reported with their index, because the
 * previous project's {@code persistDataset} dropped unevidenced rows in silence
 * ({@code docs/audit/00-FORENSIC-AUDIT.md} §5 item 8) and a short dataset with no explanation is
 * indistinguishable from a search that genuinely found little.
 */
@Component
public class ValidateStepHandler implements StepHandler {

    private static final int MAX_REPORTED_FINDINGS = 50;

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

        Step source = dependency(context);
        if (source == null) {
            return StepOutcome.failed("NO_PIPELINE_OUTPUT",
                    "this step depends on nothing, so there is no processed record set to check",
                    StepOutcome.Counters.none());
        }
        if (source.status() != JobStatus.COMPLETED) {
            return StepOutcome.failed("PIPELINE_NOT_COMPLETED",
                    "the pipeline step ended " + source.status() + " (" + nullToEmpty(source.errorCode())
                            + "), so there is nothing to validate", StepOutcome.Counters.none());
        }

        Map<String, Object> output = Json.object(source.outputSummaryJson());
        QualityResult proposed = proposedResult(output);
        if (proposed.records().isEmpty()) {
            return StepOutcome.failed("NO_RECORDS",
                    "the pipeline returned no records, so there is nothing to validate",
                    StepOutcome.Counters.none());
        }

        DeclaredContract contract = contractFor(config, proposed);
        RowContractEnforcer.Verdict verdict = RowContractEnforcer.enforce(proposed, contract);

        Map<String, Object> qualityView = Json.map(output.get("quality"));
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.putAll(verdict.asSummary(MAX_REPORTED_FINDINGS));
        summary.put("pipelineStatus", output.get("pipelineStatus"));
        // Read out of the pipeline's own report view rather than re-parsed into a Quality: the view is
        // what was stored, and its advisory counts keep their names only there.
        summary.put("advisoryValidCount", qualityView.get("advisoryValidCount"));
        summary.put("advisoryQualityScore", qualityView.get("qualityScore"));
        summary.put("advisoryDisagreementList", verdict.advisoryOnly().stream()
                .limit(MAX_REPORTED_FINDINGS).map(RowContractEnforcer.Finding::asMap).toList());
        if ("pipeline-columns".equals(contract.basis())) {
            summary.put("contractWarning", "the plan declared no typed fields, so Java checked this "
                    + "dataset against the columns the pipeline emitted for it — a weaker check, and "
                    + "one that cannot catch a field the pipeline never thought to export");
        }

        // The run's records_found / records_raw were already added by the collection step; this step
        // contributes only Java's verdicts, or a three-step plan would report its records twice.
        StepOutcome.Counters counters = new StepOutcome.Counters(0, verdict.valid(),
                verdict.linkedDuplicates(), 0, 0, 0);

        if (verdict.valid() == 0) {
            // Keep the findings: a FAILED step whose summary is empty tells nobody why.
            return new StepOutcome(JobStatus.FAILED, summary, counters, "NO_VALID_ROWS",
                    "all " + verdict.rowsChecked() + " processed rows failed Java's contract check");
        }
        return StepOutcome.completed(summary, counters);
    }

    /**
     * Java's spec for this run: the plan's typed field list, and only if the plan declared no fields
     * at all the columns the pipeline reported. The order is the whole point — a checker that reads
     * its spec from the thing it is checking can only ever confirm the answer it was given.
     */
    private static DeclaredContract contractFor(Map<String, Object> config, QualityResult proposed) {
        DeclaredContract fromPlan = DeclaredContract.fromConfig(config);
        if (!"none".equals(fromPlan.basis())) {
            return fromPlan;
        }
        List<Map<String, Object>> columns = new ArrayList<>();
        if (proposed.dataset() != null && proposed.dataset().columns() != null) {
            for (QualityResult.Column column : proposed.dataset().columns()) {
                Map<String, Object> asField = new LinkedHashMap<>();
                asField.put("key", column.key());
                asField.put("type", column.type());
                asField.put("required", column.required());
                columns.add(asField);
            }
        }
        return DeclaredContract.fromColumns(columns, Json.strings(config.get("requiredFields")));
    }

    /**
     * The transform step's stored output, read back as the typed result it was when the pipeline
     * sent it. Only the two things the enforcement needs are reconstructed: the records, and the
     * dataset's columns and row indexes. A row's values live on its record, so they are not stored
     * twice in one JSON column, and the quality report stays a view rather than being re-parsed —
     * its advisory counts are read from the summary, where they are named for what they are.
     */
    private static QualityResult proposedResult(Map<String, Object> output) {
        List<QualityResult.Record> records =
                Json.list(output.get("records"), QualityResult.Record.class);
        Map<String, Object> dataset = Json.map(output.get("dataset"));
        List<QualityResult.Column> columns =
                Json.list(dataset.get("columns"), QualityResult.Column.class);
        List<QualityResult.Row> rows = new ArrayList<>();
        if (dataset.get("rowRecordIndexes") instanceof List<?> indexes) {
            for (Object index : indexes) {
                if (index instanceof Number number) {
                    rows.add(new QualityResult.Row(number.intValue(), Map.of()));
                }
            }
        }
        return new QualityResult(String.valueOf(output.get("pipelineStatus")), records,
                new QualityResult.Dataset(columns, rows), List.of(), null, List.of(), null);
    }

    /**
     * The step this one depends on, found by dependency edge rather than by name — so renaming or
     * reordering a plan cannot quietly make validation read the wrong output.
     */
    private Step dependency(StepContext context) {
        List<String> dependsOn = Json.stringList(context.step().dependsOnJson());
        if (dependsOn.isEmpty()) {
            return null;
        }
        return steps.findByKey(context.run().id(), dependsOn.get(0)).orElse(null);
    }

    private static String nullToEmpty(String value) {
        return value == null ? "no code" : value;
    }
}
