package ai.finalagent.dataset.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import ai.finalagent.aiclient.dto.QualityResult;
import ai.finalagent.dataset.domain.DatasetDraft;
import ai.finalagent.quality.DeclaredContract;

/**
 * Dataset assembly, without a database: the place where "the schema comes from the run" is either
 * true or a claim.
 *
 * <p>The two fixtures below declare completely different fields — a job posting and a podcast
 * episode — and run through the same code. If any field name were hardcoded, one of them would come
 * out wrong, which is exactly the defect class the rebuild was started for (the old project's demo
 * layer answered every prompt with a startup schema).
 */
class DatasetAssemblerTest {

    /** A job-posting contract. Nothing here appears in the podcast case below, and vice versa. */
    private static final List<Map<String, Object>> JOB_FIELDS = List.of(
            Map.of("key", "role_title", "label", "Role", "type", "STRING", "required", true),
            Map.of("key", "salary_band", "label", "Salary", "type", "STRING"),
            Map.of("key", "posted_on", "label", "Posted", "type", "DATE"),
            Map.of("key", "posting_url", "label", "Posting", "type", "URL"));

    private static final DatasetAssembler.Origin JOB_ORIGIN =
            origin(JOB_FIELDS, List.of("role_title", "posting_url"), "job_posting");
    private static final DeclaredContract JOB_CONTRACT =
            DeclaredContract.fromFields(JOB_FIELDS, List.of("role_title", "posting_url"));

    private static DatasetAssembler.Origin origin(List<Map<String, Object>> fields,
                                                 List<String> required, String entityType) {
        Map<String, Object> properties = new LinkedHashMap<>();
        fields.forEach(field -> properties.put(String.valueOf(field.get("key")),
                Map.of("type", String.valueOf(field.get("type")))));
        return new DatasetAssembler.Origin("ws-1", "run-1", "wf-1", "plan-1", "step-save",
                "collect " + entityType, "list " + entityType + "s with salary", entityType,
                Map.of("type", "object", "properties", properties, "required", required));
    }

    /** A podcast contract, declared by that run — the same four lines of code, a different dataset. */
    private static final List<Map<String, Object>> EPISODE_FIELDS = List.of(
            Map.of("key", "episode_title", "label", "Episode", "type", "STRING", "required", true),
            Map.of("key", "duration_seconds", "label", "Duration", "type", "NUMBER"),
            Map.of("key", "guest_name", "label", "Guest", "type", "STRING"));

    @Test
    void aJobPostingRunAndAPodcastRunGetDifferentColumnsFromTheSameCode() {
        QualityResult jobs = produced(List.of(record(0, Map.of("role_title", "Backend engineer",
                "salary_band", "£60,000", "posted_on", "2026-01-04",
                "posting_url", "https://jobs.test/b/1"))));
        QualityResult episodes = produced(List.of(record(0, Map.of("episode_title", "Ep 12",
                "duration_seconds", 2140, "guest_name", "Dr. Iyer"))));

        DatasetDraft jobDataset = DatasetAssembler.assemble(JOB_ORIGIN, jobs, Map.of(0, true),
                JOB_CONTRACT, List.of());
        DatasetAssembler.Origin episodeOrigin =
                origin(EPISODE_FIELDS, List.of("episode_title"), "podcast_episode");
        DatasetDraft episodeDataset = DatasetAssembler.assemble(episodeOrigin, episodes,
                Map.of(0, true),
                DeclaredContract.fromFields(EPISODE_FIELDS, List.of("episode_title")), List.of());

        assertThat(jobDataset.columns()).extracting(DatasetDraft.DraftColumn::fieldKey)
                .containsExactly("role_title", "salary_band", "posted_on", "posting_url");
        assertThat(episodeDataset.columns()).extracting(DatasetDraft.DraftColumn::fieldKey)
                .containsExactly("episode_title", "duration_seconds", "guest_name");
        assertThat(episodeDataset.columns()).allSatisfy(column ->
                assertThat(column.origin()).isEqualTo("PLAN"));
        // Nothing about a startup appears in either, and no column of one run exists in the other.
        assertThat(jobDataset.columns()).noneSatisfy(column ->
                assertThat(column.fieldKey()).isEqualTo("episode_title"));
    }

