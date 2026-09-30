package ai.finalagent.workflow.service;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ai.finalagent.aiclient.AiServiceClient;
import ai.finalagent.config.FinalAgentProperties;
import ai.finalagent.config.Workspace;
import ai.finalagent.requirement.RequirementAnalysisDto;
import ai.finalagent.requirement.RequirementValidator;
import ai.finalagent.research.ExtractionSchemaValidator;
import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.domain.Records.Plan;
import ai.finalagent.workflow.domain.Records.Run;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.domain.Records.Workflow;
import ai.finalagent.workflow.domain.RunStatus;
import ai.finalagent.workflow.execution.PlanSteps;
import ai.finalagent.workflow.execution.WorkflowJobExecutor;
import ai.finalagent.workflow.plan.WorkflowPlanner;
import ai.finalagent.workflow.repository.ActivityRepository;
import ai.finalagent.workflow.repository.JobRepository;
import ai.finalagent.workflow.repository.RunRepository;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.repository.WorkflowRepository;
import ai.finalagent.workflow.support.Json;
import ai.finalagent.workflow.support.Principals;

/**
 * The workflow lifecycle: create, plan, start a run, cancel, read.
 *
 * <p>Two rules shape every method here.
 *
 * <p><b>Tenancy comes from the session.</b> {@link #workspace()} reads the authenticated principal and
 * nothing else — not the request, and no longer a configured default. The previous project read
 * {@code workspaceId} off the request on routes whose auth middleware was optional, so any caller who
 * knew a UUID could read another tenant's data
 * ({@code docs/audit/00-FORENSIC-AUDIT.md} §5 item 1); a configured single tenant was the stopgap
 * that replaced it, and it is what {@code V5__baseline_identity.sql} retired. {@link #actor()} writes
 * the signed-in person into every row this service creates, so a workflow can finally answer who asked
 * for it.
 *
 * <p><b>An AI answer is a proposal.</b> Planning calls the AI service and then fails the workflow
 * if Java's own validation of the requirement or the extraction schema rejects it. Nothing is
 * enqueued from an unverified model output — which is the specific gap that let the old system
 * collect an entire dataset against a schema nobody had checked.
 */
@Service
public class WorkflowService {

    private final WorkflowRepository workflows;
    private final RunRepository runs;
    private final StepRepository steps;
    private final JobRepository jobs;
    private final ActivityRepository activity;
    private final AiServiceClient aiServiceClient;
    private final WorkflowJobExecutor executor;
    private final Workspace workspaces;

    public WorkflowService(WorkflowRepository workflows, RunRepository runs, StepRepository steps,
                           JobRepository jobs, ActivityRepository activity,
                           AiServiceClient aiServiceClient, WorkflowJobExecutor executor,
                           Workspace workspaces) {
        this.workflows = workflows;
        this.runs = runs;
        this.steps = steps;
        this.jobs = jobs;
        this.activity = activity;
        this.aiServiceClient = aiServiceClient;
        this.executor = executor;
        this.workspaces = workspaces;
    }

    /**
     * The tenant this request belongs to, from the one component that resolves it.
     *
     * <p>This used to read {@code FINALAGENT_WORKSPACE_ID} here and in {@code DatasetService} and in
     * two more places, which is the shape of the bug: a security rule copied per service drifts, and a
     * configured tenant copied four times looks like a design rather than like a placeholder.
     */
    private String workspace() {
        return workspaces.current();
    }

    /** Who did it, for the columns that record an author rather than a scope. */
    private String actor() {
        return workspaces.actor();
    }

    @Transactional
    public Workflow create(String name, String prompt) {
        String id = UUID.randomUUID().toString();
        String trimmed = prompt.strip();
        workflows.insert(id, workspace(), actor(),
                name == null || name.isBlank() ? abbreviate(trimmed) : name.strip(), trimmed);
        activity.record(workspace(), null, actor(), "workflow.created",
                "workflow", id, "workflow created from a natural-language request",
                Map.of("promptLength", trimmed.length()));
        return workflows.findById(id).orElseThrow();
    }

