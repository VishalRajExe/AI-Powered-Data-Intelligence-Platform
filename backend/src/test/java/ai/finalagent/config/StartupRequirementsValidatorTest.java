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

    private static FinalAgentProperties properties(String aiServiceKey, String dbPassword,
                                                   String dbUser, String aiBaseUrl,
                                                   List<String> origins) {
        return new FinalAgentProperties(
                new FinalAgentProperties.Cors(origins),
                new FinalAgentProperties.Database("127.0.0.1", 3306, "finalagent_dev", dbUser, dbPassword),
                new FinalAgentProperties.AiService(aiBaseUrl, aiServiceKey, 3000));
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
                badPort.aiService());

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(withBadPort))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("MYSQL_PORT");

        FinalAgentProperties withBadTimeout = new FinalAgentProperties(
                badPort.cors(), badPort.database(),
                new FinalAgentProperties.AiService("http://127.0.0.1:8000",
                        badPort.aiService().apiKey(), 10));

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
                base.aiService())))
                .isInstanceOf(MissingRequiredConfigurationException.class)
                .hasMessageContaining("MYSQL_HOST");

        assertThatThrownBy(() -> StartupRequirementsValidator.validate(new FinalAgentProperties(
                base.cors(),
                new FinalAgentProperties.Database("127.0.0.1", 3306, "", "finalagent",
                        "a-real-database-password"),
                base.aiService())))
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
}
