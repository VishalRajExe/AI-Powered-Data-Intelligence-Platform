"use client";

import { AuthProvider } from "@/lib/auth";

/**
 * Client-side providers wrapper.
 * Separates client concerns from the server-rendered root layout.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
