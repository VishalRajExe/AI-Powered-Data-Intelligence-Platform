package ai.finalagent.workflow.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import javax.sql.DataSource;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.support.Json;

/**
 * Steps: the plan's nodes, materialised once per run so progress and dependency state are
 * queryable rather than implied.
 *
 * <p>Step rows are created up front, job rows are not. A job exists only once its dependencies
 * have finished, which is what keeps the claim query honest — every {@code PENDING} job is
 * genuinely executable, so no worker has to claim a job, discover its predecessors are unfinished
 * and put it back. Creating the steps at the same time is what lets {@code GET /runs/{id}} show
 * the whole plan, waiting included.
 */
@Repository
public class StepRepository {

    private final JdbcTemplate jdbc;

    public StepRepository(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    private static final RowMapper<Step> ROW = StepRepository::map;

    private static Step map(ResultSet rs, int n) throws SQLException {
        return new Step(rs.getString("id"), rs.getString("workspace_id"), rs.getString("run_id"),
                rs.getInt("plan_version"), rs.getString("step_key"), rs.getInt("sequence"),
                rs.getString("depends_on"), rs.getString("type"),
                JobStatus.valueOf(rs.getString("status")), rs.getInt("attempt"),
                rs.getInt("retry_count"), rs.getString("input"), rs.getString("output_summary"),
                rs.getObject("duration_ms") == null ? null : rs.getLong("duration_ms"),
                rs.getString("error_code"), rs.getString("error_message"),
                ts(rs.getTimestamp("started_at")), ts(rs.getTimestamp("finished_at")));
    }

    private static Instant ts(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    /** @return false when the step already existed, i.e. this scheduling pass is a replay. */
    public boolean insert(String id, String workspaceId, String runId, int planVersion, String stepKey,
                          int sequence, String dependsOnJson, String type, String inputJson) {
        try {
            jdbc.update("""
                    INSERT INTO workflow_steps
                      (id, workspace_id, run_id, plan_version, step_key, sequence, depends_on,
                       type, status, input)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', CAST(? AS JSON))
                    """, id, workspaceId, runId, planVersion, stepKey, sequence, dependsOnJson, type,
                    inputJson == null ? "{}" : inputJson);
            return true;
        } catch (DuplicateKeyException e) {
            return false;
        }
    }

    public List<Step> findByRun(String runId) {
        return jdbc.query("SELECT * FROM workflow_steps WHERE run_id = ? ORDER BY sequence", ROW, runId);
    }

    public Optional<Step> findById(String id) {
        return jdbc.query("SELECT * FROM workflow_steps WHERE id = ?", ROW, id).stream().findFirst();
    }

    public Optional<Step> findByKey(String runId, String stepKey) {
        return jdbc.query("SELECT * FROM workflow_steps WHERE run_id = ? AND step_key = ?", ROW,
                runId, stepKey).stream().findFirst();
    }

    public boolean markRunning(String id) {
        return jdbc.update("""
                UPDATE workflow_steps SET status='RUNNING', started_at=COALESCE(started_at, NOW(6)),
                       attempt = attempt + 1
                 WHERE id = ? AND status = 'PENDING'
                """, id) == 1;
    }

    public boolean recordResult(String id, JobStatus to, String outputSummaryJson, long durationMs,
                                String errorCode, String errorMessage) {
        return jdbc.update("""
                UPDATE workflow_steps
                   SET status = ?, output_summary = COALESCE(?, output_summary),
                       duration_ms = ?, error_code = ?, error_message = ?,
                       finished_at = NOW(6)
                 WHERE id = ? AND status = 'RUNNING'
                """, to.name(), outputSummaryJson, durationMs, errorCode,
                errorMessage == null ? null : truncate(errorMessage), id) == 1;
    }

    /** A reclaimed job puts its step back, or the run would show a step running forever. */
    public boolean resetToPending(String id) {
        return jdbc.update("UPDATE workflow_steps SET status='PENDING' WHERE id = ? AND status='RUNNING'",
                id) == 1;
    }

    /**
     * Only the steps nobody is working on. A RUNNING step is left alone because its worker is the
     * one that knows whether it can stop, and stamping it CANCELLED from here would produce a row
     * claiming an outcome no thread ever wrote.
     */
    public int cancelPending(String runId) {
        return jdbc.update("UPDATE workflow_steps SET status='CANCELLED', finished_at=NOW(6) "
                + "WHERE run_id = ? AND status = 'PENDING'", runId);
    }

    /** Steps whose predecessors are all terminal-successful, and which have not started. */
    public List<Step> findReadyToSchedule(String runId) {
        return findByRun(runId).stream()
                .filter(step -> step.status() == JobStatus.PENDING)
                .filter(step -> dependenciesSatisfied(runId, step))
                .toList();
    }

    private boolean dependenciesSatisfied(String runId, Step step) {
        List<String> dependencies = Json.stringList(step.dependsOnJson());
        if (dependencies.isEmpty()) {
            return true;
        }
        String placeholders = String.join(", ", java.util.Collections.nCopies(dependencies.size(), "?"));
        Object[] args = new Object[dependencies.size() + 1];
        args[0] = runId;
        for (int i = 0; i < dependencies.size(); i++) {
            args[i + 1] = dependencies.get(i);
        }
        // `SKIPPED` counts as satisfied on purpose: a step we chose not to run must not block the
        // steps behind it forever, and the skip itself is recorded on the step row.
        List<String> unsatisfied = jdbc.queryForList("SELECT step_key FROM workflow_steps "
                + "WHERE run_id = ? AND step_key IN (" + placeholders + ") "
                + "AND status NOT IN ('COMPLETED','SKIPPED')", String.class, args);
        return unsatisfied.isEmpty();
    }

    private static String truncate(String value) {
        return value != null && value.length() > 1000 ? value.substring(0, 997) + "..." : value;
    }
}
