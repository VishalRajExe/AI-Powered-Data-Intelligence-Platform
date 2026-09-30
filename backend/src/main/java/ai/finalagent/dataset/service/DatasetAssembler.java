package ai.finalagent.dataset.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import ai.finalagent.aiclient.dto.QualityResult;
import ai.finalagent.dataset.domain.DatasetDraft;
import ai.finalagent.quality.DeclaredContract;
import ai.finalagent.workflow.support.Json;

/**
 * Assembling a dataset from what a run produced. Pure function, no database, no clock.
 *
 * <p>The schema is derived, never assumed. Columns come from the plan's own declared field list
 * first, then the pipeline's reported dataset columns, then any key the records actually contain —
 * so a run about funded companies and a run about podcast episodes produce different columns from the
 * same code, and a value the web supplied that nobody declared is kept as a column rather than
 * dropped. Nothing in this file knows a word about startups, channels, jobs or any other entity.
 *
 * <p>Two decisions are load-bearing and stated here rather than in a comment at the call site:
 *
 * <ul>
 *   <li><b>Java's verdict wins, and its absence is not a pass.</b> A row the validating step did not
 *       judge is saved invalid. Defaulting an unjudged row to valid would make the authoritative gate
 *       the one that fails open.</li>
 *   <li><b>Field-level evidence is only written when the attribution is real.</b> A row citing three
 *       pages does not make all three the provenance of every field in it. A field gets a source when
 *       its own value <em>is</em> that page's URL <em>and</em> a tool returned that page during the
 *       run; everything else is row-level backing, which the API reports as row-level.</li>
 * </ul>
 */
public final class DatasetAssembler {

    /** The row's identity: what produced it, and which run and step it came from. */
    public record Origin(String workspaceId, String runId, String workflowId, String planId,
                         String stepId, String objective, String requirementText, String entityType,
                         Map<String, Object> extractionSchema) {
    }

    private DatasetAssembler() {
    }

    /**
     * @param javaVerdictByIndex record index → Java's own validity verdict. A record missing from this
     *                           map was never judged by the authoritative gate and is saved invalid.
     * @param refusedSources     the collection's policy refusals, kept so "the site said no" and
     *                           "we never asked" stay distinguishable inside the dataset
     */
    public static DatasetDraft assemble(Origin origin, QualityResult produced,
                                         Map<Integer, Boolean> javaVerdictByIndex,
                                         DeclaredContract contract, List<Map<String, Object>> refusedSources) {
        List<QualityResult.Record> records = produced.records() == null ? List.of() : produced.records();
        Map<String, Integer> populated = new LinkedHashMap<>();
        Set<String> keys = new LinkedHashSet<>();

        for (QualityResult.Record record : records) {
            record.values().forEach((key, value) -> {
                keys.add(key);
                if (!absent(value)) {
                    populated.merge(key, 1, Integer::sum);
                }
            });
        }

        DatasetDraft.Builder builder = new DatasetDraft.Builder(new DatasetDraft.Header(
                origin.workspaceId(), origin.runId(), origin.workflowId(), origin.planId(),
                origin.stepId(), origin.objective(), origin.requirementText(), origin.entityType(),
                Json.write(origin.extractionSchema()),
                records.isEmpty() ? "EMPTY" : "READY",
                produced.quality() == null ? null : produced.quality().scoreBasis(),
                produced.quality() == null ? null : Json.write(Map.of(
                        "scoreComponents", nz(produced.quality().scoreComponents()),
                        "metrics", nz(produced.quality().metrics()))),
                produced.quality() == null ? null : produced.quality().qualityScore()));

        columnsOf(contract, produced, keys, populated).forEach(builder::column);
        Map<String, String> urlTypes = urlTypedKeys(contract, produced);

        for (QualityResult.Record record : records) {
            builder.row(rowOf(record, javaVerdictByIndex, urlTypes));
        }
        // Every source the records cite, then every page this run was refused. A refused page is a
        // fact about the dataset's limits, and a caller asking why a field is empty needs it.
        records.stream().flatMap(record -> nz(record.sources()).stream())
                .forEach(source -> builder.source(sourceOf(source.url(), source.title(),
                        source.snippet(), source.sourceType(), source.retrievedAt(),
                        source.verifiedByTool(), "TOOL_RETURNED", null, null)));
        for (Map<String, Object> refusal : nz(refusedSources)) {
            Object url = refusal.get("url");
            if (url == null || String.valueOf(url).isBlank()) {
                continue;
            }
            builder.source(sourceOf(String.valueOf(url), null, null, "search", null, false,
                    "REFUSED_BEFORE_FETCH", str(refusal.get("code")), str(refusal.get("reason"))));
        }
        return builder.build();
    }

