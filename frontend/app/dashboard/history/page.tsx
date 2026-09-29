import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export default function HistoryPage() {
  return (
    <PhasePlaceholder
      title="History"
      featurePhase={14}
      dependsOn={[6, 10]}
      note="History replays persisted runs and datasets. Until those exist this page lists nothing, including no sample entries."
    />
  );
}
