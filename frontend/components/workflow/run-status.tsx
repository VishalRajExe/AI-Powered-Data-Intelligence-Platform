import { Badge } from "@/components/ui/badge";
import {
  AnchorCheckIcon,
  CompassIcon,
  CrossedAnchorIcon,
  ShipWheelIcon,
  SailingShipIcon,
  AnchorIcon,
} from "@/components/icons";

/** The seven states a run's row can hold, with the badge each one earns. */
const CONFIG: Record<string, { variant: "success" | "info" | "danger" | "warning" | "default"; icon: React.ElementType; spin?: boolean }> = {
  PENDING: { variant: "default", icon: AnchorIcon },
  PLANNING: { variant: "info", icon: CompassIcon, spin: true },
  RUNNING: { variant: "info", icon: ShipWheelIcon, spin: true },
  COMPLETED: { variant: "success", icon: AnchorCheckIcon },
  PARTIAL: { variant: "warning", icon: SailingShipIcon },
  FAILED: { variant: "danger", icon: CrossedAnchorIcon },
  CANCELLED: { variant: "default", icon: CrossedAnchorIcon },
};

/**
 * A run's persisted status, verbatim.
 *
 * An unrecognised value still renders — as a plain badge with the backend's own word — rather than
 * being snapped to the nearest known state. A new enum value in MySQL should surprise this screen,
 * not be hidden by it.
 */
export function RunStatusBadge({ status }: { status: string }) {
  const c = CONFIG[status] ?? { variant: "default" as const, icon: AnchorIcon };
  const Icon = c.icon;
  return (
    <Badge variant={c.variant}>
      <Icon className={c.spin ? "h-3 w-3 shrink-0 animate-spin" : "h-3 w-3 shrink-0"} />
      <span>{status}</span>
    </Badge>
  );
}
