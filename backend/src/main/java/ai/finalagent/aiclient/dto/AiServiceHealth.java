package ai.finalagent.aiclient.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * Mirrors the Python service's {@code GET /ai/v1/health}. Field names are camelCase on both
 * sides because {@code ai-service/app/contracts.py} serializes aliases that way.
 *
 * <p>Credentials are reported as presence booleans only. The old project's health endpoint
 * returned {@code configured: true} while the key was empty, which is exactly the failure this
 * contract is designed to make visible.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record AiServiceHealth(
        String status,
        String service,
        String version,
        Credentials credentials
) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Credentials(
            Boolean geminiApiConfigured,
            Boolean firecrawlApiConfigured,
            Boolean inboundAuthRequired
    ) {
    }
}
