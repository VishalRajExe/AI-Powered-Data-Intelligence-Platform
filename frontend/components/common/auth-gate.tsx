"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LighthouseIcon } from "@/components/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";

/**
 * The gate every dashboard route passes through.
 *
 * It decides from `GET /api/v1/auth/me` alone. Nothing here reads storage, a cookie value or a
 * remembered flag, because a page that believes it is signed in when the backend has revoked the
 * session would be a page that then shows an error envelope where a login screen belonged.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status, errorCode, reload } = useAuth();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Checking your session">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[88px] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (status === "anonymous") {
    return (
      <p className="text-[13px] text-muted-foreground">Signing you in…</p>
    );
  }

  if (status === "unreachable") {
    return (
      <Card className="border-danger/40">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="danger">Backend unreachable</Badge>
            <span className="text-[13px] text-muted-foreground">
              <span className="font-mono text-[12px]">GET /api/v1/auth/me</span> returned no answer
              (code <span className="font-mono text-[12px]">{errorCode ?? "UNKNOWN"}</span>). This is
              not a password problem, and nothing on this page is showing cached data.
            </span>
            <Button variant="secondary" size="sm" className="ml-auto" onClick={() => reload()}>
              Retry
            </Button>
          </div>
          <p className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
            <LighthouseIcon className="h-3.5 w-3.5" />
            The status page reads the same two probes without a session and will say whether the
            backend or the proxy is the thing that did not answer.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
