import { DashboardHeader } from "@/components/dashboard/header";
import { Card } from "@/components/ui/card";
import { Shield } from "lucide-react";

export default function SecurityTestingPage() {
  return (
    <div className="h-full flex flex-col">
      <DashboardHeader />
      <main className="flex-1 overflow-auto">
        <div className="px-8 py-12">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <Shield className="w-8 h-8 text-cyan-500" />
              <h1 className="text-3xl font-bold text-foreground">Security Testing</h1>
            </div>
            <p className="text-muted-foreground">Protect your applications from common threats</p>
          </div>

          <div className="grid gap-6">
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Automated Security Scanning</h2>
              <p className="text-muted-foreground">
                Automated vulnerability scanning and security compliance checks. Identify and fix security issues before they become threats.
              </p>
            </Card>

            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Security Checks</h2>
              <ul className="space-y-2 text-muted-foreground list-disc list-inside">
                <li>Vulnerability scanning</li>
                <li>OWASP compliance</li>
                <li>SQL injection detection</li>
                <li>Authentication testing</li>
                <li>Authorization validation</li>
              </ul>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
