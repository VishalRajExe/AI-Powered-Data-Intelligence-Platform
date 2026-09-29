package ai.finalagent.workflow.execution;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

import ai.finalagent.config.FinalAgentProperties;
import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.repository.JobRepository;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.support.Json;

/**
 * The claim loop, and the shutdown discipline around it.
 *
 * <p>Ordering on stop is the point, not a detail (§J.13): stop claiming → let in-flight steps
 * finish within a bounded window → **release our leases**. Skipping that last step is the
 * difference between a redeploy that resumes in seconds and one where every in-flight job sits
 * until its lease expires before anyone can touch it again.
 *
 * <p>A semaphore, not a queue size, decides how many jobs may be claimed. The pool's queue would
 * absorb unlimited claimed work, and a claimed job whose lease is ticking while it waits behind
 * 200 others is a job that will be reclaimed and run twice — the exact failure the lease is meant
 * to detect.
 */
@Component
public class WorkflowWorker implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(WorkflowWorker.class);

    private final JobRepository jobs;
    private final StepRepository steps;
    private final WorkflowJobExecutor executor;
    private final ExecutorService jobPool;
    private final FinalAgentProperties.Execution config;
    private final WorkerIdentity identity;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private Semaphore capacity;
    private ScheduledExecutorService poller;
    private final AtomicInteger inFlight = new AtomicInteger();

    public WorkflowWorker(JobRepository jobs, StepRepository steps, WorkflowJobExecutor executor,
                         @Qualifier("workflowJobPool") ExecutorService workflowJobPool,
                         FinalAgentProperties properties, WorkerIdentity identity) {
        this.jobs = jobs;
        this.steps = steps;
        this.executor = executor;
        this.jobPool = workflowJobPool;
        this.config = properties.execution();
        this.identity = identity;
    }

    @Override
    public void start() {
        if (!config.enabled() || !running.compareAndSet(false, true)) {
            return;
        }
        capacity = new Semaphore(config.maxPoolSize());
        poller = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "wf-poll");
            thread.setDaemon(true);
            return thread;
        });
        poller.scheduleWithFixedDelay(this::pollOnce, config.pollIntervalMs(), config.pollIntervalMs(),
                TimeUnit.MILLISECONDS);
        log.info("workflow worker {} started (pool {}, lease {}s, poll {}ms)", identity.value(),
                config.maxPoolSize(), config.leaseSeconds(), config.pollIntervalMs());
    }

    /** One pass: claim up to the batch size, but only into free slots. */
    void pollOnce() {
        if (!running.get()) {
            return;
        }
        try {
            reclaimExpiredLeases();
        } catch (RuntimeException e) {
            log.warn("lease sweep failed: {}", e.getClass().getSimpleName());
        }

        for (int i = 0; i < config.batchSize() && capacity.tryAcquire(); i++) {
            Optional<JobRepository.Candidate> candidate;
            try {
                candidate = jobs.findClaimable();
            } catch (RuntimeException e) {
                capacity.release();
                log.warn("claim query failed ({}); retrying on the next tick",
                        e.getClass().getSimpleName());
                return;
            }
            if (candidate.isEmpty()) {
                capacity.release();
                return;
            }
            JobRepository.Candidate pick = candidate.get();
            boolean owned;
            try {
                owned = jobs.claim(pick.id(), pick.version(), identity.value(), config.leaseSeconds());
            } catch (RuntimeException e) {
                capacity.release();
                log.warn("claim of job {} failed: {}", pick.id(), e.getClass().getSimpleName());
                return;
            }
            if (!owned) {
                // Another worker won the race. The slot is freed and the next tick tries again;
                // this is the normal outcome with more than one worker, not an error.
                capacity.release();
                continue;
            }
            Optional<Job> job = jobs.findById(pick.id());
            if (job.isEmpty()) {
                capacity.release();
                continue;
            }
            inFlight.incrementAndGet();
            try {
                jobPool.execute(() -> {
                    try {
                        executor.run(job.get());
                    } catch (RuntimeException e) {
                        log.error("worker loop threw for job {}", pick.id(), e);
                    } finally {
                        inFlight.decrementAndGet();
                        capacity.release();
                    }
                });
            } catch (RuntimeException e) {
                inFlight.decrementAndGet();
                capacity.release();
                log.error("job {} could not be handed to the worker pool", pick.id(), e);
            }
        }
    }

    /** §J.3: a dead worker's job becomes claimable again instead of staying RUNNING forever. */
    void reclaimExpiredLeases() {
        for (JobRepository.ExpiredJob expired : jobs.findExpired(config.batchSize())) {
            if (expired.attemptCount() < expired.maxAttempts()) {
                if (jobs.reclaimExpiredLease(expired.id()) && expired.stepId() != null) {
                    steps.resetToPending(expired.stepId());
                    log.warn("reclaimed job {} after its lease expired (attempt {} of {})",
                            expired.id(), expired.attemptCount(), expired.maxAttempts());
                }
                continue;
            }
            // No attempts left: failing it loudly is the only honest outcome. Leaving it RUNNING
            // would look like work in progress forever, which is how the old export jobs stranded.
            if (jobs.failLeaseExhausted(expired.id()) && expired.stepId() != null) {
                steps.recordResult(expired.stepId(), JobStatus.FAILED, Json.write(Map.of()), 0L,
                        "LEASE_EXPIRED_EXHAUSTED",
                        "the worker holding this step stopped reporting and no attempts remained");
                log.warn("failed job {} outright: its lease expired with {} attempt(s) used",
                        expired.id(), expired.attemptCount());
            }
        }
    }

    @Override
    public void stop() {
        if (!running.compareAndSet(true, false)) {
            return;
        }
        if (poller != null) {
            poller.shutdown();
            closeQuietly(poller);
        }
        // Bounded: past this the lease would have expired anyway, and holding shutdown open longer
        // only delays the next process taking the work over.
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(Math.min(30, config.leaseSeconds()));
        while (inFlight.get() > 0 && System.nanoTime() < deadline) {
            try {
                TimeUnit.MILLISECONDS.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        int released = jobs.releaseLeasesHeldBy(identity.value());
        log.info("workflow worker {} stopped; released {} lease(s) for immediate reclaim",
                identity.value(), released);
    }

    private static void closeQuietly(ScheduledExecutorService service) {
        try {
            service.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @Override
    public boolean isRunning() {
        return running.get();
    }

    /** Last to start, first to stop: nothing may claim work while shutdown is draining it. */
    @Override
    public int getPhase() {
        return Integer.MAX_VALUE - 10;
    }

    public int freeSlots() {
        return capacity == null ? 0 : capacity.availablePermits();
    }

    public int inFlight() {
        return inFlight.get();
    }

    public String workerId() {
        return identity.value();
    }
}
