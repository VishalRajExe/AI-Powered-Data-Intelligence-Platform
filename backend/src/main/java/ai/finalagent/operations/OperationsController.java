package ai.finalagent.operations;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import ai.finalagent.common.ErrorResponse;

/**
 * The operations endpoints: history, progress, activity, monitoring.
 *
 * <p>Read-only by construction — this controller has no way to change a run. Work starts at
 * {@code /api/v1/workflows} and files are queued at {@code /api/v1/datasets/{id}/exports}; everything
 * here reports on what those wrote, which is the split that lets a restart be a non-event for a reader.
 *
 * <p>The paths under {@code /api/v1/workflows} live here rather than in {@code WorkflowController}
 * because they belong to the read model, not the lifecycle: Spring matches the literal
 * {@code /runs} and {@code /activity} segments ahead of the {@code /{id}} pattern, so no route is
 * ambiguous, and the lifecycle controller stays about starting and stopping work.
 */
@RestController
public class OperationsController {

    private final OperationsService operations;

    public OperationsController(OperationsService operations) {
        this.operations = operations;
    }

    @GetMapping("/api/v1/workflows")
    public Map<String, Object> workflowHistory(@RequestParam(required = false) String status,
                                               @RequestParam(defaultValue = "20") int limit,
                                               @RequestParam(defaultValue = "0") int page) {
        return operations.workflowHistory(status, limit, page);
    }

    @GetMapping("/api/v1/workflows/{workflowId}/runs")
    public Map<String, Object> runHistory(@PathVariable String workflowId,
                                          @RequestParam(defaultValue = "20") int limit,
                                          @RequestParam(defaultValue = "0") int page) {
        return operations.runHistory(workflowId, limit, page);
    }

    @GetMapping("/api/v1/workflows/runs/{runId}/steps")
    public Map<String, Object> stepHistory(@PathVariable String runId) {
        return operations.stepHistory(runId);
    }

    /**
     * The activity feed.
     *
     * <p>{@code after} is an event id, not a timestamp: ids increase with the log, so a cursor on them
     * cannot skip or repeat an event the way a wall-clock cursor does when two writers round to the
     * same second.
     */
    @GetMapping("/api/v1/activity")
    public Map<String, Object> activity(@RequestParam(defaultValue = "0") long after,
                                        @RequestParam(required = false) String runId,
                                        @RequestParam(required = false) String action,
                                        @RequestParam(defaultValue = "50") int limit) {
        return operations.feed(after, runId, action, limit);
    }

    @GetMapping("/api/v1/monitoring")
    public Map<String, Object> monitoring() {
        return operations.summary();
    }

    /**
     * Both handlers answer the way the lifecycle controller does for the same kind of miss. A history
     * read that invented its own code would leave a client matching on two strings for one fact, and
     * the code is what the frontend branches on.
     */
    @ExceptionHandler(OperationsService.UnknownWorkflowHistoryException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse unknownWorkflow(OperationsService.UnknownWorkflowHistoryException e) {
        return ErrorResponse.of("WORKFLOW_NOT_FOUND", e.getMessage());
    }

    @ExceptionHandler(OperationsService.UnknownRunHistoryException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse unknownRun(OperationsService.UnknownRunHistoryException e) {
        return ErrorResponse.of("RUN_NOT_FOUND", e.getMessage());
    }
}