    // ------------------------------------------------------------------------ columns

    /**
     * Declared first, in the plan's own order; then the pipeline's columns; then keys only the data
     * has. Each is labelled with where the declaration came from, because "the plan asked for it" and
     * "a page happened to contain it" are different answers when someone questions a column.
     *
     * <p>{@code populated} counts rows carrying a non-empty value, over every record including
     * duplicates — a listing that showed a column as empty because its values only survived on rows it
     * chose not to count would be a lie about the data.
     */
    private static List<DatasetDraft.DraftColumn> columnsOf(DeclaredContract contract,
                                                            QualityResult produced, Set<String> present,
                                                            Map<String, Integer> populated) {
        List<DatasetDraft.DraftColumn> columns = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        int position = 0;

        for (String key : contract.keys()) {
            if (!seen.add(key)) {
                continue;
            }
            String type = contract.typeOf(key).isEmpty() ? "STRING" : contract.typeOf(key);
            columns.add(new DatasetDraft.DraftColumn(key, key, type,
                    contract.required().contains(key), position++, "PLAN", null,
                    populated.getOrDefault(key, 0)));
        }
        if (produced.dataset() != null) {
            for (QualityResult.Column column : nz(produced.dataset().columns())) {
                String key = DeclaredContract.fold(column.key());
                if (!seen.add(key)) {
                    continue;
                }
                columns.add(new DatasetDraft.DraftColumn(key, column.label(),
                        column.type() == null ? "STRING" : column.type(), column.required(), position++,
                        "PIPELINE", null, populated.getOrDefault(key, 0)));
            }
        }
        for (String key : new ArrayList<>(present)) {
            if (!seen.add(key)) {
                continue;
            }
            columns.add(new DatasetDraft.DraftColumn(key, key, "STRING", false, position++, "DATA",
                    null, populated.getOrDefault(key, 0)));
        }
        return columns;
    }

    private static Map<String, String> urlTypedKeys(DeclaredContract contract, QualityResult produced) {
        Map<String, String> types = new LinkedHashMap<>();
        contract.keys().forEach(key -> types.put(key, contract.typeOf(key)));
        if (produced.dataset() != null) {
            nz(produced.dataset().columns()).forEach(column ->
                    types.putIfAbsent(DeclaredContract.fold(column.key()), column.type()));
        }
        return types;
    }

    // ---------------------------------------------------------------------------- rows

