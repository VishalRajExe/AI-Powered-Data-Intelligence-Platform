package ai.finalagent.workflow.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import ai.finalagent.aiclient.AiServiceClient;
import ai.finalagent.common.ErrorResponse;
import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.domain.Records.Plan;
import ai.finalagent.workflow.domain.Records.Run;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.domain.Records.Workflow;
import ai.finalagent.workflow.execution.WorkflowWorker;
import ai.finalagent.workflow.service.WorkflowService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The workflow API: create, plan, start, watch, cancel.
 *
 * <p>Every response is the database's view of the run, not this process's memory of it. That is the
 * difference from the previous project, whose export jobs lived in in-process promises and so
 * stranded in {@code RUNNING} across a restart: state readable only from the node that set it is not
 * state, and here nothing is kept in memory at all.
 *
 * <p>Unauthenticated like the rest of the API today, and single-workspace by configuration. Both
 * are recorded as the authentication phase's outstanding work, not as something this layer solved.
 */
@RestController
@RequestMapping("/api/v1/workflows")
public class WorkflowController {

    private final WorkflowService service;
    private final WorkflowWorker worker;

    public WorkflowController(WorkflowService service, WorkflowWorker worker) {
        this.service = service;
        this.worker = worker;
    }

    public record CreateRequest(@NotBlank @Size(min = 8, max = 4000) String prompt, String name) {
    }

    @PostMapping
    public Map<String, Object> create(@Valid @RequestBody CreateRequest request) {
        Workflow workflow = service.create(request.name(), request.prompt());
        return Map.of("workflow", view(workflow), "next", "POST /api/v1/workflows/" + workflow.id()
                + "/plan");
    }

    @PostMapping("/{id}/plan")
    public Map<String, Object> plan(@PathVariable String id) {
        Workflow workflow = service.workflow(id);
        Plan plan = service.plan(id);
        return Map.of("workflow", view(workflow), "plan", view(plan),
                "warning", "the plan is stored; nothing has been collected yet");
    }

    @PostMapping("/{id}/runs")
    public ResponseEntity<Map<String, Object>> startRun(@PathVariable String id) {
        Run run = service.startRun(id);
        return ResponseEntity.accepted().body(Map.of("run", view(run),
                "monitor", "/api/v1/workflows/runs/" + run.id()));
    }

    @GetMapping("/runs/{runId}")
    public Map<String, Object> run(@PathVariable String runId) {
        Run run = service.require(runId);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("run", view(run));
        body.put("steps", service.stepsOf(runId).stream().map(WorkflowController::view).toList());
        body.put("jobs", service.jobsOf(runId).stream().map(WorkflowController::view).toList());
        return body;
    }

    @GetMapping("/runs/{runId}/events")
    public Map<String, Object> events(@PathVariable String runId,
                                      @RequestParam(defaultValue = "0") long after,
                                      @RequestParam(defaultValue = "200") int limit) {
        return Map.of("events", service.eventsOf(runId, after, Math.min(limit, 500)));
    }

    @PostMapping("/runs/{runId}/cancel")
    public Map<String, Object> cancel(@PathVariable String runId) {
        return Map.of("run", view(service.cancel(runId)));
    }

    @GetMapping("/runs")
    public Map<String, Object> recent(@RequestParam(defaultValue = "20") int limit) {
        List<Map<String, Object>> runs = service.recentRuns(Math.min(limit, 100)).stream()
                .map(WorkflowController::view).toList();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("runs", runs);
        body.put("worker", Map.of("id", worker.workerId(), "running", worker.isRunning(),
                "inFlight", worker.inFlight(), "freeSlots", worker.freeSlots()));
        return body;
    }

    // ------------------------------------------------------------------ views

