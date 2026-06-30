import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Workflow, Play, Rocket, Plus, RefreshCw, Cloud, CheckCircle2, ShieldCheck, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiRequest } from "@/lib/queryClient";
import { getApiUrl } from "@/lib/api-config";
import { useToast } from "@/hooks/use-toast";
import { useMsal } from "@azure/msal-react";
import { azureManagementRequest } from "@/config/msalConfig";
import { useAdoAllowed } from "@/hooks/use-hosting-config";

type WizardStep = "basics" | "mode" | "stages" | "infra" | "execution";
type SetupMode = "existingYaml" | "template" | "newPipeline";
type InitialAction = "createNew" | "runExisting" | null;
type StageNode = { id: string; name: string; jobs: string[] };
type RuntimeVar = { key: string; value: string };
type AzureSubscription = { id: string; displayName: string; state?: string };
type AzureResourceGroup = { name: string; location: string; id: string };
type PipelineExecutionResult = {
  variant: "success" | "warning" | "error";
  title: string;
  message: string;
  filePath?: string;
  branch?: string;
  pipeline?: {
    id?: string | number;
    status?: string;
    web_url?: string;
  } | null;
};
type ProviderCapabilities = {
  supportsPipelineNameCreate: boolean;
  supportsCustomTriggerName: boolean;
  supportsServerLint: boolean;
  supportsRunWithoutCommit: boolean;
  supportsMultiplePipelines: boolean;
  requiresYamlInRepo: boolean;
  supportsManualRunApi: boolean;
  supportsCommitAutoTrigger: boolean;
  defaultYamlPath: string;
};
type ExternalTemplate = { id: string; name: string };

const STAGE_TYPES = ["Build", "Test", "Deploy", "Approval", "Custom"] as const;
const TASK_LIBRARY = ["Install + Build", "Run Tests", "Publish Artifact", "Deploy App Service", "Deploy SWA", "Manual Approval"];
const WIZARD_STEPS: WizardStep[] = ["basics", "mode", "stages", "infra", "execution"];
const CUSTOM_YAML_OPTION = "__custom__";
const CUSTOM_RESOURCE_GROUP_OPTION = "__custom_rg__";
const PROVIDER_CAPABILITIES: Record<"ado" | "gitlab" | "bitbucket" | "github", ProviderCapabilities> = {
  ado: {
    supportsPipelineNameCreate: true,
    supportsCustomTriggerName: false,
    supportsServerLint: false,
    supportsRunWithoutCommit: true,
    supportsMultiplePipelines: true,
    requiresYamlInRepo: false,
    supportsManualRunApi: true,
    supportsCommitAutoTrigger: false,
    defaultYamlPath: "azure-pipelines.generated.yml",
  },
  gitlab: {
    supportsPipelineNameCreate: false,
    supportsCustomTriggerName: false,
    supportsServerLint: true,
    supportsRunWithoutCommit: true,
    supportsMultiplePipelines: false,
    requiresYamlInRepo: true,
    supportsManualRunApi: true,
    supportsCommitAutoTrigger: true,
    defaultYamlPath: ".gitlab-ci.yml",
  },
  bitbucket: {
    supportsPipelineNameCreate: false,
    supportsCustomTriggerName: true,
    supportsServerLint: false,
    supportsRunWithoutCommit: true,
    supportsMultiplePipelines: true,
    requiresYamlInRepo: true,
    supportsManualRunApi: true,
    supportsCommitAutoTrigger: false,
    defaultYamlPath: "bitbucket-pipelines.yml",
  },
  github: {
    supportsPipelineNameCreate: false,
    supportsCustomTriggerName: false,
    supportsServerLint: false,
    supportsRunWithoutCommit: true,
    supportsMultiplePipelines: true,
    requiresYamlInRepo: true,
    supportsManualRunApi: true,
    supportsCommitAutoTrigger: true,
    defaultYamlPath: ".github/workflows/ci.yml",
  },
};

const BITBUCKET_TEMPLATES: ExternalTemplate[] = [
  { id: "bb-default-build-test", name: "Build and Test (default)" },
  { id: "bb-node-azure-deploy", name: "Node.js + Deploy to Azure" },
  { id: "bb-manual-prod-step", name: "Manual approval + Production deploy" },
];

const GITLAB_TEMPLATES: ExternalTemplate[] = [
  { id: "gl-default-build-test", name: "Build and Test (default)" },
  { id: "gl-node-ci", name: "Node.js CI pipeline" },
];

const GITHUB_TEMPLATES: ExternalTemplate[] = [
  { id: "gh-default-build-test", name: "Build and Test (default)" },
  { id: "gh-node-ci", name: "Node.js CI pipeline" },
];

function buildExternalTemplateYaml(
  provider: "gitlab" | "bitbucket" | "github",
  templateId: string,
  branchName: string,
): string {
  if (provider === "bitbucket") {
    if (templateId === "bb-node-azure-deploy") {
      return `image: node:20\n\npipelines:\n  branches:\n    ${branchName || "main"}:\n      - step:\n          name: Build and Test\n          caches:\n            - node\n          script:\n            - npm ci\n            - npm run lint\n            - npm test\n      - step:\n          name: Deploy to Azure\n          deployment: production\n          script:\n            - echo \"Deploy to Azure here\"\n`;
    }
    if (templateId === "bb-manual-prod-step") {
      return `image: atlassian/default-image:4\n\npipelines:\n  branches:\n    ${branchName || "main"}:\n      - step:\n          name: Build and Test\n          script:\n            - echo \"Build\"\n            - echo \"Test\"\n      - step:\n          name: Security Scan\n          script:\n            - echo \"Run security scan\"\n      - step:\n          name: Production Approval\n          trigger: manual\n          script:\n            - echo \"Manual approval step\"\n      - step:\n          name: Deploy to Production\n          deployment: production\n          script:\n            - echo \"Deploy application\"\n`;
    }
    return `image: atlassian/default-image:4\n\npipelines:\n  default:\n    - step:\n        name: Build and Test\n        script:\n          - npm ci\n          - npm test\n`;
  }

  if (provider === "github") {
    if (templateId === "gh-node-ci") {
      return `name: CI\n\non:\n  push:\n    branches: ["${branchName || "main"}"]\n  workflow_dispatch:\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: "20"\n      - run: npm ci\n      - run: npm run build --if-present\n  test:\n    runs-on: ubuntu-latest\n    needs: build\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: "20"\n      - run: npm test --if-present\n`;
    }
    return `name: CI\n\non:\n  push:\n    branches: ["${branchName || "main"}"]\n  workflow_dispatch:\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo "Build and test"\n`;
  }

  if (templateId === "gl-node-ci") {
    return `workflow:\n  rules:\n    - if: $CI_COMMIT_BRANCH == "${branchName || "main"}"\n      when: always\n    - if: '$PIPELINE_TYPE == "log_telecom"'\n      when: always\n    - when: never\n\nstages:\n  - build\n  - test\n\nvariables:\n  GIT_DEPTH: "20"\n\nbuild_job:\n  stage: build\n  image: node:20\n  script:\n    - echo "PIPELINE_TYPE=$PIPELINE_TYPE"\n    - npm ci\n    - npm run build\n\ntest_job:\n  stage: test\n  image: node:20\n  script:\n    - npm test\n`;
  }
  return `workflow:\n  rules:\n    - if: $CI_COMMIT_BRANCH == "${branchName || "main"}"\n      when: always\n    - if: '$PIPELINE_TYPE == "log_telecom"'\n      when: always\n    - when: never\n\nstages:\n  - build\n\nvariables:\n  GIT_DEPTH: "20"\n\nbuild_job:\n  stage: build\n  image: alpine:latest\n  script:\n    - echo "PIPELINE_TYPE=$PIPELINE_TYPE"\n    - echo "Build and test"\n`;
}

function sanitizeKey(value: string): string {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key || "job";
}

function taskToScriptLines(task: string, provider: "ado" | "gitlab" | "bitbucket" | "github"): string[] {
  const t = task.toLowerCase();
  if (t.includes("install")) {
    return provider === "ado"
      ? ["npm ci", "npm run build"]
      : ["npm ci", provider === "gitlab" || provider === "github" ? "npm run build --if-present" : "npm run build"];
  }
  if (t.includes("test")) return ["npm test"];
  if (t.includes("publish")) {
    return provider === "ado"
      ? ['echo "##vso[artifact.upload containerfolder=drop;artifactname=drop]dist"']
      : ['echo "Publish artifact step"'];
  }
  if (t.includes("deploy app service")) {
    return ['echo "Deploy App Service (configure credentials/secrets before use)"'];
  }
  if (t.includes("deploy swa")) {
    return ['echo "Deploy Static Web App (configure deployment token before use)"'];
  }
  if (t.includes("approval") || t.includes("manual")) {
    return ['echo "Manual approval gate"'];
  }
  return [`echo "Run ${task}"`];
}

function buildYamlFromStages(stages: StageNode[], triggerBranch: string): string {
  if (stages.length === 0) {
    return `trigger:
  branches:
    include:
      - ${triggerBranch}

stages: []
`;
  }
  const stageBlocks = stages
    .map((s) => {
      const jobs = s.jobs
        .map((j, idx) => {
          const lines = taskToScriptLines(j, "ado")
            .map((line) => `      - script: ${line}\n        displayName: "${line.replace(/"/g, "'")}"`)
            .join("\n");
          return `  - job: ${s.name.replace(/\s+/g, "")}${idx + 1}
    displayName: "${j}"
    pool:
      vmImage: "ubuntu-latest"
    steps:
${lines}`;
        })
        .join("\n");
      return `- stage: ${s.name.replace(/\s+/g, "")}
  displayName: "${s.name}"
  jobs:
${jobs}`;
    })
    .join("\n\n");

  return `trigger:
  branches:
    include:
      - ${triggerBranch}

stages:
${stageBlocks}
`;
}

/** Minimal GitLab CI stub from stage names (Pipeline Studio GitLab path only). */
function buildGitLabYamlFromStages(stages: StageNode[], triggerBranch: string): string {
  const stageList = stages.length > 0 ? stages : [{ id: "build", name: "Build", jobs: ["Install + Build", "Run Tests"] }];
  const stageKeys = stageList.map((s) => sanitizeKey(s.name));
  const stageSection = stageKeys.map((s) => `  - ${s}`).join("\n");
  const jobsSection = stageList
    .flatMap((stage, stageIndex) => {
      const stageKey = stageKeys[stageIndex];
      const jobs = stage.jobs.length ? stage.jobs : [`Run ${stage.name}`];
      return jobs.map((jobName, jobIndex) => {
        const jobKey = `${stageKey}_${sanitizeKey(jobName)}_${jobIndex + 1}`;
        const scriptLines = taskToScriptLines(jobName, "gitlab")
          .map((line) => `    - ${line}`)
          .join("\n");
        const manualRules = /manual|approval/i.test(jobName)
          ? `\n  rules:\n    - if: $CI_COMMIT_BRANCH == "${triggerBranch || "main"}"\n      when: manual`
          : "";
        return `${jobKey}:\n  stage: ${stageKey}\n  image: node:20\n  script:\n${scriptLines}${manualRules}\n`;
      });
    })
    .join("\n");
  return `workflow:\n  rules:\n    - if: $CI_COMMIT_BRANCH == "${triggerBranch || "main"}"\n      when: always\n    - if: '$PIPELINE_TYPE == "log_telecom"'\n      when: always\n    - when: never\n\nstages:\n${stageSection}\n\nvariables:\n  GIT_DEPTH: "20"\n\n${jobsSection}`;
}

