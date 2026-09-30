package ai.finalagent.config;


import java.io.IOException;
import java.util.List;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import ai.finalagent.common.ErrorResponse;
import ai.finalagent.identity.repository.IdentityRepository;
import ai.finalagent.identity.repository.SessionRepository;
import ai.finalagent.identity.security.SessionCookieFilter;
import ai.finalagent.workflow.support.Json;

/**
 * The security chain: who may reach which endpoint, and on what credential.
 *
 * <p><b>One transport for the credential.</b> A session cookie, {@code HttpOnly}, {@code SameSite=Strict}
 * and {@code Secure} when the deployment asks for it. There is no bearer token, no API key, and no
 * request header or body field that names a workspace — the last of those is the specific thing the
 * audit says the previous project trusted ({@code docs/audit/00-FORENSIC-AUDIT.md} §5 item 1), and
 * this file refuses it structurally: a caller has no way to say whose data they want.
 *
 * <p><b>No JWT, so no JWT secret exists.</b> Sessions are opaque random values checked against MySQL by
 * their SHA-256 on every request. The brief's requirement was that the frontend never receive a
 * signing secret; a scheme with none cannot leak one, and logout becomes a row delete rather than a
 * request that a stateless token honour. The cost is one indexed lookup per request, which every
 * endpoint here already pays to read the data the request is about.
 *
 * <p><b>State changes must carry a header the browser will not send on its own.</b> A cookie is ambient
 * authority, so something has to stop a foreign page from making one. Spring Security's own answer —
 * a double-submit token in a readable cookie — is the right shape for an API, but it is only workable
 * if the browser actually receives that token, and Spring 6 writes it lazily: over real HTTP, a client
 * that has never asked for a token gets a session cookie and nothing else, so every {@code POST} from
 * a correctly-behaving frontend would fail closed while a hand-written curl still got through. The
 * rule enforced here is the one a hand-written client cannot accidentally satisfy either: a mutating
 * request must carry {@code X-Requested-With}, which a cross-origin form or navigation cannot set
 * without a CORS preflight this deployment's exact-origin allow-list denies. Three independent controls
 * — {@code SameSite=Strict}, the preflight, and the header — have to fail together for a forged state
 * change to reach the queue. Recorded in Memory.md as a deliberate deviation from the Spring default,
 * with the honest gap beside it: rotation of the token would require a session to be re-established
 * rather than a header to be set.
 *
 * <p><b>Reads are open to any member; writes are not.</b> A VIEWER can read a dataset, its schema and
 * its evidence trail. Starting a run spends Firecrawl credits and Gemini quota, requesting an export
 * spends a worker and a disk write, and cancelling ends somebody else's work — so all three need
 * EDITOR. This is the one place that rule is written; the ladder itself is {@code Identity.WorkspaceRole}.
 */
@Configuration
public class SecurityConfig {

    /** The header a same-origin XHR sends and a cross-site form cannot. */
    public static final String STATE_CHANGE_HEADER = "X-Requested-With";

