import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export default function SourcesPage() {
  return (
    <PhasePlaceholder
      title="Sources"
      featurePhase={14}
      dependsOn={[7, 11]}
      note="The source list is governance data produced in Phase 7 and explained by provenance in Phase 11. A global /sources endpoint is also required — the old screen faked it by fetching every dataset client-side."
    />
  );
}
