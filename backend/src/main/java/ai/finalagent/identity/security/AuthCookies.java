package ai.finalagent.identity.security;

import ai.finalagent.config.FinalAgentProperties;

import org.springframework.http.ResponseCookie;

/**
 * The one place the session credential is put into a cookie or taken out of one.
 *
 * <p>Three attributes are the security of this whole design, so they live in one method rather than
 * being assembled wherever an endpoint happens to set a cookie:
 *
 * <ul>
 *   <li><b>{@code HttpOnly}.</b> The token is never readable by script. An XSS bug in the frontend can
 *       then read the page it is standing on but cannot take the session, which is the difference
 *       between a defaced page and a hijacked account — and it is why no response body here ever
 *       carries the token either.</li>
 *   <li><b>{@code SameSite=Strict}.</b> The browser will not attach this cookie to a request that did
 *       not start on the site that owns it. That removes the ambient credential a cross-site
 *       request forgery needs, which is why the security chain does not also run a CSRF token: see
 *       {@code SecurityConfig} for the two other controls that make that safe, and the reason a
 *       double-submit cookie would be ceremony.</li>
 *   <li><b>{@code Max-Age} at the renewability window, not the access window.</b> One credential both
 *       authenticates a request and renews itself, so a cookie that expired with the short access
 *       deadline would leave a person holding nothing to refresh with. The row in
 *       {@code auth_sessions} decides whether the value is usable <em>now</em>; the browser only
 *       decides how long to keep offering it.</li>
 * </ul>
 */
public final class AuthCookies {

    public static final String NAME = "finalagent_session";

    private AuthCookies() {
    }

    public static ResponseCookie issued(String token, FinalAgentProperties.Auth config) {
        // The cookie's life is the renewability window, not the access window: one credential both
        // authenticates a request and renews itself, so a cookie that expired with the 15-minute row
        // deadline would leave a person holding nothing to refresh. The row decides whether the value
        // is usable now; the browser only decides how long to keep offering it.
        return base(config)
                .value(token)
                .maxAge(java.time.Duration.ofDays(config.refreshTtlDays()))
                .build();
    }

    /** The cookie that deletes the one the browser has: same name, same attributes, no lifetime. */
    public static ResponseCookie expired(FinalAgentProperties.Auth config) {
        return base(config).value("").maxAge(0).build();
    }

    private static ResponseCookie.ResponseCookieBuilder base(FinalAgentProperties.Auth config) {
        return ResponseCookie.from(NAME, "")
                .httpOnly(true)
                .secure(config.cookieSecure())
                .sameSite("Strict")
                .path("/");
    }
}
