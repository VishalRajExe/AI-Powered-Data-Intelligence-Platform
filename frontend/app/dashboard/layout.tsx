import { Sidebar } from "@/components/layout/sidebar";
import { CompassIcon } from "@/components/icons";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen bg-background text-foreground antialiased selection:bg-tan/20">
      {/* Extremely subtle ambient watermark in bottom right corner (barely visible 2% opacity) */}
      <div className="pointer-events-none fixed -bottom-24 -right-24 z-0 text-foreground/[0.025] select-none">
        <CompassIcon className="h-96 w-96" strokeWidth={0.75} />
      </div>

      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* The old Topbar is deliberately absent: its search field and notification bell were
            decorative with no data behind them. It returns in Phase 14 wired to real endpoints. */}
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
