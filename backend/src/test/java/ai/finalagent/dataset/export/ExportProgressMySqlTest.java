package ai.finalagent.dataset.export;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;

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
import org.springframework.test.web.servlet.MvcResult;

import ai.finalagent.config.FinalAgentProperties;
import ai.finalagent.dataset.domain.DatasetDraft;
import ai.finalagent.dataset.domain.DatasetRows;
import ai.finalagent.dataset.repository.DatasetQueryRepository;
import ai.finalagent.dataset.repository.DatasetQueryRepository.Filter;
import ai.finalagent.dataset.repository.DatasetQueryRepository.RowQuery;
import ai.finalagent.dataset.repository.DatasetQueryRepository.UnknownColumnException;
import ai.finalagent.dataset.repository.DatasetRepository;
import ai.finalagent.dataset.repository.ExportRepository;
import ai.finalagent.dataset.service.ExportService;
import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.execution.WorkflowJobExecutor;
import ai.finalagent.workflow.execution.WorkflowWorker;
import ai.finalagent.workflow.repository.JobRepository;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.support.TestPrincipal;
import ai.finalagent.workflow.support.Json;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Exports through the real queue, against real MySQL.
 *
 * <p>The name of this class is the claim it exists to test. Progress is a measurement of rows written,
 * so a job cannot report a share it has not reached and cannot reach 100 before every row has gone
 * through a writer. The project this replaced reported progress from status — {@code RUNNING → 50} —
 * and a wedged export looked half-finished forever
 * ({@code export.service.ts:41-53}, {@code 00-FORENSIC-AUDIT.md} §5). Every assertion below about a
 * percentage is an assertion that the old mapping cannot come back.
 *
 * <p>The supplier handed to {@link ExportRunner} is what makes the middle of a run observable: it is
 * called once per chunk on the writing thread, so whatever the database says at that instant is what a
 * caller polling the record would have seen. Nothing is simulated — the rows, the checkpoints and the
 * file are all real.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("mysql")
@EnabledIfEnvironmentVariable(named = "FINALAGENT_TEST_MYSQL", matches = "true")
class ExportProgressMySqlTest {

    private static final String WORKSPACE = "00000000-0000-0000-0000-000000000ff1";
    private static final String NIL = "00000000-0000-0000-0000-000000000000";
    private static final String URL = "https://jobs.test/b/1";

    @Autowired
    private ExportService service;
    @Autowired
    private ExportRunner runner;
    @Autowired
    private ExportRepository exports;
    @Autowired
    private DatasetRepository datasets;
    @Autowired
    private DatasetQueryRepository queries;
    @Autowired
    private JobRepository jobs;
    @Autowired
    private StepRepository steps;
    @Autowired
    private WorkflowJobExecutor executor;
    @Autowired
    private WorkflowWorker worker;
    @Autowired
    private FinalAgentProperties properties;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper mapper = new ObjectMapper();

    /**
     * The suites in this file call services directly as well as through MockMvc, and a direct call
     * has no request to carry a session. Bound here so {@code Workspace.current()} resolves the same
     * tenant the MockMvc post-processor hands to the filter chain — one principal, both paths.
     */
    private AutoCloseable principal;

    @BeforeEach
    void beSomebody() {
        principal = TestPrincipal.bind();
    }

    @AfterEach
    void stopBeingSomebody() throws Exception {
        principal.close();
    }

    @BeforeEach
    @AfterEach
    void startAndEndWithNothing() throws IOException {
        TestPrincipal.provision(jdbc, WORKSPACE, NIL);
        jdbc.update("DELETE FROM export_jobs WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM workflow_jobs WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM dataset_row_sources WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM dataset_field_evidence WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM dataset_conflicts WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM dataset_sources WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM dataset_columns WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM dataset_rows WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM datasets WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM activity_events WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM workflow_steps WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM workflow_runs WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM workflow_plans WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM workflows WHERE workspace_id = ?", WORKSPACE);
        Path dir = Path.of(properties.export().dir());
        if (Files.isDirectory(dir)) {
            try (var files = Files.list(dir)) {
                for (Path file : files.toList()) {
                    Files.deleteIfExists(file);
                }
            }
        }
    }

