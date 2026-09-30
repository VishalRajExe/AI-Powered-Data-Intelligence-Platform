"use client";

import { useState } from "react";
import Link from "next/link";
import { NauticalInstrumentIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ReadError } from "@/components/common/read-error";
import { auth } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";

/**
 * The account, the workspace it belongs to, and the session that connects them.
 *
 * There are no theme, notification or default-column pickers here. The previous screen shipped them
 * with no handler behind any of them, and nothing in this API persists a preference yet, so a control
 * that changed nothing would be the same fabrication in a nicer frame.
 */
export default function SettingsPage() {
  const { user, workspace, session, logout, reload, errorCode } = useAuth();
  const [busy, setBusy] = useState<"renew" | "logout" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function renew() {
    setBusy("renew");
    setError(null);
    try {
      await auth.refresh();
      await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError(String(cause), { code: "UNEXPECTED" }));
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    setBusy("logout");
    try {
      await logout();
    } finally {
      setBusy(null);
    }
  }

  if (!user) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No session to describe. {errorCode ? <span className="font-mono text-[12px]">{errorCode}</span> : null}
      </p>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 font-serif text-2xl font-bold tracking-tight text-foreground md:text-[28px]">
          <NauticalInstrumentIcon className="h-6 w-6 text-primary" />
          Settings
        </h1>
        <p className="text-[13px] text-muted-foreground">
          Read from <span className="font-mono text-[12px]">GET /api/v1/auth/me</span> — the same
          endpoint every other screen is authorised by.
        </p>
      </header>

      {error && <ReadError error={error} label="Renewal refused" onRetry={renew} />}

      <div className="grid gap-5 md:grid-cols-2">
        <Card className="border-border bg-card shadow-subtle">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg font-bold tracking-tight">Account</CardTitle>
            <CardDescription className="text-[12px]">
              The row the backend matched against your session cookie.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Name" value={user.displayName} />
            <Separator />
            <Row label="Email" value={user.email} />
            <Separator />
            <Row label="Status">
              <Badge variant={user.status === "ACTIVE" ? "success" : "warning"}>{user.status}</Badge>
            </Row>
            <Separator />
            <Row
              label="Last login"
              value={user.lastLoginAt ? formatDate(user.lastLoginAt) : "not recorded"}
            />
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-subtle">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg font-bold tracking-tight">Workspace</CardTitle>
            <CardDescription className="text-[12px]">
              Every read and write on this app is scoped to it, and it is never taken from a request
              parameter.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Name" value={workspace?.name ?? "unreported"} />
            <Separator />
            <Row label="Kind" value={workspace?.kind ?? "unreported"} />
            <Separator />
            <Row label="ID" value={workspace?.id} mono />
            <Separator />
            <Row label="Role" value={workspace?.role} />
            <Separator />
            <Row label="May start work">
              <Badge variant={workspace?.canWrite ? "success" : "default"}>
                {workspace?.canWrite ? "yes — EDITOR or OWNER" : "no — read only"}
              </Badge>
            </Row>
            <Separator />
            <Row label="Owner">{workspace?.isOwner ? "yes" : "no"}</Row>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-subtle">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg font-bold tracking-tight">Session</CardTitle>
            <CardDescription className="text-[12px]">
              An opaque value stored hashed in MySQL and delivered as an{" "}
              <span className="font-mono text-[11.5px]">HttpOnly</span> cookie. It is never in a
              response body, so nothing here can show it to you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row
              label="Access lifetime"
              value={session ? `${session.accessTokenTtlMinutes} minutes` : "unreported"}
            />
            <Separator />
            <Row label="Absolute ceiling" value={session ? `${session.refreshTtlDays} days` : "unreported"} />
            <Separator />
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" loading={busy === "renew"} onClick={renew}>
                Renew now
              </Button>
              <Button
                variant="destructive"
                size="sm"
                loading={busy === "logout"}
                onClick={signOut}
              >
                Sign out
              </Button>
            </div>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Renewing issues a new credential for the same family and retires the one in your cookie.
              Replaying a retired value revokes the whole family, which is how a stolen session gets
              closed rather than quietly extended.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-subtle">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg font-bold tracking-tight">Platform</CardTitle>
            <CardDescription className="text-[12px]">
              Configuration is the deployment&apos;s, not a user setting.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Backend probes" value="health and readiness, without a session" />
            <Separator />
            <Link
              href="/dashboard/status"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:border-tan"
            >
              Open Backend Status
            </Link>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              MySQL reachability, the AI service as the backend sees it, and the credential check all
              report themselves there. This screen has no field that would override any of them.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children ?? (
        <span
          className={`text-[13px] text-foreground ${mono ? "font-mono text-[12px] break-all" : ""} ${
            value ? "" : "italic text-muted-foreground/70"
          }`}
        >
          {value ?? "unreported"}
        </span>
      )}
    </div>
  );
}
