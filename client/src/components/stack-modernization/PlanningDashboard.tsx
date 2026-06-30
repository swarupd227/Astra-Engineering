/**
 * PlanningDashboard - Rich visualizations for the planning phase.
 * Shows KPI summary cards, per-stack bar chart, radar health, effort/severity
 * distributions, upgrade order, and package detail table.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  PieChart, Pie, CartesianGrid,
} from "recharts";
import {
  Shield, AlertTriangle, Package, ArrowUpDown, CheckCircle2, Clock,
  Lightbulb, ArrowRight,
} from "lucide-react";
import { ChartDetailModal, ChartDataRow, DetailSection, CHART_METHODOLOGIES } from "./ChartDetailModal";

interface PerStackScore {
  name: string;
  category: string;
  currentVersion: string;
  targetVersion: string;
  compatibilityScore: number;
  riskScore: number;
  breakingChangesCount: number;
  effort: string;
  effortNumeric: number;
}

interface RiskMatrixEntry {
  scenario: string;
  likelihood: number;
  impact: number;
  category: string;
}

interface OverallHealth {
  security: number;
  compatibility: number;
  effort: number;
  risk: number;
  testCoverage: number;
}

export interface PlanningDashboardProps {
  data: {
    perStackScores?: PerStackScore[];
    riskMatrix?: RiskMatrixEntry[];
    overallHealth?: OverallHealth;
    effortDistribution?: { label: string; count: number }[];
    severityDistribution?: { label: string; count: number; color: string }[];
    upgradeOrder?: string[];
    recommendation?: string;
    totalBreakingChanges?: number;
    requiredChanges?: { type: string; count: number }[];
    keyInsights?: string[];
  } | null;
  className?: string;
  onDownloadChartPdf?: (chartId: string) => void;
}

function getColor(score: number): string {
  if (score >= 70) return "#22c55e";
  if (score >= 40) return "#eab308";
  return "#ef4444";
}

function getRecommendationStyle(rec: string) {
  switch (rec) {
    case "proceed": return { color: "text-green-600", bg: "bg-green-50 dark:bg-green-950/30", label: "Proceed", icon: CheckCircle2 };
    case "proceed_with_caution": return { color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-950/30", label: "Proceed with Caution", icon: AlertTriangle };
    case "review_required": return { color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/30", label: "Review Required", icon: AlertTriangle };
    case "do_not_proceed": return { color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/30", label: "Do Not Proceed", icon: Shield };
    default: return { color: "text-muted-foreground", bg: "bg-muted/30", label: "Analyzing…", icon: Clock };
  }
}

const EFFORT_COLORS: Record<string, string> = {
  trivial: "#22c55e",
  low: "#86efac",
  medium: "#eab308",
  high: "#f97316",
  "very-high": "#ef4444",
};

const PIE_LABEL = ({ name, value }: any) =>
  value > 0 ? `${name}: ${value}` : null;

export function PlanningDashboard({ data, className = "", onDownloadChartPdf }: PlanningDashboardProps) {
  const [detailModal, setDetailModal] = useState<{ key: string; title: string; dataRows: ChartDataRow[]; detailSections?: DetailSection[] } | null>(null);

  if (!data) return null;
  const {
    perStackScores = [],
    overallHealth,
    effortDistribution = [],
    severityDistribution = [],
    upgradeOrder = [],
    recommendation = "unknown",
    totalBreakingChanges = 0,
    requiredChanges = [],
    keyInsights = [],
  } = data;

  if (perStackScores.length === 0 && !overallHealth) return null;

  const openDetail = (key: string, title: string, dataRows: ChartDataRow[], detailSections?: DetailSection[]) => {
    setDetailModal({ key, title, dataRows, detailSections });
  };

  const recStyle = getRecommendationStyle(recommendation);
  const RecIcon = recStyle.icon;
  const totalPackages = perStackScores.length;
  const highRiskCount = perStackScores.filter(s => s.riskScore >= 60).length;
  const avgCompat = totalPackages > 0
    ? Math.round(perStackScores.reduce((a, s) => a + s.compatibilityScore, 0) / totalPackages)
    : 0;

  const radarData = overallHealth
    ? [
        { subject: "Security", value: overallHealth.security },
        { subject: "Compatibility", value: overallHealth.compatibility },
        { subject: "Low Effort", value: overallHealth.effort },
        { subject: "Low Risk", value: overallHealth.risk },
        { subject: "Test Coverage", value: overallHealth.testCoverage },
      ]
    : [];

  const stackChartData = perStackScores.map((s) => ({
    name: s.name.length > 18 ? s.name.slice(0, 17) + "…" : s.name,
    fullName: s.name,
    compatibility: s.compatibilityScore,
    risk: s.riskScore,
    breaking: s.breakingChangesCount,
    category: s.category,
  }));

  const effortPieData = effortDistribution.map(e => ({
    name: e.label.charAt(0).toUpperCase() + e.label.slice(1),
    value: e.count,
    fill: EFFORT_COLORS[e.label] || "#6366f1",
  }));

  const severityPieData = severityDistribution.map(s => ({
    name: s.label,
    value: s.count,
    fill: s.color,
  }));

  const requiredChangePieData = requiredChanges.map((rc, i) => ({
    name: rc.type.charAt(0).toUpperCase() + rc.type.slice(1),
    value: rc.count,
    fill: ["#6366f1", "#8b5cf6", "#06b6d4", "#f97316", "#22c55e", "#eab308"][i % 6],
  }));

  return (
    <div className={`space-y-4 ${className}`}>
      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className={`${recStyle.bg} border-0`}>
          <CardContent className="p-4 flex items-center gap-3">
            <RecIcon className={`h-8 w-8 ${recStyle.color} flex-shrink-0`} />
            <div>
              <p className="text-xs text-muted-foreground">Recommendation</p>
              <p className={`text-sm font-bold ${recStyle.color}`}>{recStyle.label}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Package className="h-8 w-8 text-indigo-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Packages to Upgrade</p>
              <p className="text-xl font-bold">{totalPackages}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className={`h-8 w-8 flex-shrink-0 ${totalBreakingChanges > 0 ? "text-orange-500" : "text-green-500"}`} />
            <div>
              <p className="text-xs text-muted-foreground">Breaking Changes</p>
              <p className="text-xl font-bold">{totalBreakingChanges}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Shield className={`h-8 w-8 flex-shrink-0 ${highRiskCount > 0 ? "text-red-500" : "text-green-500"}`} />
            <div>
              <p className="text-xs text-muted-foreground">Avg Compatibility</p>
              <p className="text-xl font-bold" style={{ color: getColor(avgCompat) }}>{avgCompat}%</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Row: Compatibility & Risk Bar + Radar ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {stackChartData.length > 0 && (
          <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={() => openDetail(
            "perStackScores",
            "Compatibility & Risk by Package",
            [
              { label: "Packages Analyzed", value: perStackScores.length },
              { label: "Avg Compatibility", value: `${avgCompat}%` },
              { label: "High Risk Packages", value: highRiskCount },
              { label: "Total Breaking Changes", value: totalBreakingChanges },
            ],
            [{
              heading: "Per-Package Breakdown",
              items: perStackScores.map(s => ({
                title: `${s.name} (${s.currentVersion} → ${s.targetVersion})`,
                subtitle: `Compatibility: ${s.compatibilityScore}% | Risk: ${s.riskScore}% | Breaking changes: ${s.breakingChangesCount} | Effort: ${s.effort}`,
                badge: s.riskScore >= 60 ? { text: "high risk", variant: "destructive" as const } : s.riskScore >= 30 ? { text: "medium risk" } : { text: "low risk", variant: "outline" as const },
              })),
            }]
          )}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Compatibility & Risk by Package</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stackChartData} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload?.length) return null;
                        const d = payload[0]?.payload;
                        return (
                          <div className="bg-background border rounded p-2 text-xs shadow-lg">
                            <p className="font-medium">{d?.fullName}</p>
                            <p>Compatibility: {d?.compatibility}%</p>
                            <p>Risk: {d?.risk}%</p>
                            <p>Breaking changes: {d?.breaking}</p>
                            <Badge variant="outline" className="text-[10px] mt-1">{d?.category}</Badge>
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="compatibility" name="Compatibility" fill="#22c55e" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="risk" name="Risk" fill="#ef4444" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {radarData.length > 0 && (
          <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={() => openDetail(
            "overallHealth",
            "Overall Upgrade Health",
            radarData.map(r => ({ label: r.subject, value: `${r.value}/100` })),
            [{
              heading: "Health Dimension Details",
              items: radarData.map(r => ({
                title: r.subject,
                subtitle: r.value >= 70 ? "Good — minimal concerns" : r.value >= 40 ? "Moderate — some attention needed" : "Poor — significant work required",
                badge: r.value >= 70 ? { text: `${r.value}/100`, variant: "outline" as const } : r.value >= 40 ? { text: `${r.value}/100` } : { text: `${r.value}/100`, variant: "destructive" as const },
              })),
            }]
          )}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Overall Upgrade Health</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 8 }} />
                    <Radar name="Health" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Row: Effort Distribution + Severity Distribution + Required Changes ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {effortPieData.length > 0 && (
          <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={() => openDetail(
            "effortDistribution",
            "Effort Distribution",
            effortPieData.map(d => ({ label: d.name, value: `${d.value} task(s)` })),
            [{
              heading: "Effort Levels Explained",
              items: [
                { title: "Trivial", subtitle: "Less than 1 hour — automated or single-line changes" },
                { title: "Low", subtitle: "1-4 hours — straightforward changes with clear migration path" },
                { title: "Medium", subtitle: "4-8 hours — requires careful analysis and testing" },
                { title: "High", subtitle: "8-16 hours — significant refactoring with multiple dependencies" },
                { title: "Very High", subtitle: "16+ hours — architectural changes or complete rewrites" },
              ],
            }]
          )}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Effort Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={effortPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                      label={PIE_LABEL}
                      labelLine={false}
                    >
                      {effortPieData.map((d, i) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2 mt-1 justify-center">
                {effortPieData.map((d, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px]">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: d.fill }} />
                    {d.name}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {severityPieData.length > 0 && (
          <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={() => openDetail(
            "severityDistribution",
            "Breaking Change Severity",
            severityPieData.map(d => ({ label: d.name, value: `${d.value} change(s)` })),
            [{
              heading: "Severity Levels Explained",
              items: [
                { title: "Critical", subtitle: "Blocks compilation — removal of core APIs, type system changes, or namespace reorganizations", badge: { text: "critical" } },
                { title: "Major", subtitle: "Affects runtime behavior — method signature changes, parameter reordering, or default value modifications", badge: { text: "major" } },
                { title: "Minor", subtitle: "Deprecation warnings — APIs still work but are marked for future removal", badge: { text: "minor", variant: "secondary" as const } },
              ],
            }]
          )}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Breaking Change Severity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={severityPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                      label={PIE_LABEL}
                      labelLine={false}
                    >
                      {severityPieData.map((d, i) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2 mt-1 justify-center">
                {severityPieData.map((d, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px]">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: d.fill }} />
                    {d.name}: {d.value}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {requiredChangePieData.length > 0 && (
          <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={() => openDetail(
            "severityDistribution",
            "Required Changes by Type",
            requiredChangePieData.map(d => ({ label: d.name, value: `${d.value} change(s)` })),
            [{
              heading: "Change Categories",
              items: requiredChanges.map(rc => ({
                title: rc.type.charAt(0).toUpperCase() + rc.type.slice(1),
                subtitle: `${rc.count} change(s) required in this category`,
              })),
            }]
          )}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Required Changes by Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={requiredChangePieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                      label={PIE_LABEL}
                      labelLine={false}
                    >
                      {requiredChangePieData.map((d, i) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2 mt-1 justify-center">
                {requiredChangePieData.map((d, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px]">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: d.fill }} />
                    {d.name}: {d.value}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Row: Upgrade Order + Key Insights ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {upgradeOrder.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4" /> Recommended Upgrade Order
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2">
                {upgradeOrder.map((pkg, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-bold">
                      {i + 1}
                    </span>
                    <span className="font-medium">{pkg}</span>
                    {i < upgradeOrder.length - 1 && (
                      <ArrowRight className="h-3 w-3 text-muted-foreground ml-auto" />
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        )}

        {keyInsights.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-yellow-500" /> Key Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {keyInsights.slice(0, 6).map((insight, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                    <span className="text-yellow-500 mt-0.5 flex-shrink-0">•</span>
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Package Detail Table ── */}
      {perStackScores.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Package Upgrade Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4">Package</th>
                    <th className="text-left py-2 pr-4">Current</th>
                    <th className="text-left py-2 pr-4">Target</th>
                    <th className="text-center py-2 pr-4">Compat</th>
                    <th className="text-center py-2 pr-4">Risk</th>
                    <th className="text-center py-2 pr-4">Breaking</th>
                    <th className="text-center py-2">Effort</th>
                  </tr>
                </thead>
                <tbody>
                  {perStackScores.map((s, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium">{s.name}</td>
                      <td className="py-2 pr-4 font-mono">{s.currentVersion}</td>
                      <td className="py-2 pr-4 font-mono">{s.targetVersion}</td>
                      <td className="py-2 pr-4 text-center">
                        <span style={{ color: getColor(s.compatibilityScore) }} className="font-bold">{s.compatibilityScore}%</span>
                      </td>
                      <td className="py-2 pr-4 text-center">
                        <span style={{ color: getColor(100 - s.riskScore) }} className="font-bold">{s.riskScore}%</span>
                      </td>
                      <td className="py-2 pr-4 text-center">{s.breakingChangesCount}</td>
                      <td className="py-2 text-center">
                        <Badge variant="outline" className="text-[10px] capitalize">{s.effort}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {detailModal && (
        <ChartDetailModal
          open={!!detailModal}
          onOpenChange={(open) => { if (!open) setDetailModal(null); }}
          title={detailModal.title}
          methodology={CHART_METHODOLOGIES[detailModal.key] || "Analysis based on planning phase data and risk assessment."}
          dataTable={detailModal.dataRows}
          detailSections={detailModal.detailSections}
          onDownloadPdf={onDownloadChartPdf ? () => onDownloadChartPdf(detailModal.key) : undefined}
        />
      )}
    </div>
  );
}
