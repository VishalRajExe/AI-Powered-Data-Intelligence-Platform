package ai.finalagent.identity.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

import javax.sql.DataSource;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import ai.finalagent.identity.domain.Identity.Session;

/**
 * Sessions, and the only place their lifetime is decided.
 *
 * <p>The caller presents a random token; this class looks the row up by its SHA-256 and answers with
 * the row's own state. Two consequences are the design rather than a side effect:
 *
 * <ul>
 *   <li><b>Logout is a delete, not an instruction.</b> Revoking the row ends access on the next
 *       request, whatever the token looks like. A stateless token can only be told to stop being valid,
 *       which is why the short-lived access value still needs a server-side record to be worth
 *       having.</li>
 *   <li><b>Every deadline is the database's.</b> Whether a session is live is
 *       {@code revoked_at IS NULL AND expires_at > NOW(6)} in SQL — never a comparison against a
 *       timestamp this process read a moment earlier and judged with its own clock. Two nodes with
 *       skew would disagree about who is logged in, and that disagreement looks like a phantom
 *       session.</li>
 * </ul>
 */
@Repository
public class SessionRepository {

    private final JdbcTemplate jdbc;

    public SessionRepository(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    private static final RowMapper<Session> ROW = SessionRepository::map;

    private static Session map(ResultSet rs, int n) throws SQLException {
        return new Session(rs.getString("id"), rs.getString("user_id"), rs.getString("workspace_id"),
                rs.getString("token_hash"), rs.getString("family_id"),
                instant(rs.getTimestamp("created_at")), instant(rs.getTimestamp("last_used_at")),
                instant(rs.getTimestamp("expires_at")),
                instant(rs.getTimestamp("absolute_expires_at")),
                instant(rs.getTimestamp("revoked_at")), rs.getString("revoke_reason"));
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    /**
     * Issues a session. {@code absolute_expires_at} is written here and never updated by anything:
     * rotation moves {@code expires_at} forward and cannot move the ceiling, so a copied token buys a
     * longer life rather than an unlimited one.
     */
    public void insert(String id, String userId, String workspaceId, String tokenHash, String familyId,
                       int accessTtlMinutes, int absoluteTtlDays, String createdByIp) {
        jdbc.update("""
                INSERT INTO auth_sessions
                  (id, user_id, workspace_id, token_hash, family_id, created_by_ip,
                   expires_at, absolute_expires_at)
                VALUES (?, ?, ?, ?, ?, ?,
                        TIMESTAMPADD(MINUTE, ?, NOW(6)),
                        TIMESTAMPADD(DAY, ?, NOW(6)))
                """, id, userId, workspaceId, tokenHash, familyId, createdByIp,
                accessTtlMinutes, absoluteTtlDays);
    }

    /**
     * The session a presented token belongs to, whether or not it is still live.
     *
     * <p>Deliberately unfiltered on state: a revoked row has to be *found* for reuse detection to
     * mean anything. The live test is {@link #isLive}, on the database clock.
     */
    public Optional<Session> findByTokenHash(String tokenHash) {
        return jdbc.query("SELECT * FROM auth_sessions WHERE token_hash = ?", ROW, tokenHash).stream()
                .findFirst();
    }

    /** Whether the database considers this session usable right now. */
    public boolean isLive(String id) {
        Boolean live = jdbc.queryForObject("""
                SELECT revoked_at IS NULL AND expires_at > NOW(6) AND absolute_expires_at > NOW(6)
                  FROM auth_sessions WHERE id = ?
                """, Boolean.class, id);
        return Boolean.TRUE.equals(live);
    }

    /**
     * Touches the session so the activity listing shows where a person actually is.
     *
     * <p>Skipped when the row is not live, and it never extends a deadline — those are set at issue
     * and moved only by {@link #rotate}.
     */
    public void markUsed(String id) {
        jdbc.update("UPDATE auth_sessions SET last_used_at = NOW(6) WHERE id = ?"
                + " AND revoked_at IS NULL AND expires_at > NOW(6)", id);
    }

    /**
     * Ends one session, guarded on it not already being ended.
     *
     * @return false when the row was already revoked, which is what a second presentation of a
     *         rotated-away token looks like from here
     */
    public boolean revoke(String id, String reason) {
        return jdbc.update("UPDATE auth_sessions SET revoked_at = NOW(6), revoke_reason = ?"
                + " WHERE id = ? AND revoked_at IS NULL", reason, id) == 1;
    }

    /**
     * Ends every session in a family. Called when a token that had already been rotated away comes
     * back: the honest reading of that is a copy, so the legitimate holder is signed out too.
     *
     * @return the number of sessions ended, which a test asserts is more than one
     */
    public int revokeFamily(String familyId, String reason) {
        return jdbc.update("UPDATE auth_sessions SET revoked_at = NOW(6), revoke_reason = ?"
                + " WHERE family_id = ? AND revoked_at IS NULL", reason, familyId);
    }

    /**
     * Swaps a live session for a new token in the same family, and returns the new row's id.
     *
     * <p>Both writes happen against the presented row's own state: the rotate only succeeds while that
     * row is still unrevoked ({@code affected == 1}), so two concurrent refreshes of one token cannot
     * both produce a child. One of them loses, gets a no-op, and the caller sees the reuse path.
     *
     * <p>The child inherits its family and its absolute ceiling from the parent in the same statement
     * that inserts it. Reading the ceiling into Java and writing it back would put a second clock in
     * the middle of a rule about clocks, and a ceiling that reset on rotation would make "refresh
     * forever" literally true.
     */
    public String rotate(String existingId, String newId, String newTokenHash, int accessTtlMinutes) {
        // The ceiling is part of the guard, not a later check: without it, rotating a session that is
        // already past `absolute_expires_at` would mint a child from an expired parent and the
        // deadline that is supposed to end a long-lived stolen token would simply move forward forever.
        int revoked = jdbc.update("UPDATE auth_sessions SET revoked_at = NOW(6),"
                + " revoke_reason = 'ROTATED' WHERE id = ? AND revoked_at IS NULL"
                + " AND absolute_expires_at > NOW(6)", existingId);
        if (revoked != 1) {
            return null;
        }
        jdbc.update("""
                INSERT INTO auth_sessions
                  (id, user_id, workspace_id, token_hash, family_id, created_by_ip,
                   expires_at, absolute_expires_at)
                SELECT ?, user_id, workspace_id, ?, family_id, created_by_ip,
                       TIMESTAMPADD(MINUTE, ?, NOW(6)), absolute_expires_at
                  FROM auth_sessions WHERE id = ?
                """, newId, newTokenHash, accessTtlMinutes, existingId);
        return newId;
    }
}
