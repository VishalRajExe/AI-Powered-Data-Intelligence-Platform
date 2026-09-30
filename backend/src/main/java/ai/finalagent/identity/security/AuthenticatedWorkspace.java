package ai.finalagent.identity.security;

import java.util.Collection;
import java.util.List;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

import ai.finalagent.identity.domain.Identity.WorkspaceRole;

/**
 * What an authenticated request is: one person, acting inside one workspace, with one role.
 *
 * <p>The workspace id is part of the identity rather than a parameter a controller passes down,
 * because that is where the replaced project went wrong — {@code workspaceId} arrived on the request
 * and routes whose auth middleware was optional trusted it
 * ({@code docs/audit/00-FORENSIC-AUDIT.md} §5 item 1). A caller cannot name a tenant here; the
 * tenant is whatever the presented session was issued against, and membership in it is re-read on
 * every request rather than cached in this record.
 *
 * @param sessionId the row that authorized this request, so logout and revocation can name what they
 *                  ended
 */
public record AuthenticatedWorkspace(String sessionId, String userId, String workspaceId,
                                     WorkspaceRole role) {

    public Collection<? extends GrantedAuthority> authorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }

    /** The write half of the ladder: creating work, spending credits, asking for a file. */
    public boolean canWrite() {
        return role.atLeast(WorkspaceRole.EDITOR);
    }

    public boolean isOwner() {
        return role == WorkspaceRole.OWNER;
    }
}
