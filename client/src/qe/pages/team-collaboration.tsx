import { DashboardHeader } from "@/components/dashboard/header";
import { Card } from "@/components/ui/card";
import { Users } from "lucide-react";

export default function TeamCollaborationPage() {
  return (
    <div className="h-full flex flex-col">
      <DashboardHeader />
      <main className="flex-1 overflow-auto">
        <div className="px-8 py-12">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-8 h-8 text-cyan-500" />
              <h1 className="text-3xl font-bold text-foreground">Multi-Team Support</h1>
            </div>
            <p className="text-muted-foreground">Collaborate seamlessly across teams</p>
          </div>

          <div className="grid gap-6">
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Team Collaboration</h2>
              <p className="text-muted-foreground">
                Collaborate seamlessly across QA, DevOps, and development teams. Real-time reporting and role-based access control ensure everyone has the right visibility.
              </p>
            </Card>

            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Features</h2>
              <ul className="space-y-2 text-muted-foreground list-disc list-inside">
                <li>Role-based access control</li>
                <li>Team workspaces</li>
                <li>Real-time collaboration</li>
                <li>Shared dashboards</li>
                <li>Activity reports</li>
              </ul>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