    // ---------------------------------------------------------------- the measurement

    @Test
    void progressAdvancesByWholeChunksAndReachesOneOnlyWhenTheRowsHave() {
        String datasetId = dataset(5);
        DatasetRows.Export export = service.request(datasetId, "CSV", everything());
        assertThat(export.status()).isEqualTo("QUEUED");
        // The requester is told how big this will be before a byte is written, because the count is
        // what the percentage will be measured against.
        assertThat(export.totalRows()).isEqualTo(5);
        assertThat(export.progressPercent()).isZero();

        List<Integer> observed = new ArrayList<>();
        List<Integer> observedWritten = new ArrayList<>();
        BooleanSupplier peeking = () -> {
            exports.find(WORKSPACE, export.id()).ifPresent(current -> {
                observed.add(current.progressPercent());
                observedWritten.add(current.writtenRows());
            });
            return true;
        };

        ExportRunner.Outcome outcome = runner.run(WORKSPACE, export.id(), peeking, () -> false);
        assertThat(outcome.status()).isEqualTo(JobStatus.COMPLETED);

        // Five rows at the test profile's chunk of two: the writer starts at nothing and checkpoints
        // after 2 and after 4.
        assertThat(observedWritten).containsExactly(0, 2, 4);
        assertThat(observed).containsExactly(0, 40, 80);
        assertThat(observed).allSatisfy(value -> assertThat(value).isLessThan(100));

        DatasetRows.Export finished = exports.find(WORKSPACE, export.id()).orElseThrow();
        assertThat(finished.status()).isEqualTo("COMPLETED");
        assertThat(finished.writtenRows()).isEqualTo(5);
        assertThat(finished.totalRows()).isEqualTo(5);
        assertThat(finished.progressPercent()).isEqualTo(100);
        assertThat(outcome.summary()).containsEntry("rowsWritten", 5).containsEntry("totalRows", 5);
        assertThat(Path.of(finished.filePath())).exists();
    }

    @Test
    void theClaimedJobRunsThroughTheExecutorAndItsFileIsDownloadable() throws Exception {
        String datasetId = dataset(3);
        DatasetRows.Export export = service.request(datasetId, "JSON", everything());
        Job job = jobs.findById(export.jobId()).orElseThrow();
        // The same table, the same claim, the same lease as a step — and no step of its own.
        assertThat(job.jobType()).isEqualTo("EXPORT");
        assertThat(job.stepId()).isNull();
        assertThat(job.runId()).isEqualTo(export.runId());

        Job settled = claimAndRun(job.id());
        assertThat(settled.status())
                .as("job outcome, with the queue's reason: %s / %s", settled.lastErrorCode(),
                        settled.lastErrorMessage())
                .isEqualTo(JobStatus.COMPLETED);
        assertThat(Json.object(settled.resultSummaryJson())).containsEntry("exportId", export.id())
                .containsEntry("rowsWritten", 3);

        DatasetRows.Export finished = exports.find(WORKSPACE, export.id()).orElseThrow();
        MvcResult result = mockMvc.perform(get("/api/v1/exports/" + export.id() + "/download").with(TestPrincipal.principal()))
                .andExpect(status().isOk())
                .andReturn();
        Map<String, Object> doc = mapper.readValue(result.getResponse().getContentAsString(),
                Map.class);
        assertThat((List<?>) doc.get("rows")).hasSize(3);
        assertThat((List<?>) doc.get("columns")).hasSize(2);
        assertThat(mapper.writeValueAsString(doc.get("dataset"))).contains("startup");

        // What the header offers is the digest the writer computed over the bytes it published.
        assertThat(result.getResponse().getHeader("X-Content-Sha256"))
                .isEqualTo(finished.checksum()).isEqualTo(sha256(Path.of(finished.filePath())));
        assertThat(result.getResponse().getHeader("Content-Disposition"))
                .contains(finished.fileName());
    }

