"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { auth, type Credentials, type Registration } from "@/lib/api/endpoints";
import type { AuthSession, AuthUser, AuthWorkspace } from "@/lib/api/types";

/**
 * The session, read from the server and never from storage.
 *
 * The credential is an `HttpOnly` cookie the backend set, so this provider holds only what
 * `GET /api/v1/auth/me` says about it. There is nothing here to persist: refreshing the page re-asks
 * the backend, and a session the backend has revoked produces `anonymous` on the next load rather
 * than a page that still looks signed in.
 */

export type AuthStatus = "loading" | "authenticated" | "anonymous" | "unreachable";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  workspace: AuthWorkspace | null;
  session: AuthSession | null;
  /** True only when the workspace role may start work, request an export or cancel a run. */
  canWrite: boolean;
  /** The code of the failure that produced `anonymous`/`unreachable`, so a screen can name it. */
  errorCode: string | null;
  login: (credentials: Credentials) => Promise<void>;
  register: (body: Registration) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-reads `/auth/me`, e.g. after a data call turns out to be against a dead session. */
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [who, setWho] = useState<{ user: AuthUser; workspace: AuthWorkspace; session: AuthSession } | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const renewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const me = await auth.me();
      setWho({ user: me.user, workspace: me.workspace, session: me.session });
      setErrorCode(null);
      setStatus("authenticated");
    } catch (cause) {
      setWho(null);
      if (cause instanceof ApiError && cause.status === 0) {
        // Nothing answered. Reporting that as "signed out" would hide a dead backend behind a login
        // screen, which is how an outage gets diagnosed as a password problem.
        setErrorCode(cause.code);
        setStatus("unreachable");
        return;
      }
      setErrorCode(cause instanceof ApiError ? cause.code : "UNKNOWN_ERROR");
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Renew before the deadline rather than after it. The TTLs come from the backend's own response,
  // so a deployment that changes them changes this interval without a code edit.
  useEffect(() => {
    if (renewTimer.current) clearTimeout(renewTimer.current);
    if (status !== "authenticated" || !who) return;
    const ms = (who.session.accessTokenTtlMinutes - 2) * 60_000;
    if (ms <= 0) return;
    renewTimer.current = setTimeout(async () => {
      try {
        await auth.refresh();
      } catch {
        // A refused renewal is exactly the fact `/auth/me` is about to report.
      }
      load();
    }, ms);
    return () => {
      if (renewTimer.current) clearTimeout(renewTimer.current);
    };
  }, [status, who, load]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: who?.user ?? null,
      workspace: who?.workspace ?? null,
      session: who?.session ?? null,
      canWrite: who?.workspace.canWrite ?? false,
      errorCode,
      login: async (credentials) => {
        const result = await auth.login(credentials);
        setWho({ user: result.user, workspace: result.workspace, session: result.session });
        setStatus("authenticated");
      },
      register: async (body) => {
        const result = await auth.register(body);
        setWho({ user: result.user, workspace: result.workspace, session: result.session });
        setStatus("authenticated");
      },
      logout: async () => {
        try {
          await auth.logout();
        } finally {
          setWho(null);
          setErrorCode("AUTHENTICATION_REQUIRED");
          setStatus("anonymous");
        }
      },
      reload: load,
    }),
    [status, who, errorCode, load]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}

/** The message to show for a failure: the backend's own code and sentence, never a generic guess. */
export function describeApiError(cause: unknown): string {
  if (cause instanceof ApiError) {
    const message = cause.message;
    return cause.code === "NETWORK"
      ? `${message} The backend did not answer, so no data is being shown.`
      : `${cause.code}: ${message}`;
  }
  return cause instanceof Error ? cause.message : "Unexpected failure.";
}
