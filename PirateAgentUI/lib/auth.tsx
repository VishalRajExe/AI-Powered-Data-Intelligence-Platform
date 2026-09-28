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

interface WorkspaceInfo {
  id: string;
  name: string;
  slug?: string;
  role?: string;
}

interface UserInfo {
  id: string;
  email: string;
  name: string | null;
}

interface AuthTokensObj {
  accessToken: string;
  refreshToken: string;
}

interface LoginResponse {
  user?: UserInfo;
  id?: string;
  email?: string;
  name?: string | null;
  workspaces?: WorkspaceInfo[];
  workspace?: WorkspaceInfo;
  tokens?: AuthTokensObj;
  accessToken?: string;
  refreshToken?: string;
}

interface MeResponse {
  user?: UserInfo;
  id?: string;
  email?: string;
  name?: string | null;
  workspaces?: WorkspaceInfo[];
  workspace?: WorkspaceInfo;
}

function extractAuthUser(data: LoginResponse | MeResponse): AuthUser {
  const u = data.user ?? {
    id: data.id ?? "",
    email: data.email ?? "",
    name: data.name ?? null,
  };
  const ws = data.workspaces?.[0] ?? data.workspace ?? { id: "", name: "" };
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    workspaceId: ws.id,
    workspaceName: ws.name || null,
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
        setUser(extractAuthUser(me));
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
    const accessToken = res.tokens?.accessToken ?? res.accessToken;
    const refreshToken = res.tokens?.refreshToken ?? res.refreshToken;
    if (accessToken && refreshToken) {
      setTokens(accessToken, refreshToken);
    }
    const authUser = extractAuthUser(res);
    setUser(authUser);
    return authUser;
  }, []);

  // Register ----------------------------------------------------------------
  const register = useCallback(async (email: string, password: string, name?: string) => {
    const res = await api.post<LoginResponse>("/auth/register", { email, password, name });
    const accessToken = res.tokens?.accessToken ?? res.accessToken;
    const refreshToken = res.tokens?.refreshToken ?? res.refreshToken;
    if (accessToken && refreshToken) {
      setTokens(accessToken, refreshToken);
    }
    const authUser = extractAuthUser(res);
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
      setUser(extractAuthUser(me));
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
