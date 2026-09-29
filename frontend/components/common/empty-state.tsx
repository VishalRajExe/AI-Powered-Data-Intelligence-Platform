import React from "react";
import { Button } from "@/components/ui/button";
import { SailingShipIcon } from "@/components/icons";

export function EmptyState({
  icon: Icon = SailingShipIcon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon?: React.ElementType;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 py-12 px-6 text-center animate-fade-in">
      <div className="mb-3.5 flex h-14 w-14 items-center justify-center rounded-full bg-surface border border-border/80 text-tan">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="font-serif text-[17px] font-bold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground leading-relaxed">
        {description}
      </p>
      {actionLabel && onAction && (
        <Button
          size="sm"
          className="mt-4 bg-primary text-primary-foreground hover:bg-primary-hover font-semibold"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
