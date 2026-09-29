package ai.finalagent.config;

import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CorsConfigurationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void allowsTheConfiguredFrontendOrigin() throws Exception {
        mockMvc.perform(options("/api/v1/health")
                        .header(HttpHeaders.ORIGIN, "http://localhost:3000")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:3000"));
    }

    @Test
    void doesNotReflectAnUnconfiguredOrigin() throws Exception {
        mockMvc.perform(options("/api/v1/health")
                        .header(HttpHeaders.ORIGIN, "http://evil.example")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    @Test
    void rejectsASimpleCrossOriginRequestFromAnUnconfiguredOrigin() throws Exception {
        // Spring's DefaultCorsProcessor answers 403 for a cross-origin request whose Origin is not
        // allow-listed. That is the correct outcome: health must not become a readable endpoint for
        // any website the operator did not name in FRONTEND_ORIGIN.
        mockMvc.perform(get("/api/v1/health")
                        .header(HttpHeaders.ORIGIN, "http://evil.example"))
                .andExpect(status().isForbidden());
    }

    @Test
    void servesSameOriginRequestsWithoutAnOriginHeaderAndWithoutCredentials() throws Exception {
        // The browser's normal path: Next.js rewrites make the call same-origin, so no Origin
        // header and no CORS negotiation at all. Phase 1 health routes stay unauthenticated;
        // authentication arrives with the security phase.
        mockMvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, nullValue()));
    }
}
