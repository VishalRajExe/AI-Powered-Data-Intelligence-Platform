package ai.finalagent.health;

import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import ai.finalagent.aiclient.AiServiceClient;
import ai.finalagent.aiclient.dto.AiServiceHealth;
import ai.finalagent.config.FinalAgentProperties;

/**
 * Reports the truth about dependencies. Never degrades to a synthetic "UP": an unreachable
 * MySQL or AI service is reported DOWN with the reason, and {@code /ready} answers 503.
 */
@Service
public class ReadinessService {

    private static final Logger log = LoggerFactory.getLogger(ReadinessService.class);

    private final JdbcTemplate jdbcTemplate;
    private final AiServiceClient aiServiceClient;
    private final FinalAgentProperties properties;

    public ReadinessService(JdbcTemplate jdbcTemplate, AiServiceClient aiServiceClient,
                            FinalAgentProperties properties) {
        this.jdbcTemplate = jdbcTemplate;
        this.aiServiceClient = aiServiceClient;
        this.properties = properties;
    }

    public record Report(String status, Map<String, ComponentStatus> components) {
    }

    public Report evaluate() {
        Map<String, ComponentStatus> components = new LinkedHashMap<>();
        components.put("mysql", checkMysql());
        components.put("aiService", checkAiService());
        components.put("credentials", checkCredentials());

        boolean allUp = components.values().stream().allMatch(ComponentStatus::isUp);
        return new Report(allUp ? ComponentStatus.UP : ComponentStatus.DOWN, components);
    }

    private ComponentStatus checkMysql() {
        FinalAgentProperties.Database db = properties.database();
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("database", db.name());
        details.put("host", db.host() + ":" + db.port());

        long started = System.nanoTime();
        try {
            Integer one = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            if (one == null || one != 1) {
                return ComponentStatus.down(withError(details, "Unexpected response to SELECT 1", "ProtocolError"));
            }
            details.put("latencyMs", (System.nanoTime() - started) / 1_000_000);
            return ComponentStatus.up(details);
        } catch (DataAccessException e) {
            // Log the chain server-side; expose only the type. A JDBC failure message can embed
            // the connection URL, and that must not reach an HTTP response body.
            log.warn("MySQL readiness check failed: {}", e.toString());
            return ComponentStatus.down(withError(details, "Database not reachable",
                    e.getRootCause() == null ? e.getClass().getSimpleName() : e.getRootCause().getClass().getSimpleName()));
        }
    }

    private ComponentStatus checkAiService() {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("baseUrl", aiServiceClient.baseUrl());
        try {
            AiServiceHealth health = aiServiceClient.health();
            details.put("service", health.service());
            details.put("version", health.version());
            details.put("remoteStatus", health.status());
            details.put("credentials", credentialsOrUnknown(health.credentials()));
            return ComponentStatus.up(details);
        } catch (RuntimeException e) {
            log.warn("AI service readiness check failed: {}", e.toString());
            details.put("reachable", false);
            return ComponentStatus.down(details);
        }
    }

    /**
     * Presence only. Startup already refuses to run without these, so this component exists to
     * confirm at runtime which variable an operator actually set inside a container.
     */
    private ComponentStatus checkCredentials() {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("aiServiceApiKey", "present");
        details.put("mysqlUser", present(properties.database().username()));
        details.put("mysqlPassword", present(properties.database().password()));
        return ComponentStatus.up(details);
    }

    private static Map<String, Object> credentialsOrUnknown(AiServiceHealth.Credentials credentials) {
        Map<String, Object> values = new LinkedHashMap<>();
        if (credentials == null) {
            values.put("reported", "absent");
            return values;
        }
        values.put("geminiApi", flag(credentials.geminiApiConfigured()));
        values.put("firecrawlApi", flag(credentials.firecrawlApiConfigured()));
        values.put("inboundAuth", flag(credentials.inboundAuthRequired()));
        return values;
    }

    private static String flag(Boolean value) {
        if (value == null) {
            return "unknown";
        }
        return value ? "present" : "missing";
    }

    private static String present(String value) {
        return value == null || value.isBlank() ? "missing" : "present";
    }

    private static Map<String, Object> withError(Map<String, Object> details, String message, String type) {
        details.put("reason", message);
        details.put("errorType", type);
        return details;
    }
}
