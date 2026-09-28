import { Badge } from "@/components/ui/badge";
import { PauseCircle, Circle } from "lucide-react";
import {
  AnchorCheckIcon,
  ShipWheelIcon,
  CompassIcon,
  CrossedAnchorIcon,
} from "@/components/icons";
import type { WorkflowStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

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
