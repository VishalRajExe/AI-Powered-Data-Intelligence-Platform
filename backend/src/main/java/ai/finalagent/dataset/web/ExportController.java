package ai.finalagent.dataset.web;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import ai.finalagent.common.ErrorResponse;
import ai.finalagent.dataset.domain.DatasetRows;
import ai.finalagent.dataset.export.ExportFormat;
import ai.finalagent.dataset.repository.DatasetQueryRepository.Filter;
import ai.finalagent.dataset.repository.DatasetQueryRepository.RowQuery;
import ai.finalagent.dataset.repository.DatasetQueryRepository.UnknownColumnException;
import ai.finalagent.dataset.service.ExportService;
import ai.finalagent.workflow.domain.Records.Job;

/**
 * Export requests, their history, and the files the queue wrote for them.
 *
 * <p>A POST here does not produce a file. It produces a row and a job, and returns before any byte is
 * written — which is the whole point of the phase. The project this replaced generated the file inside
 * the request and kept the job's state in an in-process promise, so a deploy mid-export stranded the
 * record in {@code RUNNING} with nobody able to recover it
 * ({@code export.service.ts:41-53}, {@code 00-FORENSIC-AUDIT.md} §5).
 *
 * <p>The scope is the same grammar the rows listing uses, so an export of a filtered view means the
 * filter the user was looking at rather than an approximation of it. A caller may also ask for the
 * whole dataset by sending nothing.
 */
@RestController
@RequestMapping("/api/v1")
public class ExportController {

    private final ExportService exports;

    public ExportController(ExportService exports) {
        this.exports = exports;
    }

    /**
     * @param format csv, json or xlsx, case-insensitive
     * @param filters the same {@code key:operator:value} clauses the rows endpoint takes
     */
    public record ExportRequest(String format, String search, List<String> filters, String sort,
                                Boolean asc, Boolean validOnly, Boolean includeDuplicates) {
    }

    @PostMapping("/datasets/{id}/exports")
    public ResponseEntity<Map<String, Object>> request(@PathVariable String id,
                                                       @RequestBody ExportRequest request) {
        DatasetRows.Export export = exports.request(id, request.format(), scope(request));
        return ResponseEntity.accepted().body(Map.of(
                "export", view(export),
                "statusUrl", "/api/v1/exports/" + export.id(),
                "downloadUrl", "/api/v1/exports/" + export.id() + "/download",
                "note", "queued, not written: the file appears when the worker has written every row"));
    }

    @GetMapping("/exports")
    public Map<String, Object> list(@RequestParam(required = false) String datasetId,
                                    @RequestParam(defaultValue = "20") int limit,
                                    @RequestParam(defaultValue = "0") int page) {
        int size = Math.min(Math.max(limit, 1), 100);
        int offset = Math.max(page, 0) * size;
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("exports", exports.list(datasetId, size, offset).stream()
                .map(ExportController::view).toList());
        body.put("total", exports.count(datasetId));
        body.put("page", Math.max(page, 0));
        body.put("pageSize", size);
        return body;
    }

    @GetMapping("/exports/{id}")
    public Map<String, Object> get(@PathVariable String id) {
        DatasetRows.Export export = exports.require(id);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("export", view(export));
        body.put("job", export.jobId() == null ? null
                : exports.job(export.jobId()).map(ExportController::view).orElse(null));
        return body;
    }

