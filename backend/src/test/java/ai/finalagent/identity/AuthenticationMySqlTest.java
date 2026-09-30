package ai.finalagent.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockCookie;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import ai.finalagent.config.FinalAgentProperties;
import ai.finalagent.dataset.domain.DatasetDraft;
import ai.finalagent.dataset.repository.DatasetRepository;
import ai.finalagent.identity.domain.Identity.WorkspaceRole;
import ai.finalagent.identity.security.SessionCookieFilter;
import ai.finalagent.identity.security.SessionTokens;
import ai.finalagent.support.TestPrincipal;
import ai.finalagent.workflow.domain.Records.Workflow;
import ai.finalagent.workflow.service.WorkflowService;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Authentication and tenancy, against real MySQL.
 *
 * <p>This is the phase's test, and it is deliberately the only suite that signs in for real. The other
 * MockMvc suites bind a principal directly — they are about datasets, exports and the queue, and
 * making every one of them create a session would spread one mechanism across seven files. Here the
 * credential comes back from the server as a cookie and is presented again, because that round trip is
 * what the audit says the previous project got wrong: a token in a JSON body, a demo account that
 * could log in, and a workspace id a caller could simply name
 * ({@code docs/audit/00-FORENSIC-AUDIT.md} §5 items 1 and 2).
 *
 * <p>Four claims are only worth making if a database proves them, and all four are asserted below: that
 * a refused login refuses the same way whatever the reason; that a rotated token cannot come back
 * quietly; that the credential never appears in a body; and that two tenants created through the same
 * endpoint seconds apart cannot see each other's rows — the property the configured
 * {@code FINALAGENT_WORKSPACE_ID} was standing in for until now.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("mysql")
@EnabledIfEnvironmentVariable(named = "FINALAGENT_TEST_MYSQL", matches = "true")
class AuthenticationMySqlTest {

    private static final String PASSWORD = "a-sufficiently-long-test-password";
    /** The service actor {@code V5} seeds so pre-authentication rows have something to point at. */
    private static final String SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private DatasetRepository datasets;
    @Autowired
    private WorkflowService workflowService;
    @Autowired
    private FinalAgentProperties properties;

    private final ObjectMapper mapper = new ObjectMapper();
    /** Every tenant this test created, so the next one starts from nothing. */
    private final List<String> created = new ArrayList<>();

    @BeforeEach
    void startFromNothing() {
        created.clear();
        emptyIdentityTables();
    }

    @AfterEach
    void leaveNothingBehind() {
        created.forEach(this::deleteTenant);
        emptyIdentityTables();
    }

    // ------------------------------------------------------ registration and its consequences

