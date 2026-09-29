package ai.finalagent.aiclient.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.Map;

/**
 * Structured result of a research run: records, the sources behind them, execution
 * metadata and the validation state that decides whether the run may be trusted.
 *
 * <p>{@code status} is never inferred by the caller: a run that exhausted its budget or
 * never satisfied the schema arrives as {@code FAILED} with a {@code failureReason}, and
 * a run that satisfied the schema but fell short of the expected record count arrives as
 * {@code COMPLETED_WITH_WARNINGS}. There is no field that a missing value defaults into.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ResearchResult(
        String status,
        List<Record> records,
        List<Source> sources,
        Map<String, Object> metadata,
        Validation validation,
        String failureReason
) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Record(Map<String, Object> values, List<Source> sources) {
    }

    /**
     * {@code citedByRecords} is only present on the run-level source list, where the aggregation
     * stage counts how many records rest on each source; a record's own {@code sources} carry no
     * count, so this stays null rather than defaulting to a number that would read as evidence.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Source(
            String url,
            String title,
            String snippet,
            String sourceType,
            String retrievedAt,
            Boolean verifiedByTool,
            Integer citedByRecords
    ) {
    }

    /**
     * Field order mirrors {@code app/research/graph.py:_validation} key for key, and the two list
     * shapes are not interchangeable: {@code refusedSources} carries an object per refusal, while
     * {@code recordsWithoutEvidence} carries record indices, not URLs.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Validation(
            Boolean schemaValid,
            List<String> missingFields,
            List<String> extraFields,
            Integer repairsUsed,
            Boolean critiqueSatisfactory,
            List<String> critiqueReasons,
            List<String> unverifiedUrls,
            List<Integer> recordsWithoutEvidence,
            Integer duplicateSourcesCollapsed,
            List<Refusal> refusedSources,
            List<Map<String, Object>> droppedCandidates,
            List<String> warnings
    ) {
    }

    /** A source the curation stage refused before fetching it — domain policy or robots, never a silent skip. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Refusal(String url, String code, String reason) {
    }
}
