import { DashboardHeader } from "@/components/dashboard/header";
import { Card } from "@/components/ui/card";
import { Brain } from "lucide-react";

export default function RAGTestingPage() {
  return (
    <div className="h-full flex flex-col">
      <DashboardHeader />
      <main className="flex-1 overflow-auto">
        <div className="px-8 py-12">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <Brain className="w-8 h-8 text-cyan-500" />
              <h1 className="text-3xl font-bold text-foreground">Agentic RAG Enabled</h1>
            </div>
            <p className="text-muted-foreground">AI-powered retrieval and generation for intelligent testing</p>
          </div>

          <div className="grid gap-6">
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Knowledge-Driven Testing</h2>
              <p className="text-muted-foreground">
                Learn from your test history and documentation to improve test coverage and accuracy. Our intelligent system retrieves relevant test cases and generates new ones based on patterns and best practices.
              </p>
            </Card>

            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Capabilities</h2>
              <ul className="space-y-2 text-muted-foreground list-disc list-inside">
                <li>Knowledge base integration</li>
                <li>Intelligent test case generation</li>
                <li>Pattern recognition from history</li>
                <li>Context-aware recommendations</li>
                <li>Continuous learning</li>
              </ul>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
