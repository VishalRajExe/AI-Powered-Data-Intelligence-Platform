package ai.finalagent.identity.service;

import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import ai.finalagent.config.FinalAgentProperties;
import ai.finalagent.identity.domain.Identity.Membership;
import ai.finalagent.identity.domain.Identity.User;
import ai.finalagent.identity.domain.Identity.WorkspaceRole;
import ai.finalagent.identity.repository.IdentityRepository;
import ai.finalagent.identity.repository.SessionRepository;
import ai.finalagent.identity.security.SessionTokens;

/**
 * Registration, login, refresh and logout — the four ways a session begins and ends.
 *
 * <p>Four rules run through this class, each here because the project it replaced got that question
 * wrong.
 *
 * <p><b>An account that cannot be used cannot be logged into.</b> {@code password_hash} is null for a
 * service actor and {@link User#canAuthenticate()} refuses it before any comparison happens. The
 * audit's {@code demo@pirateagent.ai} was a seeded row whose specialness lived in the login code
 * ({@code 00-FORENSIC-AUDIT.md} §5 item 2); here it lives in a column, so there is no branch to
 * forget.
 *
 * <p><b>A failed login says one thing.</b> Unknown address, non-authenticating row, locked account and
 * wrong password all answer {@code INVALID_CREDENTIALS}, and the paths that do no real comparison pay
 * for one anyway, so the response time does not tell a caller whether the account exists. A public
 * registration form already discloses that by refusing a taken address; the login endpoint is not
 * going to volunteer the same answer.
 *
 * <p><b>A lockout is data, not memory.</b> The counter and the deadline are written in one UPDATE on
 * the database clock, and the decision to honour it is taken in SQL, so two concurrent attackers share
 * one budget, a restart does not reset it, and no application clock gets to disagree about "not yet".
 *
 * <p><b>A token used twice is theft, not a stale client.</b> Refresh revokes the presented row and
 * mints a child in the same family. If a revoked row comes back, every live session in that family is
 * ended — including the one the legitimate holder is using. That is deliberately inconvenient for one
 * person, and it is the only reading of that event that can be acted on.
 */
@Service
public class AuthenticationService {

    private static final Logger log = LoggerFactory.getLogger(AuthenticationService.class);

    private final IdentityRepository identities;
    private final SessionRepository sessions;
    private final PasswordEncoder passwords;
    private final FinalAgentProperties.Auth config;
    /**
     * A real bcrypt digest, produced once at startup by the same encoder that verifies passwords, and
     * matched against on the paths that have no row to check. Its purpose is only to cost the same as
     * the work the honest path does; nobody is ever meant to present what would match it.
     */
    private final String timingEquivalent;

    public AuthenticationService(IdentityRepository identities, SessionRepository sessions,
                                 PasswordEncoder passwords, FinalAgentProperties properties) {
        this.identities = identities;
        this.sessions = sessions;
        this.passwords = passwords;
        this.config = properties.auth();
        this.timingEquivalent = passwords.encode(UUID.randomUUID().toString());
    }

    /** A rejected registration, with the field named and no value echoed. */
    public static class RegistrationRejectedException extends RuntimeException {
        private final String code;

        public RegistrationRejectedException(String code, String message) {
            super(message);
            this.code = code;
        }

        public String code() {
            return code;
        }
    }

    /** A refused credential. One message, because the reason is not the caller's to learn. */
    public static class InvalidCredentialsException extends RuntimeException {
        public InvalidCredentialsException() {
            super("the address or password is not correct");
        }
    }

    // ------------------------------------------------------------------ registration

