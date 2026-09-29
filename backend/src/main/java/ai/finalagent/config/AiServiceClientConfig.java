package ai.finalagent.config;

import java.time.Duration;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * The single Spring-to-Python seam. Every call carries X-API-Key; the key is never a URL query
 * parameter, so it cannot leak into access logs.
 *
 * <p>Two clients, because the calls have opposite shapes. Requirement analysis is a single
 * structured completion that should fail fast if the boundary is broken; a research run is
 * searches, scrapes and possibly browser sessions bounded by the plan's step timeout, so it needs
 * the longer socket patience and the shorter one keeps everywhere else. Sharing one timeout would
 * mean either cancelling real collection or letting a dead boundary hang a request thread.
 */
@Configuration
public class AiServiceClientConfig {

    @Bean
    RestClient aiServiceRestClient(FinalAgentProperties properties) {
        return build(properties, Duration.ofMillis(properties.aiService().timeoutMs()));
    }

    /** Used only by the workflow executor for {@code POST /ai/v1/research}. */
    @Bean
    RestClient researchRestClient(FinalAgentProperties properties) {
        int stepTimeoutMs = properties.execution().stepTimeoutMs();
        // A small margin over the step timeout, so the executor's own timeout is what normally
        // decides a step is over — not the socket dropping the call first and losing the reason.
        return build(properties, Duration.ofMillis(Math.min(300_000, stepTimeoutMs + 5_000L)));
    }

    private static RestClient build(FinalAgentProperties properties, Duration readTimeout) {
        FinalAgentProperties.AiService aiService = properties.aiService();

        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(Duration.ofMillis(aiService.timeoutMs()));
        requestFactory.setReadTimeout(readTimeout);

        return RestClient.builder()
                .baseUrl(aiService.baseUrl())
                .requestFactory(requestFactory)
                .defaultHeader("X-API-Key", aiService.apiKey())
                .defaultHeader("Accept", "application/json")
                .build();
    }
}
