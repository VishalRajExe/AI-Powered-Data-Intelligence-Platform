import type { StageState } from "./types";

/**
 * Pipeline stages shown in the workflow checklist and preview.
 * These are UI-only labels — the backend may use different internal names.
 */
export const STAGE_TEMPLATE: { key: StageState["key"]; label: string }[] = [
  { key: "understand", label: "Understand requirement" },
  { key: "discover", label: "Discover permitted sources" },
  { key: "collect", label: "Collect data" },
  { key: "extract", label: "Extract fields" },
  { key: "validate", label: "Validate records" },
  { key: "dedupe", label: "Remove duplicates" },
  { key: "build", label: "Build dataset" },
];

/** Prompt suggestions shown in the dashboard prompt-box. */
export const EXAMPLE_PROMPTS = [
  "Find 200 AI startups in India with founder, website, funding and LinkedIn",
  "List sponsorship opportunities for tech conferences in the US this year",
  "Collect pricing plans for the top 15 project management tools",
  "Find remote frontend job openings posted this month with salary",
];
