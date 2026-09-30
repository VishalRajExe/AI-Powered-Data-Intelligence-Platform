package ai.finalagent.dataset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import ai.finalagent.aiclient.dto.QualityResult;
import ai.finalagent.dataset.domain.DatasetDraft;
import ai.finalagent.dataset.repository.DatasetQueryRepository;
import ai.finalagent.dataset.repository.DatasetQueryRepository.Filter;
import ai.finalagent.dataset.repository.DatasetQueryRepository.RowQuery;
import ai.finalagent.dataset.repository.DatasetRepository;
import ai.finalagent.dataset.service.DatasetAssembler;
import ai.finalagent.quality.DeclaredContract;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The dataset platform against real MySQL: written once, queried every way a caller would, and
 * traceable from a field to a page.
 *
 * <p>Two claims are only worth making if a database proves them, so both are asserted here rather
 * than argued in a comment. First, that the schema is dynamic: a job-posting dataset and a
 * podcast-episode dataset are written by the same code and come out with different columns, because
 * nothing in this build knows what a startup is. Second, that a dataset's counts are the counts of its
 * rows — every header figure is checked against a {@code COUNT(*)} of the table it describes, which is
 * the difference between a number and a report of a number.
 *
 * <p>The traceability cases are the five the phase names — one source, several sources, conflicting
 * sources, a missing source, a blocked source — plus the one that decides whether the others matter: a
 * page no tool returned must never arrive as verified evidence.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("mysql")
@EnabledIfEnvironmentVariable(named = "FINALAGENT_TEST_MYSQL", matches = "true")
class DatasetPlatformMySqlTest {

    private static final String WORKSPACE = "00000000-0000-0000-0000-000000000ff1";
    private static final String OTHER_WORKSPACE = "00000000-0000-0000-0000-000000000ff9";
    private static final String NIL = "00000000-0000-0000-0000-000000000000";
    private static final String JOB_URL = "https://jobs.test/b/1";

    private static final List<Map<String, Object>> JOB_FIELDS = List.of(
            Map.of("key", "role_title", "label", "Role", "type", "STRING", "required", true),
            Map.of("key", "salary_amount", "label", "Salary", "type", "NUMBER"),
            Map.of("key", "location", "label", "Location", "type", "STRING"),
            Map.of("key", "posting_url", "label", "Posting", "type", "URL"));

    private static final List<Map<String, Object>> EPISODE_FIELDS = List.of(
            Map.of("key", "episode_title", "label", "Episode", "type", "STRING", "required", true),
            Map.of("key", "duration_seconds", "label", "Duration", "type", "NUMBER"),
            Map.of("key", "guest_name", "label", "Guest", "type", "STRING"));

    @Autowired
    private DatasetRepository datasets;
    @Autowired
    private DatasetQueryRepository queries;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper mapper = new ObjectMapper();

    /** runId → {workflowId, planId}, so a draft points at rows that actually exist. */
    private final Map<String, String[]> parents = new LinkedHashMap<>();

    @BeforeEach
    @AfterEach
    void startAndEndWithNothing() {
        jdbc.update("DELETE FROM dataset_conflicts WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM dataset_field_evidence WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM dataset_row_sources WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM dataset_sources WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM dataset_columns WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM dataset_rows WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM datasets WHERE workspace_id IN (?, ?)", WORKSPACE, OTHER_WORKSPACE);
        jdbc.update("DELETE FROM activity_events WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM workflows WHERE workspace_id = ?", WORKSPACE);
    }

    // ------------------------------------------------------------------- the write

    @Test
    void everyCountOnTheHeaderEqualsTheCountOfTheRowsItDescribes() {
        String runId = newRun();
        String datasetId = save(runId, jobDraft(runId, List.of(JOB_URL), true, List.of(),
                Map.of("role_title", "Backend engineer", "salary_amount", 60000,
                        "location", "Bengaluru", "posting_url", JOB_URL),
                Map.of("role_title", "Data engineer", "salary_amount", 72000, "location", "Pune",
                        "posting_url", "https://boards.test/post/2")));

        var dataset = datasets.findById(WORKSPACE, datasetId).orElseThrow();
        assertThat(dataset.rowCount()).isEqualTo(count("dataset_rows", datasetId, "1=1"));
        assertThat(dataset.validRowCount())
                .isEqualTo(count("dataset_rows", datasetId,
                        "valid = 1 AND duplicate_of_row_id IS NULL"));
        assertThat(dataset.invalidRowCount())
                .isEqualTo(count("dataset_rows", datasetId,
                        "valid = 0 AND duplicate_of_row_id IS NULL"));
        assertThat(dataset.duplicateCount())
                .isEqualTo(count("dataset_rows", datasetId, "duplicate_of_row_id IS NOT NULL"));
        assertThat(dataset.sourceCount()).isEqualTo(count("dataset_sources", datasetId, "1=1"));
        assertThat(dataset.verifiedSourceCount())
                .isEqualTo(count("dataset_sources", datasetId, "verified_by_tool = 1"));
        assertThat(dataset.conflictCount()).isEqualTo(count("dataset_conflicts", datasetId, "1=1"));
        assertThat(dataset.recordsWithoutEvidence())
                .isEqualTo(count("dataset_rows", datasetId,
                        "duplicate_of_row_id IS NULL AND source_count = 0"));
        assertThat(count("dataset_columns", datasetId, "origin = 'PLAN'")).isEqualTo(4);
        assertThat(count("dataset_rows", datasetId, "duplicate_of_row_id IS NULL")).isEqualTo(2);
        assertThat(dataset.status()).isEqualTo("READY");
        assertThat(dataset.extractionSchemaJson()).isNotNull();
    }

