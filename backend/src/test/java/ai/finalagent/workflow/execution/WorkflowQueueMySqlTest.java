package ai.finalagent.workflow.execution;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.domain.Records.Plan;
import ai.finalagent.workflow.domain.Records.Run;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.domain.RunStatus;
import ai.finalagent.workflow.repository.JobRepository;
import ai.finalagent.workflow.repository.RunRepository;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.repository.WorkflowRepository;

/**
 * The queue's guarantees, tested against the database that has to provide them.
 *
 * <p>These cannot be shown with doubles: "exactly one worker claims a job" is a property of one
 * conditional UPDATE re-checking status and version inside the same statement InnoDB executes, and
 * a mock of that method would be a test of Mockito. The gate is {@code FINALAGENT_TEST_MYSQL=true},
 * so an environment without MySQL skips rather than pretends.
 *
 * <p>The auto-started worker is stopped in every test here: these cases observe one transition at a
 * time, and a background poller would claim the row mid-assertion. A worker actually running is
 * what {@link WorkflowRunLifecycleMySqlTest} covers.
 */
@SpringBootTest
@ActiveProfiles("mysql")
@EnabledIfEnvironmentVariable(named = "FINALAGENT_TEST_MYSQL", matches = "true")
class WorkflowQueueMySqlTest {

    private static final String WORKSPACE = "00000000-0000-0000-0000-000000000ff1";
    private static final String NO_PRINCIPAL = "00000000-0000-0000-0000-000000000000";

    @Autowired
    private JobRepository jobs;
    @Autowired
    private StepRepository steps;
    @Autowired
    private RunRepository runs;
    @Autowired
    private WorkflowRepository workflows;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private WorkflowWorker worker;

    @BeforeEach
    void quietTheWorker() {
        worker.stop();
        emptyWorkspace();
    }

    @AfterEach
    void removeTestRows() {
        emptyWorkspace();
    }

    /**
     * Rows are deleted by workspace, which only these tests write. Without it a PENDING job left by
     * an interrupted run would win the claim race in the next test, and the failure would look like
     * a broken queue rather than like a dirty table.
     */
    private void emptyWorkspace() {
        jdbc.update("DELETE FROM activity_events WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM workflows WHERE workspace_id = ?", WORKSPACE);
    }

    /** A workflow, plan, run and single step, as the schema requires them. */
    private Step freshChain() {
        String workflowId = UUID.randomUUID().toString();
        String planId = UUID.randomUUID().toString();
        String runId = UUID.randomUUID().toString();
        String stepId = UUID.randomUUID().toString();

        workflows.insert(workflowId, WORKSPACE, NO_PRINCIPAL, "queue test", "collect something");
        workflows.insertPlan(new Plan(planId, WORKSPACE, workflowId, 1, "objective", "{}", "{}",
                "[]", "{}", "{}", "{}", "hash-1", NO_PRINCIPAL, Instant.now()));
        runs.insert(runId, WORKSPACE, workflowId, planId, 1);
        steps.insert(stepId, WORKSPACE, runId, 1, "collect", 0, "[]", "EXTRACT", "{}");
        return steps.findById(stepId).orElseThrow();
    }

    private Job enqueue(Step step, int priority) {
        String jobId = UUID.randomUUID().toString();
        assertThat(jobs.insertStepJob(jobId, WORKSPACE, step.runId(), step.id(),
                "{\"config\":{}}", priority, 3)).isTrue();
        return jobs.findById(jobId).orElseThrow();
    }

    private void expireLease(String jobId) {
        jdbc.update("UPDATE workflow_jobs SET lease_expires_at = TIMESTAMPADD(SECOND, -1, NOW(6)) "
                + "WHERE id = ?", jobId);
    }

