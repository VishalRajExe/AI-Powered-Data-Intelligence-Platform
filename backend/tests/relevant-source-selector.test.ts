import { describe, expect, it } from "vitest";
import type { WorkflowPlan } from "../src/modules/planner/workflow-plan.schema.js";
import { RelevantSourceSelector } from "../src/modules/sources/RelevantSourceSelector.js";

const plan = {
  searchStrategy: {
    queries: [
      { query: "Indian AI startup funding", sourceType: "research", rationale: "Find relevant company sources." },
      { query: "AI startup India company funding", sourceType: "official_website", rationale: "Cross-check company records." },
    ],
    maximumSourceCount: 3,
  },
  sourcePolicy: { preferredDomains: ["startupindia.gov.in"] },
} as unknown as WorkflowPlan;

describe("RelevantSourceSelector", () => {
  it("ranks relevant title/snippet matches, removes normalized URL duplicates, and prioritizes preferred domains", () => {
    const sources = [
      { url: "https://misc.example/travel", title: "Travel blog", snippet: "A guide to Indian beaches" },
      { url: "https://startupindia.gov.in/directory?utm_source=search", title: "Indian AI startup funding directory", snippet: "Company profiles and funding information" },
      { url: "https://news.example/ai-startups", title: "AI startups in India", snippet: "Funding rounds and startup company news" },
      { url: "https://research.example/market", title: "Indian AI startup funding research", snippet: "Research of startups and investment in India" },
      { url: "https://startupindia.gov.in/directory#results", title: "Duplicate listing", snippet: "Same page" },
      { url: "https://other.example/finance", title: "Banking products", snippet: "Personal finance and loans" },
    ];
    const selected = new RelevantSourceSelector().rank(sources, plan);
    expect(selected).toHaveLength(3);
    expect(selected[0]?.url).toContain("startupindia.gov.in");
    expect(selected.some(({ url }) => url.includes("travel"))).toBe(false);
    expect(new Set(selected.map(({ url }) => url.split("?")[0]?.split("#")[0])).size).toBe(3);
  });

  it("handles empty queries by preserving useful search order and respects the source limit", () => {
    const noQueryPlan = { ...plan, searchStrategy: { ...plan.searchStrategy, queries: [], maximumSourceCount: 2 } } as WorkflowPlan;
    const sources = [
      { url: "https://one.example/a", title: "", snippet: "" },
      { url: "https://two.example/b", title: "", snippet: "" },
      { url: "https://three.example/c", title: "", snippet: "" },
    ];
    expect(new RelevantSourceSelector().rank(sources, noQueryPlan)).toEqual(sources.slice(0, 2));
  });
});
