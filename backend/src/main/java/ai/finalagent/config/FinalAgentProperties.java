package ai.finalagent.config;

import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.util.List;

/**
 * Every value is bound from the environment. There are no credential defaults anywhere in this
 * project.
 *
 * <p>Constraints are enforced in exactly one place, {@link StartupRequirementsValidator}, which
 * reports every problem at once and names variables rather than values. Bean Validation is used
 * only for the presence of the groups themselves: nested constraints would need {@code @Valid}
 * to cascade and would then pre-empt the validator's aggregated message, so the leaf checks live
 * in the validator and are covered by its tests.
 */
@Validated
@ConfigurationProperties(prefix = "finalagent")
public record FinalAgentProperties(
        @NotNull Cors cors,
        @NotNull Database database,
        @NotNull AiService aiService
) {

    public record Cors(List<String> allowedOrigins) {
    }

    public record Database(
            String host,
            int port,
            String name,
            String username,
            String password
    ) {
    }

    public record AiService(
            String baseUrl,
            String apiKey,
            int timeoutMs
    ) {
    }
}
