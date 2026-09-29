import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export default function DatasetsPage() {
  return (
    <PhasePlaceholder
      title="Datasets"
      featurePhase={14}
      dependsOn={[10]}
      note="Datasets become queryable in Phase 10. Row counts, column names and sample records are not displayed beforehand."
    />
  );
}
