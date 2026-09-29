package ai.finalagent.research;

import java.util.List;
import java.util.Locale;
import java.util.Set;

import ai.finalagent.aiclient.dto.ResearchRequest;

/**
 * Shape checks for the web-tool request, before it costs a round trip to the AI service.
 *
 * <p>Deliberately <em>not</em> a second copy of the tool ceiling. Which tools are enabled is
 * decided by {@code ALLOWED_WEB_TOOLS} in the service that executes them and spends the
 * credits; duplicating that list here would create a second place for the two to disagree.
 * What Java owns is the request's internal consistency: names it cannot honour, an empty
 * list, or a browser-session budget for a run that did not ask for browser sessions.
 */
public final class WebToolPolicy {

    static final Set<String> KNOWN_TOOLS = Set.of("search", "scrape", "interact");
    static final int MAX_INTERACTIONS_PER_RUN = 20;

    private WebToolPolicy() {
    }

    public static void validate(ResearchRequest.Limits limits) {
        if (limits == null) {
            return;
        }

        List<String> requested = limits.allowedTools();
        if (requested != null) {
            if (requested.isEmpty()) {
                throw new InvalidWebToolRequestException(
                        "limits.allowedTools names no tool; omit it to use every tool this service enables");
            }
            List<String> unknown = requested.stream()
                    .map(tool -> tool.toLowerCase(Locale.ROOT))
                    .filter(tool -> !KNOWN_TOOLS.contains(tool))
                    .distinct()
                    .toList();
            if (!unknown.isEmpty()) {
                throw new InvalidWebToolRequestException(
                        "limits.allowedTools names unknown web tools: " + unknown
                                + "; this build implements " + KNOWN_TOOLS);
            }
        }

        Integer interactions = limits.maxInteractionsPerRun();
        if (interactions != null) {
            if (interactions < 0 || interactions > MAX_INTERACTIONS_PER_RUN) {
                throw new InvalidWebToolRequestException(
                        "limits.maxInteractionsPerRun must be between 0 and "
                                + MAX_INTERACTIONS_PER_RUN + " (got " + interactions + ")");
            }
            if (interactions > 0 && requested != null && !containsIgnoreCase(requested, "interact")) {
                // An inconsistency the caller can actually fix, said here rather than
                // surfaced later as a run that never uses the budget it was given.
                throw new InvalidWebToolRequestException(
                        "limits.maxInteractionsPerRun is " + interactions
                                + " but allowedTools does not include 'interact'");
            }
        }
    }

    private static boolean containsIgnoreCase(List<String> tools, String wanted) {
        return tools.stream().anyMatch(tool -> tool.equalsIgnoreCase(wanted));
    }

    public static class InvalidWebToolRequestException extends RuntimeException {
        public InvalidWebToolRequestException(String message) {
            super(message);
        }
    }
}
