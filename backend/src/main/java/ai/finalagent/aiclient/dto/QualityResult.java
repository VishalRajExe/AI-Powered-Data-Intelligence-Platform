package ai.finalagent.aiclient.dto;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Response of {@code POST /ai/v1/quality/process}: the pipeline's records with their provenance,
 * the dataset it assembled, one report per stage, and the quality counts.
 *
 * <p><b>This is an advisory answer, and Java does not take it on trust.</b>
 * {@code ai.finalagent.quality.RowContractEnforcer} re-derives required fields, type conformance
 * and evidence presence from the same records, and a disagreement between the two verdicts is
 * reported rather than resolved by whichever ran last. That duplication is the architecture: the
 * side that owns the data checks the contract itself
 * ({@code docs/audit/A-final-architecture.md} §A.2, "Python proposes, Java disposes").
 *
 * <p>Two shapes are load-bearing and easy to get wrong, so they are pinned by
 * {@code QualityWireContractTest}:
 * <ul>
 *   <li>{@code isValid} is annotated because a record component whose accessor reads as a boolean
 *   getter can be bound to the wrong property name, and a silently-absent validity flag would
 *   default to false in some readers and true in others.</li>
 *   <li>{@code confidence}, {@code duplicateOf} and {@code qualityScore} are boxed and nullable:
 *   absent means the pipeline measured nothing, and a primitive would invent a zero.</li>
 * </ul>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record QualityResult(
        String status,
        List<Record> records,
        Dataset dataset,
        List<Stage> stages,
        Quality quality,
        List<String> warnings,
        String failureReason
) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Record(
            int index,
            Map<String, Object> values,
            Map<String, Object> rawValues,
            List<Source> sources,
            @JsonProperty("isValid") boolean isValid,
            List<Issue> issues,
            String verificationStatus,
            Evidence evidence,
            Double confidence,
            Integer duplicateOf,
            String duplicateKey,
            String matchType,
            boolean reviewRequired,
            List<String> reviewReasons,
            List<Conflict> conflicts,
            List<String> normalizationNotes
    ) {
    }

    /** A source as the collection run observed it. The list is provenance; nothing here is dropped. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Source(
            String url,
            String title,
            String snippet,
            String sourceType,
            String retrievedAt,
            boolean verifiedByTool
    ) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Issue(String ruleCode, String severity, String message, String fieldKey) {
    }

    /** Counts only. A record's backing is a fact about its sources, not a formula over them. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Evidence(
            int sourceCount,
            int verifiedSourceCount,
            int unverifiedSourceCount,
            int distinctDomains,
            int fieldsWithEvidence
    ) {
    }

    /**
     * Two sources disagreed and both values survived. {@code resolvedBy} names the rule that chose
     * — evidence count, recency, or canonical position — because a conflict settled by an unnamed
     * rule is indistinguishable from one settled arbitrarily.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Conflict(
            String fieldKey,
            Object keptValue,
            Object rejectedValue,
            List<String> keptSources,
            List<String> rejectedSources,
            String resolvedBy
    ) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Column(String key, String label, String type, boolean required, int position) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Row(int recordIndex, Map<String, Object> values) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Dataset(List<Column> columns, List<Row> rows) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Stage(
            String stage,
            String status,
            int inputCount,
            int outputCount,
            Map<String, Object> metrics,
            List<String> notes,
            String error
    ) {
    }

    /**
     * The quality report. {@code scoreBasis} and {@code scoreComponents} travel with the score on
     * purpose: the number is an equal-weight mean of five measured ratios, and presenting it
     * without that sentence is how a formula gets read as a measurement.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Quality(
            int rawCount,
            int normalizedCount,
            int validCount,
            int invalidCount,
            int duplicateCount,
            int reviewRequiredCount,
            int conflictCount,
            int sourceBackedCount,
            Double qualityScore,
            String scoreBasis,
            Map<String, Double> scoreComponents,
            Map<String, Object> metrics
    ) {
    }
}
