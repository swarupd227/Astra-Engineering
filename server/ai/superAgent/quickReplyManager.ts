/**
 * QuickReplyManager
 * 
 * LLM-validated quick reply system that ensures suggestions are:
 * 1. Within actual agent capabilities
 * 2. Limited to 5 maximum
 * 3. No generic replies (skip, help, done, etc.)
 * 4. Contextually relevant
 */

import { getCapabilitySummary, isBannedGenericReply, AGENT_CAPABILITIES } from "./capabilities";
import type { AgentIntent } from "./types";
import { getOptionalSuperAgentLlmClient } from "./optionalLlmClient";

const MAX_QUICK_REPLIES = 5;

interface QuickReplyContext {
  currentAgent: AgentIntent;
  agentResponse: string;
  conversationHistory?: string;
  availableData?: {
    organizations?: string[];
    projects?: string[];
    users?: string[];
  };
}

/**
 * Extracts organization/project names from quick reply patterns
 * E.g., "Use: ProcessTestApp" → organization: "ProcessTestApp"
 * E.g., "Project: FeatureTest1" → project: "FeatureTest1"
 */
function extractNamesFromReplies(replies: string[]): { organizations: string[], projects: string[] } {
  const organizations: string[] = [];
  const projects: string[] = [];
  
  for (const reply of replies) {
    const trimmed = reply.trim();
    
    // Match "Use: X" or "Use X" for organizations
    const orgMatch = trimmed.match(/^Use:?\s+(.+)$/i);
    if (orgMatch && orgMatch[1]) {
      organizations.push(orgMatch[1].trim());
      continue;
    }
    
    // Match "Project: X" for projects
    const projMatch = trimmed.match(/^Project:?\s+(.+)$/i);
    if (projMatch && projMatch[1]) {
      projects.push(projMatch[1].trim());
      continue;
    }
    
    // Match "Select: X" - could be either
    const selectMatch = trimmed.match(/^Select:?\s+(.+)$/i);
    if (selectMatch && selectMatch[1]) {
      // Add to both as we don't know which it is
      organizations.push(selectMatch[1].trim());
      projects.push(selectMatch[1].trim());
    }
  }
  
  return { organizations, projects };
}

/**
 * Validates and filters quick replies through LLM
 */
