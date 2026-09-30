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

import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Job;

/**
 * The MySQL queue that replaces BullMQ. All SQL semantics come from
 * {@code docs/audit/J-no-redis-job-architecture.md} §J.1-§J.4.
 *
 * <p>Three rules run through this class:
 *
 * <ul>
 *   <li><b>Time is the database's.</b> Leases, backoff and scheduling are all computed with
 *       {@code NOW(6)} server-side. If the application clock were used, two app nodes with skew
 *       would disagree about who owns a job, and that disagreement looks like a stuck queue.</li>
 *   <li><b>Ownership is claimed, never assumed.</b> Every write that follows a claim carries
 *       {@code worker_id = ? AND status = 'RUNNING'}, and every one that changes state carries the
 *       status it expected. A worker whose lease was reclaimed cannot write a result.</li>
 *   <li><b>Duplicates are refused by the schema.</b> {@code UNIQUE (run_id, step_id)} is what
 *       prevents a second job for one step — not a check-then-insert, which two nodes can both
 *       pass.</li>
 * </ul>
 */
@Repository
public class JobRepository {

    /** A row a worker may try to claim: its identity and the version the claim must match. */
    public record Candidate(String id, long version) {
    }

    private final JdbcTemplate jdbc;

    public JobRepository(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    private static final RowMapper<Job> JOB_ROW = (ResultSet rs, int rowNum) -> mapJob(rs);

    static Job mapJob(ResultSet rs) throws SQLException {
        return new Job(
                rs.getString("id"),
                rs.getString("workspace_id"),
                rs.getString("run_id"),
                rs.getString("parent_job_id"),
                rs.getString("job_type"),
                rs.getString("step_id"),
                rs.getString("payload"),
                JobStatus.valueOf(rs.getString("status")),
                rs.getInt("priority"),
                rs.getInt("attempt_count"),
                rs.getInt("max_attempts"),
                instant(rs.getTimestamp("locked_at")),
                instant(rs.getTimestamp("lease_expires_at")),
                rs.getString("worker_id"),
                rs.getLong("version"),
                rs.getString("last_error_code"),
                rs.getString("last_error_message"),
                rs.getString("result_summary"),
                instant(rs.getTimestamp("scheduled_for")),
                instant(rs.getTimestamp("started_at")),
                instant(rs.getTimestamp("finished_at")),
                instant(rs.getTimestamp("created_at")));
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    /**
     * Inserts a step job and reports whether it was already there.
     *
     * @return true when this call created the job, false when the unique key rejected it — which is
     *         the normal outcome when two workers both notice that a step became ready.
     */
    public boolean insertStepJob(String id, String workspaceId, String runId, String stepId,
                                 String payloadJson, int priority, int maxAttempts) {
        try {
            jdbc.update("""
                    INSERT INTO workflow_jobs
                      (id, workspace_id, run_id, job_type, step_id, payload, status, priority,
                       max_attempts, scheduled_for)
                    VALUES (?, ?, ?, 'WORKFLOW_STEP', ?, ?, 'PENDING', ?, ?, NOW(6))
                    """, id, workspaceId, runId, stepId, payloadJson, priority, maxAttempts);
            return true;
        } catch (DuplicateKeyException e) {
            return false;
        }
    }

    /**
     * An export, queued on the same table and the same claim as a workflow step.
     *
     * <p>The row is deliberately a {@code workflow_jobs} row with {@code job_type = 'EXPORT'} rather
     * than a private queue of its own: one lease, one sweeper, one retry policy and one set of unique
     * keys for all the asynchronous work the service does. It carries no {@code step_id} — an export
     * is not a step of a run — but it does carry the run that produced the dataset, because that is
     * what makes the job traceable to the work behind the file.
     *
     * @return false when the job already exists, i.e. this request is a replay
     */
    public boolean insertExportJob(String id, String workspaceId, String runId, String payloadJson,
                                   int maxAttempts) {
        try {
            jdbc.update("""
                    INSERT INTO workflow_jobs
                      (id, workspace_id, run_id, job_type, step_id, payload, status, priority,
                       max_attempts, scheduled_for)
                    VALUES (?, ?, ?, 'EXPORT', NULL, ?, 'PENDING', 200, ?, NOW(6))
                    """, id, workspaceId, runId, payloadJson, maxAttempts);
            return true;
        } catch (DuplicateKeyException e) {
            return false;
        }
    }

    public Optional<Candidate> findClaimable() {        List<Candidate> rows = jdbc.query("""
                SELECT candidate.id, candidate.version
                  FROM (
                    SELECT id, version
                      FROM workflow_jobs
                     WHERE status = 'PENDING'
                       AND scheduled_for <= NOW(6)
                     ORDER BY priority, scheduled_for, created_at
                     LIMIT 1
                  ) AS candidate
                """, (rs, n) -> new Candidate(rs.getString("id"), rs.getLong("version")));
        return rows.stream().findFirst();
    }

    /**
     * J.2's primary mechanism: one conditional UPDATE, no explicit transaction, race-free because
     * the status and version predicates are re-checked in the same statement that writes the lease.
     *
     * @return true when this worker owns the job; false means someone else won and we simply retry.
     */
    public boolean claim(String id, long expectedVersion, String workerId, int leaseSeconds) {
        return jdbc.update("""
                UPDATE workflow_jobs
                   SET status           = 'RUNNING',
                       worker_id        = ?,
                       locked_at        = NOW(6),
                       lease_expires_at = TIMESTAMPADD(SECOND, ?, NOW(6)),
                       attempt_count    = attempt_count + 1,
                       started_at       = COALESCE(started_at, NOW(6)),
                       version          = version + 1
                 WHERE id       = ?
                   AND status   = 'PENDING'
                   AND version  = ?
                   AND scheduled_for <= NOW(6)
                """, workerId, leaseSeconds, id, expectedVersion) == 1;
    }

    public Optional<Job> findById(String id) {
        return jdbc.query("SELECT * FROM workflow_jobs WHERE id = ?", JOB_ROW, id).stream().findFirst();
    }

    /**
     * Heartbeat. Guards on {@code worker_id}, so a worker whose lease was already taken over gets
     * {@code false} and must stop executing rather than keep producing results nobody will store.
     */
    public boolean renewLease(String id, String workerId, int leaseSeconds) {
        return jdbc.update("""
                UPDATE workflow_jobs
                   SET lease_expires_at = TIMESTAMPADD(SECOND, ?, NOW(6)), version = version + 1
                 WHERE id = ? AND worker_id = ? AND status = 'RUNNING'
                """, leaseSeconds, id, workerId) == 1;
    }

    /**
     * Terminal write. The caller must be inside a fresh transaction — see {@code JobLifecycle}.
     *
     * <p>The error columns keep their previous value when this write carries none, so a job that
     * succeeded on its second attempt still records why the first one did not. "It took three
     * minutes longer than usual" with no reason beside it is the kind of fact that only matters
     * after the run is over.
     */
    public boolean writeTerminal(String id, String workerId, JobStatus expected, JobStatus to,
                                 String errorCode, String errorMessage, String resultSummaryJson) {
        if (!expected.assertTransition(to).equals(to)) {
            throw new JobStatus.IllegalJobStateException(expected, to);
        }
        return jdbc.update("""
                UPDATE workflow_jobs
                   SET status             = ?,
                       last_error_code    = COALESCE(?, last_error_code),
                       last_error_message = COALESCE(?, last_error_message),
                       result_summary      = COALESCE(?, result_summary),
                       finished_at        = NOW(6),
                       lease_expires_at   = NULL,
                       version            = version + 1
                 WHERE id = ? AND worker_id = ? AND status = ?
                """, to.name(), errorCode, truncate(errorMessage), resultSummaryJson, id, workerId,
                expected.name()) == 1;
    }

    /**
     * Puts a job back for another attempt, {@code delaySeconds} from now on the database clock.
     * Also used by lease recovery, where the delay is zero and the previous holder is cleared.
     */
    public boolean requeue(String id, String workerId, int delaySeconds, String errorCode,
                           String errorMessage) {
        return jdbc.update("""
                UPDATE workflow_jobs
                   SET status             = 'PENDING',
                       worker_id          = NULL,
                       locked_at          = NULL,
                       lease_expires_at   = NULL,
                       scheduled_for      = TIMESTAMPADD(SECOND, ?, NOW(6)),
                       next_retry_at      = TIMESTAMPADD(SECOND, ?, NOW(6)),
                       last_error_code    = ?,
                       last_error_message = ?,
                       version            = version + 1
                 WHERE id = ? AND worker_id = ? AND status = 'RUNNING'
                """, delaySeconds, delaySeconds, errorCode, truncate(errorMessage), id, workerId) == 1;
    }

    /** A job the reaper may take away, with its step so the step row can be corrected too. */
    public record ExpiredJob(String id, String stepId, int attemptCount, int maxAttempts) {
    }

    public List<ExpiredJob> findExpired(int limit) {
        return jdbc.query("""
                SELECT id, step_id, attempt_count, max_attempts FROM workflow_jobs
                 WHERE status = 'RUNNING' AND lease_expires_at < NOW(6)
                 ORDER BY lease_expires_at LIMIT ?
                """, (rs, n) -> new ExpiredJob(rs.getString("id"), rs.getString("step_id"),
                rs.getInt("attempt_count"), rs.getInt("max_attempts")), limit);
    }

    /**
     * Every unstarted job of a run, moved straight to CANCELLED so the sweeper cannot revive it.
     *
     * <p>Scoped to {@code WORKFLOW_STEP} deliberately. An export that happens to point at this run is
     * not the run's work — it is a reader of a dataset the run produced, requested afterwards — and
     * cancelling a run must not silently delete someone's queued file.
     */
    public int cancelPendingForRun(String runId, String reason) {
        return jdbc.update("""
                UPDATE workflow_jobs
                   SET status = 'CANCELLED', last_error_code = ?, last_error_message = ?,
                       finished_at = NOW(6), version = version + 1
                 WHERE run_id = ? AND status = 'PENDING' AND job_type = 'WORKFLOW_STEP'
                """, "RUN_CANCELLED", truncate(reason), runId);
    }

    /**
     * Cancels one unclaimed job. A claimed job is deliberately untouched: its holder has a live lease
     * and a write in progress, and it notices the cancellation through the record it is working from.
     *
     * @return true when this call cancelled the job, false when someone had already claimed or settled it
     */
    public boolean cancelIfPending(String id, String reason) {
        return jdbc.update("""
                UPDATE workflow_jobs
                   SET status = 'CANCELLED', last_error_code = ?, last_error_message = ?,
                       finished_at = NOW(6), lease_expires_at = NULL, version = version + 1
                 WHERE id = ? AND status = 'PENDING'
                """, "CANCELLED_BY_REQUESTER", truncate(reason), id) == 1;
    }

    /** J.13: release our leases on shutdown so the next boot claims immediately, not after expiry. */
    public int releaseLeasesHeldBy(String workerId) {
        return jdbc.update("""
                UPDATE workflow_jobs
                   SET status = 'PENDING', worker_id = NULL, locked_at = NULL,
                       lease_expires_at = NULL, scheduled_for = NOW(6), version = version + 1
                 WHERE worker_id = ? AND status = 'RUNNING'
                """, workerId);
    }

    /**
     * J.3's sweeper, part one: a dead worker's job becomes claimable again while attempts remain.
     * The guard is the same conditional UPDATE the claim uses, so two workers sweeping the same
     * expired row cannot both revive it.
     */
    public boolean reclaimExpiredLease(String id) {
        return jdbc.update("""
                UPDATE workflow_jobs
                   SET status = 'PENDING', worker_id = NULL, locked_at = NULL, lease_expires_at = NULL,
                       scheduled_for = NOW(6), version = version + 1
                 WHERE id = ? AND status = 'RUNNING' AND lease_expires_at < NOW(6)
                   AND attempt_count < max_attempts
                """, id) == 1;
    }

    public boolean failLeaseExhausted(String id) {
        // One literal, not two joined with `+`: in SQL that operator is arithmetic, and MySQL
        // answers with "Truncated incorrect DOUBLE value" instead of storing the message.
        return jdbc.update("""
                UPDATE workflow_jobs
                   SET status = 'FAILED', last_error_code = 'LEASE_EXPIRED_EXHAUSTED',
                       last_error_message = 'the lease expired with no attempts left; the worker '
                           'holding it stopped reporting before its deadline',
                       finished_at = NOW(6), lease_expires_at = NULL, version = version + 1
                 WHERE id = ? AND status = 'RUNNING' AND lease_expires_at < NOW(6)
                   AND attempt_count >= max_attempts
                """, id) == 1;
    }

    public List<Job> findByRun(String runId) {
        return jdbc.query("SELECT * FROM workflow_jobs WHERE run_id = ? ORDER BY created_at, priority",
                JOB_ROW, runId);
    }

    /** Diagnostics and the readiness probe: how much work is waiting, and how much is held. */
    public int countPending() {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM workflow_jobs WHERE status = 'PENDING'",
                Integer.class);
        return count == null ? 0 : count;
    }

    public int countRunning() {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM workflow_jobs WHERE status = 'RUNNING'",
                Integer.class);
        return count == null ? 0 : count;
    }

    /**
     * Queue depth by job type and status, in one pass.
     *
     * <p>Deliberately queue-wide rather than scoped to a workspace: this is a statement about the
     * worker pool, which is one shared pool for every workspace in this process. A number labelled as
     * a workspace's own would imply a per-tenant pool that does not exist.
     */
    public Map<String, Integer> depthByTypeAndStatus() {
        Map<String, Integer> depth = new LinkedHashMap<>();
        jdbc.query("""
                SELECT job_type, status, COUNT(*) AS n FROM workflow_jobs
                 WHERE status IN ('PENDING','RUNNING')
                 GROUP BY job_type, status
                """, (RowCallbackHandler) rs -> depth.put(
                rs.getString("job_type") + "." + rs.getString("status"), rs.getInt("n")));
        return depth;
    }

    /** {@code last_error_message} is VARCHAR(2000); a provider payload must not abort the write. */
    private static String truncate(String value) {
        if (value == null) {
            return null;
        }
        return value.length() <= 2000 ? value : value.substring(0, 1997) + "...";
    }
}
