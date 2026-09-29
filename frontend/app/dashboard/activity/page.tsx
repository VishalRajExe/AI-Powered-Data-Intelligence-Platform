import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export default function ActivityPage() {
  return (
    <PhasePlaceholder
      title="Activity"
      featurePhase={14}
      dependsOn={[12]}
      note="Activity events and their SSE stream land in Phase 12. The old screen derived this by looping over every run client-side; that aggregation is not reproduced."
    />
  );
}
