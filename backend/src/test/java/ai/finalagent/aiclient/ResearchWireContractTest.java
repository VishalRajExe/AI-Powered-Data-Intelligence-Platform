package ai.finalagent.aiclient;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import ai.finalagent.aiclient.dto.ResearchRequest;
import ai.finalagent.aiclient.dto.ResearchResult;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The Java DTO must mirror {@code app/research/contracts.py} field-for-field. This test
 * pins both directions: what Spring sends, and a payload captured in the Python service's
 * own output shape.
 */
class ResearchWireContractTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void serializesToCamelCase() throws Exception {
        ResearchRequest request = new ResearchRequest(
                "find best youtube channels for coding",
                Map.of("type", "object", "properties", Map.of("channels", Map.of("type", "array")),
                        "required", List.of("channels"), "additionalProperties", false),
                new ResearchRequest.Limits(6, 5, 8, 12, 20, List.of("youtube.com"), List.of("reddit.com")),
                List.of("best coding channels"));

        String json = mapper.writeValueAsString(request);

        assertThat(json)
                .contains("\"extractionSchema\"")
                .contains("\"seedQueries\"")
                .contains("\"maxSearchesPerRun\"")
                .contains("\"expectedRecords\"")
                .doesNotContain("extraction_schema")
                .doesNotContain("seed_queries");
    }

    @Test
    void readsThePythonServicesActualResponseShape() throws Exception {
        String pythonPayload = """
                {
                  "status": "COMPLETED_WITH_WARNINGS",
                  "records": [
                    {
                      "values": {"channel_name": "Coding Cat",
                                  "channel_url": "https://youtube.test/c/codingcat"},
                      "sources": [
                        {"url": "https://youtube.test/c/codingcat", "title": "Coding Cat",
                         "snippet": "python tutorials", "sourceType": "search+scrape",
                         "retrievedAt": "2026-09-29T06:00:00+00:00", "verifiedByTool": true}
                      ]
                    }
                  ],
                  "sources": [
                    {"url": "https://youtube.test/c/codingcat", "title": "Coding Cat",
                     "snippet": "python tutorials", "sourceType": "search+scrape",
                     "retrievedAt": "2026-09-29T06:00:00+00:00", "verifiedByTool": true}
                  ],
                  "metadata": {"model": "gemini-2.5-flash", "loopsUsed": 3, "searchesUsed": 1,
                                "scrapesUsed": 1, "toolErrors": 0, "repairAttempts": 0,
                                "sourceCount": 1, "schemaFieldCount": 2, "durationMs": 4200,
                                "maxLoops": 6},
                  "validation": {"schemaValid": true, "missingFields": [], "extraFields": [],
                                  "repairsUsed": 0, "critiqueSatisfactory": true,
                                  "critiqueReasons": ["a", "b", "c"], "unverifiedUrls": [],
                                  "warnings": ["expected at least 50 records, collected 1"]}
                }
                """;

        ResearchResult result = mapper.readValue(pythonPayload, ResearchResult.class);

        assertThat(result.status()).isEqualTo("COMPLETED_WITH_WARNINGS");
        assertThat(result.records()).hasSize(1);
        assertThat(result.records().get(0).values()).containsEntry("channel_name", "Coding Cat");
        assertThat(result.records().get(0).sources().get(0).verifiedByTool()).isTrue();
        assertThat(result.metadata()).containsEntry("loopsUsed", 3);
        assertThat(result.validation().warnings())
                .anyMatch(warning -> warning.contains("expected at least 50 records"));
        assertThat(result.failureReason()).isNull();
    }

    @Test
    void aFailedRunIsDistinguishableFromAnEmptySuccess() throws Exception {
        ResearchResult failed = mapper.readValue("""
                {"status": "FAILED", "records": [], "sources": [], "metadata": {"loopsUsed": 6},
                 "validation": {"schemaValid": false, "missingFields": ["channels[].website"],
                                 "extraFields": [], "repairsUsed": 3, "warnings": ["r"],
                                 "critiqueSatisfactory": null, "critiqueReasons": [], "unverifiedUrls": []},
                 "failureReason": "submitted data never satisfied the extraction schema after 3 repairs"}
                """, ResearchResult.class);

        assertThat(failed.status()).isEqualTo("FAILED");
        assertThat(failed.records()).isEmpty();
        assertThat(failed.failureReason()).contains("never satisfied the extraction schema");
        assertThat(failed.validation().missingFields()).containsExactly("channels[].website");
    }
}
