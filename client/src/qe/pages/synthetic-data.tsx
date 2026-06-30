import { DashboardHeader } from "../components/dashboard/header";
import { SyntheticTestDataPanelQe } from "../../components/sdlc/synthetic-test-data-panel";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function SyntheticDataPage() {
  const urlParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const projectName = urlParams.get("projectName");
  const organization = urlParams.get("organization");
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-col h-screen">
      <DashboardHeader />
      <main className="flex-1 overflow-auto bg-background/50">
        <div className="px-6 pt-12 pb-8 max-w-[1200px] mx-auto w-full">
          <div className="flex items-center justify-start mb-6">
            <Button
              variant="ghost"
              onClick={() => setLocation("/dashboard")}
              className="flex items-center gap-2 group text-muted-foreground hover:text-primary transition-all duration-300 -ml-2"
            >
              <div className="p-1 rounded-full bg-primary/10 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                <ArrowLeft className="h-4 w-4" />
              </div>
              <span className="font-semibold tracking-tight text-sm uppercase">{"Dashboard"}</span>
            </Button>
          </div>
          <SyntheticTestDataPanelQe projectName={projectName} organization={organization} />
        </div>
      </main>
    </div>
  );
}
