package ai.finalagent.workflow.execution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.fail;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import ai.finalagent.aiclient.AiServiceClient;
import ai.finalagent.aiclient.dto.QualityRequest;
import ai.finalagent.aiclient.dto.QualityResult;
import ai.finalagent.aiclient.dto.ResearchRequest;
import ai.finalagent.aiclient.dto.ResearchResult;
import ai.finalagent.requirement.RequirementAnalysisDto;
import ai.finalagent.requirement.RequirementDto;
import ai.finalagent.workflow.domain.JobStatus;
import ai.finalagent.workflow.domain.Records.Job;
import ai.finalagent.workflow.domain.Records.Run;
import ai.finalagent.workflow.domain.Records.Step;
import ai.finalagent.workflow.domain.RunStatus;
import ai.finalagent.workflow.repository.ActivityRepository;
import ai.finalagent.workflow.repository.JobRepository;
import ai.finalagent.workflow.repository.RunRepository;
import ai.finalagent.workflow.repository.StepRepository;
import ai.finalagent.workflow.repository.WorkflowRepository;
import ai.finalagent.workflow.service.WorkflowService;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The flow this phase is about, end to end against the real database: the API creates a run, the run
 * becomes jobs, a worker claims them, each step executes, the result is processed, and the status,
 * progress and counters that follow are written down.
 *
 * <p>The AI service is the only thing mocked, and only because Firecrawl and Gemini are not
 * reachable here — so the collection boundary is asserted at the request that leaves Spring, not at
 * what a provider would have answered. Everything between the endpoint and the rows is under test.
 *
 * <p>The claim loop is driven by hand rather than by a background timer: "what had been scheduled by
 * then" is the question several of these tests ask, and a poller on its own clock makes it
 * unanswerable. The profile's poll interval is set to its maximum so the scheduled pass never lands
 * mid-test.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("mysql")
@EnabledIfEnvironmentVariable(named = "FINALAGENT_TEST_MYSQL", matches = "true")
class WorkflowRunLifecycleMySqlTest {

    private static final String WORKSPACE = "00000000-0000-0000-0000-000000000ff1";
    private static final String PROMPT = "list the two most subscribed youtube channels teaching "
            + "programming in india";
    private static final String OBJECTIVE =
            "List the most subscribed YouTube channels that teach programming in India";

    @Autowired
    private WorkflowService service;
    @Autowired
    private WorkflowWorker worker;
    @Autowired
    private JobRepository jobs;
    @Autowired
    private StepRepository steps;
    @Autowired
    private RunRepository runs;
    @Autowired
    private WorkflowRepository workflows;
    @Autowired
    private ActivityRepository activity;
    @Autowired
    private ai.finalagent.dataset.repository.DatasetRepository datasets;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private AiServiceClient aiServiceClient;

    @BeforeEach
    void startFromNothingWithTheLoopUnderMyControl() {
        emptyWorkspace();
        worker.start();
    }

    @AfterEach
    void stopAndClean() {
        worker.stop();
        emptyWorkspace();
    }

    private void emptyWorkspace() {
        worker.stop();
        jdbc.update("DELETE FROM activity_events WHERE workspace_id = ?", WORKSPACE);
        jdbc.update("DELETE FROM workflows WHERE workspace_id = ?", WORKSPACE);
    }

    // --------------------------------------------------------------------- fixtures

    private static RequirementDto requirement(int quantity) {
        return new RequirementDto(OBJECTIVE, "youtube_channel", quantity,
                new RequirementDto.Geography(List.of("India"), "country", false),
                new RequirementDto.TimeRange(null, null, null),
                List.of(), List.of(),
                List.of(new RequirementDto.Field("channel_name", "Channel", "STRING", null),
                        new RequirementDto.Field("channel_url", "Channel URL", "URL", null)),
                List.of("channel_name", "channel_url"), List.of(),
                List.of("youtube.com"), List.of(), List.of("channel_url"), List.of(),
                "table", List.of(), List.of(), List.of());
    }

