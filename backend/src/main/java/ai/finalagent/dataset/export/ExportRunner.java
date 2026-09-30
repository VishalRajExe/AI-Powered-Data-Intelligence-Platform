package ai.finalagent.dataset.export;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import ai.finalagent.config.FinalAgentProperties;
import ai.finalagent.dataset.domain.DatasetRows;
import ai.finalagent.dataset.repository.DatasetQueryRepository;
import ai.finalagent.dataset.repository.DatasetQueryRepository.Filter;
import ai.finalagent.dataset.repository.DatasetQueryRepository.RowQuery;
import ai.finalagent.dataset.repository.DatasetRepository;
import ai.finalagent.dataset.repository.ExportRepository;
import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.support.Json;

/**
 * Runs one export job: read the dataset in chunks, write a file, report only what happened.
 *
 * <p>Progress is a consequence of the work and never an input to it. {@code totalRows} is a
 * {@code COUNT(*)} taken before the first byte, and every advancement carries the number of rows that
 * have physically gone through a writer — so a job at 40% has written 40% of the rows, and 100 is
 * unreachable until the counts match. The project this replaced synthesised {@code RUNNING → 50}, and
 * a wedged export looked half-done forever; {@code ExportProgressMySqlTest} is the reason that cannot
 * come back.
 *
 * <p>The file is written to a {@code .part} sibling and renamed only after the writer finishes, so a
 * download never sees a half-written workbook, and a worker that died mid-write leaves nothing that
 * could be reported as complete.
 */
@Component
public class ExportRunner {

    /** The job payload carries one thing: which export to write. Everything else is read from the row. */
    public static final String PAYLOAD_KEY = "exportId";

    private static final Logger log = LoggerFactory.getLogger(ExportRunner.class);

    private final ExportRepository exports;
    private final DatasetRepository datasets;
    private final DatasetQueryRepository queries;
    private final FinalAgentProperties properties;

    public ExportRunner(ExportRepository exports, DatasetRepository datasets,
                        DatasetQueryRepository queries, FinalAgentProperties properties) {
        this.exports = exports;
        this.datasets = datasets;
        this.queries = queries;
        this.properties = properties;
    }

    /** What the executor needs in order to write the job's terminal state. */
    public record Outcome(JobStatus status, Map<String, Object> summary, String errorCode,
                          String errorMessage) {

        static Outcome completed(Map<String, Object> summary) {
            return new Outcome(JobStatus.COMPLETED, summary, null, null);
        }

        static Outcome failed(String code, String message) {
            return new Outcome(JobStatus.FAILED, Map.of(), code, message);
        }
    }

    /**
     * Whether the export already has a final status — which is what cancellation looks like to a
     * writer, since a cancelled export is settled just as a completed one is.
     */
    public boolean settled(String workspaceId, String exportId) {
        return exports.find(workspaceId, exportId).map(DatasetRows.Export::settled).orElse(true);
    }

    /**
     * Which export an {@code EXPORT} job points at.
     *
     * <p>Refuses rather than defaulting: a job whose payload lost its export id cannot be run without
     * guessing, and guessing here means writing someone else's dataset into a file under this job's
     * name.
     */
    public static String exportIdOf(String payloadJson) {
        Object value = Json.object(payloadJson).get(PAYLOAD_KEY);
        if (value == null) {
            throw new IllegalStateException("an EXPORT job payload with no " + PAYLOAD_KEY
                    + " cannot be run without guessing which export it meant");
        }
        return String.valueOf(value);
    }

