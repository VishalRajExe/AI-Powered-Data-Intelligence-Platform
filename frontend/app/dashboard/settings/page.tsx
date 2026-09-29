import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export default function SettingsPage() {
  return (
    <PhasePlaceholder
      title="Settings"
      featurePhase={14}
      dependsOn={[3]}
      note="Authentication and tenancy arrive in Phase 3 and preference persistence with them. The previous settings screen was fully fake (a theme picker that applied nothing and save buttons with no handler), so nothing is carried over."
    />
  );
}
