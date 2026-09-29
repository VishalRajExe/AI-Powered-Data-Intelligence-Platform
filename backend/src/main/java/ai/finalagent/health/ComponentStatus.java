package ai.finalagent.health;

import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnore;

/**
 * One readiness component. {@code details} must never contain a credential value — only
 * booleans, names, and non-sensitive identifiers.
 */
public record ComponentStatus(String status, Map<String, Object> details) {

    public static final String UP = "UP";
    public static final String DOWN = "DOWN";

    public static ComponentStatus up(Map<String, Object> details) {
        return new ComponentStatus(UP, details);
    }

    public static ComponentStatus down(Map<String, Object> details) {
        return new ComponentStatus(DOWN, details);
    }

    @JsonIgnore
    public boolean isUp() {
        return UP.equals(status);
    }
}
