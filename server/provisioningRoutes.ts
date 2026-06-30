import type { Express, Request, Response } from "express";
import { isAwsHosting } from "./platform/hosting";
import { db } from "./db";
import { eq, and, ne, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import mysql2 from "mysql2/promise";
import { provisioningInstances } from "@shared/schema";
import { createAzureProvisioningService, AzureProvisioningService } from "./services/azure-provisioning-service";
import { createUserAzureService } from "./services/user-azure-service";
import { AzureDevOpsService } from "./azure-devops-service";
import { requireAuth } from "./auth/middleware";
import type {
  CreateInstancePayload,
  ProvisionInstanceResponse,
  ListInstancesResponse,
  UserAzureContext,
} from "@shared/types/provisioning.types";

// Helper: build AzureDevOpsService from env vars (DevXPlatform / NousAugmentedDevX)
function getDeployAdoService() {
  const organization = process.env.ADO_ORG;
  const project = process.env.ADO_PROJECT;
  // Use the dedicated provisioning PAT; fall back to ADO_PAT
  const pat = process.env["Provision_ado_source _pat"] || process.env.ADO_PAT;
  if (!organization || !project || !pat) throw new Error("ADO_ORG, ADO_PROJECT and Provision_ado_source_pat env vars are required");
  return new AzureDevOpsService({ organization, project, pat });
}

async function resolveProvisioningSqlScriptPath(): Promise<string> {
  const cwd = process.cwd();
  const targetFileName = "Provision_7_04_2026.sql";
  const candidates = [cwd, path.resolve(cwd, "..")].flatMap((root) => [
    path.join(root, "migrations", "auto-generated", targetFileName),
    path.join(root, "migrations", targetFileName),
  ]);

  for (const filePath of candidates) {
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    `Provisioning SQL script not found. Expected file: ${targetFileName}. Checked paths: ${candidates
      .map((p) => path.relative(cwd, p))
      .join(", ")}`
  );
}

const APP_SETTING_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BLOCKED_APP_SETTING_KEYS = new Set([
  "ALLUSERSPROFILE",
  "APPDATA",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "COMMONPROGRAMW6432",
  "COMSPEC",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "PSMODULEPATH",
  "PUBLIC",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
]);

function sanitizeAppSettings(raw: Record<string, string> | undefined): {
  sanitized: Record<string, string>;
  removedKeys: string[];
} {
  if (!raw) return { sanitized: {}, removedKeys: [] };
  const sanitized: Record<string, string> = {};
  const removedKeys: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = String(rawKey || "").trim();
    if (!key) continue;

    const keyUpper = key.toUpperCase();
    const isValidName = APP_SETTING_KEY_PATTERN.test(key) && key.length <= 128;
    const isBlocked =
      BLOCKED_APP_SETTING_KEYS.has(keyUpper) ||
      keyUpper.startsWith("PROCESSOR_");

    if (!isValidName || isBlocked) {
      removedKeys.push(key);
      continue;
    }

    sanitized[key] = String(rawValue ?? "");
  }

  return { sanitized, removedKeys };
}

