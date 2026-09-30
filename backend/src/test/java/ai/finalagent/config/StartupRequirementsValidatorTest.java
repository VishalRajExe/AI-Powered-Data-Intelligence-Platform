package ai.finalagent.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * These are the tests that matter most in this file: they assert the inversion of the old
 * project's central defect. A missing or fake credential must stop the process, never route
 * execution to a simulated adapter.
 */
class StartupRequirementsValidatorTest {

    /** The queue, switched off: the credential and topology rules below are checked regardless. */
    static FinalAgentProperties.Execution disabledExecution() {
        return new FinalAgentProperties.Execution(false, 500, 4, 4, 8, 100, 300, 30, 3, 1, 120, 240_000);
    }

    /** The shipped defaults: none of these numbers is what a bounds test below is about. */
    static FinalAgentProperties.Export defaultExport() {
        return new FinalAgentProperties.Export("./var/exports", 500, 200_000);
    }

    static FinalAgentProperties.Auth defaultAuth() {
        return new FinalAgentProperties.Auth(15, 14, 30, false, 5, 15);
    }

    private static FinalAgentProperties properties(String aiServiceKey, String dbPassword,
                                                   String dbUser, String aiBaseUrl,
                                                   List<String> origins) {
        return new FinalAgentProperties(
                new FinalAgentProperties.Cors(origins),
                new FinalAgentProperties.Database("127.0.0.1", 3306, "finalagent_dev", dbUser, dbPassword),
                new FinalAgentProperties.AiService(aiBaseUrl, aiServiceKey, 3000),
                disabledExecution(), defaultExport(), defaultAuth());
    }

    private static FinalAgentProperties valid() {
        return properties("a-real-shared-secret-of-sufficient-length-0123456789",
                "a-real-database-password",
                "finalagent",
                "http://127.0.0.1:8000",
                List.of("http://localhost:3000"));
    }

    @Test
    void acceptsAFullyConfiguredEnvironment() {
        assertThatCode(() -> StartupRequirementsValidator.validate(valid())).doesNotThrowAnyException();
    }