    /** A schema Java accepts: closed objects, so an invented field is caught rather than stored. */
    private static Map<String, Object> channelSchema() {
        return Map.of(
                "type", "object",
                "properties", Map.of("records", Map.of(
                        "type", "array",
                        "items", Map.of(
                                "type", "object",
                                "properties", Map.of("channel_name", Map.of("type", "string"),
                                        "channel_url", Map.of("type", "string")),
                                "required", List.of("channel_name", "channel_url"),
                                "additionalProperties", false)),
                        "additionalProperties", false),
                "required", List.of("records"),
                "additionalProperties", false);
    }

    private static RequirementAnalysisDto analysis(int quantity) {
        return new RequirementAnalysisDto("valid", requirement(quantity), channelSchema(),
                List.of("coding tutorial channels india"),
                "List 2 YouTube channels teaching programming in India.",
                Map.of("preferredDomains", List.of("youtube.com"), "blockedDomains", List.of(),
                        "respectRobotsTxt", true),
                List.of(), Map.of("model", "gemini-2.5-flash"));
    }

    private static ResearchResult.Source source(String url, boolean verifiedByTool) {
        return new ResearchResult.Source(url, "A channel", "snippet", "search+scrape",
                Instant.now().toString(), verifiedByTool, verifiedByTool ? 1 : 0);
    }

    private static ResearchResult.Source source(String url) {
        return source(url, true);
    }

    private static ResearchResult collected(int count) {
        List<ResearchResult.Record> records = new ArrayList<>();
        for (int i = 1; i <= count; i++) {
            String url = "https://youtube.test/c/channel-" + i;
            records.add(new ResearchResult.Record(
                    Map.of("channel_name", "Channel " + i, "channel_url", url),
                    List.of(source(url))));
        }
        List<ResearchResult.Source> sources = records.stream()
                .flatMap(record -> record.sources().stream()).toList();
        return new ResearchResult("COMPLETED", records, sources, Map.of("loopsUsed", 2),
                new ResearchResult.Validation(true, List.of(), List.of(), 0, true, List.of(),
                        List.of(), List.of(), 0, List.of(), List.of(), List.of()), null);
    }

    /**
     * The pipeline's answer for the records a run collected: the same values and the same provenance,
     * with the advisory verdict the Python side would give. Every record comes back {@code isValid},
     * which is the point — where the collection cited nothing a tool retrieved, Java's own gate is the
     * one that says no.
     */
    private static QualityResult processed(int count) {
        List<QualityResult.Record> records = new ArrayList<>();
        for (int i = 1; i <= count; i++) {
            String url = "https://youtube.test/c/channel-" + i;
            records.add(processedRecord(i - 1, "Channel " + i, url, true));
        }
        return pipelineAnswer(records);
    }

    private static QualityResult processed(List<ResearchResult.Record> records) {
        List<QualityResult.Record> processed = new ArrayList<>();
        for (int index = 0; index < records.size(); index++) {
            ResearchResult.Record record = records.get(index);
            ResearchResult.Source first = record.sources().isEmpty() ? null : record.sources().get(0);
            processed.add(processedRecord(index, String.valueOf(record.values().get("channel_name")),
                    first == null ? "" : first.url(),
                    first != null && first.verifiedByTool()));
        }
        return pipelineAnswer(processed);
    }