    @Test
    void theMigrationsCreateTheConstraintsTheQueueIsMadeOf() {
        List<String> tables = jdbc.queryForList("""
                SELECT table_name FROM information_schema.tables
                 WHERE table_schema = DATABASE()
                   AND table_name IN ('workflows','workflow_plans','workflow_runs','workflow_steps',
                                      'workflow_jobs','activity_events','flyway_schema_history')
                """, String.class);
        assertThat(tables).contains("workflow_jobs", "workflow_steps", "workflow_runs",
                "flyway_schema_history");

        // The unique keys are the duplicate prevention. Without them every rule below is a race
        // that sometimes works.
        List<String> keys = jdbc.queryForList("""
                SELECT DISTINCT index_name FROM information_schema.statistics
                 WHERE table_schema = DATABASE() AND non_unique = 0
                   AND index_name IN ('uq_job_per_step','uq_run_attempt','uq_step_key','uq_step_sequence')
                """, String.class);
        assertThat(keys).contains("uq_job_per_step", "uq_run_attempt", "uq_step_key",
                "uq_step_sequence");
    }

    @Test
    void eightThreadsRacingForOneJobProduceExactlyOneOwner() throws Exception {
        Job job = enqueue(freshChain(), 100);
        int racers = 8;
        ExecutorService pool = Executors.newFixedThreadPool(racers);
        CountDownLatch ready = new CountDownLatch(racers);
        CountDownLatch go = new CountDownLatch(1);
        AtomicInteger winners = new AtomicInteger();

        try {
            for (int i = 0; i < racers; i++) {
                final String workerId = "worker-" + i;
                pool.submit(() -> {
                    ready.countDown();
                    try {
                        go.await(10, TimeUnit.SECONDS);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                    jobs.findClaimable().filter(candidate -> candidate.id().equals(job.id()))
                            .ifPresent(candidate -> {
                                if (jobs.claim(candidate.id(), candidate.version(), workerId, 30)) {
                                    winners.incrementAndGet();
                                }
                            });
                });
            }
            ready.await(10, TimeUnit.SECONDS);
            go.countDown();
            pool.shutdown();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        } finally {
            pool.shutdownNow();
        }

        assertThat(winners.get()).isEqualTo(1);
        Job after = jobs.findById(job.id()).orElseThrow();
        assertThat(after.status()).isEqualTo(JobStatus.RUNNING);
        assertThat(after.attemptCount()).isEqualTo(1);
        assertThat(after.workerId()).startsWith("worker-");
        assertThat(after.leaseExpiresAt()).isAfter(Instant.now().minusSeconds(1));
    }

    @Test
    void aClaimWithAVersionThatIsNoLongerCurrentIsRefused() {
        Job job = enqueue(freshChain(), 100);
        assertThat(jobs.claim(job.id(), job.version() + 7, "worker-late", 30)).isFalse();

        Job after = jobs.findById(job.id()).orElseThrow();
        assertThat(after.status()).isEqualTo(JobStatus.PENDING);
        assertThat(after.workerId()).isNull();
    }

    @Test
    void aJobScheduledForTheFutureIsNotClaimableYet() {
        Step step = freshChain();
        String jobId = UUID.randomUUID().toString();
        jdbc.update("""
                INSERT INTO workflow_jobs (id, workspace_id, run_id, job_type, step_id, payload,
                                           status, priority, max_attempts, scheduled_for)
                VALUES (?, ?, ?, 'WORKFLOW_STEP', ?, '{}', 'PENDING', 100, 3,
                        TIMESTAMPADD(SECOND, 120, NOW(6)))
                """, jobId, WORKSPACE, step.runId(), step.id());

        assertThat(jobs.findClaimable()).isEmpty();
        assertThat(jobs.claim(jobId, 0, "worker-eager", 30)).isFalse();
    }

    @Test
    void twoSchedulingPassesCannotCreateTwoJobsForTheSameStep() {
        Step step = freshChain();
        assertThat(jobs.insertStepJob(UUID.randomUUID().toString(), WORKSPACE, step.runId(), step.id(),
                "{}", 100, 3)).isTrue();
        assertThat(jobs.insertStepJob(UUID.randomUUID().toString(), WORKSPACE, step.runId(), step.id(),
                "{}", 100, 3)).isFalse();

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM workflow_jobs WHERE step_id = ?",
                Integer.class, step.id())).isEqualTo(1);
    }

    @Test
    void twoSchedulingPassesCannotCreateTwoStepsForTheSamePlanNode() {
        Step step = freshChain();
        assertThat(steps.insert(UUID.randomUUID().toString(), WORKSPACE, step.runId(), 1,
                "collect", 5, "[]", "EXTRACT", "{}")).isFalse();
        assertThat(steps.findByRun(step.runId())).hasSize(1);
    }

    @Test
    void twoRunsOfTheSameWorkflowGetDifferentAttemptsAndADuplicateAttemptIsRefused() {
        String workflowId = UUID.randomUUID().toString();
        String planId = UUID.randomUUID().toString();
        workflows.insert(workflowId, WORKSPACE, NO_PRINCIPAL, "run attempts", "collect something");
        workflows.insertPlan(new Plan(planId, WORKSPACE, workflowId, 1, "objective", "{}", "{}",
                "[]", "{}", "{}", "{}", "hash-1", NO_PRINCIPAL, Instant.now()));

        assertThat(runs.nextAttempt(workflowId)).isEqualTo(1);
        String runOne = UUID.randomUUID().toString();
        assertThat(runs.insert(runOne, WORKSPACE, workflowId, planId, 1)).isTrue();
        assertThat(runs.nextAttempt(workflowId)).isEqualTo(2);
        // A second insert at the same attempt is the duplicate-start case, and the unique key makes
        // it an insert failure rather than two competing executions of one plan.
        assertThat(runs.insert(UUID.randomUUID().toString(), WORKSPACE, workflowId, planId, 1)).isFalse();
        assertThat(runs.findByWorkflowAndAttempt(workflowId, 1)).map(Run::id).contains(runOne);
    }

    @Test
    void aWorkerWhoseLeaseWasTakenOverCannotWriteAnything() {
        Job job = enqueue(freshChain(), 100);
        assertThat(jobs.claim(job.id(), job.version(), "worker-original", 30)).isTrue();

        // Another worker legitimately takes it over: expired lease, reclaimed, claimed again.
        expireLease(job.id());
        assertThat(jobs.reclaimExpiredLease(job.id())).isTrue();
        Job revived = jobs.findById(job.id()).orElseThrow();
        assertThat(jobs.claim(job.id(), revived.version(), "worker-second", 30)).isTrue();

        assertThat(jobs.writeTerminal(job.id(), "worker-original", JobStatus.RUNNING,
                JobStatus.COMPLETED, null, null, "{\"records\":[]}")).isFalse();
        assertThat(jobs.requeue(job.id(), "worker-original", 5, "X", "y")).isFalse();
        assertThat(jobs.renewLease(job.id(), "worker-original", 30)).isFalse();

        Job after = jobs.findById(job.id()).orElseThrow();
        assertThat(after.status()).isEqualTo(JobStatus.RUNNING);
        assertThat(after.workerId()).isEqualTo("worker-second");
        assertThat(after.resultSummaryJson()).isNull();
    }

    @Test
    void anExpiredLeaseIsRevivedWhileAttemptsRemainAndItsStepGoesBackToPending() {
        Step step = freshChain();
        Job job = enqueue(step, 100);
        assertThat(jobs.claim(job.id(), job.version(), "worker-dying", 30)).isTrue();
        steps.markRunning(step.id());

        expireLease(job.id());
        worker.reclaimExpiredLeases();

        Job after = jobs.findById(job.id()).orElseThrow();
        assertThat(after.status()).isEqualTo(JobStatus.PENDING);
        assertThat(after.workerId()).isNull();
        assertThat(after.attemptCount()).isEqualTo(1);
        assertThat(steps.findById(step.id()).orElseThrow().status()).isEqualTo(JobStatus.PENDING);
        // Revived, not lost: the next worker can take it now.
        assertThat(jobs.claim(after.id(), after.version(), "worker-next", 30)).isTrue();
    }

    @Test
    void anExpiredLeaseWithNoAttemptsLeftFailsTheJobOutrightRatherThanRevivingItForever() {
        Step step = freshChain();
        Job job = enqueue(step, 100);
        assertThat(jobs.claim(job.id(), job.version(), "worker-last", 30)).isTrue();
        steps.markRunning(step.id());
        jdbc.update("UPDATE workflow_jobs SET attempt_count = max_attempts WHERE id = ?", job.id());

        expireLease(job.id());
        worker.reclaimExpiredLeases();

        Job after = jobs.findById(job.id()).orElseThrow();
        assertThat(after.status()).isEqualTo(JobStatus.FAILED);
        assertThat(after.lastErrorCode()).isEqualTo("LEASE_EXPIRED_EXHAUSTED");
        Step failedStep = steps.findById(step.id()).orElseThrow();
        assertThat(failedStep.status()).isEqualTo(JobStatus.FAILED);
        assertThat(failedStep.errorCode()).isEqualTo("LEASE_EXPIRED_EXHAUSTED");
    }

    @Test
    void aRetriedJobIsScheduledInTheFutureSoTheBackoffIsNotMerelyANumberInARow() {
        Job job = enqueue(freshChain(), 100);
        assertThat(jobs.claim(job.id(), job.version(), "worker-one", 30)).isTrue();

        assertThat(jobs.requeue(job.id(), "worker-one", 60, "RATE_LIMIT", "slow down")).isTrue();

        Job after = jobs.findById(job.id()).orElseThrow();
        assertThat(after.status()).isEqualTo(JobStatus.PENDING);
        assertThat(after.workerId()).isNull();
        assertThat(after.scheduledFor()).isAfter(Instant.now().plusSeconds(30));
        // next_retry_at is the operator-facing record of when this job may run again; scheduled_for
        // is what the claim reads, and both are written by the same statement.
        assertThat(jdbc.queryForObject("SELECT next_retry_at > TIMESTAMPADD(SECOND, 30, NOW(6)) "
                + "FROM workflow_jobs WHERE id = ?", Boolean.class, job.id())).isTrue();
        assertThat(after.lastErrorCode()).isEqualTo("RATE_LIMIT");
        // The attempt the failed claim already spent is kept: that is what makes max_attempts real.
        assertThat(after.attemptCount()).isEqualTo(1);
        assertThat(jobs.findClaimable()).isEmpty();
    }

    @Test
    void shutdownReleasesLeasesSoANewProcessDoesNotWaitForThemToExpire() {
        Job first = enqueue(freshChain(), 100);
        Job second = enqueue(freshChain(), 101);
        jobs.claim(first.id(), first.version(), "worker-shutdown", 30);
        jobs.claim(second.id(), second.version(), "worker-shutdown", 30);

        assertThat(jobs.releaseLeasesHeldBy("worker-shutdown")).isEqualTo(2);

        Job after = jobs.findById(first.id()).orElseThrow();
        assertThat(after.status()).isEqualTo(JobStatus.PENDING);
        assertThat(after.leaseExpiresAt()).isNull();
        assertThat(jobs.findClaimable()).isPresent();
    }

    @Test
    void cancellationCancelsUnstartedJobsSoTheSweeperCannotReviveThem() {
        Step step = freshChain();
        Job job = enqueue(step, 100);
        Run run = runs.findById(step.runId()).orElseThrow();
        runs.compareAndSetStatus(run.id(), RunStatus.PENDING, RunStatus.RUNNING);

        assertThat(jobs.cancelPendingForRun(run.id(), "cancellation was requested")).isEqualTo(1);

        Job after = jobs.findById(job.id()).orElseThrow();
        assertThat(after.status()).isEqualTo(JobStatus.CANCELLED);
        assertThat(after.lastErrorCode()).isEqualTo("RUN_CANCELLED");
        assertThat(jobs.findClaimable()).isEmpty();
    }

    @Test
    void aLateCallbackCannotReopenAFinishedJob() {
        Job job = enqueue(freshChain(), 100);
        jobs.claim(job.id(), job.version(), "worker-once", 30);
        assertThat(jobs.writeTerminal(job.id(), "worker-once", JobStatus.RUNNING, JobStatus.COMPLETED,
                null, null, "{\"ok\":true}")).isTrue();

        long versionAfter = jobs.findById(job.id()).orElseThrow().version();
        assertThat(jobs.writeTerminal(job.id(), "worker-once", JobStatus.RUNNING, JobStatus.FAILED,
                "LATE", "a late callback must not reopen a finished job", null)).isFalse();

        Job after = jobs.findById(job.id()).orElseThrow();
        assertThat(after.status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(after.version()).isEqualTo(versionAfter);
        assertThat(after.lastErrorCode()).isNull();
    }
}
