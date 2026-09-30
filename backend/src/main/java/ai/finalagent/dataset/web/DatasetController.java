package ai.finalagent.dataset.web;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import ai.finalagent.common.ErrorResponse;
import ai.finalagent.dataset.repository.DatasetQueryRepository.Filter;
import ai.finalagent.dataset.repository.DatasetQueryRepository.UnknownColumnException;
import ai.finalagent.dataset.service.DatasetService;

/**
 * The dataset API: what a run saved, what is in it, and where every value came from.
 *
 * <p>Read-only, because nothing here is edited by hand. A dataset is the output of a run under a
 * contract, and an endpoint that could change a row would create a value with no run, no verdict and
 * no source — the exact thing the evidence endpoints exist to make impossible to produce.
 *
 * <p>Unauthenticated like the rest of the API today, and single-workspace by configuration; both are
 * the authentication phase's outstanding work, recorded rather than solved here.
 *
 * <p><b>Filtering syntax.</b> {@code filter=<key>:<operator>:<value>}, repeated, with operators
 * {@code eq}, {@code contains}, {@code gte}, {@code lte}, {@code missing}, {@code present}. The key is
 * checked against the dataset's own columns before it reaches SQL, so a filter on a field that does
 * not exist is a 400 naming the columns that do rather than a scan that returns nothing.
 */
@RestController
@RequestMapping("/api/v1/datasets")
public class DatasetController {

    private final DatasetService service;

    public DatasetController(DatasetService service) {
        this.service = service;
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String status,
                                    @RequestParam(required = false) String workflowId,
                                    @RequestParam(defaultValue = "20") int limit,
                                    @RequestParam(defaultValue = "0") int page) {
        return service.list(status, workflowId, limit, page);
    }

    @GetMapping("/{id}")
    public Map<String, Object> details(@PathVariable String id) {
        return service.details(id);
    }

    @GetMapping("/{id}/schema")
    public Map<String, Object> schema(@PathVariable String id) {
        return service.schema(id);
    }

    @GetMapping("/{id}/rows")
    public Map<String, Object> rows(@PathVariable String id,
                                    @RequestParam(required = false) String q,
                                    @RequestParam(required = false) List<String> filter,
                                    @RequestParam(required = false) String sort,
                                    @RequestParam(defaultValue = "true") boolean asc,
                                    @RequestParam(required = false) Boolean validOnly,
                                    @RequestParam(defaultValue = "true") boolean includeDuplicates,
                                    @RequestParam(defaultValue = "50") int pageSize,
                                    @RequestParam(defaultValue = "0") int page) {
        return service.rows(id, q, filters(filter), sort, asc, validOnly, includeDuplicates,
                pageSize, page);
    }

    @GetMapping("/{id}/search")
    public Map<String, Object> search(@PathVariable String id,
                                      @RequestParam String q,
                                      @RequestParam(defaultValue = "50") int pageSize,
                                      @RequestParam(defaultValue = "0") int page) {
        return service.search(id, q, pageSize, page);
    }

    @GetMapping("/{id}/filters")
    public Map<String, Object> filters(@PathVariable String id,
                                       @RequestParam(required = false) List<String> key) {
        return service.filters(id, key);
    }

    @GetMapping("/{id}/sources")
    public Map<String, Object> sources(@PathVariable String id,
                                       @RequestParam(required = false) Boolean verified,
                                       @RequestParam(required = false) String domain,
                                       @RequestParam(required = false) String q,
                                       @RequestParam(defaultValue = "50") int pageSize,
                                       @RequestParam(defaultValue = "0") int page) {
        return service.sources(id, verified, domain, q, pageSize, page);
    }

    @GetMapping("/{id}/sources/{sourceId}/rows")
    public Map<String, Object> sourceRows(@PathVariable String id, @PathVariable String sourceId,
                                          @RequestParam(defaultValue = "50") int pageSize,
                                          @RequestParam(defaultValue = "0") int page) {
        return service.sourceRows(id, sourceId, pageSize, page);
    }

    @GetMapping("/{id}/evidence")
    public Map<String, Object> evidence(@PathVariable String id) {
        return service.evidence(id);
    }

    @GetMapping("/{id}/rows/{rowId}/evidence")
    public Map<String, Object> rowEvidence(@PathVariable String id, @PathVariable String rowId) {
        return service.rowEvidence(id, rowId);
    }

    // ------------------------------------------------------------------ parameters

    /**
     * The repeated {@code filter=key:operator:value} parameter, parsed by the grammar's own owner so a
     * listing and an export of that listing cannot mean different things.
     */
    private static List<Filter> filters(List<String> raw) {
        if (raw == null || raw.isEmpty()) {
            return List.of();
        }
        List<Filter> filters = new ArrayList<>();
        for (String clause : raw) {
            if (clause != null && !clause.isBlank()) {
                filters.add(Filter.parse(clause));
            }
        }
        return filters;
    }

    // ------------------------------------------------------------------ errors

    @ExceptionHandler(DatasetService.UnknownDatasetException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse unknown(DatasetService.UnknownDatasetException e) {
        return ErrorResponse.of("DATASET_NOT_FOUND", e.getMessage());
    }

    @ExceptionHandler(DatasetService.UnknownRowException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse unknown(DatasetService.UnknownRowException e) {
        return ErrorResponse.of("ROW_NOT_FOUND", e.getMessage());
    }

    @ExceptionHandler(DatasetService.UnknownSourceException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse unknown(DatasetService.UnknownSourceException e) {
        return ErrorResponse.of("SOURCE_NOT_FOUND", e.getMessage());
    }

    @ExceptionHandler({UnknownColumnException.class, IllegalArgumentException.class})
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse badRequest(RuntimeException e) {
        // A filter on a column the dataset does not have is a caller mistake with a correctable
        // answer, so it says which columns exist instead of returning an empty page.
        return ErrorResponse.of("INVALID_DATASET_QUERY", e.getMessage());
    }
}
