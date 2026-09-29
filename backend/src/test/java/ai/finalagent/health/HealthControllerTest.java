package ai.finalagent.health;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The test datasource points at a port with nothing behind it, so readiness must honestly
 * report DOWN. A skeleton that fakes a green health check is the failure mode this project was
 * rebuilt to eliminate.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HealthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void livenessIsUpAtBothPathForms() throws Exception {
        for (String path : new String[]{"/health", "/api/v1/health"}) {
            mockMvc.perform(get(path))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status", is("UP")))
                    .andExpect(jsonPath("$.application", is("finalagent-backend")));
        }
    }

    @Test
    void readinessReportsUnreachableDependenciesHonestly() throws Exception {
        mockMvc.perform(get("/api/v1/ready"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.status", is("DOWN")))
                .andExpect(jsonPath("$.components.mysql.status", is("DOWN")))
                .andExpect(jsonPath("$.components.mysql.details.database", is("finalagent_test")))
                .andExpect(jsonPath("$.components.aiService.status", is("DOWN")))
                .andExpect(jsonPath("$.components.credentials.status", is("UP")));
    }

    @Test
    void readinessNeverLeaksCredentialValues() throws Exception {
        mockMvc.perform(get("/api/v1/ready"))
                .andExpect(content().string(not(containsString("not-a-real-credential"))))
                .andExpect(content().string(not(containsString("shared-key"))));
    }

    @Test
    void rootReadyPathMatchesPrefixedPath() throws Exception {
        mockMvc.perform(get("/ready"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.components.mysql.status", is("DOWN")));
    }
}
