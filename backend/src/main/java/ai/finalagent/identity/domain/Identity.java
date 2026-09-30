package ai.finalagent.identity.domain;

import java.time.Instant;

/**
 * Identity rows as they exist in MySQL — the anaemic read model over JDBC that the rest of this
 * backend uses, in the shape of {@code workflow.domain.Records} and {@code dataset.domain.DatasetRows}.
 *
 * <p>Two fields here are deliberately nullable in a way that will look like an oversight to a reader
 * who has not met the audit:
 *
 * <ul>
 *   <li>{@link User#passwordHash()} is null for a service actor. That is not "no password set yet", it
 *       is "this row cannot authenticate", and the login path refuses it. The old project's
 *       {@code demo@pirateagent.ai} was a row that could not tell those two apart
 *       ({@code 00-FORENSIC-AUDIT.md} §5 item 2).</li>
 *   <li>{@link Session#revokedAt()} and {@link Session#expiresAt()} are separate facts. A session can
 *       be live but outlived, and revoked while still inside its window; the reason recorded on the
 *       second one is the difference between "this user signed out" and "we found this token used
 *       twice, which means it was copied".</li>
 * </ul>
 */
public final class Identity {

    private Identity() {
    }

    /**
     * A person, or a labelled machine actor.
     *
     * @param failedLogins counted on the database clock with the lock, so two nodes cannot each see a
     *                     fresh counter and let an attacker try twice the budget
     */
    public record User(String id, String email, String displayName, String passwordHash,
                       UserStatus status, int failedLogins, Instant lockedUntil, Instant lastLoginAt,
                       Instant createdAt) {

        /**
         * A row that has never been able to sign in is refused the same way a wrong password is, and
         * for the same reason it is not refused with a different message: "this account exists but
         * cannot be used" is information about the tenant that the caller has no need of.
         */
        public boolean canAuthenticate() {
            return passwordHash != null && !passwordHash.isBlank() && status == UserStatus.ACTIVE;
        }

        public boolean locked(Instant now) {
            return lockedUntil != null && lockedUntil.isAfter(now);
        }
    }

    public enum UserStatus {
        ACTIVE, DISABLED, SERVICE
    }

    /** A tenant. Everything a request is allowed to see hangs off the id of one of these. */
    public record WorkspaceRow(String id, String name, String kind, String createdById,
                               Instant createdAt) {
    }

    /**
     * The role ladder. One enum, one order, one comparison — {@link #atLeast} — because the failure
     * this project keeps finding is the same rule written twice and drifting.
     *
     * <p>OWNER subsumes EDITOR subsumes VIEWER. There is no "OWNER minus one permission" concept, and
     * adding one would need a permission table rather than a column.
     */
    public enum WorkspaceRole {
        VIEWER(1), EDITOR(2), OWNER(3);

        private final int rank;

        WorkspaceRole(int rank) {
            this.rank = rank;
        }

        public boolean atLeast(WorkspaceRole required) {
            return rank >= required.rank;
        }
    }

    /** A user's standing in one workspace. Membership is the authorization; nothing else grants it. */
    public record Membership(String workspaceId, String userId, WorkspaceRole role, Instant createdAt) {
    }

    /**
     * One issued session.
     *
     * @param tokenHash the SHA-256 of the value the caller holds, never the value itself: a backup of
     *                  this table must not be a list of live credentials
     * @param familyId  the lineage across refresh rotations. Presenting a member of a family that has
     *                  already been revoked is theft, not a stale client, and it ends the family
     * @param absoluteExpiresAt the renewal-proof deadline. Rotation refreshes {@code expiresAt} and
     *                          can never move this one, so a copied token buys a longer life rather
     *                          than an unlimited one
     */
    public record Session(String id, String userId, String workspaceId, String tokenHash,
                          String familyId, Instant createdAt, Instant lastUsedAt, Instant expiresAt,
                          Instant absoluteExpiresAt, Instant revokedAt, String revokeReason) {

        /**
         * Whether this row alone is enough to let a request through.
         *
         * <p>Checked against the database's clock, passed in rather than read from
         * {@code Instant.now()} inside: the caller has already spent the query, and letting a
         * second, unsynchronised clock decide would put the answer in whichever process asked.
         */
        public boolean live(Instant now) {
            return revokedAt == null && now.isBefore(expiresAt) && now.isBefore(absoluteExpiresAt);
        }
    }
}
