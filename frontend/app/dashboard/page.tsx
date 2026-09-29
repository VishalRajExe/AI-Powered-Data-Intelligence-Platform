import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export default function DashboardHomePage() {
  return (
    <PhasePlaceholder
      title="Dashboard"
      featurePhase={14}
      dependsOn={[5, 10, 12]}
      links={[{ href: "/dashboard/status", label: "Open Backend Status (live in Phase 1)" }]}
      note="The overview aggregates run, dataset and activity counts from the backend; none of those endpoints exist yet, so this page shows no figures."
    />
  );
}
