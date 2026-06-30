import { DashboardHeader } from "@/components/dashboard/header";
import { Card } from "@/components/ui/card";
import { Accessibility } from "lucide-react";

export default function AccessibilityTestingPage() {
  return (
    <div className="h-full flex flex-col">
      <DashboardHeader />
      <main className="flex-1 overflow-auto">
        <div className="px-8 py-12">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <Accessibility className="w-8 h-8 text-cyan-500" />
              <h1 className="text-3xl font-bold text-foreground">Accessibility Compliance</h1>
            </div>
            <p className="text-muted-foreground">Automated WCAG AA compliance testing</p>
          </div>

          <div className="grid gap-6">
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">WCAG Compliance</h2>
              <p className="text-muted-foreground">
                Automated WCAG AA compliance testing. Detect contrast issues, keyboard navigation problems, and screen reader compatibility.
              </p>
            </Card>

            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Testing Criteria</h2>
              <ul className="space-y-2 text-muted-foreground list-disc list-inside">
                <li>Color contrast verification</li>
                <li>Keyboard navigation</li>
                <li>Screen reader compatibility</li>
                <li>Form accessibility</li>
                <li>Focus management</li>
              </ul>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