/** Minimal Bitbucket Pipelines stub (Pipeline Studio Bitbucket path only). */
function buildBitbucketYamlFromStages(stages: StageNode[], triggerBranch: string): string {
  const normalizeName = (s: string) => s.replace(/\s+/g, " ").trim() || "Build";
  const stageList = stages.length > 0 ? stages : [{ id: "build", name: "Build", jobs: ["Install + Build", "Run Tests"] }];
  const steps = stageList
    .map((stage) => {
      const jobs = stage.jobs.length ? stage.jobs : [`Run ${normalizeName(stage.name)}`];
      const scriptLines = jobs
        .flatMap((j) => taskToScriptLines(j, "bitbucket").map((line) => `          - ${line}`))
        .join("\n");
      const manualLine = jobs.some((j) => /manual|approval/i.test(j)) ? "\n        trigger: manual" : "";
      return `    - step:\n        name: ${normalizeName(stage.name)}${manualLine}\n        script:\n${scriptLines}`;
    })
    .join("\n");
  return `image: atlassian/default-image:4\n\npipelines:\n  branches:\n    ${triggerBranch || "main"}:\n${steps}\n`;
}

/** Minimal GitHub Actions stub (Pipeline Studio GitHub path only). */
function buildGithubYamlFromStages(stages: StageNode[], triggerBranch: string): string {
  const stageList = stages.length > 0 ? stages : [{ id: "build", name: "Build", jobs: ["Install + Build", "Run Tests"] }];
  const jobs = stageList
    .map((stage, idx) => {
      const jobId = `${sanitizeKey(stage.name)}_${idx + 1}`;
      const steps = (stage.jobs.length ? stage.jobs : [`Run ${stage.name}`])
        .flatMap((j) => taskToScriptLines(j, "github"))
        .map((line) => `      - run: ${line}`)
        .join("\n");
      return `  ${jobId}:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n${steps}`;
    })
    .join("\n\n");
  return `name: CI\n\non:\n  push:\n    branches: ["${triggerBranch || "main"}"]\n  workflow_dispatch:\n\njobs:\n${jobs}\n`;
}

const GITLAB_CREATE_STEPS: WizardStep[] = ["basics", "mode", "execution"];

