/**
 * TestGenerationDashboard - Real-time cards showing test generation progress.
 * Displays total tests, per-task grouping, frameworks used, coverage targets, and files covered.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  TestTube2, FileCode2, CheckCircle2, Loader2, Layers, Shield,
} from "lucide-react";
import { ChartDetailModal, ChartDataRow, DetailSection, CHART_METHODOLOGIES } from "./ChartDetailModal";

interface GeneratedTest {
  filePath?: string;
  testCode?: string;
  testFramework?: string;
  coverageTarget?: string[];
  testCases?: string[];
  taskId?: string;
  taskTitle?: string;
}

export interface TestGenerationDashboardProps {
  generatedTests: GeneratedTest[];
  isGenerating?: boolean;
  className?: string;
}

const CHART_COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#22c55e", "#f97316", "#06b6d4", "#ec4899"];

export function TestGenerationDashboard({ generatedTests, isGenerating, className = "" }: TestGenerationDashboardProps) {
  const [detailModal, setDetailModal] = useState<{ key: string; title: string; dataRows: ChartDataRow[]; detailSections?: DetailSection[] } | null>(null);
  const tests = generatedTests || [];
  const totalTests = tests.length;

  // Framework distribution
  const frameworkMap = new Map<string, number>();
  for (const t of tests) {
    const fw = t.testFramework || "unknown";
    frameworkMap.set(fw, (frameworkMap.get(fw) || 0) + 1);
  }
  const frameworkData = [...frameworkMap.entries()].map(([name, count]) => ({ name, count }));

  // Per-task grouping
  const taskMap = new Map<string, { title: string; count: number }>();
  let ungrouped = 0;
  for (const t of tests) {
    if (t.taskId) {
      const existing = taskMap.get(t.taskId);
      if (existing) {
        existing.count++;
      } else {
        taskMap.set(t.taskId, { title: t.taskTitle || t.taskId, count: 1 });
      }
    } else {
      ungrouped++;
    }
  }
  const taskData = [...taskMap.values()].map((v) => ({
    name: v.title.length > 20 ? v.title.slice(0, 19) + "…" : v.title,
    count: v.count,
  }));
  if (ungrouped > 0) taskData.push({ name: "General", count: ungrouped });

  // Coverage targets
  const allTargets = new Set<string>();
  for (const t of tests) {
    for (const target of t.coverageTarget || []) {
      allTargets.add(target);
    }
  }

  // Total test cases
  const totalCases = tests.reduce((sum, t) => sum + (t.testCases?.length || 0), 0);

  // Files covered (source files being tested)
  const coveredFiles = new Set<string>();
  for (const t of tests) {
    if (t.filePath) {
      const srcPath = t.filePath
        .replace(/\.test\./g, ".")
        .replace(/\.spec\./g, ".")
        .replace(/Tests\//g, "")
        .replace(/tests\//g, "")
        .replace(/__tests__\//g, "");
      coveredFiles.add(srcPath);
    }
  }

  if (totalTests === 0 && !isGenerating) return null;

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Tests Generated */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2"><TestTube2 className="h-4 w-4" />Tests Generated</span>
              {isGenerating && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
              {!isGenerating && totalTests > 0 && <CheckCircle2 className="h-4 w-4 text-green-500" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {totalTests > 0 ? (
              <>
                <div className="text-2xl font-bold">{totalTests} <span className="text-sm font-normal text-muted-foreground">files</span></div>
                <div className="text-xs text-muted-foreground mt-1">
                  {totalCases > 0 && <span>{totalCases} test cases</span>}
                </div>
                {isGenerating && (
                  <div className="mt-2">
                    <Progress value={undefined} className="h-1.5 animate-pulse" />
                    <span className="text-[10px] text-blue-500 mt-0.5">Generating more...</span>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-3 w-32" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Frameworks */}
        <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={() => {
          const fwSections: DetailSection[] = frameworkData.map(fw => ({
            heading: `${fw.name} (${fw.count} test files)`,
            items: tests.filter(t => (t.testFramework || "unknown") === fw.name).map(t => ({
              title: t.filePath || "Unknown file",
              subtitle: t.testCases && t.testCases.length > 0 ? `${t.testCases.length} test case(s): ${t.testCases.slice(0, 3).join(", ")}${t.testCases.length > 3 ? "..." : ""}` : undefined,
              extra: t.taskTitle ? `Task: ${t.taskTitle}` : undefined,
            })),
          }));
          setDetailModal({ key: "testFrameworks", title: "Test Frameworks", dataRows: frameworkData.map(fw => ({ label: fw.name, value: `${fw.count} test(s)` })), detailSections: fwSections });
        }}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Layers className="h-4 w-4" />Frameworks</CardTitle>
          </CardHeader>
          <CardContent>
            {frameworkData.length > 0 ? (
              <>
                <div className="h-[80px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={frameworkData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={30} innerRadius={15}>
                        {frameworkData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {frameworkData.map((fw) => (
                    <Badge key={fw.name} variant="outline" className="text-[10px]">{fw.name} ({fw.count})</Badge>
                  ))}
                </div>
              </>
            ) : (
              <Skeleton className="h-[80px] w-full" />
            )}
          </CardContent>
        </Card>

        {/* Coverage Targets */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Shield className="h-4 w-4" />Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            {allTargets.size > 0 ? (
              <>
                <div className="text-2xl font-bold">{allTargets.size} <span className="text-sm font-normal text-muted-foreground">targets</span></div>
                <div className="mt-1 max-h-[60px] overflow-y-auto text-[10px] text-muted-foreground space-y-0.5">
                  {[...allTargets].slice(0, 8).map((t) => (
                    <div key={t} className="truncate">{t}</div>
                  ))}
                  {allTargets.size > 8 && <div>+{allTargets.size - 8} more</div>}
                </div>
              </>
            ) : totalTests > 0 ? (
              <div className="text-sm text-muted-foreground">Analyzing coverage...</div>
            ) : (
              <Skeleton className="h-[80px] w-full" />
            )}
          </CardContent>
        </Card>

        {/* Files Covered */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><FileCode2 className="h-4 w-4" />Files Tested</CardTitle>
          </CardHeader>
          <CardContent>
            {totalTests > 0 ? (
              <>
                <div className="text-2xl font-bold">{coveredFiles.size} <span className="text-sm font-normal text-muted-foreground">source files</span></div>
                <div className="mt-1 max-h-[60px] overflow-y-auto text-[10px] text-muted-foreground font-mono space-y-0.5">
                  {[...coveredFiles].slice(0, 5).map((f) => (
                    <div key={f} className="truncate">{f}</div>
                  ))}
                  {coveredFiles.size > 5 && <div>+{coveredFiles.size - 5} more</div>}
                </div>
              </>
            ) : (
              <Skeleton className="h-[80px] w-full" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-task breakdown bar chart */}
      {taskData.length > 1 && (
        <Card className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onDoubleClick={() => {
          const taskSections: DetailSection[] = [...taskMap.entries()].map(([taskId, v]) => ({
            heading: `${v.title} (${v.count} test files)`,
            items: tests.filter(t => t.taskId === taskId).map(t => ({
              title: t.filePath || "Unknown file",
              subtitle: t.testCases && t.testCases.length > 0 ? `${t.testCases.length} case(s): ${t.testCases.slice(0, 3).join(", ")}${t.testCases.length > 3 ? "..." : ""}` : undefined,
              badge: t.testFramework ? { text: t.testFramework, variant: "outline" as const } : undefined,
            })),
          }));
          if (ungrouped > 0) {
            taskSections.push({
              heading: `General (${ungrouped} test files)`,
              items: tests.filter(t => !t.taskId).map(t => ({
                title: t.filePath || "Unknown file",
                subtitle: t.testCases && t.testCases.length > 0 ? `${t.testCases.length} case(s)` : undefined,
              })),
            });
          }
          setDetailModal({ key: "testFrameworks", title: "Tests by Upgrade Task", dataRows: taskData.map(t => ({ label: t.name, value: `${t.count} test(s)` })), detailSections: taskSections });
        }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Tests by Upgrade Task</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={taskData} layout="vertical" margin={{ left: 10 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Tests" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {detailModal && (
        <ChartDetailModal
          open={!!detailModal}
          onOpenChange={(open) => { if (!open) setDetailModal(null); }}
          title={detailModal.title}
          methodology={CHART_METHODOLOGIES[detailModal.key] || "Analysis based on test generation results and code coverage mapping."}
          dataTable={detailModal.dataRows}
          detailSections={detailModal.detailSections}
        />
      )}
    </div>
  );
}
