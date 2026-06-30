import { useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SyntheticTestDataPanelCore } from "@/components/sdlc/synthetic-test-data-panel";
import { useDomain } from "@/contexts/domain-context";

export default function TestDataGenerationPage() {
  const [, params] = useRoute("/test-data-generation/:projectId?");
  const projectId = params?.projectId;
  const [, setLocation] = useLocation();
  const { selectedDomain, setSelectedDomain } = useDomain();
  const urlParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const projectName = urlParams.get("projectName");
  const organization = urlParams.get("organization");
  const domainFromUrl = "all";

  const hasAppliedDomain = useRef(false);
  useEffect(() => {
    if (hasAppliedDomain.current) return;
    if (domainFromUrl && domainFromUrl !== selectedDomain) {
      setSelectedDomain(domainFromUrl);
    }
    hasAppliedDomain.current = true;
  }, [domainFromUrl, selectedDomain, setSelectedDomain]);

  const handleBack = () => {
    const backParams = new URLSearchParams();
    if (organization) backParams.set("organization", organization);
    if (projectId) backParams.set("projectId", projectId);
    if (projectName) backParams.set("projectName", projectName);
    backParams.set("phase", "4");

    const query = backParams.toString();
    setLocation(query ? `/sdlc?${query}` : "/sdlc");
  };

  return (
    <div className="p-6">
      <div className="max-w-[1200px] mx-auto">
        <SyntheticTestDataPanelCore
          projectName={projectName}
          organization={organization}
          headerActions={
            <Button variant="outline" size="sm" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to SDLC
            </Button>
          }
        />
      </div>
    </div>
  );
}
