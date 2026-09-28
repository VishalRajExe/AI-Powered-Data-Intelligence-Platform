"use client";
import {
  CargoIcon,
  AnchorCheckIcon,
  TreasureMapIcon,
  LighthouseIcon,
} from "@/components/icons";
import { useCountUp } from "@/hooks/use-count-up";
import { formatNumber } from "@/lib/utils";

export function LiveStats({
  recordsFound,
  validRecords,
  duplicates,
  sourcesProcessed,
  sourcesTotal,
}: {
  recordsFound: number;
  validRecords: number;
  duplicates: number;
  sourcesProcessed: number;
  sourcesTotal: number;
}) {
  const tiles = [
    { icon: CargoIcon, label: "Records found", value: useCountUp(recordsFound), tone: "text-foreground" },
    { icon: AnchorCheckIcon, label: "Valid records", value: useCountUp(validRecords), tone: "text-success" },
    { icon: TreasureMapIcon, label: "Duplicates removed", value: useCountUp(duplicates), tone: "text-warning" },
    { icon: LighthouseIcon, label: "Sources processed", value: useCountUp(sourcesProcessed), tone: "text-info", suffix: `/${sourcesTotal}` },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-border bg-card p-3.5 shadow-xs">
          <t.icon className={`h-4 w-4 ${t.tone}`} />
          <p className={`mt-2 font-serif text-xl font-bold leading-none ${t.tone}`}>
            {formatNumber(t.value)}
            {t.suffix ?? ""}
          </p>
          <p className="mt-1 text-[11.5px] font-medium text-muted-foreground">{t.label}</p>
        </div>
      ))}
    </div>
  );
}
