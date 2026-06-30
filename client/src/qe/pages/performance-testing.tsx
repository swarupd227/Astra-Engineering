import { DashboardHeader } from "@/components/dashboard/header";
import { Card } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

export default function PerformanceTestingPage() {
  return (
    <div className="h-full flex flex-col">
      <DashboardHeader />
      <main className="flex-1 overflow-auto">
        <div className="px-8 py-12">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <BarChart3 className="w-8 h-8 text-cyan-500" />
              <h1 className="text-3xl font-bold text-foreground">Performance Monitoring</h1>
            </div>
            <p className="text-muted-foreground">Track metrics and optimize your testing strategy</p>
          </div>

          <div className="grid gap-6">
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Real-Time Analytics</h2>
              <p className="text-muted-foreground">
                Track test metrics, execution times, and coverage trends. Get actionable insights to optimize your testing strategy and improve overall quality.
              </p>
            </Card>

            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Key Metrics</h2>
              <ul className="space-y-2 text-muted-foreground list-disc list-inside">
                <li>Test execution time</li>
                <li>Code coverage percentage</li>
                <li>Pass/fail rates</li>
                <li>Performance trends</li>
                <li>Quality metrics</li>
              </ul>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
