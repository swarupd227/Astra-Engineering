import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { hasAtLeastOneUpgrade } from "../stack-modernization/utils/version-selection-validation";
import { computeProgressFromSelectedPhases } from "../stack-modernization/utils/progress-from-phases";
import { stackModConfig } from "../stack-modernization/config";
import { persistAnalysis } from "../stack-modernization/services/db-persistence";
import { resolveAdoPat } from "../stack-modernization/services/resolve-ado-pat";
import * as fs from "fs/promises";
import * as path from "path";
import {
  GPT_MODEL_ID,
  CLAUDE_MODEL_ID,
  DEFAULT_MODEL_ID,
  SUPPORTED_LLM_PROVIDERS,
} from "../llm-config-constants";

/**
 * Returns the common path prefix of an array of paths (e.g. "MyGame/" or "").
 * Paths are normalized to use forward slashes.
 */
function getCommonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  const normalized = paths.map(p => p.replace(/\\/g, "/"));
  let prefix = normalized[0];
  for (let i = 1; i < normalized.length; i++) {
    const p = normalized[i];
    while (prefix.length > 0 && !p.startsWith(prefix) && prefix !== "/") {
      prefix = prefix.slice(0, -1);
      const last = prefix.lastIndexOf("/");
      prefix = last >= 0 ? prefix.slice(0, last + 1) : "";
    }
  }
  if (prefix.length > 0 && !prefix.endsWith("/")) {
    const last = prefix.lastIndexOf("/");
    prefix = last >= 0 ? prefix.slice(0, last + 1) : "";
  }
  return prefix;
}

// Tracks last-logged state per analysis to avoid flooding logs on every poll
const progressLogTracker: Record<string, string> = {};

/**
 * Stack Modernization Routes
 * Extracted from routes.ts to keep it clean and maintainable
 */
