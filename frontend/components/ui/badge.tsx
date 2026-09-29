import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium border transition-colors",
  {
    variants: {
      variant: {
        default: "bg-surface text-muted-foreground border-border/80",
        primary: "bg-surface text-foreground border-border font-semibold",
        success: "bg-success-soft text-success border-success/25 font-semibold",
        warning: "bg-warning-soft text-warning border-warning/25 font-semibold",
        danger: "bg-danger-soft text-danger border-danger/25 font-semibold",
        info: "bg-info-soft text-info border-info/25 font-semibold",
        outline: "border-border text-foreground bg-transparent",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
