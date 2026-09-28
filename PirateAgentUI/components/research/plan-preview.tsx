"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { X, Plus } from "lucide-react";
import {
  CompassIcon,
  ShipLogIcon,
  SpyglassIcon,
  LighthouseIcon,
  TreasureMapIcon,
} from "@/components/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { STAGE_TEMPLATE } from "@/lib/constants";
import type { DataContract } from "@/lib/types";
import { cn } from "@/lib/utils";

const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.3, ease: "easeOut" as const } }),
};

export function PlanPreview({
  contract,
  onChange,
}: {
  contract: DataContract;
  onChange: (c: DataContract) => void;
}) {
  const [fieldDraft, setFieldDraft] = useState("");

  function removeField(name: string) {
    onChange({ ...contract, fields: contract.fields.filter((f) => f.name !== name) });
  }
  function addField() {
    const name = fieldDraft.trim();
    if (!name) return;
    onChange({ ...contract, fields: [...contract.fields, { name, type: "text", required: false }] });
    setFieldDraft("");
  }
  function removeFilter(f: string) {
    onChange({ ...contract, filters: contract.filters.filter((x) => x !== f) });
  }

  return (
    <div className="space-y-4">
      <motion.div variants={fadeUp} custom={0} initial="hidden" animate="show">
        <Card className="border-border bg-card shadow-subtle">
          <CardContent className="p-5">
            <SectionLabel icon={CompassIcon} text="Detected objective" />
            <p className="mt-2 text-[14.5px] font-medium text-foreground">
              Collect a dataset of <span className="font-semibold text-primary underline underline-offset-4 decoration-tan/50">{contract.entity}</span> records
              {contract.targetCount ? <> — target of <span className="font-semibold text-primary">{contract.targetCount}</span></> : null}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeUp} custom={1} initial="hidden" animate="show">
        <Card className="border-border bg-card shadow-subtle">
          <CardContent className="p-5">
            <SectionLabel icon={ShipLogIcon} text="Fields to collect" />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {contract.fields.map((f) => (
                <span
                  key={f.name}
                  className="group flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[12.5px] font-medium text-foreground"
                >
                  {f.name}
                  <button
                    type="button"
                    onClick={() => removeField(f.name)}
                    className="text-muted-foreground/60 hover:text-danger transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <div className="flex items-center gap-1">
                <Input
                  value={fieldDraft}
                  onChange={(e) => setFieldDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addField()}
                  placeholder="add field"
                  className="h-7 w-24 rounded-full px-2.5 text-[12px] bg-surface border-border text-foreground"
                />
                <button
                  type="button"
                  onClick={addField}
                  className="rounded-full bg-surface border border-border p-1.5 text-muted-foreground hover:text-foreground hover:border-tan transition-colors"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeUp} custom={2} initial="hidden" animate="show">
        <Card className="border-border bg-card shadow-subtle">
          <CardContent className="p-5">
            <SectionLabel icon={SpyglassIcon} text="Filters & constraints" />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {contract.filters.length === 0 && <p className="text-[13px] text-muted-foreground">No specific filters detected.</p>}
              {contract.filters.map((f) => (
                <span key={f} className="flex items-center gap-1.5 rounded-full bg-surface border border-border px-3 py-1 text-[12.5px] font-medium text-foreground">
                  {f}
                  <button type="button" onClick={() => removeFilter(f)} className="text-muted-foreground/60 hover:text-danger transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeUp} custom={3} initial="hidden" animate="show">
        <Card className="border-border bg-card shadow-subtle">
          <CardContent className="p-5">
            <SectionLabel icon={LighthouseIcon} text="Source types" />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {contract.sourceTypes.map((s) => (
                <Badge key={s} variant="default" className="bg-surface text-foreground border-border font-medium">
                  {s}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeUp} custom={4} initial="hidden" animate="show">
        <Card className="border-border bg-card shadow-subtle">
          <CardContent className="p-5">
            <SectionLabel icon={TreasureMapIcon} text="Workflow steps" />
            <ol className="mt-3 space-y-2">
              {STAGE_TEMPLATE.map((s, i) => (
                <li key={s.key} className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-semibold text-foreground")}>
                    {i + 1}
                  </span>
                  <span className="font-medium text-foreground/80">{s.label}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

function SectionLabel({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex items-center gap-2 text-tan">
      <Icon className="h-4 w-4" />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{text}</span>
    </div>
  );
}
