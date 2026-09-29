package ai.finalagent.workflow.execution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.HashSet;
import java.util.Random;
import java.util.Set;
import java.util.random.RandomGenerator;

import org.junit.jupiter.api.Test;

/**
 * Retry timing is arithmetic the queue depends on: too small and a rate-limited downstream is
 * hammered, too large and a transient blip strands a run. The bounds are asserted directly rather
 * than by sampling, because a distribution is only known to be right when its edges are.
 */
class BackoffTest {

    private static final RandomGenerator NO_JITTER = jitter(0.0);
    private static final RandomGenerator ALMOST_MAX_JITTER = jitter(0.999999);

    private static RandomGenerator jitter(double fraction) {
        return new Random() {
            @Override
            public double nextDouble() {
                return fraction;
            }
        };
    }

    @Test
    void theFirstRetryIsTheBaseDelayAndEachOneAfterItDoubles() {
        Backoff backoff = new Backoff(1, 120);
        assertThat(backoff.delaySeconds(1, NO_JITTER)).isEqualTo(1);
        assertThat(backoff.delaySeconds(2, NO_JITTER)).isEqualTo(2);
        assertThat(backoff.delaySeconds(3, NO_JITTER)).isEqualTo(4);
        assertThat(backoff.delaySeconds(4, NO_JITTER)).isEqualTo(8);
    }

    @Test
    void theCapHoldsNoMatterHowManyAttemptsHaveBeenUsed() {
        Backoff backoff = new Backoff(1, 120);
        assertThat(backoff.delaySeconds(8, NO_JITTER)).isEqualTo(120);
        assertThat(backoff.delaySeconds(20, NO_JITTER)).isEqualTo(120);
        assertThat(backoff.delaySeconds(200, NO_JITTER)).isEqualTo(120);
    }

    @Test
    void jitterNeverPushesTheDelayPastTheDeclaredWorstCase() {
        Backoff backoff = new Backoff(1, 120);
        assertThat(backoff.delaySeconds(20, ALMOST_MAX_JITTER)).isLessThanOrEqualTo(backoff.maxDelaySeconds());
        assertThat(backoff.delaySeconds(1, ALMOST_MAX_JITTER)).isEqualTo(1);
    }

    /**
     * The property the whole jitter exists for: N jobs that failed together must not become
     * eligible again together, or they retry in lockstep and reproduce the overload they were
     * waiting out.
     */
    @Test
    void differentRandomDrawsSpreadTheSameAttemptAcrossDifferentDelays() {
        Backoff backoff = new Backoff(4, 120);
        Set<Integer> delays = new HashSet<>();
        for (int i = 0; i < 200; i++) {
            delays.add(backoff.delaySeconds(1, RandomGenerator.getDefault()));
        }
        assertThat(delays).hasSizeGreaterThan(1);
        assertThat(delays).allSatisfy(delay -> assertThat(delay).isBetween(4, 5));
    }

    @Test
    void aDelayIsAlwaysAtLeastOneSecondBecauseZeroIsABusyLoop() {
        assertThat(new Backoff(0.1, 120).delaySeconds(1, NO_JITTER)).isEqualTo(1);
    }

    @Test
    void attemptNumbersAreOneBasedAndAnAttemptZeroIsAProgrammingError() {
        Backoff backoff = new Backoff(1, 120);
        assertThatThrownBy(() -> backoff.delaySeconds(0, NO_JITTER))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("1-based");
    }

    @Test
    void theWorstCaseBoundIsStatedWithoutRandomnessSoATestAndAnOperatorCanUseIt() {
        assertThat(new Backoff(1, 120).maxDelaySeconds()).isEqualTo(157);
    }
}
