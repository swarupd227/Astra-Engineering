import type { Express, Request, Response } from "express";
import { getSelectedLLM, hasAzureOpenAI, llmConfig } from "../llm-config";
import { requireActivity } from "../auth/middleware";
import { safeDecryptPAT, isEncryptionAvailable } from "../crypto-utils";
import * as schema from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

function parseJsonFromResponse(text: string): any {
  if (!text) return null;
  let raw = text.trim();
  
  const codeMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  raw = codeMatch ? codeMatch[1].trim() : raw;
  
  const normalizeJson = (str: string) => {
    return str
      .replace(/:\s*'([^']*)'/g, ': "$1"') // values
      .replace(/'([^']*)'\s*:/g, '"$1":') // keys
      .replace(/,\s*'([^']*)'/g, ', "$1"') // array items
      // Fix AI "cleverness" (concatenation/repeat)
      .replace(/\"\s*\+\s*\"/g, "") 
      .replace(/\"\s*\+\s*\"([^\"]*)\"/g, "$1")
      .replace(/\"([^\"]*)\"\s*\+\s*\"/g, "$1")
      .replace(/\"\s*\+\s*([^\s+]+)\.repeat\((\d+)\)/g, (m, char, count) => char.repeat(parseInt(count)))
      .replace(/([^\s+]+)\.repeat\((\d+)\)\s*\+\s*\"/g, (m, char, count) => char.repeat(parseInt(count)));
  };

  const tryParse = (jsonStr: string) => {
    let prepared = normalizeJson(jsonStr);
    try {
      return JSON.parse(prepared);
    } catch (e) {
      let fixed = prepared.trim();
      if (fixed.endsWith(',')) fixed = fixed.slice(0, -1);
      
      // Secondary cleanup for lingering code-like fragments
      fixed = fixed.replace(/\s*[+]\s*[^,}\]]+/g, "");

      let inString = false;
      let isEscaped = false;
      const stack: string[] = [];

      for (let i = 0; i < fixed.length; i++) {
        const char = fixed[i];
        if (isEscaped) { isEscaped = false; continue; }
        if (char === '\\') { isEscaped = true; continue; }
        if (char === '"') { inString = !inString; continue; }
        if (!inString) {
          if (char === '{') stack.push('}');
          else if (char === '[') stack.push(']');
          else if (char === '}' || char === ']') {
            if (stack.length > 0 && stack[stack.length - 1] === char) stack.pop();
          }
        }
      }
      if (inString) fixed += '"';
      if (fixed.trim().endsWith(',')) fixed = fixed.trim().slice(0, -1);
      if (stack.length > 0) fixed += stack.reverse().join('');

      try {
        return JSON.parse(fixed);
      } catch (innerE) {
        const lastComma = fixed.lastIndexOf(',');
        if (lastComma !== -1) {
          try {
            const lastFixed = fixed.substring(0, lastComma) + (stack.includes('}') ? '}' : '') + (stack.includes(']') ? ']' : '');
            return JSON.parse(lastFixed);
          } catch { return null; }
        }
        return null;
      }
    }
  };

  let result = tryParse(raw);
  
  if (!result) {
    try {
      const groups: any[] = [];
      const normalizedRaw = normalizeJson(raw);
      const groupMatches = normalizedRaw.matchAll(/"groupName":\s*"([^"]+)"[\s\S]*?"testCases":\s*\[([\s\S]*?)\]\s*[,}]/g);
      for (const gm of groupMatches) {
        const groupName = gm[1];
        const casesContent = gm[2];
        const testCaseMatches = casesContent.matchAll(/\{[\s\S]*?"testCaseId":\s*"([^"]+)"[\s\S]*?\}/g);
        const testCases: any[] = [];
        for (const tcm of testCaseMatches) {
          try {
            const tc = tryParse(tcm[0]);
            if (tc) testCases.push(tc);
          } catch {}
        }
        if (testCases.length > 0) groups.push({ groupName, testCases });
      }
      if (groups.length > 0) result = { groups };
    } catch (e) {
      console.error("[API Testing] Regex fallback parsing error:", e);
    }
  }

  // Final attempt: strictly look for ANY array named "testCases" or "groups" and try to piece it together
  if (!result) {
    try {
      const cleanText = text.replace(/[\n\r]/g, " ");
      const groupsMatch = cleanText.match(/"groups":\s*\[(.*?)\]\s*(?:,|\}$)/);
      if (groupsMatch) {
          const content = `{"groups": [${groupsMatch[1]}]}`;
          try { result = JSON.parse(content); } catch { /* ignore */ }
      }
    } catch {}
  }

  if (!result) {
    const forensicPath = path.join(process.cwd(), "tmp", `failed_api_gen_${Date.now()}.json`);
    try {
      if (!fs.existsSync(path.dirname(forensicPath))) fs.mkdirSync(path.dirname(forensicPath), { recursive: true });
      fs.writeFileSync(forensicPath, text);
      console.log(`[API Testing] Forensic log saved to: ${forensicPath}`);
    } catch {}
  }
  return result;
}