    /**
     * Asks the AI service for a requirement, validates it here, and stores an immutable plan.
     *
     * @throws PlanningRejectedException when the answer is not usable, in which case the workflow
     *                                  records why and no run can be started from it.
     */
    public Plan plan(String workflowId) {
        Workflow workflow = workflows.findById(workflowId)
                .orElseThrow(() -> new UnknownWorkflowException(workflowId));
        workflows.markPlanning(workflowId);

        RequirementAnalysisDto analysis;
        try {
            analysis = aiServiceClient.analyzeRequirement(workflow.requirementText());
        } catch (AiServiceClient.AiServiceException | org.springframework.web.client.RestClientException e) {
            workflows.markPlanningFailed(workflowId, "AI_SERVICE_UNAVAILABLE", e.getMessage());
            throw new PlanningRejectedException("AI_SERVICE_UNAVAILABLE",
                    "the requirement could not be analysed: " + e.getMessage(), e);
        }

        if (analysis == null || analysis.requirement() == null) {
            workflows.markPlanningFailed(workflowId, "EMPTY_ANALYSIS",
                    "the AI service answered with no requirement");
            throw new PlanningRejectedException("EMPTY_ANALYSIS",
                    "the AI service answered with no requirement", null);
        }

        RequirementValidator.Outcome outcome = RequirementValidator.validate(analysis.requirement());
        if (outcome.verdict() != RequirementValidator.Verdict.VALID) {
            String reason = "the requirement is incomplete: " + outcome.questions();
            workflows.markPlanningFailed(workflowId, "REQUIREMENT_NEEDS_CLARIFICATION", reason);
            throw new PlanningRejectedException("REQUIREMENT_NEEDS_CLARIFICATION", reason, null);
        }
        try {
            ExtractionSchemaValidator.validate(analysis.extractionSchema());
        } catch (ExtractionSchemaValidator.InvalidExtractionSchemaException e) {
            workflows.markPlanningFailed(workflowId, "INVALID_EXTRACTION_SCHEMA", e.getMessage());
            throw new PlanningRejectedException("INVALID_EXTRACTION_SCHEMA", e.getMessage(), e);
        }

        WorkflowPlanner.Planned planned = WorkflowPlanner.plan(analysis);
        String planId = UUID.randomUUID().toString();
        int version = workflows.nextPlanVersion(workflowId);
        workflows.insertPlan(new Plan(planId, workflow.workspaceId(), workflowId, version,
                planned.objective(), planned.requirementJson(), planned.extractionSchemaJson(),
                planned.stepsJson(), planned.searchStrategyJson(), planned.sourcePolicyJson(),
                planned.completionCriteriaJson(), planned.planHash(), actor(),
                java.time.Instant.now()));
        workflows.markPlanned(workflowId);
        activity.record(workflow.workspaceId(), null, actor(), "workflow.planned",
                "workflow_plan", planId, "plan v" + version + " stored; collection has not started",
                Map.of("steps", planned.steps().size(), "planHash", planned.planHash()));
        return workflows.findPlan(planId).orElseThrow();
    }

    /**
     * Creates a run, its step rows, and the jobs that are ready to execute.
     *
     * <p>Returns the existing run when one for this attempt already exists: a client that retries
     * the request after a lost response must not produce two competing executions of the same plan,
     * which is what {@code UNIQUE (workflow_id, attempt)} is there to make impossible rather than
     * merely unlikely.
     */
    @Transactional
    public Run startRun(String workflowId) {
        Workflow workflow = workflows.findById(workflowId)
                .orElseThrow(() -> new UnknownWorkflowException(workflowId));
        Plan plan = workflows.findLatestPlan(workflowId)
                .orElseThrow(() -> new IllegalStateException(
                        "workflow " + workflowId + " has no plan; plan it before starting a run"));

        int attempt = runs.nextAttempt(workflowId);

        String runId = UUID.randomUUID().toString();
        if (!runs.insert(runId, workflow.workspaceId(), workflowId, plan.id(), attempt)) {
            return runs.findByWorkflowAndAttempt(workflowId, attempt).orElseThrow();
        }

        List<PlanSteps.Node> nodes = PlanSteps.parse(plan.stepsJson()).nodes();
        if (nodes.isEmpty()) {
            throw new IllegalStateException("the plan for workflow " + workflowId
                    + " contains no steps, so a run of it would do nothing");
        }
        int sequence = 0;
        for (PlanSteps.Node node : nodes) {
            steps.insert(UUID.randomUUID().toString(), workflow.workspaceId(), runId, plan.version(),
                    node.key(), sequence++, Json.write(node.dependsOn()), node.type(),
                    Json.write(node.config()));
        }

        Run run = runs.findById(runId).orElseThrow();
        List<String> queued = executor.scheduleReadySteps(run, plan);
        activity.record(run.workspaceId(), runId, actor(), "workflow.run.started",
                "workflow_run", runId, "run attempt " + attempt + " started",
                Map.of("planVersion", plan.version(), "steps", sequence, "queuedSteps", queued));
        return run;
    }

