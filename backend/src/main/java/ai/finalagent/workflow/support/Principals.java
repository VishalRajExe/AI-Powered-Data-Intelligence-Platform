package ai.finalagent.workflow.support;

/**
 * The actor recorded on rows until authentication exists.
 *
 * <p>A nil UUID rather than a plausible user id or an empty string, because "we do not know who"
 * and "the system did it" are different facts, and the previous project's seeded backdoor login
 * ({@code demo@pirateagent.ai}) is what happens when a placeholder is allowed to look like a real
 * account. The authentication phase replaces every read of this with the token's subject; the
 * column stays NOT NULL so no row is ever written unattributed by accident.
 */
public final class Principals {

    public static final String UNAUTHENTICATED = "00000000-0000-0000-0000-000000000000";

    private Principals() {
    }
}
