package ai.finalagent.identity.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

import javax.sql.DataSource;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import ai.finalagent.identity.domain.Identity.Membership;
import ai.finalagent.identity.domain.Identity.User;
import ai.finalagent.identity.domain.Identity.UserStatus;
import ai.finalagent.identity.domain.Identity.WorkspaceRole;
import ai.finalagent.identity.domain.Identity.WorkspaceRow;

/**
 * Accounts, tenants and the membership that connects them.
 *
 * <p>Every read a request makes goes through {@link #membership}, which is the one question the whole
 * authorization layer asks: <em>is this user a member of this workspace, and what may they do
 * there?</em> Nothing else grants access, and no request carries a workspace id that this lookup does
 * not confirm.
 *
 * <p>Timestamps and lockouts are compared on the database clock ({@code NOW(6)}), as everywhere else
 * in this schema. An application clock deciding whether a lockout has expired would put that answer in
 * whichever process happened to ask, which is how a lockout becomes either nothing or permanent.
 */
@Repository
public class IdentityRepository {

    private final JdbcTemplate jdbc;

    public IdentityRepository(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    private static final RowMapper<User> USER = IdentityRepository::mapUser;
    private static final RowMapper<WorkspaceRow> WORKSPACE = (rs, n) -> new WorkspaceRow(
            rs.getString("id"), rs.getString("name"), rs.getString("kind"),
            rs.getString("created_by_id"), instant(rs.getTimestamp("created_at")));
    private static final RowMapper<Membership> MEMBERSHIP = (rs, n) -> new Membership(
            rs.getString("workspace_id"), rs.getString("user_id"),
            WorkspaceRole.valueOf(rs.getString("role")), instant(rs.getTimestamp("created_at")));

    private static User mapUser(ResultSet rs, int n) throws SQLException {
        String status = rs.getString("status");
        return new User(rs.getString("id"), rs.getString("email"), rs.getString("display_name"),
                rs.getString("password_hash"),
                status == null ? UserStatus.ACTIVE : UserStatus.valueOf(status),
                rs.getInt("failed_logins"), instant(rs.getTimestamp("locked_until")),
                instant(rs.getTimestamp("last_login_at")), instant(rs.getTimestamp("created_at")));
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    // -------------------------------------------------------------------------- users

    /** @return false when the address is taken — by {@code uq_user_email}, not by a check-then-insert */
    public boolean insertUser(String id, String email, String displayName, String passwordHash) {
        try {
            jdbc.update("""
                    INSERT INTO users (id, email, display_name, password_hash, status)
                    VALUES (?, ?, ?, ?, 'ACTIVE')
                    """, id, email, displayName, passwordHash);
            return true;
        } catch (DuplicateKeyException e) {
            return false;
        }
    }

    public Optional<User> findUserByEmail(String email) {
        return jdbc.query("SELECT * FROM users WHERE email = ?", USER, email).stream().findFirst();
    }

    public Optional<User> findUserById(String id) {
        return jdbc.query("SELECT * FROM users WHERE id = ?", USER, id).stream().findFirst();
    }

    /**
     * Whether this account may be tried again right now.
     *
     * <p>Answered in SQL because the lock's deadline is a database timestamp: comparing it against
     * {@code Instant.now()} here would let whichever process asked decide whether the lock had
     * expired, which is how a lockout becomes either nothing or permanent.
     */
    public boolean loginAttemptsAllowed(String userId) {
        Boolean allowed = jdbc.queryForObject("""
                SELECT locked_until IS NULL OR locked_until <= NOW(6) FROM users WHERE id = ?
                """, Boolean.class, userId);
        return Boolean.TRUE.equals(allowed);
    }

    /**
     * Records a failed attempt and locks the account at the same time, in one statement.
     *
     * <p>Two writes would let a concurrent attacker sit between them and keep a fresh budget. The
     * {@code CASE} is the whole rule: the lock starts when this attempt crosses the bound, on the
     * server's clock, and the counter is never reset by a second writer.
     *
     * <p><b>{@code REQUIRES_NEW} is what makes the counter exist at all.</b> The login that calls this
     * then refuses the credential by throwing, and a throwing {@code @Transactional} method rolls its
     * work back — including this row. Without its own transaction the lockout could never engage: the
     * attempt count would reset to zero after every wrong password, and the counter would look correct
     * in a unit test that never runs the real transaction.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordFailedLogin(String userId, int maxAttempts, int lockoutMinutes) {
        jdbc.update("""
                UPDATE users
                   SET failed_logins = failed_logins + 1,
                       locked_until  = CASE WHEN failed_logins + 1 >= ?
                                            THEN TIMESTAMPADD(MINUTE, ?, NOW(6))
                                            ELSE locked_until END
                 WHERE id = ?
                """, maxAttempts, lockoutMinutes, userId);
    }

    public void recordSuccessfulLogin(String userId) {
        jdbc.update("UPDATE users SET failed_logins = 0, locked_until = NULL,"
                + " last_login_at = NOW(6) WHERE id = ?", userId);
    }

    // ----------------------------------------------------------------------- tenants

    public void insertWorkspace(String id, String name, String kind, String createdById) {
        jdbc.update("INSERT INTO workspaces (id, name, kind, created_by_id) VALUES (?, ?, ?, ?)",
                id, name, kind, createdById);
    }

    public Optional<WorkspaceRow> findWorkspace(String id) {
        return jdbc.query("SELECT * FROM workspaces WHERE id = ?", WORKSPACE, id).stream().findFirst();
    }

    public void insertMembership(String workspaceId, String userId, WorkspaceRole role) {
        jdbc.update("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)",
                workspaceId, userId, role.name());
    }

    /**
     * The authorization question, asked once per authenticated request.
     *
     * <p>It reads the pair together rather than fetching a user's workspaces and filtering in Java, so
     * "not a member" and "that workspace does not exist" cost the same single indexed lookup and answer
     * the same way — confirming which tenant ids are real is itself a leak.
     */
    public Optional<Membership> membership(String workspaceId, String userId) {
        return jdbc.query("SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
                MEMBERSHIP, workspaceId, userId).stream().findFirst();
    }

    /** The workspace a signed-in user is taken to: their oldest personal one, then their oldest any. */
    public Optional<Membership> primaryMembership(String userId) {
        return jdbc.query("""
                SELECT m.workspace_id, m.user_id, m.role, m.created_at
                  FROM workspace_members m
                  JOIN workspaces w ON w.id = m.workspace_id
                 WHERE m.user_id = ?
                 ORDER BY (w.kind = 'PERSONAL') DESC, m.created_at, m.workspace_id
                 LIMIT 1
                """, MEMBERSHIP, userId).stream().findFirst();
    }
}
