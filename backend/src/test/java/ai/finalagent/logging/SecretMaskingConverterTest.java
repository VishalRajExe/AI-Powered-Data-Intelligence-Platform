package ai.finalagent.logging;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SecretMaskingConverterTest {

    @Test
    void masksKeyedByAssignment() {
        assertThat(SecretMaskingConverter.mask("GEMINI_API_KEY=abc123def456ghi789"))
                .isEqualTo("GEMINI_API_KEY=***");
    }

    @Test
    void masksKeyedJsonValues() {
        String masked = SecretMaskingConverter.mask("{\"apiKey\": \"fc-abcdefghijklmnopqrst\"}");
        assertThat(masked).doesNotContain("fc-abcdefghijklmnopqrst");
        assertThat(masked).contains("apiKey");
    }

    @Test
    void masksBareProviderKeyShapesEvenWithoutAKeyName() {
        assertThat(SecretMaskingConverter.mask("using AIzaSyA1234567890abcdefghijKLmnopQRSTUV"))
                .doesNotContain("AIzaSyA");
        assertThat(SecretMaskingConverter.mask("token was ghp_abcdefghijklmnopqrstuvwxyz0123456789"))
                .doesNotContain("ghp_abcdefgh");
    }

    @Test
    void masksSignedJwtValues() {
        String jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftQ8m1kKx2n3p4q5r6s7t";
        assertThat(SecretMaskingConverter.mask("rejected bearer " + jwt)).doesNotContain("eyJhbGciOiJIUzI1NiJ9");
    }

    @Test
    void masksCredentialsEmbeddedInConnectionStrings() {
        assertThat(SecretMaskingConverter.mask("jdbc:mysql://finalagent:S3cr3tPass@127.0.0.1:3306/db"))
                .doesNotContain("S3cr3tPass");
    }

    @Test
    void leavesOrdinaryMessagesAlone() {
        String message = "Workflow run 42 completed with 12 valid records and 2 duplicates";
        assertThat(SecretMaskingConverter.mask(message)).isEqualTo(message);
    }
}