    // ---------------------------------------------------------------- stopping

    @Test
    void aCancellationMidWritePublishesNoFileAndLeavesNoHalfWrittenWorkbook() {
        String datasetId = dataset(6);
        DatasetRows.Export export = service.request(datasetId, "XLSX", everything());
        Path target = runner.fileFor(export);

        // The checkpoint is the cancellation channel: the runner stops because its own advance refused
        // to move a record someone had cancelled, not because this test held a flag.
        // The checkpoint is the cancellation channel: the runner stops because its own advance refused
        // to move a record someone had cancelled, not because this test held a flag.
        BooleanSupplier cancelAfterFourRows = () -> {
            DatasetRows.Export current = exports.find(WORKSPACE, export.id()).orElseThrow();
            if (current.writtenRows() >= 4) {
                exports.cancel(export.id());
            }
            return true;
        };

        ExportRunner.Outcome outcome = runner.run(WORKSPACE, export.id(), cancelAfterFourRows,
                () -> false);
        assertThat(outcome.errorCode()).isEqualTo("EXPORT_CANCELLED");

        DatasetRows.Export stopped = exports.find(WORKSPACE, export.id()).orElseThrow();
        assertThat(stopped.status()).isEqualTo("CANCELLED");
        assertThat(stopped.writtenRows()).isEqualTo(4);
        assertThat(stopped.progressPercent()).isEqualTo(66);
        assertThat(stopped.checksum()).isNull();
        assertThat(target).doesNotExist();
        assertThat(target.resolveSibling(target.getFileName() + ".part")).doesNotExist();
    }