    @Test
    void aColumnOnlyTheDataHasIsKeptAndLabelledAsDataNotInThePlan() {
        QualityResult.Record record = record(0, Map.of("role_title", "Backend engineer",
                "recruiter_notes", "answered within a day"));
        // The pipeline declared columns for the four plan fields only; the fifth key came from the
        // page and nobody declared it anywhere.
        QualityResult produced = new QualityResult("COMPLETED", List.of(record),
                new QualityResult.Dataset(
                        JOB_FIELDS.stream().map(field -> new QualityResult.Column(
                                String.valueOf(field.get("key")), "label", "STRING", false, 0)).toList(),
                        List.of(new QualityResult.Row(0, record.values()))),
                List.of(), null, List.of(), null);

        DatasetDraft draft = DatasetAssembler.assemble(JOB_ORIGIN, produced, Map.of(0, true),
                JOB_CONTRACT, List.of());

        assertThat(draft.columns()).anySatisfy(column -> {
            assertThat(column.fieldKey()).isEqualTo("recruiter_notes");
            assertThat(column.origin()).isEqualTo("DATA");
            assertThat(column.required()).isFalse();
        });
        assertThat(draft.columns().get(0).origin()).isEqualTo("PLAN");
        assertThat(draft.columns()).hasSize(5);
    }

    @Test
    void aRowTheValidatingStepNeverJudgedIsNotSavedAsValid() {
        QualityResult produced = produced(List.of(record(0, Map.of("role_title", "Backend engineer"))));

        DatasetDraft unjudged = DatasetAssembler.assemble(JOB_ORIGIN, produced, Map.of(),
                JOB_CONTRACT, List.of());

        // The gate fails closed: no verdict from Java is not a pass, because a default of "valid"
        // would put the authoritative checker on the side that trusts whatever arrived last.
        assertThat(unjudged.rows().get(0).valid()).isFalse();
        assertThat(unjudged.validRowCount()).isZero();
    }

    @Test
    void theAdvisoryVerdictIsKeptBesideJavaNotReplacedByIt() {
        QualityResult.Record record = record(0, Map.of("role_title", "Backend engineer"));
        QualityResult produced = produced(List.of(record));

        DatasetDraft draft = DatasetAssembler.assemble(JOB_ORIGIN, produced, Map.of(0, false),
                JOB_CONTRACT, List.of());

        assertThat(draft.rows().get(0).advisoryValid()).isTrue();
        assertThat(draft.rows().get(0).valid()).isFalse();
    }

    @Test
    void fieldLevelEvidenceExistsOnlyWhenTheValueNamesThePage() {
        String url = "https://jobs.test/b/1";
        QualityResult produced = produced(List.of(record(0, Map.of("role_title", "Backend engineer",
                "salary_band", "£60,000", "posting_url", url), List.of(source(url, true)))));

        DatasetDraft draft = DatasetAssembler.assemble(JOB_ORIGIN, produced, Map.of(0, true),
                JOB_CONTRACT, List.of());

        DatasetDraft.DraftRow row = draft.rows().get(0);
        // The URL field traces to the page. The salary does not, and no row-level attachment is
        // dressed up as a field-level one to make the count look better.
        assertThat(row.fieldEvidence()).extracting(DatasetDraft.DraftEvidence::columnKey)
                .containsExactly("posting_url");
        assertThat(row.fieldEvidence().get(0).kind()).isEqualTo("DECLARED_SOURCE");
        assertThat(row.evidencedFieldCount()).isEqualTo(1);
        assertThat(row.populatedFieldCount()).isEqualTo(3);
    }

    @Test
    void aValueThatLooksLikeAUrlButWasNeverRetrievedGetsNoAttribution() {
        QualityResult produced = produced(List.of(record(0, Map.of("role_title", "Backend engineer",
                "posting_url", "https://elsewhere.test/never-fetched"),
                List.of(source("https://jobs.test/b/1", true)))));

        DatasetDraft draft = DatasetAssembler.assemble(JOB_ORIGIN, produced, Map.of(0, true),
                JOB_CONTRACT, List.of());

        assertThat(draft.rows().get(0).fieldEvidence()).isEmpty();
    }