    /**
     * Cooperative cancellation. In-flight steps are not rewritten: their worker notices the flag at
     * its next boundary and finishes or abandons the attempt itself, because it is the only party
     * that knows what it is in the middle of.
     */
    @Transactional
    public Run cancel(String runId) {
        Run run = runs.findById(runId).orElseThrow(() -> new UnknownRunException(runId));
        if (run.status().isTerminal()) {
            return run;
        }
        runs.requestCancel(runId);
        jobs.cancelPendingForRun(runId, "cancellation was requested for the run");
        steps.cancelPending(runId);
        executor.rollupAndSchedule(runId);
        Run after = runs.findById(runId).orElseThrow();
        activity.record(after.workspaceId(), runId, actor(), "workflow.run.cancel_requested",
                "workflow_run", runId, "cancellation requested; unstarted work was cancelled",
                Map.of("status", after.status().name()));
        return after;
    }

    public Run require(String runId) {
        Run run = runs.findById(runId).orElseThrow(() -> new UnknownRunException(runId));
        if (!workspace().equals(run.workspaceId())) {
            // Same response as "does not exist": confirming that a run id exists in another
            // tenant is itself a leak, which is the exact bug this replaces.
            throw new UnknownRunException(runId);
        }
        return run;
    }

    public List<Run> recentRuns(int limit) {
        return runs.findRecent(workspace(), limit);
    }

    public List<Step> stepsOf(String runId) {
        require(runId);
        return steps.findByRun(runId);
    }

    public List<Job> jobsOf(String runId) {
        require(runId);
        return jobs.findByRun(runId);
    }

    public List<Map<String, Object>> eventsOf(String runId, long afterId, int limit) {
        require(runId);
        return activity.forRun(runId, afterId, limit);
    }

    public Workflow workflow(String id) {
        Workflow workflow = workflows.findById(id)
                .orElseThrow(() -> new UnknownWorkflowException(id));
        if (!workspace().equals(workflow.workspaceId())) {
            throw new UnknownWorkflowException(id);
        }
        return workflow;
    }

    /** Run statuses that are still doing something, for the readiness view. */
    public static List<String> activeStatuses() {
        return List.of(RunStatus.PENDING.name(), RunStatus.PLANNING.name(), RunStatus.RUNNING.name());
    }

    private static String abbreviate(String prompt) {
        String flat = prompt.replaceAll("\\s+", " ").strip();
        return flat.length() <= 200 ? flat : flat.substring(0, 197) + "...";
    }

    public static class UnknownWorkflowException extends RuntimeException {
        public UnknownWorkflowException(String id) {
            super("no such workflow: " + id);
        }
    }

    public static class UnknownRunException extends RuntimeException {
        public UnknownRunException(String id) {
            super("no such run: " + id);
        }
    }

    /** A plan the AI service could not supply. The workflow records it; nothing is enqueued. */
    public static class PlanningRejectedException extends RuntimeException {
        private final String code;

        public PlanningRejectedException(String code, String message, Throwable cause) {
            super(message, cause);
            this.code = code;
        }

        public String code() {
            return code;
        }
    }
}