    @Test
    void twoDifferentRunsProduceTwoDifferentSchemasFromTheSameCode() {
        String jobRun = newRun();
        String episodeRun = newRun();
        String jobSet = save(jobRun, jobDraft(jobRun, List.of(JOB_URL), true, List.of(),
                Map.of("role_title", "Backend engineer", "salary_amount", 60000,
                        "posting_url", JOB_URL)));
        String episodeSet = save(episodeRun, episodeDraft(episodeRun, Map.of("episode_title", "Ep 12",
                "duration_seconds", 2140, "guest_name", "Dr. Iyer")));

        assertThat(columnKeys(jobSet)).containsExactlyInAnyOrder("role_title", "salary_amount",
                "location", "posting_url");
        assertThat(columnKeys(episodeSet)).containsExactlyInAnyOrder("episode_title",
                "duration_seconds", "guest_name");
        // The job columns did not leak into the episode dataset. That is the only version of this
        // assertion that would fail if a field name were hardcoded anywhere in the path.
        assertThat(columnKeys(episodeSet)).doesNotContain("role_title", "salary_amount");
        assertThat(datasets.findById(WORKSPACE, episodeSet).orElseThrow().entityType())
                .isEqualTo("podcast_episode");
    }

    @Test
    void savingTheSameRunTwiceReplacesItsDatasetInsteadOfAddingASecondOne() {
        String runId = newRun();
        String first = save(runId, jobDraft(runId, List.of(JOB_URL), true, List.of(),
                Map.of("role_title", "Backend engineer", "salary_amount", 60000,
                        "posting_url", "https://jobs.test/b/1"),
                Map.of("role_title", "Data engineer", "salary_amount", 72000,
                        "posting_url", "https://jobs.test/b/1")));
        // A retried save step writes a smaller result. The dataset belongs to the run, so the second
        // write replaces it under the same id rather than leaving two rows where one now exists.
        String second = save(runId, jobDraft(runId, List.of("https://jobs.test/b/2"), true, List.of(),
                Map.of("role_title", "Only engineer", "salary_amount", 90000,
                        "posting_url", "https://jobs.test/b/2")));

        assertThat(second).isEqualTo(first);
        assertThat(datasets.list(WORKSPACE, null, null, 10, 0)).hasSize(1);
        assertThat(count("dataset_rows", first, "1=1")).isEqualTo(1);
        assertThat(count("dataset_columns", first, "1=1")).isEqualTo(4);
        assertThat(count("dataset_row_sources", first, "1=1")).isEqualTo(1);
        assertThat(searchFor(first, "Only engineer")).isNotNull();
        assertThat(searchFor(first, "Backend engineer")).isNull();
    }

    @Test
    void a_linked_duplicate_is_stored_and_reachable_but_is_not_a_row_of_the_dataset() {
        String runId = newRun();
        DatasetDraft draft = jobDraft(runId, List.of(JOB_URL), true, List.of(),
                Map.of("role_title", "Backend engineer", "salary_amount", 60000,
                        "posting_url", JOB_URL),
                Map.of("role_title", "Backend Engineer", "salary_amount", 60000,
                        "posting_url", "https://jobs.test/b/1?utm_source=news"));
        // The pipeline linked the second record to the first; the save step must keep that link.
        Map<String, Object> secondValues = draft.rows().get(1).values();
        assertThat(secondValues).containsKey("role_title");
        String datasetId = save(runId, withDuplicate(draft, 1, 0, "NORMALIZED"));

        var dataset = datasets.findById(WORKSPACE, datasetId).orElseThrow();
        assertThat(dataset.rowCount()).isEqualTo(2);
        assertThat(dataset.duplicateCount()).isEqualTo(1);
        assertThat(dataset.validRowCount()).isEqualTo(1);
        String duplicateId = jdbc.queryForObject("SELECT id FROM dataset_rows WHERE dataset_id = ?"
                + " AND duplicate_of_row_id IS NOT NULL", String.class, datasetId);
        assertThat(queries.row(datasetId, duplicateId).orElseThrow().duplicateOfRowId()).isNotNull();
        // Duplicates are excluded from the canonical listing and included when asked for by name.
        assertThat(queries.rows(datasetId, new RowQuery(null, List.of(), null, true, null, false, 0, 50)))
                .hasSize(1);
        assertThat(queries.rows(datasetId, new RowQuery(null, List.of(), null, true, null, true, 0, 50)))
                .hasSize(2);
    }

    // ------------------------------------------------------------- the read paths

