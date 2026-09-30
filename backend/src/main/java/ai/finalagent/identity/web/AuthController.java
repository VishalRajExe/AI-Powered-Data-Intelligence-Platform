package ai.finalagent.identity.web;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import ai.finalagent.common.ErrorResponse;
import ai.finalagent.config.FinalAgentProperties;
import ai.finalagent.identity.domain.Identity.User;
import ai.finalagent.identity.domain.Identity.WorkspaceRole;
import ai.finalagent.identity.repository.IdentityRepository;
import ai.finalagent.identity.security.AuthCookies;
import ai.finalagent.identity.security.AuthenticatedWorkspace;
import ai.finalagent.identity.security.SessionCookieFilter;
import ai.finalagent.identity.service.AuthenticationService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The credential endpoints: register, log in, renew, sign out, and who am I.
 *
 * <p>Nothing in a response body is a credential. Each successful call returns the person and the
 * workspace they are now acting inside, and the session value travels only in an {@code HttpOnly}
 * cookie ({@link AuthCookies} explains why those three attributes <em>are</em> this design). The old
 * project returned a token in JSON and expected the browser to keep it, which puts the session one
 * XSS bug away from being copied
 * ({@code docs/audit/00-FORENSIC-AUDIT.md} §5 item 2).
 *
 * <p>The four failures this surface can produce are indistinguishable on purpose — unknown address,
 * disabled account, locked account, wrong password — and they all answer {@code INVALID_CREDENTIALS}
 * with the same cost. A registration form has to say which addresses are taken; a login form has no
 * reason to help.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthenticationService authentication;
    private final IdentityRepository identities;
    private final FinalAgentProperties.Auth config;

    public AuthController(AuthenticationService authentication, IdentityRepository identities,
                          FinalAgentProperties properties) {
        this.authentication = authentication;
        this.identities = identities;
        this.config = properties.auth();
    }

    public record Credentials(@NotBlank @Size(max = 320) String email,
                              @NotBlank @Size(max = 1024) String password) {
    }

    /**
     * @param displayName optional; the address's local part is used when it is absent, which is a
     *                    label rather than an identity claim
     */
    public record RegistrationRequest(@NotBlank @Size(max = 320) String email,
                                      @NotBlank @Size(max = 1024) String password,
                                      @Size(max = 120) String displayName) {
    }

    @PostMapping("/register")
    public ResponseEntity<Map<String, Object>> register(@Valid @RequestBody RegistrationRequest body) {
        AuthenticationService.Issued issued = authentication.register(
                body.email(), body.password(), body.displayName());
        return ResponseEntity.status(HttpStatus.CREATED).header(HttpHeaders.SET_COOKIE,
                        AuthCookies.issued(issued.presentedToken(), config).toString())
                .body(who(issued.userId(), issued.workspaceId(), issued.role()));
    }

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@Valid @RequestBody Credentials body) {
        AuthenticationService.Issued issued = authentication.login(body.email(), body.password());
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE,
                        AuthCookies.issued(issued.presentedToken(), config).toString())
                .body(who(issued.userId(), issued.workspaceId(), issued.role()));
    }

    /**
     * Renews the session and hands back a new credential for the same family.
     *
     * <p>401 with an expired cookie, so the browser drops the one it holds: keeping a credential the
     * server has already refused is how a client ends up retrying a dead session forever.
     */
    @PostMapping("/refresh")
    public ResponseEntity<?> refresh(
            @CookieValue(value = SessionCookieFilter.COOKIE_NAME, required = false) String presented) {
        if (presented == null || presented.isBlank()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(ErrorResponse.of("NO_SESSION",
                            "no session credential was presented, so there is nothing to renew"));
        }
        Optional<AuthenticationService.Issued> renewed = authentication.refresh(presented);
        if (renewed.isEmpty()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .header(HttpHeaders.SET_COOKIE, AuthCookies.expired(config).toString())
                    .body(ErrorResponse.of("SESSION_NOT_RENEWABLE",
                            "this session was ended or expired and cannot be renewed"));
        }
        AuthenticationService.Issued issued = renewed.get();
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE,
                        AuthCookies.issued(issued.presentedToken(), config).toString())
                .body(who(issued.userId(), issued.workspaceId(), issued.role()));
    }

    /**
     * Ends this session only. The answer is 204 whether or not there was anything to end, because a
     * caller who is already signed out has nothing left to learn from the difference.
     */
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(
            @CookieValue(value = SessionCookieFilter.COOKIE_NAME, required = false) String presented) {
        if (presented != null && !presented.isBlank()) {
            authentication.logout(presented);
        }
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, AuthCookies.expired(config).toString())
                .build();
    }

    /**
     * Who the caller is, read from the same context every other endpoint uses.
     *
     * <p>This is the endpoint the frontend calls on boot to decide whether to show the app or the
     * login screen, which is why it answers from the presented credential alone and never from
     * anything the page remembered.
     */
    @GetMapping("/me")
    public Map<String, Object> me() {
        AuthenticatedWorkspace principal = currentPrincipal();
        Map<String, Object> body = who(principal.userId(), principal.workspaceId(), principal.role());
        body.put("sessionId", principal.sessionId());
        return body;
    }

    /** The workspace this credential opens, plus the session's own lifetime figures. */
    private Map<String, Object> who(String userId, String workspaceId, WorkspaceRole role) {
        User user = identities.findUserById(userId).orElseThrow();
        Map<String, Object> person = new LinkedHashMap<>();
        person.put("id", user.id());
        person.put("email", user.email());
        person.put("displayName", user.displayName());
        person.put("status", user.status().name());
        person.put("lastLoginAt", user.lastLoginAt());

        Map<String, Object> workspace = new LinkedHashMap<>();
        identities.findWorkspace(workspaceId).ifPresent(found -> {
            workspace.put("id", found.id());
            workspace.put("name", found.name());
            workspace.put("kind", found.kind());
        });
        workspace.put("role", role.name());
        workspace.put("canWrite", role.atLeast(WorkspaceRole.EDITOR));
        workspace.put("isOwner", role == WorkspaceRole.OWNER);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("user", person);
        body.put("workspace", workspace);
        // The numbers a client needs in order to renew before the deadline rather than after it. Not
        // the token: a browser that can compute its own expiry already knows when to ask.
        body.put("session", Map.of("accessTokenTtlMinutes", config.accessTokenTtlMinutes(),
                "refreshTtlDays", config.refreshTtlDays()));
        return body;
    }

    private static AuthenticatedWorkspace currentPrincipal() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal()
                instanceof AuthenticatedWorkspace principal)) {
            throw new AuthenticationService.InvalidCredentialsException();
        }
        return principal;
    }

    // ------------------------------------------------------------------ errors

    @ExceptionHandler(AuthenticationService.RegistrationRejectedException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse rejected(AuthenticationService.RegistrationRejectedException e) {
        return ErrorResponse.of(e.code(), e.getMessage());
    }

    @ExceptionHandler(AuthenticationService.InvalidCredentialsException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public ErrorResponse invalid(AuthenticationService.InvalidCredentialsException e) {
        return ErrorResponse.of("INVALID_CREDENTIALS", e.getMessage());
    }

    /** The two refresh responses above use a bare map; this keeps the envelope one shape. */
    @ExceptionHandler(IllegalStateException.class)
    @ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
    public ErrorResponse unavailable(IllegalStateException e) {
        // A store that cannot answer is not a wrong password. Reporting it as one would both hide the
        // outage and cost the user a failed attempt against their real account.
        return ErrorResponse.of("IDENTITY_STORE_UNAVAILABLE",
                "the identity store could not be reached; nothing was signed in");
    }
}
