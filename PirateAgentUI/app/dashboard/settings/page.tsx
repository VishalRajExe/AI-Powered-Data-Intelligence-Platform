"use client";
import { useState } from "react";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { NauticalInstrumentIcon } from "@/components/icons";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const THEMES = [
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
  { key: "system", label: "System", icon: Monitor },
] as const;

function getInitials(name: string | null | undefined): string {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState<(typeof THEMES)[number]["key"]>("light");
  const [defaultSourceCap, setDefaultSourceCap] = useState("50");
  const [autoDedupe, setAutoDedupe] = useState(true);

  const displayName = user?.name ?? user?.email ?? "User";
  const displayEmail = user?.email ?? "";
  const initials = getInitials(user?.name) || getInitials(user?.email);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="flex items-center gap-2 text-tan mb-1">
          <NauticalInstrumentIcon className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            NAVIGATOR SETTINGS
          </span>
        </div>
        <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          Settings
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Manage your captain profile and research automation parameters.
        </p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="bg-surface border-border">
          <TabsTrigger value="profile" className="text-xs font-semibold">Profile</TabsTrigger>
          <TabsTrigger value="appearance" className="text-xs font-semibold">Appearance</TabsTrigger>
          <TabsTrigger value="preferences" className="text-xs font-semibold">Preferences</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card className="border-border bg-card shadow-subtle">
            <CardContent className="space-y-5 p-5">
              <div className="flex items-center gap-4">
                <Avatar className="h-14 w-14 border border-border bg-surface">
                  <AvatarFallback className="text-base font-serif font-bold text-foreground">{initials}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-[15px] text-foreground">{displayName}</p>
                  <p className="text-[12.5px] text-muted-foreground">{displayEmail}</p>
                </div>
              </div>
              <Separator className="bg-border/60" />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="fullname" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Full name</Label>
                  <Input id="fullname" defaultValue={user?.name ?? ""} className="bg-surface/50 border-border text-foreground" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</Label>
                  <Input id="email" type="email" defaultValue={user?.email ?? ""} className="bg-surface/50 border-border text-foreground" />
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary-hover font-semibold">
                  Save changes
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => logout()}
                  className="text-danger hover:bg-danger-soft hover:text-danger hover:border-danger/30 font-medium"
                >
                  Sign out
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance">
          <Card className="border-border bg-card shadow-subtle">
            <CardContent className="p-5">
              <p className="mb-3 text-[13px] font-semibold text-foreground">Theme Palette</p>
              <div className="grid grid-cols-3 gap-3">
                {THEMES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTheme(t.key)}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-lg border p-4 transition-all",
                      theme === t.key
                        ? "border-tan bg-surface text-foreground shadow-xs font-semibold"
                        : "border-border bg-card/60 text-muted-foreground hover:bg-surface"
                    )}
                  >
                    <t.icon className={cn("h-4.5 w-4.5", theme === t.key ? "text-tan" : "text-muted-foreground")} />
                    <span className="flex items-center gap-1 text-[12.5px]">
                      {t.label}
                      {theme === t.key && <Check className="h-3 w-3 text-tan" />}
                    </span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preferences">
          <Card className="border-border bg-card shadow-subtle">
            <CardContent className="space-y-5 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13.5px] font-semibold text-foreground">Auto-remove duplicates</p>
                  <p className="text-[12.5px] text-muted-foreground">Automatically merge near-duplicate records during collection.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoDedupe((v) => !v)}
                  className={cn(
                    "relative h-6 w-11 shrink-0 rounded-full transition-colors border border-border",
                    autoDedupe ? "bg-primary" : "bg-surface"
                  )}
                >
                  <span
                    className={cn(
                      "block h-4.5 w-4.5 rounded-full bg-card shadow-subtle transition-transform",
                      autoDedupe ? "translate-x-5.5" : "translate-x-0.5"
                    )}
                  />
                </button>
              </div>
              <Separator className="bg-border/60" />
              <div className="space-y-1.5">
                <Label htmlFor="cap" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Default source cap per workflow</Label>
                <Input
                  id="cap"
                  type="number"
                  value={defaultSourceCap}
                  onChange={(e) => setDefaultSourceCap(e.target.value)}
                  className="max-w-[140px] bg-surface/50 border-border text-foreground"
                />
                <p className="text-[12px] text-muted-foreground">Maximum number of sources a new workflow will check by default.</p>
              </div>
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary-hover font-semibold">
                Save preferences
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