    @Test
    void searchFilterSortAndPaginationAllAnswerFromTheSavedRows() {
        String runId = newRun();
        String datasetId = save(runId, jobDraft(runId, List.of(JOB_URL), true, List.of(),
                Map.of("role_title", "Backend engineer", "salary_amount", 60000, "location", "Bengaluru",
                        "posting_url", "https://jobs.test/b/1"),
                Map.of("role_title", "Backend architect", "salary_amount", 95000, "location", "Pune",
                        "posting_url", "https://jobs.test/b/2"),
                Map.of("role_title", "Data engineer", "salary_amount", 72000, "location", "Bengaluru",
                        "posting_url", "https://jobs.test/b/3")));

        assertThat(queries.rows(datasetId, new RowQuery("backend", List.of(), null, true, null, false,
                0, 50))).hasSize(2);
        assertThat(queries.rows(datasetId, new RowQuery(null,
                List.of(new Filter("location", "eq", "Bengaluru")), null, true, null, false, 0, 50)))
                .hasSize(2);
        assertThat(queries.rows(datasetId, new RowQuery(null,
                List.of(new Filter("salary_amount", "gte", "70000")), null, true, null, false, 0, 50)))
                .hasSize(2);
        assertThat(queries.rows(datasetId, new RowQuery(null,
                List.of(new Filter("location", "missing", null)), null, true, null, false, 0, 50)))
                .isEmpty();

        // Numeric ordering, not text ordering: as text "95000" precedes nothing useful and a caller
        // asking for the highest salary would get an arbitrary row.
        List<String> descending = queries.rows(datasetId, new RowQuery(null, List.of(),
                "salary_amount", false, null, false, 0, 50)).stream()
                .map(row -> row.valuesJson()).toList();
        assertThat(descending.get(0)).contains("95000");
        assertThat(descending.get(2)).contains("60000");

        assertThat(queries.rows(datasetId, RowQuery.of(0, 2))).extracting(row -> row.recordIndex())
                .containsExactly(0, 1);
        assertThat(queries.rows(datasetId, RowQuery.of(2, 2))).extracting(row -> row.recordIndex())
                .containsExactly(2);
        assertThat(queries.countRows(datasetId, new RowQuery(null,
                List.of(new Filter("location", "eq", "Pune")), null, true, null, false, 0, 50)))
                .isEqualTo(1);
    }

    @Test
    void a_filter_or_sort_key_the_run_never_had_is_refused_before_it_reaches_sql() {
        String runId = newRun();
        String datasetId = save(runId, jobDraft(runId, List.of(JOB_URL), true, List.of(),
                Map.of("role_title", "Backend engineer", "salary_amount", 60000)));

        // The injection-shaped key is the point: it is resolved against dataset_columns first, so it
        // becomes a 400 that names the real columns instead of a query with a second meaning.
        assertThatThrownBy(() -> queries.rows(datasetId, new RowQuery(null,
                List.of(new Filter("name); DROP TABLE dataset_rows", "eq", "x")), null, true, null,
                false, 0, 50)))
                .isInstanceOf(DatasetQueryRepository.UnknownColumnException.class)
                .hasMessageContaining("role_title");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM dataset_rows", Integer.class)).isEqualTo(1);
        assertThatThrownBy(() -> queries.rows(datasetId,
                new RowQuery(null, List.of(), "startup_name", true, null, false, 0, 50)))
                .isInstanceOf(DatasetQueryRepository.UnknownColumnException.class);
        assertThatThrownBy(() -> queries.facet(datasetId, "no_such_field", 10))
                .isInstanceOf(DatasetQueryRepository.UnknownColumnException.class);
    }

    @Test
    void facetsDescribeWhatCanBeFilteredAndStopListingWhenAColumnIsNotAChoice() {
        String runId = newRun();
        String datasetId = save(runId, jobDraft(runId, List.of(JOB_URL), true, List.of(),
                Map.of("role_title", "Backend engineer", "salary_amount", 60000, "location", "Bengaluru"),
                Map.of("role_title", "Data engineer", "salary_amount", 95000, "location", "Pune"),
                Map.of("role_title", "ML engineer", "salary_amount", 120000, "location", "Pune")));

        Map<String, Object> salary = queries.facet(datasetId, "salary_amount", 40);
        assertThat(salary).containsEntry("type", "NUMBER");
        assertThat(String.valueOf(salary.get("min"))).isEqualTo("60000.000000");
        assertThat(String.valueOf(salary.get("max"))).isEqualTo("120000.000000");
        assertThat(salary.get("operators")).toString().contains("gte");

        Map<String, Object> location = queries.facet(datasetId, "location", 40);
        assertThat(String.valueOf(location.get("values"))).contains("Pune").contains("Bengaluru");
        assertThat(location).containsEntry("distinctListed", true);

        // A title is not a choice anyone can pick from. Over the bound the list is withheld and the
        // caller is told so, rather than being shown an arbitrary slice of a thousand values.
        assertThat(queries.facet(datasetId, "role_title", 2)).containsEntry("distinctListed", false);
        assertThat((List<?>) queries.facet(datasetId, "role_title", 2).get("values")).isEmpty();
    }

    // ---------------------------------------------------------------- traceability

