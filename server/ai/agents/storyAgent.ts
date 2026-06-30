import type { Agent, AgentRequest, AgentResponse, Organization, Project } from "../superAgent/types";
import { storage } from "../../storage";
import { safeDecryptPAT } from "../../crypto-utils";
import {
  getState,
  saveState,
  resetState,
  isDuplicateMessage,
  updateMessageTracking,
  markFieldProvided,
  isAllFieldsProvided,
  activateStoryLock,
  deactivateStoryLock,
  type StoryState,
  type StoryField,
  type WorkItemPayload,
  type AssigneeAction,
  type ResolvedAssignee,
} from "../superAgent/state";
import {
  pickNextQuestion,
  getBaseSuggestionsForField,
} from "../superAgent/nextQuestion";
import {
  parseQuickReply,
  tryExtractFieldsFromText,
  buildOrganizationSuggestions,
  buildProjectSuggestions,
  generateUserStoryStatement,
  generateStoryTitle,
  generateAcceptanceCriteria,
  isSkipMessage,
  isStartOverMessage,
  isEditRequestMessage,
  detectEditField,
  isCancelEditsMessage,
  isYesGenerateACMessage,
  isNoSkipACMessage,
  isAcceptACMessage,
  isRejectACMessage,
  isYesAddTestsMessage,
  isNoSkipTestsMessage,
  isAcceptTestsMessage,
  isRejectTestsMessage,
  isDoneAddingTestsMessage,
  isYesAssignMessage,
  isNoAssignMessage,
  isCreateInADOMessage,
  extractAssigneeName,
  validateFieldResponse,
} from "../superAgent/helpers";

import { getOptionalSuperAgentLlmClient } from "../superAgent/optionalLlmClient";

const openai = new Proxy({} as NonNullable<ReturnType<typeof getOptionalSuperAgentLlmClient>>, {
  get(_target, prop, receiver) {
    const client = getOptionalSuperAgentLlmClient();
    if (!client) {
      throw new Error("Story Agent LLM client is not configured");
    }
    return Reflect.get(client, prop, receiver);
  },
});

// LLM-based validation result (shared for persona and goal)
interface LLMValidationResult {
  isValid: boolean;
  reason?: string;
  suggestion?: string;
}

// LLM-based persona validation result (alias for backward compatibility)
interface PersonaValidationResult {
  isValid: boolean;
  reason?: string;
  suggestion?: string;
}

// Validates persona using LLM with full conversation context
async function validatePersonaWithLLM(
  persona: string,
  goalContext: string | undefined
): Promise<PersonaValidationResult> {
  const trimmed = persona.trim();
  
  // Quick length checks - don't need LLM for these
  if (trimmed.length < 2) {
    return { isValid: false, reason: "Please provide a role name for who will use this feature.", suggestion: "e.g., Product Manager, Scrum Master, Developer, End User" };
  }
  if (trimmed.length > 100) {
    return { isValid: false, reason: "That seems too long for a role name. Please provide a concise role name.", suggestion: "e.g., Product Manager, Developer, Administrator" };
  }
  
  try {
    const systemPrompt = `You are validating if a user's response is a valid persona/role for a user story.

CONTEXT:
- We are creating a user story for Azure DevOps
- The goal of the story is: "${goalContext || "not yet specified"}"
- The user provided this as the persona: "${trimmed}"

A VALID persona is:
- A role name describing WHO will use the feature (e.g., "Scrum Master", "Product Owner", "Developer", "Teacher", "Patient", "Customer", "Admin", etc.)
- Any legitimate job title, role, or user type that makes sense for software

An INVALID persona is:
- Random characters or gibberish (e.g., "???", "asdf", "123")
- Non-role text like "hello", "yes", "ok"
- Clearly nonsensical for any software context (e.g., "banana", "chair")

Be PERMISSIVE - accept any plausible role even if unusual. Only reject obvious garbage.

Respond in JSON:
{
  "isValid": true/false,
  "reason": "Brief explanation if invalid"
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Is "${trimmed}" a valid persona/role?` }
      ],
      temperature: 0.1,
      max_tokens: 100,        
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content || '{"isValid": true}';
    const result = JSON.parse(content);
    
    if (result.isValid) {
      return { isValid: true };
    } else {
      return {
        isValid: false,
        reason: result.reason || "That doesn't seem like a valid role name.",
        suggestion: "Please provide a role like 'Product Manager', 'Developer', 'Administrator', etc."
      };
    }
  } catch (error) {
    // On LLM error, be permissive and accept the input
    console.log(`[StoryAgent] LLM persona validation error, accepting input: ${error}`);
    return { isValid: true };
  }
}

// Validates goal using LLM with full conversation context
async function validateGoalWithLLM(
  goal: string,
  projectContext: string | undefined
): Promise<LLMValidationResult> {
  const trimmed = goal.trim();
  
  // Quick length checks - don't need LLM for these
  if (trimmed.length < 5) {
    return { isValid: false, reason: "Please provide more detail about what the user wants to accomplish.", suggestion: "Describe the feature or action, e.g., 'create a dashboard to view attendance records'" };
  }
  if (trimmed.length > 500) {
    return { isValid: false, reason: "That's quite long. Could you summarize the main goal more concisely?", suggestion: "Focus on the core action or feature needed." };
  }
  
  try {
    const systemPrompt = `You are validating if a user's response is a valid goal for a user story.

CONTEXT:
- We are creating a user story for Azure DevOps
- The project context is: "${projectContext || "not yet specified"}"
- The user provided this as the goal: "${trimmed}"

A VALID goal is:
- A description of what the user/persona wants to accomplish or do
- A feature, action, capability, or functionality they need
- Can be described in natural language (doesn't need specific keywords)
- Examples: "create a dashboard page for school attendance", "view my order history", "upload documents to the system", "track student grades over time"

An INVALID goal is:
- Random characters or gibberish (e.g., "???", "asdf", "123")
- Single words that don't describe an action (e.g., "yes", "ok", "hello")
- Clearly not about software features (e.g., "banana", "the weather is nice")

Be PERMISSIVE - accept any reasonable description of what someone might want software to do.
If the goal is valid but could use more detail, still mark it as valid - we can ask for clarification later if needed.

Respond in JSON:
{
  "isValid": true/false,
  "reason": "Brief explanation if invalid",
  "needsMoreDetail": true/false (optional - if valid but vague)
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Is "${trimmed}" a valid goal for a user story?` }
      ],
      temperature: 0.1,
      max_tokens: 150,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content || '{"isValid": true}';
    const result = JSON.parse(content);
    
    if (result.isValid) {
      return { isValid: true };
    } else {
      return {
        isValid: false,
        reason: result.reason || "I couldn't understand that as a goal. Could you describe what the user wants to accomplish?",
        suggestion: "For example: 'view attendance reports', 'manage student records', 'track grades over time'"
      };
    }
  } catch (error) {
    // On LLM error, be permissive and accept the input
    console.log(`[StoryAgent] LLM goal validation error, accepting input: ${error}`);
    return { isValid: true };
  }
}

// LLM-based message interpreter response type
interface MessageInterpretation {
  action: "answer" | "question" | "data_request" | "command" | "clarification" | "off_topic" | "unclear" | "start_over" | "change_field";
  targetField?: StoryField | null;
  fieldValue?: string | null;
  dataRequest?: "projects" | "organizations" | "users" | "help" | null;
  clarificationQuestion?: string | null;
  commandType?: "skip" | "help" | "cancel" | "restart" | null;
  changeFieldTarget?: StoryField | null;
  changeFieldValue?: string | null; 
  confidence: number;
  reasoning: string;
}

// Interprets every user message through the LLM to understand intent
async function interpretUserMessage(
  message: string,
  currentState: StoryState,
  pendingField: StoryField | null,
  flowPhase: string,
  contextData: { organizations?: Organization[]; projects?: Project[] }
): Promise<MessageInterpretation> {
  const stateContext = {
    pendingField,
    flowPhase,
    providedFields: Object.keys(currentState.provided),
    missingFields: currentState.missingFields,
    acFlowStep: currentState.acFlowStep,
    assigneeFlowStep: currentState.assigneeFlowStep,
    availableOrganizations: contextData.organizations?.map(o => o.name) || [],
    availableProjects: contextData.projects?.map(p => p.name) || [],
  };

  const systemPrompt = `You are an intelligent, context-aware message analyzer for a story creation assistant. Your job is to understand what the user intends with their message in the CONTEXT of the ongoing conversation.

CURRENT CONTEXT:
- We are creating a user story for Azure DevOps
- Current flow phase: ${flowPhase}
- Pending field (what we asked for): ${pendingField || "none"}
- Already provided fields: ${stateContext.providedFields.join(", ") || "none"}
- Missing fields: ${stateContext.missingFields.join(", ") || "none"}
- Available organizations: ${stateContext.availableOrganizations.join(", ") || "none configured"}
- Available projects: ${stateContext.availableProjects.join(", ") || "none fetched yet"}

CRITICAL CONTEXT AWARENESS RULES:
1. If organization and project are ALREADY PROVIDED, and we're asking for the GOAL, then messages starting with "create a user story to..." or "I want to..." are providing the GOAL content, NOT requesting a restart!
2. ONLY return "start_over" if the user EXPLICITLY says just "start over", "reset", "cancel", or "create a new story" WITHOUT any goal description attached.
3. Messages like "create a user story to approve claimed amounts" contain the goal ("approve claimed amounts") and should be treated as an "answer" for the goal field.

ANALYZE the user's message and determine:

1. "answer" - User is providing a direct answer to the pending question
   - If we asked "What's the goal?" and they say "create a user story to approve claimed amounts" -> action: "answer", targetField: "goal", fieldValue: "approve claimed amounts for customers"
   - If we asked "Which organization?" and they say "omjha0827" -> action: "answer", targetField: "organization"
   - EXTRACT the actual goal from phrases like "create a user story to [GOAL]" or "I want to [GOAL]"

2. "change_field" - User wants to CHANGE an already-provided field (NOT the pending field)
   - CRITICAL: If we asked for "project" but user says "change organization to X" or "use X organization" or just types an organization name -> action: "change_field", changeFieldTarget: "organization", changeFieldValue: "X"
   - Example: Currently asking for project, user says "DevXPlatform" (which is an organization) -> action: "change_field", changeFieldTarget: "organization", changeFieldValue: "DevXPlatform"
   - Example: User says "switch to a different organization" -> action: "change_field", changeFieldTarget: "organization"
   - Example: User says "I want to use QS001 instead" (where QS001 is in available organizations) -> action: "change_field", changeFieldTarget: "organization", changeFieldValue: "QS001"
   - IMPORTANT: Check if the user's input matches an organization name when we're asking for project!

3. "question" - User is asking a question instead of answering
   - Example: "What projects are there?" -> question (data_request: projects)
   - Example: "Who can I assign this to?" -> question (data_request: users)

4. "data_request" - User wants to see available data before deciding
   - Example: "Show me the projects" -> data_request for projects

5. "command" - User wants to perform a non-restart action
   - Example: "help", "?" -> command (commandType: help)
   - Example: "skip", "skip for now" -> command (commandType: skip)

6. "start_over" - User EXPLICITLY wants to restart the ENTIRE flow (use ONLY for explicit restart requests with NO goal content)
   - ONLY for: "start over", "reset", "cancel", "create a new story" (said alone)
   - NOT for: "create a user story to do X" (this is providing a goal!)

7. "clarification" - User needs help understanding what to provide

8. "off_topic" - Message doesn't relate to story creation

9. "unclear" - Cannot confidently determine intent (confidence < 0.5)

VERY IMPORTANT: 
- When pendingField is "goal" and user says "create a user story to [something]", EXTRACT "[something]" as the goal value!
- Don't confuse goal descriptions with restart commands!
- If the message contains substantive content describing what the user wants to build, it's an ANSWER, not a restart!

Respond with JSON only:
{
  "action": "answer|question|data_request|command|clarification|off_topic|unclear|start_over|change_field",
  "targetField": "organization|project|persona|goal|benefit|priority|storyPoints" or null,
  "fieldValue": "extracted value" or null,
  "dataRequest": "projects|organizations|users|help" or null,
  "clarificationQuestion": "what user wants clarified" or null,
  "commandType": "skip|help|cancel|restart" or null,
  "changeFieldTarget": "organization|project|persona|goal|benefit|priority|storyPoints" or null (for change_field action),
  "changeFieldValue": "new value for the field being changed" or null,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `User message: "${message}"\n\nAnalyze this message and return JSON.` }
      ],
      temperature: 0.3,
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as MessageInterpretation;
      console.log(`[StoryAgent] Message interpretation:`, parsed);
      return parsed;
    }
  } catch (error) {
    console.error("[StoryAgent] Error interpreting message:", error);
  }

  // Fallback: Return unclear action - we'll explicitly ask user to restate
  // This prevents blindly treating messages as answers when LLM is unavailable
  console.warn("[StoryAgent] LLM interpretation failed - returning unclear action");
    
  return {
    action: "unclear",
    targetField: null,
    fieldValue: null,
    dataRequest: null,
    clarificationQuestion: "LLM unavailable - ask user to restate",
    confidence: 0,
    reasoning: "Fallback - LLM unavailable or parse failed, requires user clarification"
  };
}

// Generate an intelligent response using LLM when handling questions or clarifications
async function generateIntelligentResponse(
  userMessage: string,
  interpretation: MessageInterpretation,
  currentState: StoryState,
  contextData: { 
    organizations?: Organization[]; 
    projects?: Project[];
    pendingField?: StoryField | null;
  }
): Promise<{ reply: string; quickReplies: string[] }> {
  const systemPrompt = `You are a friendly, intelligent assistant helping create user stories for Azure DevOps. 
The user asked a question or needs clarification. Respond helpfully and naturally.

CONTEXT:
- User's question/request: "${userMessage}"
- Interpretation: ${interpretation.action} (${interpretation.reasoning})
- Current pending field: ${contextData.pendingField || "none"}
- Provided so far: ${JSON.stringify(currentState.provided)}

AVAILABLE DATA:
- Organizations: ${contextData.organizations?.map(o => o.name).join(", ") || "none"}
- Projects: ${contextData.projects?.map(p => p.name).join(", ") || "none loaded"}

INSTRUCTIONS:
1. Answer their question directly and helpfully
2. If they asked about available projects/organizations, list them clearly
3. Be conversational and friendly
4. After answering, gently guide them back to the story creation flow
5. Keep response concise but complete

Respond with JSON:
{
  "reply": "Your helpful response message",
  "quickReplies": ["4-6 contextual quick reply options"]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        reply: parsed.reply || "I'm here to help!",
        quickReplies: parsed.quickReplies || ["Continue", "Help", "Start over"]
      };
    }
  } catch (error) {
    console.error("[StoryAgent] Error generating intelligent response:", error);
  }

  // Fallback response
  return {
    reply: "I'm here to help! Could you please rephrase your question?",
    quickReplies: ["Continue", "Help", "Start over"]
  };
}

