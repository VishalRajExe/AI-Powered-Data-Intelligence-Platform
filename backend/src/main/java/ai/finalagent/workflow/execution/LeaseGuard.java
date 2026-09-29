package ai.finalagent.workflow.execution;

import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import ai.finalagent.workflow.repository.JobRepository;

/**
 * Renews a job's lease while its step runs, and notices the moment the lease is no longer ours.
 *
 * <p>The lost-lease path is the reason this exists rather than a longer timeout: if a step outlives
 * its lease, another worker legitimately claims the same job, and now two workers are producing
 * results for one step. Whichever writes last would otherwise win arbitrarily. Renewal returns
 * false exactly when the row no longer carries our {@code worker_id}, so the losing worker stops
 * writing and the winner is whoever the database says holds the job.
 *
 * <p>Fixing the failure this guards against is the lease being <em>shorter</em> than the step
 * timeout, which the startup validator enforces rather than trusting an operator to notice.
 */
public class LeaseGuard implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(LeaseGuard.class);

    private final AtomicBoolean lost;
    private final ScheduledFuture<?> task;

    private LeaseGuard(AtomicBoolean lost, ScheduledFuture<?> task) {
        this.lost = lost;
        this.task = task;
    }

    public static LeaseGuard start(String jobId, String workerId, JobRepository jobs,
                                   ScheduledExecutorService scheduler, int leaseSeconds,
                                   int heartbeatSeconds) {
        AtomicBoolean lost = new AtomicBoolean(false);
        ScheduledFuture<?> task = scheduler.scheduleAtFixedRate(() -> {
            if (lost.get()) {
                return;
            }
            try {
                if (!jobs.renewLease(jobId, workerId, leaseSeconds)) {
                    lost.set(true);
                    log.warn("lease for job {} is no longer held by {}; stopping writes", jobId, workerId);
                }
            } catch (RuntimeException e) {
                // A renewal that throws is not evidence the lease was lost — the database may be
                // briefly unreachable — so it retries until the lease genuinely expires. Marking
                // it lost here would abandon a live job over a transient fault.
                log.warn("lease renewal for job {} failed ({}); retrying until the deadline",
                        jobId, e.getClass().getSimpleName());
            }
        }, heartbeatSeconds, heartbeatSeconds, TimeUnit.SECONDS);
        return new LeaseGuard(lost, task);
    }

    public boolean holdsLease() {
        return !lost.get();
    }

    @Override
    public void close() {
        task.cancel(false);
    }
}