    @Test
    void oneRowWithOneSourceTracesToThatPageAndToNothingElse() {
        String runId = newRun();
        String datasetId = save(runId, jobDraft(runId, List.of(JOB_URL), true, List.of(),
                Map.of("role_title", "Backend engineer", "salary_amount", 60000,
                        "posting_url", JOB_URL)));

        String rowId = firstRow(datasetId);
        assertThat(queries.rowSources(datasetId, rowId)).hasSize(1);
        assertThat(queries.rowSources(datasetId, rowId).get(0).get("url")).isEqualTo(JOB_URL);
        assertThat(queries.rowSources(datasetId, rowId).get(0).get("verifiedByTool")).isEqualTo(true);
        // The URL-typed field names the page, so this row really does have field-level attribution.
        assertThat(attributedFields(rowEvidence(datasetId, rowId))).containsExactly("posting_url");
        assertThat(citedByRows(sourceIdFor(datasetId, JOB_URL))).isEqualTo(1);
        // The salary has no attribution of its own, and is not given a false one.
        assertThat(queries.fieldEvidence(datasetId, rowId)).extracting(entry -> entry.get("columnKey"))
                .containsExactly("posting_url");
    }

    @Test
    void oneRowWithSeveralSourcesKeepsAllOfThemAndCountsWhatEachOneSupports() {
        String runId = newRun();
        List<String> urls = List.of(JOB_URL, "https://boards.test/post/2", "https://careers.test/3");
        String datasetId = save(runId, jobDraft(runId, urls, true, List.of(),
                Map.of("role_title", "Backend engineer", "posting_url", JOB_URL),
                Map.of("role_title", "Data engineer", "posting_url", "https://boards.test/post/2")));

        assertThat(datasets.findById(WORKSPACE, datasetId).orElseThrow().sourceCount()).isEqualTo(3);
        assertThat(queries.rowSources(datasetId, firstRow(datasetId))).hasSize(3);
        // Every row in this fixture cites all three pages, so each page is cited by two rows. What
        // nothing here invents is a per-field claim: only the URL-typed field can attribute itself to
        // a page, and the salary cannot.
        assertThat(queries.sources(datasetId, null, null, null, 50, 0))
                .extracting(source -> source.citedByRows())
                .containsExactlyInAnyOrder(2, 2, 2);
        assertThat(attributedFields(rowEvidence(datasetId, firstRow(datasetId))))
                .containsExactly("posting_url");
        assertThat(queries.rowIdsForSource(datasetId, sourceIdFor(datasetId, JOB_URL))).hasSize(2);
    }

    @Test
    void conflictingSourcesKeepBothValuesAndTheRuleThatChoseBetweenThem() {
        String runId = newRun();
        DatasetDraft draft = jobDraft(runId, List.of(JOB_URL), true, List.of(),
                Map.of("role_title", "Backend engineer", "salary_amount", 95000,
                        "posting_url", JOB_URL));
        draft.rows().get(0).conflicts().add(new DatasetDraft.DraftConflict("salary_amount", 95000,
                60000, List.of(JOB_URL), List.of("https://boards.test/post/2"), "evidence-count"));
        String datasetId = save(runId, draft);

        var conflicts = queries.conflicts(datasetId, firstRow(datasetId));
        assertThat(conflicts).hasSize(1);
        assertThat(conflicts.get(0).columnKey()).isEqualTo("salary_amount");
        assertThat(conflicts.get(0).keptValueJson()).contains("95000");
        assertThat(conflicts.get(0).rejectedValueJson()).contains("60000");
        assertThat(conflicts.get(0).resolvedBy()).isEqualTo("evidence-count");
        assertThat(conflicts.get(0).rejectedSourcesJson()).contains("boards.test");
        assertThat(datasets.findById(WORKSPACE, datasetId).orElseThrow().conflictCount()).isEqualTo(1);
    }

    @Test
    void aRowWithNoSourceIsSavedCountedAndNamedRatherThanLeftOut() {
        String runId = newRun();
        String datasetId = save(runId, jobDraft(runId, List.of(), true, List.of(),
                Map.of("role_title", "Backend engineer", "salary_amount", 60000)));

        var dataset = datasets.findById(WORKSPACE, datasetId).orElseThrow();
        assertThat(dataset.rowCount()).isEqualTo(1);
        assertThat(dataset.recordsWithoutEvidence()).isEqualTo(1);
        // Kept and readable, with its shortfall attached. A dataset silently one row short is the
        // failure this layer exists to make impossible.
        assertThat(queries.rows(datasetId, RowQuery.of(0, 10))).hasSize(1);
        assertThat(queries.rowsWithoutEvidence(datasetId, 10)).hasSize(1);
        assertThat(queries.row(datasetId, firstRow(datasetId)).orElseThrow().sourceCount()).isZero();
        assertThat(attributedFields(rowEvidence(datasetId, firstRow(datasetId)))).isEmpty();
    }

