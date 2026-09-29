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
 * structured completion that should fail fast if the boundary is broken; a step call is long work
 * bounded by the plan's step timeout — a research run reaches search, scrape and possibly browser
 * sessions, and a quality run can be hundreds of records of text processing — so those two need the
 * longer socket patience and the short one keeps everywhere else. Sharing one timeout would mean
 * either cancelling real work or letting a dead boundary hang a request thread.
 */
@Configuration
public class AiServiceClientConfig {

    @Bean
    RestClient aiServiceRestClient(FinalAgentProperties properties) {
        return build(properties, Duration.ofMillis(properties.aiService().timeoutMs()));
    }

    /** The step-scoped client: {@code /ai/v1/research} and {@code /ai/v1/quality/process}. */
    @Bean
    RestClient stepRestClient(FinalAgentProperties properties) {
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