    private static Map<String, Object> view(Workflow workflow) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", workflow.id());
        view.put("name", workflow.name());
        view.put("status", workflow.status());
        view.put("planningStatus", workflow.planningStatus());
        view.put("requirementText", workflow.requirementText());
        view.put("createdAt", workflow.createdAt());
        return view;
    }

    private static Map<String, Object> view(Plan plan) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", plan.id());
        view.put("workflowId", plan.workflowId());
        view.put("version", plan.version());
        view.put("objective", plan.objective());
        view.put("planHash", plan.planHash());
        view.put("steps", plan.stepsJson());
        view.put("sourcePolicy", plan.sourcePolicyJson());
        view.put("completionCriteria", plan.completionCriteriaJson());
        return view;
    }

    private static Map<String, Object> view(Run run) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", run.id());
        view.put("workflowId", run.workflowId());
        view.put("planId", run.planId());
        view.put("status", run.status().name());
        view.put("attempt", run.attempt());
        view.put("progress", run.progress());
        view.put("recordsFound", run.recordsFound());
        view.put("recordsValid", run.recordsValid());
        view.put("duplicateCount", run.duplicateCount());
        view.put("sourcesProcessed", run.sourcesProcessed());
        view.put("sourcesFailed", run.sourcesFailed());
        view.put("errorCode", run.errorCode());
        view.put("errorMessage", run.errorMessage());
        view.put("cancelRequested", run.cancelRequestedAt() != null);
        view.put("startedAt", run.startedAt());
        view.put("finishedAt", run.finishedAt());
        return view;
    }

    private static Map<String, Object> view(Step step) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", step.id());
        view.put("stepKey", step.stepKey());
        view.put("sequence", step.sequence());
        view.put("type", step.type());
        view.put("status", step.status().name());
        view.put("attempt", step.attempt());
        view.put("durationMs", step.durationMs());
        view.put("errorCode", step.errorCode());
        view.put("errorMessage", step.errorMessage());
        view.put("startedAt", step.startedAt());
        view.put("finishedAt", step.finishedAt());
        return view;
    }

    private static Map<String, Object> view(Job job) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", job.id());
        view.put("jobType", job.jobType());
        view.put("stepId", job.stepId());
        view.put("status", job.status().name());
        view.put("priority", job.priority());
        view.put("attemptCount", job.attemptCount());
        view.put("maxAttempts", job.maxAttempts());
        view.put("scheduledFor", job.scheduledFor());
        view.put("leaseExpiresAt", job.leaseExpiresAt());
        view.put("errorCode", job.lastErrorCode());
        view.put("errorMessage", job.lastErrorMessage());
        // Deliberately absent: the payload can contain the full extraction schema and, later,
        // record values. A listing endpoint is not where those belong.
        return view;
    }

    // ------------------------------------------------------------------ errors

    @ExceptionHandler(WorkflowService.UnknownWorkflowException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse unknown(WorkflowService.UnknownWorkflowException e) {
        return ErrorResponse.of("WORKFLOW_NOT_FOUND", e.getMessage());
    }

    @ExceptionHandler(WorkflowService.UnknownRunException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse unknown(WorkflowService.UnknownRunException e) {
        return ErrorResponse.of("RUN_NOT_FOUND", e.getMessage());
    }

    @ExceptionHandler(WorkflowService.PlanningRejectedException.class)
    @ResponseStatus(HttpStatus.BAD_GATEWAY)
    public ErrorResponse planningFailed(WorkflowService.PlanningRejectedException e) {
        // 502, not 500: the workflow is intact and its planning failure is recorded against it, so
        // the caller's own prompt may be the reason and may be corrected and retried.
        return ErrorResponse.of(e.code(), e.getMessage());
    }

    @ExceptionHandler(AiServiceClient.AiServiceException.class)
    public ResponseEntity<ErrorResponse> upstream(AiServiceClient.AiServiceException e) {
        boolean callerFault = e.upstreamStatus() >= 400 && e.upstreamStatus() < 500;
        return ResponseEntity.status(callerFault ? HttpStatus.BAD_REQUEST : HttpStatus.BAD_GATEWAY)
                .body(ErrorResponse.of(callerFault ? "AI_SERVICE_REJECTED_REQUEST"
                        : "AI_SERVICE_UNAVAILABLE", e.getMessage()));
    }
}