    /**
     * Creates the account, a personal workspace, and the OWNER membership that makes it reachable —
     * then signs the caller in.
     *
     * <p>All of it or none of it. A user with no workspace signs in to a tenant nothing can be read
     * through; a workspace with no owner is unreachable by anyone. One transaction is the only way to
     * make the pair unbreakable, and a duplicate address answers false from the unique index rather
     * than by checking first — two registrations of one address arriving together is a thing that
     * happens.
     */
    @Transactional(isolation = Isolation.REPEATABLE_READ, rollbackFor = Exception.class)
    public Issued register(String email, String password, String displayName) {
        String normalized = normalizeEmail(email);
        validatePassword(password);
        String name = displayName == null || displayName.isBlank()
                ? normalized.substring(0, normalized.indexOf('@')) : displayName.strip();

        String userId = UUID.randomUUID().toString();
        if (!identities.insertUser(userId, normalized, name, passwords.encode(password))) {
            throw new RegistrationRejectedException("EMAIL_TAKEN",
                    "an account already exists for that address");
        }
        String workspaceId = UUID.randomUUID().toString();
        identities.insertWorkspace(workspaceId, "Personal", "PERSONAL", userId);
        identities.insertMembership(workspaceId, userId, WorkspaceRole.OWNER);
        // Machine-authored log line, no address and no token: "an account was created" is the fact,
        // and which one is already in the row.
        log.info("registered an account and its personal workspace");
        return issue(userId, workspaceId, WorkspaceRole.OWNER);
    }

    // ------------------------------------------------------------------ login

    /**
     * @throws InvalidCredentialsException for every refusal, including a locked account — a message
     *         that says "locked" is a statement about which addresses are real
     */
    @Transactional
    public Issued login(String email, String password) {
        Optional<User> found = identities.findUserByEmail(normalizeEmail(email));
        if (found.isEmpty()) {
            wasteAComparison(password);
            throw new InvalidCredentialsException();
        }
        User user = found.get();
        if (!user.canAuthenticate()) {
            wasteAComparison(password);
            throw new InvalidCredentialsException();
        }
        if (!identities.loginAttemptsAllowed(user.id())) {
            // The lock is decided in SQL on the database clock. Nothing here compares a timestamp it
            // read earlier against a clock it does not share with the server.
            wasteAComparison(password);
            throw new InvalidCredentialsException();
        }
        if (!passwords.matches(password == null ? "" : password, user.passwordHash())) {
            identities.recordFailedLogin(user.id(), config.maxFailedLogins(), config.lockoutMinutes());
            throw new InvalidCredentialsException();
        }

        identities.recordSuccessfulLogin(user.id());
        Membership home = identities.primaryMembership(user.id()).orElse(null);
        if (home == null) {
            // A person with no membership is a data fault, not an access decision. Guessing a tenant
            // for them would be exactly the placeholder this phase exists to remove.
            log.warn("an account signed in with no workspace membership");
            throw new InvalidCredentialsException();
        }
        return issue(user.id(), home.workspaceId(), home.role());
    }

    // ------------------------------------------------------------------ refresh / logout

    /**
     * Rotates a session, or ends the family when the presented token had already been rotated away.
     *
     * <p>Returns empty for a token that is merely expired: that credential was never revoked, so the
     * honest answer is "this one is finished", not a revocation that would sign the person out of
     * every device they own.
     */
    @Transactional
    public Optional<Issued> refresh(String presented) {
        var existing = sessions.findByTokenHash(SessionTokens.store(presented));
        if (existing.isEmpty()) {
            return Optional.empty();
        }
        var session = existing.get();
        if (session.revokedAt() != null) {
            int ended = sessions.revokeFamily(session.familyId(), "TOKEN_REUSE");
            log.warn("a rotated session was presented again; {} live session(s) in that family ended",
                    ended);
            return Optional.empty();
        }
        // Generated once and used twice: the hash goes to the database and the value goes to the
        // cookie. Two calls to `present()` here would store one token and hand out another, and every
        // refresh would look like a reused one.
        String replacement = SessionTokens.present();
        String newId = sessions.rotate(session.id(), UUID.randomUUID().toString(),
                SessionTokens.store(replacement), config.accessTokenTtlMinutes());
        if (newId == null) {
            return Optional.empty();
        }
        return Optional.of(new Issued(session.userId(), session.workspaceId(),
                // Re-read, not carried: a rotation must not freeze a permission the owner has since
                // changed.
                identities.membership(session.workspaceId(), session.userId())
                        .map(Membership::role).orElse(WorkspaceRole.VIEWER),
                replacement));
    }

