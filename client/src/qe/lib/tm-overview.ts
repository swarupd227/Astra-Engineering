import { queryClient } from "@/lib/queryClient";

export const TM_OVERVIEW_QUERY_KEY = "tm-overview";

export function tmOverviewQueryKey(tmQuery: string) {
  return [TM_OVERVIEW_QUERY_KEY, tmQuery] as const;
}

/** Call after any test execution completes so Overview refreshes immediately. */
export function invalidateTmOverview() {
  void queryClient.invalidateQueries({ queryKey: [TM_OVERVIEW_QUERY_KEY] });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("tm-overview-updated"));
  }
}