// LLM-powered contextual response generator for questions and quick replies
async function generateContextualQuestionAndReplies(
  field: StoryField,
  currentState: StoryState,
  contextData: {
    organizations?: Organization[];
    projects?: Project[];
    flowPhase?: string;
  }
): Promise<{ question: string; quickReplies: string[] }> {
  // CRITICAL: For project field, if no projects available, return error message instead of asking LLM
  // This prevents LLM from inventing placeholder project names like "Alpha, Beta, Gamma, Delta"
  if (field === "project") {
    const projects = contextData.projects || [];
    if (projects.length === 0) {
      console.log("[StoryAgent] No projects available - returning error message instead of LLM-generated placeholders");
      return {
        question: `I couldn't fetch projects from **${currentState.provided.organization}**. This could be due to:\n\n- The Personal Access Token (PAT) may have expired or is invalid\n- The PAT may not have permission to access projects\n- There are no projects in this organization\n\nPlease check your ADO settings or try a different organization.`,
        quickReplies: ["Try another organization", "Start over"]
      };
    }
    // If we have real projects, use them directly without LLM
    const projectReplies = projects.slice(0, 5).map(p => `Project: ${p.name}`);
    return {
      question: `Which project within the **${currentState.provided.organization}** organization would you like to create this user story for?`,
      quickReplies: projectReplies
    };
  }
  
  const providedFields = Object.entries(currentState.provided)
    .filter(([_, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  
  const orgNames = contextData.organizations?.map(o => o.name).join(", ") || "none configured";
  const projectNames = contextData.projects?.map(p => p.name).join(", ") || "none loaded yet";
  
  // Extract goal context for persona suggestions
  const goalContext = currentState.provided.goal 
    ? `User's goal/feature: "${currentState.provided.goal}"` 
    : "Goal not yet provided";
  
  const systemPrompt = `You are a conversational AI assistant helping users create user stories for Azure DevOps. Generate a natural, friendly question and relevant quick reply suggestions.

CURRENT CONTEXT:
- Field we need to ask about: ${field}
- Already provided: ${providedFields || "nothing yet"}
- ${goalContext}
- Flow phase: ${contextData.flowPhase || "collecting fields"}

AVAILABLE DATA:
- Organizations: ${orgNames}
- Projects: ${projectNames}

FIELD DEFINITIONS:
- organization: The Azure DevOps organization to create the story in
- project: The project within the organization
- goal: The feature/functionality the user wants and what they want to accomplish (asked BEFORE persona)
- persona: Who will benefit from this story - MUST be context-aware based on the goal
- benefit: Why this goal matters (the business value)
- priority: How important this story is (High/Medium/Low)
- storyPoints: Effort estimate using Fibonacci scale (1, 2, 3, 5, 8, 13)

INSTRUCTIONS:
1. Generate a natural, conversational question asking for the "${field}" field
2. Generate 4-6 relevant quick reply suggestions that make sense for this specific field
3. Quick replies should be ACTIONABLE ANSWERS that directly answer the question

CRITICAL FORMAT REQUIREMENTS:
- For "organization" field: Quick replies MUST be in format "Use: {OrgName}" using the actual organization names from AVAILABLE DATA
  Example: ["Use: ProcessTestApp", "Use: omjha0827", "Help"]
- For "project" field: Quick replies MUST be in format "Project: {ProjectName}" using actual project names from AVAILABLE DATA
  Example: ["Project: MyProject", "Project: TestProject", "Help"]
- For "goal" field: The question should ask user to describe the feature they want and the main goal. 
  Phrase it like: "Please tell me what feature you want to create a story for and what is the main goal of this user story. Describe your complete requirement."
  Quick replies should be example feature ideas like "Add user authentication", "Create reporting dashboard"
- For "persona" field: CRITICALLY IMPORTANT - Suggestions MUST be specific to the user's goal!
  ${currentState.provided.goal ? `
  The user wants: "${currentState.provided.goal}"
  Analyze this goal and suggest SPECIFIC personas who would use this feature. Examples:
  - If goal mentions "school" or "education": suggest "Student", "Teacher", "Parent", "School Administrator"
  - If goal mentions "e-commerce" or "shopping": suggest "Shopper", "Store Manager", "Vendor", "Customer Support"
  - If goal mentions "healthcare" or "medical": suggest "Patient", "Doctor", "Nurse", "Hospital Admin"
  - If goal mentions "finance" or "banking": suggest "Account Holder", "Bank Teller", "Financial Advisor"
  DO NOT use generic personas like "End User" - be SPECIFIC to the domain!` : `Suggest generic personas: "End User", "Administrator", "Developer", "Product Owner"`}
- For "benefit" field: Example benefits like "Increase efficiency", "Improve user experience", "Reduce manual effort"
- For "priority" field: Exactly "High", "Medium", "Low"
- For "storyPoints" field: Values like "3 points (medium)", "5 points (large)", "8 points (very large)"

CRITICAL: Quick replies must be ACTIONABLE CHOICES that directly SELECT or ANSWER, NOT instructions or questions.
- BAD: "Describe your goal" (instruction to user)
- BAD: "List organizations" (a command, not a selection)
- GOOD: "Use: ProcessTestApp" (directly selects an organization)
- GOOD: "Add user authentication" (directly provides a goal)
- GOOD for school app: "Student", "Teacher" (specific personas for the domain)

Respond with JSON only:
{
  "question": "Your natural conversational question",
  "quickReplies": ["Option 1", "Option 2", "Option 3", "Option 4", "Help"]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Generate a question and quick replies for the "${field}" field.` }
      ],
      temperature: 0.7,
      max_tokens: 400,
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[StoryAgent] Generated contextual response for ${field}:`, parsed);
      return {
        question: parsed.question || getDefaultQuestion(field),
        quickReplies: parsed.quickReplies || getDefaultQuickReplies(field, contextData)
      };
    }
  } catch (error) {
    console.error("[StoryAgent] Error generating contextual response:", error);
  }

  // Fallback to minimal defaults
  return {
    question: getDefaultQuestion(field),
    quickReplies: getDefaultQuickReplies(field, contextData)
  };
}

// Minimal fallback question when LLM fails
function getDefaultQuestion(field: StoryField): string {
  switch (field) {
    case "organization": return "Which organization would you like to work with?";
    case "project": return "Which project should this story be added to?";
    case "goal": return "Please tell me what feature you want to create a story for and what is the main goal. Describe your complete requirement.";
    case "persona": return "Who will be the primary user benefiting from this feature?";
    case "benefit": return "What benefit does this provide?";
    case "priority": return "What priority level?";
    case "storyPoints": return "How many story points?";
    default: return "What would you like to do?";
  }
}

// Minimal fallback quick replies when LLM fails - NO generic options
function getDefaultQuickReplies(field: StoryField, contextData: { organizations?: Organization[]; projects?: Project[] }): string[] {
  switch (field) {
    case "organization":
      const orgs = contextData.organizations?.slice(0, 5).map(o => `Use: ${o.name}`) || [];
      return orgs;
    case "project":
      const projs = contextData.projects?.slice(0, 5).map(p => `Project: ${p.name}`) || [];
      return projs;
    case "persona":
      return ["End User", "Administrator", "Developer", "Product Owner", "Customer"];
    case "goal":
      return ["Add user authentication", "Improve search", "Create dashboard", "Build notifications"];
    case "benefit":
      return ["Increase efficiency", "Better user experience", "Reduce manual effort"];
    case "priority":
      return ["High", "Medium", "Low"];
    case "storyPoints":
      return ["1 point", "2 points", "3 points", "5 points", "8 points"];
    default:
      return ["Create a user story", "Show golden repos"];
  }
}

let cachedOrganizations: Organization[] | null = null;
let cachedProjects: Map<string, Project[]> = new Map();
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache TTL

// Clear organization cache (useful when settings change)
function clearOrganizationCache(): void {
  cachedOrganizations = null;
  cachedProjects.clear();
  cacheTimestamp = 0;
  console.log("[StoryAgent] Organization cache cleared");
}

// Extract organization name from URL (e.g., "test-o" from "https://dev.azure.com/test-o/")
function extractOrgNameFromUrl(organizationUrl: string): string {
  if (!organizationUrl) return "Unknown Organization";
  try {
    const parsedUrl = new URL(organizationUrl);
    const path = parsedUrl.pathname.replace(/^\//, "").replace(/\/$/, "");
    if (path) {
      const segments = path.split("/");
      const lastSegment = segments[segments.length - 1];
      if (lastSegment) {
        return lastSegment;
      }
    }
    // Fallback to first part of hostname
    const hostParts = parsedUrl.hostname.split(".");
    return hostParts[0] || parsedUrl.hostname;
  } catch {
    // Fallback: return the last non-empty token after a slash
    const manual = organizationUrl.split("/").filter(Boolean);
    return manual[manual.length - 1] || organizationUrl;
  }
}

async function fetchOrganizations(): Promise<Organization[]> {
  const now = Date.now();
  
  // Return cached data if still valid
  if (cachedOrganizations && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedOrganizations;
  }

  try {
    const artifactOrgs = await storage.getArtifactOrganizations();
    cachedOrganizations = artifactOrgs.map(org => ({
      id: String(org.id),
      name: extractOrgNameFromUrl(org.organizationUrl || ""),
      organizationUrl: org.organizationUrl || "",
      projectName: org.projectName || "",
      repositoryName: undefined,
      patConfigured: !!org.patToken,
    }));
    cacheTimestamp = now;
    console.log(`[StoryAgent] Fetched ${cachedOrganizations.length} organizations:`, 
      cachedOrganizations.map(o => ({ name: o.name, url: o.organizationUrl })));
    return cachedOrganizations;
  } catch (error) {
    console.error("[StoryAgent] Error fetching organizations:", error);
    return [];
  }
}

async function fetchProjects(organizationUrl: string, pat: string): Promise<Project[]> {
  const cacheKey = organizationUrl;
  if (cachedProjects.has(cacheKey)) {
    return cachedProjects.get(cacheKey)!;
  }

  try {
    const orgName = organizationUrl.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "");
    const authToken = Buffer.from(`:${pat}`).toString("base64");

    const response = await fetch(
      `https://dev.azure.com/${orgName}/_apis/projects?api-version=7.0`,
      {
        headers: {
          Authorization: `Basic ${authToken}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error("[StoryAgent] Failed to fetch projects:", response.status);
      return [];
    }

    const data = await response.json();
    const projects = (data.value || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));

    cachedProjects.set(cacheKey, projects);
    return projects;
  } catch (error) {
    console.error("[StoryAgent] Error fetching projects:", error);
    return [];
  }
}

async function getProjectsForOrganization(orgName: string): Promise<Project[]> {
  const organizations = await fetchOrganizations();
  const org = organizations.find(o => o.name.toLowerCase() === orgName.toLowerCase());

  if (!org || !org.patConfigured) {
    console.log(`[StoryAgent] getProjectsForOrganization: org not found or PAT not configured for "${orgName}"`);
    return [];
  }

  const artifactOrgs = await storage.getArtifactOrganizations();
  // Match by organizationUrl (normalized) or by id - NOT by projectName which can be empty/null
  const normalizedOrgUrl = org.organizationUrl.toLowerCase().replace(/\/$/, "");
  const fullOrg = artifactOrgs.find(o => {
    const normalizedUrl = (o.organizationUrl || "").toLowerCase().replace(/\/$/, "");
    return normalizedUrl === normalizedOrgUrl || String(o.id) === org.id;
  });

  if (!fullOrg?.patToken) {
    console.log(`[StoryAgent] getProjectsForOrganization: PAT token not found for org "${orgName}", URL: ${org.organizationUrl}`);
    console.log(`[StoryAgent] Available artifact orgs:`, artifactOrgs.map(o => ({ id: o.id, url: o.organizationUrl })));
    return [];
  }

  const pat = safeDecryptPAT(fullOrg.patToken);
  if (!pat) {
    console.log(`[StoryAgent] getProjectsForOrganization: PAT decryption failed for org "${orgName}"`);
    return [];
  }

  console.log(`[StoryAgent] getProjectsForOrganization: Fetching projects for "${orgName}" using URL: ${org.organizationUrl}`);
  return fetchProjects(org.organizationUrl, pat);
}

async function fetchADOUsers(orgName: string): Promise<Array<{ displayName: string; email: string }>> {
  try {
    const organizations = await fetchOrganizations();
    const org = organizations.find(o => o.name.toLowerCase() === orgName.toLowerCase());

    if (!org || !org.patConfigured) return [];

    const artifactOrgs = await storage.getArtifactOrganizations();
    // Match by organizationUrl (normalized) or by id - NOT by projectName which can be empty/null
    const normalizedOrgUrl = org.organizationUrl.toLowerCase().replace(/\/$/, "");
    const fullOrg = artifactOrgs.find(o => {
      const normalizedUrl = (o.organizationUrl || "").toLowerCase().replace(/\/$/, "");
      return normalizedUrl === normalizedOrgUrl || String(o.id) === org.id;
    });

    if (!fullOrg?.patToken) return [];

    const pat = safeDecryptPAT(fullOrg.patToken);
    if (!pat) return [];

    const orgNameClean = org.organizationUrl.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "");
    const authToken = Buffer.from(`:${pat}`).toString("base64");

    const response = await fetch(
      `https://vssps.dev.azure.com/${orgNameClean}/_apis/graph/users?api-version=7.1-preview.1`,
      {
        headers: {
          Authorization: `Basic ${authToken}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error("[StoryAgent] Failed to fetch ADO users:", response.status);
      return [];
    }

    const data = await response.json();
    const users = (data.value || [])
      .filter((u: any) => u.principalName && !u.principalName.includes("@system"))
      .map((u: any) => ({
        displayName: u.displayName || u.principalName,
        email: u.principalName || u.mailAddress || "",
      }));

    console.log(`[StoryAgent] Fetched ${users.length} ADO users`);
    return users;
  } catch (error) {
    console.error("[StoryAgent] Error fetching ADO users:", error);
    return [];
  }
}

/**
 * Validate a custom assignee name against ADO Graph API
 * Returns the matched user if found, null if not found
 */
async function validateAssigneeInADO(
  orgName: string,
  assigneeName: string
): Promise<{ displayName: string; email: string } | null> {
  try {
    console.log(`[StoryAgent] Validating assignee "${assigneeName}" against ADO in org "${orgName}"`);
    
    // Fetch all users from ADO
    const users = await fetchADOUsers(orgName);
    
    if (users.length === 0) {
      console.log("[StoryAgent] No users returned from ADO, cannot validate");
      return null;
    }
    
    const searchTerm = assigneeName.toLowerCase().trim();
    
    // Try exact match on display name or email
    let matchedUser = users.find(
      u => u.displayName.toLowerCase() === searchTerm ||
           u.email.toLowerCase() === searchTerm
    );
    
    // If no exact match, try partial match
    if (!matchedUser) {
      matchedUser = users.find(
        u => u.displayName.toLowerCase().includes(searchTerm) ||
             searchTerm.includes(u.displayName.toLowerCase())
      );
    }
    
    if (matchedUser) {
      console.log(`[StoryAgent] Validated assignee: ${matchedUser.displayName} (${matchedUser.email})`);
      return matchedUser;
    }
    
    console.log(`[StoryAgent] Assignee "${assigneeName}" not found in ADO`);
    return null;
  } catch (error) {
    console.error("[StoryAgent] Error validating assignee:", error);
    return null;
  }
}

function buildQuickRepliesForField(
  field: StoryField,
  organizations: Organization[],
  projects: Project[]
): string[] {
  let suggestions: string[];
  
  switch (field) {
    case "organization":
      suggestions = buildOrganizationSuggestions(organizations);
      break;
    case "project":
      suggestions = buildProjectSuggestions(projects);
      break;
    default:
      suggestions = getBaseSuggestionsForField(field);
      break;
  }
  
  // Return only actual suggestions - no generic options
  return suggestions.slice(0, 5);
}

// Contextual help messages for each field in the story creation flow
function getContextualHelpMessage(field: StoryField | null, flowStep?: string): { message: string; examples: string[] } {
  if (flowStep === "asking_generate") {
    return {
      message: "I can use AI to automatically generate acceptance criteria based on your story details. Acceptance criteria are specific conditions that must be met for the story to be considered complete.\n\n**Yes - generate**: I'll create professional acceptance criteria for you\n**No - I'll add my own**: Skip AI generation, use basic criteria",
      examples: ["Yes - generate", "No - I'll add my own"]
    };
  }
  
  if (flowStep === "showing_ac") {
    return {
      message: "I've generated acceptance criteria for your story. Review them and choose:\n\n**Accept**: Use these criteria as-is\n**Edit**: Modify or add your own criteria\n**Reject**: Skip the generated criteria and use basic ones instead",
      examples: ["Accept", "Edit", "Reject"]
    };
  }
  
  if (flowStep === "asking_assign") {
    return {
      message: "You can assign this story to a team member in Azure DevOps. If you choose to assign it, I'll show you available team members from your organization.",
      examples: ["Yes", "No - leave unassigned"]
    };
  }
  
  if (flowStep === "selecting_assignee") {
    return {
      message: "Select a team member to assign this story to. You can:\n\n- Click a name from the list\n- Type a custom name\n- Choose 'Leave unassigned' to skip assignment",
      examples: ["Select a name", "Leave unassigned"]
    };
  }
  
  if (flowStep === "final_summary") {
    return {
      message: "Your user story is ready! Review the summary and:\n\n**Create in ADO**: Create this story in Azure DevOps\n**Edit**: Go back and modify details\n**Start over**: Begin a new story",
      examples: ["Create in ADO", "Edit", "Start over"]
    };
  }
  
  switch (field) {
    case "organization":
      return {
        message: "Select the Azure DevOps organization where you want to create this user story. Organizations are your top-level containers in Azure DevOps that hold projects and repositories.",
        examples: ["Click one of the organization buttons above"]
      };
    case "project":
      return {
        message: "Select the project within your organization where this story should be created. Projects contain your work items, repositories, and pipelines.",
        examples: ["Click a project name", "Skip for now"]
      };
    case "persona":
      return {
        message: "A persona is the type of user or stakeholder who will benefit from this feature. Think about who will actually use what you're building.\n\n**Examples:**\n- End User - someone using the final product\n- Administrator - someone managing the system\n- Developer - someone building or maintaining the system",
        examples: ["End User", "Administrator", "Developer", "Customer"]
      };
    case "goal":
      return {
        message: "The goal describes what the user wants to accomplish. It should be a clear, actionable objective.\n\n**Good examples:**\n- \"easily search and filter products by category\"\n- \"receive notifications when tasks are assigned to me\"\n- \"export reports in multiple formats\"\n\n**Tips:**\n- Start with a verb (search, view, create, manage)\n- Be specific about the functionality\n- Focus on one main objective",
        examples: ["Type your goal in the chat box"]
      };
    case "benefit":
      return {
        message: "The benefit explains WHY this feature matters. What value does achieving this goal provide?\n\n**Good examples:**\n- \"Improve efficiency\" - saves time or reduces effort\n- \"Better user experience\" - makes the product easier to use\n- \"Reduce costs\" - saves money or resources\n- \"Increase productivity\" - helps users accomplish more\n\n**Tips:**\n- Think about business value\n- Consider user satisfaction\n- You can also skip this if the benefit is already clear from the goal",
        examples: ["Improve efficiency", "Better user experience", "Skip for now"]
      };
    case "priority":
      return {
        message: "Priority indicates how important this story is relative to other work.\n\n**High**: Critical for upcoming release, blocking other work, or urgent business need\n**Medium**: Important but not blocking, should be done soon\n**Low**: Nice to have, can be deferred if needed",
        examples: ["High", "Medium", "Low"]
      };
    case "storyPoints":
      return {
        message: "Story points estimate the effort required to complete this story. They use a Fibonacci-like scale:\n\n**1 point**: Trivial - quick fix, minor change\n**2 points**: Small - straightforward task, few hours\n**3 points**: Medium - typical story, a day or two\n**5 points**: Large - complex work, multiple days\n**8 points**: Very large - significant effort, may need breakdown\n**13 points**: Epic-sized - consider splitting into smaller stories",
        examples: ["3 points (medium)", "5 points (large)"]
      };
    default:
      return {
        message: "I'm here to help you create a user story! A user story follows the format: \"As a [persona], I want [goal], so that [benefit].\" I'll guide you through each part step by step.\n\nYou can:\n- Answer each question to build your story\n- Click 'Skip for now' to skip optional fields\n- Say 'Start over' to begin again",
        examples: ["Continue answering questions", "Start over"]
      };
  }
}

async function generateAIAcceptanceCriteria(state: StoryState): Promise<string[]> {
  const { persona, goal, benefit } = state.provided;

  console.log("[StoryAgent] Generating AI acceptance criteria");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an assistant that generates 3-5 concise, testable acceptance criteria (AC) for a user story. Output only a JSON array of strings. Each criterion should be clear and actionable."
        },
        {
          role: "user",
          content: `Title: ${generateStoryTitle(String(goal))}. Persona: ${persona}. Goal: ${goal}. Benefit: ${benefit || "Not specified"}.`
        }
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      const criteria = JSON.parse(jsonMatch[0]);
      if (Array.isArray(criteria) && criteria.every(c => typeof c === "string")) {
        console.log("[StoryAgent] Generated AI acceptance criteria:", criteria.length);
        return criteria;
      }
    }
  } catch (error) {
    console.error("[StoryAgent] Error generating AI acceptance criteria:", error);
  }

  return generateAcceptanceCriteria(String(goal), benefit ? String(benefit) : undefined);
}

async function generateAITestCases(state: StoryState): Promise<string[]> {
  const { persona, goal, benefit } = state.provided;
  const acceptanceCriteria = state.generatedAcceptanceCriteria || [];

  console.log("[StoryAgent] Generating AI test cases");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an assistant that generates 3-5 concise, actionable test cases for a user story. Each test case should verify a specific behavior or scenario. Output only a JSON array of strings. Each test case should follow the format: 'GIVEN [context] WHEN [action] THEN [expected result]' or a similar clear testing format."
        },
        {
          role: "user",
          content: `User Story: As a ${persona}, I want ${goal}${benefit ? `, so that ${benefit}` : ""}.
          
Acceptance Criteria:
${acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Generate test cases that verify these acceptance criteria and cover edge cases.`
        }
      ],
      temperature: 0.7,
      max_tokens: 800,
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      const testCases = JSON.parse(jsonMatch[0]);
      if (Array.isArray(testCases) && testCases.every(tc => typeof tc === "string")) {
        console.log("[StoryAgent] Generated AI test cases:", testCases.length);
        return testCases;
      }
    }
  } catch (error) {
    console.error("[StoryAgent] Error generating AI test cases:", error);
  }

  return [
    `GIVEN a ${persona} wants to ${goal} WHEN they perform the action THEN the expected outcome is achieved`,
    `GIVEN invalid input WHEN the action is attempted THEN appropriate error handling occurs`,
    `GIVEN the system is under load WHEN the action is performed THEN response time remains acceptable`,
  ];
}

function buildWorkItemPayload(state: StoryState): WorkItemPayload | null {
  const { organization, project, persona, goal, benefit, priority, storyPoints } = state.provided;

  if (!organization || !persona || !goal) {
    console.error("[StoryAgent] Cannot build work item payload - missing required fields");
    return null;
  }

  const userStory = generateUserStoryStatement(state);
  const title = generateStoryTitle(String(goal));
  const description = `This story enables ${persona} to ${goal}.${benefit ? ` The expected benefit is to ${benefit}.` : ""}`;

  const acceptanceCriteria = state.generatedAcceptanceCriteria || 
    generateAcceptanceCriteria(String(goal), benefit ? String(benefit) : undefined);

  let assigneeAction: AssigneeAction = "leave_unassigned";
  let assigneeQuery: string | undefined;
  let assigneeResolved: ResolvedAssignee | undefined;

  if (state.assigneeAction) {
    assigneeAction = state.assigneeAction;
    assigneeQuery = state.assigneeQuery;
    assigneeResolved = state.assigneeResolved;
  } else if (state.selectedAssignee) {
    if (state.selectedAssignee.includes("@")) {
      assigneeAction = "assign_resolved";
      assigneeResolved = {
        displayName: state.selectedAssignee,
        uniqueName: state.selectedAssignee,
      };
    } else {
      assigneeAction = "assign_manual";
      assigneeQuery = state.selectedAssignee;
    }
  }

  const testCases = state.generatedTestCases || [];

  return {
    organizationUrl: "",
    projectName: String(project || organization),
    title,
    description,
    acceptanceCriteria,
    testCases,
    priority: String(priority || "Medium"),
    storyPoints: typeof storyPoints === "number" ? storyPoints : 3,
    assigneeAction,
    assigneeQuery,
    assigneeResolved,
    userStory,
  };
}

// Helper to populate organization data in payload - returns null if org not found
async function populatePayloadOrganization(
  payload: WorkItemPayload,
  state: StoryState,
  organizations: Organization[]
): Promise<{ success: true; payload: WorkItemPayload } | { success: false; error: string }> {
  const providedOrg = String(state.provided.organization).toLowerCase();
  
  const org = organizations.find(o => 
    o.name.toLowerCase() === providedOrg ||
    o.name.toLowerCase().includes(providedOrg) ||
    providedOrg.includes(o.name.toLowerCase()) ||
    o.organizationUrl.toLowerCase().includes(providedOrg) ||
    o.projectName?.toLowerCase() === providedOrg
  );

  if (org) {
    payload.organizationUrl = org.organizationUrl;
    payload.projectName = String(state.provided.project || org.projectName);
    return { success: true, payload };
  } else {
    console.error(`[StoryAgent] Organization not found! Provided: "${state.provided.organization}"`);
    console.error(`[StoryAgent] Available orgs:`, organizations.map(o => o.name));
    return { success: false, error: `Could not find the organization "${state.provided.organization}" in your configured settings. Please check your Azure DevOps configuration in Settings.` };
  }
}

function buildFinalSummaryPrompt(state: StoryState): string {
  const { generatedSummary, selectedAssignee } = state;

  if (!generatedSummary) return "Error: Story summary not generated.";

  let prompt = `Here's the complete user story ready for Azure DevOps:

**${generatedSummary.title}**

**User Story:** ${generatedSummary.userStory}

**Description:** ${generatedSummary.description}

**Acceptance Criteria:**
${generatedSummary.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`;

  if (generatedSummary.testCases && generatedSummary.testCases.length > 0) {
    prompt += `\n\n**Test Cases:**
${generatedSummary.testCases.map((tc, i) => `${i + 1}. ${tc}`).join("\n")}`;
  }

  prompt += `\n\n**Priority:** ${generatedSummary.priority}
**Story Points:** ${generatedSummary.storyPoints}`;

  if (selectedAssignee) {
    prompt += `\n**Assignee:** ${selectedAssignee}`;
  } else {
    prompt += `\n**Assignee:** Unassigned`;
  }

  prompt += `\n\nClick "Create in ADO" to create this story in Azure DevOps.`;

  return prompt;
}

export const storyAgent: Agent = {
  name: "Story Agent",
  description: "Helps users create Agile stories, backlogs, tasks, and subtasks",

  async process(request: AgentRequest): Promise<AgentResponse> {
    const { message, context } = request;
    const sessionId = context.sessionId;
    const userId = sessionId;

    const state = getState(userId, sessionId);

    if (!state.agentLockActive) {
      activateStoryLock(state);
    }

    if (isDuplicateMessage(state, message)) {
      return {
        reply: "I received that message. Please wait a moment or try a different response.",
        usedAgent: "story",
        metadata: {
          quickReplies: ["Continue", "Help", "Start over"],
          missingFields: state.missingFields,
        },
      };
    }

    updateMessageTracking(state, message);

    // NOTE: We NO LONGER check isStartOverMessage here BEFORE LLM interpretation!
    // The LLM will determine if the user wants to restart based on full context.
    // This prevents false restarts when user says "create a user story to [goal]"

    const organizations = await fetchOrganizations();
    
    // ==========================================
    // CROSS-AGENT CONTEXT: Check if organization was already selected in another agent
    // This makes Story Agent "context-aware" of previous selections in Settings Agent, etc.
    // ==========================================
    if (!state.provided.organization && context.selectedOrganization) {
      console.log(`[StoryAgent] Using organization from context: ${context.selectedOrganization.name}`);
      
      // Find matching organization in our list to ensure it's valid
      const matchedOrg = organizations.find(
        org => org.name.toLowerCase() === context.selectedOrganization!.name.toLowerCase() ||
               org.organizationUrl === context.selectedOrganization!.organizationUrl
      );
      
      if (matchedOrg) {
        // Pre-fill the organization from context
        markFieldProvided(state, "organization", matchedOrg.name);
        console.log(`[StoryAgent] Auto-filled organization from context: ${matchedOrg.name}`);
        saveState(state);
      }
    }
    
    // FRESH START: If no organization has been selected yet, immediately ask for organization
    // This handles the case when user says "create a user story" - don't go through LLM, 
    // just ask for organization selection directly as the first step
    // IMPORTANT: Only do this if we haven't already asked for organization (lastAsked !== "organization")
    if (!state.provided.organization && state.missingFields.includes("organization") && state.lastAsked !== "organization") {
      // Check if this is the very first message (organization not yet asked)
      // or if user is explicitly starting fresh (hasn't provided any fields)
      const hasNoFieldsProvided = Object.values(state.provided).every(v => v === undefined || v === null || v === "");
      
      if (hasNoFieldsProvided) {
        console.log(`[StoryAgent] Fresh start detected - immediately asking for organization`);
        
        // Set lastAsked to organization so we know we're waiting for it
        state.lastAsked = "organization";
        saveState(state);
        
        // Format organizations list
        const orgList = organizations.length > 0
          ? `\n\nHere are the configured organizations:\n${organizations.map(org => `- ${org.name}`).join('\n')}`
          : "";
        
        return {
          reply: `I'll help you create a user story! First, which Azure DevOps organization would you like to work with?${orgList}`,
          usedAgent: "story",
          metadata: {
            quickReplies: buildQuickRepliesForField("organization", organizations, []),
            missingFields: state.missingFields,
          },
        };
      }
    }
    
    // Fetch projects if we have an organization selected
    let projects: Project[] = [];
    if (state.provided.organization) {
      projects = await getProjectsForOrganization(String(state.provided.organization));
    }
    
    // ==========================================
    // PRE-LLM: Handle "Yes, switch to X" quick reply pattern explicitly
    // This ensures reliable handling of the organization switch confirmation
    // ==========================================
    const switchMatch = message.match(/^yes,?\s*switch\s*to\s+(.+)$/i);
    if (switchMatch) {
      const targetOrgName = switchMatch[1].trim();
      console.log(`[StoryAgent] Detected "Yes, switch to" pattern for org: ${targetOrgName}`);
      
      const matchedOrg = organizations.find(o => 
        o.name.toLowerCase() === targetOrgName.toLowerCase()
      );
      
      if (matchedOrg) {
        // Update state to new organization
        state.provided.organization = matchedOrg.name;
        state.provided.project = undefined;
        
        // Update missing fields
        state.missingFields = state.missingFields.filter(f => f !== "organization");
        if (!state.missingFields.includes("project")) {
          state.missingFields.unshift("project");
        }
        
        state.lastAsked = "project";
        saveState(state);
        
        // Fetch fresh projects for the new organization
        const newProjects = await getProjectsForOrganization(matchedOrg.name);
        
        if (newProjects.length > 0) {
          const projectList = newProjects.map(p => `- ${p.name}`).join("\n");
          return {
            reply: `Done! I've switched to the **${matchedOrg.name}** organization.\n\nNow, which project would you like to create this user story for?\n\n${projectList}`,
            usedAgent: "story",
            metadata: {
              quickReplies: newProjects.slice(0, 5).map(p => `Project: ${p.name}`),
              missingFields: state.missingFields,
            },
          };
        } else {
          return {
            reply: `I've switched to **${matchedOrg.name}**, but I couldn't find any projects. This might be due to permissions or PAT configuration.\n\nWould you like to try a different organization?`,
            usedAgent: "story",
            metadata: {
              quickReplies: buildQuickRepliesForField("organization", organizations, []),
              missingFields: state.missingFields,
            },
          };
        }
      }
    }
    
    // Determine current flow phase for context
    let currentFlowPhase = "collecting_fields";
    if (state.acFlowStep === "asking_generate") currentFlowPhase = "asking_ac_generation";
    else if (state.acFlowStep === "showing_ac") currentFlowPhase = "reviewing_ac";
    else if (state.assigneeFlowStep === "asking_assign") currentFlowPhase = "asking_assignee";
    else if (state.assigneeFlowStep === "selecting_assignee") currentFlowPhase = "selecting_assignee";
    else if (state.confirmationPending) currentFlowPhase = "final_confirmation";
    
    // ==========================================
    // LLM-BASED MESSAGE INTERPRETATION
    // Every user message goes through the LLM first
    // ==========================================
    const interpretation = await interpretUserMessage(
      message,
      state,
      state.lastAsked,
      currentFlowPhase,
      { organizations, projects }
    );
    
    console.log(`[StoryAgent] State on entry: lastAsked=${state.lastAsked}, provided=${JSON.stringify(state.provided)}, missingFields=${JSON.stringify(state.missingFields)}`);
    console.log(`[StoryAgent] Interpreted message: action=${interpretation.action}, targetField=${interpretation.targetField}, fieldValue=${interpretation.fieldValue?.substring(0, 50)}, confidence=${interpretation.confidence}`);
    
    // Handle LLM-detected start_over request (context-aware restart)
    if (interpretation.action === "start_over") {
      console.log(`[StoryAgent] LLM detected explicit restart request`);
      resetState(userId, sessionId);
      const freshState = getState(userId, sessionId);
      activateStoryLock(freshState);

      // Format organizations list in the message text
      const orgList = organizations.length > 0
        ? `\n\nHere are the configured organizations:\n${organizations.map(org => `- ${org.name}`).join('\n')}`
        : "";

      return {
        reply: `No problem! Let's start fresh. I'll help you create a new user story. Which organization would you like to work with?${orgList}`,
        usedAgent: "story",
        metadata: {
          quickReplies: buildQuickRepliesForField("organization", organizations, []),
          missingFields: freshState.missingFields,
        },
      };
    }
    
    // Handle LLM-detected change_field request (user wants to change already-provided field)
    if (interpretation.action === "change_field") {
      console.log(`[StoryAgent] LLM detected field change request: target=${interpretation.changeFieldTarget}, value=${interpretation.changeFieldValue}`);
      
      if (interpretation.changeFieldTarget === "organization") {
        const targetOrgName = interpretation.changeFieldValue;
        
        if (targetOrgName) {
          // Check if the target organization exists
          const matchedOrg = organizations.find(o => 
            o.name.toLowerCase() === targetOrgName.toLowerCase()
          );
          
          if (matchedOrg) {
            // Clear organization and project, set new organization
            state.provided.organization = matchedOrg.name;
            state.provided.project = undefined;
            
            // Remove organization from missing fields if present, add project back
            state.missingFields = state.missingFields.filter(f => f !== "organization");
            if (!state.missingFields.includes("project")) {
              state.missingFields.unshift("project");
            }
            
            state.lastAsked = "project";
            saveState(state);
            
            // Fetch projects for the new organization
            const newProjects = await getProjectsForOrganization(matchedOrg.name);
            
            if (newProjects.length > 0) {
              const projectList = newProjects.map(p => `- ${p.name}`).join("\n");
              return {
                reply: `Got it! I've switched to the **${matchedOrg.name}** organization.\n\nWhich project within this organization would you like to create the user story for?\n\n${projectList}`,
                usedAgent: "story",
                metadata: {
                  quickReplies: newProjects.slice(0, 5).map(p => `Project: ${p.name}`),
                  missingFields: state.missingFields,
                },
              };
            } else {
              return {
                reply: `I've switched to the **${matchedOrg.name}** organization, but I couldn't find any projects. This might be due to permissions or the PAT configuration.\n\nWould you like to try a different organization?`,
                usedAgent: "story",
                metadata: {
                  quickReplies: buildQuickRepliesForField("organization", organizations, []),
                  missingFields: state.missingFields,
                },
              };
            }
          } else {
            // Organization name provided but not found - list available ones
            const orgList = organizations.map(o => `- ${o.name}`).join("\n");
            return {
              reply: `I couldn't find an organization named "${targetOrgName}". Here are the available organizations:\n\n${orgList}\n\nWhich one would you like to use?`,
              usedAgent: "story",
              metadata: {
                quickReplies: buildQuickRepliesForField("organization", organizations, []),
                missingFields: state.missingFields,
              },
            };
          }
        } else {
          // User wants to change organization but didn't specify which one
          // Clear organization and project
          state.provided.organization = undefined;
          state.provided.project = undefined;
          
          // Add organization back to missing fields
          if (!state.missingFields.includes("organization")) {
            state.missingFields.unshift("organization");
          }
          if (!state.missingFields.includes("project")) {
            state.missingFields.splice(1, 0, "project");
          }
          
          state.lastAsked = "organization";
          saveState(state);
          
          const orgList = organizations.map(o => `- ${o.name}`).join("\n");
          return {
            reply: `Sure! Which organization would you like to switch to?\n\n${orgList}`,
            usedAgent: "story",
            metadata: {
              quickReplies: buildQuickRepliesForField("organization", organizations, []),
              missingFields: state.missingFields,
            },
          };
        }
      }
    }
    
    // Handle questions and data requests BEFORE any rigid flow logic
    if (interpretation.action === "question" || interpretation.action === "data_request") {
      // User is asking a question - fetch and display the requested data
      if (interpretation.dataRequest === "projects") {
        // Fetch projects for the selected or mentioned organization
        let targetOrg = state.provided.organization ? String(state.provided.organization) : null;
        
        // Try to extract org name from the message if not already selected
        if (!targetOrg) {
          const orgMatch = organizations.find(o => 
            message.toLowerCase().includes(o.name.toLowerCase())
          );
          if (orgMatch) targetOrg = orgMatch.name;
        }
        
        if (targetOrg) {
          const orgProjects = await getProjectsForOrganization(targetOrg);
          if (orgProjects.length > 0) {
            const projectList = orgProjects.map(p => `- **${p.name}**${p.description ? `: ${p.description}` : ""}`).join("\n");
            return {
              reply: `Here are the projects available in **${targetOrg}**:\n\n${projectList}\n\nWhich project would you like to use for this story?`,
              usedAgent: "story",
              metadata: {
                quickReplies: [...orgProjects.slice(0, 5).map(p => p.name), "Skip for now"],
                missingFields: state.missingFields,
                projects: orgProjects,
              },
            };
          } else {
            return {
              reply: `I couldn't find any projects in **${targetOrg}**. This might be due to permissions or the organization not having any projects yet.\n\nWould you like to skip the project selection for now, or try a different organization?`,
              usedAgent: "story",
              metadata: {
                quickReplies: ["Skip for now", "Choose different org", "Start over"],
                missingFields: state.missingFields,
              },
            };
          }
        } else {
          return {
            reply: `To show you the available projects, I need to know which organization to look in. Please select an organization first:\n\n${organizations.map(o => `- ${o.name}`).join("\n")}`,
            usedAgent: "story",
            metadata: {
              quickReplies: [...organizations.map(o => `Use: ${o.name}`), "Help"],
              missingFields: state.missingFields,
            },
          };
        }
      } else if (interpretation.dataRequest === "organizations") {
        const orgList = organizations.length > 0
          ? organizations.map(o => `- **${o.name}** (${o.patConfigured ? "PAT configured" : "no PAT"})`).join("\n")
          : "No organizations configured yet.";
        
        return {
          reply: `Here are your configured Azure DevOps organizations:\n\n${orgList}\n\nWhich organization would you like to use?`,
          usedAgent: "story",
          metadata: {
            quickReplies: [...organizations.map(o => `Use: ${o.name}`), "Help"],
            missingFields: state.missingFields,
          },
        };
      } else if (interpretation.dataRequest === "users") {
        const orgName = state.provided.organization ? String(state.provided.organization) : null;
        if (orgName) {
          const users = await fetchADOUsers(orgName);
          if (users.length > 0) {
            const userList = users.slice(0, 10).map(u => `- ${u.displayName}`).join("\n");
            return {
              reply: `Here are team members in **${orgName}**:\n\n${userList}\n\nWho would you like to assign this story to?`,
              usedAgent: "story",
              metadata: {
                quickReplies: [...users.slice(0, 5).map(u => u.displayName), "Leave unassigned"],
                missingFields: state.missingFields,
              },
            };
          }
        }
        return {
          reply: "I'll be able to show you team members once we've selected an organization. Let's continue with the story creation first.",
          usedAgent: "story",
          metadata: {
            quickReplies: ["Continue", "Help", "Start over"],
            missingFields: state.missingFields,
          },
        };
      } else if (interpretation.dataRequest === "help") {
        // Generate intelligent help response
        const helpResponse = await generateIntelligentResponse(
          message,
          interpretation,
          state,
          { organizations, projects, pendingField: state.lastAsked }
        );
        return {
          reply: helpResponse.reply,
          usedAgent: "story",
          metadata: {
            quickReplies: helpResponse.quickReplies,
            missingFields: state.missingFields,
          },
        };
      } else {
        // General question - generate intelligent response
        const response = await generateIntelligentResponse(
          message,
          interpretation,
          state,
          { organizations, projects, pendingField: state.lastAsked }
        );
        return {
          reply: response.reply,
          usedAgent: "story",
          metadata: {
            quickReplies: response.quickReplies,
            missingFields: state.missingFields,
          },
        };
      }
    }
    
    // Handle clarification requests
    if (interpretation.action === "clarification") {
      // Get contextual help info and use it in the response
      const helpInfo = getContextualHelpMessage(state.lastAsked, currentFlowPhase);
      const response = await generateIntelligentResponse(
        message,
        interpretation,
        state,
        { organizations, projects, pendingField: state.lastAsked }
      );
      // Combine LLM response with contextual help if available
      const combinedReply = helpInfo.message 
        ? `${response.reply}\n\n**Additional context:**\n${helpInfo.message}`
        : response.reply;
      return {
        reply: combinedReply,
        usedAgent: "story",
        metadata: {
          quickReplies: response.quickReplies.length > 0 ? response.quickReplies : helpInfo.examples,
          missingFields: state.missingFields,
        },
      };
    }
    
    // Handle commands (skip, start over is already handled above)
    if (interpretation.action === "command") {
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes("skip")) {
        if (state.lastAsked) {
          const skippedField = state.lastAsked;
          // Only allow skipping truly optional fields (benefit)
          // Core fields (organization, project, persona, goal, priority, storyPoints) cannot be skipped
          const SKIPPABLE_FIELDS: StoryField[] = ["benefit"];
          
          if (!SKIPPABLE_FIELDS.includes(skippedField)) {
            console.log(`[StoryAgent] Cannot skip required field: ${skippedField}`);
            return {
              reply: `**${skippedField}** is a required field and cannot be skipped. Please provide a value or choose from the options below.`,
              usedAgent: "story",
              metadata: {
                quickReplies: buildQuickRepliesForField(skippedField, organizations, projects),
                missingFields: state.missingFields,
              },
            };
          }
          
          // Skip the optional field
          state.missingFields = state.missingFields.filter(f => f !== skippedField);
          state.lastAsked = null;
          saveState(state);
          console.log(`[StoryAgent] Skipped optional field: ${skippedField}`);
          // Continue to next question (fall through to the rest of the flow)
        }
      } else if (lowerMessage.includes("help") || lowerMessage === "?") {
        const helpInfo = getContextualHelpMessage(state.lastAsked, currentFlowPhase);
        return {
          reply: `**Here's some help:**\n\n${helpInfo.message}`,
          usedAgent: "story",
          metadata: {
            quickReplies: buildQuickRepliesForField(state.lastAsked || "organization", organizations, projects),
            missingFields: state.missingFields,
          },
        };
      }
    }
    
    // ==========================================
    // ANSWER PROCESSING
    // Only process as an answer if the LLM determined it's an answer WITH high confidence
    // ==========================================
    if (interpretation.action === "answer" && state.lastAsked) {
      const CONFIDENCE_THRESHOLD = 0.7;
      
      // Require high confidence for answer processing
      if (interpretation.confidence < CONFIDENCE_THRESHOLD) {
        // Low confidence - ask for confirmation before proceeding
        console.log(`[StoryAgent] Low confidence answer (${interpretation.confidence}) - asking for confirmation`);
        const helpInfo = getContextualHelpMessage(state.lastAsked, currentFlowPhase);
        const shortPreview = message.trim().substring(0, 30) + (message.length > 30 ? '...' : '');
        return {
          reply: `I want to make sure I understand correctly. For **${state.lastAsked}**, did you mean "${message.trim()}" as your answer?\n\nIf not, please try rephrasing or select from the options below.`,
          usedAgent: "story",
          metadata: {
            quickReplies: [`Yes, use "${shortPreview}"`, ...buildQuickRepliesForField(state.lastAsked, organizations, projects)],
            missingFields: state.missingFields,
          },
        };
      }
      
      // Check for quick reply format first (these are always trusted)
      const parsed = parseQuickReply(message);
      if (parsed.isQuickReply && parsed.field && parsed.value) {
        markFieldProvided(state, parsed.field, parsed.value);
        state.lastAsked = null;
        saveState(state);
      } else if (interpretation.fieldValue && interpretation.fieldValue.trim()) {
        // Validate the extracted field value for ALL fields
        const fieldValue = interpretation.fieldValue.trim();
        
        // Special validation for organization - STRICT equality match only
        if (state.lastAsked === "organization") {
          // Only accept exact case-insensitive match
          const matchedOrg = organizations.find(o => 
            o.name.toLowerCase() === fieldValue.toLowerCase()
          );
          if (!matchedOrg) {
            console.log(`[StoryAgent] Organization validation failed - no exact match for: ${fieldValue}`);
            return {
              reply: `I couldn't find an organization matching "${fieldValue}". Please select from your configured organizations:\n\n${organizations.map(o => `- ${o.name}`).join("\n")}`,
              usedAgent: "story",
              metadata: {
                quickReplies: buildQuickRepliesForField("organization", organizations, projects),
                missingFields: state.missingFields,
              },
            };
          }
          markFieldProvided(state, state.lastAsked, matchedOrg.name);
          state.lastAsked = null;
          saveState(state);
        } 
        // Special validation for project - STRICT equality match only
        else if (state.lastAsked === "project") {
          // Need projects list to validate
          if (projects.length === 0) {
            console.log(`[StoryAgent] Cannot validate project - no projects loaded`);
            return {
              reply: `I need to load the projects first. Could you select your organization again so I can fetch the available projects?`,
              usedAgent: "story",
              metadata: {
                quickReplies: buildQuickRepliesForField("organization", organizations, projects),
                missingFields: state.missingFields,
              },
            };
          }
          // Only accept exact case-insensitive match
          const matchedProject = projects.find(p => 
            p.name.toLowerCase() === fieldValue.toLowerCase()
          );
          if (!matchedProject) {
            console.log(`[StoryAgent] Project validation failed - no exact match for: ${fieldValue}`);
            
            // SMART CHECK: Does the input match an organization name?
            // This handles the case where user types an org name when we're asking for project
            const matchingOrg = organizations.find(o => 
              o.name.toLowerCase() === fieldValue.toLowerCase()
            );
            
            if (matchingOrg) {
              console.log(`[StoryAgent] Input "${fieldValue}" matches organization name - offering to switch`);
              const projectList = projects.map(p => `- ${p.name}`).join("\n");
              return {
                reply: `I notice "${fieldValue}" is an organization, not a project. I'm currently looking at the **${state.provided.organization}** organization.\n\n**Would you like to switch to the ${matchingOrg.name} organization?**\n\nIf not, please select a project from the list below:\n\n${projectList}`,
                usedAgent: "story",
                metadata: {
                  quickReplies: [
                    `Yes, switch to ${matchingOrg.name}`,
                    ...projects.slice(0, 4).map(p => `Project: ${p.name}`)
                  ],
                  missingFields: state.missingFields,
                },
              };
            }
            
            // Check if this looks like a goal instead of a project name
            // If the input is long and descriptive, user might be trying to provide the goal before selecting project
            if (fieldValue.length > 20 && /\b(want|need|create|build|add|implement|develop|dashboard|page|feature|system|application)\b/i.test(fieldValue)) {
              console.log(`[StoryAgent] Input looks like a goal, not a project. Prompting for project selection first.`);
              return {
                reply: `It looks like you're describing what you want to build! That's great, but first I need to know which project to create this story in.\n\nPlease select a project from the list below:`,
                usedAgent: "story",
                metadata: {
                  quickReplies: buildQuickRepliesForField("project", organizations, projects),
                  missingFields: state.missingFields,
                },
              };
            }
            return {
              reply: `I couldn't find a project matching "${fieldValue}". Please select from the available projects:\n\n${projects.map(p => `- ${p.name}`).join("\n")}`,
              usedAgent: "story",
              metadata: {
                quickReplies: buildQuickRepliesForField("project", organizations, projects),
                missingFields: state.missingFields,
              },
            };
          }
          markFieldProvided(state, state.lastAsked, matchedProject.name);
          state.lastAsked = null;
          saveState(state);
        }
        // Use standard validation for other fields
        else {
          // Use LLM-based validation for persona with goal context
          if (state.lastAsked === "persona") {
            const personaValidation = await validatePersonaWithLLM(fieldValue, state.provided.goal as string | undefined);
            if (!personaValidation.isValid) {
              console.log(`[StoryAgent] Persona LLM validation failed: ${personaValidation.reason}`);
              return {
                reply: `${personaValidation.reason}\n\n${personaValidation.suggestion || ""}`,
                usedAgent: "story",
                metadata: {
                  quickReplies: buildQuickRepliesForField(state.lastAsked, organizations, projects),
                  missingFields: state.missingFields,
                },
              };
            }
          } else if (state.lastAsked === "goal") {
            // Use LLM-based validation for goal with project context
            const goalValidation = await validateGoalWithLLM(fieldValue, state.provided.project as string | undefined);
            if (!goalValidation.isValid) {
              console.log(`[StoryAgent] Goal LLM validation failed: ${goalValidation.reason}`);
              return {
                reply: `${goalValidation.reason}\n\n${goalValidation.suggestion || ""}`,
                usedAgent: "story",
                metadata: {
                  quickReplies: buildQuickRepliesForField(state.lastAsked, organizations, projects),
                  missingFields: state.missingFields,
                },
              };
            }
          } else {
            const validationResult = validateFieldResponse(state.lastAsked, fieldValue);
            if (!validationResult.isValid) {
              console.log(`[StoryAgent] Field validation failed: ${validationResult.reason}`);
              return {
                reply: `${validationResult.reason}\n\n${validationResult.suggestion}`,
                usedAgent: "story",
                metadata: {
                  quickReplies: buildQuickRepliesForField(state.lastAsked, organizations, projects),
                  missingFields: state.missingFields,
                },
              };
            }
          }
          // Validation passed - use the LLM-extracted field value
          markFieldProvided(state, state.lastAsked, fieldValue);
          state.lastAsked = null;
          saveState(state);
        }
      } else {
        // No fieldValue from LLM - try to extract with text extraction
        // But ALWAYS validate before accepting
        const extracted = tryExtractFieldsFromText(message, state.lastAsked);
        let hasValidExtraction = false;
        
        for (const [field, value] of Object.entries(extracted)) {
          if (value !== undefined && String(value).trim()) {
            const fieldValue = String(value).trim();
            const fieldName = field as StoryField;
            
            // Validate ALL extracted values with STRICT matching
            if (fieldName === "organization") {
              // Exact match only
              const matchedOrg = organizations.find(o => 
                o.name.toLowerCase() === fieldValue.toLowerCase()
              );
              if (matchedOrg) {
                markFieldProvided(state, fieldName, matchedOrg.name);
                hasValidExtraction = true;
              }
            } else if (fieldName === "project") {
              // Exact match only, and require projects to be loaded
              if (projects.length > 0) {
                const matchedProject = projects.find(p => 
                  p.name.toLowerCase() === fieldValue.toLowerCase()
                );
                if (matchedProject) {
                  markFieldProvided(state, fieldName, matchedProject.name);
                  hasValidExtraction = true;
                }
              }
            } else if (fieldName === "persona") {
              // Use LLM-based validation for persona
              const personaValidation = await validatePersonaWithLLM(fieldValue, state.provided.goal as string | undefined);
              if (personaValidation.isValid) {
                markFieldProvided(state, fieldName, fieldValue);
                hasValidExtraction = true;
              } else {
                console.log(`[StoryAgent] Persona LLM validation failed: ${personaValidation.reason}`);
              }
            } else if (fieldName === "goal") {
              // Use LLM-based validation for goal
              const goalValidation = await validateGoalWithLLM(fieldValue, state.provided.project as string | undefined);
              if (goalValidation.isValid) {
                markFieldProvided(state, fieldName, fieldValue);
                hasValidExtraction = true;
              } else {
                console.log(`[StoryAgent] Goal LLM validation failed: ${goalValidation.reason}`);
              }
            } else {
              // Use standard validation for other fields
              const validationResult = validateFieldResponse(fieldName, fieldValue);
              if (validationResult.isValid) {
                markFieldProvided(state, fieldName, value);
                hasValidExtraction = true;
              } else {
                console.log(`[StoryAgent] Extracted value validation failed: ${validationResult.reason}`);
              }
            }
          }
        }
        
        // Only use raw message if extraction failed AND message passes STRICT validation
        if (!hasValidExtraction) {
          const trimmedMessage = message.trim();
          
          // Special validation for organization - STRICT exact match only
          if (state.lastAsked === "organization") {
            const matchedOrg = organizations.find(o => 
              o.name.toLowerCase() === trimmedMessage.toLowerCase()
            );
            if (matchedOrg) {
              markFieldProvided(state, state.lastAsked, matchedOrg.name);
              hasValidExtraction = true;
            }
            // No match = hasValidExtraction stays false, will trigger clarification
          } 
          // Special validation for project - STRICT exact match only
          else if (state.lastAsked === "project") {
            // Require projects to be loaded for validation
            if (projects.length > 0) {
              const matchedProject = projects.find(p => 
                p.name.toLowerCase() === trimmedMessage.toLowerCase()
              );
              if (matchedProject) {
                markFieldProvided(state, state.lastAsked, matchedProject.name);
                hasValidExtraction = true;
              }
            }
            // No match or no projects = hasValidExtraction stays false, will trigger clarification
          }
          // LLM-based validation for persona
          else if (state.lastAsked === "persona") {
            const personaValidation = await validatePersonaWithLLM(trimmedMessage, state.provided.goal as string | undefined);
            if (personaValidation.isValid) {
              markFieldProvided(state, state.lastAsked, trimmedMessage);
              hasValidExtraction = true;
            }
          }
          // LLM-based validation for goal
          else if (state.lastAsked === "goal") {
            const goalValidation = await validateGoalWithLLM(trimmedMessage, state.provided.project as string | undefined);
            if (goalValidation.isValid) {
              markFieldProvided(state, state.lastAsked, trimmedMessage);
              hasValidExtraction = true;
            }
          }
          // Standard validation for all other fields - ALWAYS use validateFieldResponse
          else {
            const validationResult = validateFieldResponse(state.lastAsked, trimmedMessage);
            if (validationResult.isValid) {
              markFieldProvided(state, state.lastAsked, trimmedMessage);
              hasValidExtraction = true;
            }
          }
        }
        
        if (hasValidExtraction) {
          state.lastAsked = null;
          saveState(state);
        } else {
          // Could not extract a valid answer - ask for clarification
          const helpInfo = getContextualHelpMessage(state.lastAsked, currentFlowPhase);
          return {
            reply: `I couldn't understand your answer for **${state.lastAsked}**. ${helpInfo.message}`,
            usedAgent: "story",
            metadata: {
              quickReplies: buildQuickRepliesForField(state.lastAsked, organizations, projects),
              missingFields: state.missingFields,
            },
          };
        }
      }
    } else if (interpretation.action === "answer" && !state.lastAsked) {
      // User provided an answer but we don't have a pending question
      const HIGH_CONFIDENCE_NO_PENDING = 0.8;
      
      // If confidence is too low, ask for clarification explicitly
      if (interpretation.confidence < HIGH_CONFIDENCE_NO_PENDING || !interpretation.targetField || !interpretation.fieldValue) {
        console.log(`[StoryAgent] Low confidence answer without pending field (${interpretation.confidence}) - asking for clarification`);
        return {
          reply: `I'm not quite sure what you meant. Could you please be more specific about what you'd like to provide?`,
          usedAgent: "story",
          metadata: {
            quickReplies: ["Create a story", "Show projects", "Help", "Start over"],
            missingFields: state.missingFields,
          },
        };
      }
      
      // IMPORTANT: Handle field updates properly
      // If user explicitly provides an organization/project name, allow them to CHANGE it
      // (e.g., user selected "omjha0827" from context but now says "Use: ProcessTestApp")
      const targetField = interpretation.targetField as StoryField;
      let actualTargetField = targetField;
      
      // Special handling for organization: Allow user to change it even if already set
      if (targetField === "organization" && state.provided.organization !== undefined) {
        const newOrgName = interpretation.fieldValue?.trim().toLowerCase();
        const currentOrg = String(state.provided.organization).toLowerCase();
        
        if (newOrgName && newOrgName !== currentOrg) {
          console.log(`[StoryAgent] User wants to CHANGE organization from "${state.provided.organization}" to "${interpretation.fieldValue}"`);
          // Remove organization from provided so it can be updated
          delete state.provided.organization;
          // Also clear project since it depends on organization
          delete state.provided.project;
          // Add organization and project back to missing fields
          if (!state.missingFields.includes("organization")) {
            state.missingFields.unshift("organization");
          }
          if (!state.missingFields.includes("project")) {
            const orgIdx = state.missingFields.indexOf("organization");
            state.missingFields.splice(orgIdx + 1, 0, "project");
          }
          saveState(state);
          // Keep actualTargetField as organization
        } else {
          // Same organization - reroute to next missing field
          console.log(`[StoryAgent] Same organization selected, routing to next missing field`);
          if (state.missingFields.length > 0) {
            actualTargetField = state.missingFields[0] as StoryField;
          }
        }
      } else if (state.provided[targetField] !== undefined && state.missingFields.length > 0) {
        // For other fields: if already provided, reroute to first missing field
        console.log(`[StoryAgent] LLM said targetField=${targetField} but it's already provided. Checking missing fields: ${state.missingFields}`);
        actualTargetField = state.missingFields[0] as StoryField;
        console.log(`[StoryAgent] Rerouting to first missing field: ${actualTargetField}`);
      }
      
      // High confidence - validate before accepting
      const fieldValue = interpretation.fieldValue.trim();
      
      // ALWAYS validate ALL fields before marking
      // Use actualTargetField which may have been rerouted from a misclassified field
      // For organization/project, use strict matching
      if (actualTargetField === "organization") {
        const matchedOrg = organizations.find(o => 
          o.name.toLowerCase() === fieldValue.toLowerCase()
        );
        if (!matchedOrg) {
          return {
            reply: `I couldn't find an organization matching "${fieldValue}". Please select from your configured organizations:\n\n${organizations.map(o => `- ${o.name}`).join("\n")}`,
            usedAgent: "story",
            metadata: {
              quickReplies: buildQuickRepliesForField("organization", organizations, projects),
              missingFields: state.missingFields,
            },
          };
        }
        markFieldProvided(state, actualTargetField, matchedOrg.name);
        saveState(state);
      } else if (actualTargetField === "project") {
        if (projects.length === 0) {
          // Check if organization is set - if so, the issue is API access, not missing org
          if (state.provided.organization) {
            const orgName = String(state.provided.organization);
            return {
              reply: `I couldn't load projects for **${orgName}**. This could be due to an expired or invalid PAT token, or the organization may not have any projects. Would you like to try a different organization or check your settings?`,
              usedAgent: "story",
              metadata: {
                quickReplies: [
                  ...organizations.filter(o => o.name !== orgName).map(o => `Use: ${o.name}`),
                  "Check my settings",
                  "Start over",
                  "Help"
                ],
                missingFields: state.missingFields,
              },
            };
          }
          return {
            reply: `I need to know your organization first. Which organization would you like to work with?`,
            usedAgent: "story",
            metadata: {
              quickReplies: buildQuickRepliesForField("organization", organizations, projects),
              missingFields: state.missingFields,
            },
          };
        }
        const matchedProject = projects.find(p => 
          p.name.toLowerCase() === fieldValue.toLowerCase()
        );
        if (!matchedProject) {
          return {
            reply: `I couldn't find a project matching "${fieldValue}". Please select from the available projects:\n\n${projects.map(p => `- ${p.name}`).join("\n")}`,
            usedAgent: "story",
            metadata: {
              quickReplies: buildQuickRepliesForField("project", organizations, projects),
              missingFields: state.missingFields,
            },
          };
        }
        markFieldProvided(state, actualTargetField, matchedProject.name);
        saveState(state);
      } else if (actualTargetField === "persona") {
        // Use LLM-based validation for persona
        const personaValidation = await validatePersonaWithLLM(fieldValue, state.provided.goal as string | undefined);
        if (!personaValidation.isValid) {
          return {
            reply: `${personaValidation.reason}\n\n${personaValidation.suggestion || ""}`,
            usedAgent: "story",
            metadata: {
              quickReplies: buildQuickRepliesForField(actualTargetField, organizations, projects),
              missingFields: state.missingFields,
            },
          };
        }
        markFieldProvided(state, actualTargetField, fieldValue);
        saveState(state);
      } else if (actualTargetField === "goal") {
        // Use LLM-based validation for goal
        const goalValidation = await validateGoalWithLLM(fieldValue, state.provided.project as string | undefined);
        if (!goalValidation.isValid) {
          return {
            reply: `${goalValidation.reason}\n\n${goalValidation.suggestion || ""}`,
            usedAgent: "story",
            metadata: {
              quickReplies: buildQuickRepliesForField(actualTargetField, organizations, projects),
              missingFields: state.missingFields,
            },
          };
        }
        markFieldProvided(state, actualTargetField, fieldValue);
        saveState(state);
      } else {
        // For all other fields, use validateFieldResponse
        const validationResult = validateFieldResponse(actualTargetField, fieldValue);
        if (!validationResult.isValid) {
          return {
            reply: `${validationResult.reason}\n\n${validationResult.suggestion}`,
            usedAgent: "story",
            metadata: {
              quickReplies: buildQuickRepliesForField(actualTargetField, organizations, projects),
              missingFields: state.missingFields,
            },
          };
        }
        markFieldProvided(state, actualTargetField, fieldValue);
        saveState(state);
      }
    }
    
    // Refresh projects list if needed (already fetched at the top)
    if (state.provided.organization && projects.length === 0) {
      projects = await getProjectsForOrganization(String(state.provided.organization));
    }

    // IMPORTANT: Check flow states FIRST before any fallback handling
    // When we're in a specific flow state (AC, test cases, assignee), handle those first
    // This ensures quick reply responses like "Accept", "Yes - generate" are handled by dedicated helper functions
    if (isAllFieldsProvided(state)) {
      console.log("[StoryAgent] All core fields provided. AC step:", state.acFlowStep, "Assignee step:", state.assigneeFlowStep);

      if (state.acFlowStep === "not_started") {
        state.acFlowStep = "asking_generate";
        saveState(state);

        return {
          reply: "All story details collected! Please add acceptance criteria or would you like me to generate acceptance criteria for this story?",
          usedAgent: "story",
          metadata: {
            quickReplies: ["Yes - generate", "Don't add acceptance criteria"],
            missingFields: [],
          },
        };
      }

      if (state.acFlowStep === "asking_generate") {
        if (isYesGenerateACMessage(message)) {
          state.acFlowStep = "generating";
          saveState(state);

          const aiCriteria = await generateAIAcceptanceCriteria(state);
          state.generatedAcceptanceCriteria = aiCriteria;
          state.acFlowStep = "showing_ac";
          saveState(state);

          const criteriaText = aiCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n");

          return {
            reply: `Here are the generated acceptance criteria:\n\n${criteriaText}\n\nDo you accept these acceptance criteria?`,
            usedAgent: "story",
            metadata: {
              quickReplies: ["Accept", "Edit", "Reject", "Start over"],
              missingFields: [],
            },
          };
        } else if (isNoSkipACMessage(message)) {
          // User wants to add their own AC - prompt them to provide it
          state.acFlowStep = "collecting_user_ac";
          state.generatedAcceptanceCriteria = [];
          saveState(state);

          return {
            reply: "Please provide your acceptance criteria for this story. You can enter them one at a time, or type multiple criteria separated by commas or new lines.",
            usedAgent: "story",
            metadata: {
              quickReplies: ["Generate instead", "Skip criteria", "Start over"],
              missingFields: [],
            },
          };
        }
      }

      // Handle user adding their own acceptance criteria
      if (state.acFlowStep === "collecting_user_ac") {
        // Handle "Skip criteria" - user wants to skip without adding any
        if (message.toLowerCase().includes("skip")) {
          state.generatedAcceptanceCriteria = generateAcceptanceCriteria(
            String(state.provided.goal),
            state.provided.benefit ? String(state.provided.benefit) : undefined
          );
          state.acFlowStep = "ac_skipped";
          saveState(state);
        } else if (isDoneAddingTestsMessage(message)) {
          // User says "Done" - only proceed if they've added criteria
          if (state.generatedAcceptanceCriteria && state.generatedAcceptanceCriteria.length > 0) {
            state.acFlowStep = "ac_confirmed";
            saveState(state);
          } else {
            // No AC provided yet - prompt them to add some or skip
            return {
              reply: "You haven't added any acceptance criteria yet. Please provide at least one criterion, or choose an option below.",
              usedAgent: "story",
              metadata: {
                quickReplies: ["Generate instead", "Skip criteria", "Start over"],
                missingFields: [],
              },
            };
          }
        } else if (message.toLowerCase().includes("generate instead")) {
          // User changed their mind, wants AI generation
          state.acFlowStep = "generating";
          saveState(state);

          const aiCriteria = await generateAIAcceptanceCriteria(state);
          state.generatedAcceptanceCriteria = aiCriteria;
          state.acFlowStep = "showing_ac";
          saveState(state);

          const criteriaText = aiCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n");

          return {
            reply: `Here are the generated acceptance criteria:\n\n${criteriaText}\n\nDo you accept these acceptance criteria?`,
            usedAgent: "story",
            metadata: {
              quickReplies: ["Accept", "Edit", "Reject", "Start over"],
              missingFields: [],
            },
          };
        } else if (!isStartOverMessage(message) && message.trim().length > 5) {
          // User is adding custom AC
          if (!state.generatedAcceptanceCriteria) {
            state.generatedAcceptanceCriteria = [];
          }
          // Parse multiple AC if comma or newline separated
          const newCriteria = message.split(/[,\n]/).map(c => c.trim()).filter(c => c.length > 3);
          state.generatedAcceptanceCriteria.push(...newCriteria);
          saveState(state);

          const currentCount = state.generatedAcceptanceCriteria.length;
          return {
            reply: `Added ${newCriteria.length} acceptance criteria (total: ${currentCount}). Add more or say 'done' when finished.`,
            usedAgent: "story",
            metadata: {
              quickReplies: ["Done", "Add more", "Start over"],
              missingFields: [],
            },
          };
        }
      }

      if (state.acFlowStep === "showing_ac") {
        if (isAcceptACMessage(message)) {
          state.acFlowStep = "ac_confirmed";
          saveState(state);
        } else if (isRejectACMessage(message)) {
          state.acFlowStep = "ac_skipped";
          state.generatedAcceptanceCriteria = generateAcceptanceCriteria(
            String(state.provided.goal),
            state.provided.benefit ? String(state.provided.benefit) : undefined
          );
          saveState(state);
        } else if (isEditRequestMessage(message)) {
          return {
            reply: "Please type your custom acceptance criteria (one per line or comma-separated), or click a quick option:",
            usedAgent: "story",
            metadata: {
              quickReplies: ["Use generated ones", "Skip for now", "Start over"],
              missingFields: [],
            },
          };
        }
      }

      // After AC, ask about test cases
      // Handle both uninitialized (undefined) and "not_started" states
      if ((state.acFlowStep === "ac_confirmed" || state.acFlowStep === "ac_skipped") && 
          (!state.testCasesFlowStep || state.testCasesFlowStep === "not_started")) {
        state.testCasesFlowStep = "asking_add_tests";
        saveState(state);

        return {
          reply: "Would you like to add test cases for this story? I can generate them for you or you can add your own.",
          usedAgent: "story",
          metadata: {
            quickReplies: ["Yes, generate test cases", "No, skip test cases", "I'll add my own"],
            missingFields: [],
          },
        };
      }

      // Handle test cases flow
      if (state.testCasesFlowStep === "asking_add_tests") {
        if (isYesAddTestsMessage(message) || message.toLowerCase().includes("generate")) {
          state.testCasesFlowStep = "collecting_tests";
          saveState(state);

          const aiTestCases = await generateAITestCases(state);
          state.generatedTestCases = aiTestCases;
          state.testCasesFlowStep = "collecting_tests";
          saveState(state);

          const testCasesText = aiTestCases.map((tc, i) => `${i + 1}. ${tc}`).join("\n");

          return {
            reply: `Here are the generated test cases:\n\n${testCasesText}\n\nDo you accept these test cases, or would you like to modify them?`,
            usedAgent: "story",
            metadata: {
              quickReplies: ["Accept", "Add more", "Skip test cases", "Start over"],
              missingFields: [],
            },
          };
        } else if (message.toLowerCase().includes("my own") || message.toLowerCase().includes("add my own")) {
          state.testCasesFlowStep = "collecting_user_tests";
          state.generatedTestCases = [];
          saveState(state);

          return {
            reply: "Please provide your test cases for this story. You can enter them one at a time, or type multiple test cases separated by commas or new lines.",
            usedAgent: "story",
            metadata: {
              quickReplies: ["Generate instead", "Skip test cases", "Start over"],
              missingFields: [],
            },
          };
        } else if (isNoSkipTestsMessage(message)) {
          state.testCasesFlowStep = "tests_skipped";
          state.generatedTestCases = [];
          saveState(state);
        }
      }

      // Handle user adding their own test cases
      if (state.testCasesFlowStep === "collecting_user_tests") {
        // Handle "Skip test cases" 
        if (isNoSkipTestsMessage(message)) {
          state.testCasesFlowStep = "tests_skipped";
          state.generatedTestCases = [];
          saveState(state);
        } else if (isDoneAddingTestsMessage(message)) {
          // User says "Done" - only proceed if they've added test cases
          if (state.generatedTestCases && state.generatedTestCases.length > 0) {
            state.testCasesFlowStep = "tests_confirmed";
            saveState(state);
          } else {
            // No test cases provided yet - prompt them
            return {
              reply: "You haven't added any test cases yet. Please provide at least one test case, or choose an option below.",
              usedAgent: "story",
              metadata: {
                quickReplies: ["Generate instead", "Skip test cases", "Start over"],
                missingFields: [],
              },
            };
          }
        } else if (message.toLowerCase().includes("generate instead")) {
          // User changed their mind, wants AI generation
          const aiTestCases = await generateAITestCases(state);
          state.generatedTestCases = aiTestCases;
          state.testCasesFlowStep = "collecting_tests";
          saveState(state);

          const testCasesText = aiTestCases.map((tc, i) => `${i + 1}. ${tc}`).join("\n");

          return {
            reply: `Here are the generated test cases:\n\n${testCasesText}\n\nDo you accept these test cases?`,
            usedAgent: "story",
            metadata: {
              quickReplies: ["Accept", "Add more", "Skip test cases", "Start over"],
              missingFields: [],
            },
          };
        } else if (!isStartOverMessage(message) && message.trim().length > 5) {
          // User is adding custom test cases
          if (!state.generatedTestCases) {
            state.generatedTestCases = [];
          }
          // Parse multiple test cases if comma or newline separated
          const newTestCases = message.split(/[,\n]/).map(c => c.trim()).filter(c => c.length > 3);
          state.generatedTestCases.push(...newTestCases);
          saveState(state);

          const currentCount = state.generatedTestCases.length;
          return {
            reply: `Added ${newTestCases.length} test case(s) (total: ${currentCount}). Add more or say 'done' when finished.`,
            usedAgent: "story",
            metadata: {
              quickReplies: ["Done", "Add more", "Start over"],
              missingFields: [],
            },
          };
        }
      }

      if (state.testCasesFlowStep === "collecting_tests") {
        if (isAcceptTestsMessage(message)) {
          state.testCasesFlowStep = "tests_confirmed";
          saveState(state);
        } else if (isRejectTestsMessage(message) || isNoSkipTestsMessage(message)) {
          state.testCasesFlowStep = "tests_skipped";
          state.generatedTestCases = [];
          saveState(state);
        } else if (isDoneAddingTestsMessage(message)) {
          state.testCasesFlowStep = "tests_confirmed";
          saveState(state);
        } else if (message.toLowerCase().includes("add more")) {
          return {
            reply: "Please enter additional test cases one at a time. Say 'done' when you're finished.",
            usedAgent: "story",
            metadata: {
              quickReplies: ["Done", "Skip test cases"],
              missingFields: [],
            },
          };
        } else if (!isStartOverMessage(message) && !isSkipMessage(message) && message.trim().length > 5) {
          // User is adding a custom test case
          if (!state.generatedTestCases) {
            state.generatedTestCases = [];
          }
          state.generatedTestCases.push(message.trim());
          saveState(state);

          const currentTestCases = state.generatedTestCases.map((tc, i) => `${i + 1}. ${tc}`).join("\n");

          return {
            reply: `Added! Current test cases:\n\n${currentTestCases}\n\nAdd another test case or say 'done' to continue.`,
            usedAgent: "story",
            metadata: {
              quickReplies: ["Done", "Add more", "Skip test cases"],
              missingFields: [],
            },
          };
        }
      }

      // After test cases, ask about assignee
      const testCasesDone = state.testCasesFlowStep === "tests_confirmed" || state.testCasesFlowStep === "tests_skipped";
      if ((state.acFlowStep === "ac_confirmed" || state.acFlowStep === "ac_skipped") &&
          testCasesDone && 
          state.assigneeFlowStep === "not_started") {
        state.assigneeFlowStep = "asking_assign";
        saveState(state);

        return {
          reply: "Would you like to assign this story to someone?",
          usedAgent: "story",
          metadata: {
            quickReplies: ["Yes", "No - leave unassigned", "Start over"],
            missingFields: [],
          },
        };
      }

      if (state.assigneeFlowStep === "asking_assign") {
        if (isYesAssignMessage(message)) {
          state.assigneeFlowStep = "selecting_assignee";

          const users = await fetchADOUsers(String(state.provided.organization));
          state.availableAssignees = users;
          saveState(state);

          const userReplies = users.slice(0, 5).map(u => u.displayName);

          return {
            reply: "Who should I assign this story to?",
            usedAgent: "story",
            metadata: {
              quickReplies: [...userReplies, "Leave unassigned", "Type a name"],
              missingFields: [],
            },
          };
        } else if (isNoAssignMessage(message)) {
          state.assigneeFlowStep = "assignee_skipped";
          state.selectedAssignee = undefined;
          state.assigneeAction = "leave_unassigned";
          state.assigneeQuery = undefined;
          state.assigneeResolved = undefined;
          saveState(state);
        }
      }

      if (state.assigneeFlowStep === "selecting_assignee") {
        const assigneeName = extractAssigneeName(message, state.availableAssignees || []);

        if (assigneeName && !isNoAssignMessage(message)) {
          // First check if it matches our cached available assignees
          const matchedUser = state.availableAssignees?.find(
            u => u.displayName.toLowerCase() === assigneeName.toLowerCase() ||
                 u.email.toLowerCase() === assigneeName.toLowerCase()
          );

          if (matchedUser && matchedUser.email) {
            // User found in cached list - proceed
            state.selectedAssignee = matchedUser.displayName;
            state.assigneeAction = "assign_resolved";
            state.assigneeQuery = matchedUser.displayName;
            state.assigneeResolved = {
              displayName: matchedUser.displayName,
              uniqueName: matchedUser.email,
            };
            state.assigneeFlowStep = "assignee_confirmed";
            saveState(state);
          } else {
            // User not in cached list - validate against ADO
            console.log(`[StoryAgent] Custom assignee entered: "${assigneeName}" - validating against ADO`);
            const validatedUser = await validateAssigneeInADO(
              String(state.provided.organization),
              assigneeName
            );
            
            if (validatedUser) {
              // User found in ADO - proceed with resolved identity
              state.selectedAssignee = validatedUser.displayName;
              state.assigneeAction = "assign_resolved";
              state.assigneeQuery = validatedUser.displayName;
              state.assigneeResolved = {
                displayName: validatedUser.displayName,
                uniqueName: validatedUser.email,
              };
              state.assigneeFlowStep = "assignee_confirmed";
              saveState(state);
            } else {
              // User NOT found in ADO - ask to choose valid assignee or leave unassigned
              console.log(`[StoryAgent] Assignee "${assigneeName}" not found in ADO - prompting user`);
              const userReplies = (state.availableAssignees || []).slice(0, 5).map(u => u.displayName);
              
              return {
                reply: `I couldn't find **"${assigneeName}"** in Azure DevOps for this organization.\n\nPlease select from the available team members or choose to leave unassigned:`,
                usedAgent: "story",
                metadata: {
                  quickReplies: ["Leave unassigned", ...userReplies],
                  missingFields: [],
                },
              };
            }
          }
        } else if (isNoAssignMessage(message) || message.toLowerCase().includes("leave unassigned")) {
          state.assigneeFlowStep = "assignee_skipped";
          state.selectedAssignee = undefined;
          state.assigneeAction = "leave_unassigned";
          state.assigneeQuery = undefined;
          state.assigneeResolved = undefined;
          saveState(state);
        } else {
          return {
            reply: "Please select an assignee from the list or type a name:",
            usedAgent: "story",
            metadata: {
              quickReplies: [
                ...(state.availableAssignees || []).slice(0, 5).map(u => u.displayName),
                "Leave unassigned"
              ],
              missingFields: [],
            },
          };
        }
      }

      const testCasesDoneForSummary = state.testCasesFlowStep === "tests_confirmed" || state.testCasesFlowStep === "tests_skipped";
      if ((state.acFlowStep === "ac_confirmed" || state.acFlowStep === "ac_skipped") &&
          testCasesDoneForSummary &&
          (state.assigneeFlowStep === "assignee_confirmed" || state.assigneeFlowStep === "assignee_skipped")) {

        if (!state.generatedSummary) {
          const userStory = generateUserStoryStatement(state);
          const title = generateStoryTitle(String(state.provided.goal));
          const description = `This story enables ${state.provided.persona} to ${state.provided.goal}.${state.provided.benefit ? ` The expected benefit is to ${state.provided.benefit}.` : ""}`;

          let assigneeAction: AssigneeAction = "leave_unassigned";
          let assigneeQuery: string | undefined;
          let assigneeResolved: ResolvedAssignee | undefined;

          if (state.assigneeAction) {
            assigneeAction = state.assigneeAction;
            assigneeQuery = state.assigneeQuery;
            assigneeResolved = state.assigneeResolved;
          } else if (state.selectedAssignee) {
            if (state.selectedAssignee.includes("@")) {
              assigneeAction = "assign_resolved";
              assigneeResolved = {
                displayName: state.selectedAssignee,
                uniqueName: state.selectedAssignee,
              };
            } else {
              assigneeAction = "assign_manual";
              assigneeQuery = state.selectedAssignee;
            }
          }

          state.generatedSummary = {
            title,
            userStory,
            description,
            acceptanceCriteria: state.generatedAcceptanceCriteria || [],
            testCases: state.generatedTestCases || [],
            priority: String(state.provided.priority || "Medium"),
            storyPoints: typeof state.provided.storyPoints === "number" ? state.provided.storyPoints : 3,
            assigneeAction,
            assigneeQuery,
            assigneeResolved,
          };
          saveState(state);
        }

        if (state.confirmationPending) {
          if (isCreateInADOMessage(message)) {
            const payload = buildWorkItemPayload(state);

            if (!payload) {
              return {
                reply: "Error: Unable to build work item payload. Please try again.",
                usedAgent: "story",
                metadata: {
                  quickReplies: ["Start over", "Help"],
                  missingFields: [],
                },
              };
            }

            const providedOrg = String(state.provided.organization).toLowerCase();
            console.log(`[StoryAgent] Looking for org: "${providedOrg}" in ${organizations.length} organizations`);
            console.log(`[StoryAgent] Available orgs:`, organizations.map(o => ({ name: o.name, url: o.organizationUrl })));

            const org = organizations.find(o => 
              o.name.toLowerCase() === providedOrg ||
              o.name.toLowerCase().includes(providedOrg) ||
              providedOrg.includes(o.name.toLowerCase()) ||
              o.organizationUrl.toLowerCase().includes(providedOrg) ||
              o.projectName?.toLowerCase() === providedOrg
            );

            if (org) {
              console.log(`[StoryAgent] Found org: ${org.name} -> ${org.organizationUrl}`);
              payload.organizationUrl = org.organizationUrl;
              payload.projectName = String(state.provided.project || org.projectName);
            } else {
              console.error(`[StoryAgent] Organization not found! Provided: "${state.provided.organization}"`);
              return {
                reply: `Could not find the organization "${state.provided.organization}" in your configured settings. Please check your Azure DevOps configuration in Settings.`,
                usedAgent: "story",
                metadata: {
                  quickReplies: ["Start over", "View settings", "Help"],
                  missingFields: [],
                },
              };
            }

            return {
              reply: buildFinalSummaryPrompt(state),
              usedAgent: "story",
              metadata: {
                quickReplies: [],
                missingFields: [],
                generatedStory: state.generatedSummary,
                canCreateInADO: true,
                workItemPayload: payload,
              },
            };
          } else if (isEditRequestMessage(message)) {
            state.confirmationPending = false;
            state.editingField = null;
            saveState(state);

            return {
              reply: "Sure, which field would you like to edit?",
              usedAgent: "story",
              metadata: {
                quickReplies: [
                  "Edit persona",
                  "Edit goal",
                  "Edit priority",
                  "Edit story points",
                  "Edit acceptance criteria",
                  "Cancel edits"
                ],
                missingFields: [],
              },
            };
          }
        }

        // Handle specific edit field selection (e.g., "Edit priority")
        // Only allow editing when we're at the confirmation stage (all flows completed)
        const isAtConfirmationStage = state.generatedSummary && 
          (state.assigneeFlowStep === "assignee_confirmed" || state.assigneeFlowStep === "assignee_skipped");
        
        const editFieldRequested = detectEditField(message);
        if (editFieldRequested && isAtConfirmationStage) {
          state.editingField = editFieldRequested as any;
          state.confirmationPending = false;
          saveState(state);
          
          const fieldPrompts: Record<string, { prompt: string; quickReplies: string[] }> = {
            persona: { 
              prompt: "What should the new persona be? (e.g., Developer, Product Manager, End User)",
              quickReplies: ["Developer", "Product Manager", "End User", "Cancel edits"]
            },
            goal: {
              prompt: "What should the new goal be?",
              quickReplies: ["Cancel edits"]
            },
            benefit: {
              prompt: "What should the new benefit be?",
              quickReplies: ["Cancel edits"]
            },
            priority: {
              prompt: "What should the new priority be?",
              quickReplies: ["High", "Medium", "Low", "Cancel edits"]
            },
            storyPoints: {
              prompt: "How many story points should this be?",
              quickReplies: ["1", "2", "3", "5", "8", "13", "Cancel edits"]
            },
            acceptance_criteria: {
              prompt: "Please provide the new acceptance criteria (one per line or comma separated):",
              quickReplies: ["Cancel edits"]
            }
          };
          
          const fieldInfo = fieldPrompts[editFieldRequested] || { prompt: "Please provide the new value:", quickReplies: ["Cancel edits"] };
          
          return {
            reply: fieldInfo.prompt,
            usedAgent: "story",
            metadata: {
              quickReplies: fieldInfo.quickReplies,
              missingFields: [],
            },
          };
        }

        // Handle cancel edits - only when at confirmation stage
        if (isCancelEditsMessage(message) && isAtConfirmationStage) {
          state.editingField = null;
          state.confirmationPending = true;
          saveState(state);
          
          const payload = buildWorkItemPayload(state);
          if (!payload) {
            return {
              reply: "Error: Unable to build work item payload. Please try again.",
              usedAgent: "story",
              metadata: { quickReplies: ["Start over"], missingFields: [] },
            };
          }
          
          const orgResult = await populatePayloadOrganization(payload, state, organizations);
          if (!orgResult.success) {
            return {
              reply: orgResult.error,
              usedAgent: "story",
              metadata: { quickReplies: ["Start over", "View settings"], missingFields: [] },
            };
          }
          
          return {
            reply: buildFinalSummaryPrompt(state),
            usedAgent: "story",
            metadata: {
              quickReplies: ["Edit details", "Start over"],
              missingFields: [],
              generatedStory: state.generatedSummary,
              canCreateInADO: true,
              workItemPayload: orgResult.payload,
            },
          };
        }

        // Handle receiving new value for the field being edited
        // Only process when at confirmation stage with an active edit
        if (state.editingField && isAtConfirmationStage) {
          const editingField = state.editingField;
          const newValue = message.trim();
          
          if (editingField === "acceptance_criteria") {
            // Parse acceptance criteria from user input
            const criteria = newValue.split(/[\n,]/).map(c => c.trim()).filter(c => c.length > 0);
            state.generatedAcceptanceCriteria = criteria;
            if (state.generatedSummary) {
              state.generatedSummary.acceptanceCriteria = criteria;
            }
          } else if (editingField === "storyPoints") {
            const points = parseInt(newValue) || 3;
            state.provided.storyPoints = points;
            if (state.generatedSummary) {
              state.generatedSummary.storyPoints = points;
            }
          } else if (editingField === "priority") {
            state.provided.priority = newValue;
            if (state.generatedSummary) {
              state.generatedSummary.priority = newValue;
            }
          } else {
            // persona, goal, benefit
            state.provided[editingField as keyof typeof state.provided] = newValue;
            // Regenerate user story and description
            const userStory = generateUserStoryStatement(state);
            const description = `This story enables ${state.provided.persona} to ${state.provided.goal}.${state.provided.benefit ? ` The expected benefit is to ${state.provided.benefit}.` : ""}`;
            const title = generateStoryTitle(String(state.provided.goal));
            
            if (state.generatedSummary) {
              state.generatedSummary.userStory = userStory;
              state.generatedSummary.description = description;
              state.generatedSummary.title = title;
            }
          }
          
          state.editingField = null;
          state.confirmationPending = true;
          saveState(state);
          
          const payload = buildWorkItemPayload(state);
          if (!payload) {
            return {
              reply: "Error: Unable to build work item payload. Please try again.",
              usedAgent: "story",
              metadata: { quickReplies: ["Start over"], missingFields: [] },
            };
          }
          
          const orgResult = await populatePayloadOrganization(payload, state, organizations);
          if (!orgResult.success) {
            return {
              reply: orgResult.error,
              usedAgent: "story",
              metadata: { quickReplies: ["Start over", "View settings"], missingFields: [] },
            };
          }
          
          return {
            reply: `Updated! Here's the revised story:\n\n${buildFinalSummaryPrompt(state)}`,
            usedAgent: "story",
            metadata: {
              quickReplies: ["Edit details", "Start over"],
              missingFields: [],
              generatedStory: state.generatedSummary,
              canCreateInADO: true,
              workItemPayload: orgResult.payload,
            },
          };
        }

        state.confirmationPending = true;
        saveState(state);

        const payload = buildWorkItemPayload(state);

        if (!payload) {
          return {
            reply: "Error: Unable to build work item payload. Please try again.",
            usedAgent: "story",
            metadata: {
              quickReplies: ["Start over", "Help"],
              missingFields: [],
            },
          };
        }

        console.log(`[StoryAgent] Building payload - Looking for org: "${state.provided.organization}"`);
        
        const orgResult = await populatePayloadOrganization(payload, state, organizations);
        if (!orgResult.success) {
          return {
            reply: orgResult.error,
            usedAgent: "story",
            metadata: {
              quickReplies: ["Start over", "View settings"],
              missingFields: [],
            },
          };
        }

        return {
          reply: buildFinalSummaryPrompt(state),
          usedAgent: "story",
          metadata: {
            quickReplies: ["Edit details", "Start over"],
            missingFields: [],
            generatedStory: state.generatedSummary,
            canCreateInADO: true,
            workItemPayload: orgResult.payload,
          },
        };
      }
    }

    // For off-topic messages, provide helpful redirection (after flow-specific checks)
    if (interpretation.action === "off_topic") {
      const response = await generateIntelligentResponse(
        message,
        interpretation,
        state,
        { organizations, projects, pendingField: state.lastAsked }
      );
      return {
        reply: response.reply,
        usedAgent: "story",
        metadata: {
          quickReplies: response.quickReplies,
          missingFields: state.missingFields,
        },
      };
    }
    
    // Handle unclear interpretations - explicitly ask user to restate (after flow-specific checks)
    if (interpretation.action === "unclear") {
      // Generate LLM-powered clarification response
      const intelligentResponse = await generateIntelligentResponse(
        message,
        interpretation,
        state,
        { organizations, projects, pendingField: state.lastAsked }
      );
      
      return {
        reply: intelligentResponse.reply,
        usedAgent: "story",
        metadata: {
          quickReplies: intelligentResponse.quickReplies,
          missingFields: state.missingFields,
        },
      };
    }

    // Handle command requests (like "skip", "cancel", etc.) AFTER flow-specific checks
    // This ensures flow-specific messages (like "Accept", "Yes - generate") are handled first
    if (interpretation.action === "command") {
      // Generate LLM-powered response for unhandled commands
      const intelligentResponse = await generateIntelligentResponse(
        message,
        interpretation,
        state,
        { organizations, projects, pendingField: state.lastAsked }
      );
      
      return {
        reply: intelligentResponse.reply,
        usedAgent: "story",
        metadata: {
          quickReplies: intelligentResponse.quickReplies,
          missingFields: state.missingFields,
        },
      };
    }

    const nextQ = pickNextQuestion(state);

    if (!nextQ.field) {
      return {
        reply: "Something went wrong. Let me start over.",
        usedAgent: "story",
        metadata: {
          quickReplies: ["Start over", "Help"],
          missingFields: state.missingFields,
        },
      };
    }

    if (state.lastAsked === nextQ.field) {
      // Generate LLM-powered response for repeated question
      const contextualResponse = await generateContextualQuestionAndReplies(
        nextQ.field,
        state,
        { organizations, projects, flowPhase: currentFlowPhase }
      );
      
      let alternativeText = "";
      if (nextQ.field === "organization" && organizations.length === 0) {
        alternativeText = "I couldn't find any configured organizations. Please set up Azure DevOps in Settings first.";
      } else if (nextQ.field === "project" && projects.length === 0) {
        alternativeText = "I couldn't find projects for this organization. You can skip this or check your ADO settings.";
      } else if (nextQ.field === "organization" && organizations.length > 0) {
        const orgList = organizations.map(org => `- ${org.name}`).join('\n');
        alternativeText = `I still need to know: ${contextualResponse.question}\n\nHere are the configured organizations:\n${orgList}`;
      } else {
        alternativeText = `I still need to know: ${contextualResponse.question}\n\nYou can select from the options below or type your answer.`;
      }

      return {
        reply: alternativeText,
        usedAgent: "story",
        metadata: {
          quickReplies: [...contextualResponse.quickReplies, "Skip for now"],
          missingFields: state.missingFields,
          projects: nextQ.field === "project" ? projects : undefined,
        },
      };
    }

    state.lastAsked = nextQ.field;
    saveState(state);

    // Use LLM to generate contextual question and quick replies
    const contextualResponse = await generateContextualQuestionAndReplies(
      nextQ.field,
      state,
      { organizations, projects, flowPhase: currentFlowPhase }
    );

    let contextText = "";
    if (nextQ.field === "organization" && organizations.length > 0) {
      const orgList = organizations.map(org => `- ${org.name}`).join('\n');
      contextText = `\n\nHere are the configured organizations:\n${orgList}`;
    } else if (nextQ.field === "project" && projects.length > 0) {
      contextText = `\n\nI found ${projects.length} project(s) in this organization.`;
    }

    return {
      reply: `${contextualResponse.question}${contextText}`,
      usedAgent: "story",
      metadata: {
        quickReplies: contextualResponse.quickReplies,
        missingFields: state.missingFields,
        projects: nextQ.field === "project" ? projects : undefined,
      },
    };
  },
};