    @Test
    void duplicatesAreLinkedByIndexAndStillCountedAsRowsThatExist() {
        QualityResult.Record canonical = record(0, Map.of("role_title", "Backend engineer"));
        QualityResult.Record duplicate = record(1, Map.of("role_title", "Backend engineer"), 0, "EXACT");
        QualityResult produced = produced(List.of(canonical, duplicate));

        DatasetDraft draft = DatasetAssembler.assemble(JOB_ORIGIN, produced,
                Map.of(0, true, 1, true), JOB_CONTRACT, List.of());

        assertThat(draft.rowCount()).isEqualTo(2);
        assertThat(draft.duplicateCount()).isEqualTo(1);
        // Only the canonical row is a row of the dataset, so validity is counted over it once.
        assertThat(draft.validRowCount()).isEqualTo(1);
        assertThat(draft.rows().get(1).duplicateOfRecordIndex()).isZero();
    }

    @Test
    void aRefusedPageIsCarriedIntoTheDatasetAsAFactAboutItsLimits() {
        QualityResult produced = produced(List.of(record(0, Map.of("role_title", "Backend engineer"),
                List.of(source("https://jobs.test/b/1", true)))));

        DatasetDraft draft = DatasetAssembler.assemble(JOB_ORIGIN, produced, Map.of(0, true),
                JOB_CONTRACT, List.of(Map.of("url", "https://blocked.test/postings",
                        "code", "ROBOTS_DISALLOWED", "reason", "robots.txt disallows /postings")));

        assertThat(draft.sourceCount()).isEqualTo(2);
        assertThat(draft.blockedSourceCount()).isEqualTo(1);
        assertThat(draft.sources()).anySatisfy(source -> {
            assertThat(source.url()).isEqualTo("https://blocked.test/postings");
            assertThat(source.provenance()).isEqualTo("REFUSED_BEFORE_FETCH");
            assertThat(source.verifiedByTool()).isFalse();
            assertThat(source.blockedCode()).isEqualTo("ROBOTS_DISALLOWED");
        });
    }

    @Test
    void aPageAToolNeverReturnedIsCountedUnverifiedRatherThanRoundedUp() {
        QualityResult produced = produced(List.of(record(0, Map.of("role_title", "Backend engineer"),
                List.of(source("https://jobs.test/b/1", true),
                        source("https://model-mentioned.test/x", false)))));

        DatasetDraft draft = DatasetAssembler.assemble(JOB_ORIGIN, produced, Map.of(0, true),
                JOB_CONTRACT, List.of());

        assertThat(draft.sourceCount()).isEqualTo(2);
        assertThat(draft.verifiedSourceCount()).isEqualTo(1);
        assertThat(draft.unverifiedSourceCount()).isEqualTo(1);
    }

    @Test
    void aRowWithNoSourceAtAllIsTheShortfallTheReportNames() {
        QualityResult produced = produced(List.of(
                record(0, Map.of("role_title", "Backend engineer")),
                record(1, Map.of("role_title", "Data engineer"))));

        DatasetDraft draft = DatasetAssembler.assemble(JOB_ORIGIN, produced, Map.of(0, true),
                JOB_CONTRACT, List.of());

        // One judged valid, one not judged at all, and neither cited anything: both counts are true
        // and the evidence count says which rows a reader should not trust.
        assertThat(draft.recordsWithoutEvidence()).isEqualTo(2);
        assertThat(draft.header().status()).isEqualTo("READY");
    }

    @Test
    void anEmptyResultIsSavedAsEmptyNotAsACleanZeroRowDataset() {
        DatasetDraft draft = DatasetAssembler.assemble(JOB_ORIGIN, produced(List.of()), Map.of(),
                JOB_CONTRACT, List.of());

        assertThat(draft.header().status()).isEqualTo("EMPTY");
        assertThat(draft.rowCount()).isZero();
    }

    @Test
    void theSearchTextCarriesValuesAndSurvivesCaseDifferences() {
        DatasetDraft draft = DatasetAssembler.assemble(JOB_ORIGIN, produced(List.of(record(0,
                Map.of("role_title", "Backend ENGINEER", "salary_band", "£60,000")))),
                Map.of(0, true), JOB_CONTRACT, List.of());

        String searchText = draft.rows().get(0).searchText();
        assertThat(searchText).contains("backend engineer").contains("60,000");
        assertThat(searchText).doesNotContain("null");
    }

