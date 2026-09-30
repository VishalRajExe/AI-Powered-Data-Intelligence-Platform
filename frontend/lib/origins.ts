/**
 * `dataset_columns.origin`, whose four values are the ENUM in `V3__dataset_platform.sql`.
 *
 * A column's origin is the difference between a field the contract asked for and one the data
 * happened to contain, so each state gets its own sentence rather than a binary declared/invented.
 */
const ORIGINS: Record<string, { title: string; declared: boolean }> = {
  PLAN: { title: "declared by the workflow plan", declared: true },
  EXTRACTION_SCHEMA: { title: "declared by the extraction schema", declared: true },
  PIPELINE: { title: "produced by the quality pipeline", declared: false },
  DATA: { title: "found in the records, never declared by the contract", declared: false },
};

export function originTitle(origin?: string): string {
  if (!origin) return "origin unreported";
  return ORIGINS[origin]?.title ?? `origin ${origin}, which this build does not recognise`;
}

export function isDeclared(origin?: string): boolean {
  return origin !== undefined && ORIGINS[origin]?.declared === true;
}
