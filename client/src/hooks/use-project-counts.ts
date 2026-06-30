import { useQuery } from "@tanstack/react-query";
import {
  ADO_PROJECTS_API_ROOT,
  fetchOrganizationProjectCounts,
  fetchProjectCountForOrg,
  ORGANIZATION_CARD_COUNTS_KEY,
  OVERVIEW_PROJECT_COUNT_KEY,
  type OrganizationProjectCounts,
} from "@/lib/project-counts";

export function useProjectCountForOrg(
  orgParam: string,
  enabled = true
) {
  return useQuery<{ totalCount: number }>({
    queryKey: [ADO_PROJECTS_API_ROOT, OVERVIEW_PROJECT_COUNT_KEY, orgParam],
    queryFn: async () => ({
      totalCount: await fetchProjectCountForOrg(orgParam),
    }),
    enabled: enabled && !!orgParam,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useOrganizationProjectCounts(
  orgIds: string[],
  scopeKey = "anonymous"
) {
  const orgIdsKey = orgIds.join(",");

  return useQuery<OrganizationProjectCounts>({
    queryKey: [ADO_PROJECTS_API_ROOT, ORGANIZATION_CARD_COUNTS_KEY, scopeKey, orgIdsKey],
    queryFn: () => fetchOrganizationProjectCounts(orgIds),
    enabled: orgIds.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