    @Test
    void trackingParametersAndFragmentsDoNotSplitOnePage() {
        String base = "https://Jobs.Test/b/1";
        assertThat(DatasetAssembler.canonicalHash(base))
                .isEqualTo(DatasetAssembler.canonicalHash("https://jobs.test/b/1?utm_source=news#top"));
        assertThat(DatasetAssembler.canonicalHash("https://jobs.test/b/1"))
                .isNotEqualTo(DatasetAssembler.canonicalHash("https://jobs.test/b/2"));
        // A different order of different parameters is a different page, and stays one.
        assertThat(DatasetAssembler.canonicalHash("https://jobs.test/b/1?a=1&b=2"))
                .isEqualTo(DatasetAssembler.canonicalHash("https://jobs.test/b/1?b=2&a=1"));
    }

    @Test
    void aSourceWithNoUrlIsNotHashedIntoSomebodyElsesPage() {
        assertThat(DatasetAssembler.canonicalHash("")).isEmpty();
        assertThat(DatasetAssembler.canonicalHash(null)).isEmpty();
        assertThatThrownBy(() -> DatasetAssembler.canonicalHash("ftp://jobs.test/x"))
                .isInstanceOf(IllegalArgumentException.class);

        // Two citations that name no page must not become one row shared by a real source's dataset,
        // and must not vanish either: they are counted, and the count is what a reviewer reads.
        QualityResult produced = produced(List.of(record(0, Map.of("role_title", "Backend engineer"),
                List.of(source("", true), source("  ", false)))));

        DatasetDraft draft = DatasetAssembler.assemble(JOB_ORIGIN, produced, Map.of(0, true),
                JOB_CONTRACT, List.of());

        assertThat(draft.sourceCount()).isZero();
        assertThat(draft.sourcesWithoutUrl()).isEqualTo(2);
    }

    // ------------------------------------------------------------------------ fixtures


    /**
     * A pipeline answer. Its dataset columns are derived from the records it carries rather than
     * hardcoded, so a podcast run cannot inherit a job run's column and confuse the two tests.
     */
    private static QualityResult produced(List<QualityResult.Record> records) {
        List<QualityResult.Row> rows = new java.util.ArrayList<>();
        List<QualityResult.Column> columns = new java.util.ArrayList<>();
        java.util.Set<String> keys = new java.util.LinkedHashSet<>();
        records.forEach(record -> {
            keys.addAll(record.values().keySet());
            if (record.duplicateOf() == null) {
                rows.add(new QualityResult.Row(record.index(), record.values()));
            }
        });
        int position = 0;
        for (String key : keys) {
            columns.add(new QualityResult.Column(key, key, "STRING", false, position++));
        }
        QualityResult.Quality quality = new QualityResult.Quality(records.size(), records.size(),
                rows.size(), records.size() - rows.size(), records.size() - rows.size(), 0, 0,
                rows.size(), 0.6, "equal-weight mean of five measured ratios",
                Map.of("completeness", 0.5), Map.of());
        return new QualityResult("COMPLETED", records,
                new QualityResult.Dataset(columns, rows), List.of(), quality, List.of(), null);
    }

    private static QualityResult.Record record(int index, Map<String, Object> values) {
        // The single-argument form cites nothing: a fixture that quietly attached a page to every row
        // would make "a row with no evidence" untestable.
        return record(index, values, List.of(), null, null);
    }

    private static QualityResult.Record record(int index, Map<String, Object> values,
                                               List<QualityResult.Source> sources) {
        return record(index, values, sources, null, null);
    }

    private static QualityResult.Record record(int index, Map<String, Object> values, int duplicateOf,
                                               String matchType) {
        return record(index, values, List.of(source("https://jobs.test/b/1", true)), duplicateOf,
                matchType);
    }

    private static QualityResult.Record record(int index, Map<String, Object> values,
                                               List<QualityResult.Source> sources, Integer duplicateOf,
                                               String matchType) {
        Map<String, Object> typed = new LinkedHashMap<>(values);
        return new QualityResult.Record(index, typed, typed, sources, true, List.of(),
                "SOURCE_CITED", null, null, duplicateOf, null, matchType, false, List.of(), List.of(),
                List.of());
    }

    private static QualityResult.Source source(String url, boolean verified) {
        return new QualityResult.Source(url, "A posting", "snippet", "scrape",
                "2026-02-01T09:00:00Z", verified);
    }
}
