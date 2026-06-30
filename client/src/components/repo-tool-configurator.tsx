import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plus, RefreshCw, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type RepoSummary = {
  id: string;
  name: string;
  defaultBranch?: string;
  webUrl?: string;
};

interface RepoToolConfiguratorProps {
  toolCatalogId: string;
  providerKey: string;
  providerLabel: string;
  values: Record<string, string>;
  onValuesChange: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  onConfigChanged?: () => void;
  onConnectionResult?: (status: "idle" | "testing" | "success" | "error", message?: string) => void;
  testStatus?: "idle" | "testing" | "success" | "error";
  testMessage?: string;
  preserveExistingCredentialHint?: boolean;
}

const SECRET_PLACEHOLDER = "********";

function sanitizeConfig(values: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(values || {}).filter(([, value]) => {
      const normalized = String(value || "").trim();
      return normalized && normalized !== SECRET_PLACEHOLDER;
    }),
  );
}

function getProviderBindings(providerKey: string) {
  switch (providerKey) {
    case "gitlab":
      return {
        createPlaceholder: "New GitLab repository name",
      };
    case "bitbucket":
      return {
        createPlaceholder: "New Bitbucket repository name",
      };
    case "azure_repos":
      return {
        createPlaceholder: "New Azure Repos repository name",
      };
    case "github":
    default:
      return {
        createPlaceholder: "New GitHub repository name",
      };
  }
}

function getSelectedRepoId(providerKey: string, values: Record<string, string>) {
  if (providerKey === "azure_repos") {
    return String(values.repositoryId || values.repository || "").trim();
  }
  if (providerKey === "gitlab") {
    return String(values.projectId || "").trim();
  }
  if (providerKey === "bitbucket") {
    return String(values.repositorySlug || "").trim();
  }
  return String(values.repository || "").trim();
}

function getCredentialField(providerKey: string) {
  switch (providerKey) {
    case "bitbucket":
      return {
        key: "appPassword",
        label: "App password",
        placeholder: "Bitbucket app password",
      };
    case "gitlab":
      return {
        key: "patToken",
        label: "Personal access token",
        placeholder: "GitLab personal access token",
      };
    case "github":
      return {
        key: "patToken",
        label: "Personal access token",
        placeholder: "GitHub personal access token",
      };
    case "azure_repos":
    default:
      return {
        key: "patToken",
        label: "PAT token",
        placeholder: "Azure DevOps PAT token",
      };
  }
}

function applyRepoSelection(
  providerKey: string,
  repo: RepoSummary,
  prev: Record<string, string>,
) {
  if (providerKey === "gitlab") {
    return {
      ...prev,
      projectId: repo.id,
    };
  }

  if (providerKey === "bitbucket") {
    return {
      ...prev,
      repositorySlug: repo.id,
      repository: repo.name,
    };
  }

  if (providerKey === "azure_repos") {
    return {
      ...prev,
      repositoryId: repo.id,
      repository: repo.name,
    };
  }

  return {
    ...prev,
    repository: repo.id,
  };
}

