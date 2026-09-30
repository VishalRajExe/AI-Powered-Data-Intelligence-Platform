package ai.finalagent.operations;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import ai.finalagent.config.FinalAgentProperties;
import ai.finalagent.config.Workspace;
import ai.finalagent.dataset.repository.DatasetRepository;
import ai.finalagent.dataset.repository.ExportRepository;
import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.domain.Records.Run;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.domain.Records.Workflow;
import ai.finalagent.workflow.execution.WorkflowWorker;
import ai.finalagent.workflow.repository.ActivityRepository;
import ai.finalagent.workflow.repository.JobRepository;
import ai.finalagent.workflow.repository.RunRepository;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.repository.WorkflowRepository;
import ai.finalagent.workflow.support.Json;

/**
 * The operations read model: history, progress, activity, and the monitoring summary.
 *
 * <p>Everything here is a read of state the queue already wrote. That is the point of the phase — the
 * previous project kept an export's and a run's live status in in-process promises, so the answers
 * depended on which node was asked and were gone after a restart
 * ({@code export.service.ts:41-53}, {@code 00-FORENSIC-AUDIT.md} §5). Here a restart costs a reader
 * nothing: the rows are the history.
 *
 * <p>Progress is reported as the run's own persisted figure plus the step states that produced it,
 * never as an estimate derived from "it is running". {@code RunRepository} records why that sentence is
 * in this codebase: the old service mapped {@code RUNNING → 50}, so a job wedged for twenty minutes
 * looked half finished.
 */
@Service
public class OperationsService {

    private static final int DEFAULT_PAGE = 20;
    private static final int MAX_PAGE = 100;
    private static final int MAX_FEED = 500;

    private final WorkflowRepository workflows;
    private final RunRepository runs;
    private final StepRepository steps;
    private final JobRepository jobs;
    private final ActivityRepository activity;
    private final DatasetRepository datasets;
    private final ExportRepository exports;
    private final WorkflowWorker worker;
    private final Workspace currentWorkspace;
    private final FinalAgentProperties.Execution execution;

    public OperationsService(WorkflowRepository workflows, RunRepository runs, StepRepository steps,
                             JobRepository jobs, ActivityRepository activity,
                             DatasetRepository datasets, ExportRepository exports,
                             WorkflowWorker worker, Workspace currentWorkspace,
                             FinalAgentProperties properties) {
        this.workflows = workflows;
        this.runs = runs;
        this.steps = steps;
        this.jobs = jobs;
        this.activity = activity;
        this.datasets = datasets;
        this.exports = exports;
        this.worker = worker;
        this.currentWorkspace = currentWorkspace;
        this.execution = properties.execution();
    }

    // ------------------------------------------------------------------ history