export async function validateQuickReplies(
  candidateReplies: string[],
  context: QuickReplyContext
): Promise<string[]> {
  console.log(`[QuickReplyManager] Validating ${candidateReplies.length} candidates for ${context.currentAgent}`);
  
  // Step 1: Pre-filter - remove banned generic replies and empty strings
  let filtered = candidateReplies
    .filter(reply => reply && reply.trim().length > 0)
    .filter(reply => !isBannedGenericReply(reply));
  
  console.log(`[QuickReplyManager] After pre-filter: ${filtered.length} candidates`);
  
  // Step 2: Remove obvious placeholder patterns (ProjectA, ProjectB, etc.)
  filtered = filtered.filter(reply => {
    const normalized = reply.toLowerCase().trim();
    // Remove obvious placeholder patterns
    if (/^project\s*[a-d]$/i.test(normalized)) return false;
    if (/^org(anization)?\s*[a-d]$/i.test(normalized)) return false;
    if (/^user\s*[a-d]$/i.test(normalized)) return false;
    if (/^option\s*\d+$/i.test(normalized)) return false;
    if (/^choice\s*\d+$/i.test(normalized)) return false;
    if (/^item\s*\d+$/i.test(normalized)) return false;
    // Also reject "Use organization X" or "Use project X" patterns
    if (/^use\s+(organization|project)\s+[a-z]$/i.test(normalized)) return false;
    return true;
  });
  
  console.log(`[QuickReplyManager] After placeholder filter: ${filtered.length} candidates`);
  
  // If no candidates left, return empty (router will handle fallback)
  if (filtered.length === 0) {
    console.log(`[QuickReplyManager] No valid candidates after pre-filtering`);
    return [];
  }
  
  // Step 2.5: Extract names from quick replies to enrich context
  // This ensures we know what data IS available even if metadata wasn't populated
  const extractedNames = extractNamesFromReplies(filtered);
  const enrichedContext = {
    ...context,
    availableData: {
      organizations: [
        ...(context.availableData?.organizations || []),
        ...extractedNames.organizations
      ],
      projects: [
        ...(context.availableData?.projects || []),
        ...extractedNames.projects
      ],
      users: context.availableData?.users || []
    }
  };
  
  console.log(`[QuickReplyManager] Enriched context with extracted names:`, {
    orgs: enrichedContext.availableData.organizations,
    projects: enrichedContext.availableData.projects
  });
  
  // Step 3: Check if candidates are data-driven (org/project selections) OR contextual flow responses
  // Flow responses should always bypass LLM validation
  const isDataDrivenOrFlowResponse = (reply: string): boolean => {
    const trimmed = reply.trim().toLowerCase();
    
    // Data-driven patterns (org/project selections)
    if (/^(use|project|select):?\s+/i.test(trimmed)) return true;
    
    // Story agent flow responses that should never be filtered
    const flowPatterns = [
      // Acceptance criteria / test cases flow
      /^yes\s*[-,]?\s*generate/i,
      /^yes,?\s+generate\s+test\s+cases/i,
      /^accept$/i,
      /^reject$/i,
      /^edit$/i,
      /^approve$/i,
      /^add\s+more$/i,
      /^done$/i,
      
      // Test cases specific
      /^generate\s+instead/i,
      /^add\s+test\s+cases/i,
      /^generate\s+test\s+cases/i,
      /^skip\s+test\s+cases/i,
      /^no\s+test\s+cases/i,
      /^i'?ll\s+add\s+my\s+own/i,
      
      // Acceptance criteria specific
      /^skip\s+criteria/i,
      /^don'?t\s+add/i,
      /^no\s*[-,]?\s*i'?ll\s+add/i,
      
      // Assignee flow - exact matches and patterns
      /^yes$/i,
      /^no\s*[-–]\s*leave\s+unassigned/i,
      /^leave\s+unassigned$/i,
      
      // General flow control
      /^start\s+over$/i,
      /^try\s+another\s+organization/i,
      /^create\s+in\s+(azure|ado)/i,
      /^assign\s+to/i,
      /^create\s+another\s+story/i,
      /^view\s+settings/i,
      /^continue$/i,
      
      // Priority and story points
      /^\d+\s*point/i,
      /^high$/i,
      /^medium$/i,
      /^low$/i,
    ];
    
    return flowPatterns.some(pattern => pattern.test(trimmed));
  };
  
  // Separate flow responses from non-flow responses
  const flowResponses = filtered.filter(isDataDrivenOrFlowResponse);
  const nonFlowResponses = filtered.filter(r => !isDataDrivenOrFlowResponse(r));
  
  // If all candidates are flow responses, skip LLM validation entirely
  if (nonFlowResponses.length === 0) {
    console.log(`[QuickReplyManager] All candidates are data-driven or flow responses, skipping LLM validation`);
    return flowResponses.slice(0, MAX_QUICK_REPLIES);
  }
  
  // If we have a mix, let flow responses through and only validate non-flow ones
  if (flowResponses.length > 0 && nonFlowResponses.length > 0) {
    console.log(`[QuickReplyManager] Mixed candidates - ${flowResponses.length} flow, ${nonFlowResponses.length} non-flow`);
    // Start with flow responses (guaranteed valid)
    let result = [...flowResponses];
    
    // Only validate non-flow responses if we have room
    if (result.length < MAX_QUICK_REPLIES && nonFlowResponses.length > 0) {
      try {
        const validated = await validateWithLLM(nonFlowResponses, enrichedContext);
        result = [...result, ...validated];
      } catch (error) {
        console.error(`[QuickReplyManager] LLM validation error for non-flow:`, error);
      }
    }
    
    console.log(`[QuickReplyManager] Final validated replies:`, result.slice(0, MAX_QUICK_REPLIES));
    return result.slice(0, MAX_QUICK_REPLIES);
  }
  
  // Step 4: LLM validation for mixed content
  try {
    const validated = await validateWithLLM(filtered, enrichedContext);
    
    // Step 5: Limit to MAX_QUICK_REPLIES
    const final = validated.slice(0, MAX_QUICK_REPLIES);
    
    console.log(`[QuickReplyManager] Final validated replies:`, final);
    return final;
  } catch (error) {
    console.error(`[QuickReplyManager] LLM validation error:`, error);
    // On error, return pre-filtered results limited to max
    return filtered.slice(0, MAX_QUICK_REPLIES);
  }
}

