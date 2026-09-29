package ai.finalagent.workflow.execution;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.random.RandomGenerator;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import ai.finalagent.config.FinalAgentProperties;
import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.domain.Records.Plan;
import ai.finalagent.workflow.domain.Records.Run;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.domain.RunStatus;
import ai.finalagent.workflow.repository.ActivityRepository;
import ai.finalagent.workflow.repository.JobRepository;
import ai.finalagent.workflow.repository.RunRepository;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.repository.WorkflowRepository;
import ai.finalagent.workflow.support.Json;

/**
 * Runs one claimed job to the end: heartbeat while it works, a hard timeout on the step, and a
 * single guarded write of the terminal state afterwards. On the failure paths that ordering is the
 * design.
 *
 * <p>Two rules, both from {@code docs/audit/J-no-redis-job-architecture.md}:
 *
 * <ul>
 *   <li><b>Terminal state is written in a fresh transaction</b> (§J.6). By the time we record why a
 *       step timed out or was cancelled, its own context is already finished, and a write made
 *       inside it is rolled back along with it — which is how the reference implementation left a
 *       row "stuck in processing forever" by its own admission. The Spring equivalent is
 *       {@code REQUIRES_NEW} with a bounded timeout.</li>
 *   <li><b>A worker that lost its lease writes nothing</b> (§J.2-§J.3). Every terminal write is
 *       guarded on {@code worker_id AND status = 'RUNNING'}; if the guard fails, the result is
 *       discarded, because another worker legitimately owns the job now and whichever wrote last
 *       would silently overwrite it.</li>
 * </ul>
 *
 * <p>The timeout wraps the handler rather than living inside it, so a step whose budget expires while
 * it waits on Python is reclaimed instead of parking a pool thread. The abandoned HTTP call does
 * still finish on its own — Firecrawl exposes no run-level abort — and that limitation is stated in
 * the failure message rather than hidden.
 */
@Component
public class WorkflowJobExecutor {

    private static final Logger log = LoggerFactory.getLogger(WorkflowJobExecutor.class);

    private final JobRepository jobs;
    private final StepRepository steps;
    private final RunRepository runs;
    private final WorkflowRepository workflows;
    private final ActivityRepository activity;
    private final Map<String, StepHandler> handlers;
    private final FinalAgentProperties.Execution config;
    private final Backoff backoff;
    private final WorkerIdentity identity;
    private final ScheduledExecutorService leaseScheduler;
    private final ExecutorService stepInvoker;
    private final TransactionTemplate terminalWrite;
    private final RandomGenerator random;

    public WorkflowJobExecutor(JobRepository jobs, StepRepository steps, RunRepository runs,
                               WorkflowRepository workflows, ActivityRepository activity,
                               List<StepHandler> handlerList, FinalAgentProperties properties,
                               Backoff backoff, WorkerIdentity identity,
                               @Qualifier("leaseScheduler") ScheduledExecutorService leaseScheduler,
                               @Qualifier("stepInvoker") ExecutorService stepInvoker,
                               PlatformTransactionManager transactionManager,
                               RandomGenerator randomGenerator) {
        this.jobs = jobs;
        this.steps = steps;
        this.runs = runs;
        this.workflows = workflows;
        this.activity = activity;
        this.handlers = indexHandlers(handlerList);
        this.config = properties.execution();
        this.backoff = backoff;
        this.identity = identity;
        this.leaseScheduler = leaseScheduler;
        this.stepInvoker = stepInvoker;
        this.random = randomGenerator;
        this.terminalWrite = new TransactionTemplate(transactionManager);
        this.terminalWrite.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.terminalWrite.setTimeout(5);
    }

    private static Map<String, StepHandler> indexHandlers(List<StepHandler> list) {
        Map<String, StepHandler> map = new HashMap<>();
        for (StepHandler handler : list) {
            map.put(handler.stepType(), handler);
        }
        return Map.copyOf(map);
    }