    /**
     * The finished file.
     *
     * <p>409 rather than 404 while the export is still working: the record exists and is progressing,
     * and "not yet" is a different fact from "not there". The digest travels as a header so a caller can
     * check what arrived against what the writer measured.
     */
    @GetMapping("/exports/{id}/download")
    public ResponseEntity<?> download(@PathVariable String id) throws IOException {
        DatasetRows.Export export = exports.require(id);
        if (!"COMPLETED".equals(export.status())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(ErrorResponse.of(
                    "EXPORT_NOT_COMPLETED", "the export is " + export.status().toLowerCase()
                            + " at " + export.progressPercent() + "%; its file is published only when"
                            + " the writer finishes"));
        }
        Path path = exports.file(export).orElseThrow(() ->
                new ExportService.UnreadableExportException(id, null));
        ExportFormat format = ExportFormat.of(export.format());
        FileSystemResource file = new FileSystemResource(path);
        // The length is measured from the file being served, not from the row: a row that says one
        // size and sends another is exactly the discrepancy the stored checksum is here to catch.
        ResponseEntity.BodyBuilder builder = ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + safeName(export.fileName()) + "\"")
                .header(HttpHeaders.CONTENT_TYPE, format.contentType())
                .header(HttpHeaders.CONTENT_LENGTH, String.valueOf(file.contentLength()));
        if (export.checksum() != null) {
            builder.header("X-Content-Sha256", export.checksum());
        }
        return builder.body(file);
    }

    @PostMapping("/exports/{id}/cancel")
    public Map<String, Object> cancel(@PathVariable String id) {
        boolean cancelled = exports.cancel(id);
        return Map.of("export", view(exports.require(id)), "cancelled", cancelled,
                "note", cancelled ? "the record and, if it had not started, its job are cancelled"
                        : "the export had already finished, so there was nothing to cancel");
    }

    // ------------------------------------------------------------------ parameters

    /**
     * The requested scope, in the shape the runner re-reads from the row.
     *
     * <p>No window: an export writes the whole match, so the page the caller happened to be looking at
     * is not part of the scope. {@code limit}/{@code offset} on the query are left at zero and the
     * runner's own chunking drives the read.
     */
    private static RowQuery scope(ExportRequest request) {
        List<Filter> filters = new ArrayList<>();
        if (request.filters() != null) {
            request.filters().stream().filter(c -> c != null && !c.isBlank())
                    .map(Filter::parse).forEach(filters::add);
        }
        return new RowQuery(request.search(), filters, request.sort(),
                !Boolean.FALSE.equals(request.asc()),
                request.validOnly(),
                !Boolean.FALSE.equals(request.includeDuplicates()), 0, 0);
    }

    private static String safeName(String stored) {
        return stored == null || stored.isBlank() ? "export" : stored.replace("\"", "");
    }

    // ------------------------------------------------------------------ views

    /**
     * The export as a caller sees it.
     *
     * <p>{@code progressPercent} is the queue's measurement, not this layer's estimate, and it is
     * accompanied by the two counts it came from — a percentage alone would be the same kind of bare
     * assertion the previous build made.
     */
    private static Map<String, Object> view(DatasetRows.Export export) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", export.id());
        view.put("datasetId", export.datasetId());
        view.put("runId", export.runId());
        view.put("jobId", export.jobId());
        view.put("format", export.format());
        view.put("status", export.status());
        view.put("totalRows", export.totalRows());
        view.put("writtenRows", export.writtenRows());
        view.put("progressPercent", export.progressPercent());
        view.put("fileName", export.fileName());
        view.put("fileBytes", export.fileBytes());
        view.put("checksum", export.checksum());
        view.put("createdAt", export.createdAt());
        view.put("startedAt", export.startedAt());
        view.put("finishedAt", export.finishedAt());
        view.put("error", export.errorCode() == null ? null
                : Map.of("code", export.errorCode(), "message",
                        export.errorMessage() == null ? "" : export.errorMessage()));
        return view;
    }

    private static Map<String, Object> view(Job job) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", job.id());
        view.put("status", job.status().name());
        view.put("attemptCount", job.attemptCount());
        view.put("maxAttempts", job.maxAttempts());
        view.put("workerId", job.workerId());
        view.put("leaseExpiresAt", job.leaseExpiresAt());
        view.put("scheduledFor", job.scheduledFor());
        view.put("errorCode", job.lastErrorCode());
        view.put("errorMessage", job.lastErrorMessage());
        return view;
    }

    // ------------------------------------------------------------------ errors

    @ExceptionHandler(ExportService.UnknownExportException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse unknown(ExportService.UnknownExportException e) {
        // A foreign export id and an absent one answer alike, as everywhere else in this API.
        return ErrorResponse.of("EXPORT_NOT_FOUND", e.getMessage());
    }

    @ExceptionHandler(ExportService.UnreadableExportException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse unreadable(ExportService.UnreadableExportException e) {
        return ErrorResponse.of("EXPORT_FILE_MISSING", e.getMessage());
    }

    @ExceptionHandler({UnknownColumnException.class, IllegalArgumentException.class})
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse badRequest(RuntimeException e) {
        return ErrorResponse.of("INVALID_EXPORT_SCOPE", e.getMessage());
    }
}
