import type {
  CatalogToolItem,
  OrgIntegrationConfigRow,
  ToolConfigState,
} from "./types";
import { ToolIntegrationsReviewBlock } from "./tool-integrations-review-block";

export interface CreateProjectReviewStepProps {
  projectName: string;
  description: string;
  jiraConnectionId: string;
  jiraProjectKey: string;
  jiraConnections: Array<{ id: string; name?: string; instanceUrl?: string }>;
  selectedRepoIds: string[];
  safeRepositories: Array<{ id: string | number; name: string }>;
  goldenFileMode: "all" | "custom";
  groupedCatalog: Record<string, CatalogToolItem[]>;
  orgByCategory: Record<string, OrgIntegrationConfigRow | undefined>;
  skippedCategories: Record<string, boolean>;
  inheritFromOrg: Record<string, boolean>;
  toolConfigs: Record<string, ToolConfigState>;
}

export function CreateProjectReviewStep({
  projectName,
  description,
  jiraConnectionId,
  jiraProjectKey,
  jiraConnections,
  selectedRepoIds,
  safeRepositories,
  goldenFileMode,
  groupedCatalog,
  orgByCategory,
  skippedCategories,
  inheritFromOrg,
  toolConfigs,
}: CreateProjectReviewStepProps) {
  const jiraConn = jiraConnections.find((c) => c.id === jiraConnectionId);
  const repoName =
    selectedRepoIds.length > 0
      ? safeRepositories.find((r) => String(r.id) === selectedRepoIds[0])?.name
      : null;

  return (
    <div className="text-sm space-y-6">
      <div className="rounded-2xl border border-border/40 border-l-[3px] border-l-blue-500 bg-card p-4 shadow-sm">
        <h3 className="mb-2 font-semibold text-foreground">Project</h3>
        <dl className="text-muted-foreground grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide">Name</dt>
            <dd className="text-foreground">{projectName || "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide">Jira connection</dt>
            <dd className="text-foreground">
              {jiraConn?.name || jiraConn?.instanceUrl || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide">Project key</dt>
            <dd className="text-foreground">{jiraProjectKey || "—"}</dd>
          </div>
          {description?.trim() && (
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide">Description</dt>
              <dd className="text-foreground whitespace-pre-wrap">{description}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="rounded-2xl border border-border/40 border-l-[3px] border-l-amber-500 bg-card p-4 shadow-sm">
        <h3 className="mb-2 font-semibold text-foreground">Golden repository</h3>
        {selectedRepoIds.length === 0 ? (
          <p className="text-muted-foreground">Not linked</p>
        ) : (
          <p className="text-foreground">
            {repoName || "Selected"} — file scope:{" "}
            <span className="font-medium">
              {goldenFileMode === "all" ? "All files" : "Custom files"}
            </span>
          </p>
        )}
      </div>

      <ToolIntegrationsReviewBlock
        groupedCatalog={groupedCatalog}
        orgByCategory={orgByCategory}
        skippedCategories={skippedCategories}
        inheritFromOrg={inheritFromOrg}
        toolConfigs={toolConfigs}
      />
    </div>
  );
}
