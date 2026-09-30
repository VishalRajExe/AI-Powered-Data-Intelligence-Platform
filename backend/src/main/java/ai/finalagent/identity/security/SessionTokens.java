package ai.finalagent.identity.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/**
 * Session credentials: random where they are issued, hashed where they are stored.
 *
 * <p>Two primitives, both small on purpose. A token is 32 bytes from {@link SecureRandom} — 256 bits,
 * so guessing one is not a question about the algorithm — and the stored form is its SHA-256, because
 * the database only ever needs to answer "is this the row that matches" and must not therefore hold
 * something spendable. A leak of {@code auth_sessions} then discloses nothing a caller can present.
 *
 * <p>The encoding is base64url without padding: it goes into a cookie value, and a token that needs
 * escaping to survive transport is a token that will be silently mangled by something in between.
 */
public final class SessionTokens {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int TOKEN_BYTES = 32;

    private SessionTokens() {
    }

    /** The value handed to the caller. Never stored anywhere in this form. */
    public static String present() {
        byte[] bytes = new byte[TOKEN_BYTES];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** The value stored beside it. Deterministic, so lookup by hash is an index seek. */
    public static String store(String presented) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(presented.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is mandated by the platform; reaching here means the JVM is not a JVM.
            throw new IllegalStateException("SHA-256 is required to store a session token", e);
        }
    }

    /** A human-facing token can never be a password, so there is nothing here to mask. */
    public static boolean looksLikeSession(String value) {
        return value != null && value.length() >= 40 && value.length() <= 128
                && value.matches("[A-Za-z0-9_\\-]+");
    }
}