export function RepoToolConfigurator({
  toolCatalogId,
  providerKey,
  providerLabel,
  values,
  onValuesChange,
  onConnectionResult,
  testStatus: controlledTestStatus,
  testMessage: controlledTestMessage,
  preserveExistingCredentialHint = false,
}: RepoToolConfiguratorProps) {
  const [repositories, setRepositories] = useState<RepoSummary[]>([]);
  const [repositoryName, setRepositoryName] = useState("");
  const [repositoryError, setRepositoryError] = useState("");
  const [internalTestStatus, setInternalTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [internalTestMessage, setInternalTestMessage] = useState("");
  const bindings = useMemo(
    () => getProviderBindings(providerKey),
    [providerKey],
  );
  const selectedRepoId = getSelectedRepoId(providerKey, values);
  const credentialField = useMemo(
    () => getCredentialField(providerKey),
    [providerKey],
  );
  const credentialValue = values[credentialField.key] || "";
  const testStatus = controlledTestStatus ?? internalTestStatus;
  const testMessage = controlledTestMessage ?? internalTestMessage;
  const isTesting = testStatus === "testing";

  function reportConnectionResult(
    status: "idle" | "testing" | "success" | "error",
    message = "",
  ) {
    if (onConnectionResult) {
      onConnectionResult(status, message);
      return;
    }

    setInternalTestStatus(status);
    setInternalTestMessage(message);
  }

  function updateCredential(value: string) {
    onValuesChange((prev) => ({
      ...prev,
      [credentialField.key]: value,
    }));
    setRepositories([]);
    setRepositoryError("");
    reportConnectionResult("idle", "");
  }

  function applySelectedRepository(repo: RepoSummary) {
    onValuesChange((prev) => applyRepoSelection(providerKey, repo, prev));
  }

  useEffect(() => {
    if (testStatus === "idle") {
      setRepositories([]);
      setRepositoryError("");
    }
  }, [testStatus]);

  const connectMutation = useMutation({
    mutationFn: async () => {
      const config = sanitizeConfig(values);
      const testResponse = await apiRequest(
        "POST",
        `/api/tool-catalog/${toolCatalogId}/test`,
        { config },
      );
      const testResult = await testResponse.json().catch(() => ({}));
      if (!testResponse.ok || testResult.success === false) {
        throw new Error(
          testResult.message ||
            testResult.error ||
            "Connection test failed",
        );
      }

      const repoResponse = await apiRequest(
        "POST",
        `/api/tool-catalog/${toolCatalogId}/repositories`,
        { config },
      );
      const repoResult = (await repoResponse.json().catch(() => ({}))) as {
        repositories?: RepoSummary[];
        error?: string;
        message?: string;
      };
      if (!repoResponse.ok) {
        throw new Error(
          repoResult.error ||
            repoResult.message ||
            "Failed to load repositories",
        );
      }
      return repoResult;
    },
    onMutate: () => {
      setRepositoryError("");
      reportConnectionResult("testing", "Testing connection...");
    },
    onSuccess: (payload) => {
      const next = Array.isArray(payload.repositories) ? payload.repositories : [];
      setRepositories(next);
      if (next.length === 0) {
        const message = `Connection succeeded, but no ${providerLabel} repositories were returned.`;
        setRepositoryError(message);
        reportConnectionResult("error", message);
        return;
      }
      applySelectedRepository(next[0]);
      setRepositoryError("");
      reportConnectionResult(
        "success",
        `Connection successful. Selected ${next[0].name}.`,
      );
    },
    onError: (error: Error) => {
      const message = error.message || "Connection failed";
      setRepositoryError(message);
      setRepositories([]);
      reportConnectionResult("error", message);
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        `/api/tool-catalog/${toolCatalogId}/repositories/create`,
        {
          config: sanitizeConfig(values),
          name: repositoryName.trim(),
          visibility: "private",
        },
      );
      return (await response.json()) as { repository?: RepoSummary };
    },
    onSuccess: (payload) => {
      const repo = payload.repository;
      if (!repo) {
        setRepositoryError("Repository was created but not returned by the API.");
        return;
      }
      setRepositories((prev) => {
        const next = prev.filter((item) => item.id !== repo.id);
        return [repo, ...next];
      });
      onValuesChange((prev) => applyRepoSelection(providerKey, repo, prev));
      setRepositoryName("");
      setRepositoryError("");
      reportConnectionResult("success", `Connection successful. Selected ${repo.name}.`);
    },
    onError: (error: Error) => {
      setRepositoryError(error.message || "Failed to create repository");
    },
  });

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${providerKey}-repo-credential`}>
          {credentialField.label}
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={`${providerKey}-repo-credential`}
            type="password"
            value={credentialValue}
            onChange={(event) => updateCredential(event.target.value)}
            placeholder={credentialField.placeholder}
            autoComplete="off"
            className="sm:rounded-r-none"
            disabled={connectMutation.isPending || createMutation.isPending}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => connectMutation.mutate()}
            disabled={!credentialValue.trim() || connectMutation.isPending || createMutation.isPending}
            className="shrink-0 sm:rounded-l-none sm:border-l-0"
          >
            {connectMutation.isPending || isTesting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Test & load
          </Button>
        </div>
        {preserveExistingCredentialHint && !credentialValue.trim() && (
          <p className="text-xs text-muted-foreground">
            Leave blank to keep the existing repository PAT. Enter a new token only to replace it.
          </p>
        )}
      </div>

      {(repositories.length > 0 || selectedRepoId) && (
        <Select
          value={selectedRepoId || undefined}
          onValueChange={(value) => {
            const repo = repositories.find((item) => item.id === value);
            if (!repo) return;
            applySelectedRepository(repo);
            reportConnectionResult("success", `Connection successful. Selected ${repo.name}.`);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={`Select ${providerLabel} repository`} />
          </SelectTrigger>
          <SelectContent>
            {repositories.map((repo) => (
              <SelectItem key={repo.id} value={repo.id}>
                {repo.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={repositoryName}
          onChange={(e) => {
            setRepositoryName(e.target.value);
            if (repositoryError) setRepositoryError("");
          }}
          placeholder={bindings.createPlaceholder}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => createMutation.mutate()}
          disabled={testStatus !== "success" || !repositoryName.trim() || createMutation.isPending}
        >
          {createMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Create repo
        </Button>
      </div>

      {repositoryError ? (
        <p className="text-destructive text-xs">{repositoryError}</p>
      ) : testStatus === "success" ? (
        <p className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-500">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {testMessage || "Connection successful"}
        </p>
      ) : testStatus === "error" ? (
        <p className="text-destructive flex items-center gap-2 text-xs">
          <XCircle className="h-3.5 w-3.5" />
          {testMessage || "Connection failed"}
        </p>
      ) : repositories.length === 0 && !connectMutation.isPending ? (
        <p className="text-muted-foreground text-xs">
          Use Test & load to fetch repositories, or create a new repo here after connecting.
        </p>
      ) : null}
    </div>
  );
}
