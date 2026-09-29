package ai.finalagent.research;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import ai.finalagent.aiclient.AiServiceClient;
import ai.finalagent.aiclient.dto.ResearchRequest;
import ai.finalagent.aiclient.dto.ResearchResult;

import com.fasterxml.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ResearchControllerTest {

    private static final String TOPIC = "find remote frontend developer jobs in India";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AiServiceClient aiServiceClient;

    private static Map<String, Object> jobSchema() {
        return Map.of(
                "type", "object",
                "properties", Map.of("jobs", Map.of(
                        "type", "array",
                        "items", Map.of(
                                "type", "object",
                                "properties", Map.of("company", Map.of("type", "string"),
                                        "role", Map.of("type", "string"),
                                        "application_url", Map.of("type", "string")),
                                "required", List.of("company", "role", "application_url"),
                                "additionalProperties", false)),
                        "additionalProperties", false),
                "required", List.of("jobs"),
                "additionalProperties", false);
    }

    private static String body(Map<String, Object> schema, String topic) throws Exception {
        return new ObjectMapper().writeValueAsString(Map.of(
                "topic", topic,
                "extractionSchema", schema,
                "seedQueries", List.of(),
                "limits", Map.of("maxLoops", 6, "expectedRecords", 25)));
    }

    private static ResearchResult sampleResult() {
        return new ResearchResult(
                "COMPLETED",
                List.of(new ResearchResult.Record(
                        Map.of("company", "Acme", "role", "Frontend Engineer",
                                "application_url", "https://acme.test/jobs/1"),
                        List.of(new ResearchResult.Source("https://acme.test/jobs/1", "Acme", "",
                                "search+scrape", "2026-09-29T00:00:00Z", true)))),
                List.of(new ResearchResult.Source("https://acme.test/jobs/1", "Acme", "",
                        "search+scrape", "2026-09-29T00:00:00Z", true)),
                Map.of("loopsUsed", 3, "searchesUsed", 1, "scrapesUsed", 1),
                new ResearchResult.Validation(true, List.of(), List.of(), 0, true,
                        List.of("fields present", "urls observed", "count matches"), List.of(), List.of()),
                null);
    }

    @Test
    void delegatesAValidContractToTheResearchGraph() throws Exception {
        when(aiServiceClient.research(any(ResearchRequest.class))).thenReturn(sampleResult());

        mockMvc.perform(post("/api/v1/research")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(jobSchema(), TOPIC)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("COMPLETED")))
                .andExpect(jsonPath("$.records", hasSize(1)))
                .andExpect(jsonPath("$.records[0].values.company", is("Acme")))
                .andExpect(jsonPath("$.records[0].sources[0].verifiedByTool", is(true)))
                .andExpect(jsonPath("$.validation.missingFields", hasSize(0)));
    }

    @Test
    void anEmptySchemaIsRejectedLocallyAndNeverReachesTheGraph() throws Exception {
        Map<String, Object> empty = Map.of("type", "object", "properties", Map.of(),
                "additionalProperties", false);

        mockMvc.perform(post("/api/v1/research")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(empty, TOPIC)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code", is("INVALID_EXTRACTION_SCHEMA")));

        verifyNoInteractions(aiServiceClient);
    }

    @Test
    void aSchemaAllowingExtraFieldsIsRejectedBecauseValidationWouldPassVacuously() throws Exception {
        Map<String, Object> loose = Map.of("type", "object",
                "properties", jobSchema().get("properties"),
                "required", List.of("jobs"));

        mockMvc.perform(post("/api/v1/research")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(loose, TOPIC)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code", is("INVALID_EXTRACTION_SCHEMA")));

        verifyNoInteractions(aiServiceClient);
    }

    @Test
    void requiredMustNameDeclaredPropertiesOnly() throws Exception {
        Map<String, Object> mismatched = Map.of("type", "object",
                "properties", Map.of("jobs", Map.of("type", "array", "items", Map.of("type", "object"))),
                "required", List.of("entites"),
                "additionalProperties", false);

        mockMvc.perform(post("/api/v1/research")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(mismatched, TOPIC)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code", is("INVALID_EXTRACTION_SCHEMA")))
                .andExpect(jsonPath("$.error.message", org.hamcrest.Matchers.containsString("entites")));

        verifyNoInteractions(aiServiceClient);
    }

    @Test
    void aVagueTopicIsRejectedByBeanValidation() throws Exception {
        mockMvc.perform(post("/api/v1/research")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(jobSchema(), "jobs")))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(aiServiceClient);
    }

    @Test
    void anUpstreamBadRequestIsPassedThroughAsFourTwentyTwo() throws Exception {
        when(aiServiceClient.research(any(ResearchRequest.class)))
                .thenThrow(new AiServiceClient.AiServiceException(422, "upstream said no", null));

        mockMvc.perform(post("/api/v1/research")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(jobSchema(), TOPIC)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code", is("AI_SERVICE_REJECTED_REQUEST")));
    }

    @Test
    void anUpstreamOutageIsABadGatewayNotAnEmptySuccess() throws Exception {
        when(aiServiceClient.research(any(ResearchRequest.class)))
                .thenThrow(new AiServiceClient.AiServiceException(502, "provider down", null));

        mockMvc.perform(post("/api/v1/research")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(jobSchema(), TOPIC)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code", is("AI_SERVICE_UNAVAILABLE")));
    }

    @Test
    void aRequestForAToolThisBuildDoesNotHaveIsRejectedWithoutCallingTheGraph() throws Exception {
        mockMvc.perform(post("/api/v1/research")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bodyWithLimits(Map.of("maxLoops", 6, "allowedTools", List.of("crawl")))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code", is("INVALID_WEB_TOOLS")))
                .andExpect(jsonPath("$.error.message", org.hamcrest.Matchers.containsString("crawl")));

        verifyNoInteractions(aiServiceClient);
    }

    @Test
    void aBrowserSessionBudgetForARunThatDidNotAskForSessionsIsRejected() throws Exception {
        mockMvc.perform(post("/api/v1/research")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bodyWithLimits(Map.of(
                                "allowedTools", List.of("search", "scrape"),
                                "maxInteractionsPerRun", 3))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code", is("INVALID_WEB_TOOLS")));

        verifyNoInteractions(aiServiceClient);
    }

    @Test
    void anInteractionRequestIsForwardedToTheGraphVerbatim() throws Exception {
        when(aiServiceClient.research(any(ResearchRequest.class))).thenReturn(sampleResult());

        mockMvc.perform(post("/api/v1/research")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bodyWithLimits(Map.of(
                                "allowedTools", List.of("search", "scrape", "interact"),
                                "maxInteractionsPerRun", 2))))
                .andExpect(status().isOk());

        ArgumentCaptor<ResearchRequest> sent = ArgumentCaptor.forClass(ResearchRequest.class);
        org.mockito.Mockito.verify(aiServiceClient).research(sent.capture());
        assertThat(sent.getValue().limits().allowedTools())
                .containsExactlyInAnyOrder("search", "scrape", "interact");
        assertThat(sent.getValue().limits().maxInteractionsPerRun()).isEqualTo(2);
    }

    private static String bodyWithLimits(Map<String, Object> limits) throws Exception {
        return new ObjectMapper().writeValueAsString(Map.of(
                "topic", TOPIC,
                "extractionSchema", jobSchema(),
                "seedQueries", List.of(),
                "limits", limits));
    }

    @Test
    void anImpossibleRelevanceFloorIsRejectedLocally() throws Exception {
        mockMvc.perform(post("/api/v1/research")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bodyWithLimits(Map.of("minRelevanceScore", 1.5))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code", is("INVALID_CURATION_REQUEST")));

        verifyNoInteractions(aiServiceClient);
    }

    @Test
    void aCurationRequestWithinBoundsIsForwarded() throws Exception {
        when(aiServiceClient.research(any(ResearchRequest.class))).thenReturn(sampleResult());

        mockMvc.perform(post("/api/v1/research")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bodyWithLimits(Map.of(
                                "entityType", "job",
                                "preferredDomains", List.of("acme.test"),
                                "maxSourcesPerDomain", 2,
                                "minRelevanceScore", 0.2,
                                "desiredSources", 25))))
                .andExpect(status().isOk());

        ArgumentCaptor<ResearchRequest> sent = ArgumentCaptor.forClass(ResearchRequest.class);
        org.mockito.Mockito.verify(aiServiceClient).research(sent.capture());
        assertThat(sent.getValue().limits().entityType()).isEqualTo("job");
        assertThat(sent.getValue().limits().preferredDomains()).containsExactly("acme.test");
        assertThat(sent.getValue().limits().minRelevanceScore()).isEqualTo(0.2);
        assertThat(sent.getValue().limits().desiredSources()).isEqualTo(25);
    }
}
