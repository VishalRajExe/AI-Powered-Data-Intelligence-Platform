package ai.finalagent.requirement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import ai.finalagent.aiclient.AiServiceClient;
import ai.finalagent.support.TestPrincipal;
import ai.finalagent.aiclient.dto.ResearchRequest;
import ai.finalagent.aiclient.dto.ResearchResult;
import com.fasterxml.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PipelineControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private AiServiceClient aiServiceClient;

    private static final String PROMPT = "find best youtube channels for coding";

    private static RequirementDto channelsRequirement() {
        return new RequirementDto(
                "List popular YouTube channels that teach programming", "youtube_channel", 20,
                new RequirementDto.Geography(List.of(), null, null),
                new RequirementDto.TimeRange(null, null, null),
                List.of(), List.of(),
                List.of(new RequirementDto.Field("channel_name", "Channel name", "STRING", null),
                        new RequirementDto.Field("channel_url", "Channel URL", "URL", null),
                        new RequirementDto.Field("subscribers", "Subscribers", "NUMBER", null)),
                List.of("channel_name", "channel_url"), List.of("subscribers"),
                List.of(), List.of(), List.of("channel_url"), List.of(), "unspecified",
                List.of(), List.of(), List.of());
    }

    private static Map<String, Object> channelSchema() {
        return Map.of(
                "type", "object",
                "properties", Map.of("records", Map.of(
                        "type", "array",
                        "items", Map.of(
                                "type", "object",
                                "properties", Map.of("channel_name", Map.of("type", "string"),
                                        "channel_url", Map.of("type", "string"),
                                        "subscribers", Map.of("type", "number"),
                                        "source_url", Map.of("type", "string")),
                                "required", List.of("channel_name", "channel_url"),
                                "additionalProperties", false)),
                        "additionalProperties", false),
                "required", List.of("records"),
                "additionalProperties", false);
    }

    private static RequirementAnalysisDto analysis(RequirementDto requirement, Map<String, Object> schema) {
        return new RequirementAnalysisDto(
                requirement.missingInformation() == null || requirement.missingInformation().isEmpty()
                        ? "valid" : "needs_clarification",
                requirement, schema,
                List.of("best coding youtube channels"),
                "List popular YouTube channels that teach programming.\nEntity type: youtube_channel.",
                Map.of("respectRobotsTxt", true, "allowAuthentication", false, "allowCaptchaBypass", false),
                requirement.missingInformation(), Map.of("model", "gemini-2.5-flash", "fieldCount", 3));
    }

    private static String promptBody() {
        return "{\"prompt\":\"" + PROMPT + "\"}";
    }

    @Test
    void parseReturnsTheValidatedContractWithoutCollecting() throws Exception {
        when(aiServiceClient.analyzeRequirement(PROMPT)).thenReturn(analysis(channelsRequirement(), channelSchema()));

        mockMvc.perform(post("/api/v1/requirements/parse").with(TestPrincipal.principal()).header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON).content(promptBody()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requirement.entityType", is("youtube_channel")))
                .andExpect(jsonPath("$.extractionSchema.properties.records.items.required[0]",
                        is("channel_name")));

        verify(aiServiceClient, never()).research(any());
    }

    @Test
    void aValidContractProceedsToTheGraph() throws Exception {
        when(aiServiceClient.analyzeRequirement(PROMPT)).thenReturn(analysis(channelsRequirement(), channelSchema()));
        when(aiServiceClient.research(any(ResearchRequest.class))).thenReturn(new ResearchResult(
                "COMPLETED",
                List.of(new ResearchResult.Record(Map.of("channel_name", "Coding Cat"), List.of())),
                List.of(), Map.of("loopsUsed", 1),
                new ResearchResult.Validation(true, List.of(), List.of(), 0, true, List.of("a", "b", "c"),
                        List.of(), List.of(), 0, List.of(), List.of(), List.of()),
                null));

        mockMvc.perform(post("/api/v1/research/from-prompt").with(TestPrincipal.principal()).header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON).content(promptBody()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("COMPLETED")))
                .andExpect(jsonPath("$.research.records[0].values.channel_name", is("Coding Cat")));

        verify(aiServiceClient, times(1)).research(any(ResearchRequest.class));
    }

    @Test
    void anUnresolvedRequirementNeverReachesTheGraph() throws Exception {
        var unclear = new RequirementDto(
                "Collect the usual company data", "company", null,
                new RequirementDto.Geography(List.of(), null, null), new RequirementDto.TimeRange(null, null, null),
                List.of(), List.of(), List.of(new RequirementDto.Field("name", "Name", "STRING", null)),
                List.of("name"), List.of(), List.of(), List.of(), List.of(), List.of(), "unspecified",
                List.of(), List.of("which country?"), List.of());
        when(aiServiceClient.analyzeRequirement(PROMPT)).thenReturn(analysis(unclear, channelSchema()));

        mockMvc.perform(post("/api/v1/research/from-prompt").with(TestPrincipal.principal()).header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON).content(promptBody()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("NEEDS_CLARIFICATION")))
                // Spring serializes with non_null inclusion, so an absent run is a missing
                // key rather than `"research": null`. The contract is the same either way:
                // no research payload means nothing collected.
                .andExpect(jsonPath("$.research").doesNotExist())
                .andExpect(jsonPath("$.clarificationQuestions[0]", is("which country?")));

        verify(aiServiceClient, never()).research(any());
    }

    @Test
    void aStructurallyBrokenAiAnswerIsRejectedAndCollectionIsBlocked() throws Exception {
        // subscribers declared but in neither partition: the model's own contract is inconsistent.
        var broken = new RequirementDto(
                "List channels", "youtube_channel", null,
                new RequirementDto.Geography(List.of(), null, null), new RequirementDto.TimeRange(null, null, null),
                List.of(), List.of(),
                List.of(new RequirementDto.Field("a", "A", "STRING", null),
                        new RequirementDto.Field("b", "B", "STRING", null)),
                List.of("a"), List.of(), List.of(), List.of(), List.of(), List.of(), "unspecified",
                List.of(), List.of(), List.of());
        when(aiServiceClient.analyzeRequirement(PROMPT)).thenReturn(analysis(broken, channelSchema()));

        mockMvc.perform(post("/api/v1/research/from-prompt").with(TestPrincipal.principal()).header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON).content(promptBody()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code", is("INVALID_REQUIREMENT")))
                .andExpect(jsonPath("$.error.message", org.hamcrest.Matchers.containsString("exactly one")));

        verify(aiServiceClient, never()).research(any());
    }

    @Test
    void anEmptySchemaIsRejectedBeforeCollectionEvenWhenTheRequirementLooksFine() throws Exception {
        var empty = Map.of("type", "object", "properties", Map.of(), "additionalProperties", false);
        when(aiServiceClient.analyzeRequirement(PROMPT)).thenReturn(analysis(channelsRequirement(), empty));

        mockMvc.perform(post("/api/v1/research/from-prompt").with(TestPrincipal.principal()).header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON).content(promptBody()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code", is("INVALID_EXTRACTION_SCHEMA")));

        verify(aiServiceClient, never()).research(any());
    }

    @Test
    void aVaguePromptNeverReachesTheAiService() throws Exception {
        mockMvc.perform(post("/api/v1/research/from-prompt").with(TestPrincipal.principal()).header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"prompt\":\"jobs\"}"))
                .andExpect(status().isBadRequest());

        verify(aiServiceClient, never()).analyzeRequirement(any());
    }

    @Test
    void parsesThePythonServicesActualAnalysisEnvelope() throws Exception {
        String pythonPayload = """
                {
                  "status": "valid",
                  "requirement": {
                    "objective": "Find remote frontend developer openings in India",
                    "entityType": "job",
                    "quantity": 25,
                    "geography": {"places": ["India"], "scope": "remote", "includeSubregions": true},
                    "timeRange": {},
                    "filters": [{"field": "salary", "operator": "NEQ", "value": "not disclosed"}],
                    "constraints": ["must publish an application link"],
                    "fields": [
                      {"key": "company", "label": "Company", "type": "STRING", "description": null},
                      {"key": "salary", "label": "Salary", "type": "CURRENCY", "description": "USD"}
                    ],
                    "requiredFields": ["company"],
                    "optionalFields": ["salary"],
                    "sourcePreferences": [],
                    "sourceRestrictions": [],
                    "deduplicationKeys": ["company"],
                    "validationRules": [{"rule": "URL", "field": "application_url", "params": null}],
                    "outputFormat": "unspecified",
                    "ambiguities": [],
                    "missingInformation": [],
                    "warnings": []
                  },
                  "extractionSchema": {"type": "object", "properties": {"records": {"type": "array"}},
                                        "required": ["records"], "additionalProperties": false},
                  "searchQueries": ["remote frontend jobs India salary"],
                  "researchBrief": "Find remote frontend developer openings in India",
                  "clarificationQuestions": [],
                  "metadata": {"model": "gemini-2.5-flash", "repairAttempts": 0, "fieldCount": 2}
                }
                """;

        RequirementAnalysisDto parsed = objectMapper.readValue(pythonPayload, RequirementAnalysisDto.class);

        assertThat(parsed.requirement().entityType()).isEqualTo("job");
        assertThat(parsed.requirement().fields()).extracting(RequirementDto.Field::key)
                .containsExactly("company", "salary");
        assertThat(parsed.requirement().geography().places()).containsExactly("India");
        assertThat(parsed.requirement().validationRules().get(0).field()).isEqualTo("application_url");

        // Spring's gate must reject the model's own inconsistency, not just shape.
        assertThatThrownBy(() -> RequirementValidator.validate(parsed.requirement()))
                .isInstanceOf(RequirementValidator.InvalidRequirementException.class)
                .hasMessageContaining("validationRule references unknown field");

        ResearchRequest request = parsed.toResearchRequest(null);
        assertThat(request.topic()).isEqualTo("Find remote frontend developer openings in India");
        assertThat(request.seedQueries()).containsExactly("remote frontend jobs India salary");
    }

    @Test
    void unknownKeysFromTheAiServiceAreSilentlyDropped() throws Exception {
        // Measured, not assumed. Spring Boot disables FAIL_ON_UNKNOWN_PROPERTIES and a
        // class-level `ignoreUnknown = false` does not re-enable it, so a key the Python
        // service added is dropped without any error at all. RequirementValidator then sees a
        // perfectly consistent-looking requirement, which is the point of this test: DTO
        // parsing is NOT a drift alarm. The structural rules are the only gate, and a renamed
        // or removed field on one side has to be caught by a contract test, not by Jackson.
        String withExtra = """
                {
                  "status": "valid",
                  "requirement": {
                    "objective": "List channels", "entityType": "youtube_channel",
                    "fields": [{"key": "a", "label": "A", "type": "STRING"}],
                    "requiredFields": ["a"], "optionalFields": [],
                    "brandNewFieldFromTheModel": "surprise"
                  },
                  "extractionSchema": {"type": "object", "properties": {"records": {"type": "array"}},
                                        "required": ["records"], "additionalProperties": false},
                  "searchQueries": [], "researchBrief": "List channels",
                  "clarificationQuestions": [], "metadata": {}
                }
                """;

        RequirementAnalysisDto parsed = objectMapper.readValue(withExtra, RequirementAnalysisDto.class);

        assertThat(parsed.requirement().objective()).isEqualTo("List channels");
        assertThat(parsed.requirement().fields()).hasSize(1);
        assertThatCode(() -> RequirementValidator.validate(parsed.requirement()))
                .as("the extra key vanished without a trace; parsing raised nothing")
                .doesNotThrowAnyException();
    }
}
