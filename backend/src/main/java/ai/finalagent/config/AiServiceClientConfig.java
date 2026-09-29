package ai.finalagent.config;

import java.time.Duration;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * The single Spring-to-Python seam. Every call carries X-API-Key; the key is never a URL query
 * parameter, so it cannot leak into access logs.
 */
@Configuration
public class AiServiceClientConfig {

    @Bean
    RestClient aiServiceRestClient(FinalAgentProperties properties) {
        FinalAgentProperties.AiService aiService = properties.aiService();

        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(Duration.ofMillis(aiService.timeoutMs()));
        requestFactory.setReadTimeout(Duration.ofMillis(aiService.timeoutMs()));

        return RestClient.builder()
                .baseUrl(aiService.baseUrl())
                .requestFactory(requestFactory)
                .defaultHeader("X-API-Key", aiService.apiKey())
                .defaultHeader("Accept", "application/json")
                .build();
    }
}
