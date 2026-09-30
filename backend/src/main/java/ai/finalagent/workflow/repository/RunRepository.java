package ai.finalagent.workflow.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import javax.sql.DataSource;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import ai.finalagent.workflow.domain.Records.Run;
import ai.finalagent.workflow.domain.RunStatus;

/**
 * Runs, and the counters that make a run's status mean something.
 *
 * <p>Progress is never synthesised from status. The previous project reported
 * {@code COMPLETED→100, RUNNING→50, else 0} ({@code workflows.routes.ts:92}), so a run that had
 * done nothing for twenty minutes looked like it was half finished. Here progress comes from step
 * outcomes and the counters in this table, both written in the same transaction as the step that
 * produced them.
 */
@Repository
public class RunRepository {

    private final JdbcTemplate jdbc;

    public RunRepository(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    private static final RowMapper<Run> ROW = RunRepository::map;

    private static Run map(ResultSet rs, int n) throws SQLException {
        return new Run(rs.getString("id"), rs.getString("workspace_id"), rs.getString("workflow_id"),
                rs.getString("plan_id"), RunStatus.valueOf(rs.getString("status")),
                rs.getInt("attempt"), rs.getInt("progress"),
                rs.getInt("records_raw"), rs.getInt("records_found"), rs.getInt("records_valid"),
                rs.getInt("duplicate_count"), rs.getInt("sources_processed"),
                rs.getInt("sources_failed"), rs.getString("error_code"), rs.getString("error_message"),
                ts(rs.getTimestamp("cancel_requested_at")), ts(rs.getTimestamp("started_at")),
                ts(rs.getTimestamp("finished_at")), ts(rs.getTimestamp("created_at")));
    }

    private static Instant ts(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    /** @return false when a concurrent request already created this attempt of this workflow. */
    public boolean insert(String id, String workspaceId, String workflowId, String planId, int attempt) {
        try {
            jdbc.update("INSERT INTO workflow_runs (id, workspace_id, workflow_id, plan_id, status, attempt) "
                    + "VALUES (?, ?, ?, ?, 'PENDING', ?)", id, workspaceId, workflowId, planId, attempt);
            return true;
        } catch (DuplicateKeyException e) {
            return false;
        }
    }

    public Optional<Run> findById(String id) {
        return jdbc.query("SELECT * FROM workflow_runs WHERE id = ?", ROW, id).stream().findFirst();
    }

    public List<Run> findRecent(String workspaceId, int limit) {
        return jdbc.query("SELECT * FROM workflow_runs WHERE workspace_id = ? "
                + "ORDER BY created_at DESC LIMIT ?", ROW, workspaceId, limit);
    }

    /** One workflow's run history — every attempt, newest first, none of them rewritten. */
    public List<Run> findByWorkflow(String workspaceId, String workflowId, int limit, int offset) {
        return jdbc.query("SELECT * FROM workflow_runs WHERE workspace_id = ? AND workflow_id = ?"
                + " ORDER BY created_at DESC, id LIMIT ? OFFSET ?", ROW, workspaceId, workflowId,
                limit, offset);
    }

    public int countByWorkflow(String workspaceId, String workflowId) {
        Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM workflow_runs WHERE workspace_id = ?"
                + " AND workflow_id = ?", Integer.class, workspaceId, workflowId);
        return total == null ? 0 : total;
    }

    /**
     * Runs grouped by status, in one pass.
     *
     * <p>The map carries every {@link RunStatus} including the zero ones, because a monitoring surface
     * that omits a status makes "none" and "not counted" indistinguishable — and a dashboard reading
     * the second as the first is how a stuck queue looks healthy.
     */
    public Map<String, Integer> statusCounts(String workspaceId) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (RunStatus status : RunStatus.values()) {
            counts.put(status.name(), 0);
        }
        jdbc.query("SELECT status, COUNT(*) AS run_count FROM workflow_runs WHERE workspace_id = ?"
                        + " GROUP BY status",
                (RowCallbackHandler) rs -> counts.put(rs.getString("status"), rs.getInt("run_count")),
                workspaceId);
        return counts;
    }

    /** What the workspace has ever collected, summed from the runs rather than from a cache. */
    public Map<String, Integer> recordTotals(String workspaceId) {
        Map<String, Integer> totals = new LinkedHashMap<>();
        jdbc.query("SELECT COALESCE(SUM(records_raw), 0) AS records_raw,"
                        + " COALESCE(SUM(records_found), 0) AS records_found,"
                        + " COALESCE(SUM(records_valid), 0) AS records_valid,"
                        + " COALESCE(SUM(duplicate_count), 0) AS duplicates,"
                        + " COALESCE(SUM(sources_processed), 0) AS sources_processed,"
                        + " COALESCE(SUM(sources_failed), 0) AS sources_failed"
                        + " FROM workflow_runs WHERE workspace_id = ?",
                rs -> {
                    totals.put("recordsRaw", rs.getInt("records_raw"));
                    totals.put("recordsFound", rs.getInt("records_found"));
                    totals.put("recordsValid", rs.getInt("records_valid"));
                    totals.put("duplicates", rs.getInt("duplicates"));
                    totals.put("sourcesProcessed", rs.getInt("sources_processed"));
                    totals.put("sourcesFailed", rs.getInt("sources_failed"));
                }, workspaceId);
        return totals;
    }

