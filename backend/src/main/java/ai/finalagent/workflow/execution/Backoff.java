package ai.finalagent.workflow.execution;

import java.util.random.RandomGenerator;

/**
 * Retry timing for reclaimed jobs.
 *
 * <p>The formula is the audit's: {@code min(cap, base * 2^(attempt-1))} plus jitter of up to 30 %
 * of the delay ({@code docs/audit/J-no-redis-job-architecture.md} §J.4). The reference repo this
 * project studied for job architecture retries immediately with no backoff and never persists the
 * attempt count at all, so a rate-limited source is hit again at once by every worker at once.
 *
 * <p>Jitter is not decoration. N jobs that fail together — a rate-limit burst, a provider blip, a
 * restarted dependency — all become eligible again on the same boundary, and without a spread they
 * retry in lockstep and reproduce the exact overload they were waiting out.
 */
public final class Backoff {

    private final double baseSeconds;
    private final double maxSeconds;

    public Backoff(double baseSeconds, double maxSeconds) {
        this.baseSeconds = baseSeconds;
        this.maxSeconds = maxSeconds;
    }

    /** Whole seconds until the next attempt, at least 1: a zero-second delay is a busy loop. */
    public int delaySeconds(int attemptCount, RandomGenerator random) {
        if (attemptCount < 1) {
            throw new IllegalArgumentException("attemptCount is 1-based; got " + attemptCount);
        }
        double exponential = baseSeconds * Math.pow(2, Math.min(30, attemptCount - 1));
        double bounded = Math.min(exponential, maxSeconds);
        double jittered = bounded + bounded * 0.3 * random.nextDouble();
        return Math.max(1, (int) Math.floor(jittered));
    }

    /** The deterministic upper bound, for tests and for anyone reasoning about worst-case latency. */
    public int maxDelaySeconds() {
        return (int) Math.floor(maxSeconds * 1.3) + 1;
    }
}
