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
        @NotNull Export export,
        @NotNull Auth auth
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
     *
     * <p>There is no workspace here, deliberately. A configured tenant is the placeholder this
     * project's audit named as the thing that "must not survive into a shared deployment"
     * ({@code 00-FORENSIC-AUDIT.md} §5 item 2): with one it is either a single-tenant lie or a
     * default that silently decides who a request belongs to. The tenant comes from the
     * authenticated session, and the queue carries it on every job row it already had.
     */
    public record Execution(
            boolean enabled,
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

    /**
     * Sessions and passwords.
     *
     * <p>No secret is bound here, which is the point: sessions are opaque random values compared by
     * their SHA-256 in MySQL, so there is no signing key for the frontend to be given by mistake. The
     * audit's requirement that the browser never receive a JWT secret
     * ({@code 00-FORENSIC-AUDIT.md} §5 item 2) cannot be broken by a future edit against a scheme that
     * has none.
     *
     * @param accessTokenTtlMinutes how long a presented session survives without a refresh
     * @param refreshTtlDays how long a session may be renewed for
     * @param absoluteTtlDays the ceiling renewal cannot pass, so a stolen refresh token buys time
     *                        forever in the scheme this replaces but expires here regardless
     * @param cookieSecure the {@code Secure} flag. Off by default because the stack runs on http
     *                     locally, and a deployment that terminates TLS must turn it on — a session
     *                     cookie sent over plain http is the credential
     * @param maxFailedLogins attempts before an account is locked
     * @param lockoutMinutes how long that lock holds, measured on the database clock
     */
    public record Auth(
            int accessTokenTtlMinutes,
            int refreshTtlDays,
            int absoluteTtlDays,
            boolean cookieSecure,
            int maxFailedLogins,
            int lockoutMinutes
    ) {
    }
}