    @Test
    void aBlockedSourceIsRecordedWithThePolicyThatBlockedItAndStaysUnverified() {
        String runId = newRun();
        String datasetId = save(runId, jobDraft(runId, List.of(JOB_URL), true,
                List.of("https://blocked.test/postings"),
                Map.of("role_title", "Backend engineer", "posting_url", JOB_URL)));

        var blocked = queries.sources(datasetId, null, null, "blocked.test", 10, 0).get(0);
        assertThat(blocked.provenance()).isEqualTo("REFUSED_BEFORE_FETCH");
        assertThat(blocked.blockedCode()).isEqualTo("ROBOTS_DISALLOWED");
        assertThat(blocked.blockedReason()).contains("disallows");
        assertThat(blocked.verifiedByTool()).isFalse();
        assertThat(blocked.citedByRows()).isZero();
        assertThat(blocked.url()).isEqualTo("https://blocked.test/postings");
        var dataset = datasets.findById(WORKSPACE, datasetId).orElseThrow();
        assertThat(dataset.blockedSourceCount()).isEqualTo(1);
        assertThat(dataset.sourceCount()).isEqualTo(2);
        // The blocked page supports no field and no row, which is what its count says.
        assertThat(queries.rowIdsForSource(datasetId, blocked.id())).isEmpty();
    }

    /**
     * The rule that decides whether every other number here is worth reading: a URL that no tool
     * returned cannot become verified evidence by being cited, repeated, or mentioned in a title.
     */
    @Test
    void aCitedPageThatNoToolReturnedNeverArrivesAsVerifiedEvidence() {
        String runId = newRun();
        String invented = "https://invented.test/never-fetched";
        DatasetDraft draft = jobDraft(runId, List.of(JOB_URL, invented), true, List.of(),
                Map.of("role_title", "Backend engineer", "posting_url", invented));
        String datasetId = save(runId, markUnverified(draft, invented));

        var dataset = datasets.findById(WORKSPACE, datasetId).orElseThrow();
        assertThat(dataset.sourceCount()).isEqualTo(2);
        assertThat(dataset.verifiedSourceCount()).isEqualTo(1);
        assertThat(dataset.unverifiedSourceCount()).isEqualTo(1);
        assertThat(queries.unverifiedSources(datasetId, 10)).extracting(source -> source.url())
                .containsExactly(invented);
        String rowId = firstRow(datasetId);
        assertThat(queries.row(datasetId, rowId).orElseThrow().verifiedSourceCount()).isEqualTo(1);
        // The row's own URL field names the invented page, and no field-level attribution is written
        // for it: an attribution to a page nobody retrieved would be a fabricated verification, which
        // is the one thing this system must not produce at any layer.
        assertThat(queries.fieldEvidence(datasetId, rowId))
                .extracting(entry -> entry.get("columnKey")).doesNotContain("posting_url");
    }

    @Test
    void coverageSeparatesAColumnThatIsPopulatedFromOneThatIsAttributed() {
        String runId = newRun();
        String datasetId = save(runId, jobDraft(runId, List.of(JOB_URL), true, List.of(),
                Map.of("role_title", "Backend engineer", "salary_amount", 60000,
                        "posting_url", JOB_URL),
                Map.of("role_title", "Data engineer", "salary_amount", 72000,
                        "posting_url", "https://jobs.test/b/2")));

        Map<String, Object> titles = coverageOf(datasetId, "role_title");
        Map<String, Object> postings = coverageOf(datasetId, "posting_url");
        assertThat(titles.get("rowsWithValue")).isEqualTo(2);
        assertThat(titles.get("rowsAttributed")).isEqualTo(0);
        assertThat(postings.get("rowsWithValue")).isEqualTo(2);
        assertThat(postings.get("rowsAttributed")).isEqualTo(1);
    }

    // --------------------------------------------------------------------- the API