    @Test
    void registrationCreatesThePersonTheirWorkspaceAndASessionThatActuallyWorks() throws Exception {
        Session session = register();

        mockMvc.perform(get("/api/v1/auth/me").cookie(session.cookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email").value(session.email()))
                .andExpect(jsonPath("$.workspace.role").value(WorkspaceRole.OWNER.name()))
                .andExpect(jsonPath("$.workspace.canWrite").value(true))
                .andExpect(jsonPath("$.workspace.isOwner").value(true));

        // The three rows registration promises, counted rather than assumed.
        assertThat(count("users", "id = ?", session.userId())).isEqualTo(1);
        assertThat(count("workspaces", "id = ?", session.workspaceId())).isEqualTo(1);
        assertThat(count("workspace_members", "workspace_id = ? AND role = 'OWNER'",
                session.workspaceId())).isEqualTo(1);
    }

    /**
     * A workflow created seconds after registration is invisible to a second account by id, not merely
     * absent from a list: the endpoint refuses to confirm the id exists anywhere else, which is the
     * leak the audit's §5 item 1 describes.
     */
    @Test
    void twoAccountsCreatedTheSameWayCannotSeeEachOthersWork() throws Exception {
        Session owner = register();
        Session stranger = register();

        Workflow theirs = as(owner, () -> workflowService.create("first to ask",
                "list podcast episodes about sailing"));
        Workflow mine = as(stranger, () -> workflowService.create("second to ask",
                "list youtube channels about robotics"));

        mockMvc.perform(get("/api/v1/workflows").cookie(stranger.cookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.workflows[0].id").value(mine.id()));

        mockMvc.perform(get("/api/v1/workflows/" + theirs.id() + "/runs").cookie(stranger.cookie()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("WORKFLOW_NOT_FOUND"));
        // …and the owner still sees their own, so the refusal above is about tenancy and not about a
        // broken endpoint.
        mockMvc.perform(get("/api/v1/workflows").cookie(owner.cookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.workflows[0].id").value(theirs.id()));
    }

    @Test
    void aDatasetWrittenUnderOneTenantIsUnreadableAndUnexportableFromAnother() throws Exception {
        Session owner = register();
        Session stranger = register();
        String datasetId = as(owner, this::saveDataset);

        for (String path : List.of("/api/v1/datasets/" + datasetId,
                "/api/v1/datasets/" + datasetId + "/rows",
                "/api/v1/datasets/" + datasetId + "/evidence",
                "/api/v1/datasets/" + datasetId + "/schema")) {
            mockMvc.perform(get(path).cookie(stranger.cookie())).andExpect(status().isNotFound());
        }

        mockMvc.perform(post("/api/v1/datasets/" + datasetId + "/exports").header("X-Requested-With", "XMLHttpRequest")
                        .cookie(stranger.cookie()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"format\":\"CSV\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("EXPORT_NOT_FOUND"));
        // Refused before a row existed: a stranger cannot make the owner's dataset bigger.
        assertThat(count("export_jobs", "workspace_id = ?", stranger.workspaceId())).isZero();

        mockMvc.perform(post("/api/v1/datasets/" + datasetId + "/exports").header("X-Requested-With", "XMLHttpRequest")
                        .cookie(owner.cookie()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"format\":\"CSV\"}"))
                .andExpect(status().isAccepted());
    }

    /**
     * The signed-in person is who the rows say they are.
     *
     * <p>{@code requested_by_id} and {@code created_by_id} were written as
     * {@code Principals.UNAUTHENTICATED} for three phases — an honest null, but a null. They name the
     * account now, which is what makes an activity feed mean anything.
     */
    @Test
    void theRowsAnAuthenticatedRequestWritesNameThePersonWhoAsked() throws Exception {
        Session session = register();
        Workflow workflow = as(session, () -> workflowService.create("attributed",
                "list sponsorship opportunities in gaming podcasts"));

        assertThat(workflow.createdById()).isEqualTo(session.userId());
        assertThat(count("activity_events", "action = 'workflow.created' AND actor_id = ?",
                session.userId())).isEqualTo(1);
        assertThat(count("activity_events", "actor_id = ?", SYSTEM_ACTOR)).isZero();
    }

    // ------------------------------------------------------------------ the credential itself

    /**
     * The cookie is the credential; the body is not.
     *
     * <p>Asserted on the raw response, because the requirement is about what leaves the process. The
     * value appears exactly once — in {@code Set-Cookie} — with {@code HttpOnly} (script cannot read
     * it), {@code SameSite=Strict} (a cross-site request never carries it, which is what lets this
     * chain rely on a cookie transport at all) and a {@code Max-Age} outliving the access window, so
     * there is something left to renew with.
     */
    @Test
    void theSessionValueLeavesTheProcessOnlyAsAnHttpOnlyCookie() throws Exception {
        MockHttpServletResponse response = mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(credentials(newEmail(), PASSWORD)))
                .andExpect(status().isCreated()).andReturn().getResponse();

        String setCookie = response.getHeader("Set-Cookie");
        assertThat(setCookie).contains(SessionCookieFilter.COOKIE_NAME + "=")
                .contains("HttpOnly").contains("SameSite=Strict").contains("Path=/")
                .contains("Max-Age=");

        String token = tokenFrom(setCookie);
        track(response);
        assertThat(response.getContentAsString()).doesNotContain(token);
        // What the database holds is the digest of that value, never the value: a readable column
        // would turn one leaked backup into every live session.
        assertThat(count("auth_sessions", "token_hash = ?", SessionTokens.store(token))).isEqualTo(1);
        assertThat(count("auth_sessions", "token_hash = ?", token)).isZero();
    }

    @Test
    void aRefreshRotatesTheCredentialAndAnOldTokenComingBackEndsTheWholeFamily() throws Exception {
        Session session = register();

        MockHttpServletResponse refreshed = mockMvc.perform(post("/api/v1/auth/refresh")
                        .header("X-Requested-With", "XMLHttpRequest").cookie(session.cookie()))
                .andExpect(status().isOk()).andReturn().getResponse();
        String replacement = tokenFrom(refreshed.getHeader("Set-Cookie"));
        track(refreshed);
        assertThat(replacement).isNotEqualTo(session.token());

        mockMvc.perform(get("/api/v1/auth/me").cookie(new MockCookie(
                SessionCookieFilter.COOKIE_NAME, replacement))).andExpect(status().isOk());

        // The rotated-away token comes back — a copy, or a client that kept an old jar — and the
        // family ends. Calling that merely expired would let a stolen token stay usable for as long as
        // its holder refreshed faster than the real person noticed.
        mockMvc.perform(get("/api/v1/auth/me").cookie(session.cookie()))
                .andExpect(status().isUnauthorized());
        // Scoped to this family. A count over the whole table would be a measurement of every other
        // test in the run, and a suite that only passes when it is the only one running proves nothing.
        assertThat(count("auth_sessions", "family_id = ? AND revoke_reason = 'TOKEN_REUSE'",
                familyOf(session))).isPositive();
        assertThat(count("auth_sessions", "family_id = ? AND revoked_at IS NULL",
                familyOf(session))).isZero();
    }

    private String familyOf(Session session) {
        return jdbc.queryForObject("SELECT family_id FROM auth_sessions WHERE token_hash = ?",
                String.class, SessionTokens.store(session.token()));
    }

    /**
     * The short window and the ceiling do different jobs.
     *
     * <p>Past the access window a session can still be renewed, because otherwise anyone who leaves a
     * tab idle is signed out. Past the ceiling it cannot, and that has to remain true after any number
     * of rotations — which is the only reason an absolute deadline exists.
     */
    @Test
    void anExpiredWindowStillRenewsButAPastCeilingNeverDoes() throws Exception {
        Session session = register();

        jdbc.update("UPDATE auth_sessions SET expires_at = TIMESTAMPADD(MINUTE, -5, NOW(6))"
                + " WHERE token_hash = ?", SessionTokens.store(session.token()));
        String renewed = tokenFrom(mockMvc.perform(post("/api/v1/auth/refresh").header("X-Requested-With", "XMLHttpRequest")
                        .cookie(session.cookie())).andExpect(status().isOk()).andReturn()
                .getResponse().getHeader("Set-Cookie"));
        created.add(session.workspaceId());

        jdbc.update("UPDATE auth_sessions SET absolute_expires_at = TIMESTAMPADD(DAY, -1, NOW(6))"
                + " WHERE user_id = ?", session.userId());
        mockMvc.perform(post("/api/v1/auth/refresh").header("X-Requested-With", "XMLHttpRequest")
                        .cookie(new MockCookie(SessionCookieFilter.COOKIE_NAME, renewed)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("SESSION_NOT_RENEWABLE"));
    }

    @Test
    void logoutEndsOneSessionAndLeavesTheSamePersonsOtherDeviceAlone() throws Exception {
        String email = newEmail();
        Session laptop = register(email);
        Session phone = new Session(laptop.userId(), laptop.workspaceId(), email,
                tokenFrom(login(email, PASSWORD).getHeader("Set-Cookie")));

        mockMvc.perform(post("/api/v1/auth/logout").header("X-Requested-With", "XMLHttpRequest").cookie(laptop.cookie()))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/auth/me").cookie(laptop.cookie()))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/auth/me").cookie(phone.cookie()))
                .andExpect(status().isOk());
    }

    // ------------------------------------------------------------------ refusals

    /**
     * Five different reasons, one answer.
     *
     * <p>Unknown address, wrong password, a locked row, a disabled row and the seeded service actor all
     * return the same code in the same sentence. Registration has to disclose whether an address is
     * taken — that is what a sign-up form is for — so login refusing to disclose anything is the
     * asymmetry worth testing rather than asserting in a comment.
     */
    @Test
    void everyRefusalOfACredentialLooksExactlyLikeEveryOther() throws Exception {
        Session existing = register();
        List<String> refusals = new ArrayList<>();
        refusals.add(body(login(newEmail(), PASSWORD)));
        refusals.add(body(login(existing.email(), "the-wrong-password-entirely")));
        for (int attempt = 0; attempt <= properties.auth().maxFailedLogins(); attempt++) {
            refusals.add(body(login(existing.email(), "wrong-attempt-" + attempt + "-in-a-row")));
        }
        jdbc.update("UPDATE users SET status = 'DISABLED' WHERE id = ?", existing.userId());
        refusals.add(body(login(existing.email(), PASSWORD)));
        // The seeded service actor has no hash to match, so it is refused the same way. This is the
        // difference between "no human did this" and the backdoor the old project shipped as
        // `demo@pirateagent.ai`.
        refusals.add(body(login("service-system@invalid.invalid", "anything-at-all-1234")));

        for (String refusal : refusals) {
            assertThat(refusal).contains("INVALID_CREDENTIALS");
            assertThat(refusal).doesNotContain("locked").doesNotContain("disabled")
                    .doesNotContain("unknown").doesNotContain("does not exist");
        }
        assertThat(count("users", "id = ? AND password_hash IS NULL", SYSTEM_ACTOR)).isEqualTo(1);
    }

    @Test
    void theLockoutIsDataAndTheRightPasswordDoesNotBeatIt() throws Exception {
        Session session = register();
        for (int attempt = 0; attempt < properties.auth().maxFailedLogins(); attempt++) {
            login(session.email(), "wrong-password-" + attempt + "-in-a-row");
        }

        // The lock is a column on the database clock, not a counter in this process: a restart must not
        // reset it, and two nodes must share one budget.
        assertThat(jdbc.queryForObject("SELECT (locked_until IS NOT NULL AND locked_until > NOW(6))"
                        + " FROM users WHERE id = ?", Boolean.class, session.userId()))
                .as("the account should be locked after %s failed attempt(s)",
                        properties.auth().maxFailedLogins())
                .isTrue();
        assertThat(login(session.email(), PASSWORD).getStatus()).isEqualTo(401);
        // The session that exists is the one registration handed out. A lockout that refused the
        // password while still minting a credential would be a lockout in name only.
        assertThat(count("auth_sessions", "user_id = ? AND revoked_at IS NULL", session.userId()))
                .as("a locked account must not be handed a new session").isEqualTo(1);

        jdbc.update("UPDATE users SET locked_until = TIMESTAMPADD(SECOND, -1, NOW(6)) WHERE id = ?",
                session.userId());
        assertThat(login(session.email(), PASSWORD).getStatus()).isEqualTo(200);
        assertThat(count("users", "id = ? AND failed_logins = 0", session.userId())).isEqualTo(1);
    }

    @Test
    void aDuplicateAddressLeavesNoPartialAccountAndNoOrphanWorkspace() throws Exception {
        Session session = register();

        mockMvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(credentials(session.email(), PASSWORD)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EMAIL_TAKEN"));

        assertThat(count("users", "email = ?", session.email())).isEqualTo(1);
        // One person, one personal workspace. A rollback that left the tenant row behind would hand
        // this address a membership pointing at a workspace nobody owns.
        assertThat(count("workspaces", "created_by_id = ?", session.userId())).isEqualTo(1);
    }

    @Test
    void aShortPasswordOrAMalformedAddressNamesTheFieldAndEchoesNoValue() throws Exception {
        Map<String, String> passwordCases = Map.of("short", "PASSWORD_TOO_SHORT",
                "x".repeat(73), "PASSWORD_TOO_LONG");
        for (Map.Entry<String, String> passwordCase : passwordCases.entrySet()) {
            MockHttpServletResponse response = mockMvc.perform(post("/api/v1/auth/register")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(credentials(newEmail(), passwordCase.getKey())))
                    .andExpect(status().isBadRequest()).andReturn().getResponse();
            assertThat(response.getContentAsString()).contains(passwordCase.getValue());
            // The 72-byte ceiling is the rule that exists because of the hash rather than the person:
            // bcrypt truncates silently past it, so a longer password would verify on a prefix and its
            // owner would never learn that the rest of it was decoration.
            assertThat(response.getContentAsString()).doesNotContain(passwordCase.getKey());
        }

        // `two@at.signs` is a perfectly good address, which is why the second case has two of them:
        // an address that parses must not be refused, or the validator is guessing at mailboxes.
        for (String address : List.of("not-an-address", "two@@at.signs", "no-domain@",
                "spaces in@test.invalid", "@no-local-part.test")) {
            mockMvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                            .content(credentials(address, PASSWORD)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("EMAIL_INVALID"));
        }
        assertThat(count("users", "email LIKE 'not-an%' OR email = 'two@@at.signs'")).isZero();
    }

    // ------------------------------------------------------------- the boundary of the API

    @Test
    void everyDataEndpointRefusesAnAnonymousCallAndEveryProbeStillAnswers() throws Exception {
        for (String path : List.of("/api/v1/workflows", "/api/v1/datasets", "/api/v1/exports",
                "/api/v1/activity", "/api/v1/monitoring", "/api/v1/workflows/runs")) {
            mockMvc.perform(get(path)).andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.error.code").value("AUTHENTICATION_REQUIRED"));
        }

        // Health and readiness stay open: Docker and the deploy scripts ask before anybody signs in,
        // and /ready reports components rather than data. Its status depends on whether the AI service
        // is up in this environment, so what is asserted is that the probe answered as itself — a 401
        // here would mean the probe had become something a deployment cannot call.
        for (String probe : List.of("/api/v1/ready", "/api/v1/health")) {
            int status = mockMvc.perform(get(probe)).andReturn().getResponse().getStatus();
            assertThat(status).as(probe + " must answer without a session").isNotEqualTo(401);
            assertThat(status).isIn(200, 503);
        }
    }

    /**
     * A VIEWER reads everything and starts nothing.
     *
     * <p>The role ladder is only worth having if the difference between the rungs is visible at the
     * boundary. Creating a run spends Firecrawl credits and Gemini quota and requesting an export
     * spends a worker and a disk write, so both need EDITOR — and the row count after the refusal is
     * the assertion that a 403 did not also do the work.
     */
    @Test
    void aViewerMayReadEverythingAndStartNothing() throws Exception {
        Session owner = register();
        String watcher = UUID.randomUUID().toString();
        String watcherEmail = "watcher-" + watcher + "@test.invalid";
        jdbc.update("INSERT INTO users (id, email, display_name, password_hash, status)"
                        + " VALUES (?, ?, 'Watcher', ?, 'ACTIVE')", watcher, watcherEmail,
                new BCryptPasswordEncoder(12).encode(PASSWORD));
        jdbc.update("INSERT INTO workspace_members (workspace_id, user_id, role)"
                + " VALUES (?, ?, 'VIEWER')", owner.workspaceId(), watcher);

        MockCookie cookie = new MockCookie(SessionCookieFilter.COOKIE_NAME,
                tokenFrom(login(watcherEmail, PASSWORD).getHeader("Set-Cookie")));

        mockMvc.perform(get("/api/v1/workflows").cookie(cookie)).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/monitoring").cookie(cookie)).andExpect(status().isOk());
        mockMvc.perform(post("/api/v1/workflows").header("X-Requested-With", "XMLHttpRequest").cookie(cookie)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"prompt\":\"list the sponsorship pages of small podcasts\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("WORKSPACE_WRITE_FORBIDDEN"));
        assertThat(count("workflows", "workspace_id = ?", owner.workspaceId())).isZero();
    }

    /**
     * The audit's list of secrets, searched for in the bytes this API actually returns.
     *
     * <p>A canary rather than a name match: the values are the ones this process was given, so this
     * proves that whatever is in {@code AI_SERVICE_API_KEY} or {@code MYSQL_PASSWORD} stays on the
     * server. It cannot prove a future endpoint will not echo a new secret — only that the ones that
     * exist now are not already leaking, which is the half that is checkable.
     */
    @Test
    void noResponseBodyCarriesAConfiguredSecret() throws Exception {
        Session session = register();
        List<String> canaries = new ArrayList<>(List.of(properties.aiService().apiKey(),
                properties.database().password()));
        canaries.removeIf(value -> value == null || value.isBlank());
        assertThat(canaries).as("this test is only meaningful with real credentials in the"
                + " environment it runs under").isNotEmpty();

        for (String path : List.of("/api/v1/auth/me", "/api/v1/monitoring", "/api/v1/workflows",
                "/api/v1/exports", "/api/v1/activity", "/api/v1/datasets")) {
            String body = mockMvc.perform(get(path).cookie(session.cookie()))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            for (String canary : canaries) {
                assertThat(body).as("a response leaked a configured secret at " + path)
                        .doesNotContain(canary);
            }
        }

        String loginBody = body(login(session.email(), PASSWORD));
        for (String canary : canaries) {
            assertThat(loginBody).doesNotContain(canary);
        }
    }

    // ---------------------------------------------------------------- the constraints themselves

    /**
     * The foreign key the audit asked for by name, proved the only way that counts: by violating it.
     *
     * <p>{@code workspace_id} and {@code created_by_id} were {@code NOT NULL} with nothing behind them
     * for three phases, so a bug could write a row into a tenant that did not exist and every later
     * read would agree with it. {@code V5} made that impossible, and MySQL says so.
     */
    @Test
    void aRowPointingAtATenantThatDoesNotExistIsRefusedByTheDatabase() {
        String phantom = UUID.randomUUID().toString();
        org.assertj.core.api.Assertions.assertThatExceptionOfType(
                        org.springframework.dao.DataIntegrityViolationException.class)
                .isThrownBy(() -> jdbc.update("""
                        INSERT INTO workflows (id, workspace_id, created_by_id, name, requirement_text)
                        VALUES (?, ?, ?, 'orphan', 'this row must not be accepted')
                        """, phantom, phantom, SYSTEM_ACTOR))
                .withMessageContaining("fk_workflows_workspace");
    }

    /**
     * The machine actor resolves to a row that cannot sign in, and its address sits in a reserved TLD
     * so it can never be claimed later by someone registering it.
     */
    @Test
    void theMachineActorThatOwnsLegacyDataResolvesToARowThatCannotSignIn() {
        assertThat(count("users", "id = ? AND status = 'SERVICE' AND password_hash IS NULL",
                SYSTEM_ACTOR)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT email FROM users WHERE id = ?", String.class,
                SYSTEM_ACTOR)).endsWith("@invalid.invalid");
    }

    // ---------------------------------------------------------------------- fixtures

    private record Session(String userId, String workspaceId, String email, String token) {

        MockCookie cookie() {
            return new MockCookie(SessionCookieFilter.COOKIE_NAME, token);
        }
    }

    private Session register() throws Exception {
        return register(newEmail());
    }

    private Session register(String email) throws Exception {
        MockHttpServletResponse response = mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON).content(credentials(email, PASSWORD)))
                .andExpect(status().isCreated()).andReturn().getResponse();
        return read(email, response);
    }

    private Session read(String email, MockHttpServletResponse response) throws Exception {
        Map<?, ?> body = mapper.readValue(response.getContentAsString(), Map.class);
        Map<?, ?> user = (Map<?, ?>) body.get("user");
        Map<?, ?> workspace = (Map<?, ?>) body.get("workspace");
        Session session = new Session((String) user.get("id"), (String) workspace.get("id"), email,
                tokenFrom(response.getHeader("Set-Cookie")));
        created.add(session.workspaceId());
        return session;
    }

    private void track(MockHttpServletResponse response) throws Exception {
        if (response.getContentAsString() == null || response.getContentAsString().isEmpty()) {
            return;
        }
        Map<?, ?> body = mapper.readValue(response.getContentAsString(), Map.class);
        if (body.get("workspace") instanceof Map<?, ?> workspace && workspace.get("id") != null) {
            created.add(String.valueOf(workspace.get("id")));
        }
    }

    private static String newEmail() {
        return "auth-test-" + UUID.randomUUID() + "@test.invalid";
    }

    private String credentials(String email, String password) throws Exception {
        Map<String, String> body = new LinkedHashMap<>();
        body.put("email", email);
        body.put("password", password);
        return mapper.writeValueAsString(body);
    }

    private MockHttpServletResponse login(String email, String password) throws Exception {
        return mockMvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(credentials(email, password))).andReturn().getResponse();
    }

    private static String body(MockHttpServletResponse response) throws Exception {
        return response.getContentAsString();
    }

    private static String tokenFrom(String setCookie) {
        if (setCookie == null) {
            return null;
        }
        int equals = setCookie.indexOf('=');
        int semicolon = setCookie.indexOf(';');
        return setCookie.substring(equals + 1, semicolon < 0 ? setCookie.length() : semicolon);
    }

    /**
     * A two-row dataset under the bound principal, so the tenancy tests have something real to reach
     * for. Built through {@code DatasetDraft} the way the save step builds one, because a fixture that
     * wrote the tables by hand would not be exercising the columns the endpoints read.
     */
    private String saveDataset() {
        Workflow workflow = workflowService.create("auth fixture",
                "list youtube channels for coding");
        // The plan row is written here rather than produced by `plan()`, because planning asks the AI
        // service what the entity and its fields are — and this test is about who may read a dataset,
        // not about what the model returned.
        String planId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO workflow_plans (id, workspace_id, workflow_id, version, objective,"
                        + " requirement, extraction_schema, steps, completion_criteria, plan_hash,"
                        + " created_by_id) VALUES (?, ?, ?, 1, ?, '{}',"
                        + " '{\"type\":\"object\",\"properties\":{\"channel_name\":{\"type\":\"string\"}}}',"
                        + " '[]', '{}', ?, ?)",
                planId, workflow.workspaceId(), workflow.id(), "list youtube channels for coding",
                "auth-fixture-hash", workflow.createdById());
        String runId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO workflow_runs (id, workspace_id, workflow_id, plan_id, status,"
                        + " records_found, records_valid) VALUES (?, ?, ?, ?, 'COMPLETED', 2, 2)",
                runId, workflow.workspaceId(), workflow.id(), planId);

        DatasetDraft.Builder draft = new DatasetDraft.Builder(new DatasetDraft.Header(
                workflow.workspaceId(), runId, workflow.id(), planId, null, "list channels",
                "list youtube channels for coding", "channel", "{}", "READY", "TEST", "{}", 0.7));
        draft.column(new DatasetDraft.DraftColumn("channel_name", "Channel", "STRING", true, 0,
                "PLAN", null, 2));
        for (int index = 0; index < 2; index++) {
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("channel_name", "freeCodeCamp " + index);
            draft.row(new DatasetDraft.DraftRow(index, values, values, true, true, "SOURCE_CITED",
                    0.8, null, null, null, false, List.of(), List.of(), List.of(), List.of(),
                    List.of(), null, List.of()));
        }
        String datasetId = UUID.randomUUID().toString();
        datasets.save(datasetId, draft.build());
        return datasetId;
    }

    /** Runs {@code work} as though the given session had made the request, for the direct calls. */
    private <T> T as(Session session, Callable<T> work) throws Exception {
        try (AutoCloseable ignored = TestPrincipal.bind(TestPrincipal.as(session.workspaceId(),
                session.userId(), WorkspaceRole.OWNER))) {
            return work.call();
        }
    }

    private int count(String table, String where) {
        return count(table, where, new Object[0]);
    }

    private int count(String table, String where, Object... args) {
        Integer value = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + where,
                Integer.class, args);
        return value == null ? 0 : value;
    }

    private void emptyIdentityTables() {
        jdbc.update("DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE email"
                + " LIKE 'auth-test-%' OR email LIKE 'watcher-%')");
        jdbc.update("DELETE FROM workspace_members WHERE user_id IN (SELECT id FROM users WHERE"
                + " email LIKE 'auth-test-%' OR email LIKE 'watcher-%')");
        jdbc.update("DELETE FROM users WHERE email LIKE 'auth-test-%' OR email LIKE 'watcher-%'");
    }

    /**
     * Everything this test wrote under one tenant, in the order the foreign keys allow.
     *
     * <p>The workspace row goes last, because {@code V5} made the tenancy constraints {@code RESTRICT}:
     * a tenant that still holds data cannot be deleted, and that is the property, not an obstacle.
     */
    private void deleteTenant(String workspaceId) {
        jdbc.update("DELETE FROM export_jobs WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM dataset_row_sources WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM dataset_field_evidence WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM dataset_conflicts WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM dataset_sources WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM dataset_columns WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM dataset_rows WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM datasets WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM activity_events WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM workflow_jobs WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM workflow_steps WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM workflow_runs WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM workflow_plans WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM workflows WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM auth_sessions WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM workspace_members WHERE workspace_id = ?", workspaceId);
        jdbc.update("DELETE FROM workspaces WHERE id = ?", workspaceId);
    }
}
