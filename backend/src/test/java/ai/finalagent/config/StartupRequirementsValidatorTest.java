package ai.finalagent.config;

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
        return new FinalAgentProperties.Execution(false, "", 500, 4, 4, 8, 100, 300, 30, 3, 1, 120, 240_000);
    }

    private static FinalAgentProperties properties(String aiServiceKey, String dbPassword,
                                                   String dbUser, String aiBaseUrl,
                                                   List<String> origins) {
        return new FinalAgentProperties(
                new FinalAgentProperties.Cors(origins),
                new FinalAgentProperties.Database("127.0.0.1", 3306, "finalagent_dev", dbUser, dbPassword),
                new FinalAgentProperties.AiService(aiBaseUrl, aiServiceKey, 3000),
                disabledExecution());
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
                badPort.aiService(), disabledExecution());

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(withBadPort))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("MYSQL_PORT");

        FinalAgentProperties withBadTimeout = new FinalAgentProperties(
                badPort.cors(), badPort.database(),
                new FinalAgentProperties.AiService("http://127.0.0.1:8000",
                        badPort.aiService().apiKey(), 10),
                disabledExecution());

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
                base.aiService(), disabledExecution())))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("MYSQL_HOST");

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(new FinalAgentProperties(
                base.cors(),
                new FinalAgentProperties.Database("127.0.0.1", 3306, "", "finalagent",
                        "a-real-database-password"),
                base.aiService(), disabledExecution())))
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
        return new FinalAgentProperties(base.cors(), base.database(), base.aiService(), execution);
    }

    private static FinalAgentProperties.Execution execution(String workspaceId, int pollInterval,
                                                            int batch, int core, int max, int queue,
                                                            int lease, int heartbeat, int attempts,
                                                            double backoffBase, double backoffMax,
                                                            int stepTimeout) {
        return new FinalAgentProperties.Execution(true, workspaceId, pollInterval, batch, core, max,
                queue, lease, heartbeat, attempts, backoffBase, backoffMax, stepTimeout);
    }

    private static final String WORKSPACE = "00000000-0000-0000-0000-000000000ff1";

    /**
     * The combination the shipped defaults use: a 4-minute step budget inside a 5-minute lease.
     * The two numbers are not independent, and an earlier default paired a 240s step with a 90s
     * lease, which this class rightly refused.
     */
    private static FinalAgentProperties.Execution sound() {
        return execution(WORKSPACE, 500, 4, 4, 8, 100, 300, 30, 3, 1, 120, 240_000);
    }

    @Test
    void acceptsAConfiguredQueue() {
        assertThatCode(() -> StartupRequirementsValidator.validate(withExecution(sound())))
                .doesNotThrowAnyException();
    }

    @Test
    void anEnabledQueueWithNoWorkspaceIdIsRefused() {
        // Not "default to some workspace": a run whose tenant is guessed is the tenancy bug this
        // project was rebuilt to remove.
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution("", 500, 4, 4, 8, 100, 300, 30, 3, 1, 120, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("FINALAGENT_WORKSPACE_ID");
    }

    @Test
    void aStepTimeoutThatOutlivesItsOwnLeaseIsRefusedBeforeItCanDuplicateWork() {
        // Lease 30s, step 60s: the step is still running when another worker legitimately claims it,
        // and two workers then produce two answers for one step.
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(WORKSPACE, 500, 4, 4, 8, 100, 30, 10, 3, 1, 120, 60_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_STEP_TIMEOUT_MS must be shorter than");
    }

    @Test
    void aHeartbeatThatIsNotShorterThanTheLeaseRenewsNothing() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(WORKSPACE, 500, 4, 4, 8, 100, 30, 30, 3, 1, 120, 20_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_HEARTBEAT_SECONDS");

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(WORKSPACE, 500, 4, 4, 8, 100, 30, 2, 3, 1, 120, 20_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_HEARTBEAT_SECONDS");
    }

    @Test
    void aPollIntervalFastEnoughToScanTheTableEveryFewMillisecondsIsRefused() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(WORKSPACE, 20, 4, 4, 8, 100, 300, 30, 3, 1, 120, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_POLL_INTERVAL_MS");
    }

    @Test
    void thePoolIsBoundedAndTheMaxCannotBeSmallerThanTheCore() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(WORKSPACE, 500, 4, 8, 4, 100, 90, 30, 3, 1, 120, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_MAX_POOL_SIZE");

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(WORKSPACE, 500, 4, 4, 200, 100, 90, 30, 3, 1, 120, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_MAX_POOL_SIZE");
    }

    @Test
    void anUnboundedRetryBudgetOrAnInvertedBackoffIsRefused() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(WORKSPACE, 500, 4, 4, 8, 100, 300, 30, 0, 1, 120, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_MAX_ATTEMPTS");

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(WORKSPACE, 500, 4, 4, 8, 100, 300, 30, 3, 120, 1, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_BACKOFF_MAX_SECONDS");
    }

    @Test
    void aBatchSizeOfZeroWouldClaimNothingAndOneHundredWouldClaimEverything() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution(WORKSPACE, 500, 0, 4, 8, 100, 300, 30, 3, 1, 120, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("WORKFLOW_BATCH_SIZE");
    }

    @Test
    void everyQueueProblemIsReportedAtOnceNotOnePerRestart() {
        assertThatThrownBy(() -> StartupRequirementsValidator.validate(
                withExecution(execution("", 20, 0, 8, 4, 100, 90, 30, 99, 1, 120, 240_000))))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("FINALAGENT_WORKSPACE_ID")
                .hasMessageContaining("WORKFLOW_POLL_INTERVAL_MS")
                .hasMessageContaining("WORKFLOW_BATCH_SIZE")
                .hasMessageContaining("WORKFLOW_MAX_ATTEMPTS");
    }

    @Test
    void aDisabledQueueIsNotHeldToTheBoundsNothingReads() {
        assertThatCode(() -> StartupRequirementsValidator.validate(
                withExecution(new FinalAgentProperties.Execution(false, "", 20, 0, 8, 4, 100, 90,
                        30, 99, 1, 120, 240_000))))
                .doesNotThrowAnyException();
    }
}
