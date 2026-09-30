package ai.finalagent.workflow.support;

/**
 * The actor recorded on rows no person wrote.
 *
 * <p>A nil UUID rather than a plausible user id or an empty string, because "the system did this" and
 * "we do not know who" are different facts. {@code V5__baseline_identity.sql} turns it into a real row
 * with {@code status = 'SERVICE'} and {@code password_hash NULL}, so the value the pre-authentication
 * data already carried now points at something the database can describe — and at something the login
 * path refuses, because a null hash can never be matched.
 *
 * <p>It is not a fallback for a request that has no session. Those are answered by
 * {@code Workspace.NoSessionException}, not by attributing the work to the machine: silently recording
 * a person's action as the system's is how an audit trail stops meaning anything, and it is one step
 * from the seeded account the old project shipped as {@code demo@pirateagent.ai}.
 */
public final class Principals {

    public static final String SYSTEM = "00000000-0000-0000-0000-000000000000";

    private Principals() {
    }
}