    private static DatasetDraft.DraftRow rowOf(QualityResult.Record record,
                                               Map<Integer, Boolean> javaVerdictByIndex,
                                               Map<String, String> urlTypes) {
        List<String> sourceHashes = new ArrayList<>(record.sources() == null ? List.of()
                : record.sources().stream().map(source -> canonicalHash(source.url())).distinct().toList());
        Map<String, Object> values = nz(record.values());

        List<DatasetDraft.DraftEvidence> evidence = new ArrayList<>();
        // Only a page a tool actually returned can carry a field. A row's own URL field naming a page
        // nobody fetched is a citation, not a trace: attributing it would turn the model's mention
        // into verified provenance, which is the one fabrication this layer must never make.
        Map<String, Boolean> verifiedByHash = new LinkedHashMap<>();
        nz(record.sources()).forEach(source -> verifiedByHash.putIfAbsent(canonicalHash(source.url()),
                source.verifiedByTool()));
        values.forEach((key, value) -> {
            if (value instanceof String text && text.regionMatches(true, 0, "http", 0, 4)) {
                String hash = canonicalHash(text);
                if (sourceHashes.contains(hash) && Boolean.TRUE.equals(verifiedByHash.get(hash))) {
                    String type = urlTypes.getOrDefault(DeclaredContract.fold(key), "");
                    evidence.add(new DatasetDraft.DraftEvidence(key, hash,
                            "URL".equals(type) ? "DECLARED_SOURCE" : "FIELD_URL", trim(text)));
                }
            }
        });

        List<DatasetDraft.DraftConflict> conflicts = new ArrayList<>();
        nz(record.conflicts()).forEach(conflict -> conflicts.add(new DatasetDraft.DraftConflict(
                DeclaredContract.fold(conflict.fieldKey()), conflict.keptValue(),
                conflict.rejectedValue(), strList(conflict.keptSources()),
                strList(conflict.rejectedSources()), conflict.resolvedBy())));

        return new DatasetDraft.DraftRow(record.index(), values, nz(record.rawValues()),
                // Absent means the authoritative gate never judged this row, which is not a pass.
                Boolean.TRUE.equals(javaVerdictByIndex.get(record.index())), record.isValid(),
                record.verificationStatus() == null ? "UNSUPPORTED" : record.verificationStatus(),
                record.confidence(), record.duplicateOf(), record.matchType(), record.duplicateKey(),
                record.reviewRequired(), nz(record.issues()).stream().map(DatasetAssembler::asMap)
                        .toList(), nz(record.normalizationNotes()), conflicts, sourceHashes, evidence,
                searchText(values), nz(record.reviewReasons()));
    }

    /**
     * A lowercased blob for substring search, built from the values a caller can actually see.
     *
     * <p>{@code LIKE} over this rather than a fulltext index, deliberately: what people type into a
     * dataset search is a fragment — "wind Lab" — and a word index would not answer it. The cost is
     * recorded in Memory.md along with the functional-index upgrade.
     */
    private static String searchText(Map<String, Object> values) {
        StringBuilder text = new StringBuilder();
        values.forEach((key, value) -> {
            if (absent(value)) {
                return;
            }
            text.append(DeclaredContract.fold(key)).append(' ').append(flatten(value)).append(' ');
        });
        return text.length() == 0 ? "" : text.toString().toLowerCase();
    }

    private static String flatten(Object value) {
        if (value instanceof Map<?, ?> map) {
            return map.entrySet().stream().map(entry -> String.valueOf(entry.getValue()))
                    .reduce((left, right) -> left + " " + right).orElse("");
        }
        if (value instanceof List<?> list) {
            return list.stream().map(DatasetAssembler::flatten).reduce((a, b) -> a + " " + b).orElse("");
        }
        return String.valueOf(value);
    }

