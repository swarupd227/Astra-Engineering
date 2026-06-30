import { DashboardHeader } from "@/components/dashboard/header";
import { Card } from "@/components/ui/card";
import { Code2 } from "lucide-react";

export default function CodeReviewPage() {
  return (
    <div className="h-full flex flex-col">
      <DashboardHeader />
      <main className="flex-1 overflow-auto">
        <div className="px-8 py-12">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <Code2 className="w-8 h-8 text-cyan-500" />
              <h1 className="text-3xl font-bold text-foreground">Code Review & QA</h1>
            </div>
            <p className="text-muted-foreground">Intelligent code analysis with automated quality checks</p>
          </div>

          <div className="grid gap-6">
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Automated Code Analysis</h2>
              <p className="text-muted-foreground">
                Review pull requests and identify potential issues before deployment. Our AI agents analyze code quality, security vulnerabilities, and best practices automatically.
              </p>
            </Card>

            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Features</h2>
              <ul className="space-y-2 text-muted-foreground list-disc list-inside">
                <li>Automated code quality checks</li>
                <li>Pull request analysis</li>
                <li>Best practice recommendations</li>
                <li>Vulnerability detection</li>
                <li>Performance optimization suggestions</li>
              </ul>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