    public Optional<Run> findByWorkflowAndAttempt(String workflowId, int attempt) {
        return jdbc.query("SELECT * FROM workflow_runs WHERE workflow_id = ? AND attempt = ?", ROW,
                workflowId, attempt).stream().findFirst();
    }

    /**
     * The attempt number a new run of this workflow should take, counted in the database rather
     * than from a page of recent runs — reading a list and taking the max misses attempts that fell
     * outside the page, and two callers doing it concurrently produce the same number.
     */
    public int nextAttempt(String workflowId) {
        Integer attempt = jdbc.queryForObject(
                "SELECT COALESCE(MAX(attempt), 0) + 1 FROM workflow_runs WHERE workflow_id = ?",
                Integer.class, workflowId);
        return attempt == null ? 1 : attempt;
    }

    /**
     * Status change, guarded on the value the caller believes is current. A run is written by
     * worker threads and by the cancel endpoint, so an unguarded write would let a stale worker
     * overwrite a cancellation — which is the class of bug the whole lease design exists to stop.
     */
    public boolean compareAndSetStatus(String id, RunStatus expected, RunStatus next) {
        if (!allowed(expected, next)) {
            throw new IllegalStateException("illegal run transition " + expected + " -> " + next);
        }
        return jdbc.update("""
                UPDATE workflow_runs
                   SET status = ?,
                       started_at = COALESCE(started_at, NOW(6)),
                       finished_at = CASE WHEN ? THEN NOW(6) ELSE finished_at END
                 WHERE id = ? AND status = ?
                """, next.name(), next.isTerminal() ? 1 : 0, id, expected.name()) == 1;
    }

    private static boolean allowed(RunStatus from, RunStatus to) {
        return switch (from) {
            case PENDING -> to == RunStatus.PLANNING || to == RunStatus.RUNNING
                    || to == RunStatus.CANCELLED || to == RunStatus.FAILED;
            case PLANNING -> to == RunStatus.RUNNING || to == RunStatus.FAILED || to == RunStatus.CANCELLED;
            case RUNNING -> to == RunStatus.COMPLETED || to == RunStatus.PARTIAL || to == RunStatus.FAILED
                    || to == RunStatus.CANCELLED;
            default -> false;
        };
    }

    /**
     * Counters move by atomic SQL increments rather than read-modify-write, because a run's steps
     * can finish concurrently. The caller applies them only when its step transition actually
     * wrote a row, so a replayed or lost-lease write cannot double-count.
     */
    public void addCounters(String id, StepCounters delta) {
        jdbc.update("""
                UPDATE workflow_runs
                   SET records_raw = records_raw + ?, records_found = records_found + ?,
                       records_valid = records_valid + ?, duplicate_count = duplicate_count + ?,
                       sources_processed = sources_processed + ?, sources_failed = sources_failed + ?
                 WHERE id = ?
                """, delta.recordsRaw(), delta.recordsFound(), delta.recordsValid(),
                delta.duplicates(), delta.sourcesProcessed(), delta.sourcesFailed(), id);
    }

    /** A run's counters, in the shape the executor adds them in. */
    public record StepCounters(int recordsRaw, int recordsFound, int recordsValid, int duplicates,
                               int sourcesProcessed, int sourcesFailed) {
    }

    /** Progress is written from real step state; nothing here ever infers it from status. */
    public boolean updateProgress(String id, int progressPercent) {
        return jdbc.update("UPDATE workflow_runs SET progress = ? WHERE id = ?", progressPercent, id) == 1;
    }

    public boolean recordFailure(String id, String errorCode, String errorMessage) {
        return jdbc.update("UPDATE workflow_runs SET error_code = ?, error_message = ? WHERE id = ?",
                errorCode, errorMessage == null ? null : truncate(errorMessage), id) == 1;
    }

    /** Cooperative cancellation: set the flag, and let the worker notice it at a step boundary. */
    public boolean requestCancel(String id) {
        return jdbc.update("UPDATE workflow_runs SET cancel_requested_at = NOW(6) "
                + "WHERE id = ? AND cancel_requested_at IS NULL AND finished_at IS NULL", id) == 1;
    }

    public boolean cancelRequested(String id) {
        Boolean value = jdbc.queryForObject("SELECT cancel_requested_at IS NOT NULL FROM workflow_runs "
                + "WHERE id = ?", Boolean.class, id);
        return Boolean.TRUE.equals(value);
    }

    public int runningJobCount(List<String> statuses) {
        if (statuses.isEmpty()) {
            return 0;
        }
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM workflow_runs WHERE status IN ("
                + String.join(",", statuses.stream().map(s -> "?").toList()) + ")",
                Integer.class, statuses.toArray());
        return count == null ? 0 : count;
    }

    private static String truncate(String value) {
        return value != null && value.length() > 1000 ? value.substring(0, 997) + "..." : value;
    }
}
