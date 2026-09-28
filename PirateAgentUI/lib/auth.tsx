"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { api, ApiError, setTokens, clearTokens, getAccessToken } from "./api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  workspaceId: string;
  workspaceName: string | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /** Login and store tokens. Returns user on success. */
  login: (email: string, password: string) => Promise<AuthUser>;
  /** Register, login, and store tokens. Returns user on success. */
  register: (email: string, password: string, name?: string) => Promise<AuthUser>;
  /** Logout and clear tokens. */
  logout: () => Promise<void>;
  /** Refresh user data from /auth/me. */
  refreshUser: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthState | undefined>(undefined);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Response shapes from the backend
// ---------------------------------------------------------------------------

interface LoginResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  workspace: {
    id: string;
    name: string;
  };
  accessToken: string;
  refreshToken: string;
}

interface MeResponse {
  id: string;
  email: string;
  name: string | null;
  workspace: {
    id: string;
    name: string;
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Routes that don't require authentication. */
const PUBLIC_ROUTES = ["/", "/login", "/signup"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Hydrate user from stored token on mount
  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }

    api
      .get<MeResponse>("/auth/me")
      .then((me) => {
        setUser({
          id: me.id,
          email: me.email,
          name: me.name,
          workspaceId: me.workspace.id,
          workspaceName: me.workspace.name,
        });
      })
      .catch(() => {
        clearTokens();
      })
      .finally(() => setLoading(false));
  }, []);

  // Route protection: redirect to /login if not authenticated
  useEffect(() => {
    if (loading) return;
    const isPublic = PUBLIC_ROUTES.some(
      (r) => pathname === r || pathname?.startsWith("/(auth)"),
    );
    if (!user && !isPublic && pathname?.startsWith("/dashboard")) {
      router.replace("/login");
    }
  }, [user, loading, pathname, router]);

  // Login -------------------------------------------------------------------
  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<LoginResponse>("/auth/login", { email, password });
    setTokens(res.accessToken, res.refreshToken);
    const authUser: AuthUser = {
      id: res.user.id,
      email: res.user.email,
      name: res.user.name,
      workspaceId: res.workspace.id,
      workspaceName: res.workspace.name,
    };
    setUser(authUser);
    return authUser;
  }, []);

  // Register ----------------------------------------------------------------
  const register = useCallback(async (email: string, password: string, name?: string) => {
    const res = await api.post<LoginResponse>("/auth/register", { email, password, name });
    setTokens(res.accessToken, res.refreshToken);
    const authUser: AuthUser = {
      id: res.user.id,
      email: res.user.email,
      name: res.user.name,
      workspaceId: res.workspace.id,
      workspaceName: res.workspace.name,
    };
    setUser(authUser);
    return authUser;
  }, []);

  // Logout ------------------------------------------------------------------
  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout", {});
    } catch {
      // Ignore logout errors
    }
    clearTokens();
    setUser(null);
    router.replace("/login");
  }, [router]);

  // Refresh user info -------------------------------------------------------
  const refreshUser = useCallback(async () => {
    try {
      const me = await api.get<MeResponse>("/auth/me");
      setUser({
        id: me.id,
        email: me.email,
        name: me.name,
        workspaceId: me.workspace.id,
        workspaceName: me.workspace.name,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearTokens();
        setUser(null);
      }
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout, refreshUser }),
    [user, loading, login, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
