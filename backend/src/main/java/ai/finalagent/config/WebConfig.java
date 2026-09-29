package ai.finalagent.config;

import java.util.List;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import ai.finalagent.config.FinalAgentProperties.Cors;

/**
 * CORS is driven only by FRONTEND_ORIGIN. The browser normally reaches this service through the
 * Next.js same-origin rewrite, so CORS is a server-to-browser fallback path, not the main one —
 * and it is still never a wildcard.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private static final List<String> PROTECTED_PATHS = List.of("/api/**", "/health", "/ready");

    private final Cors cors;

    public WebConfig(FinalAgentProperties properties) {
        this.cors = properties.cors();
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        String[] origins = cors.allowedOrigins().toArray(String[]::new);
        for (String path : PROTECTED_PATHS) {
            registry.addMapping(path)
                    .allowedOrigins(origins)
                    .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                    .allowedHeaders("Authorization", "Content-Type", "X-Workspace-Id", "Last-Event-ID")
                    .exposedHeaders("Retry-After", "X-Request-Id")
                    .allowCredentials(true)
                    .maxAge(3600);
        }
    }
}