    /** Executes an already-claimed job. The poller hands this to the worker pool. */
    public void run(Job job) {
        long started = System.nanoTime();

        if (!"WORKFLOW_STEP".equals(job.jobType())) {
            finish(job, null, Terminal.rejected("JOB_TYPE_NOT_IMPLEMENTED",
                    "this build executes WORKFLOW_STEP jobs only; " + job.jobType()
                            + " has no handler and will not be rolled up as success"), started);
            return;
        }

        Step step = steps.findById(job.stepId()).orElse(null);
        Run run = runs.findById(job.runId()).orElse(null);
        Plan plan = run == null ? null : workflows.findPlan(run.planId()).orElse(null);
        if (step == null || run == null || plan == null) {
            // Retrying cannot make a vanished row reappear, and looping on it would occupy a worker
            // and hide the real fault: rows deleted under a live job.
            finish(job, step, Terminal.rejected("JOB_ROWS_MISSING",
                    "the job's step, run or plan row could not be loaded"), started);
            return;
        }

        if (step.status() == JobStatus.COMPLETED) {
            // §J.9: a reclaimed job whose step already finished is skipped, not re-executed —
            // re-running would re-spend collection credits for an answer we already hold.
            finish(job, step, new Terminal(WriteKind.FINAL, JobStatus.COMPLETED, JobStatus.COMPLETED,
                    Json.write(Map.of("skipped", "the step had already completed in an earlier attempt")),
                    null, null, null, 0L, 0), started);
            return;
        }

        runs.compareAndSetStatus(run.id(), RunStatus.PENDING, RunStatus.RUNNING);
        steps.markRunning(step.id());
        runs.updateProgress(run.id(), progressOf(run.id()));

        StepHandler handler = handlers.get(step.type());
        if (handler == null) {
            finish(job, step, Terminal.rejected("STEP_TYPE_UNIMPLEMENTED",
                    "no handler is registered for step type " + step.type()), started);
            return;
        }

        Map<String, Object> payload = Json.object(job.payloadJson());
        boolean leaseHeld = true;
        StepOutcome outcome = null;
        JobExecutionException failure = null;

        try (LeaseGuard lease = LeaseGuard.start(job.id(), identity.value(), jobs, leaseScheduler,
                config.leaseSeconds(), config.heartbeatSeconds())) {
            StepContext context = new StepContext(run, step, plan, job, payload, identity.value(),
                    lease::holdsLease, () -> runs.cancelRequested(run.id()));
            outcome = invokeWithTimeout(handler, context);
            leaseHeld = lease.holdsLease();
        } catch (JobExecutionException e) {
            failure = e;
        } catch (RuntimeException e) {
            log.error("job {} raised an unclassified failure", job.id(), e);
            failure = new JobExecutionException("UNEXPECTED_STEP_FAILURE",
                    e.getClass().getSimpleName() + ": " + text(e.getMessage()), false, e);
        }

        if (!leaseHeld || !stillOwning(job)) {
            abandonLostLease(job, step, run);
            return;
        }

        if (outcome != null) {
            finish(job, step, Terminal.from(outcome, elapsedMs(started)), started);
            return;
        }
        if (failure.retryable() && job.attemptCount() < job.maxAttempts()) {
            int delay = backoff.delaySeconds(job.attemptCount(), random);
            log.warn("job {} (step {}) attempt {} failed as {}; retrying in {}s", job.id(),
                    step.stepKey(), job.attemptCount(), failure.code(), delay);
            finish(job, step, Terminal.retry(failure.code(), text(failure.getMessage()), delay), started);
            return;
        }
        finish(job, step, Terminal.rejected(failure.code(), text(failure.getMessage())), started);
    }