    /**
     * Cost 12: about 250ms per hash on this machine, which is a login the user waits through rather
     * than a database an attacker races. There is no configuration knob for it because a deployment
     * that lowered it to save milliseconds would be trading the one property bcrypt is here for.
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    public SessionCookieFilter sessionCookieFilter(SessionRepository sessions,
                                                   IdentityRepository identities) {
        return new SessionCookieFilter(sessions, identities);
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, SessionCookieFilter sessionFilter)
            throws Exception {
        // Stateless: no HTTP session exists to hold a principal between requests, so the cookie is
        // re-checked against the database every time and revocation is immediate rather than eventual.
        http.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
        // Spring's CSRF filter is off, and the guard below replaces it. See the class comment for why
        // the default double-submit token is not usable here as configured, and what stands in for it.
        http.csrf(AbstractHttpConfigurer::disable);
        // Anchored on a filter Spring Security's own registry knows about; two added filters cannot be
        // ordered against each other, only against a position in the chain. Before
        // SecurityContextHolderFilter is deliberate — a forged state change is refused without reading
        // the session or the database at all.
        http.addFilterBefore(new StateChangeRequiresHeaderFilter(), SecurityContextHolderFilter.class);
        http.cors(Customizer.withDefaults());
        http.addFilterBefore(sessionFilter, BasicAuthenticationFilter.class);
        http.authorizeHttpRequests(registry -> registry
                // A preflight carries no credential by design and must never be the thing that 401s.
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .requestMatchers("/api/v1/auth/register", "/api/v1/auth/login").permitAll()
                // Refresh and logout are permitted without a *live* session, which is the whole point
                // of them: the credential they present is one the chain has just refused — expired, or
                // rotated away — and requiring it to be live first would make renewal unreachable and
                // logout something only a signed-in caller can do. Both validate the presented token
                // themselves, and neither grants a session it did not already have.
                .requestMatchers("/api/v1/auth/refresh", "/api/v1/auth/logout").permitAll()
                // The probes Docker and the deploy scripts call before anything is signed in. They
                // report reachability and configuration, never data, and /ready has answered 503 with
                // a real component report since Phase 1.
                .requestMatchers("/health", "/ready", "/api/v1/health", "/api/v1/ready",
                        "/actuator/**").permitAll()
                .requestMatchers("/api/v1/auth/me", "/api/v1/auth/refresh",
                        "/api/v1/auth/logout").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/**").authenticated()
                .requestMatchers("/api/**").hasAnyRole("OWNER", "EDITOR")
                .anyRequest().permitAll());
        http.exceptionHandling(handling -> handling
                // Both handlers write the same envelope every other error in this API uses. A default
                // HTML error page would make the frontend's JSON parser throw, and a caller would see
                // "invalid response" when the truth was "not signed in".
                .authenticationEntryPoint((request, response, exception) -> write(response, 401,
                        ErrorResponse.of("AUTHENTICATION_REQUIRED",
                                "this endpoint needs a session; sign in first")))
                .accessDeniedHandler((request, response, exception) -> write(response, 403,
                        ErrorResponse.of("WORKSPACE_WRITE_FORBIDDEN",
                                "this workspace's role may read but cannot start work, request an"
                                        + " export or cancel a run"))));
        // No form login, no default logout page, no redirect: this is a JSON API and a browser that
        // gets a 302 to a Spring-generated page would be a frontend that cannot tell why it failed.
        http.formLogin(AbstractHttpConfigurer::disable);
        http.httpBasic(AbstractHttpConfigurer::disable);
        http.logout(AbstractHttpConfigurer::disable);
        return http.build();
    }

    private static void write(jakarta.servlet.http.HttpServletResponse response, int status,
                              ErrorResponse body) throws java.io.IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        // The same envelope every other failure in this API writes, through the one mapper the
        // backend uses for JSON columns. A 401 that answered as HTML would look to the frontend like
        // a broken backend rather than as a sign-in prompt.
        response.getWriter().write(Json.write(body));
    }

    /**
     * A request that changes state has to say so with a header a browser will not set on its own.
     *
     * <p>Runs before authentication, so a forged call is refused without consulting the session or the
     * database at all. Registration and login are exempt: there is no session to ride yet, and the
     * credential a login forgery would plant belongs to the attacker's own workspace — the data under
     * it stays invisible to the person they aimed it at, which is a different and far smaller problem
     * than moving somebody's run.
     *
     * <p>The header is checked for presence, not value. Its job is not to identify a client; it is to
     * be something a cross-origin {@code <form>} or a {@code no-cors} fetch cannot produce, because
     * adding it forces a CORS preflight — and the preflight is answered only for the exact origins
     * {@code FRONTEND_ORIGIN} names.
     */
    static class StateChangeRequiresHeaderFilter extends OncePerRequestFilter {

        private static final List<String> MUTATING = List.of("POST", "PUT", "PATCH", "DELETE");

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                        FilterChain chain) throws IOException, ServletException {
            if (!MUTATING.contains(request.getMethod().toUpperCase(java.util.Locale.ROOT))
                    || exempt(request.getRequestURI())
                    || hasHeader(request)) {
                chain.doFilter(request, response);
                return;
            }
            write(response, HttpServletResponse.SC_FORBIDDEN,
                    ErrorResponse.of("STATE_CHANGE_HEADER_MISSING",
                            "a request that changes state must name itself with "
                                    + STATE_CHANGE_HEADER + "; a session cookie alone is not proof of"
                                    + " where a request came from"));
        }

        private static boolean hasHeader(HttpServletRequest request) {
            String sent = request.getHeader(STATE_CHANGE_HEADER);
            return sent != null && !sent.isBlank();
        }

        private static boolean exempt(String uri) {
            return "/api/v1/auth/register".equals(uri) || "/api/v1/auth/login".equals(uri);
        }
    }
}
