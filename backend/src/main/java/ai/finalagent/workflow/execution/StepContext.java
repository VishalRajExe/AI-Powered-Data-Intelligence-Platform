package ai.finalagent.workflow.execution;

import java.util.Map;
import java.util.function.BooleanSupplier;

import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.domain.Records.Plan;
import ai.finalagent.workflow.domain.Records.Run;
import ai.finalagent.workflow.domain.Records.Step;

/**
 * Everything a step handler needs, plus the two questions it must be allowed to ask mid-flight.
 *
 * <p>{@link #stillHoldsLease()} and {@link #cancelRequested()} exist so a handler can stop early.
 * A worker whose lease was taken over must not keep producing results — by the time it finishes,
 * another worker may have written a different ones — and a cancelled run should stop at the next
 * boundary rather than be lied to about having been stopped.
 */
public record StepContext(Run run, Step step, Plan plan, Job job, Map<String, Object> payload,
                          String workerId, BooleanSupplier stillHoldsLease,
                          BooleanSupplier cancelRequested) {

    public Map<String, Object> require(String key) {
        Object value = payload.get(key);
        if (!(value instanceof Map<?, ?> map)) {
            throw JobExecutionException.permanent("STEP_CONFIG_MISSING",
                    "step '" + step.stepKey() + "' has no '" + key + "' object in its job payload");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> cast = (Map<String, Object>) map;
        return cast;
    }
}
