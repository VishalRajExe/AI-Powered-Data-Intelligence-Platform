package ai.finalagent.identity.security;

import java.io.IOException;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import ai.finalagent.identity.domain.Identity.UserStatus;
import ai.finalagent.identity.repository.IdentityRepository;
import ai.finalagent.identity.repository.SessionRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Turns a presented session cookie into an authenticated workspace, or into nothing.
 *
 * <p>Three reads per request, and they are on purpose:
 *
 * <ol>
 *   <li>the session row, by the hash of what was presented — this is what logout and rotation act on,
 *       so it cannot be cached without making either of them a suggestion;</li>
 *   <li>membership, because a role taken off the session row would keep working after the owner
 *       removed the user;</li>
 *   <li>the user's status, because a disabled account with a live session is the hole an operator
 *       expects to have closed when they disabled it.</li>
 * </ol>
 *
 * <p>Any failure clears the context and continues. The filter never answers the request itself: what
 * happens next is the chain's business, and an unauthenticated request reaching a protected route is
 * reported once, by the authorization layer, in the shape every other error here has.
 */
public class SessionCookieFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(SessionCookieFilter.class);

    /** The only credential transport this build accepts. Nothing in a request body names a tenant. */
    public static final String COOKIE_NAME = "finalagent_session";

    private final SessionRepository sessions;
    private final IdentityRepository identities;

    public SessionCookieFilter(SessionRepository sessions, IdentityRepository identities) {
        this.sessions = sessions;
        this.identities = identities;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String presented = readCookie(request);
        if (presented == null) {
            // Absent is not invalid: an anonymous hit on a protected route and a stale cookie should
            // not be distinguishable to someone probing which tokens they are holding.
            chain.doFilter(request, response);
            return;
        }

        try {
            resolve(presented).ifPresent(principal -> SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(principal, null, principal.authorities())));
            chain.doFilter(request, response);
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    private static String readCookie(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        for (Cookie cookie : cookies) {
            if (COOKIE_NAME.equals(cookie.getName()) && cookie.getValue() != null
                    && !cookie.getValue().isBlank()) {
                return cookie.getValue();
            }
        }
        return null;
    }

    /**
     * The three reads above, each of which can veto. Package-visible so the session endpoints use the
     * same path a request takes rather than a parallel one that could drift.
     */
    Optional<AuthenticatedWorkspace> resolve(String presented) {
        var found = sessions.findByTokenHash(SessionTokens.store(presented));
        if (found.isEmpty()) {
            return Optional.empty();
        }
        var session = found.get();
        if (session.revokedAt() != null) {
            detectReuse(session);
            return Optional.empty();
        }
        if (!sessions.isLive(session.id())) {
            return Optional.empty();
        }
        var membership = identities.membership(session.workspaceId(), session.userId());
        if (membership.isEmpty()) {
            return Optional.empty();
        }
        var user = identities.findUserById(session.userId());
        if (user.isEmpty() || user.get().status() != UserStatus.ACTIVE) {
            return Optional.empty();
        }
        sessions.markUsed(session.id());
        return Optional.of(new AuthenticatedWorkspace(session.id(), session.userId(),
                session.workspaceId(), membership.get().role()));
    }

    /**
     * A credential that has already been rotated away is being presented a second time.
     *
     * <p>Checked here, where any request can meet it, and not only in the refresh endpoint — a copy of
     * a token is useful to its holder on every route, and a theft noticed only when the real user
     * happened to renew is a theft noticed late. The reason matters: a row revoked because someone
     * logged out has no live sibling to protect, while a row revoked by rotation means one exists and
     * is currently being used by somebody. Both are ended.
     */
    private void detectReuse(ai.finalagent.identity.domain.Identity.Session session) {
        if (!"ROTATED".equals(session.revokeReason())) {
            return;
        }
        int ended = sessions.revokeFamily(session.familyId(), "TOKEN_REUSE");
        log.warn("a rotated session was presented again; {} live session(s) in that family ended",
                ended);
    }
}
