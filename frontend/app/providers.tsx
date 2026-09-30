"use client";

import { AuthProvider } from "@/lib/auth";

/**
 * Client-side providers wrapper.
 * Separates client concerns from the server-rendered root layout.
 *
 * The session lives in an `HttpOnly` cookie, so this provider caches what `/auth/me` returns and
 * nothing more — there is no token here to hold, and no storage to hold it in.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>{children}</AuthProvider>
  );
}