    private static Map<String, Object> asMap(QualityResult.Issue issue) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("ruleCode", issue.ruleCode());
        view.put("severity", issue.severity());
        view.put("fieldKey", issue.fieldKey());
        view.put("message", issue.message());
        return view;
    }

    private static DatasetDraft.DraftSource sourceOf(String url, String title, String snippet,
                                                     String sourceType, String retrievedAt,
                                                     boolean verified, String provenance,
                                                     String blockedCode, String blockedReason) {
        return new DatasetDraft.DraftSource(trim(url), canonicalHash(url), domainOf(url),
                title == null ? null : trim(title), snippet, sourceType == null ? "search" : sourceType,
                retrievedAt, verified, provenance, blockedCode, blockedReason);
    }

    // ------------------------------------------------------------------------ urls

    /**
     * The join key for a source within one dataset: lowercase scheme and host, no fragment, no
     * tracking parameters, no trailing slash, query parameters in sorted order. A blank URL has no
     * identity and returns blank rather than the hash of nothing, which would otherwise collect every
     * URL-less citation into one shared row.
     *
     * <p>This is Java's own comparison key for tying a row to a page and a field to a page. It is
     * deliberately <em>not</em> the identity rule the pipeline used to decide that two records are one
     * entity — that stays Python's, in {@code app/curation/canonical.py}, and it is one canonicalizer
     * for that question, not two that can disagree.
     */
    public static String canonicalHash(String url) {
        String canonical = canonicalize(url);
        return canonical.isEmpty() ? "" : Json.shortHash(canonical);
    }

    static String canonicalize(String url) {
        if (url == null || url.isBlank()) {
            return "";
        }
        String value = url.trim();
        // Only http(s) is a page. Anything else arriving here is a data fault worth naming, not a
        // string to hash into a source row beside real URLs.
        if (!value.regionMatches(true, 0, "http://", 0, 7)
                && !value.regionMatches(true, 0, "https://", 0, 8)) {
            throw new IllegalArgumentException("a dataset source must be an http(s) URL: " + value);
        }
        int fragment = value.indexOf('#');
        if (fragment >= 0) {
            value = value.substring(0, fragment);
        }
        int query = value.indexOf('?');
        String path = query < 0 ? value : value.substring(0, query);
        List<String> kept = new ArrayList<>();
        if (query >= 0) {
            for (String pair : value.substring(query + 1).split("&")) {
                if (pair.isBlank() || pair.startsWith("utm_") || pair.equals("ref")
                        || pair.startsWith("ref=") || pair.startsWith("fbclid")
                        || pair.startsWith("gclid")) {
                    continue;
                }
                kept.add(pair);
            }
            kept.sort(String::compareTo);
        }
        String scheme = path.startsWith("http://") ? "http://" : "https://";
        String rest = path.substring(scheme.length());
        if (!rest.contains("/")) {
            rest = rest + "/";
        }
        String host = rest.substring(0, rest.indexOf('/'));
        String tail = rest.substring(rest.indexOf('/'));
        if (tail.length() > 1 && tail.endsWith("/")) {
            tail = tail.substring(0, tail.length() - 1);
        }
        String normalised = scheme + host.toLowerCase() + tail;
        return kept.isEmpty() ? normalised : normalised + "?" + String.join("&", kept);
    }

    private static String domainOf(String url) {
        String canonical = canonicalize(url);
        int start = canonical.indexOf("://");
        if (start < 0) {
            return null;
        }
        String rest = canonical.substring(start + 3);
        int slash = rest.indexOf('/');
        String host = slash < 0 ? rest : rest.substring(0, slash);
        int port = host.indexOf(':');
        return (port < 0 ? host : host.substring(0, port)).toLowerCase();
    }

    // ------------------------------------------------------------------- small helpers

    private static boolean absent(Object value) {
        if (value == null) {
            return true;
        }
        if (value instanceof String text) {
            return text.isBlank();
        }
        if (value instanceof List<?> list) {
            return list.isEmpty();
        }
        if (value instanceof Map<?, ?> map) {
            return map.isEmpty();
        }
        return false;
    }

    private static String trim(String value) {
        return value == null ? null : value.length() > 1000 ? value.substring(0, 1000) : value;
    }

    private static String str(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static List<String> strList(List<String> value) {
        return value == null ? List.of() : List.copyOf(value);
    }

    private static <T> List<T> nz(List<T> value) {
        return value == null ? List.of() : value;
    }

    private static Map<String, Object> nz(Map<String, Object> value) {
        return value == null ? Map.of() : new LinkedHashMap<>(value);
    }

    /** Absent measured anything about a map that never arrived; an empty map says the same thing. */
    private static Object nz(Object value) {
        return value == null ? Map.of() : value;
    }
}
