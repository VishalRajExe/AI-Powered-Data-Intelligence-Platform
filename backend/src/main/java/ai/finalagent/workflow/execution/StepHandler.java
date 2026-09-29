package ai.finalagent.workflow.execution;

/**
 * A step type the workflow executor knows how to run.
 *
 * <p>Handlers are looked up by step type, and an unknown type is a hard failure rather than a
 * skip: a plan naming a step nobody implements must not roll up as success.
 */
public interface StepHandler {

    /** The {@code workflow_steps.type} value this handler runs. */
    String stepType();

    StepOutcome handle(StepContext context) throws JobExecutionException;
}
