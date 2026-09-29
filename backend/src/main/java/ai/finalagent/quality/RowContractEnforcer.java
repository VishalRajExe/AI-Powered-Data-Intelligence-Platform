package ai.finalagent.quality;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import ai.finalagent.aiclient.dto.QualityResult;
import ai.finalagent.aiclient.dto.QualityResult.Column;
import ai.finalagent.aiclient.dto.QualityResult.Record;

/**
 * Java's own reading of the records the pipeline returned. This is the gate the whole architecture
 * turns on: the AI service's verdict is advisory, and the side that owns the data checks the
 * contract itself.
 *
 * <p>It exists because of a specific historical failure. The replaced project persisted whatever the
 * agent claimed to have collected, so a schema only the model had vouched for became a dataset
 * ({@code docs/audit/00-FORENSIC-AUDIT.md} §1, §5). Here the same records are examined twice, by
 * two implementations that do not share code or assumptions, and any difference between the two
 * answers is reported as a finding rather than resolved by whichever ran last. That second reading
 * only stays independent if the spec it is measured against is Java's own: the field list comes from
 * the plan ({@link DeclaredContract}), never from the dataset columns the pipeline chose to emit.
 *
 * <p>It never edits a record and never drops one. A row Java rejects is rejected with a reason; the
 * value stays in the result so the shortfall is visible, which is the other half of the same
 * historical defect — {@code persistDataset} used to {@code continue} past rows without verified
 * sources, so a dataset could land short with no explanation anywhere
 * ({@code workflow-execution.repository.ts:271-272}).
 */
public final class RowContractEnforcer {

