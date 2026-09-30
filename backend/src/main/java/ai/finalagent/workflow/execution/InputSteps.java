package ai.finalagent.workflow.execution;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.support.Json;

/**
 * How a step finds the row that produced its input.
 *
 * <p>By dependency edge, never by step name. A plan whose node happened to be called {@code collect}
 * is not a contract; the edge is. So a step that reads "the thing I depend on" keeps reading the
 * right row if a future planner renames or reorders nodes, while a name lookup would quietly read
 * an unrelated row — the class of bug where validation ends up checking somebody else's output.
 */
final class InputSteps {

    private InputSteps() {
    }

    /** The single step this one depends on, or empty when it has none or the row has gone. */
    static Optional<Step> firstDependency(StepContext context, StepRepository steps) {
        List<String> dependsOn = Json.stringList(context.step().dependsOnJson());
        if (dependsOn.isEmpty()) {
            return Optional.empty();
        }
        return steps.findByKey(context.run().id(), dependsOn.get(0));
    }

    /**
     * The dependency's output summary, refusing to continue when that step did not finish.
     *
     * <p>Absent here means absent in the result: the caller gets an outcome explaining why there is
     * nothing to process, rather than an empty list that a downstream stage could mistake for "the
     * run collected nothing".
     */
    static Optional<Map<String, Object>> completedDependencyOutput(StepContext context,
                                                                  StepRepository steps,
                                                                  String missingSummary) {
        Optional<Step> dependency = firstDependency(context, steps);
        if (dependency.isEmpty()) {
            return Optional.empty();
        }
        Step source = dependency.get();
        if (source.status() != JobStatus.COMPLETED) {
            throw new JobExecutionException("DEPENDENCY_NOT_COMPLETED",
                    "the step this one depends on ended " + source.status() + " ("
                            + (source.errorCode() == null ? "no code" : source.errorCode())
                            + "), so " + missingSummary, false);
        }
        return Optional.ofNullable(source.outputSummaryJson()).map(Json::object);
    }

    /**
     * The output of whichever of this step's dependencies carries the given key.
     *
     * <p>Still an edge, not a name: the key has to appear in {@code depends_on} for this to return
     * anything, so a step cannot reach sideways into a run's other rows just by knowing what one was
     * called. The save step needs this because it genuinely has two inputs — the pipeline's records and
     * Java's verdict on them — and inferring one from the other would be a guess about which is which.
     */
    static Optional<Map<String, Object>> completedDependencyOutput(StepContext context,
                                                                  StepRepository steps, String stepKey,
                                                                  String missingSummary) {
        if (!Json.stringList(context.step().dependsOnJson()).contains(stepKey)) {
            return Optional.empty();
        }
        Step source = steps.findByKey(context.run().id(), stepKey).orElse(null);
        if (source == null) {
            return Optional.empty();
        }
        if (source.status() != JobStatus.COMPLETED) {
            throw new JobExecutionException("DEPENDENCY_NOT_COMPLETED",
                    "the step '" + stepKey + "' this one depends on ended " + source.status() + " ("
                            + (source.errorCode() == null ? "no code" : source.errorCode())
                            + "), so " + missingSummary, false);
        }
        return Optional.ofNullable(source.outputSummaryJson()).map(Json::object);
    }
}