    private static QualityResult.Record processedRecord(int index, String name, String url,
                                                        boolean verified) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("channel_name", name);
        values.put("channel_url", url);
        return new QualityResult.Record(index, values, values,
                List.of(new QualityResult.Source(url, "A channel", "snippet", "scrape",
                        Instant.now().toString(), verified)),
                true, List.of(), verified ? "SOURCE_CITED" : "SOURCE_CITED_UNVERIFIED", null, null,
                null, null, null, false, List.of(), List.of(), List.of());
    }

    private static QualityResult pipelineAnswer(List<QualityResult.Record> records) {
        int rows = 0;
        List<QualityResult.Row> datasetRows = new ArrayList<>();
        for (QualityResult.Record record : records) {
            datasetRows.add(new QualityResult.Row(record.index(), record.values()));
            rows++;
        }
        QualityResult.Quality quality = new QualityResult.Quality(records.size(), records.size(),
                rows, 0, records.size() - rows, 0, 0, rows, 0.5,
                "equal-weight mean of five measured ratios", Map.of("completeness", 1.0), Map.of());
        return new QualityResult("COMPLETED", records, new QualityResult.Dataset(
                List.of(new QualityResult.Column("channel_name", "Channel", "STRING", true, 0),
                        new QualityResult.Column("channel_url", "Channel URL", "URL", true, 1)),
                datasetRows),
                List.of(new QualityResult.Stage("normalize", "COMPLETED", records.size(),
                        records.size(), Map.of(), List.of(), null)),
                quality, List.of(), null);
    }

    /** The two upstream calls a healthy run makes, stubbed together so a step never sees null. */
    private void collecting(int count) {
        when(aiServiceClient.research(any())).thenReturn(collected(count));
        when(aiServiceClient.processQuality(any())).thenReturn(processed(count));
    }

    /** Created and planned through the service, ready to start: the workflow id. */    private String plannedWorkflow(int quantity) {
        when(aiServiceClient.analyzeRequirement(PROMPT)).thenReturn(analysis(quantity));
        String workflowId = service.create("lifecycle test", PROMPT).id();
        service.plan(workflowId);
        return workflowId;
    }

    // --------------------------------------------------------------------- driving

    /** Runs the claim loop by hand until the run reaches a terminal status. */
    private Run driveToTerminal(String runId, Duration budget) {
        long deadline = System.nanoTime() + budget.toNanos();
        while (System.nanoTime() < deadline) {
            worker.pollOnce();
            awaitIdle(deadline);
            Run run = runs.findById(runId).orElseThrow();
            if (run.status().isTerminal()) {
                return run;
            }
            sleep(20);
        }
        Run stuck = runs.findById(runId).orElseThrow();
        return fail("the run did not finish: still " + stuck.status() + " at progress "
                + stuck.progress() + "% with " + jobs.countPending() + " pending job(s) and "
                + jobs.countRunning() + " running job(s)");
    }

    private void awaitIdle(long deadline) {
        while (worker.inFlight() > 0 && System.nanoTime() < deadline) {
            sleep(10);
        }
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private Step step(String runId, String key) {
        return steps.findByRun(runId).stream()
                .filter(step -> step.stepKey().equals(key))
                .findFirst()
                .orElseThrow(() -> new AssertionError("the run has no step named " + key));
    }

    private Job jobForStep(String runId, String stepKey) {
        return jobs.findByRun(runId).stream()
                .filter(job -> steps.findById(job.stepId()).map(Step::stepKey)
                        .filter(key -> key.equals(stepKey)).isPresent())
                .findFirst()
                .orElseThrow(() -> new AssertionError("no job for step " + stepKey));
    }

    // --------------------------------------------------------------------- the flow

    @Test
    void aPromptBecomesAPlanARunFourStepsAndCollectedRecordsThroughTheQueueOnly() {
        String workflowId = plannedWorkflow(2);
        collecting(2);

        Run started = service.startRun(workflowId);
        // Only the first step is queued: a job exists once its dependencies are done, so no worker
        // can claim the pipeline before collection has produced anything.
        assertThat(jobs.findByRun(started.id())).hasSize(1);
        assertThat(step(started.id(), "transform").status()).isEqualTo(JobStatus.PENDING);
        assertThat(step(started.id(), "validate").status()).isEqualTo(JobStatus.PENDING);
        assertThat(step(started.id(), "save").status()).isEqualTo(JobStatus.PENDING);

        Run finished = driveToTerminal(started.id(), Duration.ofSeconds(60));

        assertThat(finished.status()).isEqualTo(RunStatus.COMPLETED);
        assertThat(finished.progress()).isEqualTo(100);
        assertThat(finished.recordsFound()).isEqualTo(2);
        assertThat(finished.recordsValid()).isEqualTo(2);
        assertThat(finished.finishedAt()).isNotNull();
        assertThat(step(started.id(), "collect").status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(step(started.id(), "transform").status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(step(started.id(), "validate").status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(step(started.id(), "save").status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(jobs.findByRun(started.id()))
                .allSatisfy(job -> assertThat(job.status()).isEqualTo(JobStatus.COMPLETED));

        // The point of the fourth step: the run's answer is rows in tables now, not a JSON column,
        // and the dataset names the workflow, plan and step that produced it.
        var dataset = datasets.findByRun(WORKSPACE, started.id()).orElseThrow();
        assertThat(dataset.workflowId()).isEqualTo(workflowId);
        assertThat(dataset.planId()).isEqualTo(started.planId());
        assertThat(dataset.rowCount()).isEqualTo(2);
        assertThat(dataset.validRowCount()).isEqualTo(2);
        assertThat(dataset.status()).isEqualTo("READY");
    }

    @Test
    void theStepThatRanRecordedWhatItProducedAndTheRunKeepsTheEventTrail() {
        String workflowId = plannedWorkflow(2);
        collecting(2);
        Run run = service.startRun(workflowId);

        driveToTerminal(run.id(), Duration.ofSeconds(60));

        Step collect = step(run.id(), "collect");
        assertThat(collect.durationMs()).isNotNull();
        assertThat(collect.outputSummaryJson()).contains("channel-1");
        assertThat(collect.startedAt()).isNotNull();
        assertThat(collect.finishedAt()).isAfterOrEqualTo(collect.startedAt());

        // The handoff between the two later steps is this column: whatever the pipeline answered has
        // to still be readable by the step that runs after it, out of the database.
        Step transform = step(run.id(), "transform");
        assertThat(transform.outputSummaryJson()).contains("pipelineStatus")
                .contains("channel_name")
                .contains("verifiedByTool");
        String validated = step(run.id(), "validate").outputSummaryJson();
        // MySQL's JSON column reformats spacing, so this checks the keys and values it stored, not
        // the exact bytes Jackson wrote.
        assertThat(validated).contains("contractBasis").contains("\"plan\"")
                .contains("javaValid").contains("structuralFailures");

        List<Map<String, Object>> events = activity.forRun(run.id(), 0, 100);
        assertThat(events).extracting(event -> event.get("action"))
                .contains("workflow.run.started", "workflow.step.scheduled",
                        "workflow.step.COMPLETED", "workflow.run.COMPLETED");
    }

    @Test
    void theRequestThatLeavesForTheResearchRunIsBuiltFromTheJobPayload() {
        String workflowId = plannedWorkflow(2);
        collecting(2);
        Run run = service.startRun(workflowId);

        Job collectJob = jobForStep(run.id(), "collect");
        assertThat(collectJob.payloadJson()).contains("\"topic\"").contains("most subscribed");

        driveToTerminal(run.id(), Duration.ofSeconds(60));

        ArgumentCaptor<ResearchRequest> captor = ArgumentCaptor.forClass(ResearchRequest.class);
        verify(aiServiceClient, atLeast(1)).research(captor.capture());
        ResearchRequest sent = captor.getValue();
        assertThat(sent.topic()).isEqualTo(OBJECTIVE);
        assertThat(sent.limits().expectedRecords()).isEqualTo(2);
        assertThat(sent.limits().expectedRecords()).isEqualTo(2);
        // What the user's source wish became: a preferred domain the graph ranks on, not an
        // allowlist invented by the planner.
        assertThat(sent.limits().preferredDomains()).containsExactly("youtube.com");
        assertThat(sent.limits().maxScrapesPerRun()).isEqualTo(5);
        assertThat(sent.seedQueries()).containsExactly("coding tutorial channels india");

        // Same rule for the pipeline: it is configured from the job payload it was given, and the
        // records it received are exactly the ones the collection step stored.
        ArgumentCaptor<QualityRequest> qualitySent = ArgumentCaptor.forClass(QualityRequest.class);
        verify(aiServiceClient, atLeast(1)).processQuality(qualitySent.capture());
        QualityRequest pipeline = qualitySent.getValue();
        assertThat(pipeline.requiredFields()).containsExactly("channel_name", "channel_url");
        assertThat(pipeline.deduplicationKeys()).containsExactly("channel_url");
        assertThat(pipeline.entityType()).isEqualTo("youtube_channel");
        assertThat(pipeline.fields()).hasSize(2);
        assertThat(pipeline.records()).hasSize(2);
        assertThat(pipeline.rawRecordCount()).isEqualTo(2);
    }

    @Test
    void theRunIsNotReportedCompleteBeforeEveryStepHasFinished() {
        String workflowId = plannedWorkflow(2);
        collecting(2);
        Run run = service.startRun(workflowId);

        worker.pollOnce();
        awaitIdle(System.nanoTime() + Duration.ofSeconds(30).toNanos());

        Run midWay = runs.findById(run.id()).orElseThrow();
        assertThat(midWay.status()).isEqualTo(RunStatus.RUNNING);
        // One step of four finished, a quarter of the progress. The number a caller sees is the
        // fraction of steps that reached a terminal state, which is the only progress this layer
        // reports — and a plan with a pipeline step and a save step in it does not get to look half
        // done when it is a quarter done.
        assertThat(midWay.progress()).isEqualTo(25);
        assertThat(midWay.finishedAt()).isNull();
        assertThat(step(run.id(), "validate").status()).isEqualTo(JobStatus.PENDING);
        assertThat(step(run.id(), "save").status()).isEqualTo(JobStatus.PENDING);
    }

    @Test
    void aTransientUpstreamFailureIsRetriedAndTheRunStillCompletesWithoutALostJob() {
        String workflowId = plannedWorkflow(2);
        when(aiServiceClient.research(any()))
                .thenThrow(new AiServiceClient.AiServiceException(503, "no upstream", null))
                .thenReturn(collected(2));
        when(aiServiceClient.processQuality(any())).thenReturn(processed(2));

        Run finished = driveToTerminal(service.startRun(workflowId).id(), Duration.ofSeconds(90));

        assertThat(finished.status()).isEqualTo(RunStatus.COMPLETED);
        Job collectJob = jobForStep(finished.id(), "collect");
        assertThat(collectJob.attemptCount()).isEqualTo(2);
        assertThat(collectJob.status()).isEqualTo(JobStatus.COMPLETED);
        // The reason for the first attempt survives the success: how many tries it took is the
        // thing an operator asks when a run was slow.
        assertThat(collectJob.lastErrorCode()).isEqualTo(JobExecutionException.SERVER_ERROR);
    }

    @Test
    void aStepThatNeverSucceedsExhaustsItsAttemptsAndFailsTheRunWithTheReasonKept() {
        String workflowId = plannedWorkflow(2);
        when(aiServiceClient.research(any())).thenThrow(
                new AiServiceClient.AiServiceException(503, "upstream is down", null));

        Run finished = driveToTerminal(service.startRun(workflowId).id(), Duration.ofSeconds(90));

        assertThat(finished.status()).isEqualTo(RunStatus.FAILED);
        assertThat(finished.errorCode()).isEqualTo("STEP_FAILED");
        Job collectJob = jobForStep(finished.id(), "collect");
        assertThat(collectJob.status()).isEqualTo(JobStatus.FAILED);
        assertThat(collectJob.attemptCount()).isEqualTo(3);
        assertThat(collectJob.lastErrorMessage()).contains("upstream is down");
        assertThat(step(finished.id(), "collect").status()).isEqualTo(JobStatus.FAILED);
        // The step behind a failed one was never going to run, and a PENDING step beside a FAILED
        // run reads as though something were still to come.
        assertThat(step(finished.id(), "validate").status()).isEqualTo(JobStatus.CANCELLED);
        assertThat(jobs.findByRun(finished.id()))
                .noneSatisfy(job -> assertThat(job.status()).isEqualTo(JobStatus.PENDING));
    }

    @Test
    void aRunThatFailedAtHttp200IsFailedWithTheUpstreamsOwnReasonAndIsNotRetried() {
        String workflowId = plannedWorkflow(2);
        when(aiServiceClient.research(any())).thenReturn(new ResearchResult("FAILED", List.of(),
                List.of(), Map.of("loopsUsed", 6), null, "the graph exhausted its loop budget"));

        Run finished = driveToTerminal(service.startRun(workflowId).id(), Duration.ofSeconds(60));

        assertThat(finished.status()).isEqualTo(RunStatus.FAILED);
        assertThat(step(finished.id(), "collect").errorCode()).isEqualTo("RESEARCH_FAILED");
        assertThat(step(finished.id(), "collect").errorMessage()).contains("loop budget");
        // A permanent refusal is not retried: three attempts would spend the same credits twice
        // more to reach the same answer.
        assertThat(jobForStep(finished.id(), "collect").attemptCount()).isEqualTo(1);
    }

    @Test
    void collectedButUnverifiedRecordsMakeTheRunPartialRatherThanQuietlyShort() {
        String workflowId = plannedWorkflow(5);
        // Two records against a required five, and one of them cites nothing a tool retrieved.
        List<ResearchResult.Record> records = List.of(
                new ResearchResult.Record(Map.of("channel_name", "One",
                        "channel_url", "https://youtube.test/c/one"),
                        List.of(source("https://youtube.test/c/one"))),
                new ResearchResult.Record(Map.of("channel_name", "Two",
                        "channel_url", "https://youtube.test/c/two"),
                        List.of(source("https://youtube.test/c/two", false))));
        when(aiServiceClient.research(any())).thenReturn(new ResearchResult(
                "COMPLETED_WITH_WARNINGS", records, List.of(), Map.of("loopsUsed", 3),
                new ResearchResult.Validation(true, List.of(), List.of(), 0, true, List.of(),
                        List.of(), List.of(1), 0, List.of(), List.of(),
                        List.of("expected at least 5 records, collected 2")), null));
        // The pipeline vouches for both rows; the record citing nothing a tool retrieved fails here.
        when(aiServiceClient.processQuality(any())).thenReturn(processed(records));

        Run finished = driveToTerminal(service.startRun(workflowId).id(), Duration.ofSeconds(60));

        assertThat(finished.status()).isEqualTo(RunStatus.PARTIAL);
        assertThat(finished.errorCode()).isEqualTo("RECORD_SHORTFALL");
        assertThat(finished.errorMessage()).contains("1").contains("5");
        assertThat(finished.recordsFound()).isEqualTo(2);
        assertThat(finished.recordsValid()).isEqualTo(1);
        // Nothing was deleted for want of evidence: the unusable row is named in the step output, and
        // so is the fact that the two implementations disagreed about it.
        assertThat(step(finished.id(), "validate").outputSummaryJson())
                .contains("findings").contains("SOURCE_EVIDENCE_UNVERIFIED")
                .contains("ADVISORY_PASSED_HERE_REJECTED");
    }

    @Test
    void aStepThatOutlivesItsBudgetIsTimedOutAndTheFailureIsRecordedNotSwallowed() {
        String workflowId = plannedWorkflow(2);
        when(aiServiceClient.research(any())).thenAnswer(invocation -> {
            Thread.sleep(6_000);
            return collected(2);
        });

        Run finished = driveToTerminal(service.startRun(workflowId).id(), Duration.ofSeconds(120));

        assertThat(finished.status()).isEqualTo(RunStatus.FAILED);
        Job collectJob = jobForStep(finished.id(), "collect");
        assertThat(collectJob.attemptCount()).isEqualTo(3);
        assertThat(collectJob.lastErrorCode()).isEqualTo(JobExecutionException.TIMEOUT);
        assertThat(collectJob.lastErrorMessage())
                .contains("no run-level abort")
                .doesNotContain("null")
                .doesNotContain("{}");
        assertThat(collectJob.status()).isEqualTo(JobStatus.FAILED);
    }

    @Test
    void cancellingAQueuedRunStopsTheRemainingWorkAndLeavesNothingForTheSweeperToRevive() {
        String workflowId = plannedWorkflow(2);
        collecting(2);
        Run run = service.startRun(workflowId);

        // Let the first step finish, so what is left is a genuinely queued second step.
        worker.pollOnce();
        awaitIdle(System.nanoTime() + Duration.ofSeconds(30).toNanos());

        Run cancelled = service.cancel(run.id());

        assertThat(cancelled.cancelRequestedAt()).isNotNull();
        assertThat(cancelled.status()).isEqualTo(RunStatus.CANCELLED);
        assertThat(step(run.id(), "collect").status()).isEqualTo(JobStatus.COMPLETED);
        // Both steps behind the one that finished are abandoned: the pipeline would have nothing to
        // hand on, the save would have nothing to write, and a PENDING row beside a CANCELLED run
        // reads as work still to come. The validating and saving steps never even had a job — a job
        // is queued only once its dependencies are done, which is what makes cancelling safe.
        assertThat(step(run.id(), "transform").status()).isEqualTo(JobStatus.CANCELLED);
        assertThat(step(run.id(), "validate").status()).isEqualTo(JobStatus.CANCELLED);
        assertThat(step(run.id(), "save").status()).isEqualTo(JobStatus.CANCELLED);
        assertThat(jobForStep(run.id(), "transform").status()).isEqualTo(JobStatus.CANCELLED);
        assertThat(jobs.findByRun(run.id())).hasSize(2);
        assertThat(jobs.findClaimable()).isEmpty();
    }

    @Test
    void theApiSeesTheSameRunTheDatabaseDoes() throws Exception {
        when(aiServiceClient.analyzeRequirement(PROMPT)).thenReturn(analysis(2));
        collecting(2);

        String created = mockMvc.perform(post("/api/v1/workflows")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("prompt", PROMPT, "name", "via http"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.workflow.planningStatus").value("NOT_STARTED"))
                .andReturn().getResponse().getContentAsString();
        String workflowId = objectMapper.readTree(created).path("workflow").path("id").asText();

        mockMvc.perform(post("/api/v1/workflows/" + workflowId + "/plan"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.plan.steps").exists());

        String startBody = mockMvc.perform(post("/api/v1/workflows/" + workflowId + "/runs"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.run.status").value("PENDING"))
                .andReturn().getResponse().getContentAsString();
        String runId = objectMapper.readTree(startBody).path("run").path("id").asText();

        driveToTerminal(runId, Duration.ofSeconds(60));

        mockMvc.perform(get("/api/v1/workflows/runs/" + runId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.run.status").value(RunStatus.COMPLETED.name()))
                .andExpect(jsonPath("$.run.progress").value(100))
                .andExpect(jsonPath("$.run.recordsValid").value(2))
                .andExpect(jsonPath("$.steps", org.hamcrest.Matchers.hasSize(4)))
                .andExpect(jsonPath("$.jobs[0].payload").doesNotExist());

        mockMvc.perform(get("/api/v1/workflows/runs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.runs[0].id").value(runId))
                .andExpect(jsonPath("$.worker.id").exists());
    }

    @Test
    void aRunOfAWorkflowThatDoesNotExistIsANotFoundRatherThanAnEmptySuccess() {
        String missing = UUID.randomUUID().toString();
        assertThatThrownBy(() -> service.startRun(missing))
                .isInstanceOf(WorkflowService.UnknownWorkflowException.class)
                .hasMessageContaining("no such workflow");

        try {
            mockMvc.perform(post("/api/v1/workflows/" + missing + "/runs"))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.error.code").value("WORKFLOW_NOT_FOUND"));
        } catch (Exception e) {
            fail("the cancel endpoint should have answered, but threw " + e);
        }
    }

    @Test
    void twoRunsOfTheSameWorkflowAreSeparateExecutionsWithTheirOwnStepsAndJobs() {
        String workflowId = plannedWorkflow(2);
        collecting(2);

        Run first = service.startRun(workflowId);
        driveToTerminal(first.id(), Duration.ofSeconds(60));
        Run second = service.startRun(workflowId);

        assertThat(second.attempt()).isEqualTo(first.attempt() + 1);
        assertThat(second.id()).isNotEqualTo(first.id());
        assertThat(steps.findByRun(second.id())).hasSize(4);
        assertThat(jobs.findByRun(first.id()))
                .allSatisfy(job -> assertThat(job.runId()).isEqualTo(first.id()));

        driveToTerminal(second.id(), Duration.ofSeconds(60));
        assertThat(runs.findById(second.id()).orElseThrow().status()).isEqualTo(RunStatus.COMPLETED);
    }

    @Test
    void aPlannerRefusalIsRecordedAgainstTheWorkflowAndNothingIsEnqueued() {
        when(aiServiceClient.analyzeRequirement(PROMPT)).thenThrow(
                new AiServiceClient.AiServiceException(422, "the prompt names no entity", null));
        String workflowId = service.create("unplannable", PROMPT).id();

        assertThatThrownBy(() -> service.plan(workflowId))
                .isInstanceOf(WorkflowService.PlanningRejectedException.class)
                .hasMessageContaining("the requirement could not be analysed");

        assertThat(workflows.findById(workflowId).orElseThrow().planningStatus()).isEqualTo("FAILED");
        assertThat(workflows.findById(workflowId).orElseThrow().planningErrorCode())
                .isEqualTo("AI_SERVICE_UNAVAILABLE");
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM workflow_runs WHERE workflow_id = ?", Integer.class, workflowId))
                .isZero();
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM workflow_jobs WHERE workspace_id = ?", Integer.class, WORKSPACE))
                .isZero();
    }

    @Test
    void readinessReportsQueueDepthAndWorkerStateWhenTheLayerIsOn() throws Exception {
        when(aiServiceClient.health()).thenReturn(new ai.finalagent.aiclient.dto.AiServiceHealth(
                "ok", "finalagent-ai-service", "0.1.0",
                new ai.finalagent.aiclient.dto.AiServiceHealth.Credentials(true, false, true)));
        String workflowId = plannedWorkflow(2);
        collecting(2);
        service.startRun(workflowId);

        // One queued job, nothing claimed yet: the loop is driven by hand in this class.
        int pending = jobs.countPending();
        mockMvc.perform(get("/api/v1/ready"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.components.workflowQueue.status").value("UP"))
                .andExpect(jsonPath("$.components.workflowQueue.details.pendingJobs")
                        .value(pending))
                .andExpect(jsonPath("$.components.workflowQueue.details.runningJobs").value(0))
                .andExpect(jsonPath("$.components.workflowQueue.details.activeRuns").value(1))
                .andExpect(jsonPath("$.components.workflowQueue.details.workspaceIdConfigured")
                        .value("present"));
    }

    @Test
    void aRunThatNoWorkerHasTouchedIsStillReadableAndItsJobsArePendingNotLost() {
        String workflowId = plannedWorkflow(2);
        when(aiServiceClient.research(any())).thenReturn(collected(2));
        Run run = service.startRun(workflowId);

        Run untouched = runs.findById(run.id()).orElseThrow();
        assertThat(untouched.status()).isEqualTo(RunStatus.PENDING);
        assertThat(untouched.progress()).isZero();
        assertThat(untouched.startedAt()).isNull();
        assertThat(jobs.findByRun(run.id())).singleElement()
                .satisfies(job -> assertThat(job.status()).isEqualTo(JobStatus.PENDING));
    }
}
