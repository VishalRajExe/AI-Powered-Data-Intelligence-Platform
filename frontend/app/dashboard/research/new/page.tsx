import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export default function NewResearchPage() {
  return (
    <PhasePlaceholder
      title="New Research"
      featurePhase={14}
      dependsOn={[4, 5]}
      note="Requirement parsing (Phase 4) and plan generation (Phase 5) produce this screen's content. No example prompts, placeholders or predicted field lists are shipped here."
    />
  );
}