    /** Ends one session. The caller's other devices are untouched — this is a sign-out, not a ban. */
    public void logout(String presented) {
        sessions.findByTokenHash(SessionTokens.store(presented))
                .ifPresent(session -> sessions.revoke(session.id(), "LOGGED_OUT"));
    }

    /**
     * The one path registration and login take to hand out a session, so neither can drift from the
     * other on what a session is made of.
     */
    private Issued issue(String userId, String workspaceId, WorkspaceRole role) {
        String presented = SessionTokens.present();
        sessions.insert(UUID.randomUUID().toString(), userId, workspaceId,
                SessionTokens.store(presented), UUID.randomUUID().toString(),
                config.accessTokenTtlMinutes(), config.absoluteTtlDays(), null);
        return new Issued(userId, workspaceId, role, presented);
    }

    private void wasteAComparison(String password) {
        passwords.matches(password == null ? "" : password, timingEquivalent);
    }

    // ------------------------------------------------------------------ rules

    /**
     * Lowercased and trimmed — the whole normalization, applied in exactly one place so
     * {@code uq_user_email} means what it says. The local part of an address is case-sensitive in the
     * RFC and case-insensitive in every provider anyone actually uses; treating it as one shape is the
     * choice that keeps "Alex@…" and "alex@…" from becoming two accounts with two workspaces, and the
     * cost is recorded in Memory.md.
     */
    public static String normalizeEmail(String email) {
        if (email == null || email.isBlank()) {
            throw new RegistrationRejectedException("EMAIL_INVALID", "an address is required");
        }
        String value = email.strip().toLowerCase();
        if (value.chars().anyMatch(Character::isWhitespace)) {
            // Stripping the ends is not enough: `jo hn@x.test` is not an address anyone can receive
            // mail at, and accepting it would create an account that its owner can never sign into
            // because every real client normalises it away before it gets here.
            throw new RegistrationRejectedException("EMAIL_INVALID", "that is not an email address");
        }
        int at = value.indexOf('@');
        if (at < 1 || at != value.lastIndexOf('@') || at == value.length() - 1
                || value.substring(at + 1).indexOf('.') < 0 || value.length() > 320) {
            throw new RegistrationRejectedException("EMAIL_INVALID", "that is not an email address");
        }
        return value;
    }

    /**
     * Length is the only password rule, and 12 is the floor because no amount of bcrypt hardens a
     * short one. Composition rules are refused deliberately — they push people into writing the
     * password down — but 72 is a ceiling with a reason: bcrypt truncates silently past it, so a
     * longer password would verify on its first 72 bytes and the person would never learn the rest was
     * decoration.
     */
    private static void validatePassword(String password) {
        if (password == null || password.isBlank()) {
            throw new RegistrationRejectedException("PASSWORD_TOO_SHORT", "a password is required");
        }
        if (password.length() < 12) {
            throw new RegistrationRejectedException("PASSWORD_TOO_SHORT",
                    "a password needs at least 12 characters");
        }
        if (password.length() > 72) {
            throw new RegistrationRejectedException("PASSWORD_TOO_LONG",
                    "a password must be 72 characters or fewer; bcrypt ignores anything past that");
        }
    }

    /**
     * What a successful credential is: who it belongs to, which tenant it grants, what role that
     * tenant gives, and the value to put in the cookie.
     *
     * <p>The token is the only thing in this build that leaves the process as a secret, and it leaves
     * exactly once — into an {@code HttpOnly} cookie. It is never in a response body, a log line or an
     * error message.
     */
    public record Issued(String userId, String workspaceId, WorkspaceRole role, String presentedToken) {
    }
}