export function registerProvisioningRoutes(app: Express): void {
  if (isAwsHosting()) {
    const payload = {
      error: "not_implemented",
      message:
        "Azure provisioning APIs are not available when DEVX_HOSTING=aws. AWS provisioning will be added in a follow-up.",
    };
    const send501 = (_req: Request, res: Response) => res.status(501).json(payload);
    app.use("/api/azure", send501);
    app.all("/api/azure-config-check", send501);
    app.use("/api/instances", send501);
    app.use("/api/provisioning", send501);
    return;
  }

  // ==============================
  // Infrastructure Provisioning APIs
  // ==============================

  // Get user's Azure subscriptions
  app.get("/api/azure/subscriptions", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const tenantId = req.headers["x-tenant-id"] as string || "";
    const armToken = req.headers["x-azure-token"] as string || "";

    if (!userId) {
      return res.status(401).json({ error: "Authentication required", message: "User ID is required" });
    }

    try {
      const userAzureService = createUserAzureService(armToken, tenantId);
      const subscriptions = await userAzureService.getUserSubscriptions();

      const context: UserAzureContext = {
        subscriptions,
        defaultSubscription: subscriptions.find(s => s.state === "Enabled") || subscriptions[0]
      };

      return res.json(context);
    } catch (error: any) {
      console.error("[Azure] Error fetching user subscriptions:", error);
      return res.status(500).json({ error: "Failed to fetch subscriptions", message: error.message });
    }
  });

  // Get resource groups for a subscription
  app.get("/api/azure/subscriptions/:subscriptionId/resource-groups", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const tenantId = req.headers["x-tenant-id"] as string || "";
    const armToken = req.headers["x-azure-token"] as string || "";
    const subscriptionId = req.params.subscriptionId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required", message: "User ID is required" });
    }

    try {
      const userAzureService = createUserAzureService(armToken, tenantId);
      const resourceGroups = await userAzureService.getResourceGroups(subscriptionId);
      return res.json({ resourceGroups });
    } catch (error: any) {
      console.error("[Azure] Error fetching resource groups:", error);
      return res.status(500).json({ error: "Failed to fetch resource groups", message: error.message });
    }
  });

  // Create a new resource group in a subscription
  app.post("/api/azure/subscriptions/:subscriptionId/resource-groups", requireAuth, async (req: Request, res: Response) => {
    const tenantId = req.headers["x-tenant-id"] as string || "";
    const armToken = req.headers["x-azure-token"] as string || "";
    const { subscriptionId } = req.params;
    const { name, location } = req.body;

    if (!name || !location) {
      return res.status(400).json({ error: "name and location are required" });
    }

    try {
      const userAzureService = createUserAzureService(armToken, tenantId);
      const rg = await userAzureService.createResourceGroup(subscriptionId, name, location);
      return res.status(201).json({ resourceGroup: rg });
    } catch (error: any) {
      console.error("[Azure] Error creating resource group:", error);
      return res.status(500).json({ error: "Failed to create resource group", message: error.message });
    }
  });

  // List existing database servers in a resource group by engine type
  app.get("/api/azure/subscriptions/:subscriptionId/resource-groups/:rgName/database-servers", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const tenantId = req.headers["x-tenant-id"] as string || "";
    const armToken = req.headers["x-azure-token"] as string || "";
    const { subscriptionId, rgName } = req.params;
    const engine = req.query.engine as string || "Azure SQL";

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      const userAzureService = createUserAzureService(armToken, tenantId);
      const servers = await userAzureService.listDatabaseServers(engine, subscriptionId, rgName);
      return res.json({ servers });
    } catch (error: any) {
      console.error("[Azure] Error listing database servers:", error);
      return res.status(500).json({ error: "Failed to list database servers", message: error.message });
    }
  });

  // ─── Deployment Setup (post-provisioning CI/CD) ───────────────────────────

  // List ADO repositories for the deployment setup wizard
  app.get("/api/provisioning/ado-repos", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    try {
      const ado = getDeployAdoService();
      const repos = await ado.getRepositories();
      const mapped = repos.map((r: any) => ({ id: r.id, name: r.name, defaultBranch: r.defaultBranch?.replace('refs/heads/', '') }));
      return res.json({ repos: mapped });
    } catch (error: any) {
      console.error("[DeploySetup] Error listing ADO repos:", error);
      return res.status(500).json({ error: "Failed to list ADO repositories", message: error.message });
    }
  });

  // List branches for a given ADO repo
  app.get("/api/provisioning/ado-repos/:repoId/branches", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const { repoId } = req.params;
    try {
      const ado = getDeployAdoService();
      const branches = await ado.listBranches(repoId);
      return res.json({ branches });
    } catch (error: any) {
      console.error("[DeploySetup] Error listing branches:", error);
      return res.status(500).json({ error: "Failed to list branches", message: error.message });
    }
  });

  // Register a redirect URI in the Azure AD app registration (spa.redirectUris)
  // Uses server-side client_credentials flow — no user popup or delegated token needed.
  // Requires AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET in env, with
  // Application.ReadWrite.OwnedBy (or .All) application permission granted via admin consent.
  app.post("/api/provisioning/register-redirect-uri", requireAuth, async (req: Request, res: Response) => {
    const { redirectUri, appClientId } = req.body as { redirectUri: string; appClientId: string };
    if (!redirectUri || !appClientId) {
      return res.status(400).json({ error: "redirectUri and appClientId are required" });
    }

    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      return res.status(501).json({
        error: "Server not configured for redirect URI registration",
        message: "Set AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET in the server environment. Then grant 'Application.ReadWrite.OwnedBy' application permission with admin consent in Azure Portal.",
      });
    }

    try {
      // 1. Acquire Graph token via client_credentials (no user interaction needed)
      const tokenRes = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
            scope: "https://graph.microsoft.com/.default",
          }).toString(),
        }
      );

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        throw new Error(`Failed to acquire Graph token (${tokenRes.status}): ${errBody}`);
      }

      const { access_token: graphToken } = await tokenRes.json();
      const graphHeaders = {
        Authorization: `Bearer ${graphToken}`,
        "Content-Type": "application/json",
      };

      // 2. Find app registration by client ID — get objectId + current spa.redirectUris
      const appRes = await fetch(
        `https://graph.microsoft.com/v1.0/applications?$filter=appId eq '${appClientId}'&$select=id,spa`,
        { headers: graphHeaders }
      );

      if (!appRes.ok) {
        const errBody = await appRes.text();
        throw new Error(`Graph API app lookup failed (${appRes.status}): ${errBody}`);
      }

      const appData = await appRes.json();
      const appObj = appData.value?.[0];
      if (!appObj) throw new Error(`App registration with appId ${appClientId} not found`);

      const objectId: string = appObj.id;
      const current: string[] = appObj.spa?.redirectUris ?? [];

      // 3. Skip if already registered
      if (current.includes(redirectUri)) {
        console.log(`[RegisterRedirectURI] Already registered: ${redirectUri}`);
        return res.json({ added: false, redirectUri });
      }

      // 4. PATCH to add the redirect URI
      const patchRes = await fetch(
        `https://graph.microsoft.com/v1.0/applications/${objectId}`,
        {
          method: "PATCH",
          headers: graphHeaders,
          body: JSON.stringify({ spa: { redirectUris: [...current, redirectUri] } }),
        }
      );

      if (!patchRes.ok) {
        const errBody = await patchRes.text();
        throw new Error(`Graph API PATCH failed (${patchRes.status}): ${errBody}`);
      }

      console.log(`[RegisterRedirectURI] Added ${redirectUri} to app ${appClientId}`);
      return res.json({ added: true, redirectUri });
    } catch (err: any) {
      console.error("[RegisterRedirectURI] Failed:", err.message);
      return res.status(500).json({ error: "Failed to register redirect URI", message: err.message });
    }
  });

  // Fetch SWA deployment token for a Static Web App instance
  app.post("/api/instances/:id/swa-token", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const armToken = req.headers["x-azure-token"] as string || "";
    const instanceId = req.params.id;

    if (!userId) return res.status(401).json({ error: "Authentication required" });
    if (!armToken) return res.status(401).json({ error: "ARM token required" });

    try {
      const rows = await db
        .select()
        .from(provisioningInstances)
        .where(and(eq(provisioningInstances.id, instanceId), eq(provisioningInstances.userId, userId)))
        .limit(1);

      if (!rows.length) return res.status(404).json({ error: "Instance not found" });

      const instance = rows[0];
      if (!instance.subscriptionId || !instance.resourceGroupName || !instance.appServiceName) {
        return res.status(400).json({ error: "Instance is missing Azure resource info" });
      }

      const userAzureService = createUserAzureService(armToken, "");
      const token = await userAzureService.getSwaDeploymentToken(
        instance.subscriptionId,
        instance.resourceGroupName,
        instance.appServiceName
      );

      return res.json({ token });
    } catch (err: any) {
      console.error("[SWA Token] Failed to fetch:", err.message);
      return res.status(500).json({ error: "Failed to fetch SWA deployment token", message: err.message });
    }
  });

  // Setup deployment for a provisioned instance
  app.post("/api/instances/:id/setup-deployment", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const tenantId = req.headers["x-tenant-id"] as string || "";
    const armToken = req.headers["x-azure-token"] as string || "";
    const instanceId = req.params.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });

    const {
      deploymentType,
      sourceRepoId,
      sourceBranch,
      targetBranchMode,
      targetBranch,
      pipelineConfig,
      appSettings,
      backendInstanceId,
      backendSubscriptionId,
    } = req.body as {
      deploymentType: "fullstack" | "single-appservice" | "single-swa";
      sourceRepoId: string;
      sourceBranch: string;
      targetBranchMode: "new" | "existing";
      targetBranch: string;
      pipelineConfig: {
        environmentKey: string;
        environmentLabel: string;
        appServiceName: string;
        resourceGroupName: string;
        azureSubscription: string;
        appServiceUrl: string;
        swaToken?: string;
        staticWebAppHostname?: string;
        corsOrigin?: string;
      };
      appSettings: Record<string, string>;
      backendInstanceId?: string;
      backendSubscriptionId?: string;
    };

    try {
      const ensureSocketOriginHelper = (apiConfig: string): string => {
        if (apiConfig.includes("export function getSocketOrigin()")) return apiConfig;
        const anchor = "export const API_BASE_URL = getBackendBaseUrl();";
        if (!apiConfig.includes(anchor)) return apiConfig;
        const helper = `

// Socket.IO should connect to backend host in hosted envs.
// In local development (empty API_BASE_URL), fall back to current origin.
export function getSocketOrigin(): string {
  if (API_BASE_URL) {
    return API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  }
  if (typeof window !== "undefined" && window.location) {
    return window.location.origin;
  }
  return "";
}
`;
        return apiConfig.replace(anchor, `${anchor}${helper}`);
      };

      const ensureSocketImportAndUsage = (content: string): string => {
        let next = content;

        const apiConfigImportRegex = /import\s*\{([^}]+)\}\s*from\s*["']@\/lib\/api-config["'];/;
        const match = next.match(apiConfigImportRegex);
        if (match) {
          const imports = match[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (!imports.includes("getSocketOrigin")) {
            imports.push("getSocketOrigin");
            const deduped = Array.from(new Set(imports));
            next = next.replace(
              apiConfigImportRegex,
              `import { ${deduped.join(", ")} } from "@/lib/api-config";`
            );
          }
        } else if (next.includes("from 'socket.io-client';") && !next.includes("getSocketOrigin")) {
          next = next.replace(
            "import { io, Socket } from 'socket.io-client';",
            "import { io, Socket } from 'socket.io-client';\nimport { getSocketOrigin } from '@/lib/api-config';"
          );
        }

        next = next.replace(/window\.location\.origin/g, "getSocketOrigin()");
        return next;
      };

      // 1. Load and validate instance
      const instanceRows = await db
        .select()
        .from(provisioningInstances)
        .where(and(eq(provisioningInstances.id, instanceId), eq(provisioningInstances.userId, userId)))
        .limit(1);
      if (instanceRows.length === 0) return res.status(404).json({ error: "Instance not found" });
      const instance = instanceRows[0];
      if (instance.status !== "ready") return res.status(400).json({ error: "Instance is not ready yet" });

      // 2. Build ADO service from env vars (DevXPlatform / NousAugmentedDevX)
      const ado = getDeployAdoService();

      // 3. Create branch (if new)
      let branchCreated = false;
      if (targetBranchMode === "new") {
        await ado.createBranch(sourceRepoId, targetBranch, sourceBranch);
        branchCreated = true;
      }

      // 4. Read and update azure-pipelines.yml
      let pipelineUpdated = false;
      let apiConfigUpdated = false;
      let socketConfigUpdated = false;
      try {
        const pipelineContent = await ado.getFileContent(sourceRepoId, "azure-pipelines.yml", targetBranch);

        // a) Add trigger branch
        let updatedPipeline = pipelineContent.replace(
          /(trigger:\s*\n\s*branches:\s*\n\s*include:\s*\n(?:\s*-\s*[^\n]+\n)+)/,
          (match: string) => match.trimEnd() + `\n      - ${targetBranch}\n`
        );

        // b) Add variables block — include only vars relevant to the deployment type
        const varLines: string[] = [`  # ${pipelineConfig.environmentLabel} Environment Variables`];
        if (deploymentType === "fullstack" || deploymentType === "single-appservice") {
          varLines.push(`  - name: ${pipelineConfig.environmentKey}AppServiceName\n    value: '${pipelineConfig.appServiceName}'`);
          varLines.push(`  - name: ${pipelineConfig.environmentKey}ResourceGroup\n    value: '${pipelineConfig.resourceGroupName}'`);
        }
        if (deploymentType === "fullstack" || deploymentType === "single-swa") {
          varLines.push(`  - name: ${pipelineConfig.environmentKey}SwaToken\n    value: '${pipelineConfig.swaToken || ""}'`);
        }
        const newVarsBlock = varLines.join("\n") + "\n";

        updatedPipeline = updatedPipeline.replace(
          /(\nstages:)/,
          `\n${newVarsBlock}$1`
        );

        // c) Build new Deploy stage
        const envKey = pipelineConfig.environmentKey;
        const envLabel = pipelineConfig.environmentLabel;
        const includeFrontend = deploymentType === "fullstack" || deploymentType === "single-swa";
        const includeBackend = deploymentType === "fullstack" || deploymentType === "single-appservice";
        const frontendJob = includeFrontend ? `
      - deployment: DeployFrontend${envKey}
        displayName: 'Deploy Frontend to ${envLabel} (Static Web App)'
        environment: '${envKey}-frontend'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: DownloadBuildArtifacts@0
                  displayName: 'Download Frontend Artifacts'
                  inputs:
                    buildType: 'current'
                    downloadType: 'specific'
                    artifactName: 'frontend'
                    downloadPath: '\$(Pipeline.Workspace)'

                - script: |
                    if [ -f "\$(Pipeline.Workspace)/frontend/index.html" ]; then
                      cp -r \$(Pipeline.Workspace)/frontend/* .
                    elif [ -d "\$(Pipeline.Workspace)/frontend/dist/public" ] && [ -f "\$(Pipeline.Workspace)/frontend/dist/public/index.html" ]; then
                      cp -r \$(Pipeline.Workspace)/frontend/dist/public/* .
                    else
                      echo "ERROR: Could not find index.html"
                      exit 1
                    fi
                    test -f index.html && echo "✓ index.html found" || exit 1
                  displayName: 'Prepare Static Web App Files'
                  workingDirectory: '\$(System.DefaultWorkingDirectory)'

                - task: AzureStaticWebApp@0
                  displayName: 'Deploy Static Web App to ${envLabel}'
                  inputs:
                    azure_static_web_apps_api_token: '\$(${envKey}SwaToken)'
                    app_location: '/'
                    api_location: ''
                    output_location: '/'
                    skip_app_build: true
` : "";

        const backendJob = includeBackend ? `
      - deployment: DeployBackend${envKey}
        displayName: 'Deploy Backend to ${envLabel} (App Service)'
        environment: '${envKey}-backend'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: DownloadBuildArtifacts@0
                  displayName: 'Download Backend Artifacts'
                  inputs:
                    buildType: 'current'
                    downloadType: 'specific'
                    artifactName: 'backend'
                    downloadPath: '\$(Pipeline.Workspace)'

                - task: NodeTool@0
                  displayName: 'Install Node.js \$(nodeVersion)'
                  inputs:
                    versionSpec: '\$(nodeVersion)'

                - script: |
                    echo "Extracting backend zip file..."
                    cd \$(Pipeline.Workspace)/backend
                    unzip -q \$(Build.BuildId).zip -d deploy_temp
                    echo "Installing production dependencies..."
                    cd deploy_temp
                    npm ci --production --no-audit
                    echo "Re-archiving with dependencies..."
                    zip -r ../\$(Build.BuildId)-with-deps.zip .
                    cd ..
                    rm -rf deploy_temp
                  displayName: 'Install Production Dependencies'
                  workingDirectory: '\$(Pipeline.Workspace)/backend'

                - task: AzureWebApp@1
                  displayName: 'Deploy to Azure Web App - ${envLabel}'
                  inputs:
                    azureSubscription: '\$(azureSubscription)'
                    appType: '\$(appType)'
                    appName: '\$(${envKey}AppServiceName)'
                    resourceGroupName: '\$(${envKey}ResourceGroup)'
                    package: '\$(Pipeline.Workspace)/backend/\$(Build.BuildId)-with-deps.zip'
                    deploymentMethod: 'auto'
                    startUpCommand: '/home/site/wwwroot/startup.sh'

                - task: AzureAppServiceManage@0
                  displayName: 'Restart Azure App Service - ${envLabel}'
                  inputs:
                    azureSubscription: '\$(azureSubscription)'
                    Action: 'Restart Azure App Service'
                    WebAppName: '\$(${envKey}AppServiceName)'
                    ResourceGroupName: '\$(${envKey}ResourceGroup)'
` : "";

        const newStage = `
  # ============================================
  # ${envLabel.toUpperCase()} DEPLOYMENT (${targetBranch} branch)
  # ============================================
  - stage: Deploy_${envKey}
    displayName: 'Deploy to ${envLabel} Environment'
    dependsOn: Build
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/${targetBranch}'))
    jobs:${frontendJob}${backendJob}`;
        updatedPipeline = updatedPipeline.trimEnd() + "\n" + newStage;

        // Create ADO environments so the pipeline can reference them
        if (includeFrontend) await ado.createEnvironmentIfNotExists(`${envKey}-frontend`);
        if (includeBackend) await ado.createEnvironmentIfNotExists(`${envKey}-backend`);

        // 5. Also prepare api-config.ts update in the same commit
        const filesToCommit: Array<{ path: string; content: string }> = [
          { path: "azure-pipelines.yml", content: updatedPipeline },
        ];

        try {
          let apiConfig = await ado.getFileContent(sourceRepoId, "client/src/lib/api-config.ts", targetBranch);
          const originalApiConfig = apiConfig;

          if (pipelineConfig.appServiceUrl) {
            const urlObj = new URL(pipelineConfig.appServiceUrl);
            const hostname = urlObj.hostname;

            apiConfig = apiConfig.replace(
              /} as const;/,
              `  '${pipelineConfig.environmentKey}': '${pipelineConfig.appServiceUrl}',\n} as const;`
            );

            const hostCheck = `
    // ${pipelineConfig.environmentLabel}
    if (hostname.includes('${hostname}')) {
      return ENV_BACKEND_URLS['${pipelineConfig.environmentKey}'];
    }`;
            if (pipelineConfig.staticWebAppHostname) {
              const swaCheck = `
    // ${pipelineConfig.environmentLabel} Static Web App
    if (hostname.includes('${pipelineConfig.staticWebAppHostname}')) {
      return ENV_BACKEND_URLS['${pipelineConfig.environmentKey}'];
    }`;
              apiConfig = apiConfig.replace(/(\n  }\n\n  \/\/ 4\. Development mode)/, swaCheck + "$1");
            }
            apiConfig = apiConfig.replace(/(\n  }\n\n  \/\/ 4\. Development mode)/, hostCheck + "$1");
          }

          apiConfig = ensureSocketOriginHelper(apiConfig);
          if (apiConfig !== originalApiConfig) {
            filesToCommit.push({ path: "client/src/lib/api-config.ts", content: apiConfig });
            apiConfigUpdated = true;
          }
        } catch (err: any) {
          console.error("[DeploySetup] API config preparation failed:", err.message);
        }

        try {
          const socketClientPaths = [
            "client/src/components/notification-bell.tsx",
            "client/src/components/ProgressTrackingPanel.tsx",
          ];
          for (const filePath of socketClientPaths) {
            const sourceContent = await ado.getFileContent(sourceRepoId, filePath, targetBranch);
            const transformedContent = ensureSocketImportAndUsage(sourceContent);
            if (transformedContent !== sourceContent) {
              filesToCommit.push({ path: filePath, content: transformedContent });
              socketConfigUpdated = true;
            }
          }
        } catch (err: any) {
          console.error("[DeploySetup] Socket config preparation failed:", err.message);
        }

        // Push both files in one commit — single pipeline trigger
        await ado.pushMultipleFiles({
          repositoryId: sourceRepoId,
          branchName: targetBranch,
          files: filesToCommit,
          commitMessage: `chore: add ${envLabel} deployment stage, API/socket config`,
          authorName: "Astra Platform",
        });
        pipelineUpdated = true;
      } catch (err: any) {
        console.error("[DeploySetup] Pipeline + API config update failed:", err.message, err.stack);
      }

      // 6. Push App Service settings to Azure
      let appSettingsUpdated = false;
      let appSettingsError: string | undefined;
      const { sanitized: sanitizedAppSettings, removedKeys: removedAppSettingKeys } = sanitizeAppSettings(appSettings);
      const settingCount = Object.keys(sanitizedAppSettings).length;
      console.log(`[DeploySetup] App settings to push: ${settingCount}, armToken present: ${!!armToken}`);
      if (removedAppSettingKeys.length > 0) {
        console.warn(`[DeploySetup] Removed unsupported app setting keys: ${removedAppSettingKeys.join(", ")}`);
      }

      if (settingCount > 0) {
        try {
          let targetSub = instance.subscriptionId;
          let targetRg = instance.resourceGroupName;
          let targetApp = instance.appServiceName;

          if (backendInstanceId) {
            if (backendSubscriptionId) {
              targetSub = backendSubscriptionId;
            }
            const backendRows = await db
              .select()
              .from(provisioningInstances)
              .where(eq(provisioningInstances.id, backendInstanceId))
              .limit(1);
            if (backendRows.length > 0) {
              const backend = backendRows[0];
              if (!backendSubscriptionId) targetSub = backend.subscriptionId;
              targetRg = backend.resourceGroupName;
              targetApp = backend.appServiceName;
            }
          }

          console.log(`[DeploySetup] Targeting app settings → sub:${targetSub} rg:${targetRg} app:${targetApp}`);

          if (!armToken) {
            throw new Error("ARM token missing — cannot push app settings. Make sure Azure access is granted in the UI.");
          }
          if (!targetSub || !targetRg || !targetApp) {
            throw new Error(`Missing target info — sub:${targetSub} rg:${targetRg} app:${targetApp}`);
          }

          const userAzureService = createUserAzureService(armToken, tenantId);
          await userAzureService.updateAppServiceSettings(targetSub, targetRg, targetApp, sanitizedAppSettings);
          appSettingsUpdated = true;
          console.log(`[DeploySetup] App settings updated successfully for ${targetApp}`);

          // Update CORS if a frontend origin was provided
          if (pipelineConfig.corsOrigin) {
            try {
              await userAzureService.updateAppServiceCors(targetSub, targetRg, targetApp, [pipelineConfig.corsOrigin]);
              console.log(`[DeploySetup] CORS updated for ${targetApp}: ${pipelineConfig.corsOrigin}`);
            } catch (corsErr: any) {
              console.error(`[DeploySetup] CORS update failed (non-fatal): ${corsErr.message}`);
            }
          }
        } catch (err: any) {
          appSettingsError = err.message;
          console.error("[DeploySetup] App settings update failed:", err.message, err.stack);
        }
      }

      return res.json({
        branchCreated,
        branchName: targetBranch,
        pipelineUpdated,
        apiConfigUpdated,
        socketConfigUpdated,
        appSettingsUpdated,
        ...(removedAppSettingKeys.length > 0 ? { removedAppSettingKeys } : {}),
        ...(appSettingsError ? { appSettingsError } : {}),
      });
    } catch (error: any) {
      console.error("[DeploySetup] Error in setup-deployment:", error);
      return res.status(500).json({ error: "Failed to setup deployment", message: error.message });
    }
  });

  // ─── Instance Management ───────────────────────────────────────────────────

  // Create a new infrastructure instance
  app.post("/api/instances", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const tenantId = req.headers["x-tenant-id"] as string;
    const armToken = req.headers["x-azure-token"] as string || "";

    if (!userId || !tenantId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      const payload: CreateInstancePayload = req.body;
      const {
        instanceName,
        environment,
        region,
        serviceType,
        runtime,
        planTier,
        subscriptionId,
        resourceGroupName,
        advancedSettings,
        databaseConfig,
      } = payload;

      const isDatabase = serviceType === 'Database';

      if (!instanceName || !environment || !region || !serviceType || !subscriptionId || !resourceGroupName) {
        return res.status(400).json({
          error: "Missing required fields",
          message: "instanceName, environment, region, serviceType, subscriptionId, and resourceGroupName are required"
        });
      }
      if (!isDatabase && (!runtime || !planTier)) {
        return res.status(400).json({
          error: "Missing required fields",
          message: "runtime and planTier are required for non-database service types"
        });
      }
      if (isDatabase && (!databaseConfig?.engine || !databaseConfig?.serverName || !databaseConfig?.databaseName)) {
        return res.status(400).json({
          error: "Missing required fields",
          message: "databaseConfig.engine, databaseConfig.serverName, and databaseConfig.databaseName are required for Database service type"
        });
      }

      if (!/^[a-z0-9-]+$/.test(instanceName) || instanceName.length > 30) {
        return res.status(400).json({
          error: "Invalid instance name",
          message: "Instance name must be lowercase, alphanumeric with hyphens, max 30 characters"
        });
      }

      const existingInstance = await db
        .select()
        .from(provisioningInstances)
        .where(
          and(
            eq(provisioningInstances.instanceName, instanceName),
            eq(provisioningInstances.userId, userId),
            ne(provisioningInstances.status, "deleted")
          )
        )
        .limit(1);

      if (existingInstance.length > 0) {
        const instance = existingInstance[0];

        if (instance.status === "failed") {
          try {
            console.log(`[Cleanup] Checking Azure resource for failed instance: ${instanceName}`);

            if (instance.appServiceName && instance.subscriptionId && instance.resourceGroupName) {
              const azureConfig = {
                subscriptionId: instance.subscriptionId,
                tenantId: instance.tenantId || tenantId,
                resourceGroupName: instance.resourceGroupName,
                location: instance.region
              };

              const provisioningService = new AzureProvisioningService(azureConfig);
              const azureStatus = await provisioningService.getInstanceStatus(instance.appServiceName);

              if (azureStatus === 'not-found') {
                console.log(`[Cleanup] Azure resource not found, cleaning up DB record for: ${instanceName}`);
                await db
                  .update(provisioningInstances)
                  .set({ status: "deleted", updatedAt: new Date() })
                  .where(eq(provisioningInstances.id, instance.id));
                console.log(`[Cleanup] Cleaned up ${instanceName}, allowing new creation`);
              } else {
                return res.status(409).json({
                  error: "Instance name already exists",
                  message: `Instance "${instanceName}" already exists with status: ${instance.status} (Azure resource exists)`
                });
              }
            } else {
              console.log(`[Cleanup] No Azure resource info for ${instanceName}, marking as deleted`);
              await db
                .update(provisioningInstances)
                .set({ status: "deleted", updatedAt: new Date() })
                .where(eq(provisioningInstances.id, instance.id));
            }
          } catch (cleanupError) {
            console.warn(`[Cleanup] Could not verify Azure resource for ${instanceName}:`, cleanupError);
            console.log(`[Cleanup] Cleanup failed for ${instanceName}, but allowing creation attempt`);
          }
        } else {
          return res.status(409).json({
            error: "Instance name already exists",
            message: `Instance "${instanceName}" already exists with status: ${instance.status}`
          });
        }
      }

      const instanceId = randomUUID();

      await db.insert(provisioningInstances).values({
        id: instanceId,
        instanceName,
        status: "provisioning",
        environment,
        region,
        serviceType,
        runtime: runtime || null,
        planTier: planTier || null,
        subscriptionId,
        resourceGroupName,
        enableLogging: advancedSettings?.enableLogging ?? false,
        autoDeleteDays: advancedSettings?.autoDeleteDays ?? null,
        tags: advancedSettings?.tags ?? [],
        ...(isDatabase && databaseConfig ? {
          databaseEngine: databaseConfig.engine,
          databaseServerName: databaseConfig.serverName,
          databaseName: databaseConfig.databaseName,
        } : {}),
        userId,
        tenantId: tenantId,
        provisioningStartedAt: new Date(),
      });

      // Start Azure provisioning in background using user's credentials
      setImmediate(async () => {
        try {
          console.log(`[Provisioning] Starting Azure provisioning for ${instanceName} in ${subscriptionId}`);
          console.log(`[Provisioning] Resource Group: ${resourceGroupName}, Region: ${region}`);

          try {
            const userAzureService = createUserAzureService(armToken, tenantId);
            console.log(`[Provisioning] Created Azure service for tenant ${tenantId}`);

            const result = await userAzureService.createUserInstance(
              subscriptionId,
              resourceGroupName,
              payload,
              instanceId
            );

            console.log(`[Provisioning] Azure provisioning result for ${instanceName}:`, {
              success: result.success,
              url: (result as any).url,
              errorMessage: result.errorMessage
            });

            // Run migration script after successful database provisioning
            let migrationFailed = false;
            let migrationErrorMessage: string | undefined;

            if (result.success && isDatabase && databaseConfig?.engine === 'MySQL Flexible') {
              try {
                console.log(`[Provisioning] Running migration script on database: ${databaseConfig.databaseName}`);
                const scriptPath = await resolveProvisioningSqlScriptPath();
                console.log(`[Provisioning] Using migration script: ${path.relative(process.cwd(), scriptPath)}`);
                const sqlScript = await fs.readFile(scriptPath, 'utf8');

                const conn = await mysql2.createConnection({
                  host: `${databaseConfig.serverName}.mysql.database.azure.com`,
                  port: parseInt(process.env.MYSQL_PORT || '3306'),
                  user: process.env.MYSQL_USER,
                  password: process.env.MYSQL_PASSWORD,
                  database: databaseConfig.databaseName,
                  ssl: { rejectUnauthorized: false },
                  multipleStatements: true,
                });
                await conn.query(sqlScript);
                await conn.end();
                console.log(`[Provisioning] Migration script completed for ${databaseConfig.databaseName}`);
              } catch (migErr: any) {
                console.error(`[Provisioning] Migration script failed:`, migErr);
                migrationFailed = true;
                migrationErrorMessage = `Database provisioned but migration failed: ${migErr.message}`;
              }
            }

            const finalSuccess = result.success && !migrationFailed;

            // Update database with results
            await db
              .update(provisioningInstances)
              .set({
                status: finalSuccess ? "ready" : "failed",
                url: (result as any).url,
                resourceGroupName: result.resourceGroupName,
                appServiceName: (result as any).appServiceName,
                appServicePlanName: (result as any).appServicePlanName,
                ...((result as any).databaseServerName ? { databaseServerName: (result as any).databaseServerName } : {}),
                ...((result as any).databaseName ? { databaseName: (result as any).databaseName } : {}),
                errorMessage: migrationErrorMessage || result.errorMessage,
                provisioningCompletedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(provisioningInstances.id, instanceId));

            console.log(`[Provisioning] Instance ${instanceId} ${finalSuccess ? 'completed successfully' : 'FAILED'} in subscription ${subscriptionId}`);

            if (!result.success) {
              console.error(`[Provisioning] FAILURE for ${instanceName}:`, result.errorMessage);
            }
          } catch (serviceError: any) {
            console.error(`[Provisioning] Azure service creation failed for ${instanceName}:`, serviceError);
            throw new Error(`Azure service initialization failed: ${serviceError.message}`);
          }
        } catch (error: any) {
          console.error(`[Provisioning] CRITICAL ERROR provisioning ${instanceName}:`, error);

          await db
            .update(provisioningInstances)
            .set({
              status: "failed",
              errorMessage: `Provisioning failed: ${error.message}. Check Azure CLI authentication and permissions.`,
              provisioningCompletedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(provisioningInstances.id, instanceId));
        }
      });

      const response: ProvisionInstanceResponse = {
        id: instanceId,
        instanceName,
        status: "provisioning",
        environment,
        region,
        serviceType,
        runtime: runtime || undefined,
        planTier: planTier || undefined,
        ...(isDatabase && databaseConfig ? {
          databaseEngine: databaseConfig.engine,
          databaseServerName: databaseConfig.serverName,
          databaseName: databaseConfig.databaseName,
        } : {}),
        createdAt: new Date().toISOString(),
      };

      console.log("[Provisioning] Instance creation requested:", {
        instanceId,
        instanceName,
        environment,
        region,
        runtime,
        planTier,
        userId,
      });

      return res.status(201).json(response);
    } catch (error: any) {
      console.error("[Provisioning] Error creating instance:", error);
      return res.status(500).json({ error: "Failed to create instance", message: error.message });
    }
  });

  // Debug endpoint: Get database state for troubleshooting
  app.get("/api/instances/debug", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      const instances = await db
        .select()
        .from(provisioningInstances)
        .where(eq(provisioningInstances.userId, userId))
        .orderBy(desc(provisioningInstances.createdAt));

      return res.json({
        total: instances.length,
        instances: instances.map(instance => ({
          id: instance.id,
          instanceName: instance.instanceName,
          status: instance.status,
          appServiceName: instance.appServiceName,
          resourceGroupName: instance.resourceGroupName,
          errorMessage: instance.errorMessage,
          createdAt: instance.createdAt,
          updatedAt: instance.updatedAt
        }))
      });
    } catch (error: any) {
      console.error("[Debug] Error fetching instances:", error);
      return res.status(500).json({ error: "Failed to fetch instances", message: error.message });
    }
  });

  // Cleanup endpoint: Remove orphaned database records
  app.post("/api/instances/cleanup", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      const failedInstances = await db
        .select()
        .from(provisioningInstances)
        .where(
          and(
            eq(provisioningInstances.userId, userId),
            eq(provisioningInstances.status, "failed")
          )
        );

      let cleanedCount = 0;

      for (const instance of failedInstances) {
        if (instance.appServiceName && instance.subscriptionId && instance.resourceGroupName) {
          try {
            const azureConfig = {
              subscriptionId: instance.subscriptionId,
              tenantId: instance.tenantId || "",
              resourceGroupName: instance.resourceGroupName,
              location: instance.region
            };

            const provisioningService = new AzureProvisioningService(azureConfig);
            const azureStatus = await provisioningService.getInstanceStatus(instance.appServiceName);

            if (azureStatus === 'not-found') {
              await db
                .update(provisioningInstances)
                .set({ status: "deleted", updatedAt: new Date() })
                .where(eq(provisioningInstances.id, instance.id));

              cleanedCount++;
              console.log(`[Cleanup] Cleaned orphaned record: ${instance.instanceName}`);
            }
          } catch (error) {
            console.warn(`[Cleanup] Could not verify ${instance.instanceName}:`, error);
          }
        }
      }

      return res.json({ message: `Cleaned up ${cleanedCount} orphaned database records`, cleanedCount });
    } catch (error: any) {
      console.error("[Cleanup] Error during cleanup:", error);
      return res.status(500).json({ error: "Failed to cleanup instances", message: error.message });
    }
  });

  // Get list of instances for current user
  app.get("/api/instances", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      const instances = await db
        .select()
        .from(provisioningInstances)
        .where(
          and(
            eq(provisioningInstances.userId, userId),
            ne(provisioningInstances.status, "deleted")
          )
        )
        .orderBy(desc(provisioningInstances.createdAt));

      const instancesResponse: ProvisionInstanceResponse[] = instances.map(instance => ({
        id: instance.id,
        instanceName: instance.instanceName,
        status: instance.status,
        environment: instance.environment as any,
        region: instance.region as any,
        serviceType: (instance.serviceType || "Web App") as any,
        runtime: instance.runtime as any,
        planTier: instance.planTier as any,
        url: instance.url || undefined,
        createdAt: instance.createdAt.toISOString(),
        errorMessage: instance.errorMessage || undefined,
        subscriptionId: instance.subscriptionId || undefined,
        resourceGroupName: instance.resourceGroupName || undefined,
        appServiceName: instance.appServiceName || undefined,
        appServicePlanName: instance.appServicePlanName || undefined,
      }));

      const response: ListInstancesResponse = {
        instances: instancesResponse,
        total: instancesResponse.length,
      };

      return res.json(response);
    } catch (error: any) {
      console.error("[Provisioning] Error listing instances:", error);
      return res.status(500).json({ error: "Failed to list instances", message: error.message });
    }
  });

  // Get specific instance details
  app.get("/api/instances/:id", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const instanceId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      const instance = await db
        .select()
        .from(provisioningInstances)
        .where(
          and(
            eq(provisioningInstances.id, instanceId),
            eq(provisioningInstances.userId, userId)
          )
        )
        .limit(1);

      if (instance.length === 0) {
        return res.status(404).json({
          error: "Instance not found",
          message: "Instance not found or you don't have access to it"
        });
      }

      const instanceData = instance[0];
      const response: ProvisionInstanceResponse = {
        id: instanceData.id,
        instanceName: instanceData.instanceName,
        status: instanceData.status,
        environment: instanceData.environment as any,
        region: instanceData.region as any,
        serviceType: (instanceData.serviceType || "Web App") as any,
        runtime: instanceData.runtime as any,
        planTier: instanceData.planTier as any,
        url: instanceData.url || undefined,
        createdAt: instanceData.createdAt.toISOString(),
        errorMessage: instanceData.errorMessage || undefined,
        resourceGroupName: instanceData.resourceGroupName || undefined,
        appServiceName: instanceData.appServiceName || undefined,
        appServicePlanName: instanceData.appServicePlanName || undefined,
      };

      return res.json(response);
    } catch (error: any) {
      console.error("[Provisioning] Error getting instance:", error);
      return res.status(500).json({ error: "Failed to get instance", message: error.message });
    }
  });

  // Delete an instance
  app.delete("/api/instances/:id", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const tenantId = req.headers["x-tenant-id"] as string || "";
    const armToken = req.headers["x-azure-token"] as string || "";
    const instanceId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      const instance = await db
        .select()
        .from(provisioningInstances)
        .where(
          and(
            eq(provisioningInstances.id, instanceId),
            eq(provisioningInstances.userId, userId),
            ne(provisioningInstances.status, "deleted")
          )
        )
        .limit(1);

      if (instance.length === 0) {
        return res.status(404).json({
          error: "Instance not found",
          message: "Instance not found or you don't have access to it"
        });
      }

      const instanceData = instance[0];

      await db
        .update(provisioningInstances)
        .set({ status: "deleting", updatedAt: new Date() })
        .where(eq(provisioningInstances.id, instanceId));

      // Start Azure deletion in background
      setImmediate(async () => {
        try {
          const userAzureService = createUserAzureService(armToken, tenantId);
          const deleted = await userAzureService.deleteUserInstance({
            serviceType: instanceData.serviceType,
            subscriptionId: instanceData.subscriptionId!,
            resourceGroupName: instanceData.resourceGroupName!,
            appServiceName: instanceData.appServiceName,
            appServicePlanName: instanceData.appServicePlanName,
            databaseEngine: instanceData.databaseEngine,
            databaseServerName: instanceData.databaseServerName,
            databaseName: instanceData.databaseName,
          });

          await db
            .update(provisioningInstances)
            .set({
              status: deleted ? "deleted" : "failed",
              errorMessage: deleted ? null : "Failed to delete Azure resources",
              updatedAt: new Date(),
            })
            .where(eq(provisioningInstances.id, instanceId));

          console.log(`[Provisioning] Instance ${instanceId} deletion ${deleted ? 'completed' : 'failed'}`);
        } catch (error: any) {
          console.error(`[Provisioning] Error deleting instance ${instanceId}:`, error);

          await db
            .update(provisioningInstances)
            .set({
              status: "failed",
              errorMessage: `Deletion failed: ${error.message}`,
              updatedAt: new Date(),
            })
            .where(eq(provisioningInstances.id, instanceId));
        }
      });

      return res.json({ message: "Instance deletion started", instanceId });
    } catch (error: any) {
      console.error("[Provisioning] Error deleting instance:", error);
      return res.status(500).json({ error: "Failed to delete instance", message: error.message });
    }
  });

  // Configuration check endpoint (for troubleshooting)
  app.get("/api/azure-config-check", requireAuth, async (req: Request, res: Response) => {
    try {
      const config = {
        hasSubscriptionId: !!process.env.AZURE_SUBSCRIPTION_ID,
        hasTenantId: !!process.env.AZURE_TENANT_ID,
        hasClientId: !!process.env.AZURE_CLIENT_ID || false,
        hasClientSecret: !!process.env.AZURE_CLIENT_SECRET || false,
        resourceGroup: process.env.AZURE_RESOURCE_GROUP || "devx-instances",
        defaultLocation: process.env.AZURE_DEFAULT_LOCATION || "East US",
        authMethod: "Azure CLI",
        configurationComplete: !!(
          process.env.AZURE_SUBSCRIPTION_ID &&
          process.env.AZURE_TENANT_ID
        )
      };

      let azureServiceStatus = "not-configured";
      if (config.configurationComplete) {
        try {
          createAzureProvisioningService();
          azureServiceStatus = "configured";
        } catch (error: any) {
          azureServiceStatus = `error: ${error.message}`;
        }
      }

      return res.json({ ...config, azureServiceStatus, timestamp: new Date().toISOString() });
    } catch (error: any) {
      console.error("[Config Check] Error checking Azure configuration:", error);
      return res.status(500).json({ error: "Failed to check configuration", message: error.message });
    }
  });

}