/**
 * Uses LLM to validate quick replies against agent capabilities
 */
async function validateWithLLM(
  candidates: string[],
  context: QuickReplyContext
): Promise<string[]> {
  const openai = getOptionalSuperAgentLlmClient();
  if (!openai) {
    console.log("[QuickReplyManager] LLM validator not configured; using pre-filtered replies");
    return candidates;
  }

  const capabilitySummary = getCapabilitySummary();
  
  const systemPrompt = `You are a quick reply validator for a development platform chat assistant.

Your job is to filter quick reply suggestions to ensure they:
1. Are actions the available agents can ACTUALLY perform
2. Are contextually relevant to the current conversation
3. Are NOT generic filler responses (skip, help, done, cancel, etc.)
4. Are NOT suggestions for capabilities that don't exist

${capabilitySummary}

CURRENT CONTEXT:
- Active agent: ${context.currentAgent}
- Agent just responded: "${context.agentResponse.substring(0, 200)}..."
${context.availableData?.organizations ? `- Available organizations: ${context.availableData.organizations.join(", ")}` : ""}
${context.availableData?.projects ? `- Available projects: ${context.availableData.projects.join(", ")}` : ""}

VALIDATION RULES:
1. ACCEPT suggestions that match actual agent capabilities
2. ACCEPT "Use: [name]" or "Select: [name]" for actual available organizations/projects
3. REJECT "Create a new project" - NO agent can create projects
4. REJECT "Create a new organization" - NO agent can create organizations  
5. REJECT generic responses: skip, help, done, cancel, back, continue, ok, yes, no
6. REJECT placeholder names like "ProjectA", "Project B", "Organization1" unless they match actual data
7. REJECT suggestions that no agent can fulfill

Return ONLY the valid suggestions that pass ALL rules.`;

  const userPrompt = `Candidate quick replies to validate:
${candidates.map((c, i) => `${i + 1}. "${c}"`).join("\n")}

Return a JSON object with this structure:
{
  "validReplies": ["only", "the", "valid", "ones"],
  "rejected": [
    {"reply": "rejected one", "reason": "why it was rejected"}
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: "json_object" }
    });

  const content = response.choices[0]?.message?.content || '{"validReplies": []}';
  
  try {
    const result = JSON.parse(content);
    const validated = result.validReplies || [];
    
    // Log rejections for debugging
    if (result.rejected && result.rejected.length > 0) {
      console.log(`[QuickReplyManager] LLM rejected:`, result.rejected);
    }
    
    return validated;
  } catch (parseError) {
    console.error(`[QuickReplyManager] Failed to parse LLM response:`, content);
    return candidates; // Return original on parse error
  }
}

/**
 * Gets contextually appropriate fallback quick replies when agent provides none
 */
export function getFallbackQuickReplies(agent: AgentIntent): string[] {
  const agentCaps = AGENT_CAPABILITIES[agent];
  if (!agentCaps) {
    return ["Create a user story", "Show golden repos"];
  }
  
  // Generate fallbacks from agent capabilities
  const fallbacks: string[] = [];
  
  for (const cap of agentCaps.capabilities) {
    if (cap.examplePhrases.length > 0) {
      fallbacks.push(cap.examplePhrases[0]);
    }
    if (fallbacks.length >= MAX_QUICK_REPLIES) break;
  }
  
  // Add cross-agent suggestions if room
  if (fallbacks.length < MAX_QUICK_REPLIES && agent !== "modernization") {
    fallbacks.push("Create a user story");
  }
  if (fallbacks.length < MAX_QUICK_REPLIES && agent !== "goldenRepo") {
    fallbacks.push("Show golden repos");
  }
  
  return fallbacks.slice(0, MAX_QUICK_REPLIES);
}

/**
 * Generates smart quick replies based on context and actual data
 */
export function generateDataDrivenReplies(
  dataType: "organizations" | "projects" | "users",
  actualData: string[]
): string[] {
  if (!actualData || actualData.length === 0) {
    console.log(`[QuickReplyManager] No actual ${dataType} data available`);
    return [];
  }
  
  const prefix = dataType === "organizations" ? "Use:" :
                 dataType === "projects" ? "Project:" :
                 dataType === "users" ? "Assign to:" : "";
  
  return actualData
    .slice(0, MAX_QUICK_REPLIES)
    .map(item => `${prefix} ${item}`.trim());
}
