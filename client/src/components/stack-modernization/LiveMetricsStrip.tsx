/**
 * Live metrics strip for Stack Modernization - risk, compatibility, files, current step.
 */

import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, FileCode2, Package } from "lucide-react";

export interface LiveMetricsStripProps {
  /** Current stage message from backend */
  currentStage?: string | null;
  /** overallRisk: low | medium | high | critical */
  overallRisk?: string | null;
  /** Number of breaking changes */
  breakingChangesCount?: number;
  /** Compatibility recommendation */
  compatibilityRecommendation?: string | null;
  /** Number of files modified so far */
  filesModifiedCount?: number;
  /** Packages upgraded count */
  packagesUpgradedCount?: number;
  className?: string;
}

function riskVariant(risk: string): "default" | "secondary" | "destructive" | "outline" {
  if (risk === "critical" || risk === "high") return "destructive";
  if (risk === "medium") return "secondary";
  return "outline";
}

export function LiveMetricsStrip({
  currentStage,
  overallRisk,
  breakingChangesCount,
  compatibilityRecommendation,
  filesModifiedCount,
  packagesUpgradedCount,
  className = "",
}: LiveMetricsStripProps) {
  const hasAny =
    currentStage ||
    overallRisk != null ||
    (breakingChangesCount != null && breakingChangesCount > 0) ||
    compatibilityRecommendation ||
    (filesModifiedCount != null && filesModifiedCount > 0) ||
    (packagesUpgradedCount != null && packagesUpgradedCount > 0);

  if (!hasAny) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2 text-sm ${className}`}
    >
      {currentStage && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className="font-medium text-foreground">Step:</span>
          <span>{currentStage}</span>
        </div>
      )}
      {overallRisk != null && overallRisk !== "" && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Risk</span>
          <Badge variant={riskVariant(overallRisk)} className="capitalize">
            {overallRisk}
          </Badge>
          {breakingChangesCount != null && breakingChangesCount > 0 && (
            <span className="text-muted-foreground text-xs">
              ({breakingChangesCount} breaking change{breakingChangesCount !== 1 ? "s" : ""})
            </span>
          )}
        </div>
      )}
      {compatibilityRecommendation && (
        <div className="flex items-center gap-1.5">
          {compatibilityRecommendation === "do_not_proceed" ? (
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          )}
          <span className="text-muted-foreground">Compatibility</span>
          <span className="capitalize">
            {compatibilityRecommendation.replace(/_/g, " ")}
          </span>
        </div>
      )}
      {filesModifiedCount != null && filesModifiedCount > 0 && (
        <div className="flex items-center gap-1.5">
          <FileCode2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Files modified</span>
          <span className="font-medium">{filesModifiedCount}</span>
        </div>
      )}
      {packagesUpgradedCount != null && packagesUpgradedCount > 0 && (
        <div className="flex items-center gap-1.5">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Packages upgraded</span>
          <span className="font-medium">{packagesUpgradedCount}</span>
        </div>
      )}
    </div>
  );
}
