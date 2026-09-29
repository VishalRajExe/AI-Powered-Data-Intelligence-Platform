package ai.finalagent.config;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Component;

/**
 * Cross-field configuration checks that Bean Validation cannot express. Runs during context
 * refresh, so a violation aborts startup before a server socket is opened.
 *
 * <p>Messages name variables, never values.
 */
@Component
public class StartupRequirementsValidator implements InitializingBean {

    private static final List<String> PLACEHOLDER_MARKERS = List.of(
            "changeme", "change_me", "replace_me", "replace-me", "your-", "your_",
            "dummy", "placeholder", "secret123", "insecure-default", "todo");

    private static final int MIN_SECRET_LENGTH = 32;
    private static final int MIN_DB_PASSWORD_LENGTH = 8;
    private static final int MIN_AI_TIMEOUT_MS = 250;
    private static final int MAX_AI_TIMEOUT_MS = 120_000;

    private final FinalAgentProperties properties;

    public StartupRequirementsValidator(FinalAgentProperties properties) {
        this.properties = properties;
    }

    @Override
    public void afterPropertiesSet() {
        validate(properties);
    }

    public static void validate(FinalAgentProperties p) {
        List<String> problems = new ArrayList<>();

        FinalAgentProperties.Database db = p.database();
        requireRealSecret(problems, "AI_SERVICE_API_KEY", p.aiService().apiKey(), MIN_SECRET_LENGTH);
        requireRealSecret(problems, "MYSQL_PASSWORD", db.password(), MIN_DB_PASSWORD_LENGTH);

        requireNonBlank(problems, "MYSQL_USER", db.username());
        requireNonBlank(problems, "MYSQL_HOST", db.host());
        requireNonBlank(problems, "MYSQL_DATABASE", db.name());
        if (db.port() < 1 || db.port() > 65535) {
            problems.add("MYSQL_PORT must be between 1 and 65535 (got " + db.port() + ").");
        }

        int timeout = p.aiService().timeoutMs();
        if (timeout < MIN_AI_TIMEOUT_MS || timeout > MAX_AI_TIMEOUT_MS) {
            problems.add("AI_SERVICE_TIMEOUT_MS must be between " + MIN_AI_TIMEOUT_MS + " and "
                    + MAX_AI_TIMEOUT_MS + " (got " + timeout + ").");
        }

        if (p.cors().allowedOrigins().isEmpty()) {
            problems.add("FRONTEND_ORIGIN must name at least one origin, for example "
                    + "http://localhost:3000. An empty allow-list blocks every browser request.");
        }
        requireAbsoluteHttpUri(problems, "AI_SERVICE_BASE_URL", p.aiService().baseUrl());

        for (String origin : p.cors().allowedOrigins()) {
            checkCorsOrigin(problems, origin);
        }

        if (!problems.isEmpty()) {
            throw new MissingRequiredConfigurationException(
                    "FINALAIAGENT backend refused to start. Fix the following configuration "
                            + "problems (values are never printed):\n  - " + String.join("\n  - ", problems));
        }
    }

    private static void requireNonBlank(List<String> problems, String variable, String value) {
        if (value == null || value.isBlank()) {
            problems.add(variable + " must be set; this project provides no default for it.");
        }
    }

    private static void requireRealSecret(List<String> problems, String variable, String value, int minLength) {
        String normalized = value.toLowerCase(Locale.ROOT);
        for (String marker : PLACEHOLDER_MARKERS) {
            if (normalized.contains(marker)) {
                problems.add(variable + " looks like a placeholder value. Supply a real secret.");
                return;
            }
        }
        if (value.length() < minLength) {
            problems.add(variable + " must be at least " + minLength
                    + " characters (got " + value.length() + "). Generate one with: "
                    + "openssl rand -hex 32");
        }
    }

    private static void checkCorsOrigin(List<String> problems, String origin) {
        if (origin.contains("*")) {
            problems.add("FRONTEND_ORIGIN must be an exact origin; wildcards are not allowed "
                    + "because credentialed CORS requests cannot use a wildcard.");
            return;
        }
        try {
            URI uri = new URI(origin);
            boolean pathPresent = uri.getPath() != null && !uri.getPath().isEmpty();
            if (uri.getScheme() == null || uri.getHost() == null
                    || !("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                    || pathPresent) {
                problems.add("FRONTEND_ORIGIN must be an exact origin such as http://localhost:3000 "
                        + "(scheme + host + optional port, no path, no trailing slash): got a value "
                        + "that is not one.");
            }
        } catch (URISyntaxException e) {
            problems.add("FRONTEND_ORIGIN is not a parseable URI.");
        }
    }

    private static void requireAbsoluteHttpUri(List<String> problems, String variable, String value) {
        try {
            URI uri = new URI(value);
            if (!uri.isAbsolute() || uri.getHost() == null) {
                problems.add(variable + " must be an absolute http(s) URL.");
            }
        } catch (URISyntaxException e) {
            problems.add(variable + " is not a parseable URI.");
        }
    }
}