    @Test
    void theDatasetApiAnswersOnEverySurfaceThePhasePromises() throws Exception {
        String runId = newRun();
        String datasetId = save(runId, jobDraft(runId, List.of(JOB_URL), true, List.of(),
                Map.of("role_title", "Backend engineer", "salary_amount", 60000,
                        "location", "Bengaluru", "posting_url", JOB_URL),
                Map.of("role_title", "Data engineer", "salary_amount", 72000, "location", "Pune",
                        "posting_url", "https://jobs.test/b/2")));
        String rowId = firstRow(datasetId);

        mockMvc.perform(get("/api/v1/datasets"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.datasets[0].id").value(datasetId))
                .andExpect(jsonPath("$.datasets[0].rowCount").value(2));
        mockMvc.perform(get("/api/v1/datasets/" + datasetId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entityType").value("job_posting"))
                .andExpect(jsonPath("$.validRowCount").value(2))
                .andExpect(jsonPath("$.verifiedSourceCount").value(1))
                .andExpect(jsonPath("$.qualityBasis").value(
                        org.hamcrest.Matchers.containsString("equal-weight mean")));
        mockMvc.perform(get("/api/v1/datasets/" + datasetId + "/schema"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.columnCount").value(4))
                .andExpect(jsonPath("$.columns[0].key").value("role_title"))
                .andExpect(jsonPath("$.columns[0].origin").value("PLAN"));
        mockMvc.perform(get("/api/v1/datasets/" + datasetId + "/rows")
                        .param("filter", "location:eq:Pune").param("sort", "salary_amount")
                        .param("asc", "false"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matchedRows").value(1))
                .andExpect(jsonPath("$.rows[0].values.role_title").value("Data engineer"));
        mockMvc.perform(get("/api/v1/datasets/" + datasetId + "/search").param("q", "backend"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rows[0].matchedFields[0]").value("role_title"));
        mockMvc.perform(get("/api/v1/datasets/" + datasetId + "/filters").param("key", "salary_amount"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filters[0].type").value("NUMBER"))
                .andExpect(jsonPath("$.operators.text").exists());
        mockMvc.perform(get("/api/v1/datasets/" + datasetId + "/sources"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.sources[0].verifiedByTool").value(true))
                .andExpect(jsonPath("$.sources[0].citedByRows").value(2));
        mockMvc.perform(get("/api/v1/datasets/" + datasetId + "/sources/"
                        + sourceIdFor(datasetId, JOB_URL) + "/rows"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matchedRows").value(2));
        mockMvc.perform(get("/api/v1/datasets/" + datasetId + "/evidence"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recordsWithoutEvidence").value(0))
                .andExpect(jsonPath("$.coverage").exists())
                .andExpect(jsonPath("$.citedButNeverRetrieved").isEmpty());
        mockMvc.perform(get("/api/v1/datasets/" + datasetId + "/rows/" + rowId + "/evidence"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.runId").value(runId))
                .andExpect(jsonPath("$.stepId").isNotEmpty())
                .andExpect(jsonPath("$.fields[?(@.key == 'posting_url')].attributed")
                        .value(org.hamcrest.Matchers.contains(true)))
                .andExpect(jsonPath("$.fields[?(@.key == 'role_title')].attributed")
                        .value(org.hamcrest.Matchers.contains(false)));
    }

    @Test
    void unknownIdsAnswerAsNotFoundAndAForeignWorkspaceCannotBeProbed() throws Exception {
        mockMvc.perform(get("/api/v1/datasets/does-not-exist"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("DATASET_NOT_FOUND"));
        mockMvc.perform(get("/api/v1/datasets/does-not-exist/rows"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/datasets/does-not-exist/evidence"))
                .andExpect(status().isNotFound());

        String foreignRun = newRun(OTHER_WORKSPACE);
        String foreignDataset = save(foreignRun, jobDraft(foreignRun, List.of(JOB_URL), true,
                List.of(), Map.of("role_title", "Backend engineer", "posting_url", JOB_URL)));
        // Another workspace's dataset answers exactly like one that does not exist: confirming the
        // first is itself a disclosure.
        mockMvc.perform(get("/api/v1/datasets/" + foreignDataset))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("DATASET_NOT_FOUND"));
        mockMvc.perform(get("/api/v1/datasets/" + foreignDataset + "/rows"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/datasets/" + foreignDataset + "/evidence"))
                .andExpect(status().isNotFound());
        // And the tenant scoping is not decorative: the compound foreign keys mean a dataset's rows
        // reference (dataset_id, workspace_id), so a header cannot be moved out from under them.
        assertThatThrownBy(() -> jdbc.update("UPDATE datasets SET workspace_id = ? WHERE id = ?",
                WORKSPACE, foreignDataset))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    }

    @Test
    void abadFilterAnswerWithTheColumnsThatExistRatherThanAnEmptyPage() throws Exception {
        String runId = newRun();
        String datasetId = save(runId, jobDraft(runId, List.of(JOB_URL), true, List.of(),
                Map.of("role_title", "Backend engineer", "posting_url", JOB_URL)));

        mockMvc.perform(get("/api/v1/datasets/" + datasetId + "/rows")
                        .param("filter", "startup_name:eq:Acme"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_DATASET_QUERY"))
                .andExpect(jsonPath("$.error.message").value(
                        org.hamcrest.Matchers.containsString("role_title")));
        mockMvc.perform(get("/api/v1/datasets/" + datasetId + "/rows")
                        .param("filter", "location:eq"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/datasets/" + datasetId + "/search").param("q", "  "))
                .andExpect(status().isBadRequest());
    }

    // ------------------------------------------------------------------ fixtures

    private String newRun() {
        return newRun(WORKSPACE);
    }

    private String newRun(String workspace) {
        String workflowId = UUID.randomUUID().toString();
        String planId = UUID.randomUUID().toString();
        String runId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO workflows (id, workspace_id, created_by_id, name, requirement_text)"
                + " VALUES (?, ?, ?, ?, ?)", workflowId, workspace, NIL, "dataset test",
                "list job postings with salary");
        jdbc.update("INSERT INTO workflow_plans (id, workspace_id, workflow_id, version, objective,"
                        + " requirement, extraction_schema, steps, completion_criteria, plan_hash,"
                        + " created_by_id) VALUES (?, ?, ?, 1, ?, '{}', '{}', '[]', '{}', ?, ?)",
                planId, workspace, workflowId, "list job postings", "hash", NIL);
        jdbc.update("INSERT INTO workflow_runs (id, workspace_id, workflow_id, plan_id, status,"
                        + " records_found, records_valid) VALUES (?, ?, ?, ?, 'COMPLETED', 2, 2)",
                runId, workspace, workflowId, planId);
        // Remembered, because a dataset's foreign keys point at the run's own workflow and plan: a
        // fixture that invented those ids would never touch the constraints it appears to exercise.
        parents.put(runId, new String[] {workflowId, planId, workspace});
        return runId;
    }

    /** The save step's own id, so a dataset row names the step that wrote it. */
    private String save(String runId, DatasetDraft draft) {
        String workspace = draft.header().workspaceId();
        String existing = datasets.findByRun(workspace, runId).map(d -> d.id()).orElse(null);
        String datasetId = existing == null ? UUID.randomUUID().toString() : existing;
        datasets.save(datasetId, draft);
        return datasetId;
    }

    @SafeVarargs
    private final DatasetDraft jobDraft(String runId, List<String> citedUrls, boolean citedVerified,
                                        List<String> refusedUrls, Map<String, Object>... values) {
        List<QualityResult.Record> records = new ArrayList<>();
        for (int index = 0; index < values.length; index++) {
            List<QualityResult.Source> sources = citedUrls.stream()
                    .map(url -> new QualityResult.Source(url, "A posting", "snippet", "scrape",
                            "2026-02-01T09:00:00Z", citedVerified))
                    .toList();
            Map<String, Object> typed = new LinkedHashMap<>(values[index]);
            records.add(new QualityResult.Record(index, typed, typed, sources, true, List.of(),
                    citedVerified ? "SOURCE_CITED" : "SOURCE_CITED_UNVERIFIED", null, 0.8, null, null,
                    null, false, List.of(), List.of(), List.of()));
        }
        List<Map<String, Object>> refused = refusedUrls.stream()
                .map(url -> (Map<String, Object>) new LinkedHashMap<String, Object>(
                        Map.of("url", url, "code", "ROBOTS_DISALLOWED",
                                "reason", "robots.txt disallows /postings")))
                .toList();
        DatasetAssembler.Origin origin = origin(runId, "list job postings", "job_posting");
        return DatasetAssembler.assemble(origin, produced(records), allValid(records),
                DeclaredContract.fromFields(JOB_FIELDS, List.of("role_title", "posting_url")), refused);
    }

    private DatasetDraft episodeDraft(String runId, Map<String, Object> values) {
        Map<String, Object> typed = new LinkedHashMap<>(values);
        QualityResult.Record record = new QualityResult.Record(0, typed, typed,
                List.of(new QualityResult.Source("https://podcasts.test/e/12", "Ep", "s", "scrape",
                        "2026-02-01T09:00:00Z", true)),
                true, List.of(), "SOURCE_CITED", null, 0.7, null, null, null, false, List.of(),
                List.of(), List.of());
        DatasetAssembler.Origin origin = origin(runId, "list podcast episodes", "podcast_episode");
        return DatasetAssembler.assemble(origin, produced(List.of(record)),
                allValid(List.of(record)),
                DeclaredContract.fromFields(EPISODE_FIELDS, List.of("episode_title")), List.of());
    }

    private DatasetAssembler.Origin origin(String runId, String objective, String entityType) {
        String[] parent = parents.get(runId);
        assertThat(parent).as("the test created the run before assembling its dataset").isNotNull();
        return new DatasetAssembler.Origin(parent[2], runId, parent[0], parent[1], "step-save-1",
                objective, objective + " with salary and source", entityType,
                Map.of("type", "object"));
    }

    /** Re-builds a draft with the second record linked to the first, as the pipeline would report it. */
    private DatasetDraft withDuplicate(DatasetDraft draft, int duplicateIndex, int canonicalIndex,
                                       String matchType) {
        // The assembly is pure, so a test can re-assemble with a link instead of the save step
        // inventing one: this is the shape the pipeline sends, not a shape the writer fabricates.
        QualityResult.Record canonical = null;
        List<QualityResult.Record> records = new ArrayList<>();
        for (DatasetDraft.DraftRow row : draft.rows()) {
            Integer duplicateOf = row.recordIndex() == duplicateIndex ? canonicalIndex : null;
            records.add(new QualityResult.Record(row.recordIndex(), row.values(), row.rawValues(),
                    rowSourceUrls(draft, row), row.advisoryValid(), List.of(),
                    row.verificationStatus(), null, row.confidence(), duplicateOf, null,
                    duplicateOf == null ? null : matchType, false, List.of(), List.of(), List.of()));
        }
        return DatasetAssembler.assemble(originFor(draft), produced(records), allValid(records),
                DeclaredContract.fromFields(JOB_FIELDS, List.of("role_title", "posting_url")),
                refusedOf(draft));
    }

    /** Re-assembles with one citation reported as never retrieved by a tool. */
    private DatasetDraft markUnverified(DatasetDraft draft, String url) {
        List<QualityResult.Record> records = new ArrayList<>();
        for (DatasetDraft.DraftRow row : draft.rows()) {
            List<QualityResult.Source> sources = rowSourceUrls(draft, row).stream()
                    .map(source -> new QualityResult.Source(source.url(), source.title(),
                            source.snippet(), source.sourceType(), source.retrievedAt(),
                            !url.equals(source.url())))
                    .toList();
            records.add(new QualityResult.Record(row.recordIndex(), row.values(), row.rawValues(),
                    sources, row.advisoryValid(), List.of(), row.verificationStatus(), null,
                    row.confidence(), null, null, null, false, List.of(), List.of(), List.of()));
        }
        return DatasetAssembler.assemble(originFor(draft), produced(records), allValid(records),
                DeclaredContract.fromFields(JOB_FIELDS, List.of("role_title", "posting_url")),
                refusedOf(draft));
    }

    private static List<QualityResult.Source> rowSourceUrls(DatasetDraft draft,
                                                            DatasetDraft.DraftRow row) {
        Map<String, DatasetDraft.DraftSource> byHash = new LinkedHashMap<>();
        draft.sources().forEach(source -> byHash.put(source.urlHash(), source));
        List<QualityResult.Source> out = new ArrayList<>();
        for (String hash : row.sourceUrlHashes()) {
            DatasetDraft.DraftSource source = byHash.get(hash);
            if (source == null) {
                continue;
            }
            out.add(new QualityResult.Source(source.url(), source.title(), source.snippet(),
                    source.sourceType(), source.retrievedAt(), source.verifiedByTool()));
        }
        return out;
    }

    private static List<Map<String, Object>> refusedOf(DatasetDraft draft) {
        return draft.sources().stream()
                .filter(source -> "REFUSED_BEFORE_FETCH".equals(source.provenance()))
                .map(source -> new LinkedHashMap<String, Object>(Map.of("url", source.url(),
                        "code", source.blockedCode(), "reason", source.blockedReason())))
                .map(map -> (Map<String, Object>) map)
                .toList();
    }

    private static DatasetAssembler.Origin originFor(DatasetDraft draft) {
        var header = draft.header();
        return new DatasetAssembler.Origin(header.workspaceId(), header.runId(), header.workflowId(),
                header.planId(), header.stepId(), header.objective(), header.requirementText(),
                header.entityType(), Map.of("type", "object"));
    }

    private static Map<Integer, Boolean> allValid(List<QualityResult.Record> records) {
        Map<Integer, Boolean> verdicts = new LinkedHashMap<>();
        records.forEach(record -> verdicts.put(record.index(), true));
        return verdicts;
    }

    /** A pipeline answer whose dataset columns come from the records it carries, never hardcoded. */
    private static QualityResult produced(List<QualityResult.Record> records) {
        List<QualityResult.Row> rows = new ArrayList<>();
        List<QualityResult.Column> columns = new ArrayList<>();
        Set<String> keys = new LinkedHashSet<>();
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
                rows.size(), 0.62, "equal-weight mean of five measured ratios",
                Map.of("completeness", 0.5), Map.of());
        return new QualityResult("COMPLETED", records, new QualityResult.Dataset(columns, rows),
                List.of(), quality, List.of(), null);
    }

    // ------------------------------------------------------------------- assertions

    private int count(String table, String datasetId, String condition) {
        String scope = "datasets".equals(table) ? "id" : "dataset_id";
        Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + scope
                + " = ? AND " + condition, Integer.class, datasetId);
        return total == null ? 0 : total;
    }

    private List<String> columnKeys(String datasetId) {
        return queries.columns(datasetId).stream().map(column -> column.fieldKey()).toList();
    }

    private String firstRow(String datasetId) {
        List<String> ids = jdbc.queryForList("SELECT id FROM dataset_rows WHERE dataset_id = ?"
                + " ORDER BY record_index", String.class, datasetId);
        assertThat(ids).isNotEmpty();
        return ids.get(0);
    }

    private String sourceIdFor(String datasetId, String url) {
        return jdbc.queryForObject("SELECT id FROM dataset_sources WHERE dataset_id = ? AND url = ?",
                String.class, datasetId, url);
    }

    private int citedByRows(String sourceId) {
        return jdbc.queryForObject("SELECT cited_by_rows FROM dataset_sources WHERE id = ?",
                Integer.class, sourceId);
    }

    private String searchFor(String datasetId, String needle) {
        List<String> found = jdbc.queryForList("SELECT values_json FROM dataset_rows WHERE"
                + " dataset_id = ? AND LOWER(search_text) LIKE ?", String.class, datasetId,
                "%" + needle.toLowerCase() + "%");
        return found.isEmpty() ? null : found.get(0);
    }

    private Map<String, Object> coverageOf(String datasetId, String key) {
        return queries.coverage(datasetId).stream()
                .filter(entry -> key.equals(entry.get("key"))).findFirst().orElseThrow();
    }

    private Map<String, Object> rowEvidence(String datasetId, String rowId) {
        try {
            String body = mockMvc.perform(get("/api/v1/datasets/" + datasetId + "/rows/" + rowId
                    + "/evidence")).andReturn().getResponse().getContentAsString();
            return mapper.readValue(body, Map.class);
        } catch (Exception e) {
            throw new AssertionError("the evidence endpoint did not answer readably: " + e, e);
        }
    }

    @SuppressWarnings("unchecked")
    private static List<String> attributedFields(Map<String, Object> evidence) {
        List<String> keys = new ArrayList<>();
        for (Map<String, Object> field : (List<Map<String, Object>>) evidence.get("fields")) {
            if (Boolean.TRUE.equals(field.get("attributed"))) {
                keys.add(String.valueOf(field.get("key")));
            }
        }
        return keys;
    }
}
