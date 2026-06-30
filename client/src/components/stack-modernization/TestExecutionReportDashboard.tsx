import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  TestTube2,
  BarChart3,
  Timer,
  TrendingUp,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface TestExecutionReportDashboardProps {
  validationRun?: {
    testsRun?: number;
    testsPassed?: number;
    testsFailed?: number;
    testsSkipped?: number;
    status?: string;
    exitCode?: number;
    lastLogs?: string;
  };
  generatedTests?: Array<{
    filePath: string;
    testFramework: string;
    testCases?: string[];
    taskId?: string;
    taskTitle?: string;
  }>;
}

const COLORS = {
  passed: "#22c55e",
  failed: "#ef4444",
  skipped: "#eab308",
};

export function TestExecutionReportDashboard({
  validationRun,
  generatedTests,
}: TestExecutionReportDashboardProps) {
  const total = validationRun?.testsRun ?? 0;
  const passed = validationRun?.testsPassed ?? 0;
  const failed = validationRun?.testsFailed ?? 0;
  const skipped = validationRun?.testsSkipped ?? 0;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";
  const testFiles = generatedTests ?? [];

  const donutData = [
    { name: "Passed", value: passed, color: COLORS.passed },
    { name: "Failed", value: failed, color: COLORS.failed },
    { name: "Skipped", value: skipped, color: COLORS.skipped },
  ].filter((d) => d.value > 0);

  // Per-file bar data: distribute counts proportionally if per-file data is unavailable
  const perFileData = buildPerFileData(testFiles, passed, failed, skipped);

  // Task-based heatmap
  const taskMap = new Map<string, { passed: number; failed: number; skipped: number; total: number }>();
  for (const t of testFiles) {
    const key = t.taskTitle || t.taskId || "General";
    if (!taskMap.has(key)) taskMap.set(key, { passed: 0, failed: 0, skipped: 0, total: 0 });
    const entry = taskMap.get(key)!;
    const cases = t.testCases?.length ?? 1;
    entry.total += cases;
    entry.passed += cases;
  }
  // Adjust totals to match actual results
  if (taskMap.size > 0 && total > 0) {
    const sumCases = [...taskMap.values()].reduce((s, v) => s + v.total, 0);
    if (sumCases > 0) {
      for (const [, v] of taskMap) {
        const ratio = v.total / sumCases;
        v.passed = Math.round(passed * ratio);
        v.failed = Math.round(failed * ratio);
        v.skipped = Math.round(skipped * ratio);
        v.total = v.passed + v.failed + v.skipped;
      }
    }
  }
  const heatmapRows = [...taskMap.entries()].map(([task, data]) => ({
    task,
    ...data,
    status: data.failed > 0 ? "fail" : data.skipped > 0 ? "partial" : "pass",
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <TestTube2 className="h-5 w-5 text-violet-500" />
        <h3 className="text-lg font-semibold">Test Execution Report</h3>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard label="Total Tests" value={total} icon={<TestTube2 className="h-4 w-4 text-blue-500" />} />
        <SummaryCard label="Passed" value={passed} icon={<CheckCircle2 className="h-4 w-4 text-green-500" />} color="text-green-600" />
        <SummaryCard label="Failed" value={failed} icon={<XCircle className="h-4 w-4 text-red-500" />} color="text-red-600" />
        <SummaryCard label="Skipped" value={skipped} icon={<MinusCircle className="h-4 w-4 text-yellow-500" />} color="text-yellow-600" />
        <SummaryCard label="Pass Rate" value={`${passRate}%`} icon={<TrendingUp className="h-4 w-4 text-violet-500" />} color="text-violet-600" />
        <SummaryCard label="Test Files" value={testFiles.length} icon={<BarChart3 className="h-4 w-4 text-blue-500" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Donut chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pass / Fail Distribution</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {total > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    dataKey="value"
                    stroke="none"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {donutData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-sm text-muted-foreground py-8">No test data available</div>
            )}
          </CardContent>
        </Card>

        {/* Bar chart per file */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Results per Test File</CardTitle>
          </CardHeader>
          <CardContent>
            {perFileData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={perFileData} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="passed" stackId="a" fill={COLORS.passed} name="Passed" />
                  <Bar dataKey="failed" stackId="a" fill={COLORS.failed} name="Failed" />
                  <Bar dataKey="skipped" stackId="a" fill={COLORS.skipped} name="Skipped" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-sm text-muted-foreground py-8">No per-file data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Heatmap-style grid */}
      {heatmapRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Test Results by Section</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              <div className="grid grid-cols-[1fr_80px_80px_80px_80px_80px] text-xs font-medium text-muted-foreground border-b pb-1">
                <span>Section</span>
                <span className="text-center">Total</span>
                <span className="text-center">Passed</span>
                <span className="text-center">Failed</span>
                <span className="text-center">Skipped</span>
                <span className="text-center">Status</span>
              </div>
              {heatmapRows.map((row, i) => (
                <div
                  key={i}
                  className={`grid grid-cols-[1fr_80px_80px_80px_80px_80px] text-xs py-1.5 rounded px-1 ${
                    row.status === "fail"
                      ? "bg-red-50 dark:bg-red-950/20"
                      : row.status === "partial"
                      ? "bg-yellow-50 dark:bg-yellow-950/20"
                      : "bg-green-50 dark:bg-green-950/20"
                  }`}
                >
                  <span className="truncate font-medium">{row.task}</span>
                  <span className="text-center">{row.total}</span>
                  <span className="text-center text-green-600">{row.passed}</span>
                  <span className="text-center text-red-600">{row.failed}</span>
                  <span className="text-center text-yellow-600">{row.skipped}</span>
                  <span className="flex justify-center">
                    <Badge
                      variant={row.status === "fail" ? "destructive" : "outline"}
                      className={`text-[10px] ${
                        row.status === "pass"
                          ? "border-green-500 text-green-600"
                          : row.status === "partial"
                          ? "border-yellow-500 text-yellow-600"
                          : ""
                      }`}
                    >
                      {row.status === "pass" ? "PASS" : row.status === "fail" ? "FAIL" : "PARTIAL"}
                    </Badge>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Numerical report table */}
      {testFiles.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Timer className="h-4 w-4" />
              Detailed Test File Report
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 px-1">Test File</th>
                    <th className="text-left py-2 px-1">Framework</th>
                    <th className="text-center py-2 px-1">Cases</th>
                    <th className="text-center py-2 px-1">Task</th>
                  </tr>
                </thead>
                <tbody>
                  {testFiles.map((t, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-1.5 px-1 font-mono truncate max-w-[250px]">
                        {t.filePath.split("/").pop()}
                      </td>
                      <td className="py-1.5 px-1">
                        <Badge variant="outline" className="text-[10px]">{t.testFramework}</Badge>
                      </td>
                      <td className="py-1.5 px-1 text-center">{t.testCases?.length ?? 0}</td>
                      <td className="py-1.5 px-1 truncate max-w-[200px] text-muted-foreground">
                        {t.taskTitle || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className={`text-xl font-bold ${color ?? ""}`}>{value}</div>
    </Card>
  );
}

function buildPerFileData(
  testFiles: Array<{ filePath: string; testCases?: string[] }>,
  totalPassed: number,
  totalFailed: number,
  totalSkipped: number
) {
  if (testFiles.length === 0) return [];
  const totalCases = testFiles.reduce((s, t) => s + (t.testCases?.length ?? 1), 0);
  if (totalCases === 0) return [];

  return testFiles.map((t) => {
    const cases = t.testCases?.length ?? 1;
    const ratio = cases / totalCases;
    const name = t.filePath.split("/").pop()?.replace(/\.(test|spec)\.[^.]+$/, "") ?? t.filePath;
    return {
      name: name.length > 18 ? name.slice(0, 16) + "…" : name,
      passed: Math.round(totalPassed * ratio),
      failed: Math.round(totalFailed * ratio),
      skipped: Math.round(totalSkipped * ratio),
    };
  });
}
