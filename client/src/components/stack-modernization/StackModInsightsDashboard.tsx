/**
 * Stack Modernization Insights Dashboard
 * Number-first cards: tech stack, repo overview, risk, compatibility,
 * version intelligence, tasks, and code upgrade from progress API.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export interface ProgressData {
  repoProfile?: {
    projectType?: string;
    languages?: string[];
    runtimeInfo?: Array<{ language: string; version?: string }>;
    frameworks?: Array<{ name: string; version?: string }>;
    fileStructure?: { totalFiles?: number; codeFiles?: number; testFiles?: number };
  };
  dependencyGraph?: {
    directDependencies?: unknown[];
    transitiveDependencies?: unknown[];
    manifestPaths?: string[];
  };
  versionIntelligence?: unknown[];
  riskReport?: {
    overallRisk?: string;
    breakingChanges?: unknown[];
    recommendation?: string;
    confidenceScore?: number;
  };
  compatibilityCheck?: {
    recommendation?: string;
    compatible?: boolean;
    summary?: string;
    confidence?: number;
  };
  upgradeTasks?: unknown[];
  modifiedFiles?: unknown[];
  codeUpgrade?: { summary?: { totalFilesModified?: number; totalPackagesUpgraded?: number } };
  /** From progress API: dashboard metrics */
  tasksTotal?: number;
  tasksCompleted?: number;
  dependencyPackageCount?: number;
  riskScore?: number;
  compatibilityScore?: number;
}

interface StackModInsightsDashboardProps {
  progressData: ProgressData | null;
  className?: string;
}

function formatRiskBadge(risk: string | undefined) {
  if (!risk) return null;
  const r = (risk || "").toLowerCase();
  const variant = r === "critical" ? "destructive" : r === "high" ? "destructive" : r === "medium" ? "secondary" : "outline";
  return <Badge variant={variant} className="capitalize">{risk}</Badge>;
}

function formatCompatBadge(rec: string | undefined, compatible?: boolean) {
  if (rec === undefined && compatible === undefined) return null;
  const label = rec ? rec.replace(/_/g, " ") : (compatible ? "Proceed" : "Review");
  const isGreen = (rec && (rec === "compatible" || rec === "proceed")) || compatible === true;
  const isRed = (rec && (rec === "do_not_proceed" || rec === "incompatible")) || compatible === false;
  return (
    <Badge variant={isRed ? "destructive" : isGreen ? "default" : "secondary"}>
      {label}
    </Badge>
  );
}

