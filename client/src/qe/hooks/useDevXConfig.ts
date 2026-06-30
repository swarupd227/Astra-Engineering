import { useQuery } from "@tanstack/react-query";
import { devxFetch } from "@/lib/queryClient";
import { useProject } from "@/contexts/ProjectContext";

export function useDevXAdoSettings() {
  const { isFromDevx, devxContext } = useProject();
  return useQuery({
    queryKey: ["devx-ado-settings", devxContext.organization],
    queryFn: async () => {
      const res = await devxFetch(`/api/ado/settings`);
      if (!res.ok) throw new Error("Failed to fetch ADO settings");
      return res.json();
    },
    enabled: isFromDevx,
  });
}

export function useDevXArtifactOrgs() {
  const { isFromDevx } = useProject();
  return useQuery({
    queryKey: ["devx-artifact-orgs"],
    queryFn: async () => {
      const res = await devxFetch(`/api/artifact-organizations`);
      if (!res.ok) throw new Error("Failed to fetch artifact orgs");
      return res.json();
    },
    enabled: isFromDevx,
  });
}

export function useDevXAdoProjects(organization?: string) {
  const { isFromDevx, devxContext } = useProject();
  const org = organization || devxContext.organization;
  return useQuery({
    queryKey: ["devx-ado-projects", org],
    queryFn: async () => {
      const res = await devxFetch(`/api/ado-projects?organization=${encodeURIComponent(org || "")}`);
      if (!res.ok) throw new Error("Failed to fetch ADO projects");
      return res.json();
    },
    enabled: isFromDevx && !!org,
  });
}

export function useDevXGoldenRepo(projectId?: string) {
  const { isFromDevx, devxContext } = useProject();
  const pid = projectId || devxContext.sdlcProjectId;
  return useQuery({
    queryKey: ["devx-golden-repo", pid],
    queryFn: async () => {
      const res = await devxFetch(`/api/sdlc/projects/${pid}/golden-repo`);
      if (!res.ok) throw new Error("Failed to fetch golden repo");
      return res.json();
    },
    enabled: isFromDevx && !!pid,
  });
}

export function useDevXJiraSettings() {
  const { isFromDevx } = useProject();
  return useQuery({
    queryKey: ["devx-jira-settings"],
    queryFn: async () => {
      const res = await devxFetch(`/api/jira/settings`);
      if (!res.ok) throw new Error("Failed to fetch Jira settings");
      return res.json();
    },
    enabled: isFromDevx,
  });
}

export function useDevXIntegrationSettings() {
  const { isFromDevx } = useProject();
  return useQuery({
    queryKey: ["devx-integration-settings"],
    queryFn: async () => {
      const res = await devxFetch(`/api/integration-settings`);
      if (!res.ok) throw new Error("Failed to fetch integration settings");
      return res.json();
    },
    enabled: isFromDevx,
  });
}
