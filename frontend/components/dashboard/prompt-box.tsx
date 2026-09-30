"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { SpyglassIcon, CompassIcon } from "@/components/icons";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { EXAMPLE_PROMPTS } from "@/lib/constants";

export function PromptBox() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function run(promptOverride?: string) {
    const prompt = promptOverride ?? value;
    if (!prompt.trim()) return;
    router.push(`/dashboard/research/new?prompt=${encodeURIComponent(prompt.trim())}`);
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-6 shadow-subtle md:p-8">
      {/* Extremely subtle ambient compass watermark in background */}
      <div className="pointer-events-none absolute -right-6 -top-6 text-foreground/[0.03]">
        <CompassIcon className="h-44 w-44" strokeWidth={1} />
      </div>

      <div className="relative z-10">
        {/* Section Badge with subtle spyglass */}
        <div className="mb-2 flex items-center gap-2 text-tan">
          <SpyglassIcon className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            NEW RESEARCH
          </span>
        </div>

        {/* Editorial Heading */}
        <h2 className="font-serif text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          Tell us what data you need.
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
          Describe your mission in plain English — PirateAgent will plan the research and collect the data for you.
        </p>

        <div className="mt-5">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Find 200 AI startups in India with founder, website, funding and LinkedIn..."
            rows={3}
            className="text-[14px] bg-surface/50 border-border text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary/40 focus-visible:border-primary shadow-inner"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
            }}
          />

          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
            {/* Mission suggestions */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] font-medium text-muted-foreground/80 hidden sm:inline mr-1">
                Suggestions:
              </span>
              {EXAMPLE_PROMPTS.slice(0, 2).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setValue(p)}
                  className="rounded-full border border-border/80 bg-surface/70 px-3 py-1 text-[12px] text-muted-foreground transition-all hover:border-tan hover:bg-surface hover:text-foreground"
                >
                  {p.length > 46 ? p.slice(0, 46) + "…" : p}
                </button>
              ))}
            </div>

            {/* Primary Action Button */}
            <Button
              onClick={() => run()}
              size="default"
              className="bg-primary text-primary-foreground hover:bg-primary-hover font-semibold tracking-wide shadow-subtle gap-2 px-5"
            >
              START RESEARCH <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
