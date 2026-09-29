"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/common/logo";
import {
  CompassIcon,
  SpyglassIcon,
  TreasureMapIcon,
  ShipLogIcon,
  LighthouseIcon,
  HistoryScrollIcon,
  ShipWheelIcon,
  NauticalInstrumentIcon,
} from "@/components/icons";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: CompassIcon },
  { href: "/dashboard/research/new", label: "New Research", icon: SpyglassIcon },
  { href: "/dashboard/workflows", label: "Workflows", icon: TreasureMapIcon },
  { href: "/dashboard/datasets", label: "Datasets", icon: ShipLogIcon },
  { href: "/dashboard/sources", label: "Sources", icon: LighthouseIcon },
  { href: "/dashboard/history", label: "History", icon: HistoryScrollIcon },
  { href: "/dashboard/activity", label: "Activity", icon: ShipWheelIcon },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex h-screen w-60 shrink-0 flex-col border-r border-border bg-surface select-none">
      {/* Brand Header */}
      <div className="flex h-14 items-center gap-2.5 px-5 border-b border-border/60">
        <Link href="/" className="flex items-center gap-2.5 group">
          <Logo className="h-7 w-7 transition-transform group-hover:scale-105" />
          <span className="font-serif text-[16px] font-bold tracking-wider text-foreground">
            PIRATEAGENT
          </span>
        </Link>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-3 overflow-y-auto">
        {NAV.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname?.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-all",
                active
                  ? "bg-card text-foreground font-semibold border border-border/80 shadow-xs"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground font-medium border border-transparent"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Settings Navigation */}
      <div className="px-3 pb-3 pt-2 border-t border-border/60">
        <Link
          href="/dashboard/settings"
          className={cn(
            "group flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-all",
            pathname?.startsWith("/dashboard/settings")
              ? "bg-card text-foreground font-semibold border border-border/80 shadow-xs"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground font-medium border border-transparent"
          )}
        >
          <NauticalInstrumentIcon
            className={cn(
              "h-4 w-4 shrink-0 transition-colors",
              pathname?.startsWith("/dashboard/settings")
                ? "text-primary"
                : "text-muted-foreground group-hover:text-foreground"
            )}
          />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