/** Call LLM for completion. */
async function llmComplete(messages: Array<{ role: "system" | "user"; content: string }>): Promise<string> {
  const client = getSelectedLLM();
  if (!client) throw new Error("No LLM client configured");

  const params: any = {
    messages,
    max_tokens: 16000,
    temperature: 0.1,
  };

  if (hasAzureOpenAI) {
    params.model = process.env.AZURE_OPENAI_DEPLOYMENT || llmConfig.azureOpenAIDeployment || "gpt-4o-mini";
  }

  const response = await client.chat.completions.create(params);
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("LLM returned no text");
  return content;
}

import { AuthenticatedRequest } from "../auth/middleware";

export function registerApiTestingRoutes(app: Express, getAzureDevOpsConfig?: (projectName?: string, organization?: string) => Promise<any>) {
  app.post("/api/testing/generate-api-tests", requireActivity("SDLC_TEST_MANAGE"), async (req: Request, res: Response) => {
    try {
      const { storyId, storyTitle, storyDescription, contractContent, projectId } = req.body;
      
      if (!contractContent) {
        return res.status(400).json({ error: "API Contract is required" });
      }

      console.log(`[API Testing] Generating parallelized functional tests for Story: ${storyTitle} (${storyId})`);

      const systemPrompt = `Senior Technical QA & Business Analyst: Generate an EXHAUSTIVE, high-fidelity functional test design.
      
Take this reference as the GOLD STANDARD for every endpoint:
Group: /roles
- ID: ROLE_TC_001, Type: Positive, Scenario: Create a new Compliance role, Data: roleName=ComplianceOfficer, active=true, Expected: {"statusCode": 201, "description": "Role created successfully"}
- ID: ROLE_TC_002, Type: Positive, Scenario: Retrieve list of roles, Data: No request body, Expected: {"statusCode": 200, "description": "List of roles retrieved successfully"}

STRICT GENERATION RULES:
1. DYNAMIC PREFIXING: extract a 3-4 letter module code from the path (e.g., /access -> ACC, /permissions -> PERM, /users -> USER). IDs must be [CODE]_TC_[NUM].
2. TEST DATA: Column MUST ALWAYS be populated. Use comma-separated 'key=value' format for POST/PUT. For GET, use Query Parameters or 'No request body'.
3. SCENARIOS: Must cover critical functional logic: Segregation of Duties, State transitions (active/inactive), Mandatory field validation, and high-entropy edge cases.
4. BREADTH: Provide a group for EVERY unique API path in the contract provided in this batch.
5. DEPTH: Minimum 5-8 functional cases per path (Positive, Negative, Edge).
6. FORMATTING: Output ONLY JSON in a markdown block. All values must be literal strings (NO code logic like .repeat()).

REQUIRED JSON STRUCTURE:
{"groups": [{"groupName": "/path", "testCases": [{"testCaseId": "CODE_TC_001", "caseType": "Positive", "scenario": "...", "testData": "...", "expectedOutput": {"statusCode": 200, "description": "..."}}]}]}
`;

      const contextPrefix = (storyId && storyId !== "undefined") 
        ? `User Story: ${storyTitle}\nDescription: ${storyDescription}\n\n`
        : "Context: No specific User Story linked. Focused on full API Contract functional design.\n\n";

      // --- PARALLELIZATION LOGIC ---
      let contractChunks: string[] = [];
      const trimmedContract = contractContent.trim();
      
      if (trimmedContract.startsWith("{") || trimmedContract.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmedContract);
          if (parsed.paths) {
            const pathEntries = Object.entries(parsed.paths);
            const chunkSize = 3; 
            for (let i = 0; i < pathEntries.length; i += chunkSize) {
              const chunkPaths = Object.fromEntries(pathEntries.slice(i, i + chunkSize));
              contractChunks.push(JSON.stringify({ ...parsed, paths: chunkPaths }, null, 2));
            }
          } else {
            contractChunks = [trimmedContract];
          }
        } catch (e) {
          contractChunks = [trimmedContract];
        }
      } else {
        // YAML Chunking: Split by suspected path start patterns in YAML
        // Look for lines that look like paths: "/path:" or "  /path:"
        const lines = trimmedContract.split("\n");
        let currentChunk: string[] = [];
        let pathCount = 0;
        const yamlChunkSize = 3;
        const yamlPreamble: string[] = [];
        
        // Try to collect the preamble (info, openapi tags etc.)
        let inPaths = false;
        for (const line of lines) {
          if (line.match(/^paths:/i)) {
            inPaths = true;
            yamlPreamble.push(line);
            continue;
          }
          if (!inPaths) {
            yamlPreamble.push(line);
          } else {
            // Check if this line is a new path
            if (line.match(/^\s{2}\/[^:]+:/) || line.match(/^\/[^:]+:/)) {
              if (pathCount >= yamlChunkSize) {
                contractChunks.push(yamlPreamble.join("\n") + "\npaths:\n" + currentChunk.join("\n"));
                currentChunk = [];
                pathCount = 0;
              }
              pathCount++;
            }
            currentChunk.push(line);
          }
        }
        if (currentChunk.length > 0) {
          contractChunks.push(yamlPreamble.join("\n") + "\npaths:\n" + currentChunk.join("\n"));
        }
        
        if (contractChunks.length === 0) contractChunks = [trimmedContract];
      }

      console.log(`[API Testing] Parallelizing across ${contractChunks.length} chunks.`);

      // Execute all chunks in parallel
      const chunkPromises = contractChunks.map(chunk => {
        const userPrompt = `${contextPrefix}API Contract Batch:
${chunk}

Generate logically grouped functional test cases for EVERY path in THIS batch. You MUST provide multiple scenarios per path (Min 5-8).`;

        return llmComplete([
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ]);
      });

      const chunkResults = await Promise.all(chunkPromises);
      
      // Merge results
      const finalResult: any = { groups: [] };
      for (const rawContent of chunkResults) {
        const parsed = parseJsonFromResponse(rawContent);
        if (parsed?.groups) {
          finalResult.groups.push(...parsed.groups);
        }
      }

      if (finalResult.groups.length === 0) {
        return res.status(500).json({ error: "Failed to generate valid test artifacts from parallel batches" });
      }

      res.json(finalResult);
    } catch (error) {
      console.error("[API Testing] Error during parallel generation:", error);
      res.status(500).json({ error: "Failed to generate test artifacts" });
    }
  });

  app.post("/api/testing/push-to-ado", requireActivity("SDLC_TEST_SYNC"), async (req: Request, res: Response) => {
    try {
      const { testCases, storyId, organization, projectName } = req.body;
      const authenticatedReq = req as AuthenticatedRequest;

      if (!testCases || !Array.isArray(testCases) || testCases.length === 0) {
        return res.status(400).json({ error: "No test cases provided to push" });
      }

      const azureConfig = await getAzureDevOpsConfig?.(projectName, organization);
      if (!azureConfig || !azureConfig.pat) {
        return res.status(400).json({ error: "Azure DevOps not configured for this project." });
      }

      const { AzureDevOpsService } = await import("../azure-devops-service");
      const adoService = new AzureDevOpsService(azureConfig);

      const resolvedStoryId = storyId && storyId !== "null" && storyId !== "undefined" ? Number(storyId) : null;
      const results: { total: number; succeeded: number; failed: number; ids: number[] } = { total: 0, succeeded: 0, failed: 0, ids: [] };
      
      // Use verified identity from authenticated request
      const userEmail = authenticatedReq.user?.email;

      for (const tc of testCases) {
        console.log(`[API Testing] Preparing to push: ${tc.testCaseId} - ${tc.scenario}`);
        const adoTestCase = {
          title: `[API-Test] ${tc.testCaseId}: ${tc.scenario}`,
          steps: [{
            action: (tc.testData && tc.testData !== "") ? tc.testData : "No request body required",
            result: `<strong>Expected Output:</strong> Status ${tc.expectedOutput?.statusCode || 'Success'}. ${tc.expectedOutput?.description || ''}`
          }],
          caseType: tc.caseType
        };

        try {
          let adoId: number;
          if (resolvedStoryId) {
            adoId = await adoService.createTestCase(adoTestCase, resolvedStoryId, tc.scenario, userEmail);
          } else {
            const fields: Record<string, any> = {
              'System.Title': adoService.truncateTitle(adoTestCase.title),
              'System.Description': `<div>API functional test case generated by DevX</div>`,
              'Microsoft.VSTS.TCM.Steps': adoService.formatTestCaseStepsXml(adoTestCase.steps),
            };
            if (userEmail) fields['System.AssignedTo'] = userEmail;
            if (azureConfig.project) fields['System.AreaPath'] = azureConfig.project;
            
            adoId = await adoService.createWorkItem('Test Case', fields);
          }
          results.ids.push(adoId);
          results.succeeded++;
          console.log(`[API Testing] Success: ID ${adoId} assigned to ${userEmail || "Default Owner"}`);
        } catch (itemError: any) {
          console.error(`[API Testing] Push FAILED for ${tc.testCaseId}:`, itemError.message);
          results.failed++;
        }
        results.total++;
      }

      if (results.succeeded > 0 && resolvedStoryId) {
        try {
          await adoService.addTagsToWorkItem(Number(storyId), ['API-Tests-Generated', 'DevX-Automation'], azureConfig.project);
        } catch {}
      }

      return res.json({
        success: true,
        summary: { total: results.total, succeeded: results.succeeded, failed: results.failed },
        ids: results.ids,
        message: `Successfully pushed ${results.succeeded} test cases assigned to your account.`
      });
    } catch (error: any) {
      console.error("[API Testing] Fatal push error:", error);
      res.status(500).json({ error: "Failed to push test cases to ADO", details: error.message });
    }
  });
}
