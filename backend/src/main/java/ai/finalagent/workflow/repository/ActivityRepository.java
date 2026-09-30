package ai.finalagent.workflow.repository;

import java.util.ArrayList;
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

    /**
     * The workspace's activity feed, cursor-paged on the event id.
     *
     * <p>Two directions in one statement, and both are needed: a caller who wants "the last fifty
     * things" and a caller who wants "everything since the row I last saw". Taking the newest
     * {@code limit} events past the cursor and then returning them oldest-first means the last element
     * is always the next cursor, so a client that pages forward never re-reads or skips an event, and
     * a client that opens the page sees the recent past rather than the beginning of the table.
     *
     * <p>Filters are exact matches on {@code run_id} and a prefix on {@code action}, because actions
     * are namespaced ({@code workflow.step.COMPLETED}, {@code export.failed}) and "all step events" is
     * the question that gets asked.
     */
    public List<Map<String, Object>> feed(String workspaceId, String runId, String actionPrefix,
                                          long afterId, int limit) {
        StringBuilder inner = new StringBuilder("""
                SELECT id, run_id, actor_id, action, entity_type, entity_id, message, created_at
                  FROM activity_events
                 WHERE workspace_id = ? AND id > ?
                """);
        List<Object> args = new ArrayList<>();
        args.add(workspaceId);
        args.add(afterId);
        if (runId != null && !runId.isBlank()) {
            inner.append(" AND run_id = ?");
            args.add(runId);
        }
        if (actionPrefix != null && !actionPrefix.isBlank()) {
            inner.append(" AND action LIKE ?");
            args.add(actionPrefix.replaceAll("[%_\\\\]", "\\\\$0") + "%");
        }
        inner.append(" ORDER BY id DESC LIMIT ?");
        args.add(limit);
        // Ascending out of the gate: the outer ORDER BY id re-sorts the newest window, so the last
        // row is always the highest id and therefore the next cursor.
        return jdbc.queryForList("SELECT * FROM (" + inner + ") AS recent ORDER BY id", args.toArray());
    }

    /** Total events in the window the feed reads, so a page can say whether it is showing everything. */
    public int countFeed(String workspaceId, String runId, String actionPrefix, long afterId) {
        StringBuilder sql = new StringBuilder("SELECT COUNT(*) FROM activity_events"
                + " WHERE workspace_id = ? AND id > ?");
        List<Object> args = new ArrayList<>();
        args.add(workspaceId);
        args.add(afterId);
        if (runId != null && !runId.isBlank()) {
            sql.append(" AND run_id = ?");
            args.add(runId);
        }
        if (actionPrefix != null && !actionPrefix.isBlank()) {
            sql.append(" AND action LIKE ?");
            args.add(actionPrefix.replaceAll("[%_\\\\]", "\\\\$0") + "%");
        }
        Integer total = jdbc.queryForObject(sql.toString(), Integer.class, args.toArray());
        return total == null ? 0 : total;
    }

    private static String truncate(String value) {
        return value.length() > 1000 ? value.substring(0, 997) + "..." : value;
    }
}
