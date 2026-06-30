import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@shared/qe-schema";
import type { SdlcProjectSummary } from "./types";
import { buildExportProjectOptions, ensureQeProjectFromSdlc } from "./utils";

const SELECTED_ORG_ID_KEY = "devx:selected-organization-id";
const SELECTED_ORG_NAME_KEY = "devx:selected-organization-name";

function devxOrgHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window === "undefined") return headers;

  const orgId = window.sessionStorage.getItem(SELECTED_ORG_ID_KEY);
  const orgName = window.sessionStorage.getItem(SELECTED_ORG_NAME_KEY);
  if (orgId) headers["x-organization-id"] = orgId;
  if (orgName) headers["x-organization-name"] = orgName;
  return headers;
}

function selectedOrgId(): string {
  if (typeof window === "undefined") return "all";
  return window.sessionStorage.getItem(SELECTED_ORG_ID_KEY) || "all";
}

export function useExportProjects() {
  const queryClient = useQueryClient();
  const [resolvedQeIds, setResolvedQeIds] = useState<Record<string, string>>({});
  const [resolvingValue, setResolvingValue] = useState<string | null>(null);
  const orgId = selectedOrgId();

  const { data: qeProjects = [], isLoading: qeLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: sdlcProjects = [] } = useQuery<SdlcProjectSummary[]>({
    queryKey: ["/api/qe/sdlc/projects", orgId],
    queryFn: async () => {
      const response = await fetch("/api/qe/sdlc/projects", {
        credentials: "include",
        headers: devxOrgHeaders(),
      });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const projectOptions = useMemo(
    () => buildExportProjectOptions(qeProjects, sdlcProjects),
    [qeProjects, sdlcProjects],
  );

  const resolveProjectId = useCallback(
    async (selectValue: string): Promise<string | null> => {
      const option = projectOptions.find((entry) => entry.selectValue === selectValue);
      if (!option) return null;
      if (option.qeProjectId) return option.qeProjectId;

      const cached = resolvedQeIds[selectValue];
      if (cached) return cached;

      if (!option.sdlcProject) return null;

      setResolvingValue(selectValue);
      try {
        const project = await ensureQeProjectFromSdlc(option.sdlcProject);
        if (!project?.id) return null;

        setResolvedQeIds((prev) => ({ ...prev, [selectValue]: project.id }));
        await queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
        return project.id;
      } finally {
        setResolvingValue(null);
      }
    },
    [projectOptions, resolvedQeIds, queryClient],
  );

  return {
    projectOptions,
    qeProjects,
    isLoading: qeLoading,
    isResolving: resolvingValue !== null,
    resolveProjectId,
  };
}
