package ai.finalagent.support;

import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import ai.finalagent.identity.domain.Identity.WorkspaceRole;
import ai.finalagent.identity.security.AuthenticatedWorkspace;
import ai.finalagent.workflow.support.Principals;

/**
 * The test-only way to be somebody, without going through a database session.
 *
 * <p>Two shapes, because tests reach the services two ways. A MockMvc call carries a principal
 * through the same {@code SecurityContext} the live filter would have filled; a direct service call
 * binds the context on the test thread for the duration of the block. Both use
 * {@link AuthenticatedWorkspace} — the real principal type — so nothing under test is looking at a
 * stand-in that could pass while the production object would not.
 *
 * <p>This is <b>not</b> a way to bypass authorization. It is a way to name who the request is from
 * when the test is about something other than authentication. The credential path itself — cookie,
 * rotation, revocation, membership — is exercised end to end against real MySQL in
 * {@code AuthenticationMySqlTest}, with {@link #provision} rows and real sessions rather than a bound
 * context.
 */
public final class TestPrincipal {

    /** The tenant and actor the non-auth suites default to, matching the MySQL fixtures' convention. */
    public static final String WORKSPACE = "00000000-0000-0000-0000-000000000ff1";
    public static final String EDITOR_USER = "00000000-0000-0000-0000-000000000000";

    private TestPrincipal() {
    }

    public static AuthenticatedWorkspace as(String workspaceId, String userId, WorkspaceRole role) {
        return new AuthenticatedWorkspace("test-session", userId, workspaceId, role);
    }

    /** A MockMvc post-processor: {@code mockMvc.perform(get(...).with(principal(ws, user, OWNER)))}. */
    public static RequestPostProcessor principal(AuthenticatedWorkspace workspace) {
        return SecurityMockMvcRequestPostProcessors.authentication(
                new UsernamePasswordAuthenticationToken(workspace, null, authorities(workspace)));
    }

    /** The same, with the defaults this suite's fixtures are written against. */
    public static RequestPostProcessor principal() {
        return principal(as(WORKSPACE, EDITOR_USER, WorkspaceRole.OWNER));
    }

    /**
     * The proof-of-origination every mutating endpoint requires. Named here so a test cannot invent its
     * own spelling of it and pass against a rule the frontend does not actually send — the header name
     * is read from {@code SecurityConfig}, the same constant the guard checks.
     */
    public static MockHttpServletRequestBuilder stateChange(MockHttpServletRequestBuilder request) {
        return request.header(ai.finalagent.config.SecurityConfig.STATE_CHANGE_HEADER,
                "XMLHttpRequest");
    }

    /**
     * Binds a principal for a direct service call. Close it — a context left on a pooled thread is
     * the next test's accidental tenant, and that failure looks like a data bug rather than a leak.
     */
    public static AutoCloseable bind(AuthenticatedWorkspace workspace) {
        SecurityContext previous = SecurityContextHolder.getContext();
        SecurityContext next = SecurityContextHolder.createEmptyContext();
        next.setAuthentication(new UsernamePasswordAuthenticationToken(workspace, null,
                authorities(workspace)));
        SecurityContextHolder.setContext(next);
        return () -> SecurityContextHolder.setContext(previous);
    }

    public static AutoCloseable bind() {
        return bind(as(WORKSPACE, EDITOR_USER, WorkspaceRole.OWNER));
    }

    private static List<GrantedAuthority> authorities(AuthenticatedWorkspace workspace) {
        return List.of(new SimpleGrantedAuthority("ROLE_" + workspace.role().name()));
    }

    /**
     * Makes the fixture's tenant and author real, so the Phase 12 foreign keys accept the rows a test
     * is about to insert.
     *
     * <p>Idempotent by {@code INSERT IGNORE}: suites delete their own rows between tests but the
     * tenant outlives them, and a fixture that had to clean up {@code workspaces} would be deleting a
     * row other tests in the same run are pointing at.
     */
    public static void provision(JdbcTemplate jdbc, String workspaceId, String userId) {
        jdbc.update("INSERT IGNORE INTO users (id, email, display_name, password_hash, status) "
                + "VALUES (?, ?, 'Test principal', NULL, 'SERVICE')", userId,
                "test-" + userId + "@invalid.invalid");
        jdbc.update("INSERT IGNORE INTO workspaces (id, name, kind, created_by_id) "
                + "VALUES (?, 'Test workspace', 'TEAM', ?)", workspaceId, userId);
        jdbc.update("INSERT IGNORE INTO workspace_members (workspace_id, user_id, role) "
                + "VALUES (?, ?, 'OWNER')", workspaceId, userId);
    }

    /** The machine actor, which every pre-authentication fixture row already names. */
    public static void provisionSystemActor(JdbcTemplate jdbc) {
        provision(jdbc, WORKSPACE, Principals.SYSTEM);
    }
}
