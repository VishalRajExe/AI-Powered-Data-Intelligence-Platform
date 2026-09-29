package ai.finalagent.workflow.execution;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.random.RandomGenerator;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import ai.finalagent.config.FinalAgentProperties;

/**
 * The three thread pools the workflow layer needs, and why they are separate.
 *
 * <ul>
 *   <li><b>Job pool</b> — one thread per claimed job. Sized like §J.5's executor, and bounded the
 *       same way the reference implementation bounded it: a full pool means the poller stops
 *       claiming, not that claimed jobs pile up in a queue with a lease ticking down.</li>
 *   <li><b>Step invoker</b> — the thread a handler runs on, so the job thread can enforce a timeout
 *       on it. Two threads per job is not waste: without the second, "the step timed out" would
 *       require the step to cooperate, and a call blocked on a socket never does.</li>
 *   <li><b>Lease scheduler</b> — tiny, shared, and deliberately not the job pool: a lease renewal
 *       that queues behind nine long steps is a renewal that misses its window, which is how a
 *       healthy worker gets evicted from its own job.</li>
 * </ul>
 */
@Configuration
public class WorkflowBeans {

    @Bean(name = "workflowJobPool", destroyMethod = "shutdown")
    ExecutorService workflowJobPool(FinalAgentProperties properties) {
        FinalAgentProperties.Execution config = properties.execution();
        AtomicInteger sequence = new AtomicInteger();
        // The claim gate is `WorkflowWorker`'s semaphore, so at most maxPoolSize jobs are ever in
        // flight; a cached pool with daemon threads simply never blocks on submission, which is what
        // CallerRunsPolicy was there for and what the semaphore now does better.
        return Executors.newFixedThreadPool(config.maxPoolSize(), runnable -> {
            Thread thread = new Thread(runnable, "wf-job-" + sequence.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        });
    }

    @Bean(name = "stepInvoker", destroyMethod = "shutdownNow")
    ExecutorService stepInvoker(FinalAgentProperties properties) {
        AtomicInteger sequence = new AtomicInteger();
        return Executors.newCachedThreadPool(runnable -> {
            Thread thread = new Thread(runnable, "wf-step-" + sequence.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        });
    }

    @Bean(name = "leaseScheduler", destroyMethod = "shutdownNow")
    ScheduledExecutorService leaseScheduler(FinalAgentProperties properties) {
        int threads = Math.max(1, properties.execution().maxPoolSize() / 4);
        return Executors.newScheduledThreadPool(threads, runnable -> {
            Thread thread = new Thread(runnable, "wf-lease");
            thread.setDaemon(true);
            return thread;
        });
    }

    @Bean
    Backoff workflowBackoff(FinalAgentProperties properties) {
        return new Backoff(properties.execution().backoffBaseSeconds(),
                properties.execution().backoffMaxSeconds());
    }

    @Bean
    RandomGenerator workflowRandom() {
        return RandomGenerator.getDefault();
    }
}