    public Outcome run(String workspaceId, String exportId, BooleanSupplier leaseHeld,
                       BooleanSupplier cancelled) {
        var export = exports.find(workspaceId, exportId);
        if (export.isEmpty()) {
            return Outcome.failed("EXPORT_NOT_FOUND", "the export row this job points at is gone,"
                    + " which means it was deleted while the job was queued");
        }
        var record = export.get();
        if (record.settled()) {
            // A reclaimed job whose export already finished is skipped, not rewritten: publishing a
            // second file of a different size would make the stored checksum describe neither.
            return Outcome.completed(Map.of("skipped", "the export had already finished in an"
                    + " earlier attempt", "fileBytes", record.fileBytes() == null ? 0
                    : record.fileBytes()));
        }
        if (cancelled.getAsBoolean()) {
            exports.cancel(record.id());
            return Outcome.failed("EXPORT_CANCELLED", "cancellation was requested before the export"
                    + " wrote anything");
        }

        var dataset = datasets.findById(workspaceId, record.datasetId());
        if (dataset.isEmpty()) {
            exports.fail(record.id(), "DATASET_NOT_FOUND", "the dataset this export was requested"
                    + " for is no longer readable");
            return Outcome.failed("DATASET_NOT_FOUND", "the dataset this export was requested for is"
                    + " no longer readable");
        }

        RowQuery scope = scopeOf(record.scopeJson());
        int total = queries.countRows(record.datasetId(), scope);
        int maxRows = properties.export().maxRows();
        if (total > maxRows) {
            // Refused with the number attached. Truncating into a file that looks complete is the
            // kind of quiet shortfall this rebuild was written to make impossible. The record carries
            // the same statement: a job that failed loudly beside a row still saying QUEUED would be
            // two answers to one question.
            String reason = "the dataset holds " + total + " rows and this deployment writes at most "
                    + maxRows + " per export";
            exports.fail(record.id(), "EXPORT_TOO_LARGE", reason);
            return Outcome.failed("EXPORT_TOO_LARGE", reason);
        }

        exports.markRunning(record.id(), total);
        Path target = fileFor(record);
        Path part = target.resolveSibling(target.getFileName() + ".part");
        // No floor applied here: StartupRequirementsValidator bounds the configured chunk between 1 and
        // 10000 and refuses one larger than the ceiling, so a deployment that wants a row at a time
        // gets a row at a time rather than a silent minimum nobody documented.
        int chunk = properties.export().chunkRows();
        int written = 0;
        try {
            Files.createDirectories(target.getParent());
            written = write(record, dataset.get(), scope, target, part, chunk, leaseHeld);
        } catch (Cancelled cancellation) {
            deleteQuietly(part);
            exports.cancel(record.id());
            return Outcome.failed("EXPORT_CANCELLED", "cancellation was requested while the export"
                    + " was writing; no file was published");
        } catch (LeaseLost lostLease) {
            deleteQuietly(part);
            return Outcome.failed("LEASE_LOST", "the lease was taken over mid-write; the partial file"
                    + " was discarded rather than published, so the new holder rewrites it cleanly");
        } catch (IOException failure) {
            deleteQuietly(part);
            log.warn("export {} failed: {}", record.id(), failure.getClass().getSimpleName());
            exports.fail(record.id(), "EXPORT_WRITE_FAILED",
                    failure.getClass().getSimpleName() + ": " + safe(failure.getMessage()));
            return Outcome.failed("EXPORT_WRITE_FAILED", "the export could not be written: "
                    + failure.getClass().getSimpleName());
        }

        long bytes = 0;
        String name = target.getFileName().toString();
        try {
            bytes = Files.size(target);
        } catch (IOException e) {
            log.warn("the published export {} could not be measured", name);
        }
        return Outcome.completed(Map.of("exportId", record.id(), "rowsWritten", written,
                "totalRows", total, "fileBytes", bytes, "fileName", name));
    }

    /** @return the rows written, having published the file and completed the record. */
    private int write(DatasetRows.Export record, DatasetRows.Dataset dataset, RowQuery scope,
                      Path target, Path part, int chunk, BooleanSupplier leaseHeld)
            throws IOException {
        List<DatasetRows.Column> columns = queries.columns(record.datasetId());
        int written = 0;
        try (OutputStream raw = Files.newOutputStream(part)) {
            ExportWriter writer = writerFor(record.format(), raw);
            writer.begin(columns, metaOf(record, dataset));
            while (true) {
                if (!leaseHeld.getAsBoolean()) {
                    throw new LeaseLost();
                }
                List<DatasetRows.Row> page = queries.rows(record.datasetId(),
                        scope.withWindow(written, chunk));
                if (page.isEmpty()) {
                    break;
                }
                for (DatasetRows.Row row : page) {
                    writer.write(rowOf(record.datasetId(), row));
                }
                written += page.size();
                // The advance is the checkpoint: it refuses to move a record someone has cancelled or
                // settled, which is how a long export stops without losing the file's integrity.
                if (!exports.advance(record.id(), written)) {
                    throw new Cancelled();
                }
                if (page.size() < chunk) {
                    break;
                }
            }
            long bytes = writer.finish();
            Files.move(part, target, StandardCopyOption.REPLACE_EXISTING);
            exports.complete(record.id(), written, target.getFileName().toString(),
                    target.toString(), bytes, checksum(target));
            log.info("export {} wrote {} row(s), {} bytes", record.id(), written, bytes);
            return written;
        }
    }