export default function PipelineStudioPage() {
  const { toast } = useToast();
  const { instance: msalInstance } = useMsal();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const projectId = params.get("projectId") || "default";
  const organization = params.get("organization") || "";
  const projectName = params.get("projectName") || "";
  const projectContextLabel = projectName.trim() || (projectId !== "default" ? projectId : "");
  const explicitCiProvider = (params.get("provider") || "").toLowerCase();
  const adoAllowed = useAdoAllowed();
  const { data: effectiveIntegrations } = useQuery<{
    integrations?: Array<{
      categoryKey: string;
      providerKey?: string | null;
    }>;
  }>({
    queryKey: ["pipeline-studio-effective-integrations", projectId],
    queryFn: async () => {
      if (!projectId || projectId === "default") return { integrations: [] };
      const response = await fetch(getApiUrl(`/api/projects/${projectId}/integration-effective`), {
        credentials: "include",
      });
      if (!response.ok) return { integrations: [] };
      return response.json();
    },
    enabled: !!projectId && projectId !== "default",
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });
  const inferredCiProvider = useMemo(() => {
    const integrations = effectiveIntegrations?.integrations || [];
    const cicdProviderKey = integrations.find((item) => item.categoryKey === "cicd")?.providerKey || "";
    if (cicdProviderKey === "gitlab_ci") return "gitlab";
    if (cicdProviderKey === "bitbucket_pipelines") return "bitbucket";
    if (cicdProviderKey === "github_actions") return "github";
    if (cicdProviderKey === "azure_pipelines") return "ado";

    const repoProviderKey = integrations.find((item) => item.categoryKey === "repo")?.providerKey || "";
    if (!adoAllowed && (repoProviderKey === "gitlab" || repoProviderKey === "bitbucket" || repoProviderKey === "github")) {
      return repoProviderKey;
    }
    return "";
  }, [adoAllowed, effectiveIntegrations]);
  const ciProvider = explicitCiProvider || inferredCiProvider;
  const isGitLab = ciProvider === "gitlab";
  const isBitbucket = ciProvider === "bitbucket";
  const isGithub = ciProvider === "github";
  const isExternalCi = isGitLab || isBitbucket || isGithub;
  const canUseAdo = adoAllowed && !isExternalCi;
  const isAdoUnavailable = !isExternalCi && !adoAllowed;
  const externalCiKey = isBitbucket ? "bitbucket" : isGitLab ? "gitlab" : isGithub ? "github" : null;
  const providerCapabilities = useMemo(
    () =>
      isBitbucket
        ? PROVIDER_CAPABILITIES.bitbucket
        : isGitLab
          ? PROVIDER_CAPABILITIES.gitlab
          : isGithub
            ? PROVIDER_CAPABILITIES.github
            : PROVIDER_CAPABILITIES.ado,
    [isBitbucket, isGitLab, isGithub],
  );

  const [currentStep, setCurrentStep] = useState<WizardStep>("basics");
  const [initialAction, setInitialAction] = useState<InitialAction>(null);
  const [pipelineName, setPipelineName] = useState("devx-generated-pipeline");
  const [repoId, setRepoId] = useState("");
  const [repoName, setRepoName] = useState("");
  const [bitbucketProjectKey, setBitbucketProjectKey] = useState("");
  const [bitbucketRepositorySlug, setBitbucketRepositorySlug] = useState("");
  const [branchName, setBranchName] = useState("main");
  const [setupMode, setSetupMode] = useState<SetupMode>("newPipeline");
  const [yamlPath, setYamlPath] = useState("azure-pipelines.generated.yml");
  const [selectedYamlPathOption, setSelectedYamlPathOption] = useState(CUSTOM_YAML_OPTION);
  const [yamlContent, setYamlContent] = useState("");
  const [existingYamlPreview, setExistingYamlPreview] = useState("");
  const [runAfterCreate, setRunAfterCreate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateRuntimeVars, setTemplateRuntimeVars] = useState<RuntimeVar[]>([{ key: "", value: "" }]);
  const [gitlabPipelineVars, setGitlabPipelineVars] = useState<RuntimeVar[]>([
    { key: "PIPELINE_TYPE", value: "" },
  ]);
  const [existingPipelineId, setExistingPipelineId] = useState("");
  const [useExistingServices, setUseExistingServices] = useState(false);
  const [selectedInfraResourceIds, setSelectedInfraResourceIds] = useState<string[]>([]);
  const [infraSubscriptionId, setInfraSubscriptionId] = useState("");
  const [infraResourceGroup, setInfraResourceGroup] = useState("");
  const [isCustomResourceGroup, setIsCustomResourceGroup] = useState(false);
  const [infraRegion, setInfraRegion] = useState("eastus");
  const [infraAppServiceName, setInfraAppServiceName] = useState("");
  const [infraSwaName, setInfraSwaName] = useState("");
  const [infraDatabaseName, setInfraDatabaseName] = useState("");
  const [infraDatabaseServerName, setInfraDatabaseServerName] = useState("");
  const [dbMigrationEnabled, setDbMigrationEnabled] = useState(false);
  const [armTokenReady, setArmTokenReady] = useState<boolean | null>(null);
  const [armToken, setArmToken] = useState<string | null>(null);
  const [gitlabLintSummary, setGitlabLintSummary] = useState<{
    valid?: boolean;
    errors?: unknown[];
    warnings?: unknown[];
    status?: string;
  } | null>(null);
  const [gitlabLintLoading, setGitlabLintLoading] = useState(false);
  const [pipelineExecutionResult, setPipelineExecutionResult] = useState<PipelineExecutionResult | null>(null);

  const cleanRuntimeVars = (rows: RuntimeVar[]) =>
    rows
      .map((item) => ({ key: item.key.trim(), value: item.value }))
      .filter((item) => !!item.key);

  const getApiErrorPayload = (error: any) =>
    error?.details?.response?.data ||
    error?.response?.data ||
    error?.details ||
    null;

  const [stages, setStages] = useState<StageNode[]>([
    { id: "build", name: "Build", jobs: ["Install + Build"] },
    { id: "test", name: "Test", jobs: ["Run Tests"] },
    { id: "deploy", name: "Deploy", jobs: ["Deploy App"] },
  ]);

  const queryParams = new URLSearchParams();
  if (organization) queryParams.set("organization", organization);
  if (projectName) queryParams.set("projectName", projectName);
  const qs = queryParams.toString() ? `?${queryParams.toString()}` : "";
  const externalParams = new URLSearchParams(queryParams.toString());
  if (isBitbucket && bitbucketProjectKey.trim()) externalParams.set("projectKey", bitbucketProjectKey.trim());
  if (isBitbucket && bitbucketRepositorySlug.trim()) externalParams.set("repositorySlug", bitbucketRepositorySlug.trim());
  const externalQs = externalParams.toString() ? `?${externalParams.toString()}` : "";
  const externalQueryTail = externalParams.toString() ? `&${externalParams.toString()}` : "";

  const { data: reposData = [] } = useQuery<any[]>({
    queryKey: ["pipeline-studio-repos", projectId, organization, projectName],
    queryFn: () => apiRequest("GET", `/api/sdlc/projects/${projectId}/ado/repositories${qs}`).then((r) => r.json()),
    enabled: canUseAdo,
  });
  const { data: adoBranchesData = [] } = useQuery<any[]>({
    queryKey: ["pipeline-studio-branches", projectId, repoId, organization, projectName],
    queryFn: () => apiRequest("GET", `/api/sdlc/projects/${projectId}/ado/build-branches/${repoId}${qs}`).then((r) => r.json()),
    enabled: canUseAdo && !!repoId,
  });
  const { data: externalCiBranchesData = [] } = useQuery<any[]>({
    queryKey: ["pipeline-studio-external-ci-branches", projectId, externalCiKey, bitbucketProjectKey, bitbucketRepositorySlug],
    queryFn: () =>
      apiRequest("GET", `/api/sdlc/projects/${projectId}/${externalCiKey}/branches${externalQs}`).then((r) => r.json()),
    enabled: !!externalCiKey && (!isBitbucket || !!bitbucketRepositorySlug),
  });
  const branchesData = isExternalCi ? externalCiBranchesData : adoBranchesData;
  const { data: adoPipelinesData = [] } = useQuery<any[]>({
    queryKey: ["pipeline-studio-pipelines", projectId, organization, projectName],
    queryFn: () => apiRequest("GET", `/api/sdlc/projects/${projectId}/ado/pipelines${qs}`).then((r) => r.json()).then((d) => d?.value || []),
    enabled: canUseAdo,
  });
  const { data: externalCiPipelinesData = [] } = useQuery<any[]>({
    queryKey: ["pipeline-studio-external-ci-pipelines", projectId, externalCiKey, bitbucketProjectKey, bitbucketRepositorySlug],
    queryFn: () =>
      apiRequest("GET", `/api/sdlc/projects/${projectId}/${externalCiKey}/pipelines${externalQs}`)
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? d : d?.value || [])),
    enabled: !!externalCiKey && (!isBitbucket || !!bitbucketRepositorySlug),
  });
  const pipelinesData = isExternalCi ? externalCiPipelinesData : adoPipelinesData;
  const branchScopedExternalPipelines = useMemo(() => {
    if (!isExternalCi) return pipelinesData;
    if (isGithub) {
      return (pipelinesData || []).filter((p: any) => typeof p.id === "number" && p.id > 0 && p.entryKind !== "placeholder");
    }
    const normalizeRef = (value: string) => String(value || "").trim().replace(/^refs\/heads\//i, "");
    const selected = normalizeRef(branchName);
    if (!selected) return [];
    return (pipelinesData || []).filter((p: any) => normalizeRef(String(p.path || "")) === selected);
  }, [isExternalCi, isGithub, pipelinesData, branchName]);
  const { data: externalContextStatus } = useQuery<{ hasConfig?: boolean; repositorySlug?: string; projectRef?: string; repository?: string }>({
    queryKey: [
      "pipeline-studio-external-context",
      projectId,
      externalCiKey,
      organization,
      projectName,
      bitbucketProjectKey,
      bitbucketRepositorySlug,
    ],
    queryFn: () =>
      apiRequest("GET", `/api/sdlc/projects/${projectId}/${externalCiKey}/context-status${externalQs}`).then((r) => r.json()),
    enabled: !!externalCiKey && (!isBitbucket || !!bitbucketRepositorySlug),
  });
  const { data: bitbucketReposRaw, isLoading: bitbucketReposLoading } = useQuery<{ value?: any[] }>({
    queryKey: ["pipeline-studio-bitbucket-repositories", projectId, bitbucketProjectKey, organization, projectName],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/sdlc/projects/${projectId}/bitbucket/repositories${externalQs}`,
      ).then((r) => r.json()),
    enabled: isBitbucket,
  });
  const bitbucketRepos = Array.isArray(bitbucketReposRaw?.value) ? bitbucketReposRaw.value : [];
  const { data: templatesData = [] } = useQuery<any[]>({
    queryKey: ["pipeline-studio-templates", projectId],
    queryFn: () => apiRequest("GET", `/api/sdlc/projects/${projectId}/ado/pipeline-templates`).then((r) => r.json()).then((d) => d?.value || []),
    enabled: canUseAdo,
  });
  const externalTemplatesData = isBitbucket ? BITBUCKET_TEMPLATES : isGithub ? GITHUB_TEMPLATES : GITLAB_TEMPLATES;
  const effectiveTemplatesData = isExternalCi ? externalTemplatesData : templatesData;
  const { data: infraResources = [] } = useQuery<any[]>({
    queryKey: ["pipeline-studio-infra-resources", projectId],
    queryFn: () => apiRequest("GET", `/api/sdlc/projects/${projectId}/ado/pipeline-automation/infra-resources`).then((r) => r.json()).then((d) => d?.value || []),
    enabled: canUseAdo,
  });
  useEffect(() => {
    if (!canUseAdo) {
      setArmTokenReady(null);
      setArmToken(null);
      return;
    }
    const accounts = msalInstance.getAllAccounts();
    if (!accounts.length) {
      setArmTokenReady(false);
      setArmToken(null);
      return;
    }
    msalInstance
      .acquireTokenSilent({
        ...azureManagementRequest,
        account: accounts[0],
      })
      .then((result) => {
        if (result.accessToken) {
          setArmToken(result.accessToken);
          setArmTokenReady(true);
        } else {
          setArmTokenReady(false);
          setArmToken(null);
        }
      })
      .catch(() => {
        setArmTokenReady(false);
        setArmToken(null);
      });
  }, [msalInstance, canUseAdo]);

  const { data: azureSubscriptionsData, error: azureSubscriptionsError } = useQuery<{ subscriptions?: AzureSubscription[]; defaultSubscription?: AzureSubscription }>({
    queryKey: ["pipeline-studio-azure-subscriptions", armTokenReady, armToken],
    enabled: canUseAdo,
    queryFn: async () => {
      const headers: Record<string, string> = {};
      if (armToken) headers["x-azure-token"] = armToken;
      const response = await fetch(getApiUrl("/api/azure/subscriptions"), {
        credentials: "include",
        headers,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error((errorData as any)?.message || `Failed to fetch subscriptions: ${response.status}`);
      }
      return response.json();
    },
  });
  const { data: azureResourceGroupsData, error: azureResourceGroupsError } = useQuery<{ resourceGroups?: AzureResourceGroup[] }>({
    queryKey: ["pipeline-studio-azure-resource-groups", infraSubscriptionId, armTokenReady, armToken],
    enabled: canUseAdo && !!infraSubscriptionId,
    queryFn: async () => {
      const headers: Record<string, string> = {};
      if (armToken) headers["x-azure-token"] = armToken;
      const response = await fetch(
        getApiUrl(`/api/azure/subscriptions/${encodeURIComponent(infraSubscriptionId)}/resource-groups`),
        {
          credentials: "include",
          headers,
        },
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error((errorData as any)?.message || `Failed to fetch resource groups: ${response.status}`);
      }
      return response.json();
    },
  });
  const { data: adoYamlFilesData = [], isLoading: isLoadingAdoYamlFiles } = useQuery<string[]>({
    queryKey: ["pipeline-studio-yaml-files", projectId, repoId, branchName, organization, projectName],
    queryFn: () => {
      const yamlParams = new URLSearchParams();
      yamlParams.set("repoId", repoId);
      yamlParams.set("branchName", branchName);
      if (organization) yamlParams.set("organization", organization);
      if (projectName) yamlParams.set("projectName", projectName);
      return apiRequest(
        "GET",
        `/api/sdlc/projects/${projectId}/ado/pipeline-automation/yaml-files?${yamlParams.toString()}`,
      )
        .then((r) => r.json())
        .then((d) => d?.value || []);
    },
    enabled: canUseAdo && !!repoId && !!branchName,
  });
  const { data: externalCiYamlFilesRaw, isLoading: isLoadingExternalCiYamlFiles } = useQuery<{ value?: string[] }>({
    queryKey: ["pipeline-studio-external-ci-yaml-files", projectId, branchName, externalCiKey],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/sdlc/projects/${projectId}/${externalCiKey}/ci-yaml-files?ref=${encodeURIComponent(branchName)}${externalQueryTail}`,
      ).then((r) => r.json()),
    enabled: !!externalCiKey && !!branchName && (!isBitbucket || !!bitbucketRepositorySlug),
  });
  const rawYamlFilesData = isExternalCi ? externalCiYamlFilesRaw?.value ?? [] : adoYamlFilesData;
  const yamlFilesData = useMemo(
    () =>
      Array.from(
        new Set(
          (rawYamlFilesData ?? [])
            .map((path) => String(path ?? "").trim())
            .filter((path) => path.length > 0),
        ),
      ),
    [rawYamlFilesData],
  );
  const isLoadingYamlFiles = isExternalCi ? isLoadingExternalCiYamlFiles : isLoadingAdoYamlFiles;

  const azureSubscriptions = azureSubscriptionsData?.subscriptions || [];
  const azureResourceGroups = azureResourceGroupsData?.resourceGroups || [];
  const azureAccessStatus = armToken ? "User token active" : "Using server credentials";

  useEffect(() => {
    if (infraSubscriptionId) return;
    const defaultSub = azureSubscriptionsData?.defaultSubscription?.id || azureSubscriptions[0]?.id;
    if (defaultSub) setInfraSubscriptionId(defaultSub);
  }, [azureSubscriptionsData, azureSubscriptions, infraSubscriptionId]);

  useEffect(() => {
    if (!infraSubscriptionId) return;
    setIsCustomResourceGroup(false);
  }, [infraSubscriptionId]);

  useEffect(() => {
    if (isCustomResourceGroup) return;
    if (azureResourceGroups.length === 0) {
      setInfraResourceGroup("");
      return;
    }
    const exists = azureResourceGroups.some((rg) => rg.name === infraResourceGroup);
    if (!exists) {
      setInfraResourceGroup(azureResourceGroups[0].name);
    }
  }, [azureResourceGroups, infraResourceGroup, isCustomResourceGroup]);

  const yamlPathOptions = useMemo(
    () => [...yamlFilesData, CUSTOM_YAML_OPTION],
    [yamlFilesData],
  );

  useEffect(() => {
    const repoReady = isExternalCi || !!repoId;
    if (!repoReady || !branchName) {
      setSelectedYamlPathOption(CUSTOM_YAML_OPTION);
      setYamlPath("");
      setExistingYamlPreview("");
      return;
    }
    if (selectedYamlPathOption === CUSTOM_YAML_OPTION) {
      // Keep custom mode sticky so users can edit a new workflow path.
      return;
    }
    if (yamlFilesData.length === 0) {
      setSelectedYamlPathOption(CUSTOM_YAML_OPTION);
      setYamlPath("");
      return;
    }
    if (!yamlFilesData.includes(selectedYamlPathOption)) {
      setSelectedYamlPathOption(yamlFilesData[0]);
      setYamlPath(yamlFilesData[0]);
    }
  }, [isExternalCi, repoId, branchName, yamlFilesData, selectedYamlPathOption]);

  useEffect(() => {
    if (!isExternalCi || !Array.isArray(externalCiBranchesData) || externalCiBranchesData.length === 0) return;
    const names = externalCiBranchesData.map((b: any) => String(b.name || ""));
    if (names.includes(branchName)) return;
    const preferred = names.find((n) => n === "main") || names.find((n) => n === "master") || names[0];
    if (preferred) setBranchName(preferred);
  }, [isExternalCi, externalCiBranchesData, branchName]);

  useEffect(() => {
    if (!isBitbucket) return;
    if (!bitbucketRepos.length) {
      setBitbucketRepositorySlug("");
      return;
    }
    const exists = bitbucketRepos.some((repo: any) => String(repo.slug || "") === bitbucketRepositorySlug);
    if (exists) return;
    const preferredFromContext = String(externalContextStatus?.repositorySlug || "");
    const preferredRepo =
      bitbucketRepos.find((repo: any) => String(repo.slug || "") === preferredFromContext) || bitbucketRepos[0];
    if (preferredRepo?.slug) {
      setBitbucketRepositorySlug(String(preferredRepo.slug));
      setRepoName(String(preferredRepo.name || preferredRepo.slug));
      setBranchName("main");
      setExistingPipelineId("");
    }
  }, [isBitbucket, bitbucketRepos, bitbucketRepositorySlug, externalContextStatus?.repositorySlug]);

  useEffect(() => {
    if (!isExternalCi || initialAction !== "createNew") return;
    if (currentStep === "stages" || currentStep === "infra") setCurrentStep("mode");
  }, [isExternalCi, initialAction, currentStep]);

  useEffect(() => {
    if (!isExternalCi) return;
    setYamlPath((prev) => {
      if (isBitbucket) {
        return prev === "azure-pipelines.generated.yml" || prev === "" ? "bitbucket-pipelines.yml" : prev;
      }
      if (isGithub) {
        return prev === "azure-pipelines.generated.yml" || prev === "" ? ".github/workflows/ci.yml" : prev;
      }
      return prev === "azure-pipelines.generated.yml" || prev === "" ? ".gitlab-ci.yml" : prev;
    });
  }, [isExternalCi, isBitbucket, isGithub]);

  useEffect(() => {
    if (!isExternalCi || setupMode !== "template") return;
    if (!selectedTemplateId) {
      const firstTemplateId = effectiveTemplatesData[0]?.id;
      if (firstTemplateId) setSelectedTemplateId(firstTemplateId);
      return;
    }
    const provider = isBitbucket ? "bitbucket" : isGithub ? "github" : "gitlab";
    const generated = buildExternalTemplateYaml(provider, selectedTemplateId, branchName || "main");
    setYamlContent(generated);
    if (!yamlPath.trim()) {
      setYamlPath(providerCapabilities.defaultYamlPath);
      setSelectedYamlPathOption(CUSTOM_YAML_OPTION);
    }
  }, [
    isExternalCi,
    setupMode,
    selectedTemplateId,
    branchName,
    isBitbucket,
    yamlPath,
    providerCapabilities.defaultYamlPath,
    effectiveTemplatesData,
  ]);

  const handleRepo = (id: string) => {
    const repo = reposData.find((r: any) => r.id === id);
    setRepoId(id);
    setRepoName(repo?.name || "");
  };

  const handleBitbucketRepo = (slug: string) => {
    const selected = bitbucketRepos.find((repo: any) => String(repo.slug || "") === slug);
    setBitbucketRepositorySlug(slug);
    setRepoName(String(selected?.name || slug));
    setBranchName("main");
    setExistingPipelineId("");
  };

  const addJobToStage = (stageId: string, jobName: string) => {
    setStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, jobs: [...s.jobs, jobName] } : s)));
  };

  const addStageType = (type: string) => {
    const normalized = type.trim() || "Custom";
    const id = `${normalized.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
    const defaultJob = normalized === "Approval" ? "Manual Approval" : `Run ${normalized}`;
    setStages((prev) => [...prev, { id, name: normalized, jobs: [defaultJob] }]);
  };

  const canMoveTo = (target: WizardStep) => {
    if (initialAction === "runExisting") {
      if (isExternalCi) {
        if (target === "execution") {
          return !!branchName;
        }
        return target === "basics";
      }
      if (target === "execution") {
        return !!repoId && !!branchName && !!existingPipelineId;
      }
      return target === "basics";
    }
    if (isExternalCi && initialAction === "createNew") {
      const steps = GITLAB_CREATE_STEPS;
      const idx = steps.indexOf(target);
      if (idx < 0) return false;
      for (let i = 0; i < idx; i += 1) {
        const step = steps[i];
        if (step === "basics" && !branchName) return false;
        if (step === "mode" && !setupMode) return false;
        if (step === "execution") {
          if (setupMode === "existingYaml" && !yamlPath.trim()) return false;
          if (setupMode === "template" && !selectedTemplateId) return false;
          if (setupMode === "template" && !yamlContent.trim()) return false;
          if (setupMode === "newPipeline" && !yamlContent.trim()) return false;
          if (setupMode === "newPipeline" && !yamlPath.trim()) return false;
        }
      }
      return true;
    }
    const idx = WIZARD_STEPS.indexOf(target);
    for (let i = 0; i < idx; i += 1) {
      const step = WIZARD_STEPS[i];
      if (
        step === "basics" &&
        ((!providerCapabilities.supportsPipelineNameCreate ? false : !pipelineName.trim()) || !repoId || !branchName)
      ) return false;
      if (step === "mode" && !setupMode) return false;
      if (step === "stages" && stages.length === 0) return false;
      if (step === "execution") {
        if (setupMode === "existingYaml" && !yamlPath.trim()) return false;
        if (setupMode === "template" && !selectedTemplateId) return false;
        if (setupMode === "newPipeline" && !yamlContent.trim()) return false;
      }
    }
    return true;
  };

  const moveStep = (direction: "next" | "prev") => {
    if (initialAction === "runExisting") {
      if (direction === "next" && currentStep === "basics") {
        const missingRepo = !isExternalCi && !repoId;
        if (missingRepo || !branchName || !existingPipelineId) {
          toast({
            title: "Complete required inputs",
            description: isExternalCi
              ? "Branch and pipeline selection are required."
              : "Repository, branch and existing pipeline are required.",
            variant: "destructive",
          });
          return;
        }
        setCurrentStep("execution");
        return;
      }
      if (direction === "prev" && currentStep === "execution") {
        setCurrentStep("basics");
      }
      return;
    }
    if (isExternalCi && initialAction === "createNew") {
      const steps = GITLAB_CREATE_STEPS;
      let cur = steps.indexOf(currentStep);
      if (cur < 0) {
        setCurrentStep("basics");
        return;
      }
      if (direction === "next") {
        if (cur >= steps.length - 1) return;
        const nextStep = steps[cur + 1];
        if (!canMoveTo(nextStep)) {
          toast({
            title: "Complete required inputs",
            description: "Fill all required fields in earlier steps before moving forward.",
            variant: "destructive",
          });
          return;
        }
        setCurrentStep(nextStep);
        return;
      }
      if (direction === "prev") {
        if (cur === 0) {
          goToActionSelection();
          return;
        }
        setCurrentStep(steps[cur - 1]);
      }
      return;
    }
    const current = WIZARD_STEPS.indexOf(currentStep);
    let nextIndex = direction === "next" ? current + 1 : current - 1;
    if (direction === "next" && setupMode === "existingYaml" && currentStep === "mode") {
      nextIndex = WIZARD_STEPS.indexOf("execution");
    }
    if (nextIndex < 0 || nextIndex >= WIZARD_STEPS.length) return;
    const nextStep = WIZARD_STEPS[nextIndex];
    if (direction === "next" && !canMoveTo(nextStep)) {
      toast({ title: "Complete required inputs", description: "Fill all required fields in earlier steps before moving forward.", variant: "destructive" });
      return;
    }
    setCurrentStep(nextStep);
  };

  const commitExternalCiPipelineStudio = async (runNow: boolean) => {
    if (!externalCiKey) return;
    try {
      setPipelineExecutionResult(null);
      const resolvedYamlPath = selectedYamlPathOption === CUSTOM_YAML_OPTION ? yamlPath : selectedYamlPathOption;
      const bodyContent = setupMode === "existingYaml" ? existingYamlPreview : yamlContent;
      if (!branchName.trim() || !resolvedYamlPath.trim() || !bodyContent.trim()) {
        toast({
          title: "Missing inputs",
          description: "Branch, YAML path, and non-empty YAML content are required.",
          variant: "destructive",
        });
        return;
      }
      const triggerPipeline = runNow || runAfterCreate;
      const pipelineVariables =
        isGitLab && setupMode === "newPipeline"
          ? cleanRuntimeVars(gitlabPipelineVars).filter((item) => item.value.trim() !== "")
          : [];
      const body: Record<string, unknown> = {
        branchName,
        filePath: resolvedYamlPath,
        content: bodyContent,
        triggerPipeline,
      };
      if (isGitLab && pipelineVariables.length > 0) {
        body.variables = pipelineVariables;
      }
      const res = await apiRequest("POST", `/api/sdlc/projects/${projectId}/${externalCiKey}/ci-yaml${externalQs}`, body);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Save failed",
          description: (data as any)?.error || (data as any)?.message || "Commit failed",
          variant: "destructive",
        });
        return;
      }
      const pipeline = (data as any)?.pipeline ?? null;
      setPipelineExecutionResult({
        variant: "success",
        title: triggerPipeline && pipeline ? "Committed and pipeline started" : "Committed to repository",
        message:
          triggerPipeline && pipeline
            ? `Pipeline #${pipeline.id || "created"}${pipeline.status ? ` is ${pipeline.status}` : ""}.`
            : triggerPipeline
              ? "The YAML was saved. GitLab did not return a pipeline run in the response."
              : "The YAML was saved successfully.",
        filePath: (data as any)?.filePath || resolvedYamlPath,
        branch: (data as any)?.branch || branchName,
        pipeline,
      });
    } catch (error: any) {
      const serverPayload = getApiErrorPayload(error);
      if (serverPayload?.fileSaved) {
        setPipelineExecutionResult({
          variant: "warning",
          title: "YAML saved, pipeline not started",
          message:
            serverPayload?.error ||
            serverPayload?.message ||
            error?.message ||
            "GitLab saved the CI YAML, but the pipeline could not be started.",
          filePath: serverPayload?.filePath || (selectedYamlPathOption === CUSTOM_YAML_OPTION ? yamlPath : selectedYamlPathOption),
          branch: serverPayload?.branch || branchName,
          pipeline: null,
        });
        return;
      }
      setPipelineExecutionResult({
        variant: "error",
        title: "Save failed",
        message: serverPayload?.error || serverPayload?.message || error?.message || "Unexpected error while saving CI YAML.",
      });
      toast({
        title: "Save failed",
        description: serverPayload?.error || serverPayload?.message || error?.message || "Unexpected error while saving CI YAML.",
        variant: "destructive",
      });
    }
  };

  const lintExternalCiYaml = async () => {
    const content =
      setupMode === "newPipeline" ? yamlContent : setupMode === "existingYaml" ? existingYamlPreview : "";
    if (!content.trim()) {
      toast({
        title: "Nothing to validate",
        description: "Add YAML in the editor or load a preview first.",
        variant: "destructive",
      });
      return;
    }
    if (!externalCiKey) return;
    setGitlabLintLoading(true);
    setGitlabLintSummary(null);
    try {
      const res = await apiRequest("POST", `/api/sdlc/projects/${projectId}/${externalCiKey}/ci/lint${externalQs}`, { content });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "CI lint failed",
          description: (data as any)?.error || "Request failed",
          variant: "destructive",
        });
        return;
      }
      setGitlabLintSummary(data as any);
      toast({
        title: (data as any)?.valid ? "CI lint passed" : "CI lint reported issues",
        description: (data as any)?.valid
          ? isBitbucket
            ? "No blocking issues from the stub validator (Bitbucket has no CI lint API here)."
            : "GitLab CI Lint did not report blocking errors."
          : "Review errors and warnings below.",
        variant: (data as any)?.valid ? "default" : "destructive",
      });
    } catch (error: any) {
      toast({
        title: "CI lint failed",
        description: error?.message || "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setGitlabLintLoading(false);
    }
  };

  const createFromExistingYaml = async (runNow: boolean) => {
    if (isExternalCi) {
      await commitExternalCiPipelineStudio(runNow);
      return;
    }
    try {
      const resolvedYamlPath = selectedYamlPathOption === CUSTOM_YAML_OPTION ? yamlPath : selectedYamlPathOption;
      if (!pipelineName.trim() || !repoId || !repoName || !branchName || !resolvedYamlPath.trim()) {
        toast({
          title: "Missing inputs",
          description: "Pipeline name, repository, branch and YAML path are required.",
          variant: "destructive",
        });
        return;
      }
      const payload = {
        mode: "yamlRepoMode",
        pipelineName,
        organization,
        projectName,
        repoId,
        repoName,
        branchName,
        yamlPath: resolvedYamlPath,
        runAfterCreate: runNow,
      };
      const res = await apiRequest("POST", `/api/sdlc/projects/${projectId}/ado/pipeline-automation/orchestrate`, payload);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMessage = String((data as any)?.error || (data as any)?.message || "");
        if (errorMessage.toLowerCase().includes("already exists")) {
          const match = (pipelinesData || []).find(
            (p: any) => String(p?.name || "").toLowerCase() === pipelineName.trim().toLowerCase(),
          );
          if (match?.id && branchName) {
            const runRes = await apiRequest("POST", `/api/sdlc/projects/${projectId}/ado/pipeline-automation/orchestrate`, {
              mode: "existingPipelineMode",
              organization,
              projectName,
              existingPipelineId: Number(match.id),
              branchName,
            });
            const runData = await runRes.json().catch(() => ({}));
            if (runRes.ok) {
              toast({
                title: "Pipeline already exists",
                description: `Queued run for existing pipeline ${match.name}.`,
              });
              return;
            }
            toast({
              title: "Pipeline exists but run failed",
              description: (runData as any)?.error || "Use Run Existing Pipeline to trigger manually.",
              variant: "destructive",
            });
            return;
          }
        }
        toast({
          title: "Create pipeline failed",
          description: (data as any)?.error || (data as any)?.message || "Create from existing YAML failed",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: runNow ? "Pipeline created and run queued" : "Pipeline created",
        description: runNow
          ? `Pipeline ${(data as any)?.pipeline?.name || pipelineName} created and queued.`
          : `Pipeline ${(data as any)?.pipeline?.name || pipelineName} created successfully.`,
      });
    } catch (error: any) {
      toast({
        title: "Create pipeline failed",
        description: error?.message || "Unexpected error while creating pipeline.",
        variant: "destructive",
      });
    }
  };

  const generateYaml = () => {
    const yaml = isBitbucket
      ? buildBitbucketYamlFromStages(stages, branchName || "main")
      : isGithub
        ? buildGithubYamlFromStages(stages, branchName || "main")
      : isGitLab
        ? buildGitLabYamlFromStages(stages, branchName || "main")
        : buildYamlFromStages(stages, branchName || "main");
    setYamlContent(yaml);
    toast({
      title: "YAML generated",
      description: isBitbucket
        ? "Stages converted to a minimal Bitbucket Pipelines stub."
        : isGitLab
          ? "Stages converted to a minimal GitLab CI stub."
          : "Pipeline stages converted to YAML.",
    });
  };

  const previewExistingYaml = async () => {
    try {
      const resolvedYamlPath = selectedYamlPathOption === CUSTOM_YAML_OPTION ? yamlPath : selectedYamlPathOption;
      if (isExternalCi && externalCiKey) {
        if (!branchName || !resolvedYamlPath.trim()) {
          toast({
            title: "Missing inputs",
            description: "Select branch and YAML path first.",
            variant: "destructive",
          });
          return;
        }
        const qp = new URLSearchParams({ ref: branchName, file: resolvedYamlPath });
        const res = await apiRequest("GET", `/api/sdlc/projects/${projectId}/${externalCiKey}/ci-file?${qp.toString()}${externalQueryTail}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({
            title: "Load failed",
            description: (data as any)?.error || "Failed to read CI file",
            variant: "destructive",
          });
          return;
        }
        setExistingYamlPreview(String((data as any)?.content || ""));
        setGitlabLintSummary(null);
        toast({
          title: (data as any)?.missing ? "CI file not in repo" : "YAML preview loaded",
          description: (data as any)?.missing
            ? "Empty editor ΓÇö add CI YAML, validate, then commit."
            : isBitbucket
              ? "Fetched file from Bitbucket repository."
              : "Fetched file from GitLab repository.",
        });
        return;
      }
      if (!repoId || !branchName || !resolvedYamlPath.trim()) {
        toast({ title: "Missing inputs", description: "Select repository, branch and YAML path first.", variant: "destructive" });
        return;
      }
      const qp = new URLSearchParams({ repoId, branchName, yamlPath: resolvedYamlPath });
      if (organization) qp.set("organization", organization);
      if (projectName) qp.set("projectName", projectName);
      const res = await apiRequest("GET", `/api/sdlc/projects/${projectId}/ado/pipeline-automation/yaml-preview?${qp.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "YAML validation failed",
          description: (data as any)?.error || "Failed to preview YAML",
          variant: "destructive",
        });
        return;
      }
      setExistingYamlPreview(String((data as any)?.content || ""));
      toast({ title: "YAML preview loaded", description: "Existing YAML file fetched from repository." });
    } catch (error: any) {
      toast({
        title: "YAML validation failed",
        description: error?.message || "Unexpected error while validating YAML.",
        variant: "destructive",
      });
    }
  };

  const createOrchestratedPipeline = async () => {
    if (isExternalCi) {
      toast({
        title: "Not available",
        description: "GitLab / Bitbucket projects use Commit / Commit and run for generated YAML.",
        variant: "destructive",
      });
      return;
    }
    const runtimeInputs = templateRuntimeVars.reduce<Record<string, string>>((acc, item) => {
      if (item.key.trim()) acc[item.key.trim()] = item.value;
      return acc;
    }, {});
    const mode = setupMode === "existingYaml" ? "yamlRepoMode" : setupMode === "template" ? "templateMode" : "yamlGeneratedMode";
    const resolvedYamlPath = setupMode === "existingYaml" && selectedYamlPathOption !== CUSTOM_YAML_OPTION ? selectedYamlPathOption : yamlPath;
    const payload: any = {
      mode,
      pipelineName,
      organization,
      projectName,
      repoId,
      repoName,
      branchName,
      yamlPath: resolvedYamlPath,
      generatedYaml: setupMode === "newPipeline" ? yamlContent : undefined,
      runAfterCreate,
      templateId: setupMode === "template" ? selectedTemplateId : undefined,
      variableInputs: runtimeInputs,
      infraBootstrapOption: useExistingServices || selectedInfraResourceIds.length > 0 ? "none" : infraSubscriptionId ? "resourceGroupOnly" : "none",
      infraConfig: {
        subscriptionId: infraSubscriptionId || undefined,
        resourceGroupName: infraResourceGroup || undefined,
        location: infraRegion || undefined,
        appServiceName: infraAppServiceName || undefined,
        staticWebAppName: infraSwaName || undefined,
        databaseName: infraDatabaseName || undefined,
        databaseServerName: infraDatabaseServerName || undefined,
        useExistingServices,
        dbMigrationEnabled,
      },
      existingPipelineId: existingPipelineId ? Number(existingPipelineId) : undefined,
    };
    const res = await apiRequest("POST", `/api/sdlc/projects/${projectId}/ado/pipeline-automation/orchestrate`, payload);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errorMessage = String((err as any)?.error || (err as any)?.message || "");
      if (errorMessage.toLowerCase().includes("already exists")) {
        const match = (pipelinesData || []).find(
          (p: any) => String(p?.name || "").toLowerCase() === pipelineName.trim().toLowerCase(),
        );
        if (match?.id && branchName) {
          const runRes = await apiRequest("POST", `/api/sdlc/projects/${projectId}/ado/pipeline-automation/orchestrate`, {
            mode: "existingPipelineMode",
            organization,
            projectName,
            existingPipelineId: Number(match.id),
            branchName,
          });
          const runData = await runRes.json().catch(() => ({}));
          if (runRes.ok) {
            toast({
              title: "Pipeline already exists",
              description: `Queued run for existing pipeline ${match.name}.`,
            });
            return;
          }
          toast({
            title: "Pipeline exists but run failed",
            description: (runData as any)?.error || "Use Run Existing Pipeline to trigger manually.",
            variant: "destructive",
          });
          return;
        }
      }
      toast({
        title: "Create pipeline failed",
        description: (err as any)?.error || (err as any)?.message || "Create pipeline failed",
        variant: "destructive",
      });
      return;
    }
    const data = await res.json();
    toast({ title: "Pipeline created", description: `Pipeline ${data?.pipeline?.name || pipelineName} created successfully.` });
  };

  const runExisting = async () => {
    try {
      if (!isExternalCi && !existingPipelineId) {
        toast({ title: "Pipeline required", description: "Select existing pipeline first", variant: "destructive" });
        return;
      }
      if (!branchName) {
        toast({ title: "Branch required", description: "Select a branch before running pipeline.", variant: "destructive" });
        return;
      }
      if (isExternalCi && externalCiKey) {
        const resolvedYamlPath = selectedYamlPathOption === CUSTOM_YAML_OPTION ? yamlPath : selectedYamlPathOption;
        const hasWorkflowDispatch =
          isGithub &&
          (/(\n|^)\s*workflow_dispatch\s*:/.test(existingYamlPreview) ||
            /(\n|^)\s*-\s*workflow_dispatch\s*$/.test(existingYamlPreview));
        if (isGithub && setupMode === "existingYaml" && resolvedYamlPath.trim() && existingYamlPreview.trim()) {
          try {
            await apiRequest("POST", `/api/sdlc/projects/${projectId}/${externalCiKey}/ci-yaml${externalQs}`, {
              branchName,
              filePath: resolvedYamlPath,
              content: existingYamlPreview,
              triggerPipeline: false,
            });
            if (!hasWorkflowDispatch) {
              toast({
                title: "Workflow updated",
                description:
                  "Saved workflow changes to the repository. This workflow does not declare workflow_dispatch, so it runs via push trigger from this commit.",
              });
              return;
            }
          } catch {
            // If save fails (e.g. no content change), continue and attempt direct dispatch.
          }
        }
        const idNum = existingPipelineId === "__default__" || !existingPipelineId ? NaN : Number(existingPipelineId);
        const body: Record<string, unknown> = { branchName };
        const pipelineVariables = cleanRuntimeVars(gitlabPipelineVars);
        if (Number.isFinite(idNum) && idNum > 0) {
          body.pipelineRunId = idNum;
        }
        if (isGitLab && pipelineVariables.length > 0) {
          body.pipelineVariables = pipelineVariables;
        }
        await apiRequest("POST", `/api/sdlc/projects/${projectId}/${externalCiKey}/queue-build${externalQs}`, body);
        const selectedPipeline = (pipelinesData || []).find((p: any) => String(p.id) === String(existingPipelineId));
        toast({
          title: "Pipeline triggered",
          description: isBitbucket
            ? `Queued Bitbucket pipeline for ${selectedPipeline?.name || branchName} on ${branchName}.`
            : isGithub
              ? `Queued GitHub Actions workflow for ${selectedPipeline?.name || branchName} on ${branchName}.`
              : `Queued GitLab CI pipeline for ${selectedPipeline?.name || branchName} on ${branchName}.`,
        });
        return;
      }
      await apiRequest("POST", `/api/sdlc/projects/${projectId}/ado/pipeline-automation/orchestrate`, {
        mode: "existingPipelineMode",
        organization,
        projectName,
        existingPipelineId: Number(existingPipelineId),
        branchName,
      });
      const selectedPipeline = (pipelinesData || []).find((p: any) => String(p.id) === String(existingPipelineId));
      toast({
        title: "Pipeline triggered",
        description: `Queued full pipeline run for ${selectedPipeline?.name || `pipeline ${existingPipelineId}`} on ${branchName}.`,
      });
    } catch (error: any) {
      toast({
        title: "Run existing pipeline failed",
        description: error?.error || error?.message || "Run existing pipeline failed",
        variant: "destructive",
      });
    }
  };

  const createInfraQuick = async (serviceType: "Web App" | "Static Site" | "Database") => {
    const suffix = Math.random().toString(36).slice(2, 7);
    const resolvedSubscription = infraSubscriptionId || infraResources?.[0]?.subscriptionId || "";
    const resolvedRg = infraResourceGroup || infraResources?.[0]?.resourceGroupName || `devx-pipeline-rg-${suffix}`;
    if (!resolvedSubscription) {
      toast({ title: "Subscription required", description: "Enter Azure subscription ID to create infrastructure.", variant: "destructive" });
      return;
    }
    const body: any = {
      instanceName: `pipe-${serviceType.replace(/\s+/g, "-").toLowerCase()}-${suffix}`,
      environment: "Development",
      region: infraRegion,
      serviceType,
      runtime: serviceType === "Static Site" ? "Static Web App" : "Node 20 LTS",
      planTier: "Standard (S1)",
      subscriptionId: resolvedSubscription,
      resourceGroupName: resolvedRg,
      advancedSettings: { enableLogging: false, autoDeleteDays: null, tags: [] },
    };
    if (serviceType === "Database") {
      body.databaseConfig = {
        engine: "MySQL Flexible",
        serverMode: "new",
        serverName: `devxmysql${suffix}`,
        adminUsername: "devxadmin",
        adminPassword: "Devx#12345X",
        databaseName: `devxdb${suffix}`,
        skuTier: "Burstable",
        storageSizeGb: 32,
      };
      delete body.runtime;
      delete body.planTier;
    }
    const res = await apiRequest("POST", "/api/instances", body);
    if (!res.ok) {
      const err = await res.json();
      toast({
        title: "Infrastructure creation failed",
        description: err.message || "Infrastructure creation failed",
        variant: "destructive",
      });
      return;
    }
    toast({ title: `${serviceType} creation started`, description: "Provisioning is in progress. It will appear in resources once ready." });
  };

  const stepTitle = useMemo(() => {
    if (!initialAction) return "Choose Pipeline Action";
    if (initialAction === "runExisting") {
      if (currentStep === "execution") return "Step 2: Execution";
      return "Step 1: Run Existing Pipeline";
    }
    if (isExternalCi) {
      if (currentStep === "basics") return "Step 1: Configure Pipeline";
      if (currentStep === "mode") return "Step 2: Choose Setup Mode";
      return "Step 3: Execution";
    }
    if (currentStep === "basics") return "Step 1: Create Pipeline";
    if (currentStep === "mode") return "Step 2: Choose Setup Mode";
    if (currentStep === "stages") return "Step 3: Add Stage";
    if (currentStep === "infra") return "Step 4: Infra Setup";
    return "Step 5: Execution";
  }, [currentStep, initialAction, isExternalCi]);

  const goToActionSelection = () => {
    setInitialAction(null);
    setCurrentStep("basics");
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={Workflow}
        title={projectContextLabel ? `Pipeline Studio - ${projectContextLabel}` : "Pipeline Studio"}
        subtitle={
          isBitbucket
            ? "Bitbucket Pipelines: edit bitbucket-pipelines.yml on a branch; validation is a lightweight stub (no Bitbucket lint API). No Azure DevOps repo list."
            : isGitLab
              ? "GitLab: edit CI YAML in the repository; validation uses GitLab CI Lint. Branch and file path only (no Azure DevOps repo list)."
              : "Pipeline wizard: basics, setup mode, stage design, infra-first, and execution."
        }
        color="blue"
      >
        <Button variant="outline" onClick={() => setLocation("/sdlc")}>Back to SDLC</Button>
      </PageHeader>

      {isGitLab ? (
        <Alert className="rounded-2xl border-border/40 border-l-[3px] border-l-cyan-500 bg-card">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>GitLab CI mode</AlertTitle>
          <AlertDescription>
            Changes are committed to the configured GitLab project on the branch you select. Use Validate (CI Lint) before saving.
            {projectName ? ` Project: ${projectName}.` : ""}
          </AlertDescription>
        </Alert>
      ) : isBitbucket ? (
        <Alert className="rounded-2xl border-border/40 border-l-[3px] border-l-blue-500 bg-card">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Bitbucket Pipelines mode</AlertTitle>
          <AlertDescription>
            Changes are committed to the configured Bitbucket repository on the branch you select. Validate runs a stub check only.
          </AlertDescription>
        </Alert>
      ) : isGithub ? (
        <Alert className="rounded-2xl border-border/40 border-l-[3px] border-l-slate-500 bg-card">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>GitHub Actions mode</AlertTitle>
          <AlertDescription>
            Changes are committed to the configured GitHub repository on the branch you select. Validation is a lightweight stub.
          </AlertDescription>
        </Alert>
      ) : isAdoUnavailable ? (
        <Alert className="rounded-2xl border-border/40 border-l-[3px] border-l-amber-500 bg-card">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>{ciProvider === "ado" ? "Azure DevOps unavailable" : "CI/CD provider required"}</AlertTitle>
          <AlertDescription>
            {ciProvider === "ado"
              ? "This deployment is running in Jira-only hosting mode. Open Pipeline Studio with a GitLab, Bitbucket, or GitHub provider to configure CI."
              : "Configure GitLab, Bitbucket, or GitHub CI for this project before creating or running a pipeline."}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-blue-500">
        <CardHeader>
          <CardTitle>{stepTitle}</CardTitle>
          {initialAction === "createNew" && (
            <div className="flex gap-2 flex-wrap">
              {(isExternalCi ? GITLAB_CREATE_STEPS : WIZARD_STEPS).map((step, idx) => (
                <Badge key={step} className={`cursor-pointer ${currentStep === step ? "bg-primary text-primary-foreground" : ""}`} onClick={() => canMoveTo(step) && setCurrentStep(step)}>
                  {idx + 1}. {step}
                </Badge>
              ))}
            </div>
          )}
          {initialAction === "runExisting" && (
            <div className="flex gap-2 flex-wrap">
              {(["basics", "execution"] as WizardStep[]).map((step, idx) => (
                <Badge key={step} className={`cursor-pointer ${currentStep === step ? "bg-primary text-primary-foreground" : ""}`} onClick={() => canMoveTo(step) && setCurrentStep(step)}>
                  {idx + 1}. {step}
                </Badge>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!initialAction && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className={`rounded-2xl shadow-sm border border-border/40 border-l-[3px] ${initialAction === "createNew" ? "border-l-blue-500" : "border-l-border"}`}>
              <CardContent className="p-4 space-y-2">
                <div className="font-semibold">{isExternalCi ? "Configure Pipeline" : "Create New Pipeline"}</div>
                <div className="text-xs text-muted-foreground">Build a new pipeline using existing YAML, template, or new stage design.</div>
                <Button size="sm" disabled={isAdoUnavailable} onClick={() => { setInitialAction("createNew"); setCurrentStep("basics"); }}>
                  Select
                </Button>
              </CardContent>
            </Card>
            <Card className={`rounded-2xl shadow-sm border border-border/40 border-l-[3px] ${initialAction === "runExisting" ? "border-l-emerald-500" : "border-l-border"}`}>
              <CardContent className="p-4 space-y-2">
                <div className="font-semibold">Run Existing Pipeline</div>
                <div className="text-xs text-muted-foreground">
                  {isExternalCi
                    ? "Select branch, optional prior run, review existing YAML, then run an existing pipeline."
                    : "Select repo, branch, pipeline, review YAML, then run."}
                </div>
                <Button size="sm" disabled={isAdoUnavailable} onClick={() => { setInitialAction("runExisting"); setCurrentStep("basics"); setSetupMode("existingYaml"); }}>
                  Select
                </Button>
              </CardContent>
            </Card>
          </div>
          )}

          {!initialAction && (
            <div className="text-xs text-muted-foreground">
              Select one option above to continue.
            </div>
          )}

          {initialAction === "runExisting" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {!isExternalCi ? (
                <div className="space-y-1">
                  <Label>Repository</Label>
                  <Select value={repoId} onValueChange={handleRepo}>
                    <SelectTrigger><SelectValue placeholder="Select repo" /></SelectTrigger>
                    <SelectContent>
                      {reposData.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : isBitbucket ? (
                <>
                  <div className="space-y-1">
                    <Label>Bitbucket project key (optional)</Label>
                    <Input
                      value={bitbucketProjectKey}
                      onChange={(e) => {
                        setBitbucketProjectKey(e.target.value.toUpperCase());
                        setBitbucketRepositorySlug("");
                      }}
                      placeholder="e.g. DEVX"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Bitbucket repository</Label>
                    <Select value={bitbucketRepositorySlug} onValueChange={handleBitbucketRepo}>
                      <SelectTrigger>
                        <SelectValue placeholder={bitbucketReposLoading ? "Loading repositories..." : "Select repository"} />
                      </SelectTrigger>
                      <SelectContent>
                        {bitbucketRepos.map((repo: any) => (
                          <SelectItem key={String(repo.slug)} value={String(repo.slug)}>
                            {String(repo.name || repo.slug)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!bitbucketReposLoading && bitbucketRepos.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No repositories found for this workspace/project key. Check app password scopes and project key.
                      </p>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="space-y-1 md:col-span-2">
                  <Label>{isBitbucket ? "Bitbucket repository" : isGithub ? "GitHub repository" : "GitLab project"}</Label>
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
                    {isBitbucket
                      ? externalContextStatus?.repositorySlug || projectName || "ΓÇö"
                      : isGithub
                        ? externalContextStatus?.repository || projectName || "ΓÇö"
                      : externalContextStatus?.projectRef || projectName || "ΓÇö"}
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <Label>Branch</Label>
                <Select
                  value={branchName}
                  onValueChange={(value) => {
                    setBranchName(value);
                    setExistingPipelineId("");
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {(branchesData || []).map((b: any) => <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>{isExternalCi ? "Recent pipeline (optional)" : "Existing Pipeline"}</Label>
                <Select value={existingPipelineId} onValueChange={setExistingPipelineId}>
                  <SelectTrigger><SelectValue placeholder={isExternalCi ? "Default/latest (optional)" : "Select existing pipeline"} /></SelectTrigger>
                  <SelectContent>
                    {isExternalCi ? <SelectItem value="__default__">Default/latest</SelectItem> : null}
                    {(isExternalCi ? branchScopedExternalPipelines : pipelinesData || []).map((p: any) => (
                      <SelectItem key={String(p.id)} value={String(p.id)}>
                        {isGithub ? p.name || `Workflow ${p.id}` : p.name || `Pipeline ${p.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {initialAction === "createNew" && (
          <>
          {currentStep === "basics" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {!isExternalCi && providerCapabilities.supportsPipelineNameCreate ? (
                <div className="space-y-1">
                  <Label>Pipeline Name</Label>
                  <Input value={pipelineName} onChange={(e) => setPipelineName(e.target.value)} />
                </div>
              ) : null}
              {isExternalCi ? (
                isBitbucket ? (
                  <>
                    <div className="space-y-1 md:col-span-1">
                      <Label>Bitbucket project key (optional)</Label>
                      <Input
                        value={bitbucketProjectKey}
                        onChange={(e) => {
                          setBitbucketProjectKey(e.target.value.toUpperCase());
                          setBitbucketRepositorySlug("");
                        }}
                        placeholder="e.g. DEVX"
                      />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <Label>Bitbucket repository</Label>
                      <Select value={bitbucketRepositorySlug} onValueChange={handleBitbucketRepo}>
                        <SelectTrigger>
                          <SelectValue placeholder={bitbucketReposLoading ? "Loading repositories..." : "Select repository"} />
                        </SelectTrigger>
                        <SelectContent>
                          {bitbucketRepos.map((repo: any) => (
                            <SelectItem key={String(repo.slug)} value={String(repo.slug)}>
                              {String(repo.name || repo.slug)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!bitbucketReposLoading && bitbucketRepos.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No repositories found for this workspace/project key. Check app password scopes and project key.
                        </p>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="space-y-1 md:col-span-1">
                    <Label>{isBitbucket ? "Bitbucket repository" : isGithub ? "GitHub repository" : "GitLab project"}</Label>
                    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
                      {isBitbucket
                        ? externalContextStatus?.repositorySlug || projectName || "ΓÇö"
                        : isGithub
                          ? externalContextStatus?.repository || projectName || "ΓÇö"
                        : externalContextStatus?.projectRef || projectName || "ΓÇö"}
                    </div>
                  </div>
                )
              ) : (
                <div className="space-y-1"><Label>Repository</Label><Select value={repoId} onValueChange={handleRepo}><SelectTrigger><SelectValue placeholder="Select repo" /></SelectTrigger><SelectContent>{reposData.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select></div>
              )}
              <div className="space-y-1"><Label>Branch</Label><Select value={branchName} onValueChange={setBranchName}><SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger><SelectContent>{(branchesData || []).map((b: any) => <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
          )}

          {currentStep === "mode" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card
                className={`rounded-2xl shadow-sm border border-l-[3px] transition-colors ${
                  setupMode === "existingYaml"
                    ? "bg-muted/40 ring-1 ring-cyan-500/25 border-l-cyan-500 border-border/40"
                    : "border-border/40 border-l-border"
                }`}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold">Use Existing YAML</div>
                  <div className="text-xs text-muted-foreground">
                    Create a pipeline from YAML in your repository. Configure the YAML path in the Execution step before running.
                  </div>
                  <Button size="sm" onClick={() => setSetupMode("existingYaml")}>
                    Select
                  </Button>
                </CardContent>
              </Card>
              <Card
                className={`rounded-2xl shadow-sm border border-l-[3px] transition-colors ${
                  setupMode === "template"
                    ? "bg-muted/40 ring-1 ring-violet-500/25 border-l-violet-500 border-border/40"
                    : "border-border/40 border-l-border"
                }`}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold">{isExternalCi ? "Use Configure Preset" : "Use Template"}</div>
                  <div className="text-xs text-muted-foreground">
                    {isExternalCi
                      ? "Pick a provider preset and generate a valid starter YAML, then customize."
                      : "Instantiate saved template with runtime inputs."}
                  </div>
                  <Button size="sm" onClick={() => setSetupMode("template")}>
                    Select
                  </Button>
                </CardContent>
              </Card>
              <Card
                className={`rounded-2xl shadow-sm border border-l-[3px] transition-colors ${
                  setupMode === "newPipeline"
                    ? "bg-muted/40 ring-1 ring-emerald-500/25 border-l-emerald-500 border-border/40"
                    : "border-border/40 border-l-border"
                }`}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold">Start New Pipeline</div>
                  <div className="text-xs text-muted-foreground">Build new stages and YAML from scratch.</div>
                  <Button size="sm" onClick={() => setSetupMode("newPipeline")}>
                    Select
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {currentStep === "stages" && (
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">{STAGE_TYPES.map((type) => <Button key={type} size="sm" variant="outline" onClick={() => addStageType(type)}><Plus className="h-4 w-4 mr-1" />{type}</Button>)}</div>
              <div className="space-y-2">{stages.map((s) => <div key={s.id} className="rounded-md border border-border p-3"><div className="font-medium text-sm">{s.name}</div><div className="text-xs text-muted-foreground">{s.jobs.join(", ")}</div></div>)}</div>
            </div>
          )}

          {currentStep === "infra" && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">Azure access: {azureAccessStatus}</div>
              <div className="flex items-center gap-2"><Checkbox id="use-existing-services" checked={useExistingServices} onCheckedChange={(v) => setUseExistingServices(!!v)} /><Label htmlFor="use-existing-services">Use existing services</Label></div>
              {useExistingServices ? (
                <div className="max-h-48 overflow-auto rounded-md border border-border p-2 space-y-2">
                  {infraResources.length === 0 ? <div className="text-xs text-muted-foreground">No ready resources found.</div> : infraResources.map((r: any) => {
                    const checked = selectedInfraResourceIds.includes(String(r.id));
                    return <label key={r.id} className="flex items-center gap-2 text-xs cursor-pointer"><Checkbox checked={checked} onCheckedChange={(v) => setSelectedInfraResourceIds((prev) => v ? [...prev, String(r.id)] : prev.filter((id) => id !== String(r.id)))} /><span>{r.serviceType} - {r.appServiceName || r.databaseName || r.id}</span></label>;
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Select value={infraSubscriptionId} onValueChange={setInfraSubscriptionId}>
                    <SelectTrigger><SelectValue placeholder="Select Azure subscription" /></SelectTrigger>
                    <SelectContent>
                      {azureSubscriptions.map((sub) => (
                        <SelectItem key={sub.id} value={sub.id}>
                          {sub.displayName} ({sub.id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="space-y-2">
                    <Select
                      value={isCustomResourceGroup ? CUSTOM_RESOURCE_GROUP_OPTION : infraResourceGroup}
                      onValueChange={(value) => {
                        if (value === CUSTOM_RESOURCE_GROUP_OPTION) {
                          setIsCustomResourceGroup(true);
                          setInfraResourceGroup("");
                          return;
                        }
                        setIsCustomResourceGroup(false);
                        setInfraResourceGroup(value);
                      }}
                      disabled={!infraSubscriptionId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={infraSubscriptionId ? "Select Resource Group" : "Select Azure subscription first"} />
                      </SelectTrigger>
                      <SelectContent>
                        {azureResourceGroups.map((rg) => (
                          <SelectItem key={rg.id || rg.name} value={rg.name}>
                            {rg.name}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_RESOURCE_GROUP_OPTION}>Custom resource group...</SelectItem>
                      </SelectContent>
                    </Select>
                    {isCustomResourceGroup && (
                      <Input placeholder="Resource Group" value={infraResourceGroup} onChange={(e) => setInfraResourceGroup(e.target.value)} />
                    )}
                  </div>
                  <Select value={infraRegion} onValueChange={setInfraRegion}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="eastus">East US</SelectItem><SelectItem value="eastus2">East US 2</SelectItem><SelectItem value="westus">West US</SelectItem><SelectItem value="centralus">Central US</SelectItem><SelectItem value="westeurope">West Europe</SelectItem></SelectContent></Select>
                  <Input placeholder="App Service Name" value={infraAppServiceName} onChange={(e) => setInfraAppServiceName(e.target.value)} />
                  <Input placeholder="SWA Name" value={infraSwaName} onChange={(e) => setInfraSwaName(e.target.value)} />
                  <Input placeholder="Database Name" value={infraDatabaseName} onChange={(e) => setInfraDatabaseName(e.target.value)} />
                  <Input placeholder="Database Server Name" value={infraDatabaseServerName} onChange={(e) => setInfraDatabaseServerName(e.target.value)} />
                  <div className="flex items-center gap-2"><Checkbox id="db-migration-enabled" checked={dbMigrationEnabled} onCheckedChange={(v) => setDbMigrationEnabled(!!v)} /><Label htmlFor="db-migration-enabled">Enable DB migration</Label></div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:col-span-2">
                    <Button variant="outline" onClick={() => createInfraQuick("Web App")}><Cloud className="h-4 w-4 mr-1" />Create App Service</Button>
                    <Button variant="outline" onClick={() => createInfraQuick("Static Site")}><Cloud className="h-4 w-4 mr-1" />Create SWA</Button>
                    <Button variant="outline" onClick={() => createInfraQuick("Database")}><Cloud className="h-4 w-4 mr-1" />Create DB</Button>
                  </div>
                </div>
              )}
              {azureSubscriptionsError ? (
                <div className="text-xs text-destructive">
                  Unable to load Azure subscriptions. Try Azure access (user token) or configure server Azure credentials.
                </div>
              ) : null}
              {azureResourceGroupsError && infraSubscriptionId ? (
                <div className="text-xs text-destructive">
                  Unable to load resource groups for the selected subscription.
                </div>
              ) : null}
            </div>
          )}

          {currentStep === "execution" && (
            <div className="space-y-4">
              {setupMode === "newPipeline" && isExternalCi ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" type="button" onClick={lintExternalCiYaml} disabled={gitlabLintLoading}>
                      {gitlabLintLoading ? "ValidatingΓÇª" : isGitLab ? "Validate (CI Lint)" : "Validate YAML"}
                    </Button>
                  </div>
                  {gitlabLintSummary ? (
                    <Alert
                      variant={gitlabLintSummary.valid ? "default" : "destructive"}
                      className="rounded-2xl border-border/40"
                    >
                      <AlertTitle>{gitlabLintSummary.valid ? "Lint OK" : "Lint issues"}</AlertTitle>
                      <AlertDescription className="space-y-2 text-xs font-mono whitespace-pre-wrap">
                        {gitlabLintSummary.status ? <div>Status: {gitlabLintSummary.status}</div> : null}
                        {Array.isArray(gitlabLintSummary.errors) && gitlabLintSummary.errors.length > 0 ? (
                          <div>Errors: {gitlabLintSummary.errors.map((e) => JSON.stringify(e)).join("\n")}</div>
                        ) : null}
                        {Array.isArray(gitlabLintSummary.warnings) && gitlabLintSummary.warnings.length > 0 ? (
                          <div>Warnings: {gitlabLintSummary.warnings.map((w) => JSON.stringify(w)).join("\n")}</div>
                        ) : null}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </>
              ) : null}
              {setupMode === "existingYaml" && (
                <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-cyan-500">
                  <CardHeader>
                    <CardTitle>Existing YAML Confirmation</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Select
                      value={selectedYamlPathOption}
                      onValueChange={(v) => {
                        setSelectedYamlPathOption(v);
                        if (v !== CUSTOM_YAML_OPTION) setYamlPath(v);
                      }}
                      disabled={(!isExternalCi && !repoId) || !branchName}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            (isExternalCi || repoId) && branchName ? "Select YAML path" : "Select repo and branch first"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {yamlFilesData.length === 0 && !isLoadingYamlFiles ? (
                          <SelectItem value="__no_yaml_found__" disabled>
                            No YAML files found in selected branch
                          </SelectItem>
                        ) : null}
                        {yamlPathOptions.map((pathOption) => (
                          <SelectItem key={pathOption} value={pathOption}>
                            {pathOption === CUSTOM_YAML_OPTION ? "Custom path..." : pathOption}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedYamlPathOption === CUSTOM_YAML_OPTION && (
                      <Input value={yamlPath} onChange={(e) => setYamlPath(e.target.value)} placeholder="Enter custom YAML path" />
                    )}
                    <Button variant="outline" type="button" onClick={previewExistingYaml}>
                      {isBitbucket ? "Fetch YAML from Bitbucket" : isGithub ? "Fetch YAML from GitHub" : isGitLab ? "Fetch YAML from GitLab" : "Fetch YAML Preview"}
                    </Button>
                    <Textarea value={existingYamlPreview} onChange={(e) => setExistingYamlPreview(e.target.value)} rows={12} />
                  </CardContent>
                </Card>
              )}
              {setupMode === "template" && (
                <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500">
                  <CardHeader>
                    <CardTitle>{isExternalCi ? "Configure" : "Template Inputs"}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select template" />
                      </SelectTrigger>
                      <SelectContent>
                        {effectiveTemplatesData.map((t: any) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!isExternalCi ? templateRuntimeVars.map((row, idx) => (
                      <div key={`var-${idx}`} className="grid grid-cols-2 gap-2">
                        <Input
                          placeholder="Variable key"
                          value={row.key}
                          onChange={(e) =>
                            setTemplateRuntimeVars((prev) => prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)))
                          }
                        />
                        <Input
                          placeholder="Variable value"
                          value={row.value}
                          onChange={(e) =>
                            setTemplateRuntimeVars((prev) => prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))
                          }
                        />
                      </div>
                    )) : null}
                    {!isExternalCi ? (
                      <Button variant="outline" type="button" onClick={() => setTemplateRuntimeVars((prev) => [...prev, { key: "", value: "" }])}>
                        <Plus className="h-4 w-4 mr-1" />
                        Add Runtime Variable
                      </Button>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Configure preset generates starter YAML. You can edit YAML below before save/trigger.
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              {setupMode === "newPipeline" && isExternalCi ? (
                <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-amber-500">
                  <CardHeader>
                    <CardTitle>CI file path</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Select
                      value={selectedYamlPathOption}
                      onValueChange={(v) => {
                        setSelectedYamlPathOption(v);
                        if (v !== CUSTOM_YAML_OPTION) setYamlPath(v);
                      }}
                      disabled={!branchName}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={branchName ? "Select CI YAML path" : "Select branch first"} />
                      </SelectTrigger>
                      <SelectContent>
                        {yamlFilesData.length === 0 && !isLoadingYamlFiles ? (
                          <SelectItem value="__no_yaml_found__" disabled>
                            No YAML files found in selected branch
                          </SelectItem>
                        ) : null}
                        {yamlPathOptions.map((pathOption) => (
                          <SelectItem key={pathOption} value={pathOption}>
                            {pathOption === CUSTOM_YAML_OPTION ? "Custom path..." : pathOption}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedYamlPathOption === CUSTOM_YAML_OPTION && (
                      <Input
                        value={yamlPath}
                        onChange={(e) => setYamlPath(e.target.value)}
                        placeholder={isBitbucket ? "bitbucket-pipelines.yml" : isGithub ? ".github/workflows/ci.yml" : ".gitlab-ci.yml"}
                      />
                    )}
                  </CardContent>
                </Card>
              ) : null}
              {(setupMode === "newPipeline" || (setupMode === "template" && isExternalCi)) && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {setupMode === "newPipeline" ? (
                    <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-blue-500">
                      <CardHeader>
                        <CardTitle>Pipeline Builder</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex gap-2 flex-wrap">
                          {TASK_LIBRARY.map((task) => (
                            <Badge key={task} draggable onDragStart={(e) => e.dataTransfer.setData("task", task)} className="cursor-grab">
                              {task}
                            </Badge>
                          ))}
                        </div>
                        <div className="space-y-2">
                          {stages.map((s) => (
                            <div
                              key={s.id}
                              className="rounded-md border border-border p-2"
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                const task = e.dataTransfer.getData("task");
                                if (task) addJobToStage(s.id, task);
                              }}
                            >
                              <div className="font-medium text-sm">{s.name}</div>
                              <ul className="mt-1 space-y-1">
                                {s.jobs.map((j, idx) => (
                                  <li key={`${s.id}-${idx}`} className="text-xs text-muted-foreground">
                                    - {j}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                        <Button className="w-full" type="button" onClick={generateYaml}>
                          <RefreshCw className="h-4 w-4 mr-1" />
                          Generate YAML
                        </Button>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-blue-500">
                      <CardHeader>
                        <CardTitle>Configure Preset</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm text-muted-foreground">
                        Template-generated YAML is loaded. Review and customize in the editor before saving.
                      </CardContent>
                    </Card>
                  )}
                  <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-emerald-500">
                    <CardHeader>
                      <CardTitle>YAML Editor</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Textarea value={yamlContent} onChange={(e) => setYamlContent(e.target.value)} rows={22} />
                    </CardContent>
                  </Card>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Checkbox id="run-after-create" checked={runAfterCreate} onCheckedChange={(v) => setRunAfterCreate(!!v)} />
                <Label htmlFor="run-after-create">
                  {isExternalCi ? "Save & trigger after commit" : "Run immediately after create"}
                </Label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {setupMode === "existingYaml" ? (
                  <>
                    <Button className="w-full" variant="outline" type="button" onClick={() => createFromExistingYaml(false)}>
                      <Rocket className="h-4 w-4 mr-2" />
                      {isExternalCi ? "Save Pipeline" : "Create Pipeline"}
                    </Button>
                    <Button className="w-full" type="button" onClick={() => createFromExistingYaml(true)}>
                      <Play className="h-4 w-4 mr-2" />
                      {isExternalCi ? "Save & Trigger" : "Create and Run Pipeline"}
                    </Button>
                  </>
                ) : (setupMode === "newPipeline" || setupMode === "template") && isExternalCi ? (
                  <>
                    <Button className="w-full" variant="outline" type="button" onClick={() => commitExternalCiPipelineStudio(false)}>
                      <Rocket className="h-4 w-4 mr-2" />
                      Save Pipeline
                    </Button>
                    <Button className="w-full" type="button" onClick={() => commitExternalCiPipelineStudio(true)}>
                      <Play className="h-4 w-4 mr-2" />
                      Save & Trigger
                    </Button>
                  </>
                ) : (
                  <Button className="w-full" type="button" onClick={createOrchestratedPipeline}>
                    <Rocket className="h-4 w-4 mr-2" />
                    Create Pipeline
                  </Button>
                )}
              </div>
              {pipelineExecutionResult ? (
                <Alert
                  variant={pipelineExecutionResult.variant === "error" ? "destructive" : "default"}
                  className={
                    pipelineExecutionResult.variant === "success"
                      ? "rounded-2xl border-emerald-200 bg-emerald-50 text-emerald-950"
                      : pipelineExecutionResult.variant === "warning"
                        ? "rounded-2xl border-amber-200 bg-amber-50 text-amber-950"
                        : "rounded-2xl"
                  }
                >
                  {pipelineExecutionResult.variant === "success" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertTitle>{pipelineExecutionResult.title}</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <div>{pipelineExecutionResult.message}</div>
                    <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                      {pipelineExecutionResult.filePath ? (
                        <div>
                          <span className="font-medium">File:</span> {pipelineExecutionResult.filePath}
                        </div>
                      ) : null}
                      {pipelineExecutionResult.branch ? (
                        <div>
                          <span className="font-medium">Branch:</span> {pipelineExecutionResult.branch}
                        </div>
                      ) : null}
                      {pipelineExecutionResult.pipeline?.status ? (
                        <div>
                          <span className="font-medium">Pipeline:</span>{" "}
                          {pipelineExecutionResult.pipeline.id ? `#${pipelineExecutionResult.pipeline.id} ` : ""}
                          {pipelineExecutionResult.pipeline.status}
                        </div>
                      ) : null}
                    </div>
                    {pipelineExecutionResult.pipeline?.web_url ? (
                      <a
                        href={pipelineExecutionResult.pipeline.web_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline"
                      >
                        Open pipeline in GitLab
                      </a>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          )}
          </>
          )}

          {initialAction === "runExisting" && currentStep === "execution" && (
            <div className="space-y-4">
              {isExternalCi ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" type="button" onClick={lintExternalCiYaml} disabled={gitlabLintLoading}>
                      {gitlabLintLoading ? "ValidatingΓÇª" : isGitLab ? "Validate (CI Lint)" : "Validate YAML"}
                    </Button>
                  </div>
                  {gitlabLintSummary ? (
                    <Alert
                      variant={gitlabLintSummary.valid ? "default" : "destructive"}
                      className="rounded-2xl border-border/40"
                    >
                      <AlertTitle>{gitlabLintSummary.valid ? "Lint OK" : "Lint issues"}</AlertTitle>
                      <AlertDescription className="space-y-2 text-xs font-mono whitespace-pre-wrap">
                        {gitlabLintSummary.status ? <div>Status: {gitlabLintSummary.status}</div> : null}
                        {Array.isArray(gitlabLintSummary.errors) && gitlabLintSummary.errors.length > 0 ? (
                          <div>Errors: {gitlabLintSummary.errors.map((e) => JSON.stringify(e)).join("\n")}</div>
                        ) : null}
                        {Array.isArray(gitlabLintSummary.warnings) && gitlabLintSummary.warnings.length > 0 ? (
                          <div>Warnings: {gitlabLintSummary.warnings.map((w) => JSON.stringify(w)).join("\n")}</div>
                        ) : null}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </>
              ) : null}
              <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-cyan-500">
                <CardHeader><CardTitle>Existing YAML Confirmation</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <Select
                    value={selectedYamlPathOption}
                    onValueChange={(v) => {
                      setSelectedYamlPathOption(v);
                      if (v !== CUSTOM_YAML_OPTION) setYamlPath(v);
                    }}
                    disabled={(!isExternalCi && !repoId) || !branchName}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          (isExternalCi || repoId) && branchName ? "Select YAML path" : "Select repo and branch first"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {yamlFilesData.length === 0 && !isLoadingYamlFiles ? (
                        <SelectItem value="__no_yaml_found__" disabled>No YAML files found in selected branch</SelectItem>
                      ) : null}
                      {yamlPathOptions.map((pathOption) => (
                        <SelectItem key={pathOption} value={pathOption}>
                          {pathOption === CUSTOM_YAML_OPTION ? "Custom path..." : pathOption}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedYamlPathOption === CUSTOM_YAML_OPTION && (
                    <Input value={yamlPath} onChange={(e) => setYamlPath(e.target.value)} placeholder="Enter custom YAML path" />
                  )}
                  <Button variant="outline" type="button" onClick={previewExistingYaml}>
                    {isBitbucket ? "Fetch YAML from Bitbucket" : isGithub ? "Fetch YAML from GitHub" : isGitLab ? "Fetch YAML from GitLab" : "Validate and Load YAML"}
                  </Button>
                  <Textarea value={existingYamlPreview} onChange={(e) => setExistingYamlPreview(e.target.value)} rows={12} />
                </CardContent>
              </Card>
              <Button className="w-full" type="button" onClick={runExisting}>
                <Play className="h-4 w-4 mr-2" />
                Run Existing Pipeline
              </Button>
            </div>
          )}

          {initialAction === "createNew" && (
            <div className="flex justify-between pt-2 border-t border-border">
              <Button variant="outline" onClick={() => (currentStep === "basics" ? goToActionSelection() : moveStep("prev"))}>Previous</Button>
              <div className="flex gap-2">
                {currentStep === "execution" ? (
                  <Button onClick={() => setLocation("/sdlc")}><CheckCircle2 className="h-4 w-4 mr-1" />Done</Button>
                ) : (
                  <Button onClick={() => moveStep("next")}><CheckCircle2 className="h-4 w-4 mr-1" />Next</Button>
                )}
              </div>
            </div>
          )}
          {initialAction === "runExisting" && (
            <div className="flex justify-between pt-2 border-t border-border">
              <Button variant="outline" onClick={() => (currentStep === "basics" ? goToActionSelection() : moveStep("prev"))}>Previous</Button>
              <div className="flex gap-2">
                {currentStep === "execution" ? (
                  <Button onClick={() => setLocation("/sdlc")}><CheckCircle2 className="h-4 w-4 mr-1" />Done</Button>
                ) : (
                  <Button onClick={() => moveStep("next")}><CheckCircle2 className="h-4 w-4 mr-1" />Next</Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
