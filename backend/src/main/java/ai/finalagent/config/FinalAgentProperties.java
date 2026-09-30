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
        @NotNull AiService aiService,
        @NotNull Execution execution,
        @NotNull Export export
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

    /**
     * The workflow queue. Every bound here exists because an unbounded worker is a service that
     * eventually exhausts its own connection pool: the poll loop, the worker pool and the queue
     * in front of it are each capped, and the lease is what makes a dead worker recoverable
     * instead of permanently stuck.
     */
    public record Execution(
            boolean enabled,
            String workspaceId,
            int pollIntervalMs,
            int batchSize,
            int corePoolSize,
            int maxPoolSize,
            int queueCapacity,
            int leaseSeconds,
            int heartbeatSeconds,
            int maxAttempts,
            double backoffBaseSeconds,
            double backoffMaxSeconds,
            int stepTimeoutMs
    ) {
    }

    /**
     * Export files, written by the queue rather than by the request that asked for them.
     *
     * @param dir a server-side directory. The path is never taken from a request: a client choosing
     *            where a file lands is a path-traversal bug with a nicer name
     * @param chunkRows how many rows a writer takes before it reports progress again. Small enough
     *                  that a long export advances visibly, large enough that the update is not the
     *                  most common statement in the job
     * @param maxRows the ceiling a single export may write. Over it the job fails with the count it
     *                stopped at rather than truncating into a file that looks complete
     */
    public record Export(
            String dir,
            int chunkRows,
            int maxRows
    ) {
    }
}
