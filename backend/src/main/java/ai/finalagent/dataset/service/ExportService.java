package ai.finalagent.dataset.service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ai.finalagent.config.FinalAgentProperties;
import ai.finalagent.config.Workspace;
import ai.finalagent.dataset.domain.DatasetRows;
import ai.finalagent.dataset.export.ExportFormat;
import ai.finalagent.dataset.export.ExportRunner;
import ai.finalagent.dataset.repository.DatasetQueryRepository;
import ai.finalagent.dataset.repository.DatasetQueryRepository.RowQuery;
import ai.finalagent.dataset.repository.DatasetRepository;
import ai.finalagent.dataset.repository.ExportRepository;
import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.repository.JobRepository;
import ai.finalagent.workflow.support.Json;
import ai.finalagent.workflow.support.Principals;

/**
 * Requesting, reading and delivering exports.
 *
 * <p>A request writes two rows in one transaction — the export record and the job that will execute
 * it — and returns immediately. Nothing is generated on the request thread: the old project built the
 * file inside the HTTP call and kept the job in a promise, so a restart stranded every running export
 * in {@code RUNNING} with no way to recover it. Here the queue owns the work, and this service only
 * ever reads what it has recorded.
 *
 * <p>The download path is re-derived from the export id, the same way the runner derived it when it
 * wrote the file; the stored path is a record, not an input. A request never names a path, and neither
 * does a row.
 */
@Service
public class ExportService {

    private final ExportRepository exports;
    private final DatasetRepository datasets;
    private final DatasetQueryRepository queries;
    private final JobRepository jobs;
    private final Workspace currentWorkspace;
    private final ExportRunner runner;
    private final FinalAgentProperties properties;

    public ExportService(ExportRepository exports, DatasetRepository datasets,
                         DatasetQueryRepository queries, JobRepository jobs,
                         Workspace currentWorkspace, ExportRunner runner,
                         FinalAgentProperties properties) {
        this.exports = exports;
        this.datasets = datasets;
        this.queries = queries;
        this.jobs = jobs;
        this.currentWorkspace = currentWorkspace;
        this.runner = runner;
        this.properties = properties;
    }

    /**
     * Queues an export and returns the row.
     *
     * <p>The scope is exercised here with a {@code COUNT(*)} before anything is queued. That is not
     * a warm-up: it rejects a filter naming a column the dataset never declared as a request error
     * instead of a failed job minutes later, and it records the row count the job will work towards,
     * so a queued export already knows how big it is.
     */
    @Transactional
    public DatasetRows.Export request(String datasetId, String format, RowQuery scope) {
        String workspace = currentWorkspace.current();
        DatasetRows.Dataset dataset = datasets.findById(workspace, datasetId).orElseThrow(() ->
                new UnknownExportException("dataset " + datasetId + " is not visible to this "
                        + "workspace, so nothing can be exported from it"));
        ExportFormat chosen = ExportFormat.of(format);
        int totalRows = queries.countRows(datasetId, scope);

        String exportId = UUID.randomUUID().toString();
        String jobId = UUID.randomUUID().toString();
        String name = datasetId + "-" + exportId.substring(0, 8) + "." + chosen.extension();
        exports.insert(new DatasetRows.Export(exportId, workspace, datasetId, jobId, dataset.runId(),
                Principals.UNAUTHENTICATED, chosen.name(),
                Json.write(scope.asScope()), "QUEUED", totalRows, 0, 0, name, null, null, null, null,
                null, null, null, null));
        if (!jobs.insertExportJob(jobId, workspace, dataset.runId(),
                Json.write(Map.of(ExportRunner.PAYLOAD_KEY, exportId)), 3)) {
            throw new IllegalStateException("the export job for " + exportId + " could not be"
                    + " queued; the export row was rolled back with it");
        }
        return exports.find(workspace, exportId).orElseThrow();
    }

    public DatasetRows.Export require(String exportId) {
        return exports.find(currentWorkspace.current(), exportId).orElseThrow(() ->
                new UnknownExportException(exportId));
    }

    /**
     * The job row behind an export — its lease, attempt count and last error.
     *
     * <p>Read straight from the queue table rather than copied into the export record, because the
     * queue owns those columns: two copies of a lease expiry disagree by design.
     */
    public Optional<Job> job(String jobId) {
        return jobs.findById(jobId);
    }

    public List<DatasetRows.Export> list(String datasetId, int limit, int offset) {
        return exports.list(currentWorkspace.current(), datasetId, limit, offset);
    }

    public int count(String datasetId) {
        return exports.countAll(currentWorkspace.current(), datasetId);
    }

    /**
     * The published file, or empty when it is not there — which is a real state: the export finished
     * and the disk it lived on has since been cleaned.
     *
     * <p>The path is re-derived from the export id the same way the runner derived it, never read out
     * of the row and resolved. The stored {@code file_path} is a record of where the writer put it;
     * using it as input would let a row that someone had edited name any file the process can read.
     */
    public Optional<Path> file(DatasetRows.Export export) {
        if (!"COMPLETED".equals(export.status())) {
            return Optional.empty();
        }
        Path path = runner.fileFor(export);
        Path dir = Path.of(properties.export().dir()).toAbsolutePath().normalize();
        return path.startsWith(dir) && Files.isReadable(path) ? Optional.of(path) : Optional.empty();
    }

    /**
     * Cancels an export and, while it is still unclaimed, its job too.
     *
     * <p>Both rows move because either one alone leaves something running: a cancelled export whose job
     * is still PENDING gets claimed and then stops at its own cancellation check, and a cancelled job
     * beside a RUNNING export leaves the record reporting work nobody is doing. A job already claimed is
     * left alone — its holder notices the cancelled record at the next chunk and discards the partial
     * file, which is the only safe way to stop work that is mid-write.
     */
    public boolean cancel(String exportId) {
        String workspace = currentWorkspace.current();
        Optional<DatasetRows.Export> found = exports.find(workspace, exportId);
        if (found.isEmpty()) {
            throw new UnknownExportException(exportId);
        }
        if (!exports.cancel(exportId)) {
            return false;
        }
        jobs.cancelIfPending(found.get().jobId(), "the export was cancelled by its requester");
        return true;
    }

    /** The export isn't this workspace's, or isn't there; both answer the same way. */
    public static class UnknownExportException extends RuntimeException {
        public UnknownExportException(String id) {
            super("no export " + id + " is visible to this workspace");
        }
    }

    public static class UnreadableExportException extends RuntimeException {
        public UnreadableExportException(String id, Throwable cause) {
            super("export " + id + " has no readable file to download", cause);
        }
    }
}
