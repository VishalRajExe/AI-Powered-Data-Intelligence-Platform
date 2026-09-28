"use client";
import { Bell, User, LogOut, Settings as SettingsIcon } from "lucide-react";
import { SpyglassIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

function getInitials(name: string | null | undefined): string {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function Topbar({ title }: { title?: string }) {
  const router = useRouter();
  const { user, logout } = useAuth();

  const displayName = user?.name ?? user?.email ?? "User";
  const displayEmail = user?.email ?? "";
  const initials = getInitials(user?.name) || getInitials(user?.email);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border bg-surface/80 backdrop-blur-md px-4 md:px-6">
      <div className="min-w-0">
        {title && (
          <h1 className="truncate font-serif text-lg font-bold tracking-tight text-foreground">
            {title}
          </h1>
        )}
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
        {/* Search Field with Spyglass icon */}
        <div className="relative hidden sm:block w-full max-w-xs">
          <SpyglassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search missions, datasets…"
            className="h-8 pl-8 text-[13px] bg-card border-border/80 text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary/40 focus-visible:border-primary"
          />
        </div>

        {/* Notification Bell */}
        <button
          aria-label="Notifications"
          className="relative rounded-md p-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-tan" />
        </button>

        {/* User Profile */}
        <DropdownMenu>
          <DropdownMenuTrigger className="outline-none">
            <Avatar className="h-8 w-8 cursor-pointer border border-border bg-card">
              <AvatarFallback className="bg-card text-foreground text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-card border-border shadow-md">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-foreground font-semibold">{displayName}</span>
                <span className="font-normal text-muted-foreground text-xs">{displayEmail}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-border/60" />
            <DropdownMenuItem onClick={() => router.push("/dashboard/settings")} className="cursor-pointer hover:bg-muted/50">
              <User className="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/dashboard/settings")} className="cursor-pointer hover:bg-muted/50">
              <SettingsIcon className="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border/60" />
            <DropdownMenuItem onClick={() => logout()} className="cursor-pointer text-danger focus:bg-danger-soft hover:bg-danger-soft">
              <LogOut className="h-3.5 w-3.5 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