    private static final Pattern ISO_DATE = Pattern.compile("^\\d{4}(-\\d{2}(-\\d{2})?)?$");
    private static final Pattern ISO_DATE_TIME = Pattern.compile("^\\d{4}-\\d{2}(-\\d{2})?[T ]\\d{2}:\\d{2}");
    private static final Pattern ABSOLUTE_URL = Pattern.compile("^https?://\\S+$", Pattern.CASE_INSENSITIVE);
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s.]+@[^@\\s.]+(\\.[^@\\s.]+)+$");
    private static final Pattern CURRENCY_CODE = Pattern.compile("^[A-Z]{3}$");

    private static final String ERROR = "ERROR";
    private static final String WARNING = "WARNING";

    private RowContractEnforcer() {
    }

    /** One rejection or observation, tied to a record index and, where it applies, a field. */
    public record Finding(int recordIndex, String fieldKey, String ruleCode, String severity,
                          String message) {

        public Map<String, Object> asMap() {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("recordIndex", recordIndex);
            if (fieldKey != null) {
                map.put("fieldKey", fieldKey);
            }
            map.put("ruleCode", ruleCode);
            map.put("severity", severity);
            map.put("message", message);
            return map;
        }
    }

    /**
     * @param rowsChecked  canonical rows only — a linked duplicate is not a row of the dataset
     * @param advisoryOnly rows the pipeline called valid and Java does not, and the reverse. Both
     *                     directions matter: the first is a fabricated pass, the second is this
     *                     gate being stricter than it needs to be.
     * @param contractBasis where the field spec Java measured against came from: {@code plan} is the
     *                      strong case, {@code pipeline-columns} means the plan declared no fields
     *                      and Java had no choice but to check the dataset against itself.
     */
    public record Verdict(int rowsChecked, int valid, int invalid, int linkedDuplicates,
                          List<Finding> findings, List<Finding> advisoryOnly,
                          List<String> structuralFailures, String contractBasis) {

        public boolean clean() {
            return structuralFailures.isEmpty() && advisoryOnly.isEmpty();
        }

        public Map<String, Object> asSummary(int reportedLimit) {
            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("enforcedBy", "backend");
            summary.put("contractBasis", contractBasis);
            summary.put("rowsChecked", rowsChecked);
            summary.put("javaValid", valid);
            summary.put("javaInvalid", invalid);
            summary.put("linkedDuplicates", linkedDuplicates);
            summary.put("advisoryDisagreements", advisoryOnly.size());
            summary.put("structuralFailures", structuralFailures);
            summary.put("findings", findings.stream().limit(reportedLimit).map(Finding::asMap).toList());
            if (findings.size() > reportedLimit) {
                summary.put("findingsTruncated", true);
                summary.put("findingsTotal", findings.size());
            }
            return summary;
        }
    }

    public static Verdict enforce(QualityResult result, DeclaredContract contract) {
        List<Record> records = result.records() == null ? List.of() : result.records();
        Map<Integer, Record> byIndex = new LinkedHashMap<>();
        for (Record record : records) {
            byIndex.put(record.index(), record);
        }
        Set<Integer> rowIndexes = new HashSet<>();
        if (result.dataset() != null && result.dataset().rows() != null) {
            result.dataset().rows().forEach(row -> rowIndexes.add(row.recordIndex()));
        }

        List<Finding> findings = new ArrayList<>();
        List<Finding> advisoryOnly = new ArrayList<>();
        List<String> structural = new ArrayList<>();
        checkColumns(result, contract, structural);
        int valid = 0;
        int invalid = 0;
        int linked = 0;

        for (Record record : records) {
            if (record.duplicateOf() != null) {
                linked++;
                checkLink(record, byIndex, rowIndexes, findings);
                continue;
            }
            if (!rowIndexes.contains(record.index())) {
                structural.add("record " + record.index() + " is neither a dataset row nor linked to "
                        + "one, so it would vanish from the dataset without being recorded anywhere");
            }
            List<Finding> rowFindings = new ArrayList<>();
            checkRequired(record, contract.required(), rowFindings);
            checkValueKeys(record, contract, rowFindings);
            checkEvidence(record, rowFindings);
            checkConflicts(record, rowFindings);
            findings.addAll(rowFindings);
            boolean javaSaysValid = rowFindings.stream()
                    .noneMatch(finding -> ERROR.equals(finding.severity()));
            if (javaSaysValid) {
                valid++;
            } else {
                invalid++;
            }
            if (javaSaysValid != record.isValid()) {
                advisoryOnly.add(new Finding(record.index(), null,
                        record.isValid() ? "ADVISORY_PASSED_HERE_REJECTED" : "ADVISORY_REJECTED_HERE_PASSED",
                        WARNING,
                        "the pipeline reported isValid=" + record.isValid() + " and Java reports "
                                + javaSaysValid));
            }
        }

        return new Verdict(valid + invalid, valid, invalid, linked, List.copyOf(findings),
                List.copyOf(advisoryOnly), List.copyOf(structural), contract.basis());
    }

    /**
     * The dataset's shape against the plan's field list. A required field with no column cannot be
     * read by anything that consumes the dataset, and a column the pipeline marked required that the
     * plan never asked for is the pipeline inventing a constraint. Both are faults of the result as a
     * whole, so they are structural rather than per-row.
     */
    private static void checkColumns(QualityResult result, DeclaredContract contract,
                                     List<String> structural) {
        if (!"plan".equals(contract.basis()) || contract.keys().isEmpty() || result.dataset() == null
                || result.dataset().columns() == null) {
            return;
        }
        Map<String, Column> byKey = new LinkedHashMap<>();
        for (Column column : result.dataset().columns()) {
            byKey.put(DeclaredContract.fold(column.key()), column);
        }
        for (String key : contract.required()) {
            if (byKey.containsKey(key)) {
                continue;
            }
            structural.add("the plan requires '" + key + "' but the dataset declares no column for "
                    + "it, so nothing reading the dataset can find that field");
        }
        byKey.forEach((key, column) -> {
            if (column.required() && !contract.required().contains(key)) {
                structural.add("the dataset marks column '" + key + "' required, which the plan never "
                        + "asked for");
            }
        });
    }

    /**
     * A linked duplicate must point at a row that is itself canonical, and must not appear in the
     * dataset. Anything else means the "linked, never deleted" claim has quietly become "deleted":
     * a link to a row that is also a link leaves the value with no home, and a link that still
     * appears as a row counts the same entity twice.
     */
    private static void checkLink(Record duplicate, Map<Integer, Record> byIndex,
                                  Set<Integer> rowIndexes, List<Finding> findings) {
        Record canonical = byIndex.get(duplicate.duplicateOf());
        if (canonical == null) {
            findings.add(new Finding(duplicate.index(), null, "DUPLICATE_LINK_BROKEN", ERROR,
                    "linked to record " + duplicate.duplicateOf() + ", which is not in the result"));
        } else if (canonical.duplicateOf() != null) {
            findings.add(new Finding(duplicate.index(), null, "DUPLICATE_LINK_DANGLING", ERROR,
                    "linked to record " + duplicate.duplicateOf() + ", which is itself linked on to "
                            + "another row"));
        }
        if (rowIndexes.contains(duplicate.index())) {
            findings.add(new Finding(duplicate.index(), null, "DUPLICATE_IS_ALSO_A_ROW", ERROR,
                    "is linked to another record and still appears as a dataset row"));
        }
    }

    private static void checkRequired(Record record, Set<String> requiredFields,
                                      List<Finding> findings) {
        for (String field : requiredFields) {
            if (isAbsent(record.values().get(field))) {
                findings.add(new Finding(record.index(), field, "REQUIRED", ERROR,
                        "required field is absent or empty after normalization"));
            }
        }
    }

    /**
     * Every value key is accounted for against <em>Java's</em> contract. A key the plan never
     * declared is reported but not deleted — the pipeline's own rule is that nothing is dropped, and
     * a value nobody asked for may still be the truest thing in the row. It is not type-checked
     * either: there is no declared type to violate, and inventing one from "it looked like a string"
     * would turn a free-text field into an error the caller cannot fix.
     */
    private static void checkValueKeys(Record record, DeclaredContract contract,
                                       List<Finding> findings) {
        for (Map.Entry<String, Object> entry : record.values().entrySet()) {
            String key = DeclaredContract.fold(entry.getKey());
            if (!contract.hasKey(key)) {
                findings.add(new Finding(record.index(), entry.getKey(), "EXTRA_FIELD", WARNING,
                        "the plan declares no such field; kept, and reported"));
                continue;
            }
            findings.addAll(typeFindings(record.index(), entry.getKey(), entry.getValue(),
                    contract.typeOf(key)));
        }
    }

    /**
     * The rules one declared type imposes on one value. A list, because a currency can be wrong in
     * two independent ways at once — a unit that is not an ISO-4217 code <em>and</em> an amount that
     * is not a number — and reporting only the first is how fixing one leaves the other in the
     * dataset with nothing said about it.
     */
    private static List<Finding> typeFindings(int index, String key, Object value, String type) {
        if (isAbsent(value) || type.isEmpty()) {
            return List.of();
        }
        if ("CURRENCY".equals(type)) {
            return currencyFindings(index, key, value);
        }
        Finding single = switch (type) {
            case "NUMBER" -> value instanceof Number ? null
                    : new Finding(index, key, "TYPE", ERROR, text(value));
            case "BOOLEAN" -> value instanceof Boolean ? null
                    : new Finding(index, key, "TYPE", ERROR, text(value));
            case "STRING", "PHONE" -> value instanceof String ? null
                    : new Finding(index, key, "TYPE", ERROR, text(value));
            case "URL" -> value instanceof String url && ABSOLUTE_URL.matcher(url).matches() ? null
                    : new Finding(index, key, "FORMAT_URL", ERROR, text(value));
            case "EMAIL" -> value instanceof String email && EMAIL.matcher(email).matches() ? null
                    : new Finding(index, key, "FORMAT_EMAIL", ERROR, text(value));
            case "DATE" -> value instanceof String date && ISO_DATE.matcher(date).matches() ? null
                    : new Finding(index, key, "FORMAT_DATE", ERROR, text(value));
            case "DATETIME" -> value instanceof String dateTime
                    && ISO_DATE_TIME.matcher(dateTime).matches() ? null
                    : new Finding(index, key, "FORMAT_DATETIME", ERROR, text(value));
            default -> null;
        };
        return single == null ? List.of() : List.of(single);
    }

    private static List<Finding> currencyFindings(int index, String key, Object value) {
        if (!(value instanceof Map<?, ?> amount)) {
            return List.of(new Finding(index, key, "TYPE", ERROR, text(value)));
        }
        List<Finding> findings = new ArrayList<>();
        Object unit = amount.get("currency");
        if (unit != null && !CURRENCY_CODE.matcher(String.valueOf(unit)).matches()) {
            findings.add(new Finding(index, key, "CURRENCY_CODE", ERROR,
                    "currency is " + unit + ", which is not an ISO-4217 code"));
        }
        Object numeric = amount.get("amount");
        if (numeric != null && !(numeric instanceof Number)) {
            findings.add(new Finding(index, key, "TYPE", ERROR,
                    "the amount is " + text(numeric) + ", which is not a number"));
        }
        return findings;
    }

    /** A row with no tool-observed source cannot be checked against anything, so it is not valid. */
    private static void checkEvidence(Record record, List<Finding> findings) {
        List<QualityResult.Source> sources = record.sources() == null ? List.of() : record.sources();
        if (sources.isEmpty()) {
            findings.add(new Finding(record.index(), null, "SOURCE_EVIDENCE", ERROR,
                    "the record cites no source at all"));
            return;
        }
        boolean verified = sources.stream().anyMatch(QualityResult.Source::verifiedByTool);
        if (!verified) {
            findings.add(new Finding(record.index(), null, "SOURCE_EVIDENCE_UNVERIFIED", ERROR,
                    "every cited source was reported by the model and none was returned by a tool"));
        }
    }

    /**
     * The point of the conflict stage is that the losing value survives. A conflict that lost its
     * rejected value is indistinguishable from a silent overwrite, which is the failure the whole
     * stage exists to prevent — so it is checked structurally, not trusted.
     */
    private static void checkConflicts(Record record, List<Finding> findings) {
        if (record.conflicts() == null) {
            return;
        }
        record.conflicts().forEach(conflict -> {
            if (conflict.rejectedValue() == null) {
                findings.add(new Finding(record.index(), conflict.fieldKey(), "CONFLICT_NOT_PRESERVED",
                        ERROR, "the losing value is absent, so this reads as an overwrite"));
            }
            if (conflict.resolvedBy() == null || conflict.resolvedBy().isBlank()) {
                findings.add(new Finding(record.index(), conflict.fieldKey(), "CONFLICT_UNEXPLAINED",
                        WARNING, "no rule is named for how the winner was chosen"));
            }
            if (conflict.keptSources() == null || conflict.keptSources().isEmpty()
                    || conflict.rejectedSources() == null || conflict.rejectedSources().isEmpty()) {
                findings.add(new Finding(record.index(), conflict.fieldKey(), "CONFLICT_PROVENANCE_LOST",
                        ERROR, "both values must carry the sources they came from"));
            }
        });
    }

    private static boolean isAbsent(Object value) {
        if (value == null) {
            return true;
        }
        if (value instanceof String text) {
            return text.isBlank();
        }
        if (value instanceof Map<?, ?> map) {
            return map.isEmpty() || (map.get("amount") == null && map.get("currency") == null);
        }
        if (value instanceof List<?> list) {
            return list.isEmpty();
        }
        return false;
    }

    private static String text(Object value) {
        String rendered = value == null ? "null" : (value instanceof String string
                ? "'" + string + "'" : value + " (" + value.getClass().getSimpleName() + ")");
        return rendered.length() > 160 ? rendered.substring(0, 157) + "..." : rendered;
    }
}
