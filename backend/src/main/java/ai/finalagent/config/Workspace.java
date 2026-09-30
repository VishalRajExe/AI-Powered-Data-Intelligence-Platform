package ai.finalagent.config;

import org.springframework.stereotype.Component;

/**
 * The one place a workspace id is resolved.
 *
 * <p>It is a component rather than a private method on whichever service needs it first, because the
 * rule is security-relevant and duplicated rules drift: the workspace comes from server-side
 * configuration and <b>never</b> from a request. The project this replaced read
 * {@code workspaceId} off requests on routes whose auth middleware was optional, which is how any
 * caller who knew a UUID could read any workspace's datasets
 * ({@code docs/audit/00-FORENSIC-AUDIT.md} §5 item 1).
 *
 * <p>Authentication replaces the configured value with the token's workspace claim; what must not
 * change is that no request supplies it.
 */
@Component
public class Workspace {

    private final FinalAgentProperties properties;

    public Workspace(FinalAgentProperties properties) {
        this.properties = properties;
    }

    public String current() {
        String configured = properties.execution().workspaceId();
        if (configured == null || configured.isBlank()) {
            throw new IllegalStateException("FINALAGENT_WORKSPACE_ID is not configured; this service"
                    + " does not accept a workspace id from a request");
        }
        return configured;
    }
}
