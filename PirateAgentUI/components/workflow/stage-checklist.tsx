"use client";
import { motion } from "framer-motion";
import { Check, XCircle } from "lucide-react";
import {
  CompassIcon,
  LighthouseIcon,
  TreasureChestIcon,
  CargoIcon,
  AnchorCheckIcon,
  TreasureMapIcon,
  ShipLogIcon,
  ShipWheelIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import type { StageState, StageKey } from "@/lib/types";

const STAGE_METAPHOR: Record<StageKey, { icon: React.ElementType }> = {
  understand: { icon: CompassIcon },
  discover: { icon: LighthouseIcon },
  collect: { icon: TreasureChestIcon },
  extract: { icon: CargoIcon },
  validate: { icon: AnchorCheckIcon },
  dedupe: { icon: TreasureMapIcon },
  build: { icon: ShipLogIcon },
};

export function StageChecklist({ stages }: { stages: StageState[] }) {
  return (
    <ol className="space-y-0.5">
      {stages.map((s, i) => {
        const MetaphorIcon = STAGE_METAPHOR[s.key]?.icon || CompassIcon;
        return (
          <li key={s.key} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <StageStatusIcon status={s.status} />
              {i < stages.length - 1 && (
                <span
                  className={cn(
                    "mt-0.5 h-6 w-px",
                    s.status === "done" ? "bg-success/50" : "bg-border"
                  )}
                />
              )}
            </div>
            <div className="flex items-center gap-2 pb-4 text-[13px] leading-[22px] transition-colors">
              <MetaphorIcon
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-colors",
                  s.status === "done" && "text-tan",
                  s.status === "active" && "text-primary",
                  s.status === "pending" && "text-muted-foreground/60",
                  s.status === "error" && "text-danger"
                )}
              />
              <span
                className={cn(
                  s.status === "done" && "text-foreground font-medium",
                  s.status === "active" && "font-semibold text-foreground",
                  s.status === "pending" && "text-muted-foreground",
                  s.status === "error" && "text-danger"
                )}
              >
                {s.label}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StageStatusIcon({ status }: { status: StageState["status"] }) {
  if (status === "done") {
    return (
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex h-5 w-5 items-center justify-center rounded-full bg-success text-white"
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </motion.span>
    );
  }
  if (status === "active") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-info-soft text-info">
        <ShipWheelIcon className="h-3 w-3 animate-spin" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-danger-soft text-danger">
        <XCircle className="h-3.5 w-3.5" />
      </span>
    );
  }
  return <span className="h-5 w-5 rounded-full border-2 border-border/80 bg-surface" />;
}
