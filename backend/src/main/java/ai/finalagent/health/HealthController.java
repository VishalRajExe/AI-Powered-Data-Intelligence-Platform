package ai.finalagent.health;

import java.time.Instant;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Liveness and readiness. Both are unauthenticated by design and are the only routes outside
 * {@code /api/v1} that the browser may reach.
 *
 * <p>{@code /api/v1/health} and {@code /api/v1/ready} are the same handlers as the root paths:
 * the root forms are for container and orchestrator probes, the prefixed forms are what the
 * Next.js same-origin rewrite can actually forward.
 */
@RestController
public class HealthController {

    private final ReadinessService readinessService;
    private final Environment environment;
    private final String version;

    public HealthController(ReadinessService readinessService, Environment environment,
                            @Value("${app.version:0.1.0}") String version) {
        this.readinessService = readinessService;
        this.environment = environment;
        this.version = version;
    }

    public record HealthResponse(String status, String application, String profile,
                                 String version, String timestamp) {
    }

    public record ReadinessResponse(String status, Map<String, ComponentStatus> components,
                                    String timestamp) {
    }

    @GetMapping({"/health", "/api/v1/health"})
    public HealthResponse health() {
        String profile = environment.getActiveProfiles().length == 0
                ? "default"
                : String.join(",", environment.getActiveProfiles());
        return new HealthResponse(ComponentStatus.UP, environment.getProperty("spring.application.name"),
                profile, version, Instant.now().toString());
    }

    @GetMapping({"/ready", "/api/v1/ready"})
    public ResponseEntity<ReadinessResponse> ready() {
        ReadinessService.Report report = readinessService.evaluate();
        ReadinessResponse body = new ReadinessResponse(report.status(), report.components(),
                Instant.now().toString());
        return ResponseEntity.status(report.status().equals(ComponentStatus.UP)
                ? HttpStatus.OK
                : HttpStatus.SERVICE_UNAVAILABLE).body(body);
    }
}