export function StackModInsightsDashboard({ progressData, className = "" }: StackModInsightsDashboardProps) {
  if (!progressData) return null;

  const repo = progressData.repoProfile;
  const depGraph = progressData.dependencyGraph;
  const directCount = depGraph?.directDependencies?.length ?? 0;
  const transitiveCount = depGraph?.transitiveDependencies?.length ?? 0;
  const versionInt = progressData.versionIntelligence ?? [];
  const riskReport = progressData.riskReport;
  const compat = progressData.compatibilityCheck;
  const modifiedFiles = progressData.modifiedFiles ?? [];
  const codeUpgrade = progressData.codeUpgrade?.summary;

  // Prefer progress API derived fields for dashboard
  const tasksTotal = progressData.tasksTotal ?? progressData.upgradeTasks?.length ?? 0;
  const tasksCompleted = progressData.tasksCompleted ?? 0;
  const packageCount =
    progressData.dependencyPackageCount ??
    (directCount + transitiveCount > 0 ? directCount + transitiveCount : versionInt.length);
  const riskScore = progressData.riskScore ?? riskReport?.confidenceScore;
  const compatibilityScore = progressData.compatibilityScore ?? compat?.confidence;

  const filesModified = (modifiedFiles.length || codeUpgrade?.totalFilesModified) ?? 0;
  const packagesUpgraded = codeUpgrade?.totalPackagesUpgraded ?? 0;

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 ${className}`}>
      {/* Tech stack — number-first */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Tech stack</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2">
          {repo?.fileStructure ? (
            <>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-lg font-semibold tabular-nums">{repo.fileStructure.totalFiles ?? "—"}</span>
                <span className="text-muted-foreground">files</span>
                <span className="text-muted-foreground">·</span>
                <span className="font-medium tabular-nums">{repo.fileStructure.codeFiles ?? "—"}</span>
                <span className="text-muted-foreground">code</span>
                <span className="text-muted-foreground">·</span>
                <span className="font-medium tabular-nums">{repo.fileStructure.testFiles ?? "—"}</span>
                <span className="text-muted-foreground">tests</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {repo.projectType && <Badge variant="outline">{repo.projectType}</Badge>}
                {repo.languages?.slice(0, 2).map((l) => <Badge key={l} variant="outline">{l}</Badge>)}
                {repo.runtimeInfo?.slice(0, 1).map((r, i) => (
                  <Badge key={i} variant="secondary">{r.language} {r.version || "—"}</Badge>
                ))}
                {repo.frameworks?.slice(0, 2).map((f, i) => (
                  <Badge key={i} variant="secondary">{f.name} {f.version || "—"}</Badge>
                ))}
              </div>
            </>
          ) : repo ? (
            <p className="text-muted-foreground">{repo.projectType ?? "—"}, {repo.languages?.join(", ") ?? "—"}</p>
          ) : (
            <p className="text-muted-foreground">—</p>
          )}
        </CardContent>
      </Card>

      {/* Repo overview — package count as main number */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Repo overview</CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          {packageCount > 0 || directCount > 0 || transitiveCount > 0 ? (
            <div className="space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold tabular-nums">{packageCount}</span>
                <span className="text-muted-foreground">packages</span>
              </div>
              {directCount > 0 || transitiveCount > 0 ? (
                <p className="text-muted-foreground">
                  {directCount} direct, {transitiveCount} transitive
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground">Pending</p>
          )}
        </CardContent>
      </Card>

      {/* Risk — number first (breaking changes + optional score), then badge */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Risk</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2">
          {riskReport ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {riskReport.breakingChanges && riskReport.breakingChanges.length > 0 && (
                  <span className="text-lg font-semibold tabular-nums">{riskReport.breakingChanges.length}</span>
                )}
                {riskReport.breakingChanges && riskReport.breakingChanges.length > 0 && (
                  <span className="text-muted-foreground">breaking change(s)</span>
                )}
                {formatRiskBadge(riskReport.overallRisk)}
                {riskReport.recommendation && (
                  <Badge variant="outline" className="capitalize">{riskReport.recommendation.replace(/_/g, " ")}</Badge>
                )}
              </div>
              {riskScore != null && (
                <p className="text-muted-foreground">Score: <span className="font-medium tabular-nums">{riskScore}</span>/100</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">—</p>
          )}
        </CardContent>
      </Card>

      {/* Compatibility — numeric score first, then badge */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Compatibility</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2">
          {compat != null ? (
            <div className="flex items-center gap-2 flex-wrap">
              {typeof (compatibilityScore ?? compat.confidence) === "number" && (
                <span className="text-lg font-semibold tabular-nums">{compatibilityScore ?? compat.confidence}%</span>
              )}
              {formatCompatBadge(compat.recommendation, compat.compatible)}
            </div>
          ) : (
            <p className="text-muted-foreground">Pending</p>
          )}
        </CardContent>
      </Card>

      {/* Version intelligence */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Version intelligence</CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          {versionInt.length > 0 ? (
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tabular-nums">{versionInt.length}</span>
              <span className="text-muted-foreground">package(s) analyzed</span>
            </div>
          ) : (
            <p className="text-muted-foreground">—</p>
          )}
        </CardContent>
      </Card>

      {/* Tasks — tasksTotal / tasksCompleted from API; never use file count as completed */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Tasks</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2">
          {tasksTotal > 0 ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold tabular-nums">{tasksTotal}</span>
                <span className="text-muted-foreground">tasks</span>
                {tasksCompleted > 0 && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-medium tabular-nums">{tasksCompleted} completed</span>
                  </>
                )}
              </div>
              {tasksTotal > 0 && tasksCompleted >= 0 && (
                <Progress value={tasksTotal ? (tasksCompleted / tasksTotal) * 100 : 0} className="h-1.5" />
              )}
              {filesModified > 0 && (
                <p className="text-muted-foreground"><span className="font-medium tabular-nums">{filesModified}</span> file(s) modified</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">—</p>
          )}
        </CardContent>
      </Card>

      {/* Code upgrade — numbers only */}
      <Card className="sm:col-span-2 lg:col-span-3">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Code upgrade</CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          {filesModified > 0 || packagesUpgraded > 0 ? (
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-lg font-semibold tabular-nums">{filesModified}</span>
              <span className="text-muted-foreground">files modified</span>
              {packagesUpgraded > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-lg font-semibold tabular-nums">{packagesUpgraded}</span>
                  <span className="text-muted-foreground">packages upgraded</span>
                </>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">Pending</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
