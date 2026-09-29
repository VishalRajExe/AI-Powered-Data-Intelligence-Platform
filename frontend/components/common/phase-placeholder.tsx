import Link from "next/link";
import { EmptyState } from "@/components/common/empty-state";
import { CompassIcon } from "@/components/icons";

/**
 * Honest stand-in for a screen whose data does not exist yet.
 * Renders no numbers, counts, lists or statuses — only what is actually true.
 */
export function PhasePlaceholder({
  title,
  featurePhase,
  dependsOn,
  note,
  links = [],
}: {
  title: string;
  /** Phase in which this screen is wired up (see docs/audit/M-phase-plan.md). */
  featurePhase: number;
  /** Backend phases this screen cannot work without. */
  dependsOn?: number[];
  note?: string;
  links?: { href: string; label: string }[];
}) {
  return (
    <div className="space-y-6 animate-fade-in">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground md:text-[28px]">
          {title}
        </h1>
        <p className="text-[13px] text-muted-foreground">
          Phase {featurePhase} skeleton — no data is shown here until the backend supplies it.
        </p>
      </header>

      <EmptyState
        icon={CompassIcon}
        title="Not implemented"
        description={`This screen arrives in Phase ${featurePhase}${
          dependsOn?.length ? `, once Phase ${dependsOn.join(" and Phase ")} provide its endpoints` : ""
        }. Until then it renders nothing rather than sample data.`}
      />

      {note && (
        <p className="text-[12px] leading-relaxed text-muted-foreground/90">{note}</p>
      )}

      {links.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted/40"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
