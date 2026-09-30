package ai.finalagent.dataset.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import javax.sql.DataSource;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import ai.finalagent.dataset.domain.DatasetRows.Export;

/**
 * Export records, and the only writer of their progress.
 *
 * <p>Progress moves through {@link #advance} alone, which derives the percentage from the row counts
 * rather than accepting one from a caller. That single entry point is the design: the previous
 * project reported progress from status ({@code RUNNING → 50}) and so could tell a waiting user
 * anything it liked.
 */
@Repository
public class ExportRepository {

    private final JdbcTemplate jdbc;

    public ExportRepository(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    private static final RowMapper<Export> ROW = ExportRepository::map;

    private static Export map(ResultSet rs, int n) throws SQLException {
        return new Export(rs.getString("id"), rs.getString("workspace_id"),
                rs.getString("dataset_id"), rs.getString("job_id"), rs.getString("run_id"),
                rs.getString("requested_by_id"), rs.getString("format"), rs.getString("scope"),
                rs.getString("status"), rs.getInt("total_rows"), rs.getInt("written_rows"),
                rs.getInt("progress_percent"), rs.getString("file_name"), rs.getString("file_path"),
                rs.getObject("file_bytes") == null ? null : rs.getLong("file_bytes"),
                rs.getString("checksum"), rs.getString("error_code"), rs.getString("error_message"),
                instant(rs.getTimestamp("created_at")), instant(rs.getTimestamp("started_at")),
                instant(rs.getTimestamp("finished_at")));
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    public void insert(Export export) {
        jdbc.update("""
                INSERT INTO export_jobs
                  (id, workspace_id, dataset_id, job_id, run_id, requested_by_id, format, scope,
                   status, total_rows, file_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)
                """, export.id(), export.workspaceId(), export.datasetId(), export.jobId(),
                export.runId(), export.requestedById(), export.format(), export.scopeJson(),
                export.status(), export.totalRows(), export.fileName());
    }

    public Optional<Export> find(String workspaceId, String id) {
        return jdbc.query("SELECT * FROM export_jobs WHERE id = ? AND workspace_id = ?", ROW,
                id, workspaceId).stream().findFirst();
    }

    /**
     * Export history, newest first.
     *
     * <p>Ordering by {@code created_at} rather than by id, and the tie-break exists because two exports
     * requested in the same microsecond are a real thing a user can do: the id makes the order stable
     * across pages instead of re-deciding it per query.
     */
    public List<Export> list(String workspaceId, String datasetId, int limit, int offset) {
        if (datasetId == null || datasetId.isBlank()) {
            return jdbc.query("SELECT * FROM export_jobs WHERE workspace_id = ?"
                    + " ORDER BY created_at DESC, id LIMIT ? OFFSET ?", ROW, workspaceId, limit, offset);
        }
        return jdbc.query("SELECT * FROM export_jobs WHERE workspace_id = ? AND dataset_id = ?"
                + " ORDER BY created_at DESC, id LIMIT ? OFFSET ?", ROW, workspaceId, datasetId,
                limit, offset);
    }

    public int countAll(String workspaceId, String datasetId) {
        Integer total = datasetId == null || datasetId.isBlank()
                ? jdbc.queryForObject("SELECT COUNT(*) FROM export_jobs WHERE workspace_id = ?",
                        Integer.class, workspaceId)
                : jdbc.queryForObject("SELECT COUNT(*) FROM export_jobs WHERE workspace_id = ?"
                        + " AND dataset_id = ?", Integer.class, workspaceId, datasetId);
        return total == null ? 0 : total;
    }

    public Optional<Export> findByJob(String jobId) {
        return jdbc.query("SELECT * FROM export_jobs WHERE job_id = ?", ROW, jobId).stream()
                .findFirst();
    }

    /** The job claimed this export: running, with the row count it is working towards. */
    public void markRunning(String id, int totalRows) {
        jdbc.update("UPDATE export_jobs SET status = 'RUNNING', total_rows = ?, started_at = NOW(6),"
                + " progress_percent = ? WHERE id = ? AND status IN ('QUEUED','RUNNING')",
                totalRows, percent(0, totalRows), id);
    }

    /**
     * The only progress writer. The percentage is computed here from the two counts, so a caller
     * cannot report a share it has not written, and 100 is unreachable until every row has gone
     * through a writer.
     *
     * @return false when the export was cancelled or settled while the chunk was being written, which
     *         is the runner's cue to stop rather than finish over someone else's decision
     */
    public boolean advance(String id, int writtenRows) {
        Export current = jdbc.query("SELECT total_rows, status FROM export_jobs WHERE id = ?",
                (ResultSet rs, int n) -> new Export(null, null, null, null, null, null, null, null,
                        rs.getString("status"), rs.getInt("total_rows"), 0, 0, null, null, null, null,
                        null, null, null, null, null),
                id).stream().findFirst().orElse(null);
        if (current == null || current.settled()) {
            return false;
        }
        jdbc.update("UPDATE export_jobs SET written_rows = ?, progress_percent = ?,"
                + " status = 'RUNNING' WHERE id = ? AND status <> 'CANCELLED'",
                writtenRows, percent(writtenRows, current.totalRows()), id);
        return true;
    }

    private static int percent(int written, int total) {
        if (total <= 0) {
            // Nothing to write is finished the moment the header is, not before.
            return 100;
        }
        return (int) Math.min(99L, Math.floor(written * 100.0 / total));
    }

    public void complete(String id, int writtenRows, String fileName, String filePath, long bytes,
                         String checksum) {
        jdbc.update("""
                UPDATE export_jobs
                   SET status = 'COMPLETED', written_rows = ?, progress_percent = 100,
                       file_name = ?, file_path = ?, file_bytes = ?, checksum = ?,
                       finished_at = NOW(6), error_code = NULL, error_message = NULL
                 WHERE id = ?
                """, writtenRows, fileName, filePath, bytes, checksum, id);
    }

    public void fail(String id, String errorCode, String errorMessage) {
        jdbc.update("UPDATE export_jobs SET status = 'FAILED', error_code = ?, error_message = ?,"
                + " finished_at = NOW(6) WHERE id = ? AND status <> 'COMPLETED'",
                truncate(errorCode), truncate(errorMessage), id);
    }

    public boolean cancel(String id) {
        return jdbc.update("UPDATE export_jobs SET status = 'CANCELLED', finished_at = NOW(6)"
                + " WHERE id = ? AND status IN ('QUEUED','RUNNING')", id) == 1;
    }

    /** Counts, straight from the table, for the monitoring surface. */
    public int countByStatus(String workspaceId, String status) {
        Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM export_jobs WHERE workspace_id = ?"
                + " AND status = ?", Integer.class, workspaceId, status);
        return total == null ? 0 : total;
    }

    private static String truncate(String value) {
        if (value == null) {
            return null;
        }
        return value.length() <= 1000 ? value : value.substring(0, 999);
    }
}
