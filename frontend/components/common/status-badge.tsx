import { Badge } from "@/components/ui/badge";
import { PauseCircle, Circle } from "lucide-react";
import {
  AnchorCheckIcon,
  ShipWheelIcon,
  CompassIcon,
  CrossedAnchorIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";

// Mirrors the workflow status vocabulary the backend will expose (Phase 5+).
// Declared locally because the old shared `lib/types.ts` was not carried over.
export type WorkflowStatus = "planning" | "running" | "completed" | "failed" | "paused";

const CONFIG: Record<
  WorkflowStatus,
  {
    label: string;
    variant: "success" | "info" | "danger" | "warning" | "default";
    icon: React.ElementType;
    spin?: boolean;
  }
> = {
  completed: { label: "Completed", variant: "success", icon: AnchorCheckIcon },
  running: { label: "Running", variant: "info", icon: ShipWheelIcon, spin: true },
  planning: { label: "Planning", variant: "info", icon: CompassIcon, spin: true },
  failed: { label: "Failed", variant: "danger", icon: CrossedAnchorIcon },
  paused: { label: "Paused", variant: "warning", icon: PauseCircle },
};

export function StatusBadge({ status, className }: { status: WorkflowStatus; className?: string }) {
  const c = CONFIG[status] ?? { label: status, variant: "default" as const, icon: Circle };
  const Icon = c.icon;
  return (
    <Badge variant={c.variant} className={cn(className)}>
      <Icon className={cn("h-3 w-3 shrink-0", c.spin && "animate-spin")} />
      <span>{c.label}</span>
    </Badge>
  );
}