    private StepOutcome invokeWithTimeout(StepHandler handler, StepContext context) {
        Callable<StepOutcome> call = () -> handler.handle(context);
        Future<StepOutcome> future = stepInvoker.submit(call);
        try {
            return future.get(config.stepTimeoutMs(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            future.cancel(true);
            throw JobExecutionException.transientFailure(JobExecutionException.TIMEOUT,
                    "the step exceeded its " + config.stepTimeoutMs() + "ms budget; the request already "
                            + "sent to the AI service finishes under its own timeout, because "
                            + "Firecrawl exposes no run-level abort");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            future.cancel(true);
            throw new JobExecutionException("WORKER_INTERRUPTED",
                    "the worker was interrupted, normally shutdown; the lease is released so another "
                            + "process can take the job over", true, e);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof JobExecutionException stepFailure) {
                throw stepFailure;
            }
            if (cause instanceof RuntimeException runtime) {
                throw runtime;
            }
            throw new JobExecutionException("STEP_HANDLER_FAILURE",
                    text(cause == null ? null : cause.getMessage()), false, cause);
        }
    }

    private boolean stillOwning(Job job) {
        return jobs.findById(job.id())
                .map(current -> identity.value().equals(current.workerId())
                        && current.status() == JobStatus.RUNNING)
                .orElse(false);
    }

    private void abandonLostLease(Job job, Step step, Run run) {
        log.warn("discarding the result of job {}: its lease was reclaimed while the step ran", job.id());
        activity.record(run.workspaceId(), run.id(), null, "workflow.job.lease_lost", "workflow_job",
                job.id(), "a worker finished this job after its lease had already been given to "
                        + "another worker; its result was discarded rather than overwriting the "
                        + "current holder's",
                Map.of("stepKey", step == null ? "(none)" : step.stepKey(), "worker", identity.value()));
    }

    // ------------------------------------------------------------------ terminal writes

    private enum WriteKind { FINAL, REQUEUE }

    private record Terminal(WriteKind kind, JobStatus jobStatus, JobStatus stepStatus,
                            String resultSummaryJson, String errorCode, String errorMessage,
                            StepOutcome.Counters counters, long durationMs, int retryDelaySeconds) {

        static Terminal from(StepOutcome outcome, long durationMs) {
            return new Terminal(WriteKind.FINAL, outcome.status(), outcome.status(),
                    outcome.summaryJson(), outcome.errorCode(), outcome.errorMessage(),
                    outcome.counters(), durationMs, 0);
        }

        static Terminal rejected(String code, String message) {
            return new Terminal(WriteKind.FINAL, JobStatus.FAILED, JobStatus.FAILED, Json.write(Map.of()),
                    code, message, StepOutcome.Counters.none(), 0L, 0);
        }

        static Terminal retry(String code, String message, int delaySeconds) {
            return new Terminal(WriteKind.REQUEUE, JobStatus.PENDING, JobStatus.PENDING, null,
                    code, message, null, 0L, delaySeconds);
        }
    }

    private void finish(Job job, Step step, Terminal terminal, long started) {
        terminalWrite.executeWithoutResult(ignored -> {
            boolean written = terminal.kind() == WriteKind.REQUEUE
                    ? jobs.requeue(job.id(), identity.value(), terminal.retryDelaySeconds(),
                            terminal.errorCode(), terminal.errorMessage())
                    : jobs.writeTerminal(job.id(), identity.value(), JobStatus.RUNNING,
                            terminal.jobStatus(), terminal.errorCode(), terminal.errorMessage(),
                            terminal.resultSummaryJson());
            if (!written) {
                Run run = runs.findById(job.runId()).orElse(null);
                abandonLostLease(job, step, run == null
                        ? new Run(job.runId(), job.workspaceId(), "", "", RunStatus.RUNNING, 1, 0,
                                0, 0, 0, 0, 0, 0, null, null, null, null, null, null)
                        : run);
                return;
            }

            if (step == null) {
                return;
            }

            boolean stepWritten = terminal.kind() == WriteKind.REQUEUE
                    ? steps.resetToPending(step.id())
                    : steps.recordResult(step.id(), terminal.stepStatus(), terminal.resultSummaryJson(),
                            terminal.durationMs(), terminal.errorCode(), terminal.errorMessage());
            if (stepWritten && terminal.counters() != null) {
                // Counters move only with the step transition that produced them, so neither a
                // replayed nor a lease-lost write can inflate a run's totals.
                runs.addCounters(step.runId(), new RunRepository.StepCounters(
                        terminal.counters().recordsRaw(), terminal.counters().recordsFound(),
                        terminal.counters().recordsValid(), terminal.counters().duplicates(),
                        terminal.counters().sourcesProcessed(), terminal.counters().sourcesFailed()));
            }

            rollupAndSchedule(step.runId());
            activity.record(step.workspaceId(), step.runId(), null, "workflow.step." + terminal.stepStatus(),
                    "workflow_step", step.id(),
                    "step " + step.stepKey() + " finished as " + terminal.stepStatus
                            + (terminal.errorCode() == null ? "" : " (" + terminal.errorCode() + ")"),
                    Map.of("jobId", job.id(), "attempt", job.attemptCount(),
                            "elapsedMs", elapsedMs(started)));
        });
    }

    /**
     * Recompute the run from its steps, and enqueue whatever became ready. In one place, so a run's
     * status is never decided by whichever code path happened to finish last — cancellation and
     * run-start also call it, for exactly that reason.
     */
    public void rollupAndSchedule(String runId) {
        Run run = runs.findById(runId).orElse(null);
        if (run == null) {
            return;
        }
        List<Step> current = steps.findByRun(runId);
        List<JobStatus> statuses = new ArrayList<>();
        for (Step step : current) {
            statuses.add(step.status());
        }
        Plan plan = workflows.findPlan(run.planId()).orElse(null);
        RunRollup.Result rollup = RunRollup.derive(statuses, run.recordsValid(),
                plan == null ? null : minimumRecords(plan), run.cancelRequestedAt() != null);

        runs.updateProgress(runId, rollup.progress());
        if (run.status() != rollup.status() && !run.status().isTerminal()) {
            runs.compareAndSetStatus(runId, run.status(), rollup.status());
            if (rollup.errorCode() != null) {
                runs.recordFailure(runId, rollup.errorCode(), rollup.errorMessage());
            }
        }

        if (rollup.status() == RunStatus.RUNNING && plan != null) {
            scheduleReadySteps(run, plan);
        }
        if (rollup.status().isTerminal()) {
            // Unstarted jobs and steps of a finished run must not sit there: the jobs would be
            // revived by the sweeper, and a PENDING step beside a FAILED run reads as work still
            // to come. RUNNING steps are left to their own workers, as everywhere else.
            jobs.cancelPendingForRun(runId, "the run finished with status " + rollup.status());
            steps.cancelPending(runId);
            activity.record(run.workspaceId(), runId, null, "workflow.run." + rollup.status(),
                    "workflow_run", runId,
                    "run finished as " + rollup.status() + " with " + run.recordsValid()
                            + " valid record(s)",
                    Map.of("progress", rollup.progress(),
                            "errorCode", rollup.errorCode() == null ? "" : rollup.errorCode()));
        }
    }

    /** @return the step keys this call queued; already-queued steps are skipped by the unique key. */
    public List<String> scheduleReadySteps(Run run, Plan plan) {
        PlanSteps planSteps = PlanSteps.parse(plan.stepsJson());
        List<String> created = new ArrayList<>();
        for (Step step : steps.findReadyToSchedule(run.id())) {
            Map<String, Object> payload = planSteps.payloadFor(step.stepKey(), step.type());
            String jobId = UUID.randomUUID().toString();
            if (jobs.insertStepJob(jobId, run.workspaceId(), run.id(), step.id(), Json.write(payload),
                    100 + step.sequence(), config.maxAttempts())) {
                created.add(step.stepKey());
                activity.record(run.workspaceId(), run.id(), null, "workflow.step.scheduled",
                        "workflow_job", jobId, "step " + step.stepKey() + " queued",
                        Map.of("stepKey", step.stepKey()));
            }
        }
        return created;
    }

    private int progressOf(String runId) {
        List<Step> all = steps.findByRun(runId);
        if (all.isEmpty()) {
            return 0;
        }
        long finished = all.stream().filter(step -> step.status().isTerminal()).count();
        return (int) Math.floor(finished * 100.0 / all.size());
    }

    private static Integer minimumRecords(Plan plan) {
        Object value = Json.object(plan.completionCriteriaJson()).get("minimumRecords");
        return value instanceof Number number ? number.intValue() : null;
    }

    private static long elapsedMs(long startedNanos) {
        return Duration.ofNanos(System.nanoTime() - startedNanos).toMillis();
    }

    private static String text(String value) {
        return value == null ? "" : value;
    }
}
