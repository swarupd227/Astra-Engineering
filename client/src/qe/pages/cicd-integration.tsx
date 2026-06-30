import { DashboardHeader } from "@/components/dashboard/header";
import { Card } from "@/components/ui/card";
import { GitBranch } from "lucide-react";

export default function CICDIntegrationPage() {
  return (
    <div className="h-full flex flex-col">
      <DashboardHeader />
      <main className="flex-1 overflow-auto">
        <div className="px-8 py-12">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <GitBranch className="w-8 h-8 text-cyan-500" />
              <h1 className="text-3xl font-bold text-foreground">CI/CD Compatible</h1>
            </div>
            <p className="text-muted-foreground">Seamless integration with your development pipeline</p>
          </div>

          <div className="grid gap-6">
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Pipeline Integration</h2>
              <p className="text-muted-foreground">
                Seamless integration with GitHub, GitLab, and Jenkins. Automate testing in your existing development pipeline and get instant feedback on every commit.
              </p>
            </Card>

            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Supported Platforms</h2>
              <ul className="space-y-2 text-muted-foreground list-disc list-inside">
                <li>GitHub Actions</li>
                <li>GitLab CI/CD</li>
                <li>Jenkins</li>
                <li>AWS CodePipeline</li>
                <li>Azure DevOps</li>
              </ul>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
