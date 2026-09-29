import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export default function WorkflowsPage() {
  return (
    <PhasePlaceholder
      title="Workflows"
      featurePhase={14}
      dependsOn={[5, 6]}
      note="Workflow listings need persisted plans (Phase 5) and the MySQL job engine (Phase 6). Nothing is listed until then."
    />
  );
}