export function registerStackModernizationRoutes(app: Express) {
  /**
   * GET /api/stack-modernization/llm-providers
   */
  app.get("/api/stack-modernization/llm-providers", async (req: Request, res: Response) => {
    try {
      // No auth required for getting available LLMs - it's just configuration info
      const { getAvailableLLMs } = await import("../stack-modernization/services/llm-selector");
      const providers = getAvailableLLMs();
      
      res.json({
        providers,
        default: providers.find(p => p.available)?.value || DEFAULT_MODEL_ID
      });
    } catch (error) {
      console.error("[Stack Modernization] LLM providers error:", error);
      res.status(500).json({
        error: "Failed to get LLM providers",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * GET /api/stack-modernization/config
   * Public config for client (e.g. validation phase enabled/disabled).
   */
  app.get("/api/stack-modernization/config", (_req: Request, res: Response) => {
    res.json({
      validationEnabled: stackModConfig.validationEnabled,
    });
  });

  /**
   * GET /api/ado-repositories?organization=X&project=Y
   * Fetch repositories from an ADO project for the publish modal.
   */
  app.get("/api/ado-repositories", async (req: Request, res: Response) => {
    try {
      const organization = (req.query.organization as string || "").trim();
      const project = (req.query.project as string || "").trim();
      if (!organization || !project) {
        return res.status(400).json({ error: "organization and project query params are required" });
      }

      const pat = await resolveAdoPat(organization);
      if (!pat) {
        return res.status(500).json({
          error: "No PAT found for this organization. Please configure Azure DevOps in Settings > Client Settings.",
        });
      }

      const { AzureDevOpsService } = await import("../azure-devops-service");
      const adoService = new AzureDevOpsService({ organization, project, pat });
      const repos = await adoService.getRepositories(project);
      res.json({ value: repos });
    } catch (error) {
      console.error("[ado-repositories] Error:", error);
      res.status(500).json({ error: "Failed to fetch repositories", message: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * POST /api/stack-modernization/publish
   * Publish upgraded code to Azure DevOps or GitHub
   */
  app.post("/api/stack-modernization/publish", async (req: Request, res: Response) => {
    try {
      const { analysisId, options } = req.body;
      
      if (!analysisId || !options) {
        return res.status(400).json({ error: "Missing analysisId or options" });
      }
      
      
      // Get state
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      // Block ADO publishing in AWS mode
      const { isAwsHosting } = await import("../platform/hosting");
      if (isAwsHosting() && options.provider === "azure-devops") {
        return res.status(403).json({
          error: "ado_disabled",
          message: "Azure DevOps publishing is not available when DEVX_HOSTING=aws. Use GitHub instead.",
        });
      }

      // Resolve PAT from database for ADO provider
      if (options.provider === "azure-devops" && !options.accessToken) {
        const pat = await resolveAdoPat(options.orgName || "");
        if (!pat) {
          return res.status(400).json({
            error: "No PAT found for this organization. Please configure Azure DevOps in Settings > Client Settings.",
          });
        }
        options.accessToken = pat;
      }

      // Resolve GitHub token from the signed-in user's personal credential.
      if (options.provider === "github" && !options.accessToken) {
        const { getGitClientForUser } = await import("../integrations/git/user-credential-resolver");
        const userId = (req as any).user?.id;
        if (!userId) {
          return res.status(400).json({
            error: "GitHub publishing requires a signed-in user.",
          });
        }
        try {
          const githubClient = await getGitClientForUser(userId, "github");
          options.accessToken = githubClient.token;
        } catch (err) {
          return res.status(428).json({
            error: "GitHub is not configured for your user. Configure and validate your personal GitHub PAT/API key.",
          });
        }
      }
      
      // Publish
      const { publishToRepository } = await import("../stack-modernization/services/repo-publisher");
      const result = await publishToRepository(state, options);
      
      if (!result.success) {
        return res.status(500).json({ 
          error: "Publishing failed", 
          details: result.errors 
        });
      }
      
      
      res.json(result);
      
    } catch (error) {
      console.error("[Publish] ❌ Error:", error);
      res.status(500).json({
        error: "Failed to publish repository",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * POST /api/stack-modernization/enhance-prompt
   * AI Enhance - Converts user prompt to detailed upgrade plan
   */
  app.post("/api/stack-modernization/enhance-prompt", async (req: Request, res: Response) => {
    try {
      const { userPrompt, detectedStack, analysisId } = req.body;
      
      if (!userPrompt || !detectedStack) {
        return res.status(400).json({ error: "Missing required fields: userPrompt, detectedStack" });
      }
      

      // Load state to get version intelligence (live registry data) and repo profile
      let versionIntelligenceContext = "";
      let repoProfileContext = "";
      if (analysisId) {
        try {
          const { stateStore } = await import("../stack-modernization");
          const state = stateStore.get(analysisId);
          if (state?.versionIntelligence?.length) {
            versionIntelligenceContext = "\n\n## Version Intelligence (from LIVE package registry APIs — MANDATORY source of truth)\n" +
              state.versionIntelligence.map((v: any) =>
                `- **${v.package}**: current=${v.currentVersion}, latest_stable=${v.latestStable || "?"}, recommended_target=${v.recommended}${v.latestLTS ? " (LTS)" : ""}, risk=${v.riskLevel}, registry=${v.registry || "?"}`
              ).join("\n") +
              "\n\n⚠️ MANDATORY: The versions above come from live registry APIs (NuGet, npm, Maven Central, PyPI). You MUST use the 'recommended_target' value as the Target version for each package. Do NOT invent your own version numbers. If a package is NOT listed here, write 'latest stable' — NEVER guess.";
          }
          if (state?.repoProfile) {
            const rp = state.repoProfile;
            repoProfileContext = `\n\n## Repository Profile\n- Project Type: ${rp.projectType || "Unknown"}\n- Languages: ${rp.languages?.join(", ") || "Unknown"}\n- Frameworks: ${rp.frameworks?.map((f: any) => `${f.name} ${f.version || ""}`).join(", ") || "None"}\n- Runtime: ${rp.runtimeInfo?.[0]?.language || "?"} ${rp.runtimeInfo?.[0]?.version || ""}`;
          }
        } catch (e) {
          console.warn("[AI Enhance] Could not load state for version intelligence:", e);
        }
      }
      
      const { getLLMClient } = await import("../stack-modernization/services/llm-selector");
      const { safeMaxTokens } = await import("../stack-modernization/services/token-manager");
      const llmProvider = req.body.llmProvider || DEFAULT_MODEL_ID;
      const { client, model } = getLLMClient(llmProvider as any);
      
      const systemPrompt = `You are a Senior Software Architect and Stack Modernization Expert.

Your job: take the user's upgrade requirement and ENHANCE it into a detailed, technically precise upgrade specification. You are NOT replacing the user's text — you are making it richer and more actionable for downstream automation.

## ABSOLUTE RULES (in priority order)

1. **USER'S EXPLICIT VERSIONS ARE SACRED**: If the user says "jQuery 4.0.0", the target MUST be 4.0.0. If the user says ".NET 10", the target MUST be 10.0. NEVER change, downgrade, or substitute a version the user explicitly requested — even if registry data shows a different latest version. The user knows what they want.
2. **CURRENT VERSIONS ARE STRICTLY FROM DATA**: Only write a Current version if the package appears in the Version Intelligence data below with a "current=" value. If a package is NOT listed in Version Intelligence, write \`Current: unknown\`. NEVER guess, infer, or fabricate current versions from your training data.
3. **REGISTRY DATA IS FOR CURRENT VERSIONS ONLY**: Use registry API data ONLY to fill in the "Current" version of each package. NEVER use registry data to override the user's requested Target version.
4. **FOR PACKAGES THE USER DID NOT MENTION**: If you add ecosystem packages (e.g., EF Core when user asked for .NET upgrade), use the "recommended_target" from registry data as the Target. If the package is not in the registry data, write "latest stable" — NEVER fabricate a version number.
5. **NEVER ASSUME VERSIONS MATCH THE RUNTIME**: Package versions are independent of the runtime version. Swashbuckle.AspNetCore 6.x is valid for .NET 10.0. Do NOT assume ecosystem packages should be version 10.x just because the runtime target is 10.0.
6. **ONLY INCLUDE RELEVANT PACKAGES**: Only list packages directly related to what the user asked about. Do NOT add unrelated packages.
7. **PRESERVE AND EXPAND THE USER'S APPROACH**: If the user mentions TDD, testing strategy, migration approach, etc., expand on it. Do NOT drop it.

## VERSION PRIORITY (MUST follow this exact order)

1. If the USER explicitly wrote a target version → use EXACTLY that version
2. If the user did NOT specify a version for a package → use "recommended_target" from Version Intelligence data
3. If the package is NOT in Version Intelligence data → write "latest stable"
4. NEVER fabricate, guess, or invent any specific version number

## OUTPUT FORMAT

Start with a brief 1-2 sentence summary, then list each package:

## [Package Name]
Current: [ONLY from Version Intelligence data "current=" value, or "unknown" if not listed]
Target: [the user's requested version, or registry recommended if user didn't specify]
Risk: [low/medium/high] - [specific reason]
Reason: [why this upgrade is needed]

After the package list, add methodology/approach if the user mentioned one.`;

      const userPromptForLLM = `## User's Upgrade Requirement (THIS IS THE PRIMARY INPUT — use their exact versions)

"${userPrompt}"

## Analysis Context
${detectedStack.analysis || "General stack modernization"}
${versionIntelligenceContext}
${repoProfileContext}

## Your Task

Enhance the user's requirement into a detailed upgrade specification. CRITICAL RULES:

1. **TARGET VERSIONS**: For every package the user mentioned with a specific version, use EXACTLY that version as the Target. Do NOT substitute with registry data. Examples from the user's text above — if they wrote "jQuery 4.0.0", Target must be 4.0.0. If they wrote ".NET 10", Target must be 10.0. NEVER downgrade or change these.
2. **CURRENT VERSIONS**: Use ONLY the "current=" values from Version Intelligence above. If a package is NOT in Version Intelligence, write "unknown". NEVER guess current versions.
3. **ECOSYSTEM PACKAGES**: For packages the user did NOT mention, use the "recommended_target" from Version Intelligence data. If not in the data, write "latest stable".
4. **NEVER FABRICATE VERSIONS**: Do not invent version numbers. Package versions are independent of runtime versions.
5. **EXPAND**: Add risk assessment, reasons, and expand on any methodology the user mentioned.`;

      // Build a map of known current versions from trusted sources (for PASS 3 post-processing)
      const knownCurrentVersions = new Map<string, string>();
      if (analysisId) {
        try {
          const { stateStore: store } = await import("../stack-modernization");
          const st = store.get(analysisId);
          for (const vi of st?.versionIntelligence || []) {
            if (vi.package && vi.currentVersion) {
              knownCurrentVersions.set(vi.package.toLowerCase(), vi.currentVersion);
            }
          }
        } catch (_) { /* already warned above */ }
      }
      // Also parse "## PkgName\nCurrent: X.Y.Z" from the original user text as fallback
      const sectionRe = /##\s+(.+?)\n\s*Current:\s*(\S+)/gi;
      let sMatch;
      while ((sMatch = sectionRe.exec(userPrompt)) !== null) {
        const name = sMatch[1].trim().toLowerCase();
        const ver = sMatch[2].trim();
        if (ver !== "unknown" && !knownCurrentVersions.has(name)) {
          knownCurrentVersions.set(name, ver);
        }
      }

      const { normalizeRequestParams } = await import("../stack-modernization/services/token-manager");
      const response = await client.chat.completions.create(normalizeRequestParams({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPromptForLLM }
        ],
        temperature: 0,
        max_tokens: safeMaxTokens(3000, model)
      }) as any);
      
      let enhancedPlan = response.choices[0]?.message?.content || "Could not generate enhanced plan";
      
      // Extract versions the user explicitly requested (these are sacred — never override)
      const userVersions = new Map<string, string>();
      const versionPatterns = [
        /(\S+(?:\.\S+)?)\s+(\d+\.\d+(?:\.\d+)?)/gi,        // "jQuery 4.0.0"
        /(\S+(?:\.\S+)?)\s+[><=]*(\d+\.\d+(?:\.\d+)?)/gi,   // "Font Awesome >6.5.1"
        /(\S+(?:\.\S+)?)\s+(?:to\s+)?v?(\d+\.\d+(?:\.\d+)?)/gi,  // "Bootstrap to 5.3.2"
      ];
      for (const pattern of versionPatterns) {
        let m;
        while ((m = pattern.exec(userPrompt)) !== null) {
          const name = m[1].toLowerCase().replace(/[,;:]/g, '').trim();
          if (name.length > 1 && !['to', 'of', 'at', 'in', 'is', 'as', 'or', 'an', 'be'].includes(name)) {
            userVersions.set(name, m[2]);
          }
        }
      }
      // Also parse ".net 10" or "dotnet 10" style
      const dotnetMatch = userPrompt.match(/(?:\.net|dotnet)\s+(\d+(?:\.\d+)?)/i);
      if (dotnetMatch) userVersions.set('.net', dotnetMatch[1].includes('.') ? dotnetMatch[1] : dotnetMatch[1] + '.0');
      
      if (userVersions.size > 0) {
      }
      
      // PASS 1: Enforce user-specified versions on ALL matching sections (runs always, even without analysisId)
      if (userVersions.size > 0) {
        for (const [userPkg, userVer] of userVersions) {
          // Find any "## ... <packageName> ... Target: X.Y.Z" pattern in the enhanced plan
          const escapedPkg = userPkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const pkgPattern = new RegExp(
            `(##\\s*(?:.*?)${escapedPkg}[\\s\\S]*?Target:\\s*)([\\d]+\\.[\\d]+(?:\\.[\\d]+)?(?:-[\\w.]+)?)`,
            'i'
          );
          const match = enhancedPlan.match(pkgPattern);
          if (match && match[2] !== userVer) {
            enhancedPlan = enhancedPlan.replace(match[0], match[1] + userVer);
          }
        }
      }
      
      // PASS 2: For packages in version intelligence (when analysisId is available),
      // correct hallucinated versions for packages the user did NOT specify
      if (analysisId) {
        try {
          const { stateStore } = await import("../stack-modernization");
          const state = stateStore.get(analysisId);
          if (state?.versionIntelligence?.length) {
            for (const vi of state.versionIntelligence) {
              const pkgName = vi.package;
              const recommendedVersion = vi.recommended || vi.latestStable;
              const currentVersion = vi.currentVersion;
              if (!recommendedVersion || !pkgName) continue;

              // Skip if user explicitly requested a version for this package (already enforced in PASS 1)
              const pkgLower = pkgName.toLowerCase();
              const userRequestedVersion = userVersions.get(pkgLower) 
                || [...userVersions.entries()].find(([k]) => pkgLower.includes(k) || k.includes(pkgLower))?.[1];
              if (userRequestedVersion) continue;

              const pkgPattern = new RegExp(
                `(##\\s*(?:.*?)${pkgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?Target:\\s*)([\\d]+\\.[\\d]+(?:\\.[\\d]+)?(?:-[\\w.]+)?)`,
                'i'
              );
              const match = enhancedPlan.match(pkgPattern);
              if (match) {
                const llmVersion = match[2];
                if (llmVersion !== recommendedVersion && llmVersion !== currentVersion) {
                  enhancedPlan = enhancedPlan.replace(match[0], match[1] + recommendedVersion);
                }
              }
            }
          }
        } catch (e) {
          console.warn("[AI Enhance] Post-processing version correction failed:", e);
        }
      }
      
      // PASS 3: Enforce correct Current versions — prevent hallucinated current versions
      {
        const currentPattern = /##\s+(.+?)\n([\s\S]*?)Current:\s*(\S+)/gi;
        let cMatch;
        const currentReplacements: Array<{ original: string; corrected: string }> = [];
        while ((cMatch = currentPattern.exec(enhancedPlan)) !== null) {
          const pkgName = cMatch[1].trim();
          const llmCurrent = cMatch[3];
          const knownCurrent = knownCurrentVersions.get(pkgName.toLowerCase())
            || [...knownCurrentVersions.entries()].find(([k]) =>
              pkgName.toLowerCase().includes(k) || k.includes(pkgName.toLowerCase())
            )?.[1];

          const correctCurrent = knownCurrent || "unknown";
          if (llmCurrent !== correctCurrent) {
            currentReplacements.push({
              original: cMatch[0],
              corrected: cMatch[0].replace(`Current: ${llmCurrent}`, `Current: ${correctCurrent}`)
            });
          }
        }
        for (const r of currentReplacements) {
          enhancedPlan = enhancedPlan.replace(r.original, r.corrected);
        }
      }
      
      res.json({
        success: true,
        enhancedPlan,
        source: "llm"
      });
      
    } catch (error) {
      console.error("[AI Enhance] ❌ Error:", error);
      res.status(500).json({
        error: "Failed to enhance prompt",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  /**
   * Upload files for stack modernization analysis
   * POST /api/stack-modernization/upload
   *
   * Returns immediately after saving the file to disk.
   * ZIP extraction and file reading happen in the background so the HTTP
   * request completes well within Azure App Service's gateway timeout.
   * The client polls GET /progress (status "extracting" → "uploaded").
   */
  app.post("/api/stack-modernization/upload", async (req: Request, res: Response) => {
    let tempDir: string | null = null;
    let sessionId: string | null = null;
    
    try {
      const skipAuth = stackModConfig.skipAuth;
      
      let userIdentity: any;
      
      if (skipAuth) {
        userIdentity = {
          userId: "dev-user-001",
          userName: "dev-user",
          userEmail: "dev@example.com",
          tenantId: null
        };
      } else {
        const user = (req as any).user;
        
        if (!user?.id) {
          return res.status(401).json({
            error: "Authentication required. Please log in.",
            code: "UNAUTHENTICATED"
          });
        }
        
        userIdentity = {
          userId: user.id,
          userName: user.email || user.userName || "unknown",
          userEmail: user.email || "unknown@example.com",
          tenantId: user.tenantId || null
        };
      }
      
      // Parse form data
      const fields: Record<string, any> = {};
      const files: any[] = [];
      
      // @ts-ignore - formidable has no declaration file
      const formidable = (await import("formidable")).default;
      const form = formidable({ 
        multiples: true,
        maxFileSize: 500 * 1024 * 1024,
      });
      
      await new Promise((resolve, reject) => {
        form.parse(req, (err: any, parsedFields: any, parsedFiles: any) => {
          if (err) reject(err);
          Object.assign(fields, parsedFields);
          Object.values(parsedFiles).flat().forEach((file: any) => {
            files.push(file);
          });
          resolve(null);
        });
      });
      
      const modernizationType = fields.modernizationType?.[0];
      const llmProvider = fields.llmProvider?.[0] || DEFAULT_MODEL_ID;
      
      if (!modernizationType || !["upgrade", "modernization", "replatform"].includes(modernizationType)) {
        return res.status(400).json({
          error: "Invalid or missing modernizationType. Must be: upgrade, modernization, or replatform"
        });
      }
      
      if (!SUPPORTED_LLM_PROVIDERS.includes(llmProvider)) {
        return res.status(400).json({
          error: `Invalid LLM provider. Must be one of: ${SUPPORTED_LLM_PROVIDERS.join(", ")}`
        });
      }
      
      if (files.length === 0) {
        return res.status(400).json({
          error: "No files uploaded. Please upload at least one file."
        });
      }
      
      const { 
        createTempDirectory, 
        getUploadDir, 
        getExtractedDir, 
        scheduleCleanup 
      } = await import("../stack-modernization/services/temp-storage");
      const fsP = await import("fs/promises");
      const pathM = await import("path");
      
      sessionId = (await import("crypto")).randomUUID();
      tempDir = await createTempDirectory(sessionId);
      const uploadDir = getUploadDir(tempDir);
      
      // Save uploaded files to disk (fast — just file copies)
      const savedFiles: Array<{ originalName: string; destPath: string }> = [];
      for (const file of files) {
        const originalName = file.originalFilename || file.name || 'unknown';
        const destPath = pathM.join(uploadDir, originalName);
        await fsP.copyFile(file.filepath, destPath);
        savedFiles.push({ originalName, destPath });
      }

      const firstFile = files[0];
      const originalName: string = firstFile?.originalFilename || firstFile?.name || "unknown";
      const repoName = originalName.replace(/\.[^/.]+$/, "");
      
      // Initialize state immediately with "extracting" status
      const { initializeState } = await import("../stack-modernization/state");
      const state = initializeState(
        modernizationType, 
        llmProvider, 
        userIdentity.userId, 
        userIdentity.tenantId || 'default',
        tempDir
      );
      state.sessionId = sessionId;
      state.repoName = repoName;
      state.currentStage = "extracting";
      state.status = "extracting";
      
      const { stateStore } = await import("../stack-modernization");
      stateStore.save(state);
      scheduleCleanup(sessionId, 2);
      
      // Return immediately — client will poll /progress for extraction status
      res.json({
        sessionId,
        analysisId: state.analysisId,
        repoName,
        uploadedFiles: files.map(f => ({
          name: f.originalFilename || f.name,
          size: f.size
        })),
        extractedFiles: 0,
        tempDir,
        status: "extracting"
      });

      // ── Background: extract ZIP + read files into state ──
      (async () => {
        try {
          const { extractZipFile, readExtractedDirToFileList } = await import("../stack-modernization/services/temp-storage");
          const extractDir = getExtractedDir(tempDir!);

          for (const { originalName: name, destPath } of savedFiles) {
            if (name.toLowerCase().endsWith('.zip')) {
              const t0 = Date.now();
              const { success, filesExtracted, errors } = await extractZipFile(destPath, extractDir);
              console.log(`[Upload:bg] ZIP extraction: ${filesExtracted} files in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
              if (!success) {
                state.status = "failed";
                state.currentStage = "extraction_failed";
                state.errors.push(`ZIP extraction failed: ${errors.join("; ")}`);
                stateStore.save(state);
                return;
              }
            } else {
              const extractedPath = pathM.join(extractDir, name);
              await fsP.copyFile(destPath, extractedPath);
            }
          }

          state.currentStage = "Reading extracted files...";
          stateStore.save(state);

          const t0Read = Date.now();
          const extractedFilesList = await readExtractedDirToFileList(extractDir);
          console.log(`[Upload:bg] File read completed in ${((Date.now() - t0Read) / 1000).toFixed(1)}s — ${extractedFilesList.length} files`);

          state.extractedFiles = extractedFilesList;
          state.currentStage = "uploaded";
          state.status = "uploaded";
          stateStore.save(state);
        } catch (err) {
          console.error("[Upload:bg] Background extraction failed:", err);
          state.status = "failed";
          state.currentStage = "extraction_failed";
          state.errors.push(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`);
          stateStore.save(state);
        }
      })();
      
    } catch (error) {
      console.error("[Stack Modernization] Upload error:", error);
      
      if (sessionId) {
        try {
          const { cleanupBySessionId } = await import("../stack-modernization/services/temp-storage");
          await cleanupBySessionId(sessionId);
        } catch (cleanupError) {
          console.error(`[Upload] Failed to cleanup after error:`, cleanupError);
        }
      }
      
      res.status(500).json({
        error: "Failed to upload files",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * Clone Git repository and prepare for analysis (same state shape as ZIP upload)
   * POST /api/stack-modernization/upload-from-git
   */
  app.post("/api/stack-modernization/upload-from-git", async (req: Request, res: Response) => {
    let sessionId: string | null = null;
    let tempDir: string | null = null;

    try {
      const skipAuth = stackModConfig.skipAuth;
      let userIdentity: any;
      if (skipAuth) {
        userIdentity = { userId: "dev-user-001", userName: "dev-user", userEmail: "dev@example.com", tenantId: null };
      } else {
        const user = (req as any).user;
        if (!user?.id) {
          return res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
        }
        userIdentity = { userId: user.id, userName: user.email || user.userName || "unknown", userEmail: user.email || "unknown@example.com", tenantId: user.tenantId || null };
      }

      const { repoUrl: rawRepoUrl, branch = "main", gitToken, modernizationType = "upgrade", llmProvider = DEFAULT_MODEL_ID } = req.body || {};

      const repoUrl = typeof rawRepoUrl === "string" ? rawRepoUrl.trim() : "";
      if (!repoUrl) {
        return res.status(400).json({ error: "Missing or invalid repoUrl." });
      }
      // Allow only https; reject file://, git@, and dangerous chars
      if (!repoUrl.startsWith("https://") || /[\s;'"\\]|--/.test(repoUrl)) {
        return res.status(400).json({ error: "Invalid repo URL. Use an HTTPS URL only (e.g. https://github.com/owner/repo)." });
      }
      let parsed: URL;
      try {
        parsed = new URL(repoUrl);
      } catch {
        return res.status(400).json({ error: "Invalid repo URL format." });
      }
      if (parsed.protocol !== "https:") {
        return res.status(400).json({ error: "Only HTTPS repository URLs are allowed." });
      }

      if (!SUPPORTED_LLM_PROVIDERS.includes(llmProvider)) {
        return res.status(400).json({ error: `Invalid LLM provider. Must be one of: ${SUPPORTED_LLM_PROVIDERS.join(", ")}` });
      }
      if (!["upgrade", "modernization", "replatform"].includes(modernizationType)) {
        return res.status(400).json({ error: "Invalid modernizationType." });
      }

      const { createTempDirectory, getExtractedDir, scheduleCleanup } = await import("../stack-modernization/services/temp-storage");

      sessionId = (await import("crypto")).randomUUID();
      tempDir = await createTempDirectory(sessionId);
      const extractDir = getExtractedDir(tempDir);

      // Resolve authentication token
      let effectiveToken: string | undefined = typeof gitToken === "string" && gitToken.trim() ? gitToken.trim() : undefined;

      if (!effectiveToken && parsed.hostname === "dev.azure.com") {
        const { isAwsHosting: _isAwsUpload } = await import("../platform/hosting");
        if (_isAwsUpload()) {
          return res.status(403).json({ error: "ado_disabled", message: "Azure DevOps Git URLs are not supported when DEVX_HOSTING=aws." });
        }
        const pathParts = parsed.pathname.replace(/^\//, "").split("/");
        const adoOrgName = pathParts[0] || parsed.username || "";
        if (adoOrgName) {
          const dbPat = await resolveAdoPat(adoOrgName);
          if (dbPat) {
            effectiveToken = dbPat;
          } else {
            console.warn(`[UploadFromGit] No PAT found for ADO org: ${adoOrgName}. Clone may fail for private repos.`);
          }
        }
      }

      let cloneUrl = repoUrl;
      if (effectiveToken) {
        try {
          const u = new URL(repoUrl);
          u.password = effectiveToken;
          if (!u.username) u.username = "oauth2";
          cloneUrl = u.toString();
        } catch {
          return res.status(400).json({ error: "Could not apply token to URL." });
        }
      }

      const urlPath = parsed.pathname.replace(/\/$/, "");
      const gitRepoName = urlPath.split("/").pop()?.replace(/\.git$/, "") || "repository";

      // Initialize state with "extracting" and return immediately
      const { initializeState } = await import("../stack-modernization/state");
      const state = initializeState(modernizationType, llmProvider, userIdentity.userId, userIdentity.tenantId || "default", tempDir);
      state.sessionId = sessionId;
      state.repoName = gitRepoName;
      state.currentStage = "extracting";
      state.status = "extracting";

      const { stateStore } = await import("../stack-modernization");
      stateStore.save(state);
      scheduleCleanup(sessionId, 2);

      res.json({
        sessionId,
        analysisId: state.analysisId,
        uploadedFiles: [],
        extractedFiles: 0,
        tempDir,
        status: "extracting",
      });

      // ── Background: clone + read files ──
      const branchArg = branch && String(branch).trim() ? String(branch).trim() : "main";
      const capturedCloneUrl = cloneUrl;
      (async () => {
        try {
          const { exec } = await import("child_process");
          const { promisify } = await import("util");
          const execAsync = promisify(exec);
          const { readExtractedDirToFileList } = await import("../stack-modernization/services/temp-storage");

          state.currentStage = "Cloning repository...";
          stateStore.save(state);

          const safeExtractDir = extractDir.replace(/\\/g, "/");
          const cloneCmd = `git clone --depth 1 --branch "${branchArg.replace(/"/g, '\\"')}" "${capturedCloneUrl.replace(/"/g, '\\"')}" "${safeExtractDir}"`;
          await execAsync(cloneCmd, { timeout: 1_200_000, maxBuffer: 500 * 1024 * 1024 });

          state.currentStage = "Reading extracted files...";
          stateStore.save(state);

          const t0Read = Date.now();
          const extractedFilesList = await readExtractedDirToFileList(extractDir);
          console.log(`[UploadFromGit:bg] File read completed in ${((Date.now() - t0Read) / 1000).toFixed(1)}s — ${extractedFilesList.length} files`);

          state.extractedFiles = extractedFilesList;
          state.currentStage = "uploaded";
          state.status = "uploaded";
          stateStore.save(state);
        } catch (err: any) {
          const rawMsg = err?.message || String(err);
          const safeMsg = rawMsg.replace(/https:\/\/[^@]+@/g, "https://***@");
          console.error("[UploadFromGit:bg] Background clone/extract failed:", safeMsg);
          state.status = "failed";
          state.currentStage = "extraction_failed";
          state.errors.push(err?.killed
            ? "Clone timed out. The repository may be too large or the network is slow."
            : `Git clone failed: ${safeMsg}`);
          stateStore.save(state);
        }
      })();
    } catch (err: any) {
      const rawMsg = err?.message || String(err);
      const safeMsg = rawMsg.replace(/https:\/\/[^@]+@/g, "https://***@");
      console.error("[UploadFromGit] Error:", safeMsg);
      if (sessionId) {
        try {
          const { cleanupBySessionId } = await import("../stack-modernization/services/temp-storage");
          await cleanupBySessionId(sessionId);
        } catch (_) {}
      }
      const isCloneFail = safeMsg.includes("fatal:") || safeMsg.includes("clone") || err?.killed;
      const userMsg = err?.killed
        ? "Clone timed out (>20 minutes). The repository may be too large or the network is slow."
        : isCloneFail
          ? "Git clone failed. Verify the URL and branch are correct. For private repos, provide a Personal Access Token on the next page."
          : "Failed to process repository.";
      res.status(500).json({ error: userMsg, message: safeMsg });
    }
  });

  /**
   * Start stack modernization analysis
   * POST /api/stack-modernization/analyze
   */
  app.post("/api/stack-modernization/analyze", async (req: Request, res: Response) => {
    try {
      // Extract user from session
      // Temporary auth bypass for development
      const skipAuth = stackModConfig.skipAuth;
      
      let userIdentity: any;
      
      if (skipAuth) {
        userIdentity = {
          userId: "dev-user-001",
          userName: "dev-user",
          userEmail: "dev@example.com",
          tenantId: null
        };
      } else {
        const user = (req as any).user;
        
        if (!user?.id) {
          return res.status(401).json({
            error: "Authentication required. Please log in.",
            code: "UNAUTHENTICATED"
          });
        }
        
        userIdentity = {
          userId: user.id,
          userName: user.email || user.userName || "unknown",
          userEmail: user.email || "unknown@example.com",
          tenantId: user.tenantId || null
        };
      }
      
      const { sessionId, modernizationType, tempDir } = req.body;
      
      // Validate
      if (!sessionId || !modernizationType || !tempDir) {
        return res.status(400).json({
          error: "Missing required fields: sessionId, modernizationType, tempDir"
        });
      }
      
      
      // Dynamic import
      const { executeAnalysis, stateStore } = await import("../stack-modernization");
      
      // Get LLM provider from request or default
      const llmProvider = req.body.llmProvider || DEFAULT_MODEL_ID;
      const selectedPhases = req.body.selectedPhases as string[] | undefined;
      
      // Try to get state from store first (from upload phase)
      let state = stateStore.getBySessionId(sessionId);

      // If extraction is still running in the background, wait for it
      if (state && (state.status === "extracting" || state.currentStage === "extracting")) {
        console.log(`[Analyze] Extraction still in progress for session ${sessionId}, waiting...`);
        const waitStart = Date.now();
        const MAX_EXTRACT_WAIT_MS = 30 * 60 * 1000; // 30 min
        while (Date.now() - waitStart < MAX_EXTRACT_WAIT_MS) {
          await new Promise(r => setTimeout(r, 2000));
          state = stateStore.getBySessionId(sessionId);
          if (!state || state.status === "failed") {
            return res.status(500).json({ error: state?.errors?.[0] || "Extraction failed" });
          }
          if (state.status === "uploaded" || state.currentStage === "uploaded") break;
        }
        if (state?.status === "extracting") {
          return res.status(500).json({ error: "File extraction is still in progress. Please wait." });
        }
      }
      
      if (!state) {
        console.warn(`[Stack Modernization] State not found in store for session ${sessionId}, reconstructing...`);
        
        // Fallback: Load files from temp directory
        const { getExtractedDir } = await import("../stack-modernization/services/temp-storage");
        const { readdir, readFile } = await import("fs/promises");
        const path = await import("path");
        
        const extractDir = getExtractedDir(tempDir);
        let extractedFilesList: any[] = [];
        
        async function readDirRecursive(dir: string, prefix = ''): Promise<void> {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (!['node_modules', '.git', '__pycache__', 'venv', 'dist', 'build'].includes(entry.name)) {
                await readDirRecursive(fullPath, relPath);
              }
            } else if (entry.isFile()) {
              try {
                const content = await readFile(fullPath, 'utf-8');
                extractedFilesList.push({
                  relativePath: relPath,
                  fullPath: fullPath,
                  content: content,
                  size: Buffer.byteLength(content, 'utf8'),
                  extension: path.extname(entry.name).toLowerCase(),
                  fileType: "unknown"
                });
              } catch (readError) {
                console.error(`[Stack Modernization] Error reading ${relPath}:`, readError);
              }
            }
          }
        }
        
        try {
          await readDirRecursive(extractDir);
        } catch (error) {
          console.error(`[Stack Modernization] Error reading extracted files:`, error);
        }
        
        // Reconstruct state
        const { initializeState } = await import("../stack-modernization/state");
        state = initializeState(modernizationType, llmProvider, userIdentity.userId, userIdentity.tenantId, tempDir);
        state.sessionId = sessionId;
        state.extractedFiles = extractedFilesList;
      } else {
        // Update LLM provider if different from what was stored
        state.llmProvider = llmProvider;
      }
      if (selectedPhases && Array.isArray(selectedPhases) && selectedPhases.length > 0) {
        state.selectedPhases = selectedPhases as any;
      }

      // ADO project context for persistence scoping
      state.adoOrg = (req.body as any).adoOrg;
      state.adoProjectId = (req.body as any).adoProjectId;
      state.adoProjectName = (req.body as any).adoProjectName;

      // Save initial state
      stateStore.save(state);

      persistAnalysis({
        id: state.analysisId,
        sessionId: state.sessionId,
        userId: state.userId,
        tenantId: state.tenantId,
        adoOrg: (req.body as any).adoOrg,
        adoProjectId: (req.body as any).adoProjectId,
        adoProjectName: (req.body as any).adoProjectName,
        repoName: state.repoName,
        status: "in_progress",
        currentStage: state.currentStage,
        progress: computeProgressFromSelectedPhases(state),
        selectedPhases: state.selectedPhases,
      }).catch(() => {});

      // Execute INITIAL analysis pipeline (run in background) - STOPS at user selection
      executeAnalysis(state).then(finalState => {
        if (finalState.status === 'awaiting_user_selection') {
        } else {
        }
      }).catch(async (error) => {
        console.error(`[Stack Modernization] ❌ Analysis failed for session ${sessionId}:`, error);
        // Save failed state so frontend can show errors and stop polling
        const { failState } = await import("../stack-modernization/state");
        const failedState = failState(state, error instanceof Error ? error.message : String(error));
        stateStore.save(failedState);
      });
      
      // Return immediately
      res.json({
        analysisId: state.analysisId,
        status: "initiated",
        estimatedDuration: 60, // seconds
        agentsDeployed: ["RepoProfilerAgent", "DependencyGraphAgent", "...6 more agents"]
      });
      
    } catch (error) {
      console.error("[Stack Modernization] Analysis error:", error);
      res.status(500).json({
        error: "Failed to start analysis",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  /**
   * Get analysis progress
   * GET /api/stack-modernization/analysis/:analysisId/progress
   */
  app.get("/api/stack-modernization/analysis/:analysisId/progress", async (req: Request, res: Response) => {
    try {
      // Temporary auth bypass for development
      const skipAuth = stackModConfig.skipAuth;
      
      if (!skipAuth && !(req as any).user) {
        return res.status(401).json({
          error: "Authentication required",
          code: "UNAUTHENTICATED"
        });
      }
      
      const { analysisId } = req.params;

      // Get state from store; if missing (e.g. server restarted or opening previous analysis), hydrate from DB
      const { stateStore } = await import("../stack-modernization");
      let state = stateStore.get(analysisId);
      if (!state) {
        state = await stateStore.loadFromDb(analysisId) ?? undefined;
      }
      if (!state) {
        return res.status(404).json({
          error: "Analysis not found",
          analysisId
        });
      }
      
      // Build stages based on actual workflow (matches workflow.ts stages).
      // Each stage is tied to a SelectablePhase; if user selected only some phases, unselected ones show as "skipped".
      const hasPlanning = !!state.planMarkdown;
      const hasRiskReport = !!state.riskReport;
      const hasCodeUpgrade = !!((state.modifiedFiles && state.modifiedFiles.length > 0) || ((state as any).codeUpgrade?.modifiedFiles?.length ?? 0) > 0);
      const hasTests = !!(state.generatedTests && state.generatedTests.length > 0);
      const selectedPhases = state.selectedPhases && state.selectedPhases.length > 0 ? state.selectedPhases : null;

      type StageRow = { name: string; phase: "assessment" | "planning" | "tasks" | "execution" | "tests" | "validation"; status: string; progress: number };
      const stagesRaw: StageRow[] = [
        { name: "Repository Profiling", phase: "assessment", status: state.repoProfile ? "completed" : (state.progress >= 5 ? "in_progress" : "pending"), progress: state.repoProfile ? 100 : (state.progress >= 5 ? 50 : 0) },
        { name: "Dependency Analysis", phase: "assessment", status: state.dependencyGraph ? "completed" : (state.progress >= 15 ? "in_progress" : "pending"), progress: state.dependencyGraph ? 100 : (state.progress >= 15 ? 50 : 0) },
        { name: "Version Intelligence", phase: "assessment", status: (state.versionIntelligence?.length ?? 0) > 0 ? "completed" : (state.progress >= 30 ? "in_progress" : "pending"), progress: (state.versionIntelligence?.length ?? 0) > 0 ? 100 : (state.progress >= 30 ? 50 : 0) },
        { name: "Compatibility Check", phase: "planning", status: (state.compatibilityCheck || hasPlanning) ? "completed" : (state.progress >= 45 && state.userSelections?.length ? "in_progress" : "pending"), progress: (state.compatibilityCheck || hasPlanning) ? 100 : (state.progress >= 45 && state.userSelections?.length ? 50 : 0) },
        { name: "Risk Report", phase: "planning", status: hasRiskReport ? "completed" : (state.status === "risk_analysis" ? "in_progress" : (hasPlanning && !hasRiskReport ? "in_progress" : "pending")), progress: hasRiskReport ? 100 : (state.status === "risk_analysis" ? 50 : 0) },
        { name: "Task Planning", phase: "tasks", status: (state.upgradeTasks && state.upgradeTasks.length > 0) ? "completed" : (state.currentStage === "task_planning" ? "in_progress" : "pending"), progress: (state.upgradeTasks && state.upgradeTasks.length > 0) ? 100 : (state.currentStage === "task_planning" ? 50 : 0) },
        { name: "Code Upgrade", phase: "execution", status: hasCodeUpgrade ? "completed" : (state.currentStage === "executing" || state.status === "code_upgrade" ? "in_progress" : "pending"), progress: hasCodeUpgrade ? 100 : (state.status === "code_upgrade" ? 50 : 0) },
        { name: "Completeness Verification", phase: "execution", status: state.completenessReport ? "completed" : (hasCodeUpgrade && /completeness|Verifying upgrade/i.test(state.currentStage || "") ? "in_progress" : (hasCodeUpgrade ? "pending" : "pending")), progress: state.completenessReport ? 100 : 0 },
        { name: "Test Generation", phase: "tests", status: hasTests ? "completed" : (state.currentStage === "generating_tests" ? "in_progress" : "pending"), progress: hasTests ? 100 : (state.currentStage === "generating_tests" ? 50 : 0) },
        ...(stackModConfig.validationEnabled ? [{ name: "Run & Validate", phase: "validation" as const, status: (state as any).validationRun != null ? "completed" : (hasTests && /validation|Preparing project|Running tests/i.test(state.currentStage || "") ? "in_progress" : "pending"), progress: (state as any).validationRun != null ? 100 : (hasTests && /validation|Preparing project|Running tests/i.test(state.currentStage || "") ? 50 : 0) }] : []),
      ];
      const stages = stagesRaw.map((s) => {
        if (selectedPhases && !selectedPhases.includes(s.phase)) {
          return { name: s.name, status: "skipped", progress: 0 };
        }
        return { name: s.name, status: s.status, progress: s.progress };
      });
      
      // Determine current stage message based on status
      // IMPORTANT: preserve the raw currentStage for frontend state machine detection
      // Only override for display purposes, not for machine-readable field
      let currentStageMessage = state.currentStage;
      if (state.status === "risk_analysis" && !state.currentStage.includes("risk")) {
        currentStageMessage = "Analyzing upgrade risks and breaking changes...";
      } else if (state.status === "risk_report_ready" && !state.currentStage.includes("risk")) {
        currentStageMessage = "Risk analysis complete - ready to proceed";
      } else if (state.status === "code_upgrade" && !state.currentStage.includes("code")) {
        currentStageMessage = "Generating and validating upgraded code...";
      } else if (state.status === "failed") {
        currentStageMessage = "Upgrade failed - see errors";
      }
      // Do NOT override currentStage when completed - the raw value
      // ("tests_generated", "execution_complete", etc.) is needed by frontend
      
      // Derived dashboard metrics: one source of truth for frontend cards
      const depGraph = state.dependencyGraph;
      const directCount = depGraph?.directDependencies?.length ?? 0;
      const transitiveCount = depGraph?.transitiveDependencies?.length ?? 0;
      const dependencyPackageCount =
        (depGraph?.totalPackages ?? 0) > 0
          ? depGraph!.totalPackages
          : directCount + transitiveCount > 0
            ? directCount + transitiveCount
            : (state.versionIntelligence?.length ?? 0);
      const tasksTotal = state.upgradeTasks?.length ?? 0;
      const tasksCompleted = state.upgradeTasks?.filter((t: any) => t.status === "completed").length ?? 0;
      const riskReport = (state as any).riskReport;
      const compatibilityCheck = state.compatibilityCheck;
      const riskScore = riskReport?.confidenceScore != null ? riskReport.confidenceScore : undefined;
      const compatibilityScore = compatibilityCheck?.confidence != null ? compatibilityCheck.confidence : undefined;

      const progressPct = computeProgressFromSelectedPhases(state);
      const progress = {
        analysisId,
        status: state.status,
        progress: progressPct,
        currentStage: currentStageMessage || state.currentStage,
        stages, // Dynamic stages with real-time status updates
        errors: state.errors,
        activityLog: state.activityLog || [],
        // Dashboard metrics (number-first for cards)
        tasksTotal,
        tasksCompleted,
        dependencyPackageCount,
        riskScore,
        compatibilityScore,
        // Include version data in progress so frontend gets it immediately
        versionIntelligence: state.versionIntelligence,
        // Vendor library detections (client-side libs from wwwroot/lib, CDN refs, CSS-class inferred)
        vendorDownloadResults: state.vendorDownloadResults,
        vendorLibraries: state.vendorLibraries,
        bundleDetections: state.bundleDetections,
        discoveredBundledLibraries: state.discoveredBundledLibraries,
        repoProfile: state.repoProfile,
        dependencyGraph: state.dependencyGraph,
        riskReport: (state as any).riskReport,
        compatibilityCheck: state.compatibilityCheck,
        codeUpgrade: (state as any).codeUpgrade,
        // Assessment sub-agent data for real-time cards
        assessmentSubAgentStatus: state.assessmentSubAgentStatus,
        securityAssessment: state.securityAssessment,
        codeQuality: state.codeQuality,
        breakingChangesPreview: state.breakingChangesPreview,
        databaseDependencies: state.databaseDependencies,
        requirementsAnalysis: state.requirementsAnalysis,
        // Planning visualization data for charts
        planningVisualizationData: state.planningVisualizationData,
        // Task execution results for accordion
        taskExecutionResults: state.taskExecutionResults,
        // Add explicit pause indicator
        isPaused: state.status === 'awaiting_user_selection',
        pauseReason: state.status === 'awaiting_user_selection' 
          ? `Waiting for user to select target versions for ${state.versionIntelligence?.length || 0} packages`
          : null,
        // NEW: Add markdown artifacts for frontend
        assessmentMarkdown: state.assessmentMarkdown,
        versionRecommendationsText: state.versionRecommendationsText,
        planMarkdown: state.planMarkdown,
        tasksMarkdown: state.tasksMarkdown,
        testResultsMarkdown: state.testResultsMarkdown,
        confidenceReportMarkdown: state.confidenceReportMarkdown,
        upgradeTasks: state.upgradeTasks,
        generatedTests: state.generatedTests,
        modifiedFiles: state.modifiedFiles ?? (state as any).codeUpgrade?.modifiedFiles ?? [],
        // Full repo file tree: list of all extracted file paths (for IDE file tree)
        extractedFilePaths: (state.extractedFiles || []).map((f: any) => (f.relativePath || f.path || "").replace(/\\/g, "/")).filter(Boolean),
        // Run-and-validate (code execution in Docker) so frontend can show Validation step and wait before "complete"
        validationRun: (state as any).validationRun ?? undefined,
        validationPassed: (state as any).validationPassed,
        validationAttempts: (state as any).validationAttempts,
        validationEnabled: stackModConfig.validationEnabled,
        // Stack and project path for Run file / Build / Run project and terminal
        stack: (() => {
          const f = (state as any).repositoryTree?.framework;
          const p = state.repoProfile?.projectType;
          if (f === "dotnet" || f === "python") return f;
          if (p === "dotnet" || p === "python") return p;
          return null;
        })(),
        projectPath: (state as any).currentRunDirectory ?? undefined,
        tokenUsage: state.tokenUsage ?? null,
        // GAP fields: completeness verification, API impact, obsolete packages, bundle detections, new libraries
        completenessReport: state.completenessReport ?? undefined,
        completenessReportMarkdown: state.completenessReportMarkdown ?? undefined,
        apiUsageImpactReport: state.apiUsageImpactReport ?? undefined,
        apiUsageImpactMarkdown: state.apiUsageImpactMarkdown ?? undefined,
        removedObsoletePackages: state.removedObsoletePackages ?? undefined,
        newLibrariesAdded: state.newLibrariesAdded ?? undefined,
        vendorUpdateReportMarkdown: state.vendorUpdateReportMarkdown ?? undefined,
        // CDN and CSS-class-inferred library detections
        cdnReferences: state.cdnReferences ?? undefined,
        inferredLibraries: state.inferredLibraries ?? undefined,
        // Comprehensive migration report (generated after completeness verification)
        migrationReportMarkdown: state.migrationReportMarkdown ?? undefined,
        // Files skipped due to size threshold
        skippedFiles: (state as any).skippedFiles ?? undefined,
        // Structural scaffold data for major version jumps
        scaffoldResult: state.scaffoldResult ?? undefined,
        structuralChangesMarkdown: state.structuralChangesMarkdown ?? undefined,
      };

      // Only log on meaningful state transitions, not every poll
      const lastLoggedStage = (progressLogTracker as any)[analysisId];
      const currentKey = `${progress.status}|${progress.currentStage}|${progress.progress}`;
      if (lastLoggedStage !== currentKey) {
        (progressLogTracker as any)[analysisId] = currentKey;
      }
      
      res.json(progress);
      
    } catch (error) {
      console.error("[Stack Modernization] Progress error:", error);
      res.status(500).json({
        error: "Failed to get progress",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * GET /api/stack-modernization/analysis/:analysisId/file-content?path=<relativePath>
   * Returns the content of a file by relative path. Resolves from modifiedFiles, generatedTests, extractedFiles, or prepared project dir.
   */
  app.get("/api/stack-modernization/analysis/:analysisId/file-content", async (req: Request, res: Response) => {
    try {
      const skipAuth = stackModConfig.skipAuth;
      if (!skipAuth && !(req as any).user) {
        return res.status(401).json({ error: "Authentication required", code: "UNAUTHENTICATED" });
      }
      const { analysisId } = req.params;
      const filePath = (req.query.path as string)?.replace(/\\/g, "/");
      if (!filePath) {
        return res.status(400).json({ error: "Missing query parameter: path" });
      }
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      if (!state) {
        return res.status(404).json({ error: "Analysis not found", analysisId });
      }
      const normalized = filePath.replace(/\\/g, "/");
      const normalizedLower = normalized.toLowerCase();

      // Robust path matcher: exact, case-insensitive, suffix match
      function pathMatches(candidatePath: string, target: string, targetLower: string): boolean {
        const p = candidatePath.replace(/\\/g, "/");
        if (p === target) return true;
        const pLower = p.toLowerCase();
        if (pLower === targetLower) return true;
        if (pLower.endsWith("/" + targetLower) || targetLower.endsWith("/" + pLower)) return true;
        return false;
      }

      // Priority 1: upgraded/modified files (upgraded content takes precedence)
      const modified = state.modifiedFiles ?? (state as any).codeUpgrade?.modifiedFiles ?? [];
      const mod = modified.find((f: any) => pathMatches(f.path || f.filePath || "", normalized, normalizedLower));
      if (mod) {
        const content = mod.content ?? mod.modifiedContent ?? "";
        return res.json({ path: normalized, content });
      }

      // Priority 2: generated tests
      const tests = state.generatedTests || [];
      const testFile = tests.find((t: any) => pathMatches(t.filePath || "", normalized, normalizedLower));
      if (testFile) {
        return res.json({ path: normalized, content: testFile.testCode || "" });
      }

      // Priority 3: original extracted files (unmodified)
      const extracted = state.extractedFiles || [];
      const ext = extracted.find((f: any) => pathMatches(f.relativePath || f.path || "", normalized, normalizedLower));
      if (ext) {
        return res.json({ path: normalized, content: ext.content ?? "" });
      }
      const fs = await import("fs/promises");
      const pathMod = await import("path");
      const currentRunDir = (state as any).currentRunDirectory;
      if (currentRunDir) {
        try {
          const fullPath = pathMod.join(currentRunDir, normalized);
          const content = await fs.readFile(fullPath, "utf-8");
          return res.json({ path: normalized, content });
        } catch {
          // fall through to 404
        }
      }
      return res.status(404).json({ error: "File not found", path: normalized });
    } catch (error) {
      console.error("[Stack Modernization] File content error:", error);
      res.status(500).json({
        error: "Failed to get file content",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * PUT /api/stack-modernization/analysis/:analysisId/file
   * Create or update a file in the run directory and state.modifiedFiles.
   */
  app.put("/api/stack-modernization/analysis/:analysisId/file", async (req: Request, res: Response) => {
    try {
      const skipAuth = stackModConfig.skipAuth;
      if (!skipAuth && !(req as any).user) {
        return res.status(401).json({ error: "Authentication required", code: "UNAUTHENTICATED" });
      }
      const { analysisId } = req.params;
      const { path: filePath, content } = req.body as { path?: string; content?: string };
      const normalized = (filePath ?? "").replace(/\\/g, "/");
      if (!normalized) {
        return res.status(400).json({ error: "Missing body: path" });
      }
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      if (!state) {
        return res.status(404).json({ error: "Analysis not found", analysisId });
      }
      const { prepareProjectDir } = await import("../stack-modernization/services/prepare-project-dir");
      let projectRoot: string;
      if (state.currentRunDirectory) {
        try {
          const fs = await import("fs/promises");
          await fs.access(state.currentRunDirectory);
          projectRoot = state.currentRunDirectory;
        } catch {
          projectRoot = await prepareProjectDir(state);
          state.currentRunDirectory = projectRoot;
          stateStore.save(state);
        }
      } else {
        projectRoot = await prepareProjectDir(state);
        state.currentRunDirectory = projectRoot;
        stateStore.save(state);
      }
      const pathMod = await import("path");
      const fs = await import("fs/promises");
      const fullPath = pathMod.join(projectRoot, normalized);
      await fs.mkdir(pathMod.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content ?? "", "utf8");
      const modified = state.modifiedFiles ?? [];
      const existing = modified.find((f: any) => (f.path ?? f.filePath ?? "").replace(/\\/g, "/") === normalized);
      if (existing) {
        existing.content = content ?? "";
      } else {
        modified.push({ path: normalized, content: content ?? "" });
      }
      state.modifiedFiles = modified;
      stateStore.save(state);
      return res.json({ path: normalized, success: true });
    } catch (error) {
      console.error("[Stack Modernization] PUT file error:", error);
      res.status(500).json({
        error: "Failed to write file",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * DELETE /api/stack-modernization/analysis/:analysisId/file?path=<relativePath>
   * Remove file from run directory and state; add path to deletedPaths.
   */
  app.delete("/api/stack-modernization/analysis/:analysisId/file", async (req: Request, res: Response) => {
    try {
      const skipAuth = stackModConfig.skipAuth;
      if (!skipAuth && !(req as any).user) {
        return res.status(401).json({ error: "Authentication required", code: "UNAUTHENTICATED" });
      }
      const { analysisId } = req.params;
      const filePath = (req.query.path as string)?.replace(/\\/g, "/");
      if (!filePath) {
        return res.status(400).json({ error: "Missing query parameter: path" });
      }
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      if (!state) {
        return res.status(404).json({ error: "Analysis not found", analysisId });
      }
      const projectRoot = state.currentRunDirectory;
      if (projectRoot) {
        const pathMod = await import("path");
        const fs = await import("fs/promises");
        const fullPath = pathMod.join(projectRoot, filePath);
        try {
          await fs.rm(fullPath, { force: true });
        } catch (e) {
          console.warn("[Stack Modernization] DELETE file (disk):", e instanceof Error ? e.message : String(e));
        }
      }
      state.modifiedFiles = (state.modifiedFiles ?? []).filter(
        (f: any) => (f.path ?? f.filePath ?? "").replace(/\\/g, "/") !== filePath
      );
      const deletedPaths = (state as any).deletedPaths ?? [];
      if (!deletedPaths.includes(filePath)) {
        deletedPaths.push(filePath);
        (state as any).deletedPaths = deletedPaths;
      }
      stateStore.save(state);
      return res.json({ path: filePath, success: true });
    } catch (error) {
      console.error("[Stack Modernization] DELETE file error:", error);
      res.status(500).json({
        error: "Failed to delete file",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /api/stack-modernization/analysis/:analysisId/run-command
   * Run a single command in the project directory (for terminal: run file, build, run project, or custom).
   */
  app.post("/api/stack-modernization/analysis/:analysisId/run-command", async (req: Request, res: Response) => {
    try {
      const skipAuth = stackModConfig.skipAuth;
      if (!skipAuth && !(req as any).user) {
        return res.status(401).json({ error: "Authentication required", code: "UNAUTHENTICATED" });
      }
      const { analysisId } = req.params;
      const { command } = req.body as { command?: string };
      const cmd = typeof command === "string" ? command.trim() : "";
      if (!cmd) {
        return res.status(400).json({ error: "Missing body: command" });
      }
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      if (!state) {
        return res.status(404).json({ error: "Analysis not found", analysisId });
      }
      let projectRoot: string = (state as any).currentRunDirectory;
      if (!projectRoot) {
        const { prepareProjectDir } = await import("../stack-modernization/services/prepare-project-dir");
        projectRoot = await prepareProjectDir(state);
        (state as any).currentRunDirectory = projectRoot;
        stateStore.save(state);
      } else {
        const fs = await import("fs/promises");
        try {
          await fs.access(projectRoot);
        } catch {
          const { prepareProjectDir } = await import("../stack-modernization/services/prepare-project-dir");
          projectRoot = await prepareProjectDir(state);
          (state as any).currentRunDirectory = projectRoot;
          stateStore.save(state);
        }
      }
      const framework = (state as any).repositoryTree?.framework;
      const pt = state.repoProfile?.projectType;
      const stack = framework === "dotnet" || framework === "python"
        ? framework
        : pt === "dotnet" || pt === "python"
          ? pt
          : null;
      if (!stack) {
        return res.status(400).json({
          error: "Stack not detected (dotnet/python required for run-command)",
          projectPath: projectRoot,
        });
      }
      const versionInfo = state.repoProfile?.runtimeInfo?.find((r: any) =>
        (r.language === "dotnet" && stack === "dotnet") || (r.language === "python" && stack === "python")
      );
      const runtimeVersion = versionInfo?.version
        ? String(versionInfo.version).replace(/^v/, "").split(".").slice(0, 2).join(".")
        : undefined;
      // For dotnet: patch .csproj for NETSDK1022 and NuGet version conflicts before running
      if (stack === "dotnet") {
        const { patchDotnetCsprojDuplicateCompile, patchDotnetNugetIssues } = await import("../stack-modernization/services/prepare-project-dir");
        await patchDotnetCsprojDuplicateCompile(projectRoot).catch(() => {});
        // Resolve the intended TFM from user's version selections so absorbed packages are detected correctly
        const selections = state.userSelections || [];
        const dotnetSel = selections.find((s: any) => /\.net|dotnet/i.test(s.package || ""));
        const intendedTfm = dotnetSel?.selectedVersion ? `net${dotnetSel.selectedVersion}` : undefined;
        await patchDotnetNugetIssues(projectRoot, intendedTfm).catch(() => {});
      }

      // For dotnet, resolve solution and startup project (prefer OutputType Exe). Run from solution/project dir.
      let finalCommand = cmd;
      let runCwd = "";
      if (stack === "dotnet" && (cmd === "dotnet run" || cmd === "dotnet build")) {
        const { resolveDotnetTargets, getDotnetRunCwd } = await import("../stack-modernization/services/dotnet-project-resolver");
        const targets = await resolveDotnetTargets(projectRoot, 5);
        runCwd = getDotnetRunCwd(targets);
        // When cwd is solution dir, use paths relative to cwd so dotnet finds the project
        const projectArg = runCwd && targets.csprojForRun?.startsWith(runCwd + "/")
          ? targets.csprojForRun.slice(runCwd.length + 1)
          : targets.csprojForRun;
        const buildArg = runCwd && targets.sln?.startsWith(runCwd + "/")
          ? targets.sln.slice(runCwd.length + 1)
          : targets.sln;
        if (cmd === "dotnet run" && targets.csprojForRun) {
          finalCommand = `dotnet run --project ${projectArg ?? targets.csprojForRun}`;
        } else if (cmd === "dotnet build" && (targets.sln || targets.csprojForRun)) {
          const buildTarget = targets.sln ? (buildArg ?? targets.sln) : (projectArg ?? targets.csprojForRun);
          finalCommand = `dotnet build ${buildTarget}`;
        }
      }

      const { codeExecutionService } = await import("../code-execution");
      const request = {
        runId: `run-cmd-${Date.now()}`,
        stack,
        projectPath: projectRoot,
        runtimeVersion,
      };
      const result = await codeExecutionService.runCommand(request, {
        command: finalCommand,
        cwd: runCwd,
        timeoutMs: 300000,
      });
      return res.json({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        projectPath: projectRoot,
      });
    } catch (error) {
      console.error("[Stack Modernization] run-command error:", error);
      res.status(500).json({
        error: "Failed to run command",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/stack-modernization/analysis/:analysisId/report-stream?type=assessment|risk|compatibility|plan
   * SSE endpoint: stream report markdown in chunks for streaming UX.
   */
  app.get("/api/stack-modernization/analysis/:analysisId/report-stream", async (req: Request, res: Response) => {
    try {
      const skipAuth = stackModConfig.skipAuth;
      if (!skipAuth && !(req as any).user) {
        return res.status(401).json({ error: "Authentication required", code: "UNAUTHENTICATED" });
      }
      const { analysisId } = req.params;
      const type = (req.query.type as string) || "assessment";
      if (!["assessment", "risk", "compatibility", "plan"].includes(type)) {
        return res.status(400).json({ error: "Invalid type; use assessment, risk, compatibility, or plan" });
      }

      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      if (!state) {
        return res.status(404).json({ error: "Analysis not found", analysisId });
      }

      let markdown = "";
      if (type === "assessment") {
        markdown = state.assessmentMarkdown || "";
      } else if (type === "plan") {
        markdown = state.planMarkdown || "";
      } else if (type === "risk") {
        const risk = (state as any).riskReport;
        if (risk) {
          const lines: string[] = ["# Risk Report\n", `**Overall risk:** ${risk.overallRisk || "—"}\n`, `**Recommendation:** ${risk.recommendation || "—"}\n`];
          if (risk.breakingChanges?.length) {
            lines.push(`\n## Breaking changes (${risk.breakingChanges.length})\n`);
            risk.breakingChanges.slice(0, 20).forEach((b: any) => {
              lines.push(`- ${b.description || b.name || JSON.stringify(b)}\n`);
            });
            if (risk.breakingChanges.length > 20) lines.push(`\n*... and ${risk.breakingChanges.length - 20} more*\n`);
          }
          markdown = lines.join("");
        }
      } else if (type === "compatibility") {
        const compat = state.compatibilityCheck;
        if (compat) {
          markdown = [
            "# Compatibility Check\n",
            `**Recommendation:** ${compat.recommendation || "—"}\n`,
            `**Compatible:** ${compat.compatible === true ? "Yes" : compat.compatible === false ? "No" : "—"}\n`,
            (compat as any).summary ? `\n${(compat as any).summary}\n` : "",
            compat.conflicts?.length ? `\n## Conflicts\n${(compat.conflicts as any[]).map((c: any) => `- ${c}\n`).join("")}` : "",
            compat.warnings?.length ? `\n## Warnings\n${(compat.warnings as any[]).map((w: any) => `- ${w}\n`).join("")}` : "",
          ].join("");
        }
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      // Send in chunks (by line) for streaming feel
      const lines = markdown.split("\n");
      const chunkSize = 3;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize).join("\n") + (i + chunkSize < lines.length ? "\n" : "");
        if (chunk) res.write(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    } catch (error) {
      console.error("[Stack Modernization] Report stream error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Failed to stream report",
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  });
  
  /**
   * POST /api/stack-modernization/select-versions
   * Submit user's version selections
   */
  app.post("/api/stack-modernization/select-versions", async (req, res) => {
    try {
      const { analysisId, selections } = req.body;
      
      if (!analysisId || !selections || !Array.isArray(selections)) {
        return res.status(400).json({
          error: "Missing required fields: analysisId, selections (array)"
        });
      }
      
      
      // Dynamic import
      const { stateStore } = await import("../stack-modernization");
      const { executeCompatibilityCheckAgent } = await import("../stack-modernization/agents/compatibility-check-agent");
      const { executeRiskReportAgent } = await import("../stack-modernization/agents/risk-report-agent");
      
      // Get state
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      // Allow compatibility check when we have version intelligence and dependency data
      if (!state.versionIntelligence?.length) {
        return res.status(400).json({
          error: "Version recommendations not available. Complete analysis first.",
          currentStatus: state.status
        });
      }

      // Require at least one package where target differs from current (no upgrade otherwise)
      if (!hasAtLeastOneUpgrade(selections)) {
        return res.status(400).json({
          error: "No upgrade needed. All selected versions match current. Change at least one target to proceed."
        });
      }

      // Enrich selections: if currentVersion is "detected" or missing, look it up from versionIntelligence
      const viLookup = new Map<string, string>();
      for (const vi of (state.versionIntelligence || [])) {
        const name = (vi.package || "").toLowerCase().trim();
        if (name && vi.currentVersion) viLookup.set(name, vi.currentVersion);
      }
      for (const sel of selections) {
        if (!sel.currentVersion || sel.currentVersion === "detected" || sel.currentVersion === "unknown") {
          const key = (sel.package || "").toLowerCase().trim();
          let found = viLookup.get(key) || "";
          if (!found) {
            // Try partial match
            for (const [k, v] of viLookup) {
              if (k.includes(key) || key.includes(k)) { found = v; break; }
            }
          }
          sel.currentVersion = found || sel.currentVersion || "unknown";
        }
      }

      // Capture old selections for audit before overwriting
      const oldSelections = state.userSelections ? [...state.userSelections] : undefined;

      // Store selections
      state.userSelections = selections;
      state.currentStage = "Version selections received";
      state.progress = 40;
      stateStore.save(state);

      stateStore.saveToDb(state.analysisId).catch(() => {});

      // If this is a re-selection (old selections exist), record the change
      if (oldSelections && oldSelections.length > 0) {
        const { recordVersionChange } = await import("../stack-modernization/services/db-persistence");
        recordVersionChange({
          analysisId,
          phaseReset: "version_reselection",
          previousSelections: oldSelections as any,
          newSelections: selections,
          downstreamPhasesCleared: [],
          changedBy: state.userId,
        }).catch(() => {});
      }

      // Return immediately - frontend will call execute-planning next
      res.json({
        analysisId,
        status: "selections_saved",
        selectionsReceived: selections.length
      });
      
    } catch (error) {
      console.error("[Stack Modernization] Selection error:", error);
      res.status(500).json({
        error: "Failed to process selections",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  /**
   * GET /api/stack-modernization/analysis/:analysisId/compatibility
   * Get compatibility check results
   */
  app.get("/api/stack-modernization/analysis/:analysisId/compatibility", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      // Dynamic import
      const { stateStore } = await import("../stack-modernization");
      
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      // If failed, return error status
      if (state.status === 'failed') {
        return res.status(500).json({
          error: "Post-selection workflow failed",
          status: state.status,
          errors: state.errors,
          progress: computeProgressFromSelectedPhases(state)
        });
      }
      
      // If not yet complete, return status
      if (!state.compatibilityCheck) {
        return res.json({ 
          analysisId,
          status: state.status,
          progress: computeProgressFromSelectedPhases(state),
          currentStage: state.currentStage,
          message: "Compatibility check in progress...",
          compatibilityCheck: null
        });
      }
      
      // Return complete results
      const response = {
        analysisId,
        status: state.status,
        progress: computeProgressFromSelectedPhases(state),
        currentStage: state.currentStage,
        compatibilityCheck: state.compatibilityCheck,
        riskReport: (state as any).riskReport,
        codeUpgrade: (state as any).codeUpgrade,
        userSelections: state.userSelections || []
      };
      
      
      // Log detailed info about what we're sending
      if (response.codeUpgrade) {
      }
      
      res.json(response);
      
    } catch (error) {
      console.error("[Stack Modernization] Compatibility result error:", error);
      res.status(500).json({
        error: "Failed to get compatibility results",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  /**
   * GET /api/stack-modernization/analysis/:analysisId/results
   * Get complete analysis results
   */
  app.get("/api/stack-modernization/analysis/:analysisId/results", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      // Dynamic import
      const { stateStore } = await import("../stack-modernization");
      
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      // Return complete state (sanitized)
      res.json({
        analysisId,
        sessionId: state.sessionId,
        status: state.status,
        progress: computeProgressFromSelectedPhases(state),
        repoProfile: state.repoProfile,
        dependencyGraph: state.dependencyGraph,
        versionIntelligence: state.versionIntelligence,
        vendorLibraries: state.vendorLibraries,
        bundleDetections: state.bundleDetections,
        discoveredBundledLibraries: state.discoveredBundledLibraries,
        userSelections: state.userSelections,
        compatibilityCheck: state.compatibilityCheck,
        riskReport: (state as any).riskReport,
        codeUpgrade: (state as any).codeUpgrade,
        activityLog: state.activityLog,
        errors: state.errors
      });
      
    } catch (error) {
      console.error("[Stack Modernization] Results error:", error);
      res.status(500).json({
        error: "Failed to get results",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * POST /api/stack-modernization/risk-report
   * Generate risk analysis and summary report for selected versions
   */
  app.post("/api/stack-modernization/risk-report", async (req, res) => {
    try {
      const { analysisId, selections } = req.body;
      
      if (!analysisId || !selections || !Array.isArray(selections)) {
        return res.status(400).json({
          error: "Missing required fields: analysisId, selections (array)"
        });
      }
      
      const { stateStore } = await import("../stack-modernization");
      const { executeRiskReportAgent } = await import("../stack-modernization/agents/risk-report-agent");
      
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      if (!state.userSelections?.length && selections.length === 0) {
        return res.status(400).json({
          error: "No version selections. Please select versions and run compatibility check first."
        });
      }
      
      const sel = selections.length > 0 ? selections : state.userSelections || [];
      
      const riskReport = await executeRiskReportAgent(state, sel);
      state.riskReport = riskReport;
      stateStore.save(state);
      
      res.json({
        analysisId,
        riskReport
      });
      
    } catch (error) {
      console.error("[Stack Modernization] Risk report error:", error);
      res.status(500).json({
        error: "Failed to generate risk report",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * POST /api/stack-modernization/execute-upgrade
   * Apply selected versions to package manifests and return modified files
   */
  app.post("/api/stack-modernization/execute-upgrade", async (req, res) => {
    try {
      const { analysisId, selections } = req.body;
      
      if (!analysisId || !selections || !Array.isArray(selections)) {
        return res.status(400).json({
          error: "Missing required fields: analysisId, selections (array)"
        });
      }
      
      const { stateStore } = await import("../stack-modernization");
      const { executeCodeUpgrade } = await import("../stack-modernization/services/code-upgrade-executor");
      
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      const extractedFiles = state.extractedFiles || [];
      if (extractedFiles.length === 0) {
        return res.status(400).json({
          error: "No extracted files available for upgrade. Re-upload your codebase."
        });
      }
      
      const result = executeCodeUpgrade(extractedFiles, selections);
      
      res.json({
        analysisId,
        success: result.success,
        modifiedFiles: result.modifiedFiles,
        errors: result.errors
      });
      
    } catch (error) {
      console.error("[Stack Modernization] Execute upgrade error:", error);
      res.status(500).json({
        error: "Failed to execute upgrade",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  /**
   * POST /api/stack-modernization/analysis/:analysisId/execute-code-generation
   * Execute code generation AFTER user approves risk report
   */
  app.post("/api/stack-modernization/analysis/:analysisId/execute-code-generation", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      
      const { stateStore } = await import("../stack-modernization");
      let state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      if (state.status !== "risk_report_ready") {
        return res.status(400).json({ 
          error: "Risk analysis must be completed before code generation",
          currentStatus: state.status
        });
      }
      
      if (!state.riskReport) {
        return res.status(400).json({ 
          error: "Risk report not found" 
        });
      }
      
      if (!state.userSelections || state.userSelections.length === 0) {
        return res.status(400).json({ 
          error: "No version selections found" 
        });
      }

      if (!hasAtLeastOneUpgrade(state.userSelections)) {
        return res.status(400).json({
          error: "No upgrade needed. All selected versions match current. Change at least one target to proceed."
        });
      }
      
      
      // Send immediate response
      res.json({
        analysisId,
        message: "Code generation initiated",
        status: "code_upgrade"
      });
      
      // Execute code generation asynchronously (LangGraph resume or legacy agents)
      (async () => {
        try {
          // Log selections for debugging — this confirms what versions the user chose
          console.log(`[Code Generation] Starting for ${analysisId} with ${state.userSelections!.length} selections:`);
          for (const sel of state.userSelections!) {
            console.log(`  - ${sel.package}: ${sel.currentVersion} → ${sel.selectedVersion}`);
          }

          state.status = "code_upgrade";
          state.progress = 85;
          state.currentStage = "Generating upgraded code...";
          stateStore.save(state);

          const { useLangGraphStackModernization } = await import("../stack-modernization/graph/config");
          if (useLangGraphStackModernization()) {
            const { stackModGraph, graphConfig } = await import("../stack-modernization/graph");
            const { Command } = await import("@langchain/langgraph");
            await stackModGraph.invoke(new Command({ resume: true }), graphConfig(analysisId));
            const upgradedState = stateStore.get(analysisId);
            if (upgradedState) {
              upgradedState.status = "completed";
              upgradedState.progress = 100;
              upgradedState.currentStage = "Code upgrade complete!";
              stateStore.save(upgradedState);
            }
          } else {
            const { executeCodeUpgradeAgent } = await import("../stack-modernization/agents/code-upgrade-agent");
            const onProgress = (files: Array<{ path: string; content: string; originalContent: string }>) => {
              const s = stateStore.get(analysisId);
              if (s) {
                s.modifiedFiles = files.map((f) => ({ path: f.path, content: f.content, originalContent: f.originalContent }));
                stateStore.save(s);
              }
            };
            const upgradedState = await executeCodeUpgradeAgent(state, state.userSelections || [], { onProgress });
            const codeUpgradeResult = (upgradedState as any).codeUpgrade;
            if (codeUpgradeResult?.modifiedFiles?.length) {
              upgradedState.modifiedFiles = codeUpgradeResult.modifiedFiles;
            }

            // Run completeness verification + generate migration report
            try {
              const { verifyUpgradeCompleteness } = await import("../stack-modernization/services/completeness-verifier");
              const report = verifyUpgradeCompleteness(
                upgradedState.modifiedFiles ?? [],
                upgradedState.extractedFiles ?? [],
                upgradedState.userSelections ?? [],
                upgradedState.vendorLibraries,
                upgradedState.apiUsageImpactReport,
              );
              upgradedState.completenessReport = report;
              upgradedState.completenessReportMarkdown = report.markdown;
              console.log(`[Code Generation] Completeness: ${report.overallScore}%`);
            } catch (compErr) {
              console.warn("[Code Generation] Completeness verification failed (non-fatal):", compErr instanceof Error ? compErr.message : compErr);
            }
            try {
              const { generateMigrationReport } = await import("../stack-modernization/services/migration-report-generator");
              upgradedState.migrationReportMarkdown = generateMigrationReport(upgradedState);
              console.log(`[Code Generation] Migration report generated (${upgradedState.migrationReportMarkdown.length} chars)`);
            } catch (reportErr) {
              console.warn("[Code Generation] Migration report generation failed (non-fatal):", reportErr instanceof Error ? reportErr.message : reportErr);
            }

            upgradedState.status = "completed";
            upgradedState.progress = 100;
            upgradedState.currentStage = "Code upgrade complete!";
            stateStore.save(upgradedState);
          }
        } catch (error) {
          console.error(`[Code Generation] ❌ Failed:`, error);
          state.status = "failed";
          state.errors.push(error instanceof Error ? error.message : "Code generation failed");
          stateStore.save(state);
        }
      })();
      
    } catch (error) {
      console.error("[Code Generation] Error:", error);
      res.status(500).json({
        error: "Failed to initiate code generation",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * POST /api/stack-modernization/analysis/:analysisId/execute-upgrade
   * Execute FULL upgrade workflow: Risk Report → Code Generation → Validation
   */
  app.post("/api/stack-modernization/analysis/:analysisId/execute-upgrade", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      
      const { stateStore } = await import("../stack-modernization");
      let state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      // Extract user selections from AI-enhanced prompt
      // When user clicks "Start Upgrade Process", we need to convert their intent into version selections
      const userSelections: import("../stack-modernization/types").VersionSelection[] = [];
      
      // Get the detected runtime and target from the enhanced prompt analysis
      if (state.repoProfile?.runtimeInfo) {
        for (const runtime of state.repoProfile.runtimeInfo) {
          // Default target: .NET Framework 4.x → .NET 8.0, .NET 5/6/7 → .NET 10.0
          const currentVer = parseFloat(runtime.version || "0");
          const targetVersion = currentVer < 5 ? "8.0" : "10.0";
          
          userSelections.push({
            package: runtime.language,
            currentVersion: runtime.version || "unknown",
            selectedVersion: targetVersion,
            category: "runtime"
          });
        }
      }
      
      if (userSelections.length === 0) {
        return res.status(400).json({ 
          error: "No upgrade targets identified. Please ensure version analysis completed successfully." 
        });
      }

      if (!hasAtLeastOneUpgrade(userSelections)) {
        return res.status(400).json({
          error: "No upgrade needed. All selected versions match current. Change at least one target to proceed."
        });
      }
      
      
      // Store selections in state
      state.userSelections = userSelections;
      stateStore.save(state);
      
      // Send immediate response - workflow will continue in background
      res.json({
        analysisId,
        message: "Upgrade workflow initiated",
        status: "processing",
        selections: userSelections,
        nextSteps: ["risk_analysis", "code_generation", "validation"]
      });
      
      // Execute workflow asynchronously
      (async () => {
        try {
          
          // Phase 1: Risk Report - STOP HERE AND WAIT FOR USER APPROVAL
          const { executeRiskReportAgent } = await import("../stack-modernization/agents/risk-report-agent");
          
          state.status = "risk_analysis";
          state.progress = 50;
          stateStore.save(state);
          
          const riskReport = await executeRiskReportAgent(state, userSelections as import("../stack-modernization/types").VersionSelection[]);
          state.riskReport = riskReport;
          state.status = "risk_report_ready"; // STOP HERE - Frontend will poll and show UI
          state.progress = 80;
          state.currentStage = "Risk analysis complete - awaiting user approval";
          stateStore.save(state);
          
          
          // DO NOT CONTINUE TO CODE GENERATION - User must explicitly approve
          // The frontend will detect risk_report_ready status and show approval UI
          
        } catch (error) {
          console.error(`[Execute Upgrade] ❌ Workflow failed:`, error);
          state.status = "failed";
          state.errors.push(error instanceof Error ? error.message : "Unknown error");
          stateStore.save(state);
        }
      })();
      
    } catch (error) {
      console.error("[Stack Modernization] Upgrade execution error:", error);
      res.status(500).json({
        error: "Failed to initiate upgrade",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  /**
   * GET /api/stack-modernization/analysis/:analysisId/download-report
   * Download comprehensive analysis report as Markdown
   */
  app.get("/api/stack-modernization/analysis/:analysisId/download-report", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      // Generate comprehensive markdown report
      const report = generateComprehensiveReport(state);
      
      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="stack-modernization-report-${analysisId}.md"`);
      res.send(report);
      
    } catch (error) {
      console.error("[Stack Modernization] Report download error:", error);
      res.status(500).json({
        error: "Failed to generate report",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * GET /api/stack-modernization/analysis/:analysisId/download-assessment
   * Download assessment.md
   */
  app.get("/api/stack-modernization/analysis/:analysisId/download-assessment", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      if (!state.assessmentMarkdown) {
        return res.status(404).json({ error: "Assessment not generated yet" });
      }
      
      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="assessment-${analysisId}.md"`);
      res.send(state.assessmentMarkdown);
      
    } catch (error) {
      console.error("[Stack Modernization] Assessment download error:", error);
      res.status(500).json({
        error: "Failed to download assessment",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  /**
   * GET /api/stack-modernization/analysis/:analysisId/download-plan
   * Download plan.md
   */
  app.get("/api/stack-modernization/analysis/:analysisId/download-plan", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      if (!state.planMarkdown) {
        return res.status(404).json({ error: "Plan not generated yet" });
      }
      
      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="plan-${analysisId}.md"`);
      res.send(state.planMarkdown);
      
    } catch (error) {
      console.error("[Stack Modernization] Plan download error:", error);
      res.status(500).json({
        error: "Failed to download plan",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  /**
   * GET /api/stack-modernization/analysis/:analysisId/download-tasks
   * Download tasks.md
   */
  app.get("/api/stack-modernization/analysis/:analysisId/download-tasks", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      if (!state.tasksMarkdown) {
        return res.status(404).json({ error: "Tasks not generated yet" });
      }
      
      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="tasks-${analysisId}.md"`);
      res.send(state.tasksMarkdown);
      
    } catch (error) {
      console.error("[Stack Modernization] Tasks download error:", error);
      res.status(500).json({
        error: "Failed to download tasks",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  /**
   * GET /api/stack-modernization/analysis/:analysisId/download-confidence-report
   * Download confidence-report.md (enterprise-grade upgrade certification)
   */
  app.get("/api/stack-modernization/analysis/:analysisId/download-confidence-report", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      if (!state.confidenceReportMarkdown) {
        return res.status(404).json({ error: "Confidence report not generated yet. Complete test generation first." });
      }
      
      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="confidence-report-${analysisId}.md"`);
      res.send(state.confidenceReportMarkdown);
      
    } catch (error) {
      console.error("[Stack Modernization] Confidence report download error:", error);
      res.status(500).json({
        error: "Failed to download confidence report",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * GET /api/stack-modernization/analysis/:analysisId/download-test-results
   * Download test-results.md
   */
  app.get("/api/stack-modernization/analysis/:analysisId/download-test-results", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      if (!state.testResultsMarkdown) {
        return res.status(404).json({ error: "Test results not generated yet" });
      }
      
      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="test-results-${analysisId}.md"`);
      res.send(state.testResultsMarkdown);
      
    } catch (error) {
      console.error("[Stack Modernization] Test results download error:", error);
      res.status(500).json({
        error: "Failed to download test results",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // ── Download endpoints for all generated reports ──

  const REPORT_DOWNLOAD_MAP: Record<string, { stateKey: string; label: string }> = {
    "migration-report":         { stateKey: "migrationReportMarkdown",        label: "Migration report" },
    "completeness-report":      { stateKey: "completenessReportMarkdown",     label: "Completeness report" },
    "vendor-update-report":     { stateKey: "vendorUpdateReportMarkdown",     label: "Vendor update report" },
    "api-impact-report":        { stateKey: "apiUsageImpactMarkdown",         label: "API impact report" },
    "structural-changes-report": { stateKey: "structuralChangesMarkdown",     label: "Structural changes report" },
  };

  for (const [slug, { stateKey, label }] of Object.entries(REPORT_DOWNLOAD_MAP)) {
    app.get(`/api/stack-modernization/analysis/:analysisId/download-${slug}`, async (req, res) => {
      try {
        const { analysisId } = req.params;
        const { stateStore } = await import("../stack-modernization");
        const state = stateStore.get(analysisId);

        if (!state) {
          return res.status(404).json({ error: "Analysis not found" });
        }

        const content = (state as any)[stateKey];
        if (!content) {
          return res.status(404).json({ error: `${label} not generated yet` });
        }

        res.setHeader("Content-Type", "text/markdown");
        res.setHeader("Content-Disposition", `attachment; filename="${slug}-${analysisId}.md"`);
        res.send(content);
      } catch (error) {
        console.error(`[Stack Modernization] ${label} download error:`, error);
        res.status(500).json({
          error: `Failed to download ${label}`,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });
  }

  /**
   * POST /api/stack-modernization/analysis/:analysisId/execute-planning
   * Execute planning phase (compatibility + risk analysis)
   */
  app.post("/api/stack-modernization/analysis/:analysisId/execute-planning", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      if (!state.userSelections || state.userSelections.length === 0) {
        return res.status(400).json({ 
          error: "No version selections found. Submit selections first." 
        });
      }

      if (!hasAtLeastOneUpgrade(state.userSelections)) {
        return res.status(400).json({
          error: "No upgrade needed. All selected versions match current. Change at least one target to proceed."
        });
      }
      
      // Send immediate response
      res.json({
        analysisId,
        message: "Planning phase initiated",
        status: "planning"
      });

      const { useLangGraphStackModernization } = await import("../stack-modernization/graph/config");

      // When only a subset of phases is selected, skip planning if not selected (legacy path). LangGraph path still invokes graph so nodes can skip and advance.
      const planningSelected = !state.selectedPhases?.length || state.selectedPhases.includes("planning" as any);

      // Execute planning asynchronously (LangGraph resume or legacy PlanningAgent)
      (async () => {
        try {
          // Log selections being passed to the graph on resume
          const resumeSelections = state.userSelections ?? [];
          console.log(`[execute-planning] Resuming graph for ${analysisId} with ${resumeSelections.length} selections:`);
          for (const sel of resumeSelections) {
            console.log(`  - ${sel.package}: ${sel.currentVersion} → ${sel.selectedVersion}`);
          }
          if (resumeSelections.length === 0) {
            console.error(`[execute-planning] ❌ CRITICAL: No userSelections in state! The LLM will not know target versions.`);
          }

          if (!planningSelected && !useLangGraphStackModernization()) {
            state.currentStage = "Planning skipped";
            state.progress = 65;
            state.status = "in_progress";
            stateStore.save(state);
            return;
          }

          state.status = "in_progress";
          state.currentStage = "planning";
          state.progress = 50;
          stateStore.save(state);

          // Use legacy agent path when graphRunVersion > 0 (user reset/changed versions)
          // because the LangGraph checkpoint is stale — resuming would skip planning.
          const isRerun = (state.graphRunVersion ?? 0) > 0;

          if (useLangGraphStackModernization() && !isRerun) {
            const { stackModGraph, graphConfig } = await import("../stack-modernization/graph");
            const { Command } = await import("@langchain/langgraph");
            await stackModGraph.invoke(new Command({ resume: state.userSelections }), graphConfig(analysisId));
            const updatedState = stateStore.get(analysisId);
            if (updatedState) {
              const beyondPlanning =
                updatedState.status === "completed" ||
                (updatedState.generatedTests?.length ?? 0) > 0 ||
                (updatedState.modifiedFiles?.length ?? 0) > 0 ||
                (updatedState.upgradeTasks?.length ?? 0) > 0;
              if (!beyondPlanning) {
                updatedState.status = "in_progress";
                updatedState.currentStage = updatedState.planMarkdown ? "planning_complete" : "planning";
                updatedState.progress = updatedState.riskReport ? 80 : 65;
              }
              stateStore.save(updatedState);
            }
          } else {
            if (isRerun) {
              console.log(`[execute-planning] Re-run detected (graphRunVersion=${state.graphRunVersion}), using legacy agent path`);
            }
            const { executePlanningAgent } = await import("../stack-modernization/agents/planning-agent");
            const updatedState = await executePlanningAgent(state);
            updatedState.status = "in_progress";
            updatedState.currentStage = "planning_complete";
            updatedState.progress = 65;
            stateStore.save(updatedState);
          }
        } catch (error) {
          console.error(`[Planning] ❌ Failed:`, error);
          state.status = "failed";
          state.errors.push(error instanceof Error ? error.message : "Planning failed");
          stateStore.save(state);
        }
      })();
      
    } catch (error) {
      console.error("[Planning] Error:", error);
      res.status(500).json({
        error: "Failed to initiate planning",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * POST /api/stack-modernization/analysis/:analysisId/download-packages
   * Download and replace vendor library files (runs vendorDownloadNode logic)
   */
  app.post("/api/stack-modernization/analysis/:analysisId/download-packages", async (req, res) => {
    try {
      const { analysisId } = req.params;
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      if (!state) return res.status(404).json({ error: "Analysis not found" });

      // Skip if packages phase not selected
      if (state.selectedPhases?.length && !state.selectedPhases.includes("packages" as any)) {
        state.currentStage = "packages_complete";
        state.status = "packages_complete" as any;
        stateStore.save(state);
        return res.json({ analysisId, message: "Packages phase skipped", status: "packages_complete", skipped: true });
      }

      // Send immediate response
      res.json({ analysisId, message: "Package download initiated", status: "downloading_packages" });

      // Execute vendor download asynchronously
      (async () => {
        try {
          state.status = "downloading_packages" as any;
          state.currentStage = "Downloading vendor libraries...";
          stateStore.save(state);

          const { downloadVendorDistFiles, rebuildConcatenatedBundles, buildSelectionLookup, fetchFileFromCdn } = await import("../stack-modernization/services/vendor-library-updater");
          const { getExtractedDir } = await import("../stack-modernization/services/temp-storage");

          const selections = state.userSelections ?? [];
          const vendorLibs = state.vendorLibraries ?? [];
          const bundleDets = (state.bundleDetections ?? []) as any[];
          const tempDir = state.tempDir;
          const downloadResults: {
            downloaded: Array<{ library: string; version: string; source: string; destination: string; sizeBytes: number; durationMs: number; type: "individual" | "bundle" | "created" }>;
            failed: Array<{ library: string; version: string; source: string; reason: string }>;
            skipped: Array<{ library: string; reason: string }>;
          } = { downloaded: [], failed: [], skipped: [] };

          if (selections.length > 0 && tempDir) {
            const extractDir = getExtractedDir(tempDir);
            const fsP = await import("fs/promises");
            const pathM = await import("path");

            // Phase 1: Download individual vendor files
            if (vendorLibs.length > 0) {
              state.currentStage = `Downloading vendor libraries (${vendorLibs.length} detected)...`;
              stateStore.save(state);
              try {
                const dlStart = Date.now();
                const downloadedFiles = await downloadVendorDistFiles(vendorLibs, selections, extractDir);
                for (const dvf of downloadedFiles) {
                  const cdnUrl = `https://cdn.jsdelivr.net/npm/${encodeURIComponent(dvf.library)}@${dvf.newVersion}/${dvf.cdnPath || "dist"}`;

                  downloadResults.downloaded.push({
                    library: dvf.library, version: dvf.newVersion, source: cdnUrl,
                    destination: dvf.projectPath, sizeBytes: dvf.content.length,
                    durationMs: Math.round((Date.now() - dlStart) / Math.max(downloadedFiles.length, 1)),
                    type: "individual",
                  });
                  // Add to modifiedFiles for ZIP
                  (state.modifiedFiles ??= []).push({
                    path: dvf.projectPath, content: dvf.content, originalContent: dvf.originalContent || "",
                    changes: [{ package: dvf.library, oldVersion: dvf.oldVersion || "unknown", newVersion: dvf.newVersion }],
                  } as any);
                  try { const fp = pathM.join(extractDir, dvf.projectPath); await fsP.mkdir(pathM.dirname(fp), { recursive: true }); await fsP.writeFile(fp, dvf.content, "utf-8"); } catch {}
                }
                console.log(`[download-packages] Phase 1: ${downloadedFiles.length} vendor files downloaded`);
              } catch (err: any) { console.error("[download-packages] Phase 1 FAILED:", err); downloadResults.failed.push({ library: "vendor-download", version: "", source: "jsDelivr", reason: err?.message || "Phase 1 failed" }); }
            }

            // Phase 2: Rebuild concatenated bundles
            // Re-scan ALL vendor CSS/JS files on disk to catch bundles missed during assessment
            // (e.g. base-library.css wasn't in bundleDetections because only 512 bytes were read)
            try {
              const { scanFileForBundledLibraries } = await import("../stack-modernization/services/vendor-library-updater");
              const existingPaths = new Set(bundleDets.map((b: any) => (b.filePath || "").replace(/\\/g, "/").toLowerCase()));
              console.log(`[download-packages] Re-scan: existing bundle paths: ${[...existingPaths].join(", ")}`);

              // Collect ALL vendor file paths from ALL vendors (including uiframework)
              const allVendorFiles: string[] = [];
              for (const v of vendorLibs) {
                for (const fp of (v.existingFiles || [])) {
                  allVendorFiles.push(fp);
                }
              }
              console.log(`[download-packages] Re-scan: checking ${allVendorFiles.length} vendor files across ${vendorLibs.length} vendors`);

              for (const fp of allVendorFiles) {
                const norm = fp.replace(/\\/g, "/");
                const ext = norm.substring(norm.lastIndexOf(".")).toLowerCase();
                if (ext !== ".css" && ext !== ".js") continue;
                if (existingPaths.has(norm.toLowerCase())) {
                  console.log(`[download-packages] Re-scan: SKIP (already in bundleDets): ${norm}`);
                  continue;
                }
                try {
                  const fullPath = pathM.join(extractDir, fp);
                  const fileContent = await fsP.readFile(fullPath, "utf-8");
                  console.log(`[download-packages] Re-scan: read ${norm} (${(fileContent.length / 1024).toFixed(1)}KB)`);
                  if (fileContent.length < 100) continue;
                  const det = scanFileForBundledLibraries(norm, fileContent);
                  if (det.libraries.length > 0) {
                    console.log(`[download-packages] Re-scan FOUND bundle: ${norm} with ${det.libraries.length} libraries: ${det.libraries.map(l => `${l.npmPackage}@${l.version}`).join(", ")}`);
                    bundleDets.push(det);
                  } else {
                    console.log(`[download-packages] Re-scan: ${norm} — no version headers found`);
                  }
                } catch (readErr: any) {
                  console.warn(`[download-packages] Re-scan: could not read ${fp}: ${readErr?.message}`);
                }
              }
            } catch (err) { console.warn("[download-packages] Re-scan for CSS bundles failed:", err); }

            const bundles = bundleDets.filter((b: any) => b.libraries?.length >= 1);
            if (bundles.length > 0) {
              state.currentStage = `Rebuilding ${bundles.length} bundled library files...`;
              stateStore.save(state);
              try {
                const bStart = Date.now();
                const rebuiltFiles = await rebuildConcatenatedBundles(bundles, selections, extractDir);
                for (const rf of rebuiltFiles) {
                  downloadResults.downloaded.push({
                    library: rf.library, version: rf.newVersion,
                    source: `https://cdn.jsdelivr.net/npm/${encodeURIComponent(rf.library.split(" + ")[0] || rf.library)}@${rf.newVersion.split(",")[0]?.trim()?.split("@").pop() || rf.newVersion}/${rf.cdnPath || "dist"}`,
                    destination: rf.projectPath, sizeBytes: rf.content.length,
                    durationMs: Math.round((Date.now() - bStart) / Math.max(rebuiltFiles.length, 1)),
                    type: "bundle",
                  });
                  (state.modifiedFiles ??= []).push({
                    path: rf.projectPath, content: rf.content, originalContent: rf.originalContent || "",
                    changes: [{ package: rf.library, oldVersion: rf.oldVersion || "", newVersion: rf.newVersion }],
                  } as any);
                  try { const fp = pathM.join(extractDir, rf.projectPath); await fsP.mkdir(pathM.dirname(fp), { recursive: true }); await fsP.writeFile(fp, rf.content, "utf-8"); } catch {}
                }
                console.log(`[download-packages] Phase 2: ${rebuiltFiles.length} bundles rebuilt`);
              } catch (err: any) { console.error("[download-packages] Phase 2 FAILED:", err); downloadResults.failed.push({ library: "bundle-rebuild", version: "", source: "jsDelivr", reason: err?.message || "Phase 2 failed" }); }
            }

            // Phase 3: Resolve missing lib paths from views
            try {
              const findSelection = buildSelectionLookup(selections);
              const viewFiles = (state.extractedFiles ?? []).filter((f: any) => /\.(cshtml|html|razor)$/i.test(f.relativePath));
              const libRefs = new Set<string>();
              for (const vf of viewFiles) { let m; const re = /~\/lib\/([^"'\s]+)/gi; while ((m = re.exec(vf.content || "")) !== null) libRefs.add(m[1]); }
              let created = 0;
              for (const ref of libRefs) {
                const fp = pathM.join(extractDir, `wwwroot/lib/${ref}`);
                try { await fsP.access(fp); continue; } catch {}
                const libName = ref.split("/")[0]; const sel = findSelection(libName); if (!sel) continue;
                const ext = ref.substring(ref.lastIndexOf(".")).toLowerCase(); if (ext !== ".js" && ext !== ".css") continue;
                const cdnPath = ref.substring(ref.indexOf("/") + 1);
                try {
                  // Use the npm package name from DIR_TO_NPM, not the display name from selections
                  const { resolveNpmName, PACKAGE_PRIMARY_DIST_PUBLIC } = await import("../stack-modernization/services/vendor-library-updater");
                  const npmName = resolveNpmName(libName);
                  state.currentStage = `Downloading ${npmName}@${sel.selectedVersion}/${cdnPath}...`;
                  stateStore.save(state);

                  let content: string;
                  let actualCdnPath = cdnPath;
                  try {
                    // Try the direct path first (e.g., "bootstrap-datepicker.css")
                    content = await fetchFileFromCdn(npmName, sel.selectedVersion, cdnPath);
                  } catch {
                    // Direct path failed — try PACKAGE_PRIMARY_DIST mapping
                    // e.g., "bootstrap-datepicker.css" → "dist/css/bootstrap-datepicker.min.css"
                    const primaryDist = PACKAGE_PRIMARY_DIST_PUBLIC[npmName];
                    const fileExt = cdnPath.substring(cdnPath.lastIndexOf(".")).toLowerCase();
                    const distPath = (fileExt === ".js" || fileExt === ".mjs") ? primaryDist?.js : (fileExt === ".css") ? primaryDist?.css : undefined;
                    if (distPath) {
                      content = await fetchFileFromCdn(npmName, sel.selectedVersion, distPath);
                      actualCdnPath = distPath;
                    } else {
                      throw new Error(`No PACKAGE_PRIMARY_DIST mapping for ${npmName} (${fileExt})`);
                    }
                  }

                  await fsP.mkdir(pathM.dirname(fp), { recursive: true }); await fsP.writeFile(fp, content, "utf-8");
                  downloadResults.downloaded.push({
                    library: npmName, version: sel.selectedVersion,
                    source: `https://cdn.jsdelivr.net/npm/${encodeURIComponent(npmName)}@${sel.selectedVersion}/${actualCdnPath}`,
                    destination: `wwwroot/lib/${ref}`, sizeBytes: content.length, durationMs: 0,
                    type: "created",
                  });
                  created++;
                } catch (dlErr: any) {
                  const npmNameFallback = libName.toLowerCase().replace(/\s+/g, "-");
                  downloadResults.failed.push({
                    library: sel.package, version: sel.selectedVersion,
                    source: `https://cdn.jsdelivr.net/npm/${encodeURIComponent(npmNameFallback)}@${sel.selectedVersion}/${cdnPath}`,
                    reason: dlErr?.message || "Download failed",
                  });
                }
              }
              if (created > 0) console.log(`[download-packages] Phase 3: ${created} missing files created`);
            } catch (err) { console.error("[download-packages] Phase 3 FAILED:", err); }
          }

          // ── Phase 4: Generate CSS migration rules from downloaded package diffs ──
          try {
            state.currentStage = "Analyzing CSS changes between old and new versions...";
            stateStore.save(state);

            const fsP = await import("fs/promises");
            const pathM = await import("path");
            const { getExtractedDir } = await import("../stack-modernization/services/temp-storage");
            const extractDir = getExtractedDir(state.tempDir);
            const { generateCssMigrationRules, filterRulesByUsage } = await import("../stack-modernization/services/css-class-differ");
            const allRules: Array<{ oldClass: string; newClass: string; library: string; confidence: "high" | "medium" | "low" }> = [];

            // For each downloaded CSS file that has both old and new content, generate diff rules
            for (const d of downloadResults.downloaded) {
              if (!d.destination.endsWith(".css")) continue;
              // Read new content from disk
              try {
                const newContent = await fsP.readFile(pathM.join(extractDir, d.destination), "utf-8");
                // Read old content from original extracted file
                const oldFile = (state.extractedFiles ?? []).find(
                  f => f.relativePath?.replace(/\\/g, "/").endsWith(d.destination.replace(/\\/g, "/"))
                );
                if (oldFile?.content && newContent) {
                  const rules = generateCssMigrationRules(oldFile.content, newContent, d.library);
                  allRules.push(...rules);
                }
              } catch { /* skip files that can't be read */ }
            }

            // Also check rebuilt bundle files (base-library.css)
            for (const d of downloadResults.downloaded) {
              if (d.type !== "bundle" || !d.destination.endsWith(".css")) continue;
              try {
                const newContent = await fsP.readFile(pathM.join(extractDir, d.destination), "utf-8");
                // Find original file in extractedFiles
                const shortPath = d.destination.split("/").slice(-2).join("/"); // e.g., "uiframework/base-library.css"
                const oldFile = (state.extractedFiles ?? []).find(
                  f => f.relativePath?.replace(/\\/g, "/").includes(shortPath)
                );
                if (oldFile?.content && newContent) {
                  const rules = generateCssMigrationRules(oldFile.content, newContent, d.library);
                  allRules.push(...rules);
                }
              } catch { /* skip */ }
            }

            // Filter rules to only include ones actually used in the codebase
            if (allRules.length > 0) {
              const viewContents = (state.extractedFiles ?? [])
                .filter(f => /\.(cshtml|html|razor|htm|css|js)$/i.test(f.relativePath ?? ""))
                .map(f => f.content || "");
              const filtered = filterRulesByUsage(allRules, viewContents);

              // Deduplicate by oldClass
              const seen = new Set<string>();
              state.cssMigrationRules = filtered.filter(r => {
                if (seen.has(r.oldClass)) return false;
                seen.add(r.oldClass);
                return true;
              });

              console.log(`[download-packages] Phase 4: Generated ${state.cssMigrationRules.length} CSS migration rules from package diffs`);
              if (state.cssMigrationRules.length > 0) {
                console.log(`[download-packages] Sample rules: ${state.cssMigrationRules.slice(0, 10).map(r => `${r.oldClass}→${r.newClass}`).join(", ")}`);
              }
            }
          } catch (err) {
            console.error("[download-packages] Phase 4 (CSS diff) FAILED:", err);
          }

          state.vendorDownloadResults = downloadResults;
          state.status = "packages_complete" as any;
          const totalSize = downloadResults.downloaded.reduce((sum, d) => sum + d.sizeBytes, 0);
          state.currentStage = `Vendor download complete: ${downloadResults.downloaded.length} downloaded (${(totalSize / 1024).toFixed(1)}KB), ${downloadResults.failed.length} failed, ${(state.cssMigrationRules ?? []).length} CSS rules generated`;
          stateStore.save(state);
          stateStore.saveToDb(analysisId).catch(() => {});
          stateStore.savePhaseToDb(analysisId, "packages", "completed", {
            vendorDownloadResults: downloadResults,
            cssMigrationRules: state.cssMigrationRules,
          }).catch(() => {});
          console.log(`[download-packages] ✅ COMPLETE — Downloaded: ${downloadResults.downloaded.length} (${(totalSize / 1024).toFixed(1)}KB), Failed: ${downloadResults.failed.length}`);
        } catch (error) {
          console.error("[download-packages] ❌ Failed:", error);
          state.status = "failed" as any;
          state.errors = [...(state.errors || []), error instanceof Error ? error.message : "Package download failed"];
          stateStore.save(state);
          stateStore.saveToDb(analysisId).catch(() => {});
        }
      })();
    } catch (error) {
      console.error("[download-packages] Error:", error);
      res.status(500).json({ error: "Failed to download packages" });
    }
  });

  /**
   * POST /api/stack-modernization/analysis/:analysisId/generate-tasks
   * Generate task breakdown
   */
  app.post("/api/stack-modernization/analysis/:analysisId/generate-tasks", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      if (state.selectedPhases?.length && !state.selectedPhases.includes("tasks" as any)) {
        state.currentStage = "tasks_ready";
        state.progress = 75;
        stateStore.save(state);
        return res.json({ analysisId, message: "Task phase skipped (not selected)", status: "tasks_ready", skipped: true });
      }

      if (!state.planMarkdown) {
        return res.status(400).json({ 
          error: "Plan not ready. Complete planning phase first." 
        });
      }
      
      // Send immediate response
      res.json({
        analysisId,
        message: "Task generation initiated",
        status: "task_planning"
      });
      
      // Execute task planning asynchronously
      (async () => {
        try {
          const { executeTaskPlannerAgent } = await import("../stack-modernization/agents/task-planner-agent");
          
          state.status = "in_progress";
          state.currentStage = "task_planning";
          state.progress = 70;
          stateStore.save(state);
          
          const updatedState = await executeTaskPlannerAgent(state);
          
          updatedState.status = "in_progress";
          updatedState.currentStage = "tasks_ready";
          updatedState.progress = 75;
          stateStore.save(updatedState);

          stateStore.savePhaseToDb(analysisId, "task_generation", "completed", {
            upgradeTasks: updatedState.upgradeTasks,
          }, updatedState.tasksMarkdown).catch(() => {});
          stateStore.saveToDb(analysisId).catch(() => {});

        } catch (error) {
          console.error(`[Tasks] ❌ Failed:`, error);
          state.status = "failed";
          state.errors.push(error instanceof Error ? error.message : "Task generation failed");
          stateStore.save(state);
          stateStore.saveToDb(analysisId).catch(() => {});
        }
      })();
      
    } catch (error) {
      console.error("[Tasks] Error:", error);
      res.status(500).json({
        error: "Failed to generate tasks",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * POST /api/stack-modernization/analysis/:analysisId/execute-tasks
   * Execute all tasks (code upgrade)
   */
  app.post("/api/stack-modernization/analysis/:analysisId/execute-tasks", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      if (state.selectedPhases?.length && !state.selectedPhases.includes("execution" as any)) {
        state.currentStage = "execution_complete";
        state.progress = 90;
        stateStore.save(state);
        return res.json({ analysisId, message: "Execution phase skipped (not selected)", status: "execution_complete", skipped: true });
      }

      if (!state.upgradeTasks || state.upgradeTasks.length === 0) {
        return res.status(400).json({ 
          error: "No tasks found. Generate tasks first." 
        });
      }
      
      // Send immediate response
      res.json({
        analysisId,
        message: "Task execution initiated",
        status: "executing"
      });
      
      // Execute tasks asynchronously
      (async () => {
        try {
          const { executeCodeUpgradeAgent } = await import("../stack-modernization/agents/code-upgrade-agent");
          
          state.status = "in_progress";
          state.currentStage = "executing";
          state.progress = 80;
          stateStore.save(state);
          
          const onProgress = (files: Array<{ path: string; content: string; originalContent: string }>) => {
            const s = stateStore.get(analysisId);
            if (s) {
              s.modifiedFiles = files.map((f) => ({ path: f.path, content: f.content, originalContent: f.originalContent }));
              stateStore.save(s);
            }
          };
          const updatedState = await executeCodeUpgradeAgent(state, state.userSelections || [], { onProgress });
          
          // Extract modifiedFiles from codeUpgrade result
          const codeUpgradeResult = (updatedState as any).codeUpgrade;
          if (codeUpgradeResult && codeUpgradeResult.modifiedFiles) {
            updatedState.modifiedFiles = codeUpgradeResult.modifiedFiles;
          }
          
          // Run completeness verification on the upgraded code
          try {
            updatedState.currentStage = "Verifying upgrade completeness...";
            stateStore.save(updatedState);

            const { verifyUpgradeCompleteness } = await import("../stack-modernization/services/completeness-verifier");
            const report = verifyUpgradeCompleteness(
              updatedState.modifiedFiles ?? [],
              updatedState.extractedFiles ?? [],
              updatedState.userSelections ?? [],
              updatedState.vendorLibraries,
              updatedState.apiUsageImpactReport,
            );
            updatedState.completenessReport = report;
            updatedState.completenessReportMarkdown = report.markdown;
            console.log(`[Execution] Completeness: ${report.overallScore}% — ${report.passed}/${report.totalChecks} passed, ${report.failed} errors`);
          } catch (compErr) {
            console.warn("[Execution] Completeness verification failed (non-fatal):", compErr instanceof Error ? compErr.message : compErr);
          }

          // Generate comprehensive migration report
          try {
            const { generateMigrationReport } = await import("../stack-modernization/services/migration-report-generator");
            updatedState.migrationReportMarkdown = generateMigrationReport(updatedState);
            console.log(`[Execution] Migration report generated (${updatedState.migrationReportMarkdown.length} chars)`);
          } catch (reportErr) {
            console.warn("[Execution] Migration report generation failed (non-fatal):", reportErr instanceof Error ? reportErr.message : reportErr);
          }

          updatedState.status = "completed";
          updatedState.currentStage = "execution_complete";
          updatedState.progress = 90;
          stateStore.save(updatedState);

          stateStore.savePhaseToDb(analysisId, "code_upgrade", "completed", {
            taskExecutionResults: updatedState.taskExecutionResults,
            modifiedFiles: updatedState.modifiedFiles ?? [],
            codeUpgradeSummary: updatedState.codeUpgrade?.summary,
            codeUpgradeErrors: updatedState.codeUpgrade?.errors,
            impactReport: updatedState.impactReport,
            changeSummaries: (updatedState as any).changeSummaries,
            migrationAllowedRenames: updatedState.migrationAllowedRenames,
          }, updatedState.migrationReportMarkdown || undefined).catch(() => {});
          stateStore.saveToDb(analysisId).catch(() => {});

        } catch (error) {
          console.error(`[Execution] ❌ Failed:`, error);
          state.status = "failed";
          state.errors.push(error instanceof Error ? error.message : "Execution failed");
          stateStore.save(state);
          stateStore.saveToDb(analysisId).catch(() => {});
        }
      })();
      
    } catch (error) {
      console.error("[Execution] Error:", error);
      res.status(500).json({
        error: "Failed to execute tasks",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * POST /api/stack-modernization/analysis/:analysisId/generate-tests
   * Generate unit tests
   */
  app.post("/api/stack-modernization/analysis/:analysisId/generate-tests", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      if (state.selectedPhases?.length && !state.selectedPhases.includes("tests" as any)) {
        state.currentStage = "tests_generated";
        state.status = "completed";
        state.progress = 100;
        stateStore.save(state);
        return res.json({ analysisId, message: "Test phase skipped (not selected)", status: "tests_generated", skipped: true });
      }

      const modifiedFilesForTests = state.modifiedFiles ?? (state as any).codeUpgrade?.modifiedFiles ?? [];
      const hasExtractedFiles = (state.extractedFiles?.length ?? 0) > 0;
      if (!modifiedFilesForTests.length && !hasExtractedFiles) {
        return res.status(400).json({ 
          error: "No code files found. Upload files first." 
        });
      }
      
      // When execution was skipped, use extractedFiles as the source for test generation
      if (!modifiedFilesForTests.length && hasExtractedFiles) {
        state.modifiedFiles = state.extractedFiles!.map(f => ({
          path: f.relativePath,
          content: f.content,
          originalContent: f.content,
        }));
        stateStore.save(state);
      }
      
      // Send immediate response
      res.json({
        analysisId,
        message: "Test generation initiated",
        status: "generating_tests"
      });
      
      // Ensure state.modifiedFiles is set for TestGenerationAgent (it reads state.modifiedFiles)
      if (!state.modifiedFiles?.length && (state as any).codeUpgrade?.modifiedFiles?.length) {
        state.modifiedFiles = (state as any).codeUpgrade.modifiedFiles;
        stateStore.save(state);
      }
      
      // Execute test generation asynchronously
      (async () => {
        try {
          const { executeTestGenerationAgent } = await import("../stack-modernization/agents/test-generation-agent");
          
          state.status = "in_progress";
          state.currentStage = "generating_tests";
          state.progress = 95;
          stateStore.save(state);
          
          const updatedState = await executeTestGenerationAgent(state);
          
          // Regenerate migration report to include test generation results
          try {
            const { generateMigrationReport } = await import("../stack-modernization/services/migration-report-generator");
            updatedState.migrationReportMarkdown = generateMigrationReport(updatedState);
            console.log(`[Tests] Migration report regenerated with test data (${updatedState.migrationReportMarkdown.length} chars)`);
          } catch (reportErr) {
            console.warn("[Tests] Migration report regeneration failed (non-fatal):", reportErr instanceof Error ? reportErr.message : reportErr);
          }

          const finalProgress = computeProgressFromSelectedPhases(updatedState);
          updatedState.status = "completed";
          updatedState.currentStage = "tests_generated";
          updatedState.progress = finalProgress;
          stateStore.save(updatedState);

          const testReportMd = [
            updatedState.testResultsMarkdown ?? "",
            updatedState.confidenceReportMarkdown ? "---CONFIDENCE---\n" + updatedState.confidenceReportMarkdown : "",
          ].filter(Boolean).join("\n");
          stateStore.savePhaseToDb(analysisId, "test_generation", "completed", {
            generatedTests: (updatedState.generatedTests ?? []).map((t: any) => ({
              filePath: t.filePath, testFramework: t.testFramework, coverageTarget: t.coverageTarget,
            })),
          }, testReportMd || undefined).catch(() => {});
          stateStore.saveToDb(analysisId).catch(() => {});

        } catch (error) {
          console.error(`[Tests] ❌ Failed:`, error);
          state.status = "failed";
          state.errors.push(error instanceof Error ? error.message : "Test generation failed");
          stateStore.save(state);
          stateStore.saveToDb(analysisId).catch(() => {});
        }
      })();
      
    } catch (error) {
      console.error("[Tests] Error:", error);
      res.status(500).json({
        error: "Failed to generate tests",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * POST /api/stack-modernization/analysis/:analysisId/complete
   * Mark workflow complete and persist progress (e.g. when user clicks "Done" on tests phase).
   * Recomputes progress from selected phases and saves to DB so list shows 100% when all selected phases are done.
   */
  app.post("/api/stack-modernization/analysis/:analysisId/complete", async (req: Request, res: Response) => {
    try {
      const { analysisId } = req.params;
      const { stateStore } = await import("../stack-modernization");
      let state = stateStore.get(analysisId) ?? await stateStore.loadFromDb(analysisId);
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      stateStore.save(state);
      const progress = computeProgressFromSelectedPhases(state);
      state.progress = progress;
      state.currentStage = state.currentStage || "tests_generated";
      if (progress >= 100) {
        state.status = "completed";
        state.completedAt = state.completedAt ?? new Date();
      }

      // Generate migration report if not already present
      if (!state.migrationReportMarkdown && (state.modifiedFiles?.length ?? 0) > 0) {
        try {
          const { generateMigrationReport } = await import("../stack-modernization/services/migration-report-generator");
          state.migrationReportMarkdown = generateMigrationReport(state);
          console.log(`[Complete] Migration report generated on completion (${state.migrationReportMarkdown.length} chars)`);
        } catch (reportErr) {
          console.warn("[Complete] Migration report generation failed (non-fatal):", reportErr instanceof Error ? reportErr.message : reportErr);
        }
      }

      stateStore.save(state);
      await stateStore.saveToDb(analysisId);
      return res.json({ analysisId, progress, status: state.status, message: "Progress saved." });
    } catch (error) {
      console.error("[Complete] Error:", error);
      res.status(500).json({
        error: "Failed to save progress",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /api/stack-modernization/analysis/:analysisId/run-validation
   * Start Run & Validate (code execution in container/local). Call this when user clicks "Execute validation".
   */
  app.post("/api/stack-modernization/analysis/:analysisId/run-validation", async (req, res) => {
    try {
      if (!stackModConfig.validationEnabled) {
        return res.status(403).json({
          error: "Validation is disabled",
          code: "VALIDATION_DISABLED",
          message: "Run & Validate is not configured (container/execution not available).",
        });
      }
      const { analysisId } = req.params;
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      // Pre-reset validationRun to "running" BEFORE responding so the next
      // frontend poll sees the correct status (prevents race with stale data).
      (state as any).validationRun = {
        runId: `validate-${analysisId}`,
        status: "running",
        lastLogs: "",
      };
      (state as any).currentRunDirectory = undefined;
      stateStore.save(state);

      res.json({ analysisId, message: "Validation started", status: "validating" });
      (async () => {
        try {
          const { runAndValidateNode } = await import("../stack-modernization/graph/nodes");
          await runAndValidateNode({ analysisId });
        } catch (err) {
          console.error("[RunValidation] Error:", err);
          try {
            const { stateStore: ss } = await import("../stack-modernization");
            const s = ss.get(analysisId);
            if (s) {
              (s as any).validationRun = {
                runId: (s as any).validationRun?.runId ?? "",
                status: "failed",
                lastLogs: ((s as any).validationRun?.lastLogs ?? "") +
                  `\n[RunValidation] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
                exitCode: 1,
              };
              ss.save(s);
            }
          } catch { /* last resort: state write failed too */ }
        }
      })();
    } catch (error) {
      console.error("[RunValidation] Error:", error);
      res.status(500).json({
        error: "Failed to start validation",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * POST /api/stack-modernization/analysis/:analysisId/build-with-fix-loop
   * Intelligent build: auto-detect entry point, build, parse errors, call fix agent, retry.
   * Returns structured result with success flag, attempts, and logs.
   */
  app.post("/api/stack-modernization/analysis/:analysisId/build-with-fix-loop", async (req, res) => {
    try {
      const { analysisId } = req.params;
      const maxAttempts = Math.min(req.body?.maxAttempts ?? 5, 15);

      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      const { createContainerExecutionAdapter } = await import("../stack-modernization/services/container-execution-adapter");
      const { codeExecutionService } = await import("../code-execution");
      const { resolveDotnetTargets, getDotnetRunCwd } = await import("../stack-modernization/services/dotnet-project-resolver");
      const { analyzeTerminalOutput } = await import("../container-orchestration/agents/terminal-analysis");
      const { prepareProjectDir } = await import("../stack-modernization/services/prepare-project-dir");

      const ctx = createContainerExecutionAdapter(analysisId);
      const codeExecution = codeExecutionService;
      const nodePath = await import("path");
      const nodeFs = await import("fs/promises");

      const projectPath = await ctx.getProjectPath();
      const stack = await ctx.getStack();

      // Auto-detect entry point
      let buildCommand = "";
      let testCommand = "";
      let cwd = projectPath;

      if (stack === "dotnet") {
        const targets = await resolveDotnetTargets(projectPath);
        if (targets.sln) {
          cwd = nodePath.join(projectPath, targets.slnDir || "");
          buildCommand = `dotnet build ${nodePath.basename(targets.sln)}`;
          testCommand = `dotnet test ${nodePath.basename(targets.sln)} --no-build`;
        } else if (targets.csprojForRun) {
          cwd = nodePath.join(projectPath, targets.csprojDir || "");
          buildCommand = `dotnet build ${nodePath.basename(targets.csprojForRun)}`;
          testCommand = `dotnet test ${nodePath.basename(targets.csprojForRun)} --no-build`;
        } else {
          buildCommand = "dotnet build";
          testCommand = "dotnet test";
        }
      } else if (stack === "python") {
        const candidates = ["manage.py", "app.py", "main.py", "wsgi.py", "asgi.py"];
        let entryFile = "";
        for (const c of candidates) {
          try {
            await nodeFs.access(nodePath.join(projectPath, c));
            entryFile = c;
            break;
          } catch { /* skip */ }
        }
        buildCommand = "pip install -r requirements.txt 2>/dev/null; pip install -r requirements-test.txt 2>/dev/null; python -m py_compile " + (entryFile || "*.py");
        testCommand = "python -m pytest --tb=short -q 2>&1 || python -m unittest discover -v 2>&1";
      }

      let allLogs = "";
      let lastSuccess = false;
      let attempt = 0;
      const fixesApplied: string[] = [];

      for (attempt = 1; attempt <= maxAttempts; attempt++) {
        allLogs += `\n── Build Attempt ${attempt}/${maxAttempts} ──\n`;

        // Build
        const buildResult = await codeExecution.runCommand(
          { runId: `build-${analysisId}-${attempt}`, stack, projectPath, runtimeVersion: undefined },
          { command: buildCommand, cwd: cwd !== projectPath ? nodePath.relative(projectPath, cwd) : undefined, timeoutMs: 120000 }
        );
        allLogs += `$ ${buildCommand}\n${buildResult.stdout}\n${buildResult.stderr}\n`;

        if (buildResult.exitCode === 0) {
          // Build succeeded, run tests too
          allLogs += `\n── Running tests ──\n`;
          const testResult = await codeExecution.runCommand(
            { runId: `test-${analysisId}-${attempt}`, stack, projectPath, runtimeVersion: undefined },
            { command: testCommand, cwd: cwd !== projectPath ? nodePath.relative(projectPath, cwd) : undefined, timeoutMs: 180000 }
          );
          allLogs += `$ ${testCommand}\n${testResult.stdout}\n${testResult.stderr}\n`;

          const analysis = analyzeTerminalOutput(stack, testResult.exitCode, testResult.stdout, testResult.stderr);
          if (analysis.passed || testResult.exitCode === 0) {
            lastSuccess = true;
            allLogs += `\nBuild and tests passed.\n`;
            break;
          }
          allLogs += `\nTests failed. ${analysis.parsedIssues.length} issue(s) detected.\n`;

          // Ask fix agent
          if (attempt < maxAttempts && analysis.parsedIssues.length > 0) {
            const pathsToRead = [...new Set(analysis.parsedIssues.map(i => i.file).filter(Boolean))] as string[];
            const fileContents = await ctx.getFileContents(pathsToRead);
            const edits = await ctx.requestFixes(analysis.parsedIssues, testResult.stdout, testResult.stderr, fileContents);
            if (edits.length > 0) {
              await ctx.applyEdits(edits);
              fixesApplied.push(...edits.map(e => e.filePath));
              allLogs += `Applied ${edits.length} fix(es).\n`;
            }
          }
        } else {
          // Build failed
          const analysis = analyzeTerminalOutput(stack, buildResult.exitCode, buildResult.stdout, buildResult.stderr);
          allLogs += `Build failed. ${analysis.parsedIssues.length} issue(s) detected.\n`;

          if (attempt < maxAttempts && analysis.parsedIssues.length > 0) {
            const pathsToRead = [...new Set(analysis.parsedIssues.map(i => i.file).filter(Boolean))] as string[];
            const fileContents = await ctx.getFileContents(pathsToRead);
            const edits = await ctx.requestFixes(analysis.parsedIssues, buildResult.stdout, buildResult.stderr, fileContents);
            if (edits.length > 0) {
              await ctx.applyEdits(edits);
              fixesApplied.push(...edits.map(e => e.filePath));
              allLogs += `Applied ${edits.length} fix(es).\n`;
            }
          }
        }
      }

      // Store build logs into validationRun for UI display
      const stateNow = stateStore.get(analysisId);
      if (stateNow) {
        (stateNow as any).validationRun = {
          ...((stateNow as any).validationRun ?? {}),
          buildLogs: allLogs,
          buildSuccess: lastSuccess,
          buildAttempts: attempt,
        };
        stateStore.save(stateNow);
      }

      res.json({
        success: lastSuccess,
        attempts: Math.min(attempt, maxAttempts),
        stdout: allLogs,
        fixesApplied: [...new Set(fixesApplied)],
      });
    } catch (error) {
      console.error("[BuildWithFixLoop] Error:", error);
      res.status(500).json({
        error: "Build with fix loop failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/stack-modernization/analysis/:analysisId/download-upgrade
   * Returns the FULL input repository with upgraded files replaced (if any),
   * generated tests, and all generated reports. Works even when no code upgrade
   * was performed (e.g. tests-only flow).
   */
  app.get("/api/stack-modernization/analysis/:analysisId/download-upgrade", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      const { stateStore } = await import("../stack-modernization");
      const JSZip = (await import("jszip")).default;
      
      let state = stateStore.get(analysisId);

      // If in-memory state is missing or has no extractedFiles, try restoring from DB
      if (!state || !state.extractedFiles?.length) {
        console.log(`[Download] In-memory state ${!state ? 'missing' : 'has no extractedFiles'}, trying DB restore...`);
        const dbState = await stateStore.loadFromDb(analysisId);
        if (dbState) {
          // Merge DB state with in-memory state (in-memory takes precedence for modifiedFiles)
          if (state && state.modifiedFiles?.length) {
            dbState.modifiedFiles = state.modifiedFiles;
          }
          state = dbState;
          stateStore.save(state);
          console.log(`[Download] Restored from DB: extractedFiles=${state.extractedFiles?.length ?? 0} modifiedFiles=${state.modifiedFiles?.length ?? 0}`);
        }
      }

      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      if (!state.extractedFiles || state.extractedFiles.length === 0) {
        return res.status(400).json({ error: "No repository files found. Re-upload the project and run the upgrade again." });
      }

      const modifiedFilesForDownload = state.modifiedFiles ?? (state as any).codeUpgrade?.modifiedFiles ?? [];


      const upgradedMap = new Map<string, string>();
      const upgradedLowerMap = new Map<string, string>(); // case-insensitive lookup
      for (const file of modifiedFilesForDownload) {
        const filePath = (file.path || file.filePath || "").replace(/\\/g, "/");
        const content = file.content || file.modifiedContent;
        if (filePath && content) {
          upgradedMap.set(filePath, content);
          upgradedLowerMap.set(filePath.toLowerCase(), content);
          // Also index by basename for cross-prefix matching
          const basename = filePath.split("/").pop()?.toLowerCase();
          if (basename && !upgradedLowerMap.has(basename)) {
            upgradedLowerMap.set(basename, content);
          }
        }
      }
      if (upgradedMap.size > 0) {
        console.log(`[Download] upgradedMap has ${upgradedMap.size} entries. First 10 keys: ${[...upgradedMap.keys()].slice(0, 10).join(", ")}`);
      } else {
        console.warn(`[Download] WARNING: upgradedMap is EMPTY — no modified content will be overlaid. modifiedFilesForDownload had ${modifiedFilesForDownload.length} entries.`);
        if (modifiedFilesForDownload.length > 0) {
          console.warn(`[Download] Sample modified file: path="${modifiedFilesForDownload[0].path || modifiedFilesForDownload[0].filePath || "MISSING"}" hasContent=${!!(modifiedFilesForDownload[0].content || modifiedFilesForDownload[0].modifiedContent)}`);
        }
      }
      
      const totalFiles = state.extractedFiles?.length || 0;
      const allPaths = (state.extractedFiles || []).map((f: any) => (f.relativePath || "").replace(/\\/g, "/"));
      const commonPrefix = getCommonPathPrefix(allPaths);
      const zipRootName = commonPrefix ? commonPrefix.replace(/\/$/, "").split("/")[0] || "upgraded-project" : "upgraded-project";
      const usePrefix = commonPrefix && zipRootName && allPaths.every((p: string) => p === zipRootName || p.startsWith(zipRootName + "/"));

      
      const zip = new JSZip();
      const projectFolder = zip.folder(zipRootName);
      let addedCount = 0;
      let upgradedCount = 0;
      
      function zipPath(relativePath: string): string {
        if (!usePrefix || !relativePath) return relativePath;
        const normalized = relativePath.replace(/\\/g, "/");
        if (normalized === zipRootName) return "";
        if (normalized.startsWith(zipRootName + "/")) return normalized.slice(zipRootName.length + 1);
        return normalized;
      }
      
      if (projectFolder) {
        // Track all file paths added to the zip to detect new files from upgrade
        const originalPathsSet = new Set<string>();

        // ═══════════════════════════════════════════════════════════════
        // Walk the DISK extraction directory to include ALL files
        // (binary, vendor/lib, minified, images, fonts — everything).
        // This fixes the bug where extractedFiles (filtered in-memory list)
        // was missing vendor libs, images, .min.js, .min.css, etc.
        // ═══════════════════════════════════════════════════════════════
        let usedDiskWalk = false;
        const SKIP_ZIP_DIRS = new Set([".git", ".vs"]);

        if (state.tempDir) {
          try {
            const { getExtractedDir } = await import("../stack-modernization/services/temp-storage");
            const extractDir = getExtractedDir(state.tempDir);
            // Verify the directory exists before walking
            await fs.access(extractDir);

            async function walkDirForZip(dir: string, prefix: string) {
              let entries;
              try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
              for (const entry of entries) {
                const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  if (SKIP_ZIP_DIRS.has(entry.name)) continue;
                  await walkDirForZip(fullPath, relPath);
                } else if (entry.isFile()) {
                  const entryPath = zipPath(relPath);
                  if (!entryPath) continue;
                  originalPathsSet.add(relPath);

                  // Check if we have upgraded content for this file
                  let upgradedContent = upgradedMap.get(relPath);
                  if (!upgradedContent) {
                    upgradedContent = upgradedLowerMap.get(relPath.toLowerCase());
                  }

                  if (upgradedContent) {
                    projectFolder!.file(entryPath, upgradedContent);
                    upgradedCount++;
                  } else {
                    // Read original file as Buffer (handles both text and binary correctly)
                    try {
                      const buf = await fs.readFile(fullPath);
                      projectFolder!.file(entryPath, buf);
                    } catch (readErr) {
                      console.warn(`[Download] Could not read ${relPath}:`, readErr instanceof Error ? readErr.message : readErr);
                    }
                  }
                  addedCount++;
                }
              }
            }

            await walkDirForZip(extractDir, "");
            usedDiskWalk = true;
            console.log(`[Download] Disk walk completed: ${addedCount} files from disk, ${upgradedCount} overlaid with upgraded content`);
          } catch (diskErr) {
            console.warn(`[Download] Disk walk failed, falling back to extractedFiles:`, diskErr instanceof Error ? diskErr.message : diskErr);
          }
        }

        // Fallback: if disk walk failed/unavailable, use the in-memory extractedFiles (filtered, may be incomplete)
        if (!usedDiskWalk) {
          console.log(`[Download] Using extractedFiles fallback (${(state.extractedFiles || []).length} files)`);
          for (const file of (state.extractedFiles || [])) {
            const filePath = (file.relativePath || "").replace(/\\/g, "/");
            if (!filePath) continue;
            originalPathsSet.add(filePath);
            const entryPath = zipPath(filePath);
            if (entryPath === "") continue;

            let upgradedContent = upgradedMap.get(filePath);
            if (!upgradedContent) {
              upgradedContent = upgradedLowerMap.get(filePath.toLowerCase());
            }
            if (upgradedContent) {
              projectFolder.file(entryPath, upgradedContent);
              upgradedCount++;
            } else {
              const content = file.content || '';
              if (content) {
                projectFolder.file(entryPath, content);
              }
            }
            addedCount++;
          }
        }

        // Add any new files created by the upgrade that weren't in the original repo
        let newFileCount = 0;
        for (const [filePath, content] of upgradedMap) {
          if (!originalPathsSet.has(filePath)) {
            projectFolder.file(zipPath(filePath), content);
            addedCount++;
            upgradedCount++;
            newFileCount++;
          }
        }

        console.log(`[Download] Zip built: ${addedCount} total files, ${upgradedCount} overlaid with modified content, ${newFileCount} new files. upgradedMap had ${upgradedMap.size} entries.`);
        if (upgradedMap.size > 0 && upgradedCount === 0) {
          console.error(`[Download] CRITICAL: Zero files were overlaid despite ${upgradedMap.size} modified files. Sample extractedFile paths: ${[...originalPathsSet].slice(0, 5).join(", ")}. Sample modifiedFile paths: ${[...upgradedMap.keys()].slice(0, 5).join(", ")}`);
        }
        
        if (state.generatedTests && state.generatedTests.length > 0) {
          for (const test of state.generatedTests) {
            if (test.filePath && test.testCode) {
              projectFolder.file(zipPath(test.filePath), test.testCode);
              addedCount++;
            }
          }
        }
        
        if (state.assessmentMarkdown) {
          projectFolder.file("_reports/assessment.md", state.assessmentMarkdown);
        }
        if (state.planMarkdown) {
          projectFolder.file("_reports/plan.md", state.planMarkdown);
        }
        if (state.tasksMarkdown) {
          projectFolder.file("_reports/tasks.md", state.tasksMarkdown);
        }
        if (state.testResultsMarkdown) {
          projectFolder.file("_reports/test-results.md", state.testResultsMarkdown);
        }
        if (state.confidenceReportMarkdown) {
          projectFolder.file("_reports/confidence-report.md", state.confidenceReportMarkdown);
        }
        if (state.migrationReportMarkdown) {
          projectFolder.file("_reports/migration-report.md", state.migrationReportMarkdown);
        }
        if (state.vendorUpdateReportMarkdown) {
          projectFolder.file("_reports/vendor-update-report.md", state.vendorUpdateReportMarkdown);
        }
        if (state.completenessReportMarkdown) {
          projectFolder.file("_reports/completeness-report.md", state.completenessReportMarkdown);
        }
        if (state.apiUsageImpactMarkdown) {
          projectFolder.file("_reports/api-usage-impact.md", state.apiUsageImpactMarkdown);
        }
        if (state.structuralChangesMarkdown) {
          projectFolder.file("_reports/structural-changes.md", state.structuralChangesMarkdown);
        }
      }
      
      console.log(`[Download] ZIP assembly: ${addedCount} total files, ${upgradedCount} upgraded, ${modifiedFilesForDownload.length} in modifiedFiles`);

      const buffer = await zip.generateAsync({ type: "nodebuffer" });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="upgraded-project-${analysisId}.zip"`);
      res.send(buffer);
      
    } catch (error) {
      console.error("[Stack Modernization] Download upgrade error:", error);
      res.status(500).json({
        error: "Failed to generate download",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * GET /api/stack-modernization/analysis/:analysisId/download-tests
   * Download generated tests as ZIP
   */
  app.get("/api/stack-modernization/analysis/:analysisId/download-tests", async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      const { stateStore } = await import("../stack-modernization");
      const JSZip = (await import("jszip")).default;
      
      const state = stateStore.get(analysisId);
      
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      
      if (!state.generatedTests || state.generatedTests.length === 0) {
        return res.status(400).json({ error: "No test files available. Please run test generation first." });
      }
      
      // Create ZIP from test files
      const zip = new JSZip();
      const testsFolder = zip.folder("generated-tests");
      
      for (const test of state.generatedTests) {
        if (testsFolder) {
          testsFolder.file(test.filePath, test.testCode);
        }
      }
      
      const buffer = await zip.generateAsync({ type: "nodebuffer" });
      
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="generated-tests-${analysisId}.zip"`);
      res.send(buffer);
      
    } catch (error) {
      console.error("[Stack Modernization] Download tests error:", error);
      res.status(500).json({
        error: "Failed to generate download",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // INDIVIDUAL TASK RETRY
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/stack-modernization/analysis/:analysisId/retry-task/:taskId", async (req: Request, res: Response) => {
    try {
      const { analysisId, taskId } = req.params;

      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      // Validate the task exists and is in failed state
      const tasks = state.upgradeTasks || [];
      const task = tasks.find((t: any) => t.id === taskId);
      if (!task) {
        return res.status(404).json({ error: `Task ${taskId} not found` });
      }

      // Set task status to in_progress BEFORE responding, so the first client poll sees it
      const results = state.taskExecutionResults || [];
      const existingIdx = results.findIndex((r: any) => r.taskId === taskId);
      if (existingIdx >= 0) {
        results[existingIdx] = {
          ...results[existingIdx],
          status: "in_progress",
          error: undefined,
          startedAt: new Date(),
          completedAt: undefined,
        };
      } else {
        results.push({
          taskId,
          status: "in_progress",
          summary: "",
          startedAt: new Date(),
          alteredFiles: [],
          fixedIssues: [],
          verificationFiles: [],
        });
      }
      state.taskExecutionResults = [...results];
      stateStore.save(state);

      res.json({ status: "retrying", taskId, message: "Retry started" });

      (async () => {
        try {
          const { retryFailedTask } = await import("../stack-modernization/agents/code-upgrade-agent");
          const updatedState = await retryFailedTask(state, taskId);
          stateStore.save(updatedState);
          // Persist to DB so retry result survives restart
          stateStore.saveToDb(analysisId).catch(() => {});
          stateStore.savePhaseToDb(analysisId, "code_upgrade", "in_progress", {
            taskExecutionResults: updatedState.taskExecutionResults ?? [],
            modifiedFiles: updatedState.modifiedFiles ?? [],
          }).catch(() => {});
        } catch (error) {
          console.error(`[RetryTask] Task ${taskId} retry failed:`, error);
          const results = state.taskExecutionResults || [];
          const idx = results.findIndex((r: any) => r.taskId === taskId);
          if (idx >= 0) {
            results[idx].status = "failed";
            results[idx].error = `Retry failed: ${error instanceof Error ? error.message : String(error)}`;
            results[idx].completedAt = new Date();
          } else {
            results.push({
              taskId,
              status: "failed",
              summary: "",
              error: `Retry failed: ${error instanceof Error ? error.message : String(error)}`,
              completedAt: new Date(),
              alteredFiles: [],
              fixedIssues: [],
              verificationFiles: [],
            });
          }
          state.taskExecutionResults = [...results];
          stateStore.save(state);
          // Persist failure to DB too
          stateStore.saveToDb(analysisId).catch(() => {});
          stateStore.savePhaseToDb(analysisId, "code_upgrade", "in_progress", {
            taskExecutionResults: state.taskExecutionResults,
            modifiedFiles: state.modifiedFiles ?? [],
          }).catch(() => {});
        }
      })();

    } catch (error) {
      console.error("[RetryTask] Error:", error);
      res.status(500).json({ error: "Failed to start retry", message: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE RESET — go back and re-run a phase (clears downstream)
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/stack-modernization/analysis/:analysisId/reset-phase/:phase", async (req: Request, res: Response) => {
    try {
      const { analysisId, phase } = req.params;
      const { changeReason } = req.body || {};
      const validPhases = ["assessment", "planning", "tasks", "execution", "tests"];
      if (!validPhases.includes(phase)) {
        return res.status(400).json({ error: `Invalid phase: ${phase}. Valid: ${validPhases.join(", ")}` });
      }

      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId) ?? await stateStore.loadFromDb(analysisId);
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      // Capture previous state for audit before clearing
      const previousSelections = state.userSelections ? [...state.userSelections] : undefined;
      const previousPlanSummary = state.planMarkdown
        ? state.planMarkdown.substring(0, 2000)
        : undefined;

      const phaseIdx = validPhases.indexOf(phase);
      const clearPhases = validPhases.slice(phaseIdx);

      for (const p of clearPhases) {
        switch (p) {
          case "planning":
            state.compatibilityCheck = undefined;
            state.riskReport = undefined;
            state.planMarkdown = undefined;
            state.planningVisualizationData = undefined;
            stateStore.savePhaseToDb(analysisId, "planning", "pending", {}).catch(() => {});
            break;
          case "tasks":
            state.upgradeTasks = undefined;
            state.tasksMarkdown = undefined;
            stateStore.savePhaseToDb(analysisId, "task_generation", "pending", {}).catch(() => {});
            break;
          case "execution":
            state.taskExecutionResults = undefined;
            state.modifiedFiles = undefined;
            state.codeUpgrade = undefined;
            state.impactReport = undefined;
            (state as any).changeSummaries = undefined;
            stateStore.savePhaseToDb(analysisId, "code_upgrade", "pending", {}).catch(() => {});
            break;
          case "tests":
            state.generatedTests = undefined;
            state.testResultsMarkdown = undefined;
            state.confidenceReportMarkdown = undefined;
            stateStore.savePhaseToDb(analysisId, "test_generation", "pending", {}).catch(() => {});
            break;
          case "assessment":
            state.repoProfile = undefined;
            state.dependencyGraph = undefined;
            state.versionIntelligence = undefined;
            state.securityAssessment = undefined;
            state.codeQuality = undefined;
            state.breakingChangesPreview = undefined;
            state.databaseDependencies = undefined;
            state.requirementsAnalysis = undefined;
            state.assessmentMarkdown = undefined;
            state.versionRecommendationsText = undefined;
            stateStore.savePhaseToDb(analysisId, "assessment", "pending", {}).catch(() => {});
            break;
        }
      }

      // Increment graph run version so subsequent calls bypass stale LangGraph checkpoint
      state.graphRunVersion = (state.graphRunVersion ?? 0) + 1;

      // Determine where we are now after reset
      const stageMap: Record<string, string> = {
        assessment: "upload",
        planning: "assessment_complete",
        tasks: "plan_complete",
        execution: "tasks_ready",
        tests: "execution_complete",
      };
      state.currentStage = stageMap[phase] || state.currentStage;
      state.status = "in_progress" as any;
      stateStore.save(state);
      stateStore.saveToDb(analysisId).catch(() => {});

      // Record audit entry asynchronously
      const { recordVersionChange } = await import("../stack-modernization/services/db-persistence");
      recordVersionChange({
        analysisId,
        phaseReset: phase,
        previousSelections: previousSelections as any,
        downstreamPhasesCleared: clearPhases,
        previousPlanSummary,
        changedBy: state.userId,
        changeReason: changeReason || undefined,
      }).catch(() => {});

      res.json({
        status: "reset",
        phase,
        clearedPhases: clearPhases,
        newStage: stageMap[phase],
        graphRunVersion: state.graphRunVersion,
      });
    } catch (error) {
      console.error("[ResetPhase] Error:", error);
      res.status(500).json({ error: "Failed to reset phase" });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // VERSION CHANGE AUDIT HISTORY
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/stack-modernization/analysis/:analysisId/version-changes", async (req: Request, res: Response) => {
    try {
      const { analysisId } = req.params;
      const { loadVersionChangeHistory } = await import("../stack-modernization/services/db-persistence");
      const history = await loadVersionChangeHistory(analysisId);
      res.json({ analysisId, changes: history });
    } catch (error) {
      console.error("[VersionChanges] Error:", error);
      res.status(500).json({ error: "Failed to load version change history" });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // MANUAL TASK ADDITION
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/stack-modernization/analysis/:analysisId/add-task", async (req: Request, res: Response) => {
    try {
      const { analysisId } = req.params;
      const { title, description, affectedFiles, steps, riskLevel, phase } = req.body;

      if (!title || !description) {
        return res.status(400).json({ error: "Title and description are required" });
      }

      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      if (!state) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      const existingTasks = state.upgradeTasks || [];
      const manualCount = existingTasks.filter((t: any) => t.id?.startsWith("TASK-MANUAL")).length;
      const newTaskId = `TASK-MANUAL-${String(manualCount + 1).padStart(3, "0")}`;

      const newTask = {
        id: newTaskId,
        title,
        description,
        affectedFiles: affectedFiles || [],
        steps: steps || [],
        riskLevel: riskLevel || "medium",
        phase: phase || "code",
        status: "pending",
        autoFixable: true,
        isManual: true,
      };

      existingTasks.push(newTask);
      state.upgradeTasks = existingTasks;
      stateStore.save(state);

      res.json({ task: newTask, message: "Task added successfully" });

    } catch (error) {
      console.error("[AddTask] Error:", error);
      res.status(500).json({ error: "Failed to add task", message: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // ═══════════════════════════════════════════════════════
  //  Session management endpoints (DB persistence)
  // ═══════════════════════════════════════════════════════

  app.get("/api/stack-modernization/analyses", async (req: Request, res: Response) => {
    try {
      const adoOrg = req.query.adoOrg as string;
      const adoProjectId = req.query.adoProjectId as string;
      if (!adoOrg || !adoProjectId) {
        return res.status(400).json({ error: "adoOrg and adoProjectId are required" });
      }
      const { listAnalyses } = await import("../stack-modernization/services/db-persistence");
      const analyses = await listAnalyses(adoOrg, adoProjectId);
      res.json(analyses);
    } catch (error) {
      console.error("[ListAnalyses] Error:", error);
      res.status(500).json({ error: "Failed to list analyses" });
    }
  });

  app.get("/api/stack-modernization/analysis/:analysisId/load", async (req: Request, res: Response) => {
    try {
      const { analysisId } = req.params;
      const { stateStore } = await import("../stack-modernization");
      const { loadTokenUsage } = await import("../stack-modernization/services/db-persistence");

      let state = stateStore.get(analysisId) ?? null;

      if (!state) {
        state = await stateStore.loadFromDb(analysisId);
        if (!state) {
          return res.status(404).json({ error: "Analysis not found" });
        }
        // Use the state now in the store (same reference loadFromDb set)
        state = stateStore.get(analysisId)!;
      }

      // Restore token usage from DB if not already in memory or if it's empty
      const hasUsageData = state.tokenUsage && state.tokenUsage.totalLLMCalls > 0;
      if (!hasUsageData) {
        const dbUsage = await loadTokenUsage(analysisId);
        if (dbUsage && dbUsage.totalLLMCalls > 0) {
          state.tokenUsage = dbUsage;
          stateStore.save(state);
        }
      }

      // Attempt to load files from Git if ADO config is available
      if (state.adoOrg && state.adoProjectName) {
        try {
          const pat = await resolveAdoPat(state.adoOrg);
          if (pat) {
            const adoConfig = {
              organization: state.adoOrg,
              project: state.adoProjectName,
              pat,
            };
            await stateStore.loadFilesFromGitToState(analysisId, adoConfig);
            state = stateStore.get(analysisId)!;
          }
        } catch (gitErr) {
          console.warn("[LoadAnalysis] Git file load failed (non-fatal):", gitErr);
        }
      }

      // Ensure list fields are always arrays so frontend never shows "0" or empty when data exists
      const modifiedFiles = state.modifiedFiles ?? (state as any).codeUpgrade?.modifiedFiles ?? [];
      const upgradeTasks = state.upgradeTasks ?? [];
      const taskExecutionResults = state.taskExecutionResults ?? [];
      const generatedTests = state.generatedTests ?? [];

      res.json({
        analysisId: state.analysisId,
        sessionId: state.sessionId,
        status: state.status,
        progress: computeProgressFromSelectedPhases(state),
        currentStage: state.currentStage,
        errors: state.errors,
        selectedPhases: state.selectedPhases,
        adoOrg: state.adoOrg,
        adoProjectId: state.adoProjectId,
        adoProjectName: state.adoProjectName,
        versionIntelligence: state.versionIntelligence ?? [],
        vendorLibraries: state.vendorLibraries,
        bundleDetections: state.bundleDetections,
        discoveredBundledLibraries: state.discoveredBundledLibraries,
        repoProfile: state.repoProfile,
        dependencyGraph: state.dependencyGraph,
        riskReport: (state as any).riskReport,
        compatibilityCheck: state.compatibilityCheck,
        codeUpgrade: (state as any).codeUpgrade,
        assessmentSubAgentStatus: state.assessmentSubAgentStatus,
        securityAssessment: state.securityAssessment,
        codeQuality: state.codeQuality,
        breakingChangesPreview: state.breakingChangesPreview,
        databaseDependencies: state.databaseDependencies,
        requirementsAnalysis: state.requirementsAnalysis,
        planningVisualizationData: state.planningVisualizationData ?? undefined,
        taskExecutionResults,
        assessmentMarkdown: state.assessmentMarkdown ?? "",
        versionRecommendationsText: state.versionRecommendationsText ?? "",
        planMarkdown: state.planMarkdown ?? "",
        tasksMarkdown: state.tasksMarkdown ?? "",
        testResultsMarkdown: state.testResultsMarkdown ?? "",
        confidenceReportMarkdown: state.confidenceReportMarkdown ?? "",
        upgradeTasks,
        generatedTests,
        modifiedFiles,
        extractedFiles: state.extractedFiles?.length ?? 0,
        userSelections: state.userSelections ?? [],
        validationRun: (state as any).validationRun ?? undefined,
        validationPassed: (state as any).validationPassed,
        validationAttempts: (state as any).validationAttempts,
        validationEnabled: stackModConfig.validationEnabled,
        tokenUsage: state.tokenUsage ?? null,
      });
    } catch (error) {
      console.error("[LoadAnalysis] Error:", error);
      res.status(500).json({ error: "Failed to load analysis" });
    }
  });

  // Token usage registry — query per-analysis or all analyses
  app.get("/api/stack-modernization/token-usage", async (req: Request, res: Response) => {
    try {
      const { loadTokenUsageHistory } = await import("../stack-modernization/services/db-persistence");
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const history = await loadTokenUsageHistory(limit);
      res.json(history);
    } catch (error) {
      console.error("[TokenUsageRegistry] Error:", error);
      res.status(500).json({ error: "Failed to load token usage history" });
    }
  });

  app.get("/api/stack-modernization/analysis/:analysisId/token-usage", async (req: Request, res: Response) => {
    try {
      const { analysisId } = req.params;
      const { loadTokenUsage } = await import("../stack-modernization/services/db-persistence");
      const usage = await loadTokenUsage(analysisId);
      if (!usage) return res.status(404).json({ error: "No token usage data found" });
      res.json(usage);
    } catch (error) {
      console.error("[TokenUsage] Error:", error);
      res.status(500).json({ error: "Failed to load token usage" });
    }
  });

  app.delete("/api/stack-modernization/analysis/:analysisId", async (req: Request, res: Response) => {
    try {
      const { analysisId } = req.params;
      const { deleteAnalysis } = await import("../stack-modernization/services/db-persistence");
      const { stateStore } = await import("../stack-modernization");

      await deleteAnalysis(analysisId);
      stateStore.delete(analysisId);

      res.json({ success: true });
    } catch (error) {
      console.error("[DeleteAnalysis] Error:", error);
      res.status(500).json({ error: "Failed to delete analysis" });
    }
  });

  // ─── Pause / Cancel / Resume ───

  app.post("/api/stack-modernization/analysis/:analysisId/pause", async (req: Request, res: Response) => {
    try {
      const { analysisId } = req.params;
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      if (!state) return res.status(404).json({ error: "Analysis not found" });
      if (state.status === "completed" || state.status === "failed" || state.status === "cancelled") {
        return res.status(400).json({ error: `Cannot pause analysis in '${state.status}' state` });
      }
      state.status = "paused" as any;
      state.currentStage = `Paused at: ${state.currentStage}`;
      stateStore.save(state);
      try { await stateStore.saveToDb(analysisId); } catch {}
      res.json({ success: true, status: "paused" });
    } catch (error: any) {
      console.error("[PauseAnalysis] Error:", error);
      res.status(500).json({ error: error.message || "Failed to pause" });
    }
  });

  app.post("/api/stack-modernization/analysis/:analysisId/cancel", async (req: Request, res: Response) => {
    try {
      const { analysisId } = req.params;
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      if (!state) return res.status(404).json({ error: "Analysis not found" });
      state.status = "cancelled" as any;
      state.currentStage = "Cancelled by user";
      stateStore.save(state);
      try { await stateStore.saveToDb(analysisId); } catch {}
      res.json({ success: true, status: "cancelled" });
    } catch (error: any) {
      console.error("[CancelAnalysis] Error:", error);
      res.status(500).json({ error: error.message || "Failed to cancel" });
    }
  });

  app.post("/api/stack-modernization/analysis/:analysisId/resume", async (req: Request, res: Response) => {
    try {
      const { analysisId } = req.params;
      const { stateStore } = await import("../stack-modernization");
      const state = stateStore.get(analysisId);
      if (!state) return res.status(404).json({ error: "Analysis not found" });
      if (state.status !== "paused") {
        return res.status(400).json({ error: `Cannot resume analysis in '${state.status}' state` });
      }
      // Restore the stage (remove "Paused at: " prefix)
      state.currentStage = state.currentStage.replace(/^Paused at: /, "");
      state.status = "in_progress" as any;
      stateStore.save(state);
      try { await stateStore.saveToDb(analysisId); } catch {}

      // Resume the LangGraph workflow from the interrupt checkpoint.
      // shouldAbortNode() uses interrupt() when paused, so the graph is
      // checkpointed at the node that first detected the pause.
      // Command({ resume }) makes the interrupt() call return and the node
      // re-executes — by which time status is already "in_progress".
      try {
        const { useLangGraphStackModernization } = await import("../stack-modernization/config");
        if (useLangGraphStackModernization()) {
          const { stackModGraph, graphConfig } = await import("../stack-modernization/graph");
          const { Command } = await import("@langchain/langgraph");
          console.log(`[ResumeAnalysis] Resuming graph for ${analysisId} from checkpoint (currentStage: ${state.currentStage})`);
          stackModGraph.invoke(
            new Command({ resume: { action: "continue", resumedAt: Date.now() } }),
            graphConfig(analysisId)
          ).catch((err: any) => {
            console.error("[ResumeAnalysis] Graph error:", err);
            const s = stateStore.get(analysisId);
            if (s) {
              s.status = "failed" as any;
              s.errors = [...(s.errors ?? []), err.message || "Resume failed"];
              stateStore.save(s);
            }
          });
        }
      } catch (graphErr) {
        console.error("[ResumeAnalysis] Could not re-invoke graph:", graphErr);
      }

      res.json({ success: true, status: "in_progress" });
    } catch (error: any) {
      console.error("[ResumeAnalysis] Error:", error);
      res.status(500).json({ error: error.message || "Failed to resume" });
    }
  });

  app.post("/api/stack-modernization/analysis/:analysisId/download-charts-pdf", async (req: Request, res: Response) => {
    try {
      const { analysisId } = req.params;
      const { phase = "all", chartId } = req.body || {};
      const validPhases = ["assessment", "planning", "tasks", "execution", "tests", "all"];
      if (!validPhases.includes(phase)) {
        return res.status(400).json({ error: `Invalid phase: ${phase}` });
      }

      const { generateChartsPdf } = await import("../stack-modernization/services/chart-pdf-generator");
      const pdfBuffer = await generateChartsPdf({ analysisId, phase, chartId });

      const filename = chartId
        ? `stack-modernization-${phase}-${chartId}.pdf`
        : phase === "all"
          ? `stack-modernization-full-report.pdf`
          : `stack-modernization-${phase}-report.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("[DownloadChartsPdf] Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate PDF" });
    }
  });
}

/**
 * Helper function to generate comprehensive analysis report
 */
function generateComprehensiveReport(state: any): string {
  const report: string[] = [];
  const riskReport = (state as any).riskReport;
  const codeUpgrade = (state as any).codeUpgrade;
  
  // Header
  report.push(`# Stack Modernization Analysis Report`);
  report.push(`\nAnalysis ID: \`${state.analysisId}\``);
  report.push(`Session ID: \`${state.sessionId}\``);
  report.push(`Status: **${state.status}**`);
  report.push(`Generated: ${new Date().toISOString()}\n`);
  report.push(`---\n`);
  
  // Repository Profile
  if (state.repoProfile) {
    report.push(`## 1. Repository Profile\n`);
    report.push(`- **Project Type**: ${state.repoProfile.projectType || 'Unknown'}`);
    report.push(`- **Languages**: ${state.repoProfile.languages?.join(', ') || 'N/A'}`);
    report.push(`- **Total Files**: ${state.repoProfile.totalFiles || 0}`);
    report.push(`- **Total Lines of Code**: ${state.repoProfile.totalLinesOfCode?.toLocaleString() || 'N/A'}\n`);
    
    if (state.repoProfile.runtimeVersions && Object.keys(state.repoProfile.runtimeVersions).length > 0) {
      report.push(`### Current Runtime Versions\n`);
      for (const [runtime, version] of Object.entries(state.repoProfile.runtimeVersions)) {
        report.push(`- **${runtime}**: \`${version}\``);
      }
      report.push('');
    }
    
    if (state.repoProfile.frameworkVersions && state.repoProfile.frameworkVersions.length > 0) {
      report.push(`### Frameworks\n`);
      for (const fw of state.repoProfile.frameworkVersions) {
        report.push(`- **${fw.name}**: \`${fw.version || 'detected'}\``);
      }
      report.push('');
    }
    
    report.push(`---\n`);
  }
  
  // Dependency Graph
  if (state.dependencyGraph) {
    report.push(`## 2. Dependency Analysis\n`);
    report.push(`- **Direct Dependencies**: ${state.dependencyGraph.directDependencies?.length || 0}`);
    report.push(`- **Transitive Dependencies**: ${state.dependencyGraph.transitiveDependencies?.length || 0}`);
    report.push(`- **Version Conflicts**: ${state.dependencyGraph.conflicts?.length || 0}\n`);
    
    if (state.dependencyGraph.conflicts && state.dependencyGraph.conflicts.length > 0) {
      report.push(`### ⚠️ Version Conflicts\n`);
      for (const conflict of state.dependencyGraph.conflicts) {
        report.push(`- **${conflict.package}**: ${conflict.versions.join(', ')}`);
      }
      report.push('');
    }
    
    report.push(`---\n`);
  }
  
  // Version Intelligence & User Selections
  if (state.versionIntelligence && state.versionIntelligence.length > 0) {
    report.push(`## 3. Version Intelligence & User Selections\n`);
    
    if (state.userSelections && state.userSelections.length > 0) {
      report.push(`### Selected Upgrades\n`);
      report.push(`| Package | Current Version | Selected Version | Risk Level |`);
      report.push(`|---------|----------------|------------------|------------|`);
      
      for (const selection of state.userSelections) {
        const versionInfo = state.versionIntelligence.find((v: any) => v.package === selection.package);
        const riskLevel = versionInfo?.riskLevel || 'unknown';
        report.push(`| \`${selection.package}\` | \`${selection.currentVersion || 'unknown'}\` | \`${selection.selectedVersion}\` | ${riskLevel.toUpperCase()} |`);
      }
      report.push('');
    }
    
    report.push(`### All Version Recommendations\n`);
    report.push(`| Package | Current | Latest Stable | Latest LTS | Recommended | Risk |`);
    report.push(`|---------|---------|---------------|------------|-------------|------|`);
    
    for (const pkg of state.versionIntelligence) {
      const current = pkg.currentVersion || 'N/A';
      const latest = pkg.latestStable || 'N/A';
      const lts = pkg.latestLTS || 'N/A';
      const recommended = pkg.recommended || 'N/A';
      const risk = pkg.riskLevel || 'unknown';
      report.push(`| \`${pkg.package}\` | \`${current}\` | \`${latest}\` | \`${lts}\` | \`${recommended}\` | ${risk.toUpperCase()} |`);
    }
    
    report.push(`\n---\n`);
  }
  
  // Compatibility Check
  if (state.compatibilityCheck) {
    report.push(`## 4. Compatibility Check\n`);
    report.push(`- **Overall Compatibility**: ${state.compatibilityCheck.compatible ? '✅ Compatible' : '❌ Incompatible'}`);
    report.push(`- **Recommendation**: ${state.compatibilityCheck.recommendation}\n`);
    
    if (state.compatibilityCheck.conflicts && state.compatibilityCheck.conflicts.length > 0) {
      report.push(`### ❌ Conflicts Detected\n`);
      for (const conflict of state.compatibilityCheck.conflicts) {
        report.push(`#### ${conflict.package}`);
        report.push(`- **Type**: ${conflict.type}`);
        report.push(`- **Severity**: ${conflict.severity}`);
        report.push(`- **Description**: ${conflict.description}`);
        if (conflict.affectedPackages && conflict.affectedPackages.length > 0) {
          report.push(`- **Affected**: ${conflict.affectedPackages.join(', ')}`);
        }
        report.push('');
      }
    }
    
    if (state.compatibilityCheck.warnings && state.compatibilityCheck.warnings.length > 0) {
      report.push(`### ⚠️ Warnings\n`);
      for (const warning of state.compatibilityCheck.warnings) {
        report.push(`- **${warning.package}**: ${warning.message} (${warning.severity})`);
      }
      report.push('');
    }
    
    report.push(`---\n`);
  }
  
  // Risk Report
  if (riskReport) {
    report.push(`## 5. Risk Assessment & Summary\n`);
    report.push(`- **Overall Risk**: **${riskReport.overallRisk?.toUpperCase()}**`);
    report.push(`- **Recommendation**: ${riskReport.recommendation}\n`);
    
    if (riskReport.summary) {
      report.push(`### Executive Summary\n`);
      report.push(riskReport.summary);
      report.push('');
    }
    
    if (riskReport.breakingChanges && riskReport.breakingChanges.length > 0) {
      report.push(`### 🔴 Breaking Changes (${riskReport.breakingChanges.length})\n`);
      for (const change of riskReport.breakingChanges) {
        report.push(`#### ${change.package}: ${change.fromVersion} → ${change.toVersion}`);
        report.push(`**Impact**: ${change.impact}`);
        report.push(`\n${change.description}\n`);
        if (change.migrationSteps && change.migrationSteps.length > 0) {
          report.push(`**Migration Steps:**`);
          for (const step of change.migrationSteps) {
            report.push(`- ${step}`);
          }
          report.push('');
        }
      }
    }
    
    if (riskReport.riskFactors && riskReport.riskFactors.length > 0) {
      report.push(`### Risk Factors\n`);
      for (const risk of riskReport.riskFactors) {
        report.push(`#### ${risk.category} - ${risk.severity.toUpperCase()}`);
        report.push(risk.description);
        if (risk.mitigation) {
          report.push(`\n**Mitigation**: ${risk.mitigation}`);
        }
        report.push('');
      }
    }
    
    if (riskReport.recommendations && riskReport.recommendations.length > 0) {
      report.push(`### 💡 Recommendations\n`);
      for (const rec of riskReport.recommendations) {
        report.push(`- ${rec}`);
      }
      report.push('');
    }
    
    report.push(`---\n`);
  }
  
  // Code Upgrade Results
  if (codeUpgrade) {
    report.push(`## 6. Code Upgrade Results\n`);
    report.push(`- **Success**: ${codeUpgrade.summary?.success ? '✅ Yes' : '❌ No'}`);
    report.push(`- **Files Modified**: ${codeUpgrade.summary?.totalFilesModified || 0}`);
    report.push(`- **Packages Upgraded**: ${codeUpgrade.summary?.totalPackagesUpgraded || 0}\n`);
    
    if (codeUpgrade.modifiedFiles && codeUpgrade.modifiedFiles.length > 0) {
      report.push(`### Modified Files\n`);
      for (const file of codeUpgrade.modifiedFiles) {
        report.push(`#### \`${file.path}\`\n`);
        if (file.changes && file.changes.length > 0) {
          for (const change of file.changes) {
            report.push(`- **${change.package}**: \`${change.oldVersion}\` → \`${change.newVersion}\``);
          }
        }
        report.push('');
      }
    }
    
    if (codeUpgrade.errors && codeUpgrade.errors.length > 0) {
      report.push(`### ⚠️ Errors\n`);
      for (const error of codeUpgrade.errors) {
        report.push(`- ${error}`);
      }
      report.push('');
    }
    
    report.push(`---\n`);
  }
  
  // Activity Log
  if (state.activityLog && state.activityLog.length > 0) {
    report.push(`## 7. Activity Log\n`);
    for (const activity of state.activityLog) {
      const time = new Date(activity.timestamp).toLocaleTimeString();
      report.push(`- **[${time}]** ${activity.stage}: ${activity.message}`);
    }
    report.push('');
  }
  
  // Footer
  report.push(`\n---\n`);
  report.push(`*Report generated by DevX 2.0 Stack Modernization*`);
  
  return report.join('\n');
}