    /** The published file, named from the export id alone: a request never supplies a path. */
    public Path fileFor(DatasetRows.Export record) {
        String name = record.datasetId() + "-" + record.id().substring(0, 8) + "."
                + ExportFormat.of(record.format()).extension();
        return Path.of(properties.export().dir()).toAbsolutePath().normalize().resolve(name);
    }

    private static ExportWriter writerFor(String format, OutputStream target) {
        return switch (ExportFormat.of(format)) {
            case CSV -> new ExportWriter.Csv(target);
            case JSON -> new ExportWriter.JsonFile(target);
            case XLSX -> new ExportWriter.Xlsx(target);
        };
    }

    private static Map<String, Object> metaOf(DatasetRows.Export record,
                                              DatasetRows.Dataset dataset) {
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("exportId", record.id());
        meta.put("datasetId", record.datasetId());
        meta.put("runId", record.runId());
        meta.put("objective", dataset.objective());
        meta.put("entityType", dataset.entityType());
        meta.put("format", record.format());
        meta.put("qualityScore", dataset.qualityScore());
        meta.put("requestedAt", record.createdAt() == null ? null : record.createdAt().toString());
        return meta;
    }

    private ExportRow rowOf(String datasetId, DatasetRows.Row row) {
        return new ExportRow(row.recordIndex(), Json.object(row.valuesJson()),
                row.rawValuesJson() == null ? Map.of() : Json.object(row.rawValuesJson()),
                row.valid(), row.advisoryValid(), row.verificationStatus(), row.confidence(),
                row.duplicateOfRowId(), queries.rowSources(datasetId, row.id()),
                issuesOf(row.issuesJson()));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> issuesOf(String json) {
        Object parsed = Json.parse(json);
        return parsed instanceof List<?> list ? (List<Map<String, Object>>) list : List.of();
    }

    /**
     * The scope the requester asked for, re-read from the export row. A key the dataset does not
     * declare fails the job rather than quietly matching nothing: an export whose filter has drifted
     * from the listing it was copied from is a file nobody can trust.
     */
    private static RowQuery scopeOf(String scopeJson) {
        Map<String, Object> scope = Json.object(scopeJson);
        List<Filter> filters = new ArrayList<>();
        if (scope.get("filters") instanceof List<?> list) {
            for (Object item : list) {
                Map<String, Object> filter = Json.map(item);
                filters.add(new Filter(str(filter.get("key")),
                        filter.get("operator") == null ? "eq" : str(filter.get("operator")),
                        filter.get("value") == null ? null : str(filter.get("value"))));
            }
        }
        return new RowQuery(str(scope.get("search")), filters, str(scope.get("sort")),
                !Boolean.FALSE.equals(scope.get("asc")),
                scope.get("validOnly") instanceof Boolean flag ? flag : null,
                !Boolean.FALSE.equals(scope.get("includeDuplicates")), 0, 0);
    }

    private static String str(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static String checksum(Path file) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (var stream = Files.newInputStream(file)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = stream.read(buffer)) > 0) {
                    digest.update(buffer, 0, read);
                }
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IOException("SHA-256 is required to checksum an export", e);
        }
    }

    private static void deleteQuietly(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException e) {
            log.warn("the partial export file {} could not be removed: {}", path,
                    e.getClass().getSimpleName());
        }
    }

    private static String safe(String message) {
        if (message == null) {
            return "";
        }
        return message.length() > 500 ? message.substring(0, 500) : message;
    }

    /** Control flow, not a fault to report: both mean "stop, someone else decided first". */
    private static final class LeaseLost extends IOException {
        private static final long serialVersionUID = 1L;
    }

    private static final class Cancelled extends IOException {
        private static final long serialVersionUID = 1L;
    }
}