    @Test
    void aWorkerWhoseLeaseWasTakenOverWritesNoTerminalStateForTheJobItFinished() {
        String datasetId = dataset(2);
        DatasetRows.Export export = service.request(datasetId, "CSV", everything());
        Job job = jobs.findById(export.jobId()).orElseThrow();
        assertThat(jobs.claim(job.id(), job.version(), worker.workerId(), 60)).isTrue();
        // Taken away before the work runs, which is the state a slow worker actually meets: it holds
        // no claim, so nothing it produces may be recorded as the job's outcome.
        assertThat(jdbc.update("UPDATE workflow_jobs SET worker_id = 'another-worker',"
                + " version = version + 1 WHERE id = ?", job.id())).isEqualTo(1);

        executor.run(jobs.findById(job.id()).orElseThrow());

        Job after = jobs.findById(job.id()).orElseThrow();
        assertThat(after.status()).isEqualTo(JobStatus.RUNNING);
        assertThat(after.workerId()).isEqualTo("another-worker");
        assertThat(after.resultSummaryJson()).isNull();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_events"
                + " WHERE action = 'workflow.job.lease_lost' AND entity_id = ?", Integer.class,
                job.id())).isEqualTo(1);
    }

    @Test
    void anExportPastTheCeilingRefusesWithTheCountItStoppedAtInsteadOfTruncating() {
        int rows = properties.export().maxRows() + 1;
        String datasetId = dataset(rows);
        DatasetRows.Export export = service.request(datasetId, "CSV", everything());
        assertThat(export.totalRows()).isEqualTo(rows);

        ExportRunner.Outcome outcome = runner.run(WORKSPACE, export.id(), () -> true, () -> false);
        assertThat(outcome.errorCode()).isEqualTo("EXPORT_TOO_LARGE");
        assertThat(outcome.errorMessage()).contains(String.valueOf(rows))
                .contains(String.valueOf(properties.export().maxRows()));

        DatasetRows.Export failed = exports.find(WORKSPACE, export.id()).orElseThrow();
        assertThat(failed.status()).isEqualTo("FAILED");
        assertThat(failed.writtenRows()).isZero();
        assertThat(failed.progressPercent()).isZero();
        assertThat(runner.fileFor(failed)).doesNotExist();
    }

    @Test
    void cancellingAQueuedExportCancelsTheJobThatWouldHaveRunIt() {
        String datasetId = dataset(2);
        DatasetRows.Export export = service.request(datasetId, "CSV", everything());
        assertThat(service.cancel(export.id())).isTrue();

        assertThat(exports.find(WORKSPACE, export.id()).orElseThrow().status())
                .isEqualTo("CANCELLED");
        assertThat(jobs.findById(export.jobId()).orElseThrow().status())
                .isEqualTo(JobStatus.CANCELLED);
        // A cancelled row must not be revived by the sweeper or picked up by the claim query.
        assertThat(jobs.findClaimable()).isEmpty();

        // A reclaimed job over a settled export is skipped rather than written a second time.
        ExportRunner.Outcome outcome = runner.run(WORKSPACE, export.id(), () -> true, () -> false);
        assertThat(outcome.status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(outcome.summary()).containsKey("skipped");
    }

    @Test
    void aReclaimedJobWhoseExportAlreadyFinishedIsSkippedRatherThanWrittenTwice() {
        String datasetId = dataset(2);
        DatasetRows.Export export = service.request(datasetId, "JSON", everything());
        claimAndRun(export.jobId());
        DatasetRows.Export first = exports.find(WORKSPACE, export.id()).orElseThrow();
        long bytes = first.fileBytes();
        String checksum = first.checksum();

        // Same job, second attempt: a lease that expired after the write but before the terminal state
        // is a real sequence, and rewriting would publish a different file under one recorded digest.
        ExportRunner.Outcome again = runner.run(WORKSPACE, export.id(), () -> true, () -> false);
        assertThat(again.status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(again.summary()).containsKey("skipped");

        DatasetRows.Export unchanged = exports.find(WORKSPACE, export.id()).orElseThrow();
        assertThat(unchanged.fileBytes()).isEqualTo(bytes);
        assertThat(unchanged.checksum()).isEqualTo(checksum);
        assertThat(unchanged.progressPercent()).isEqualTo(100);
    }

    // ---------------------------------------------------------------- scope and surface

    @Test
    void theFilterTheListingWasShowingIsTheFilterTheFileContains() throws Exception {
        String datasetId = dataset(5);
        RowQuery filtered = new RowQuery(null, List.of(Filter.parse("salary:gte:70000")), null,
                true, null, true, 0, 50);
        // The listing the user was looking at, read the ordinary way. Asserted here so a later
        // failure says which of the two sides drifted.
        assertThat(queries.rows(datasetId, filtered)).hasSize(3);
        assertThat(queries.countRows(datasetId, filtered)).isEqualTo(3);

        DatasetRows.Export export = service.request(datasetId, "JSON", filtered);

        List<?> stored = (List<?>) Json.object(export.scopeJson()).get("filters");
        assertThat(stored).hasSize(1);
        assertThat(Json.object(export.scopeJson())).containsEntry("sort", null);

        claimAndRun(export.jobId());
        DatasetRows.Export finished = exports.find(WORKSPACE, export.id()).orElseThrow();
        // Three of the five rows clear 70000, and the export wrote three: the scope round-tripped
        // through the row rather than being forgotten when the job started.
        assertThat(finished.totalRows()).isEqualTo(3);
        assertThat(finished.writtenRows()).isEqualTo(3);
        assertThat(finished.progressPercent()).isEqualTo(100);

        MvcResult result = mockMvc.perform(get("/api/v1/exports/" + export.id() + "/download").with(TestPrincipal.principal()))
                .andExpect(status().isOk())
                .andReturn();
        Map<String, Object> doc = mapper.readValue(result.getResponse().getContentAsString(),
                Map.class);
        assertThat((List<?>) doc.get("rows")).hasSize(3);
    }

    @Test
    void aFilterOnAColumnTheDatasetNeverDeclaredIsARequestErrorNotAFailedJob() {
        String datasetId = dataset(2);
        RowQuery bad = new RowQuery(null, List.of(new Filter("no_such_column", "eq", "x")), null,
                true, null, true, 0, 0);

        // Rejected on the request thread, before a job exists: an export that fails minutes later for
        // a reason the caller could have been told immediately is a wasted worker.
        assertThatThrownBy(() -> service.request(datasetId, "CSV", bad))
                .isInstanceOf(UnknownColumnException.class);
        assertThat(jobs.countPending()).isZero();
        assertThat(exports.list(WORKSPACE, null, 10, 0)).isEmpty();
    }

    @Test
    void aQueuedExportAnswersNotYetRatherThanNotFoundAndAForeignIdAnswersNotFound() throws Exception {
        String datasetId = dataset(2);
        DatasetRows.Export queued = service.request(datasetId, "CSV", everything());

        mockMvc.perform(get("/api/v1/exports/" + queued.id() + "/download").with(TestPrincipal.principal()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EXPORT_NOT_COMPLETED"));

        mockMvc.perform(get("/api/v1/exports/someone-elses-export").with(TestPrincipal.principal()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("EXPORT_NOT_FOUND"));

        MvcResult listing = mockMvc.perform(get("/api/v1/exports?datasetId=" + datasetId).with(TestPrincipal.principal()))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(listing.getResponse().getContentAsString()).contains(queued.id());
    }

    @Test
    void monitoringAndHistoryReportTheCountsTheTablesHold() throws Exception {
        String datasetId = dataset(3);
        DatasetRows.Export export = service.request(datasetId, "CSV", everything());
        claimAndRun(export.jobId());
        String workflowId = jdbc.queryForObject("SELECT workflow_id FROM datasets WHERE id = ?",
                String.class, datasetId);
        String runId = export.runId();
        steps.insert(UUID.randomUUID().toString(), WORKSPACE, runId, 1, "collect", 1, "[]", "EXTRACT",
                "{}");
        steps.insert(UUID.randomUUID().toString(), WORKSPACE, runId, 1, "save", 2, "[\"collect\"]",
                "SAVE", "{}");

        Map<String, Object> monitoring = getJson("/api/v1/monitoring");
        Map<String, Object> runBlock = asMap(monitoring.get("runs"));
        Map<String, Object> byStatus = asMap(runBlock.get("byStatus"));
        // Every status is named, including the zero ones, so "none" is never read as "not counted".
        assertThat(byStatus).containsKeys("PENDING", "PLANNING", "RUNNING", "COMPLETED", "PARTIAL",
                "FAILED", "CANCELLED");
        assertThat(byStatus).containsEntry("COMPLETED", 1).containsEntry("FAILED", 0);
        assertThat(asMap(runBlock.get("totals"))).containsEntry("recordsFound", 3);
        assertThat(asMap(monitoring.get("exports"))).containsEntry("COMPLETED", 1)
                .containsEntry("QUEUED", 0);
        Map<String, Object> datasetBlock = asMap(monitoring.get("datasets"));
        assertThat(datasetBlock).containsEntry("total", 1);
        assertThat(asMap(datasetBlock.get("rows"))).containsEntry("rows", 3);
        assertThat(asMap(monitoring.get("queue")).get("scope")).asString()
                .contains("queue-wide");

        Map<String, Object> workflow = asMap(first(getJson("/api/v1/workflows").get("workflows")));
        assertThat(workflow).containsEntry("runCount", 1).containsEntry("latestPlanVersion", 1);

        Map<String, Object> runHistory = getJson("/api/v1/workflows/" + workflowId + "/runs");
        assertThat((List<?>) runHistory.get("runs")).hasSize(1);
        assertThat(asMap(first(runHistory.get("runs")))).containsEntry("attempt", 1);

        Map<String, Object> stepHistory = getJson("/api/v1/workflows/runs/" + runId + "/steps");
        assertThat((List<?>) stepHistory.get("steps")).hasSize(2);
        assertThat(stepHistory.get("runStatus")).isEqualTo("COMPLETED");

        Map<String, Object> feed = getJson("/api/v1/activity?after=0&limit=5");
        assertThat((List<?>) feed.get("events")).isNotEmpty();
        long cursor = ((Number) feed.get("nextCursor")).longValue();
        assertThat(cursor).isPositive();
        assertThat(getJson("/api/v1/activity?after=" + cursor + "&limit=5").get("events"))
                .isEqualTo(List.of());

        Map<String, Object> filtered = getJson("/api/v1/activity?action=export.&limit=5");
        assertThat((List<?>) filtered.get("events")).isNotEmpty();
        ((List<?>) filtered.get("events")).forEach(event ->
                assertThat(((Map<?, ?>) event).get("action")).asString().startsWith("export."));
    }

    // ---------------------------------------------------------------------- fixtures

    private Job claimAndRun(String jobId) {
        Job job = jobs.findById(jobId).orElseThrow();
        assertThat(jobs.claim(job.id(), job.version(), worker.workerId(), 60)).isTrue();
        executor.run(jobs.findById(jobId).orElseThrow());
        return jobs.findById(jobId).orElseThrow();
    }

    private Map<String, Object> getJson(String url) throws Exception {
        return mapper.readValue(mockMvc.perform(get(url).with(TestPrincipal.principal())).andReturn()
                .getResponse().getContentAsString(), Map.class);
    }

    private static Object first(Object listing) {
        return ((List<?>) listing).get(0);
    }

    /** A JSON object read back is a map of unknowns; the asserts below want typed keys. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        return (Map<String, Object>) value;
    }

    private static RowQuery everything() {
        return new RowQuery(null, List.of(), null, true, null, true, 0, 0);
    }

    /** A run with a workflow, a plan and a dataset of {@code count} rows, all of it real. */
    private String dataset(int count) {
        String workflowId = UUID.randomUUID().toString();
        String planId = UUID.randomUUID().toString();
        String runId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO workflows (id, workspace_id, created_by_id, name, requirement_text)"
                + " VALUES (?, ?, ?, ?, ?)", workflowId, WORKSPACE, NIL, "export test",
                "list job postings with salary");
        jdbc.update("INSERT INTO workflow_plans (id, workspace_id, workflow_id, version, objective,"
                        + " requirement, extraction_schema, steps, completion_criteria, plan_hash,"
                        + " created_by_id) VALUES (?, ?, ?, 1, ?, '{}', '{}', '[]', '{}', ?, ?)",
                planId, WORKSPACE, workflowId, "list job postings", "hash", NIL);
        jdbc.update("INSERT INTO workflow_runs (id, workspace_id, workflow_id, plan_id, status,"
                        + " records_found, records_valid) VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?)",
                runId, WORKSPACE, workflowId, planId, count, count);

        DatasetDraft.Builder draft = new DatasetDraft.Builder(new DatasetDraft.Header(WORKSPACE, runId,
                workflowId, planId, null, "list job postings", "list job postings with salary",
                "startup", "{}", "READY", "TEST", "{}", 0.8));
        draft.column(new DatasetDraft.DraftColumn("role_title", "Role", "STRING", true, 0, "PLAN",
                null, count));
        draft.column(new DatasetDraft.DraftColumn("salary", "Salary", "NUMBER", false, 1, "PLAN",
                null, count));
        String hash = hash(URL);
        draft.source(new DatasetDraft.DraftSource(URL, hash, "jobs.test", "A posting", "snippet",
                "scrape", "2026-02-01T09:00:00Z", true, "TOOL_RETURNED", null, null));
        for (int index = 0; index < count; index++) {
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("role_title", "Engineer " + index);
            // From 50000 up in 10000s, so exactly three of five rows clear the filtered export's 70000.
            values.put("salary", 50000 + index * 10000);
            draft.row(new DatasetDraft.DraftRow(index, values, values, true, true, "SOURCE_CITED",
                    0.9, null, null, null, false, List.of(), List.of(), List.of(), List.of(hash),
                    List.of(), null, List.of()));
        }
        String datasetId = UUID.randomUUID().toString();
        datasets.save(datasetId, draft.build());
        return datasetId;
    }

    private static String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String sha256(Path file) throws IOException, java.security.NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        digest.update(Files.readAllBytes(file));
        return HexFormat.of().formatHex(digest.digest());
    }
}
