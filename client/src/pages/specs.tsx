import { useLocation, useSearch } from "wouter";
import { DevelopmentSpecsModal } from "@/components/sdlc/development-specs-modal";
import {
  GLOBAL_ALL_ORGANIZATIONS_ID,
  useSelectedOrganization,
} from "@/contexts/selected-organization-context";

export default function SpecsPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { selectedOrganization: globalSelectedOrganization } =
    useSelectedOrganization();

  const params = new URLSearchParams(search);
  const projectId = params.get("projectId") || "";
  const organization =
    params.get("organization") ||
    (globalSelectedOrganization &&
    globalSelectedOrganization.id !== GLOBAL_ALL_ORGANIZATIONS_ID
      ? globalSelectedOrganization.name
      : "");
  const projectName = params.get("projectName") || "";
  const organizationUrl = params.get("organizationUrl") || organization;
  const integrationType = params.get("integrationType") || "ado";

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          Missing <code>projectId</code> in URL. Go back to the SDLC page and open Specs again.
        </p>
      </div>
    );
  }

  const adoProject: ADOProject = {
    id: projectId,
    name: projectName,
    organization,
    organizationUrl,
    integrationType: (integrationType as "ado" | "jira") || "ado",
  };

  const handleBackToSdlc = () => {
    const backParams = new URLSearchParams();
    if (organization) backParams.set("organization", organization);
    if (projectId) backParams.set("projectId", projectId);
    if (projectName) backParams.set("projectName", projectName);
    backParams.set("phase", "3");

    const query = backParams.toString();
    setLocation(query ? `/sdlc?${query}` : "/sdlc");
  };

  return (
    <div className="w-full max-w-full overflow-hidden min-w-0 h-full">
      <DevelopmentSpecsModal
        projectId={projectId}
        adoProject={adoProject}
        open={true}
        onClose={handleBackToSdlc}
        integrationType={integrationType}
      />
    </div>
  );
}

