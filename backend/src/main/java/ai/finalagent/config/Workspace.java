package ai.finalagent.config;

import java.util.Optional;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import ai.finalagent.identity.security.AuthenticatedWorkspace;
import ai.finalagent.workflow.support.Principals;

/**
 * The one place a request's tenant is resolved.
 *
 * <p>It comes from the authenticated session and from nothing else. Not from configuration — a
 * configured tenant is a placeholder that quietly makes every caller the same person, and the audit
 * names it as the thing that must not survive into a shared deployment
 * ({@code docs/audit/00-FORENSIC-AUDIT.md} §5 item 2). Not from the request either: the previous
 * project read {@code workspaceId} off requests whose auth middleware was optional, so knowing a UUID
 * was the whole credential.
 *
 * <p>It throws when there is no principal. That is deliberate and it is the reason the placeholder can
 * be deleted rather than left as a fallback: a silent fallback to a default tenant is precisely the
 * demo-mode shape this rebuild was written to remove, and a request that reaches a tenant-scoped
 * service without a session is a routing mistake in {@code SecurityConfig} that should surface as an
 * error, not as somebody else's data.
 *
 * <p>Queue workers do not use this class. A job carries the {@code workspace_id} of the run that
 * created it, which is read from the row — see {@code ExportRunner} and {@code SaveStepHandler}.
 */
@Component
public class Workspace {

    /** The tenant this request belongs to. */
    public String current() {
        return principal().map(AuthenticatedWorkspace::workspaceId).orElseThrow(() ->
                new NoSessionException("this request carries no session, so there is no workspace to"
                        + " scope it to — the endpoint should have been refused before it got here"));
    }

    /**
     * Who this request is, for the columns that record an author.
     *
     * <p>Falls back to the machine actor rather than throwing, because an activity event written by a
     * worker has no person behind it and that is a true fact about the row, not a missing credential.
     * Anything on a request path resolves a real user id: {@link #current()} has already refused the
     * call if there is no session.
     */
    public String actor() {
        return principal().map(AuthenticatedWorkspace::userId).orElse(Principals.SYSTEM);
    }

    public AuthenticatedWorkspace require() {
        return principal().orElseThrow(() -> new NoSessionException("no session on this request"));
    }

    /**
     * Whether this request may change anything.
     *
     * <p>The role here is not a copy taken at login: {@code SessionCookieFilter} re-reads membership
     * on every request, so an owner who demotes someone ends that person's write access on their next
     * call rather than at their next sign-in. Authorization judged against a stale copy of membership
     * is authorization that has already been revoked.
     */
    public boolean canWrite() {
        return require().canWrite();
    }

    private static Optional<AuthenticatedWorkspace> principal() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof AuthenticatedWorkspace principal)) {
            return Optional.empty();
        }
        return Optional.of(principal);
    }

    /** A tenant-scoped service reached without a session; answered as 401, never as a default. */
    public static class NoSessionException extends RuntimeException {
        public NoSessionException(String message) {
            super(message);
        }
    }
}
