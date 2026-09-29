"use client";

/**
 * Client-side providers wrapper.
 * Separates client concerns from the server-rendered root layout.
 *
 * The old project's AuthProvider (localStorage-held tokens) is intentionally absent:
 * authentication arrives in Phase 3 against httpOnly cookies, not client storage.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
