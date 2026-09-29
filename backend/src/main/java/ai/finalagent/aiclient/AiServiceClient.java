package ai.finalagent.aiclient;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import ai.finalagent.aiclient.dto.AiServiceHealth;
import ai.finalagent.aiclient.dto.ResearchRequest;
import ai.finalagent.aiclient.dto.ResearchResult;
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

    /**
     * Runs the research graph. Non-2xx responses are re-thrown with the AI service's own
     * error code where it supplied one, so a 422 from schema validation does not become an
     * opaque 500 at this boundary.
     */
    public ResearchResult research(ResearchRequest request) {
        try {
            return restClient.post()
                    .uri("/ai/v1/research")
                    .body(request)
                    .retrieve()
                    .body(ResearchResult.class);
        } catch (RestClientResponseException e) {
            throw new AiServiceException(e.getStatusCode().value(), e.getMessage(), e);
        }
    }

    /** The AI service answered, but with an error status. */
    public static class AiServiceException extends RuntimeException {
        private final int upstreamStatus;

        public AiServiceException(int upstreamStatus, String message, Throwable cause) {
            super(message, cause);
            this.upstreamStatus = upstreamStatus;
        }

        public int upstreamStatus() {
            return upstreamStatus;
        }
    }
}
