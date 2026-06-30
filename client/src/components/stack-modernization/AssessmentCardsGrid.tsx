/**
 * AssessmentCardsGrid - Real-time assessment cards with mini-charts.
 * Each card represents one sub-agent and transitions from skeleton -> loaded
 * as data arrives from the progress API.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Shield, Code2, AlertTriangle, Database, Settings, Layers, Package, GitBranch,
  CheckCircle2, Loader2, XCircle,
} from "lucide-react";
import { ChartDetailModal, ChartDataRow, DetailSection, CHART_METHODOLOGIES } from "./ChartDetailModal";

type AgentStatus = "pending" | "running" | "completed" | "failed";

export interface AssessmentCardsGridProps {
  progressData: any;
  onDownloadChartPdf?: (chartId: string) => void;
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-blue-500 animate-pulse",
  completed: "text-green-500",
  failed: "text-red-500",
};

const SEVERITY_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e"];
const CHART_COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#818cf8", "#4f46e5"];

function StatusIcon({ status }: { status: AgentStatus }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === "running") return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-500" />;
  return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />;
}

function SkeletonCard({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {title}
          </span>
          <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-[80px] w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}

// -- Individual Card Components --

function StackDetectionCard({ data, status, onDoubleClick }: { data: any; status: AgentStatus; onDoubleClick?: () => void }) {
  if (!data) return <SkeletonCard icon={Layers} title="Stack Detection" />;
  const langs = data.languages || [];
  const chartData = langs.map((l: string, i: number) => ({ name: l, value: 1 }));
  return (
    <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={onDoubleClick}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Layers className="h-4 w-4" />Stack Detection</span>
          <StatusIcon status={status} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{data.projectType || "—"}</div>
        <div className="h-[80px] mt-2">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={30} innerRadius={15}>
                  {chartData.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="text-xs text-muted-foreground">No languages detected</div>}
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          {langs.slice(0, 5).map((l: string) => <Badge key={l} variant="outline" className="text-[10px]">{l}</Badge>)}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{data.fileStructure?.totalFiles || 0} files, {data.frameworks?.length || 0} frameworks</p>
      </CardContent>
    </Card>
  );
}

function DependencyCard({ data, status, onDoubleClick }: { data: any; status: AgentStatus; onDoubleClick?: () => void }) {
  if (!data) return <SkeletonCard icon={Package} title="Dependencies" />;
  const direct = data.directDependencies?.length || 0;
  const transitive = data.transitiveDependencies?.length || 0;
  const chartData = [{ name: "Direct", count: direct }, { name: "Transitive", count: transitive }];
  return (
    <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={onDoubleClick}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Package className="h-4 w-4" />Dependencies</span>
          <StatusIcon status={status} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{direct + transitive}</div>
        <div className="h-[80px] mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{data.peerConflicts?.length || 0} peer conflicts, depth max {data.depthAnalysis?.maxDepth || 0}</p>
      </CardContent>
    </Card>
  );
}

function VersionIntelCard({ data, status, onDoubleClick }: { data: any; status: AgentStatus; onDoubleClick?: () => void }) {
  if (!data || data.length === 0) return <SkeletonCard icon={GitBranch} title="Version Intelligence" />;
  const riskData = [
    { name: "Low", count: data.filter((v: any) => v.riskLevel === "low").length },
    { name: "Medium", count: data.filter((v: any) => v.riskLevel === "medium").length },
    { name: "High", count: data.filter((v: any) => v.riskLevel === "high").length },
  ].filter(d => d.count > 0);
  const riskColors = ["#22c55e", "#eab308", "#ef4444"];
  return (
    <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={onDoubleClick}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><GitBranch className="h-4 w-4" />Version Intel</span>
          <StatusIcon status={status} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{data.length} <span className="text-sm font-normal text-muted-foreground">packages</span></div>
        <div className="h-[80px] mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={riskData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={30} innerRadius={15}>
                {riskData.map((_: any, i: number) => <Cell key={i} fill={riskColors[i % riskColors.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-2 mt-1 text-[10px]">
          {riskData.map(d => <span key={d.name}><span className="font-medium">{d.count}</span> {d.name}</span>)}
        </div>
      </CardContent>
    </Card>
  );
}

function SecurityCard({ data, status, onDoubleClick }: { data: any; status: AgentStatus; onDoubleClick?: () => void }) {
  if (!data) return <SkeletonCard icon={Shield} title="Security" />;
  const chartData = [
    { name: "Critical", count: data.critical || 0 },
    { name: "High", count: data.high || 0 },
    { name: "Medium", count: data.medium || 0 },
    { name: "Low", count: data.low || 0 },
  ].filter(d => d.count > 0);
  return (
    <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={onDoubleClick}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Shield className="h-4 w-4" />Security</span>
          <StatusIcon status={status} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold">{data.score ?? 0}</span>
          <span className="text-xs text-muted-foreground">/100 health</span>
        </div>
        <div className="h-[80px] mt-2">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis hide />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={SEVERITY_COLORS[i % SEVERITY_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-full text-xs text-green-500 font-medium">No vulnerabilities found</div>}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{data.totalVulnerabilities || 0} total issues</p>
      </CardContent>
    </Card>
  );
}

function CodeQualityCard({ data, status, onDoubleClick }: { data: any; status: AgentStatus; onDoubleClick?: () => void }) {
  if (!data) return <SkeletonCard icon={Code2} title="Code Quality" />;
  const score = data.qualityScore || 0;
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#eab308" : "#ef4444";
  const gaugeData = [{ name: "Score", value: score }, { name: "Remaining", value: 100 - score }];
  return (
    <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={onDoubleClick}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Code2 className="h-4 w-4" />Code Quality</span>
          <StatusIcon status={status} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold" style={{ color }}>{score}</span>
          <span className="text-xs text-muted-foreground">/100</span>
        </div>
        <div className="h-[80px] mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={gaugeData} dataKey="value" startAngle={180} endAngle={0} cx="50%" cy="90%" outerRadius={40} innerRadius={25}>
                <Cell fill={color} />
                <Cell fill="#e5e7eb" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Complexity avg {data.complexityMetrics?.averageCyclomaticComplexity || 0}, {data.debtItems?.length || 0} debt items
        </p>
      </CardContent>
    </Card>
  );
}

function BreakingChangesCard({ data, status, onDoubleClick }: { data: any; status: AgentStatus; onDoubleClick?: () => void }) {
  if (!data) return <SkeletonCard icon={AlertTriangle} title="Breaking Changes" />;
  const dist = data.severityDistribution || {};
  const chartData = [
    { name: "Critical", count: dist.critical || 0 },
    { name: "Major", count: dist.major || 0 },
    { name: "Minor", count: dist.minor || 0 },
  ].filter(d => d.count > 0);
  return (
    <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={onDoubleClick}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Breaking Changes</span>
          <StatusIcon status={status} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{data.totalBreakingChanges || 0}</div>
        <div className="h-[80px] mt-2">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis hide />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={SEVERITY_COLORS[i % SEVERITY_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-full text-xs text-green-500 font-medium">No breaking changes</div>}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{data.byPackage?.length || 0} packages affected</p>
      </CardContent>
    </Card>
  );
}

function DatabaseCard({ data, status, onDoubleClick }: { data: any; status: AgentStatus; onDoubleClick?: () => void }) {
  if (!data) return <SkeletonCard icon={Database} title="Database" />;
  return (
    <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={onDoubleClick}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Database className="h-4 w-4" />Database</span>
          <StatusIcon status={status} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{data.databases?.length || 0} <span className="text-sm font-normal text-muted-foreground">DBs</span></div>
        <div className="mt-2 space-y-1">
          {(data.databases || []).map((db: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <Database className="h-3 w-3" />
              <span className="font-medium capitalize">{db.type}</span>
              {db.version && <Badge variant="outline" className="text-[10px]">{db.version}</Badge>}
            </div>
          ))}
          {(data.orms || []).length > 0 && (
            <div className="text-xs text-muted-foreground mt-2">
              ORMs: {data.orms.map((o: any) => o.name).join(", ")}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {data.migrationFiles?.length || 0} migrations, {data.connectionStrings || 0} conn strings
        </p>
      </CardContent>
    </Card>
  );
}

function RequirementsCard({ data, status, onDoubleClick }: { data: any; status: AgentStatus; onDoubleClick?: () => void }) {
  if (!data) return <SkeletonCard icon={Settings} title="Requirements" />;
  return (
    <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={onDoubleClick}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Settings className="h-4 w-4" />Requirements</span>
          <StatusIcon status={status} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{data.runtimePrereqs?.length || 0} <span className="text-sm font-normal text-muted-foreground">runtimes</span></div>
        <div className="mt-2 space-y-1 text-xs">
          {(data.runtimePrereqs || []).slice(0, 3).map((r: any, i: number) => (
            <div key={i} className="flex items-center justify-between">
              <span className="font-medium">{r.runtime}</span>
              <Badge variant="outline" className="text-[10px]">{r.minVersion}</Badge>
            </div>
          ))}
          {(data.buildTools || []).length > 0 && (
            <div className="text-muted-foreground mt-1">Tools: {data.buildTools.join(", ")}</div>
          )}
          {data.containerized && <Badge variant="secondary" className="text-[10px] mt-1">Containerized</Badge>}
          {data.cicdPlatform && <Badge variant="outline" className="text-[10px] mt-1">{data.cicdPlatform}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-2">{data.envConstraints?.length || 0} env vars detected</p>
      </CardContent>
    </Card>
  );
}

function buildDataTable(chartKey: string, data: any): ChartDataRow[] {
  switch (chartKey) {
    case "stackDetection": {
      const langs = data?.languages || [];
      return [
        { label: "Project Type", value: data?.projectType || "—" },
        { label: "Total Files", value: data?.fileStructure?.totalFiles || 0 },
        { label: "Languages", value: langs.join(", ") || "None" },
        { label: "Frameworks", value: (data?.frameworks || []).join(", ") || "None" },
      ];
    }
    case "dependencies": {
      const direct = data?.directDependencies?.length || 0;
      const transitive = data?.transitiveDependencies?.length || 0;
      return [
        { label: "Direct Dependencies", value: direct },
        { label: "Transitive Dependencies", value: transitive },
        { label: "Total", value: direct + transitive },
        { label: "Peer Conflicts", value: data?.peerConflicts?.length || 0 },
        { label: "Max Depth", value: data?.depthAnalysis?.maxDepth || 0 },
      ];
    }
    case "versionIntelligence": {
      if (!data || !Array.isArray(data)) return [];
      return [
        { label: "Total Packages", value: data.length },
        { label: "High Risk", value: data.filter((v: any) => v.riskLevel === "high").length },
        { label: "Medium Risk", value: data.filter((v: any) => v.riskLevel === "medium").length },
        { label: "Low Risk", value: data.filter((v: any) => v.riskLevel === "low").length },
      ];
    }
    case "security":
      return [
        { label: "Security Score", value: `${data?.score ?? 0}/100` },
        { label: "Critical", value: data?.critical || 0 },
        { label: "High", value: data?.high || 0 },
        { label: "Medium", value: data?.medium || 0 },
        { label: "Low", value: data?.low || 0 },
        { label: "Total Vulnerabilities", value: data?.totalVulnerabilities || 0 },
      ];
    case "codeQuality": {
      const cm = data?.complexityMetrics || {};
      return [
        { label: "Quality Score", value: `${data?.qualityScore || 0}/100` },
        { label: "Maintainability Index", value: data?.maintainabilityIndex || 0 },
        { label: "Avg Cyclomatic Complexity", value: cm.averageCyclomaticComplexity || 0 },
        { label: "Max Cyclomatic Complexity", value: cm.maxCyclomaticComplexity || 0 },
        { label: "Lines of Code", value: cm.linesOfCode || 0 },
        { label: "Code-to-Comment Ratio", value: cm.codeToCommentRatio || 0 },
        { label: "Duplicate Code", value: cm.duplicateCodePercentage ? `${cm.duplicateCodePercentage}%` : "0%" },
        { label: "Test Coverage", value: data?.patterns?.testCoverage || "unknown" },
        { label: "Tech Debt Items", value: data?.debtItems?.length || 0 },
      ];
    }
    case "breakingChanges": {
      const dist = data?.severityDistribution || {};
      return [
        { label: "Total Breaking Changes", value: data?.totalBreakingChanges || 0 },
        { label: "Critical", value: dist.critical || 0 },
        { label: "Major", value: dist.major || 0 },
        { label: "Minor", value: dist.minor || 0 },
        { label: "Packages Affected", value: data?.byPackage?.length || 0 },
      ];
    }
    case "database":
      return [
        { label: "Databases", value: data?.databases?.length || 0 },
        { label: "ORMs", value: (data?.orms || []).map((o: any) => o.name).join(", ") || "None" },
        { label: "Migration Files", value: data?.migrationFiles?.length || 0 },
        { label: "Connection Strings", value: data?.connectionStrings || 0 },
        { label: "Has DB Migrations", value: data?.hasDbMigrations ? "Yes" : "No" },
      ];
    case "requirements":
      return [
        { label: "Runtime Prerequisites", value: data?.runtimePrereqs?.length || 0 },
        { label: "SDKs Required", value: (data?.sdks || []).join(", ") || "None" },
        { label: "Build Tools", value: (data?.buildTools || []).join(", ") || "None" },
        { label: "Containerized", value: data?.containerized ? "Yes" : "No" },
        { label: "CI/CD Platform", value: data?.cicdPlatform || "None" },
        { label: "OS Requirements", value: (data?.osRequirements || []).join(", ") || "Any" },
        { label: "Environment Variables", value: data?.envConstraints?.length || 0 },
      ];
    default:
      return [];
  }
}

function buildDetailSections(chartKey: string, data: any): DetailSection[] {
  switch (chartKey) {
    case "stackDetection": {
      const sections: DetailSection[] = [];
      const frameworks = data?.frameworks || [];
      if (frameworks.length > 0) {
        sections.push({
          heading: "Detected Frameworks",
          items: frameworks.map((f: string) => ({ title: f })),
        });
      }
      const langs = data?.languages || [];
      if (langs.length > 0) {
        sections.push({
          heading: "Languages",
          items: langs.map((l: string) => ({ title: l })),
        });
      }
      return sections;
    }
    case "dependencies": {
      const sections: DetailSection[] = [];
      const direct = data?.directDependencies || [];
      if (direct.length > 0) {
        sections.push({
          heading: "Direct Dependencies",
          items: direct.map((d: any) => ({
            title: typeof d === "string" ? d : (d.name || d.package || JSON.stringify(d)),
            subtitle: typeof d === "object" && d.version ? `v${d.version}` : undefined,
          })),
        });
      }
      const conflicts = data?.peerConflicts || [];
      if (conflicts.length > 0) {
        sections.push({
          heading: "Peer Conflicts",
          emptyMessage: "No peer conflicts detected.",
          items: conflicts.map((c: any) => ({
            title: typeof c === "string" ? c : (c.package || c.name || JSON.stringify(c)),
            subtitle: typeof c === "object" && c.reason ? c.reason : undefined,
            badge: { text: "Conflict", variant: "destructive" as const },
          })),
        });
      }
      return sections;
    }
    case "versionIntelligence": {
      if (!data || !Array.isArray(data)) return [];
      return [{
        heading: "Package Versions",
        items: data.map((v: any) => ({
          title: v.packageName || v.name || "Unknown",
          subtitle: `${v.currentVersion || "?"} → ${v.targetVersion || "?"}`,
          badge: v.riskLevel ? { text: v.riskLevel } : undefined,
          extra: v.reason || undefined,
        })),
      }];
    }
    case "security": {
      const sections: DetailSection[] = [];
      const cves = data?.cves || [];
      if (cves.length > 0) {
        sections.push({
          heading: "Known Vulnerabilities (CVEs)",
          items: cves.map((cve: any) => ({
            title: `${cve.id} — ${cve.title || "No title"}`,
            subtitle: cve.package ? `Package: ${cve.package}${cve.fixedIn ? ` (fix in ${cve.fixedIn})` : ""}` : undefined,
            badge: cve.severity ? { text: cve.severity } : undefined,
          })),
        });
      }
      const advisories = data?.advisories || [];
      if (advisories.length > 0) {
        sections.push({
          heading: "Security Advisories",
          items: advisories.map((a: string) => ({ title: a })),
        });
      }
      if (cves.length === 0 && advisories.length === 0) {
        sections.push({
          heading: "Vulnerabilities",
          emptyMessage: "No known vulnerabilities detected. Security score is based on dependency analysis.",
          items: [],
        });
      }
      return sections;
    }
    case "codeQuality": {
      const sections: DetailSection[] = [];
      const debtItems = data?.debtItems || [];
      if (debtItems.length > 0) {
        sections.push({
          heading: "Technical Debt Items",
          items: debtItems.map((d: any) => ({
            title: d.description || "Unnamed issue",
            badge: d.severity ? { text: d.severity } : d.type ? { text: d.type, variant: "outline" as const } : undefined,
            extra: d.file || undefined,
          })),
        });
      }
      const antiPatterns = data?.patterns?.antiPatterns || [];
      if (antiPatterns.length > 0) {
        sections.push({
          heading: "Anti-Patterns Detected",
          items: antiPatterns.map((p: string) => ({ title: p, badge: { text: "anti-pattern", variant: "secondary" as const } })),
        });
      }
      const designPatterns = data?.patterns?.designPatterns || [];
      if (designPatterns.length > 0) {
        sections.push({
          heading: "Design Patterns Found",
          items: designPatterns.map((p: string) => ({ title: p })),
        });
      }
      return sections;
    }
    case "breakingChanges": {
      const byPackage = data?.byPackage || [];
      if (byPackage.length === 0) {
        return [{ heading: "Breaking Changes", emptyMessage: "No breaking changes identified.", items: [] }];
      }
      return byPackage.map((pkg: any) => ({
        heading: `${pkg.package} (${pkg.currentVersion || "?"} → ${pkg.latestVersion || "?"})`,
        items: (pkg.highlights || []).length > 0
          ? (pkg.highlights as string[]).map((h: string) => ({
              title: h,
              badge: pkg.severity ? { text: pkg.severity } : undefined,
            }))
          : [{ title: `${pkg.breakingChangesCount || 0} breaking change(s) identified`, badge: { text: pkg.severity || "unknown" } }],
      }));
    }
    case "database": {
      const sections: DetailSection[] = [];
      const dbs = data?.databases || [];
      if (dbs.length > 0) {
        sections.push({
          heading: "Detected Databases",
          items: dbs.map((db: any) => ({
            title: `${(db.type || "unknown").toUpperCase()}${db.version ? ` v${db.version}` : ""}`,
            subtitle: db.detectedFrom ? `Detected from: ${db.detectedFrom}` : undefined,
          })),
        });
      }
      const orms = data?.orms || [];
      if (orms.length > 0) {
        sections.push({
          heading: "ORMs & Data Access",
          items: orms.map((o: any) => ({
            title: o.name + (o.version ? ` v${o.version}` : ""),
            subtitle: o.detectedFrom ? `Detected from: ${o.detectedFrom}` : undefined,
          })),
        });
      }
      const migrations = data?.migrationFiles || [];
      if (migrations.length > 0) {
        sections.push({
          heading: "Migration Files",
          items: migrations.map((m: string) => ({ title: m })),
        });
      }
      const constraints = data?.versionConstraints || [];
      if (constraints.length > 0) {
        sections.push({
          heading: "Version Constraints",
          items: constraints.map((c: string) => ({ title: c })),
        });
      }
      return sections;
    }
    case "requirements": {
      const sections: DetailSection[] = [];
      const prereqs = data?.runtimePrereqs || [];
      if (prereqs.length > 0) {
        sections.push({
          heading: "Runtime Prerequisites",
          items: prereqs.map((r: any) => ({
            title: r.runtime,
            subtitle: `Min version: ${r.minVersion}${r.currentVersion ? ` (current: ${r.currentVersion})` : ""}`,
          })),
        });
      }
      const envVars = data?.envConstraints || [];
      if (envVars.length > 0) {
        sections.push({
          heading: "Environment Variables",
          items: envVars.map((e: any) => ({
            title: e.name,
            subtitle: e.description || undefined,
            badge: e.type ? { text: e.type, variant: e.type === "required" ? "destructive" as const : "outline" as const } : undefined,
          })),
        });
      }
      const sdks = data?.sdks || [];
      if (sdks.length > 0) {
        sections.push({
          heading: "Required SDKs",
          items: sdks.map((s: string) => ({ title: s })),
        });
      }
      const osReqs = data?.osRequirements || [];
      if (osReqs.length > 0) {
        sections.push({
          heading: "OS Requirements",
          items: osReqs.map((o: string) => ({ title: o })),
        });
      }
      return sections;
    }
    default:
      return [];
  }
}

// -- Main Grid --

export function AssessmentCardsGrid({ progressData, onDownloadChartPdf }: AssessmentCardsGridProps) {
  const [detailModal, setDetailModal] = useState<{ key: string; title: string; data: any } | null>(null);

  if (!progressData) return null;

  const agentStatus = progressData.assessmentSubAgentStatus || {} as Record<string, AgentStatus>;
  const getStatus = (key: string): AgentStatus => agentStatus[key] || "pending";

  const openDetail = (key: string, title: string, data: any) => {
    setDetailModal({ key, title, data });
  };

  const chartDataMap: Record<string, any> = {
    stackDetection: progressData.repoProfile,
    dependencies: progressData.dependencyGraph,
    versionIntelligence: progressData.versionIntelligence,
    security: progressData.securityAssessment,
    codeQuality: progressData.codeQuality,
    breakingChanges: progressData.breakingChangesPreview,
    database: progressData.databaseDependencies,
    requirements: progressData.requirementsAnalysis,
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StackDetectionCard data={progressData.repoProfile} status={getStatus("stackDetection")} onDoubleClick={() => openDetail("stackDetection", "Stack Detection", progressData.repoProfile)} />
        <DependencyCard data={progressData.dependencyGraph} status={getStatus("dependencyAnalysis")} onDoubleClick={() => openDetail("dependencies", "Dependencies", progressData.dependencyGraph)} />
        <VersionIntelCard data={progressData.versionIntelligence} status={getStatus("versionIntelligence")} onDoubleClick={() => openDetail("versionIntelligence", "Version Intelligence", progressData.versionIntelligence)} />
        <SecurityCard data={progressData.securityAssessment} status={getStatus("securityAssessment")} onDoubleClick={() => openDetail("security", "Security Analysis", progressData.securityAssessment)} />
        <CodeQualityCard data={progressData.codeQuality} status={getStatus("codeQuality")} onDoubleClick={() => openDetail("codeQuality", "Code Quality", progressData.codeQuality)} />
        <BreakingChangesCard data={progressData.breakingChangesPreview} status={getStatus("breakingChangesPreview")} onDoubleClick={() => openDetail("breakingChanges", "Breaking Changes", progressData.breakingChangesPreview)} />
        <DatabaseCard data={progressData.databaseDependencies} status={getStatus("databaseDependencies")} onDoubleClick={() => openDetail("database", "Database Analysis", progressData.databaseDependencies)} />
        <RequirementsCard data={progressData.requirementsAnalysis} status={getStatus("requirementsAnalysis")} onDoubleClick={() => openDetail("requirements", "Requirements Analysis", progressData.requirementsAnalysis)} />
      </div>

      {detailModal && (
        <ChartDetailModal
          open={!!detailModal}
          onOpenChange={(open) => { if (!open) setDetailModal(null); }}
          title={detailModal.title}
          methodology={CHART_METHODOLOGIES[detailModal.key] || "Analysis based on static code and dependency inspection."}
          dataTable={buildDataTable(detailModal.key, chartDataMap[detailModal.key])}
          detailSections={buildDetailSections(detailModal.key, chartDataMap[detailModal.key])}
          onDownloadPdf={onDownloadChartPdf ? () => onDownloadChartPdf(detailModal.key) : undefined}
        />
      )}
    </>
  );
}
