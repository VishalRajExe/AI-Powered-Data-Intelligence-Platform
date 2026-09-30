"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ApiError } from "@/lib/api/client";

/**
 * A read that failed, in the backend's own words.
 *
 * The code is shown next to the sentence because the two are different facts: the code is what the
 * endpoint branched on (`AI_SERVICE_UNAVAILABLE` and `WORKSPACE_WRITE_FORBIDDEN` call for different
 * next steps from the person reading them), and the sentence is what the backend chose to say.
 */
export function ReadError({ error, onRetry, label }: { error: ApiError; onRetry?: () => void; label: string }) {
  const unreachable = error.status === 0;
  return (
    <Card className={unreachable ? "border-danger/40" : "border-warning/40"}>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={unreachable ? "danger" : "warning"}>{label}</Badge>
          <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-foreground">
            <span className="font-mono text-[12px] text-muted-foreground">{error.code}</span>
            {" — "}
            {error.message}
            {error.path && (
              <>
                {" "}
                <span className="font-mono text-[12px] text-muted-foreground/80">({error.path})</span>
              </>
            )}
          </span>
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          No figures are substituted for this read. A card that showed an estimate while its endpoint
          was failing would be indistinguishable from one that showed the truth.
        </p>
      </CardContent>
    </Card>
  );
}
