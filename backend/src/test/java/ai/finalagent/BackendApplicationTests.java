package ai.finalagent;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import ai.finalagent.config.FinalAgentProperties;

@SpringBootTest
@ActiveProfiles("test")
class BackendApplicationTests {

    @Autowired
    private FinalAgentProperties properties;

    @Test
    void contextLoadsAndEnvironmentConfigurationBinds() {
        assertThat(properties.database().host()).isEqualTo("127.0.0.1");
        assertThat(properties.database().port()).isEqualTo(33061);
        assertThat(properties.database().name()).isEqualTo("finalagent_test");
        assertThat(properties.aiService().baseUrl()).isEqualTo("http://127.0.0.1:38000");
        assertThat(properties.cors().allowedOrigins()).containsExactly("http://localhost:3000");
    }
}
