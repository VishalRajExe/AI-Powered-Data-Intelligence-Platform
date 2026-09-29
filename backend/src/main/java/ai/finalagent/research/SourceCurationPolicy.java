package ai.finalagent.research;

import java.util.List;
import java.util.Locale;

import ai.finalagent.aiclient.dto.ResearchRequest;

/**
 * Shape checks for the source-curation part of a research request.
 *
 * <p>Same division of responsibility as {@link WebToolPolicy}: the AI service owns the policy —
 * which domains are permitted, what robots.txt says, how candidates are scored — and Java refuses
 * a request that cannot mean anything. A relevance floor outside 0..1, an entity type of "string",
 * or a per-domain cap of a thousand would all reach Python as valid-looking JSON and come back as
 * a short or empty dataset nobody can explain.
 */
public final class SourceCurationPolicy {

    static final double MIN_SCORE = 0.0;
    static final double MAX_SCORE = 1.0;
    static final int MAX_SOURCES_PER_DOMAIN = 10;
    static final int MAX_DESIRED_SOURCES = 2_000;
    static final int MAX_ENTITY_TYPE_LENGTH = 60;

    private SourceCurationPolicy() {
    }

    public static void validate(ResearchRequest.Limits limits) {
        if (limits == null) {
            return;
        }

        String entityType = limits.entityType();
        if (entityType != null) {
            String trimmed = entityType.trim();
            if (trimmed.isEmpty()) {
                throw new InvalidCurationRequestException(
                        "limits.entityType is present but blank; omit it rather than sending an empty entity");
            }
            if (trimmed.length() > MAX_ENTITY_TYPE_LENGTH) {
                throw new InvalidCurationRequestException(
                        "limits.entityType must be at most " + MAX_ENTITY_TYPE_LENGTH + " characters");
            }
            if (!trimmed.matches("[A-Za-z][A-Za-z0-9 _-]*")) {
                throw new InvalidCurationRequestException(
                        "limits.entityType must be a short name for the kind of thing being collected, "
                                + "such as 'youtube_channel' or 'job'; got a value that is not one");
            }
        }

        Double floor = limits.minRelevanceScore();
        if (floor != null && (floor < MIN_SCORE || floor > MAX_SCORE || Double.isNaN(floor))) {
            throw new InvalidCurationRequestException(
                    "limits.minRelevanceScore must be between 0.0 and 1.0 (got " + floor + ")");
        }

        Integer perDomain = limits.maxSourcesPerDomain();
        if (perDomain != null && (perDomain < 0 || perDomain > MAX_SOURCES_PER_DOMAIN)) {
            throw new InvalidCurationRequestException(
                    "limits.maxSourcesPerDomain must be between 0 (no diversity rule) and "
                            + MAX_SOURCES_PER_DOMAIN + " (got " + perDomain + ")");
        }

        Integer desired = limits.desiredSources();
        if (desired != null && (desired < 1 || desired > MAX_DESIRED_SOURCES)) {
            throw new InvalidCurationRequestException(
                    "limits.desiredSources must be between 1 and " + MAX_DESIRED_SOURCES
                            + " (got " + desired + ")");
        }

        List<String> preferred = limits.preferredDomains();
        if (preferred != null) {
            List<String> malformed = preferred.stream()
                    .map(domain -> domain == null ? "" : domain.trim().toLowerCase(Locale.ROOT))
                    .filter(domain -> !domain.isEmpty())
                    .filter(domain -> !domain.matches("[a-z0-9.-]{3,253}"))
                    .toList();
            if (!malformed.isEmpty()) {
                throw new InvalidCurationRequestException(
                        "limits.preferredDomains must be bare hostnames such as example.com, got: "
                                + malformed);
            }
        }
    }

    public static class InvalidCurationRequestException extends RuntimeException {
        public InvalidCurationRequestException(String message) {
            super(message);
        }
    }
}