    @Test
    void rejectsPlaceholderSecretsInsteadOfStartingSimulated() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                properties("REPLACE_ME", "a-real-database-password", "finalagent",
                        "http://127.0.0.1:8000", List.of("http://localhost:3000"))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("AI_SERVICE_API_KEY")
                .hasMessageContaining("placeholder");
    }

    @Test
    void rejectsShortSecrets() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                properties("short-key", "a-real-database-password", "finalagent",
                        "http://127.0.0.1:8000", List.of("http://localhost:3000"))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("AI_SERVICE_API_KEY")
                .hasMessageContaining("at least 32 characters");
    }

    @Test
    void rejectsTheInsecureComposeDefaultsTheOldProjectShipped() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                properties("a-real-shared-secret-of-sufficient-length-0123456789",
                        "insecure-default-development-only-access-secret",
                        "finalagent", "http://127.0.0.1:8000", List.of("http://localhost:3000"))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("MYSQL_PASSWORD");
    }

    @Test
    void rejectsWildcardCorsOrigin() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                properties("a-real-shared-secret-of-sufficient-length-0123456789",
                        "a-real-database-password", "finalagent",
                        "http://127.0.0.1:8000", List.of("*"))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("FRONTEND_ORIGIN");
    }

    @Test
    void rejectsCorsOriginWithAPath() {
        // The old compose set FRONTEND_ORIGIN to a Vite port while Next.js ran elsewhere, and the
        // frontend hardcoded a third origin. A malformed origin must be a startup error, not a
        // silent CORS rejection at request time.
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                properties("a-real-shared-secret-of-sufficient-length-0123456789",
                        "a-real-database-password", "finalagent",
                        "http://127.0.0.1:8000", List.of("http://localhost:3000/dashboard/"))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("FRONTEND_ORIGIN");
    }

    @Test
    void rejectsRelativeAiServiceUrl() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                properties("a-real-shared-secret-of-sufficient-length-0123456789",
                        "a-real-database-password", "finalagent",
                        "localhost:8000", List.of("http://localhost:3000"))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("AI_SERVICE_BASE_URL");
    }

    @Test
    void rejectsAnonymousDatabaseUser() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                properties("a-real-shared-secret-of-sufficient-length-0123456789",
                        "a-real-database-password", "",
                        "http://127.0.0.1:8000", List.of("http://localhost:3000"))))
                .isInstanceOf(MissingRequiredConfigurationException.class);
    }

    @Test
    void rejectsAnEmptyCorsAllowList() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                properties("a-real-shared-secret-of-sufficient-length-0123456789",
                        "a-real-database-password", "finalagent",
                        "http://127.0.0.1:8000", List.of())))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("FRONTEND_ORIGIN");
    }

    @Test
    void rejectsOutOfRangePortAndTimeout() {
        FinalAgentProperties badPort = properties("a-real-shared-secret-of-sufficient-length-0123456789",
                "a-real-database-password", "finalagent", "http://127.0.0.1:8000",
                List.of("http://localhost:3000"));
        FinalAgentProperties withBadPort = new FinalAgentProperties(
                badPort.cors(),
                new FinalAgentProperties.Database("127.0.0.1", 0, "finalagent_dev", "finalagent",
                        "a-real-database-password"),
                badPort.aiService(), disabledExecution(), defaultExport(), defaultAuth());

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(withBadPort))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("MYSQL_PORT");

        FinalAgentProperties withBadTimeout = new FinalAgentProperties(
                badPort.cors(), badPort.database(),
                new FinalAgentProperties.AiService("http://127.0.0.1:8000",
                        badPort.aiService().apiKey(), 10),
                disabledExecution(), defaultExport(), defaultAuth());

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(withBadTimeout))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("AI_SERVICE_TIMEOUT_MS");
    }

    @Test
    void rejectsBlankHostOrDatabaseName() {
        FinalAgentProperties base = valid();
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(new FinalAgentProperties(
                base.cors(),
                new FinalAgentProperties.Database("", 3306, "finalagent_dev", "finalagent",
                        "a-real-database-password"),
                base.aiService(), disabledExecution(), defaultExport(), defaultAuth())))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("MYSQL_HOST");

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(new FinalAgentProperties(
                base.cors(),
                new FinalAgentProperties.Database("127.0.0.1", 3306, "", "finalagent",
                        "a-real-database-password"),
                base.aiService(), disabledExecution(), defaultExport(), defaultAuth())))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("MYSQL_DATABASE");
    }

    @Test
    void failureMessageNamesVariablesButNeverValues() {
        String secret = "short-but-unique-canary-value";
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                properties(secret, "a-real-database-password", "finalagent",
                        "http://127.0.0.1:8000", List.of("http://localhost:3000"))))
                .hasMessageNotContaining(secret);
    }

    // ------------------------------------------------------- the workflow queue's own bounds

    private static FinalAgentProperties withExecution(FinalAgentProperties.Execution execution) {
        FinalAgentProperties base = valid();
        return new FinalAgentProperties(base.cors(), base.database(), base.aiService(), execution,
                defaultExport(), defaultAuth());
    }

    private static FinalAgentProperties withExport(FinalAgentProperties.Export export) {
        FinalAgentProperties base = valid();
        return new FinalAgentProperties(base.cors(), base.database(), base.aiService(),
                disabledExecution(), export, defaultAuth());
    }

    private static FinalAgentProperties.Execution execution(int pollInterval,
                                                            int batch, int core, int max, int queue,
                                                            int lease, int heartbeat, int attempts,
                                                            double backoffBase, double backoffMax,
                                                            int stepTimeout) {
        return new FinalAgentProperties.Execution(true, pollInterval, batch, core, max,
                queue, lease, heartbeat, attempts, backoffBase, backoffMax, stepTimeout);
    }

    private static final String WORKSPACE = "00000000-0000-0000-0000-000000000ff1";

    /**
     * The combination the shipped defaults use: a 4-minute step budget inside a 5-minute lease.
     * The two numbers are not independent, and an earlier default paired a 240s step with a 90s
     * lease, which this class rightly refused.
     */
    private static FinalAgentProperties.Execution sound() {
        return execution(500, 4, 4, 8, 100, 300, 30, 3, 1, 120, 240_000);
    }

    @Test
    void acceptsAConfiguredQueue() {
        assertThatCode(() -> StartupRequirementsValidator.validate(withExecution(sound())))
                .doesNotThrowAnyException();
    }

    /**
     * The queue has no tenant to configure, and this is the test that keeps it that way. The property
     * existed while {@code FINALAGENT_WORKSPACE_ID} did; deleting the rule along with the placeholder
     * is worth asserting structurally, because a record component added back "for compatibility" would
     * silently resurrect a single-tenant default that every service then reads.
     */
    @Test
    void theQueueConfigurationHasNoWorkspaceToDefault() {
        assertThat(java.util.Arrays.stream(FinalAgentProperties.Execution.class.getRecordComponents())
                .map(java.lang.reflect.RecordComponent::getName).toList())
                .doesNotContain("workspaceId")
                .contains("enabled", "leaseSeconds", "stepTimeoutMs");
        assertThat(java.util.Arrays.stream(FinalAgentProperties.class.getRecordComponents())
                .map(java.lang.reflect.RecordComponent::getName).toList())
                .contains("auth")
                .noneMatch(name -> name.toLowerCase().contains("jwt"));
    }

    @Test
    void aStepTimeoutThatOutlivesItsOwnLeaseIsRefusedBeforeItCanDuplicateWork() {
        // Lease 30s, step 60s: the step is still running when another worker legitimately claims it,
        // and two workers then produce two answers for one step.
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(500, 4, 4, 8, 100, 30, 10, 3, 1, 120, 60_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_STEP_TIMEOUT_MS must be shorter than");
    }

    @Test
    void aHeartbeatThatIsNotShorterThanTheLeaseRenewsNothing() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(500, 4, 4, 8, 100, 30, 30, 3, 1, 120, 20_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_HEARTBEAT_SECONDS");

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(500, 4, 4, 8, 100, 30, 2, 3, 1, 120, 20_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_HEARTBEAT_SECONDS");
    }

    @Test
    void aPollIntervalFastEnoughToScanTheTableEveryFewMillisecondsIsRefused() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(20, 4, 4, 8, 100, 300, 30, 3, 1, 120, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_POLL_INTERVAL_MS");
    }

    @Test
    void thePoolIsBoundedAndTheMaxCannotBeSmallerThanTheCore() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(500, 4, 8, 4, 100, 90, 30, 3, 1, 120, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_MAX_POOL_SIZE");

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(500, 4, 4, 200, 100, 90, 30, 3, 1, 120, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_MAX_POOL_SIZE");
    }

    @Test
    void anUnboundedRetryBudgetOrAnInvertedBackoffIsRefused() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(500, 4, 4, 8, 100, 300, 30, 0, 1, 120, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_MAX_ATTEMPTS");

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(500, 4, 4, 8, 100, 300, 30, 3, 120, 1, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_BACKOFF_MAX_SECONDS");
    }

    @Test
    void aBatchSizeOfZeroWouldClaimNothingAndOneHundredWouldClaimEverything() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(500, 0, 4, 8, 100, 300, 30, 3, 1, 120, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_BATCH_SIZE");
    }

    @Test
    void everyQueueProblemIsReportedAtOnceNotOnePerRestart() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(20, 0, 8, 4, 100, 90, 30, 99, 1, 120, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_POLL_INTERVAL_MS")
                .hasMessageContaining("WORKFLOW_BATCH_SIZE")
                .hasMessageContaining("WORKFLOW_MAX_ATTEMPTS");
    }

    @Test
    void aDisabledQueueIsNotHeldToTheBoundsNothingReads() {
        assertThatCode(() -> StartupRequirementsValidator.validate(
                withExecution(new FinalAgentProperties.Execution(false, 20, 0, 8, 4, 100, 90,
                        30, 99, 1, 120, 240_000))))
                .doesNotThrowAnyException();
    }

    // ------------------------------------------------------------- the export writer's bounds

    @Test
    void anExportDirectoryMustBeNamedBecauseARequestNeverGetsToChooseOne() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExport(new FinalAgentProperties.Export("  ", 500, 200_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("FINALAGENT_EXPORT_DIR");
    }

    @Test
    void aChunkBiggerThanTheCeilingWouldWritePastItBeforeNoticing() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExport(new FinalAgentProperties.Export("./var/exports", 5_000, 100))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("FINALAGENT_EXPORT_CHUNK_ROWS");
    }

    @Test
    void anUnboundedOrNonsensicalRowCeilingIsRefused() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExport(new FinalAgentProperties.Export("./var/exports", 500, 0))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("FINALAGENT_EXPORT_MAX_ROWS");

        assertThatCode(() -> StartupRequirementsValidator.validate(valid()))
                .doesNotThrowAnyException();
    }

    // ---------------------------------------------------------------- the session's bounds

    private static FinalAgentProperties withAuth(FinalAgentProperties.Auth auth) {
        FinalAgentProperties base = valid();
        return new FinalAgentProperties(base.cors(), base.database(), base.aiService(),
                disabledExecution(), defaultExport(), auth);
    }

    @Test
    void anAccessWindowMeasuredInHoursIsALogoutTheUserCannotSee() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withAuth(new FinalAgentProperties.Auth(600, 14, 30, false, 5, 15))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("AUTH_ACCESS_TOKEN_TTL_MINUTES");

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withAuth(new FinalAgentProperties.Auth(0, 14, 30, false, 5, 15))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("AUTH_ACCESS_TOKEN_TTL_MINUTES");
    }

    /**
     * The rule that is easiest to write backwards. Rotation moves the short window and must not move
     * the ceiling, so a ceiling already behind the renewability window enforces nothing: a session
     * would be renewed against a deadline that had passed.
     */
    @Test
    void anAbsoluteCeilingBehindTheRenewabilityWindowEnforcesNothing() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withAuth(new FinalAgentProperties.Auth(15, 30, 7, false, 5, 15))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("AUTH_ABSOLUTE_TTL_DAYS");
    }

    @Test
    void aLockoutNobodyCanTriggerOrNobodyCanEscapeIsRefused() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withAuth(new FinalAgentProperties.Auth(15, 14, 30, false, 1, 15))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("AUTH_MAX_FAILED_LOGINS");

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withAuth(new FinalAgentProperties.Auth(15, 14, 30, false, 5, 0))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("AUTH_LOCKOUT_MINUTES");
    }

    /**
     * The one assertion here about a secret that does not exist. The brief's rule was that the
     * frontend never receive a JWT secret; this build has no signing key at all, so the strongest
     * reading of that rule is structural — there is nothing in the configuration to leak, and a
     * future edit cannot add one without this test naming it.
     */
    @Test
    void thereIsNoSigningSecretForAnythingToReceive() {
        assertThat(java.util.Arrays.stream(FinalAgentProperties.class.getRecordComponents())
                .map(java.lang.reflect.RecordComponent::getName).toList())
                .contains("auth")
                .noneMatch(name -> name.toLowerCase().contains("jwt"));
        assertThat(java.util.Arrays.stream(FinalAgentProperties.Auth.class.getRecordComponents())
                .map(java.lang.reflect.RecordComponent::getName).toList())
                .noneMatch(name -> name.toLowerCase().contains("secret"));
    }
}
