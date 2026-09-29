package ai.finalagent.aiclient;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import ai.finalagent.aiclient.dto.AiServiceHealth;
import ai.finalagent.config.FinalAgentProperties;

/**
 * Typed client for the Python AI service. Phase 1 wires the seam and one call; the AI endpoints
 * themselves arrive with the requirement/planning phases.
 */
@Component
public class AiServiceClient {

    private final RestClient restClient;
    private final String baseUrl;

    public AiServiceClient(RestClient aiServiceRestClient, FinalAgentProperties properties) {
        this.restClient = aiServiceRestClient;
        this.baseUrl = properties.aiService().baseUrl();
    }

    public String baseUrl() {
        return baseUrl;
    }

    public AiServiceHealth health() {
        return restClient.get()
                .uri("/ai/v1/health")
                .retrieve()
                .body(AiServiceHealth.class);
    }
}