    /** Workflow history, with the attempt count and plan version each one has reached. */
    public Map<String, Object> workflowHistory(String status, int limit, int page) {
        String workspace = currentWorkspace.current();
        int size = bound(limit, DEFAULT_PAGE, MAX_PAGE);
        int offset = Math.max(page, 0) * size;
        List<Workflow> rows = workflows.list(workspace, status, size, offset);
        List<String> ids = rows.stream().map(Workflow::id).toList();
        Map<String, Integer> runCounts = workflows.runCounts(workspace, ids);
        Map<String, Integer> planVersions = workflows.latestPlanVersions(ids);

        List<Map<String, Object>> views = new ArrayList<>();
        for (Workflow workflow : rows) {
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("id", workflow.id());
            view.put("name", workflow.name());
            view.put("status", workflow.status());
            view.put("planningStatus", workflow.planningStatus());
            view.put("requirementText", workflow.requirementText());
            view.put("runCount", runCounts.getOrDefault(workflow.id(), 0));
            view.put("latestPlanVersion", planVersions.get(workflow.id()));
            view.put("createdAt", workflow.createdAt());
            view.put("updatedAt", workflow.updatedAt());
            views.add(view);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("workflows", views);
        body.put("total", workflows.countAll(workspace, status));
        body.put("page", Math.max(page, 0));
        body.put("pageSize", size);
        return body;
    }

    /** One workflow's run history: every attempt kept, including the ones that failed. */
    public Map<String, Object> runHistory(String workflowId, int limit, int page) {
        String workspace = currentWorkspace.current();
        Workflow workflow = workflows.findById(workflowId)
                .filter(found -> found.workspaceId().equals(workspace))
                .orElseThrow(() -> new UnknownWorkflowHistoryException(workflowId));
        int size = bound(limit, DEFAULT_PAGE, MAX_PAGE);
        int offset = Math.max(page, 0) * size;
        List<Run> rows = runs.findByWorkflow(workspace, workflowId, size, offset);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("workflowId", workflowId);
        body.put("runs", rows.stream().map(OperationsService::view).toList());
        body.put("total", runs.countByWorkflow(workspace, workflowId));
        body.put("page", Math.max(page, 0));
        body.put("pageSize", size);
        return body;
    }

    /**
     * Step history for a run: each step, and the job that ran it.
     *
     * <p>The job is shown beside the step because the step row only holds the <em>latest</em> outcome —
     * it is overwritten on every attempt. The attempt count, the retry schedule and the lease live on
     * the job, so a step that failed twice before succeeding is only visible as a step at all by
     * reading both rows together.
     */
    public Map<String, Object> stepHistory(String runId) {
        String workspace = currentWorkspace.current();
        Run run = runs.findById(runId)
                .filter(found -> found.workspaceId().equals(workspace))
                .orElseThrow(() -> new UnknownRunHistoryException(runId));
        Map<String, Job> byStep = new LinkedHashMap<>();
        for (Job job : jobs.findByRun(runId)) {
            if (job.stepId() != null) {
                byStep.put(job.stepId(), job);
            }
        }
        List<Map<String, Object>> views = new ArrayList<>();
        for (Step step : steps.findByRun(runId)) {
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("id", step.id());
            view.put("stepKey", step.stepKey());
            view.put("sequence", step.sequence());
            view.put("type", step.type());
            view.put("status", step.status().name());
            view.put("attempt", step.attempt());
            view.put("retryCount", step.retryCount());
            view.put("dependsOn", Json.parse(step.dependsOnJson()));
            view.put("durationMs", step.durationMs());
            view.put("errorCode", step.errorCode());
            view.put("errorMessage", step.errorMessage());
            view.put("startedAt", step.startedAt());
            view.put("finishedAt", step.finishedAt());
            view.put("outputSummary",
                    Json.object(step.outputSummaryJson()));
            Job job = byStep.get(step.id());
            view.put("job", job == null ? null : jobView(job));
            views.add(view);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("runId", run.id());
        body.put("runStatus", run.status().name());
        body.put("progress", run.progress());
        body.put("steps", views);
        body.put("events", activity.forRun(runId, 0, MAX_FEED));
        return body;
    }

    // ------------------------------------------------------------------ activity

    /**
     * The workspace's event feed, cursor-paged on the event id.
     *
     * <p>{@code nextCursor} is the highest id in the page, so a caller that re-requests with it gets
     * strictly newer events. This is also the reader the streaming endpoint will sit on: the log is
     * already durable and cursor-addressable, so SSE is a poller over this method rather than new
     * plumbing.
     */
    public Map<String, Object> feed(long after, String runId, String action, int limit) {
        String workspace = currentWorkspace.current();
        int size = bound(limit, 50, MAX_FEED);
        List<Map<String, Object>> events = activity.feed(workspace, runId, action, after, size);
        long next = events.isEmpty() ? after
                : ((Number) events.get(events.size() - 1).get("id")).longValue();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("events", events);
        body.put("after", after);
        body.put("nextCursor", next);
        body.put("more", activity.countFeed(workspace, runId, action, next) > 0);
        body.put("truncated", events.size() == size);
        return body;
    }

    // ------------------------------------------------------------------ monitoring

    /**
     * One call that answers "is anything stuck".
     *
     * <p>Each figure says where it came from. The queue depth is labelled queue-wide because the worker
     * pool is shared across workspaces in this process; reporting it as this workspace's would imply an
     * isolation that does not exist.
     */
    public Map<String, Object> summary() {
        String workspace = currentWorkspace.current();
        Map<String, Integer> runStates = runs.statusCounts(workspace);
        int active = runStates.getOrDefault("PENDING", 0) + runStates.getOrDefault("PLANNING", 0)
                + runStates.getOrDefault("RUNNING", 0);

        Map<String, Object> queue = new LinkedHashMap<>();
        queue.put("pending", jobs.countPending());
        queue.put("running", jobs.countRunning());
        queue.put("byTypeAndStatus", jobs.depthByTypeAndStatus());
        queue.put("scope", "queue-wide: one worker pool serves every workspace in this process");

        Map<String, Object> workerView = new LinkedHashMap<>();
        workerView.put("id", worker.workerId());
        workerView.put("enabled", execution.enabled());
        workerView.put("running", worker.isRunning());
        workerView.put("inFlight", worker.inFlight());
        workerView.put("freeSlots", worker.freeSlots());
        workerView.put("leaseSeconds", execution.leaseSeconds());
        workerView.put("pollIntervalMs", execution.pollIntervalMs());

        Map<String, Object> exportStates = new LinkedHashMap<>();
        for (String status : List.of("QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED")) {
            exportStates.put(status, exports.countByStatus(workspace, status));
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("workspaceId", workspace);
        body.put("workflows", Map.of("total", workflows.countAll(workspace, null)));
        body.put("runs", Map.of("byStatus", runStates, "active", active,
                "totals", runs.recordTotals(workspace)));
        body.put("queue", queue);
        body.put("worker", workerView);
        body.put("datasets", Map.of("total", datasets.countAll(workspace, null, null),
                "rows", datasets.rowTotals(workspace)));
        body.put("exports", exportStates);
        body.put("recentActivity", activity.feed(workspace, null, null, 0, 10));
        return body;
    }

    // ------------------------------------------------------------------ views

    private static Map<String, Object> view(Run run) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", run.id());
        view.put("workflowId", run.workflowId());
        view.put("planId", run.planId());
        view.put("status", run.status().name());
        view.put("attempt", run.attempt());
        view.put("progress", run.progress());
        view.put("recordsRaw", run.recordsRaw());
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
        view.put("createdAt", run.createdAt());
        return view;
    }

    private static Map<String, Object> jobView(Job job) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", job.id());
        view.put("status", job.status().name());
        view.put("priority", job.priority());
        view.put("attemptCount", job.attemptCount());
        view.put("maxAttempts", job.maxAttempts());
        view.put("workerId", job.workerId());
        view.put("lockedAt", job.lockedAt());
        view.put("leaseExpiresAt", job.leaseExpiresAt());
        view.put("scheduledFor", job.scheduledFor());
        view.put("errorCode", job.lastErrorCode());
        view.put("errorMessage", job.lastErrorMessage());
        return view;
    }

    private static int bound(int requested, int fallback, int max) {
        return requested <= 0 ? fallback : Math.min(requested, max);
    }

    /** A foreign id and an absent id answer alike, as everywhere else in this API. */
    public static class UnknownWorkflowHistoryException extends RuntimeException {
        public UnknownWorkflowHistoryException(String id) {
            super("no workflow " + id + " is visible to this workspace");
        }
    }

    public static class UnknownRunHistoryException extends RuntimeException {
        public UnknownRunHistoryException(String id) {
            super("no run " + id + " is visible to this workspace");
        }
    }
}
