package ai.finalagent.workflow.repository;

import java.util.List;
import java.util.Map;

import javax.sql.DataSource;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import ai.finalagent.workflow.support.Json;

/**
 * The durable activity log.
 *
 * <p>Written before anything is broadcast, always. That ordering is the previous project's best
 * monitoring decision ({@code event-broadcaster.ts:56-99}) and it is the only reason SSE replay
 * and post-restart history can be correct without Redis pub/sub: the log is the truth, the stream
 * is a convenience.
 */
@Repository
public class ActivityRepository {

    private static final Logger log = LoggerFactory.getLogger(ActivityRepository.class);

    private final JdbcTemplate jdbc;

    public ActivityRepository(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    public void record(String workspaceId, String runId, String actorId, String action,
                       String entityType, String entityId, String message, Map<String, ?> details) {
        try {
            jdbc.update("""
                    INSERT INTO activity_events
                      (workspace_id, run_id, actor_id, action, entity_type, entity_id, message, details)
                    VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
                    """, workspaceId, runId, actorId, action, entityType, entityId,
                    message == null ? null : truncate(message), Json.write(details == null ? Map.of() : details));
        } catch (RuntimeException e) {
            // A monitoring write must not fail a collection run, but swallowing it silently is
            // how the old code hid Redis publish failures. Log with the run id and move on.
            log.warn("activity event {} for run {} could not be persisted: {}", action, runId,
                    e.getClass().getSimpleName());
        }
    }

    /** Events newer than {@code afterId}, oldest first — the cursor an SSE replay resumes from. */
    public List<Map<String, Object>> forRun(String runId, long afterId, int limit) {
        return jdbc.queryForList("""
                SELECT id, action, entity_type, entity_id, message, created_at
                  FROM activity_events
                 WHERE run_id = ? AND id > ?
                 ORDER BY id LIMIT ?
                """, runId, afterId, limit);
    }

    private static String truncate(String value) {
        return value.length() > 1000 ? value.substring(0, 997) + "..." : value;
    }
}
