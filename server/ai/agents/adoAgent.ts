import type { Agent, AgentRequest, AgentResponse, Organization, Project } from "../superAgent/types";
import { storage } from "../../storage";
import { safeDecryptPAT } from "../../crypto-utils";
import { getSessionState, saveSessionState } from "../superAgent/state";
import OpenAI from "openai";
import { hasBedrock, azureOpenAI as bedrockLLM } from "../../llm-config";

const isAzureOpenAIConfigured = !!(
  process.env.AZURE_OPENAI_API_KEY &&
  process.env.AZURE_OPENAI_ENDPOINT &&
  process.env.AZURE_OPENAI_DEPLOYMENT
);

const openai = hasBedrock && bedrockLLM
  ? bedrockLLM
  : isAzureOpenAIConfigured
    ? new OpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
    defaultQuery: { "api-version": process.env.AZURE_OPENAI_API_VERSION },
    defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY },
  })
    : null;

// All supported work item query types
type WorkItemQueryType = "work_items" | "epics" | "stories" | "bugs" | "tasks" | "features" | "repositories" | "pipelines" | "pull_requests";

interface ADOAgentState {
  selectedOrganization?: { id: string; name: string; organizationUrl: string };
  selectedProject?: { id: string; name: string };
  queryType?: WorkItemQueryType;
  lastQueryResults?: any[];
  lastQueryDescription?: string;
  awaitingSelection?: "organization" | "project" | "query_type" | null;
  // Persist a user’s intent when they ask for data before org/project selection
  pendingAction?: "new_query" | "filter_results";
  pendingQueryType?: WorkItemQueryType;
  pendingStateFilter?: "open" | "closed" | "active" | "new" | "resolved" | "all";
}

interface LLMInterpretation {
  action: "select_organization" | "select_project" | "new_query" | "filter_results" | "answer_question" | "navigate" | "help" | "clarify" | "conversational";
  organizationName?: string;  // When selecting an organization
  projectName?: string;       // When selecting a project
  queryType?: WorkItemQueryType;  // REQUIRED for new_query and filter_results
  stateFilter?: "open" | "closed" | "active" | "new" | "resolved" | "all";
  assigneeFilter?: string;
  directAnswer?: string;
  navigateTo?: "organization" | "project" | "reset";
  explanation?: string;
}

function detectStateFilter(message: string): LLMInterpretation["stateFilter"] | undefined {
  const lowerMessage = message.toLowerCase();
  if (/\b(closed|done|completed)\b/.test(lowerMessage)) return "closed";
  if (/\b(resolved)\b/.test(lowerMessage)) return "resolved";
  if (/\b(active|in progress)\b/.test(lowerMessage)) return "active";
  if (/\b(new)\b/.test(lowerMessage)) return "new";
  if (/\b(open)\b/.test(lowerMessage)) return "open";
  if (/\b(all|everything)\b/.test(lowerMessage)) return "all";
  return undefined;
}

function findMentionedName<T extends { name: string }>(message: string, options: T[] = []): T | undefined {
  const lowerMessage = message.toLowerCase();
  return options.find((option) => lowerMessage.includes(option.name.toLowerCase()));
}

function interpretUserMessageLocally(
  message: string,
  state: ADOAgentState,
  availableOrganizations: Organization[] = [],
  availableProjects: Project[] = []
): LLMInterpretation {
  const lowerMessage = message.toLowerCase();

  if (/\b(start over|reset|back to start|clear)\b/.test(lowerMessage)) {
    return { action: "navigate", navigateTo: "reset" };
  }

  const mentionedOrganization = findMentionedName(message, availableOrganizations);
  if (mentionedOrganization && (!state.selectedOrganization || /\b(use|select|switch|try|organization|org)\b/.test(lowerMessage))) {
    return {
      action: "select_organization",
      organizationName: mentionedOrganization.name,
    };
  }

  const mentionedProject = findMentionedName(message, availableProjects);
  if (mentionedProject && state.selectedOrganization) {
    return {
      action: "select_project",
      projectName: mentionedProject.name,
    };
  }

  const queryType = detectQueryType(message);
  if (queryType) {
    const stateFilter = detectStateFilter(message);
    if (stateFilter && stateFilter !== "all") {
      return {
        action: "filter_results",
        queryType,
        stateFilter,
      };
    }
    return {
      action: "new_query",
      queryType,
    };
  }

  const featureType = detectFeatureQuestion(message);
  if (featureType) {
    return {
      action: "help",
      directAnswer: getFeatureInformation(featureType),
    };
  }

  if (!state.selectedOrganization) {
    return { action: "select_organization" };
  }

  if (!state.selectedProject) {
    return { action: "select_project" };
  }

  return {
    action: "conversational",
    directAnswer: "I can help you query Azure DevOps data. Try asking for user stories, epics, bugs, repositories, pipelines, or pull requests.",
  };
}

async function interpretUserMessageWithLLM(
  message: string,
  state: ADOAgentState,
  conversationHistory: Array<{ role: string; content: string }>,
  availableOrganizations?: Organization[],
  availableProjects?: Project[]
): Promise<LLMInterpretation> {
  console.log(`[ADOAgent] LLM interpretation for: "${message}"`);
  
  const lastResultsSummary = state.lastQueryResults 
    ? `Previous query returned ${state.lastQueryResults.length} items. States found: ${Array.from(new Set(state.lastQueryResults.map(r => r.state))).join(", ")}`
    : "No previous results";
  
  // Build context about available organizations and projects
  const orgsList = availableOrganizations?.map(o => o.name).join(", ") || "None available";
  const projectsList = availableProjects?.map(p => p.name).join(", ") || "None available";
  
  const systemPrompt = `You are an ULTRA-INTELLIGENT Azure DevOps query interpreter for the Astra platform. Your job is to understand what users TRULY want from their Azure DevOps data and provide the perfect action to fulfill their request.

CURRENT STATE:
- Organization selected: ${state.selectedOrganization?.name || "NOT SELECTED (awaiting selection)"}
- Project selected: ${state.selectedProject?.name || "NOT SELECTED (awaiting selection)"}
- Last query type: ${state.queryType || "None"}
- ${lastResultsSummary}

AVAILABLE OPTIONS:
- Organizations: ${orgsList}
- Projects (if org selected): ${projectsList}

RECENT CONVERSATION:
${conversationHistory.map(m => `${m.role}: ${m.content}`).join("\n")}

Your task: Analyze the user message and return a JSON object. The message is: "${message}"

## CRITICAL: HANDLE 3 TYPES OF QUESTIONS:

### TYPE 1: HELP/FEATURE QUESTIONS (Answer directly - don't require org/project)
Detect if user is asking ABOUT the platform/features, not querying data:
- "What can Astra do?" → action: "conversational" + provide feature overview
- "Tell me about artifacts" → action: "conversational" + explain artifacts
- "How does Astra work?" → action: "help" + provide guidance
- "Can you explain X?" → action: "conversational" + provide explanation

These questions should return action: "help" or "conversational" with a directAnswer explaining the feature.
DO NOT require organization/project selection for these.

### TYPE 2: DATA QUERIES (Require org/project, then fetch data)
"list open defects", "show bugs", "all stories" - these NEED org/project selection first
- If org not selected: return action: "select_organization"
- If project not selected: return action: "select_project"  
- If both selected: return action: "new_query" or "filter_results" to get data

### TYPE 3: NAVIGATION/SELECTION (Handle org/project changes)
"use AstraPlatform", "switch project", "try different org"
- return action: "select_organization" or "select_project"

INTELLIGENCE RULES:
1. **Smart Query Detection**: "list open defects", "show bugs", "open stories" = These are DATA QUERIES that need both queryType and stateFilter
2. **Query Type Mapping**: "defects" = "bugs", "user stories" = "stories", "work items" = "work_items"
3. **State Intelligence**: "open" includes New/Active/In Progress, "closed" includes Done/Resolved/Closed
4. **User Expectations**: When users say "list X", they expect to SEE actual data, not explanations

ENHANCED ACTION MAPPING:
1. "select_organization" - User wants to select/use an organization (e.g., "use AstraPlatform", "select NareshTestOrg")
2. "select_project" - User wants to select a project (only if org is already selected)
3. "new_query" - User wants to query ADO data WITHOUT a state filter (e.g., "show all epics", "list repositories")
4. "filter_results" - User wants to query WITH a state filter (e.g., "list open defects", "show closed bugs", "active stories")
5. "answer_question" - ONLY for questions answerable from existing data (NOT for new queries)
6. "navigate" - User wants to change org/project or reset
7. "help" - User needs help understanding capabilities
8. "conversational" - General conversation about features or clarification, provide directAnswer with explanation

CRITICAL: For HELP/FEATURE questions (not data queries):
- Detect: "what is", "how to", "tell me about", "explain", "help me", "capabilities", "features"
- Return action: "help" or "conversational"
- ALWAYS include directAnswer with the explanation
- DO NOT require org/project selection

SMART QUERY EXAMPLES:
- "list open defects" → filter_results + queryType: "bugs" + stateFilter: "open"
- "show all epics" → new_query + queryType: "epics"
- "open stories" → filter_results + queryType: "stories" + stateFilter: "open"
- "What can Astra do?" → conversational + directAnswer explaining features
- "Tell me about artifacts" → help + directAnswer explaining what artifacts are

WORK ITEM TYPE MAPPING (CRITICAL):
When user mentions specific work item types, you MUST set queryType:
- "defects", "list defects", "show defects" -> queryType: "bugs" (defects = bugs in ADO)
- "bugs", "list bugs", "show bugs" -> queryType: "bugs"
- "epics", "list epics", "show epics" -> queryType: "epics"
- "stories", "user stories", "show stories" -> queryType: "stories"
- "tasks", "list tasks", "show tasks" -> queryType: "tasks"
- "features", "list features" -> queryType: "features"
- "work items", "all items", "everything" -> queryType: "work_items"
- "repositories", "repos" -> queryType: "repositories"
- "pipelines", "builds" -> queryType: "pipelines"
- "pull requests", "PRs" -> queryType: "pull_requests"

STATE FILTER MAPPING (CRITICAL):
When user mentions states, you MUST set stateFilter:
- "open", "active", "new", "in progress" -> stateFilter: "open"
- "closed", "done", "resolved", "completed" -> stateFilter: "closed"
- "new" specifically -> stateFilter: "new"
- "active" specifically -> stateFilter: "active"
- "resolved" specifically -> stateFilter: "resolved"

OUTPUT FORMAT:
{
  "action": "<action_type>",
  "organizationName": "<org_name>" (for select_organization - must match one from AVAILABLE OPTIONS exactly),
  "projectName": "<project_name>" (for select_project - must match available project),
  "queryType": "work_items" | "epics" | "stories" | "bugs" | "tasks" | "features" | "repositories" | "pipelines" | "pull_requests" (REQUIRED for new_query AND filter_results when asking about specific types),
  "stateFilter": "open" | "closed" | "active" | "new" | "resolved" | "all" (for filter_results),
  "directAnswer": "<your conversational response>" (for answer_question, help, conversational),
  "navigateTo": "organization" | "project" | "reset" (for navigate),
  "explanation": "<brief reasoning>"
}

CRITICAL RULES:
1. If organization is NOT SELECTED and user mentions any organization name (even partial match), use "select_organization" with the matching organizationName
2. If user says "use X", "select X", "try X", "switch to X" where X matches an org/project name, that's a selection
3. "Use: AstraPlatform" or "use AstraPlatform" both mean select_organization with organizationName: "AstraPlatform"
4. Be flexible with matching - "use TestDevExPlatformNew" should match organization "TestDevExPlatformNew"
5. If no organization is selected yet, prioritize detecting organization selection from the message
6. For "start over", "reset", "back", use navigate with navigateTo: "reset"
7. CRITICAL: For "list epics", "show epics", "list bugs", "show stories", etc. - use "new_query" with the correct queryType. DO NOT default to filter_results with open state.
8. CRITICAL: queryType is REQUIRED whenever user asks for a specific type of item. "List epics" = new_query + queryType: "epics". NOT filter_results without queryType.
9. For "show closed epics", "list open bugs", etc. - use "filter_results" with BOTH queryType AND stateFilter.
10. State mappings: "closed" includes Closed, Done, Resolved, Removed states. "open" includes New, Active, In Progress, Committed, Design states.
11. CRITICAL: For feature/help questions, ALWAYS return action: "help" or "conversational" with directAnswer. Do NOT require org/project selection.`;

  // Azure OpenAI is optional. If no LLM provider is configured, use the local
  // intent parser for common ADO navigation and query requests.
  if (!openai) {
    console.log("[ADOAgent] LLM interpreter not configured; using local ADO intent parser");
    return interpretUserMessageLocally(message, state, availableOrganizations, availableProjects);
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (!content) {
      console.log(`[ADOAgent] LLM returned empty content, defaulting to conversational`);
      return { action: "conversational", directAnswer: "I'm here to help you explore Azure DevOps. What would you like to do?" };
    }

    const interpretation = JSON.parse(content) as LLMInterpretation;
    console.log(`[ADOAgent] LLM interpretation result:`, JSON.stringify(interpretation, null, 2));
    return interpretation;
  } catch (error: any) {
    console.error(`[ADOAgent] LLM interpretation error:`, error);
    
    // Check for common error types and provide helpful messages
    if (error?.status === 401 || error?.code === 'invalid_api_key') {
      return { 
        action: "conversational", 
        directAnswer: "The Azure OpenAI API key appears to be invalid. Please check your AZURE_OPENAI_API_KEY configuration." 
      };
    }
    
    if (error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED') {
      return { 
        action: "conversational", 
        directAnswer: "Unable to connect to the Azure OpenAI service. Please check your network connection and AZURE_OPENAI_ENDPOINT." 
      };
    }
    
    return { action: "conversational", directAnswer: "I encountered an issue understanding your request. Could you please rephrase?" };
  }
}

function getADOAgentState(sessionId: string): ADOAgentState {
  const session = getSessionState(sessionId);
  if (!session.adoAgentState) {
    session.adoAgentState = {};
    saveSessionState(sessionId, session);
  }
  return session.adoAgentState as ADOAgentState;
}

function saveADOAgentState(sessionId: string, state: ADOAgentState): void {
  const session = getSessionState(sessionId);
  session.adoAgentState = state;
  saveSessionState(sessionId, session);
}

function resetADOAgentState(sessionId: string): void {
  const session = getSessionState(sessionId);
  session.adoAgentState = {};
  saveSessionState(sessionId, session);
}

function extractOrgNameFromUrl(url: string): string {
  // Extract organization name from Azure DevOps URL
  // Format: https://dev.azure.com/OrgName/ or https://dev.azure.com/OrgName
  const match = url.match(/https?:\/\/dev\.azure\.com\/([^\/\?]+)/);
  return match ? match[1] : url;
}

async function fetchOrganizations(): Promise<Organization[]> {
  try {
    const artifactOrgs = await storage.getArtifactOrganizations();
    console.log(`[ADOAgent] Found ${artifactOrgs.length} organizations in database`);
    
    // Map organizations and deduplicate by organizationUrl
    const orgMap = new Map<string, Organization>();
    
    artifactOrgs.forEach((org, index) => {
      const orgName = extractOrgNameFromUrl(org.organizationUrl || "");
      const orgUrl = org.organizationUrl || "";
      
      console.log(`[ADOAgent] Processing org ${index + 1}/${artifactOrgs.length} - ID: ${org.id}, projectName: ${org.projectName}, URL: ${orgUrl}, extracted name: ${orgName}, has PAT: ${!!org.patToken}`);
      
      if (!orgUrl) {
        console.warn(`[ADOAgent] Skipping org with empty URL - ID: ${org.id}, projectName: ${org.projectName}`);
        return;
      }
      
      // Use URL as key for deduplication, but prefer entries with PAT tokens
      const existing = orgMap.get(orgUrl);
      const current: Organization = {
        id: String(org.id),
        name: orgName || "Default Organization",
        organizationUrl: orgUrl,
        projectName: org.projectName || "",
        patConfigured: !!org.patToken,
      };
      
      // If no existing entry, or current has PAT and existing doesn't, use current
      if (!existing || (current.patConfigured && !existing.patConfigured)) {
        console.log(`[ADOAgent] ${existing ? 'Updating' : 'Adding'} org: ${orgName} (PAT: ${current.patConfigured})`);
        orgMap.set(orgUrl, current);
      } else {
        console.log(`[ADOAgent] Keeping existing entry for: ${existing.name} (PAT: ${existing.patConfigured})`);
      }
    });
    
    const organizations = Array.from(orgMap.values());
    console.log(`[ADOAgent] After deduplication: ${organizations.length} unique organizations`);
    organizations.forEach(org => console.log(`[ADOAgent] Final org: ${org.name} (PAT: ${org.patConfigured})`));
    
    return organizations;
  } catch (error) {
    console.error("[ADOAgent] Error fetching organizations:", error);
    return [];
  }
}

async function fetchProjects(organizationUrl: string, pat: string): Promise<Project[]> {
  try {
    // Extract organization name from URL for API call
    const orgName = organizationUrl.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "");
    console.log(`[ADOAgent] Fetching projects for organization: ${orgName} (URL: ${organizationUrl})`);
    
    const authToken = Buffer.from(`:${pat}`).toString("base64");
    const apiUrl = `https://dev.azure.com/${orgName}/_apis/projects?api-version=7.0`;
    
    console.log(`[ADOAgent] Making API call to: ${apiUrl}`);
    
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Basic ${authToken}`,
        Accept: "application/json",
      },
    });
    
    console.log(`[ADOAgent] API response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ADOAgent] Failed to fetch projects. Status: ${response.status}, Error: ${errorText}`);
      
      if (response.status === 401) {
        console.error(`[ADOAgent] 401 Unauthorized - PAT token authentication failed for org: ${orgName}`);
        console.error(`[ADOAgent] Check: 1) PAT token expiry 2) PAT permissions (Project: Read) 3) Organization access`);
      }
      
      return [];
    }
    
    const data = await response.json();
    const projects = (data.value || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));
    
    console.log(`[ADOAgent] Successfully fetched ${projects.length} projects`);
    return projects;
  } catch (error) {
    console.error("[ADOAgent] Error fetching projects:", error);
    return [];
  }
}

// Build WIQL query based on filters
function buildWiqlQuery(
  projectName: string, 
  workItemType?: string, 
  stateFilter?: "open" | "closed" | "active" | "new" | "resolved" | "all"
): string {
  let wiql = `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo], [System.CreatedDate] FROM WorkItems WHERE [System.TeamProject] = '${projectName}'`;
  
  if (workItemType) {
    wiql += ` AND [System.WorkItemType] = '${workItemType}'`;
  }
  
  if (stateFilter && stateFilter !== "all") {
    if (stateFilter === "open") {
      // Open states include Design, New, Active, In Progress, Committed
      wiql += ` AND [System.State] IN ('New', 'Active', 'In Progress', 'Committed', 'Design')`;
    } else if (stateFilter === "closed") {
      // Closed states include Closed, Done, Resolved, Removed
      wiql += ` AND [System.State] IN ('Closed', 'Done', 'Resolved', 'Removed')`;
    } else if (stateFilter === "new") {
      wiql += ` AND [System.State] = 'New'`;
    } else if (stateFilter === "active") {
      wiql += ` AND [System.State] = 'Active'`;
    } else if (stateFilter === "resolved") {
      wiql += ` AND [System.State] = 'Resolved'`;
    }
  }
  
  wiql += ` ORDER BY [System.CreatedDate] DESC`;
  return wiql;
}

// Get count of work items matching the filter (without fetching details)
async function getWorkItemCount(
  organizationUrl: string,
  projectName: string,
  pat: string,
  workItemType?: string,
  stateFilter?: "open" | "closed" | "active" | "new" | "resolved" | "all"
): Promise<number> {
  try {
    const orgName = organizationUrl.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "");
    const authToken = Buffer.from(`:${pat}`).toString("base64");
    
    const wiql = buildWiqlQuery(projectName, workItemType, stateFilter);
    console.log(`[ADOAgent] Count query WIQL: ${wiql}`);
    
    const wiqlResponse = await fetch(
      `https://dev.azure.com/${orgName}/${encodeURIComponent(projectName)}/_apis/wit/wiql?api-version=7.0`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${authToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query: wiql }),
      }
    );
    
    if (!wiqlResponse.ok) {
      console.error("[ADOAgent] Failed to execute count WIQL:", wiqlResponse.status);
      return 0;
    }
    
    const wiqlData = await wiqlResponse.json();
    const count = (wiqlData.workItems || []).length;
    console.log(`[ADOAgent] Count result for filter '${stateFilter || 'all'}': ${count}`);
    return count;
  } catch (error) {
    console.error("[ADOAgent] Error getting work item count:", error);
    return 0;
  }
}

// Maximum IDs per batch (Azure DevOps limit is 200)
const BATCH_SIZE = 200;
// Maximum items to display (to avoid overwhelming responses)
const MAX_DISPLAY_ITEMS = 50;

interface WorkItemsResult {
  items: any[];
  totalCount: number;
}

async function fetchWorkItems(
  organizationUrl: string,
  projectName: string,
  pat: string,
  workItemType?: string,
  stateFilter?: "open" | "closed" | "active" | "new" | "resolved" | "all"
): Promise<WorkItemsResult> {
  try {
    const orgName = organizationUrl.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "");
    const authToken = Buffer.from(`:${pat}`).toString("base64");
    
    const wiql = buildWiqlQuery(projectName, workItemType, stateFilter);
    console.log(`[ADOAgent] Fetch work items WIQL: ${wiql}`);
    
    const wiqlResponse = await fetch(
      `https://dev.azure.com/${orgName}/${encodeURIComponent(projectName)}/_apis/wit/wiql?api-version=7.0`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${authToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query: wiql }),
      }
    );
    
    if (!wiqlResponse.ok) {
      console.error("[ADOAgent] Failed to execute WIQL:", wiqlResponse.status);
      return { items: [], totalCount: 0 };
    }
    
    const wiqlData = await wiqlResponse.json();
    const allWorkItemIds = (wiqlData.workItems || []).map((wi: any) => wi.id);
    const totalCount = allWorkItemIds.length;
    
    console.log(`[ADOAgent] WIQL returned ${totalCount} work item IDs`);
    
    if (allWorkItemIds.length === 0) {
      return { items: [], totalCount: 0 };
    }
    
    // Limit to MAX_DISPLAY_ITEMS for display, but keep track of total
    const idsToFetch = allWorkItemIds.slice(0, MAX_DISPLAY_ITEMS);
    
    // Fetch work items in batches
    const allWorkItems: any[] = [];
    
    for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
      const batchIds = idsToFetch.slice(i, i + BATCH_SIZE);
      
      const workItemsResponse = await fetch(
        `https://dev.azure.com/${orgName}/_apis/wit/workitems?ids=${batchIds.join(",")}&api-version=7.0`,
        {
          headers: {
            Authorization: `Basic ${authToken}`,
            Accept: "application/json",
          },
        }
      );
      
      if (!workItemsResponse.ok) {
        console.error("[ADOAgent] Failed to fetch work items batch:", workItemsResponse.status);
        continue;
      }
      
      const workItemsData = await workItemsResponse.json();
      const batchItems = (workItemsData.value || []).map((wi: any) => ({
        id: wi.id,
        title: wi.fields["System.Title"],
        state: wi.fields["System.State"],
        type: wi.fields["System.WorkItemType"],
        assignedTo: wi.fields["System.AssignedTo"]?.displayName || "Unassigned",
        url: wi._links?.html?.href || `https://dev.azure.com/${orgName}/${projectName}/_workitems/edit/${wi.id}`,
      }));
      
      allWorkItems.push(...batchItems);
    }
    
    console.log(`[ADOAgent] Fetched ${allWorkItems.length} work items (total in ADO: ${totalCount})`);
    return { items: allWorkItems, totalCount };
  } catch (error) {
    console.error("[ADOAgent] Error fetching work items:", error);
    return { items: [], totalCount: 0 };
  }
}

async function fetchRepositories(organizationUrl: string, projectName: string, pat: string): Promise<any[]> {
  try {
    const orgName = organizationUrl.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "");
    const authToken = Buffer.from(`:${pat}`).toString("base64");
    
    const response = await fetch(
      `https://dev.azure.com/${orgName}/${encodeURIComponent(projectName)}/_apis/git/repositories?api-version=7.0`,
      {
        headers: {
          Authorization: `Basic ${authToken}`,
          Accept: "application/json",
        },
      }
    );
    
    if (!response.ok) {
      console.error("[ADOAgent] Failed to fetch repositories:", response.status);
      return [];
    }
    
    const data = await response.json();
    return (data.value || []).map((repo: any) => ({
      id: repo.id,
      name: repo.name,
      defaultBranch: repo.defaultBranch,
      url: repo.webUrl,
      size: repo.size,
    }));
  } catch (error) {
    console.error("[ADOAgent] Error fetching repositories:", error);
    return [];
  }
}

async function fetchPipelines(organizationUrl: string, projectName: string, pat: string): Promise<any[]> {
  try {
    const orgName = organizationUrl.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "");
    const authToken = Buffer.from(`:${pat}`).toString("base64");
    
    const response = await fetch(
      `https://dev.azure.com/${orgName}/${encodeURIComponent(projectName)}/_apis/pipelines?api-version=7.0`,
      {
        headers: {
          Authorization: `Basic ${authToken}`,
          Accept: "application/json",
        },
      }
    );
    
    if (!response.ok) {
      console.error("[ADOAgent] Failed to fetch pipelines:", response.status);
      return [];
    }
    
    const data = await response.json();
    return (data.value || []).map((pipeline: any) => ({
      id: pipeline.id,
      name: pipeline.name,
      folder: pipeline.folder,
      url: pipeline._links?.web?.href,
    }));
  } catch (error) {
    console.error("[ADOAgent] Error fetching pipelines:", error);
    return [];
  }
}

async function fetchPullRequests(organizationUrl: string, projectName: string, pat: string): Promise<any[]> {
  try {
    const orgName = organizationUrl.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "");
    const authToken = Buffer.from(`:${pat}`).toString("base64");
    
    const response = await fetch(
      `https://dev.azure.com/${orgName}/${encodeURIComponent(projectName)}/_apis/git/pullrequests?searchCriteria.status=active&api-version=7.0`,
      {
        headers: {
          Authorization: `Basic ${authToken}`,
          Accept: "application/json",
        },
      }
    );
    
    if (!response.ok) {
      console.error("[ADOAgent] Failed to fetch pull requests:", response.status);
      return [];
    }
    
    const data = await response.json();
    return (data.value || []).map((pr: any) => ({
      id: pr.pullRequestId,
      title: pr.title,
      status: pr.status,
      createdBy: pr.createdBy?.displayName || "Unknown",
      repository: pr.repository?.name,
      sourceBranch: pr.sourceRefName?.replace("refs/heads/", ""),
      targetBranch: pr.targetRefName?.replace("refs/heads/", ""),
      url: `https://dev.azure.com/${orgName}/${projectName}/_git/${pr.repository?.name}/pullrequest/${pr.pullRequestId}`,
    }));
  } catch (error) {
    console.error("[ADOAgent] Error fetching pull requests:", error);
    return [];
  }
}

// Detect if user is asking about features/help instead of data queries
function detectFeatureQuestion(message: string): string | null {
  const lowerMessage = message.toLowerCase();
  
  // Questions about Astra tabs/features
  if (/\b(user\s+access\s+tab|what\s+.*\s+user\s+access)\b/.test(lowerMessage)) {
    return "user_access_tab";
  }
  if (/\b(overview\s+tab|what.*overview|dashboard)\b/.test(lowerMessage)) {
    return "overview_tab";
  }
  if (/\b(organizations?\s+tab|what.*organizations?)\b/.test(lowerMessage)) {
    return "organizations_tab";
  }
  if (/\b(projects?\s+tab|what.*projects?)\b/.test(lowerMessage)) {
    return "projects_tab";
  }
  if (/\b(hub|artifact|persona|prompt|sdlc|golden.*repo)\b/.test(lowerMessage) && /\b(what|how|feature|contain|have|tab)\b/.test(lowerMessage)) {
    return "feature_overview";
  }
  if (/\b(what\s+can\s+i|capabilities|features|help me|guide|tutorial)\b/.test(lowerMessage)) {
    return "general_help";
  }
  if (/^(help|tell\s+me|explain|teach|show\s+me)/.test(lowerMessage)) {
    return "general_help";
  }
  
  return null;
}

// Provide information about Astra features and tabs
function getFeatureInformation(featureType: string): string {
  switch (featureType) {
    case "user_access_tab":
      return `**User Access Tab - Manage Team Members & Permissions**

The User Access tab in the Overview section allows you to:

✅ **Team Management:**
- View all team members with access to your Astra instance
- See user roles and permission levels
- Manage who can view and edit artifacts

✅ **Permission Levels:**
- **Admin**: Full control - can manage all settings, users, and artifacts
- **Editor**: Can create and modify artifacts
- **Viewer**: Read-only access to view artifacts

✅ **Common Tasks:**
- Add new team members to the platform
- Assign specific roles to users
- Remove users who no longer need access
- Control access to sensitive projects

💡 **Pro Tips:**
- Regularly review user access for security
- Use appropriate permission levels for team roles
- Archive inactive users instead of deleting them

Would you like to manage users, or explore other Astra features?`;

    case "overview_tab":
      return `**Overview Tab - Your Astra Dashboard**

The Overview tab is your main dashboard with key insights:

📊 **Key Metrics:**
- **Organizations**: Count of your Azure DevOps organizations
- **Projects**: Total projects across all organizations
- **Golden Repositories**: Available template repositories
- **Work Items**: Distribution of stories, epics, bugs, tasks

📈 **Recent Activity:**
- Your recently accessed projects and organizations
- Quick actions to create new projects or organizations
- Quick links to frequently used features

⚡ **Quick Actions:**
- Create Organization
- Create Project
- Browse recent items
- Access quick settings

This is your central hub for understanding your development landscape at a glance.`;

    case "organizations_tab":
      return `**Organizations Tab - Manage Your Azure DevOps Orgs**

The Organizations tab lets you manage all connected Azure DevOps organizations:

🏢 **Organization Management:**
- View all connected Azure DevOps organizations
- See which organizations have PAT tokens configured
- Select an organization to explore its projects
- Add new organization connections

🔑 **PAT Token Status:**
- Shows which organizations are fully configured
- Indicates missing PAT tokens
- Allows you to reconfigure authentication

🔍 **Organization Details:**
- List of all projects within each organization
- Connection status and configuration
- Quick access to settings for each organization

**To use:** Select an organization to explore, or configure a new one in Settings!`;

    case "projects_tab":
      return `**Projects Tab - Explore Your Projects**

The Projects tab displays all projects across your connected organizations:

📋 **Project Information:**
- Project name and description
- Parent organization
- Number of work items
- Recent activities

🎯 **Project Actions:**
- Select a project to explore its details
- View work items, repositories, and pipelines
- Access project-specific settings
- Create new projects within organizations

🔗 **Connected to:**
- Your Azure DevOps organizations
- All work items, code, and pipelines in each project

**Start exploring:** Select any project to see work items, repositories, and pipelines!`;

    case "feature_overview":
      return `**Astra Features Overview**

🎯 **Main Features:**

1. **Overview Dashboard** - See metrics and recent activity
2. **Organizations** - Manage your Azure DevOps organizations
3. **Projects** - Browse and explore projects
4. **User Access** - Manage team members and permissions
5. **Hub > Artifacts** - Manage Epics, Features, User Stories
6. **Hub > Persona Manager** - Create and manage user personas
7. **Hub > Prompt Library** - Store and organize AI prompts
8. **Golden Repos** - Browse template repositories
9. **SDLC** - Manage full software development lifecycle
10. **Settings** - Configure Azure DevOps connections

📚 **What would you like to learn more about?** Just ask! Or tell me what you'd like to explore.`;

    case "general_help":
    default:
      return `**How Can Astra Help You?**

Astra is your intelligent development platform assistant! Here's what I can do:

🔍 **Query Azure DevOps:**
- "List open defects"
- "Show me all epics"
- "Display my work items"
- "View repositories"

📋 **Manage Artifacts:**
- Create and organize user stories, epics, features
- Generate acceptance criteria
- Create test cases

🎭 **User Personas:**
- Create and manage user personas
- Use personas in story generation

🏗️ **SDLC Management:**
- Full development lifecycle support
- Requirements → Testing → Deployment

💾 **Golden Repositories:**
- Browse template repositories
- Quick-start new projects

⚙️ **Settings & Configuration:**
- Connect Azure DevOps organizations
- Manage PAT tokens
- Configure projects

**What would you like to do?** Just ask me anything about your development workflow!`;
  }
}

function detectQueryType(message: string): WorkItemQueryType | null {
  const lowerMessage = message.toLowerCase();
  
  let result: WorkItemQueryType | null = null;
  
  // Order matters - more specific types first, then general
  if (/\b(user\s*stor(y|ies)|stories)\b/.test(lowerMessage)) result = "stories";
  else if (/\b(epic|epics)\b/.test(lowerMessage)) result = "epics";
  else if (/\b(bugs?)\b/.test(lowerMessage)) result = "bugs";
  else if (/\b(tasks?)\b/.test(lowerMessage)) result = "tasks";
  else if (/\b(features?)\b/.test(lowerMessage)) result = "features";
  else if (/\b(work\s*item|work\s*items|all\s*items|issues?)\b/.test(lowerMessage)) result = "work_items";
  else if (/\b(repo|repos|repositories|repository)\b/.test(lowerMessage)) result = "repositories";
  else if (/\b(pipeline|pipelines|build|builds|ci|cd)\b/.test(lowerMessage)) result = "pipelines";
  else if (/\b(pull\s*request|pull\s*requests|pr|prs|merge\s*request)\b/.test(lowerMessage)) result = "pull_requests";
  
  console.log(`[ADOAgent] detectQueryType: "${message}" -> ${result}`);
  return result;
}

function formatWorkItemsResponse(items: any[], type: string, totalCount?: number): string {
  if (items.length === 0) {
    return `No ${type} found in this project.`;
  }
  
  // Use provided totalCount or fall back to items.length
  const actualTotalCount = totalCount ?? items.length;
  
  let response = `Found **${actualTotalCount} ${type}**:\n\n`;
  
  // Show up to 15 items in the response
  const displayCount = Math.min(items.length, 15);
  items.slice(0, displayCount).forEach((item, index) => {
    response += `**${index + 1}. ${item.title}** (ID: ${item.id})\n`;
    response += `   - State: ${item.state} | Type: ${item.type}\n`;
    response += `   - Assigned to: ${item.assignedTo}\n\n`;
  });
  
  if (actualTotalCount > displayCount) {
    response += `\n*Showing ${displayCount} of ${actualTotalCount} items. Ask me to filter by state (open, closed, resolved) or by type (stories, epics, bugs).*`;
  }
  
  return response;
}

function formatRepositoriesResponse(repos: any[]): string {
  if (repos.length === 0) {
    return "No repositories found in this project.";
  }
  
  let response = `Found **${repos.length} repositories**:\n\n`;
  
  repos.forEach((repo, index) => {
    response += `**${index + 1}. ${repo.name}**\n`;
    response += `   - Default branch: ${repo.defaultBranch || "N/A"}\n`;
    if (repo.size) {
      response += `   - Size: ${Math.round(repo.size / 1024)} KB\n`;
    }
    response += `\n`;
  });
  
  return response;
}

function formatPipelinesResponse(pipelines: any[]): string {
  if (pipelines.length === 0) {
    return "No pipelines found in this project.";
  }
  
  let response = `Found **${pipelines.length} pipelines**:\n\n`;
  
  pipelines.forEach((pipeline, index) => {
    response += `**${index + 1}. ${pipeline.name}**\n`;
    if (pipeline.folder && pipeline.folder !== "\\") {
      response += `   - Folder: ${pipeline.folder}\n`;
    }
    response += `\n`;
  });
  
  return response;
}

function formatPullRequestsResponse(prs: any[]): string {
  if (prs.length === 0) {
    return "No active pull requests found in this project.";
  }
  
  let response = `Found **${prs.length} active pull requests**:\n\n`;
  
  prs.forEach((pr, index) => {
    response += `**${index + 1}. ${pr.title}** (PR #${pr.id})\n`;
    response += `   - Created by: ${pr.createdBy}\n`;
    response += `   - ${pr.sourceBranch} → ${pr.targetBranch}\n`;
    response += `   - Repository: ${pr.repository}\n\n`;
  });
  
  return response;
}

// Helper function to select organization and handle PAT
async function handleOrganizationSelection(
  orgMatch: Organization,
  organizations: Organization[],
  sessionId: string,
  state: ADOAgentState
): Promise<AgentResponse | null> {
  console.log(`[ADOAgent] Handling organization selection: ${orgMatch.name} (ID: ${orgMatch.id}, URL: ${orgMatch.organizationUrl})`);
  
  state.selectedOrganization = {
    id: orgMatch.id,
    name: orgMatch.name,
    organizationUrl: orgMatch.organizationUrl,
  };
  state.awaitingSelection = "project";
  saveADOAgentState(sessionId, state);
  
  const artifactOrgs = await storage.getArtifactOrganizations();
  const fullOrg = artifactOrgs.find(o => String(o.id) === orgMatch.id);
  
  console.log(`[ADOAgent] Found organization in database:`, fullOrg ? `ID: ${fullOrg.id}, Name: ${fullOrg.projectName}, URL: ${fullOrg.organizationUrl}, Has PAT: ${!!fullOrg.patToken}` : "Not found");
  
  if (!fullOrg?.patToken) {
    state.selectedOrganization = undefined;
    state.awaitingSelection = "organization";
    saveADOAgentState(sessionId, state);
    
    return {
      reply: `Organization **${orgMatch.name}** doesn't have a PAT token configured. Please configure it in Settings, or choose another organization.`,
      usedAgent: "ado",
      metadata: {
        quickReplies: [
          ...organizations.filter(o => o.id !== orgMatch.id && o.patConfigured).slice(0, 4).map(o => `Use: ${o.name}`),
          "View settings",
        ],
      },
    };
  }
  
  const pat = safeDecryptPAT(fullOrg.patToken);
  if (!pat) {
    console.error(`[ADOAgent] Failed to decrypt PAT for organization: ${orgMatch.name}`);
    state.selectedOrganization = undefined;
    state.awaitingSelection = "organization";
    saveADOAgentState(sessionId, state);
    
    return {
      reply: `I couldn't decrypt the PAT token for **${orgMatch.name}**. Please reconfigure it in Settings.`,
      usedAgent: "ado",
      metadata: {
        quickReplies: ["View settings"],
      },
    };
  }
  
  console.log(`[ADOAgent] Successfully decrypted PAT, fetching projects for: ${orgMatch.organizationUrl}`);
  const projects = await fetchProjects(orgMatch.organizationUrl, pat);
  
  if (projects.length === 0) {
    console.warn(`[ADOAgent] No projects found for organization: ${orgMatch.name} (${orgMatch.organizationUrl})`);
    
    // Determine if this was likely an authentication issue based on logs
    const errorMessage = `No projects found in **${orgMatch.name}**. This could be due to PAT permissions or no projects existing.

**Debug Info:**
- Organization URL: ${orgMatch.organizationUrl}
- PAT configured: Yes

**Possible Solutions:**
1. **Check PAT Permissions**: Ensure your PAT has "Project and Team (read)" permission
2. **Verify PAT Expiry**: Check if your PAT token has expired
3. **Organization Access**: Confirm you have access to this Azure DevOps organization
4. **Try Different Organization**: Some of your other organizations might work better

**PAT Requirements for Projects:**
- Scope: Project and Team (read)
- Organization: ${extractOrgNameFromUrl(orgMatch.organizationUrl)}`;

    return {
      reply: errorMessage,
      usedAgent: "ado",
      metadata: {
        quickReplies: ["View settings", "Try another organization", "Check PAT permissions"],
      },
    };
  }
  
  console.log(`[ADOAgent] Successfully found ${projects.length} projects in ${orgMatch.name}`);
  return {
    reply: `Great! You're connected to **${orgMatch.name}**. Which project would you like to explore?\n\nI found ${projects.length} project(s).`,
    usedAgent: "ado",
    metadata: {
      quickReplies: projects.slice(0, 5).map(p => `Project: ${p.name}`),
      projects,
    },
  };
}

export const adoAgent: Agent = {
  name: "ADO Agent",
  description: "Helps users query and explore Azure DevOps data including work items, repositories, pipelines, and pull requests",
  
  async process(request: AgentRequest): Promise<AgentResponse> {
    const { message, context } = request;
    const sessionId = context.sessionId;
    const state = getADOAgentState(sessionId);
    
    console.log(`[ADOAgent] Processing: "${message.substring(0, 100)}"`);
    console.log(`[ADOAgent] Current state:`, JSON.stringify(state, null, 2));
    
    // FIRST: Check if user is asking about features/help BEFORE requiring org/project selection
    const featureType = detectFeatureQuestion(message);
    if (featureType) {
      console.log(`[ADOAgent] Feature/help question detected: ${featureType}`);
      const featureInfo = getFeatureInformation(featureType);
      return {
        reply: featureInfo,
        usedAgent: "ado",
        metadata: {
          quickReplies: [
            "Show user stories",
            "List epics",
            "Query ADO data",
            "What else can you do?",
          ],
        },
      };
    }
    
    // Fetch organizations first - needed for LLM context
    const organizations = await fetchOrganizations();
    
    if (organizations.length === 0) {
      return {
        reply: "I'd love to help you explore your Azure DevOps data, but I don't see any organizations configured yet!\n\n**To get started, you'll need to:**\n1. Go to Settings and add your Azure DevOps organization\n2. Configure a Personal Access Token (PAT) for authentication\n\nOnce that's set up, I can help you browse work items, pipelines, repositories, and more. Would you like me to guide you to the settings?",
        usedAgent: "ado",
        metadata: {
          quickReplies: ["Go to Settings"],
        },
      };
    }
    
    // Fetch projects if org is selected (for LLM context)
    let availableProjects: Project[] = [];
    if (state.selectedOrganization) {
      const artifactOrgs = await storage.getArtifactOrganizations();
      const fullOrg = artifactOrgs.find(o => String(o.id) === state.selectedOrganization!.id);
      if (fullOrg?.patToken) {
        const pat = safeDecryptPAT(fullOrg.patToken);
        if (pat) {
          availableProjects = await fetchProjects(state.selectedOrganization.organizationUrl, pat);
        }
      }
    }
    
    // Use LLM to interpret ALL user messages with full context
    const conversationHistory = context.conversationHistory || [];
    const interpretation = await interpretUserMessageWithLLM(
      message, 
      state, 
      conversationHistory, 
      organizations,
      availableProjects
    );
        // If the user asked for data (new_query/filter_results) before selecting org/project,
        // persist that intent so we can auto-run it after selections are done.
        if ((interpretation.action === "new_query" || interpretation.action === "filter_results") && (!state.selectedOrganization || !state.selectedProject)) {
          state.pendingAction = interpretation.action;
          if (interpretation.queryType) {
            state.pendingQueryType = interpretation.queryType;
          }
          if (interpretation.action === "filter_results" && interpretation.stateFilter) {
            state.pendingStateFilter = interpretation.stateFilter;
          }
          saveADOAgentState(sessionId, state);
          console.log(`[ADOAgent] Persisted pending intent: action=${state.pendingAction}, queryType=${state.pendingQueryType}, stateFilter=${state.pendingStateFilter}`);
        }
    
    console.log(`[ADOAgent] LLM interpreted action: ${interpretation.action}`);
    
    // Handle navigation actions first (reset, change org, etc.)
    if (interpretation.action === "navigate") {
      if (interpretation.navigateTo === "reset") {
        resetADOAgentState(sessionId);
        return {
          reply: "No problem! Let's start fresh. What would you like to explore in your Azure DevOps?\n\n**I can help you find:**\n- User stories and work items\n- Epics and features\n- Repositories and code\n- Pipelines and builds\n- Pull requests\n\nJust tell me what you're looking for!",
          usedAgent: "ado",
          metadata: {
            quickReplies: [
              "Show user stories",
              "List epics",
              "View repositories",
              "Check pipelines",
            ],
          },
        };
      }
      if (interpretation.navigateTo === "organization") {
        state.selectedOrganization = undefined;
        state.selectedProject = undefined;
        state.awaitingSelection = "organization";
        saveADOAgentState(sessionId, state);
        
        const orgList = `\n\nHere are the configured organizations:\n${organizations.map(org => `- ${org.name}${org.patConfigured ? '' : ' (No PAT)'}`).join('\n')}`;
        
        return {
          reply: `Sure! Which organization would you like to explore?${orgList}`,
          usedAgent: "ado",
          metadata: {
            quickReplies: organizations.filter(o => o.patConfigured).slice(0, 5).map(o => `Use: ${o.name}`),
            organizations,
          },
        };
      }
      if (interpretation.navigateTo === "project") {
        state.selectedProject = undefined;
        state.awaitingSelection = "project";
        saveADOAgentState(sessionId, state);
        
        return {
          reply: `Which project in **${state.selectedOrganization?.name}** would you like to explore?\n\nI found ${availableProjects.length} project(s).`,
          usedAgent: "ado",
          metadata: {
            quickReplies: availableProjects.slice(0, 5).map(p => `Project: ${p.name}`),
            projects: availableProjects,
          },
        };
      }
    }
    
    // Handle organization selection (LLM detected user wants to select an org)
    if (interpretation.action === "select_organization" && interpretation.organizationName) {
      const orgName = interpretation.organizationName;
      console.log(`[ADOAgent] LLM detected organization selection: "${orgName}"`);
      
      // Find matching organization (case-insensitive)
      const orgMatch = organizations.find(org => 
        org.name.toLowerCase() === orgName.toLowerCase()
      );
      
      if (orgMatch) {
        const result = await handleOrganizationSelection(orgMatch, organizations, sessionId, state);
        if (result) return result;
      } else {
        // Org not found - ask user to select from available ones
        const orgList = `\n\nHere are the configured organizations:\n${organizations.map(org => `- ${org.name}${org.patConfigured ? '' : ' (No PAT)'}`).join('\n')}`;
        
        return {
          reply: `I couldn't find an organization named "${orgName}". Please select from the available organizations.${orgList}`,
          usedAgent: "ado",
          metadata: {
            quickReplies: organizations.filter(o => o.patConfigured).slice(0, 5).map(o => `Use: ${o.name}`),
            organizations,
          },
        };
      }
    }
    
    // Handle project selection (LLM detected user wants to select a project)
    if (interpretation.action === "select_project" && interpretation.projectName && state.selectedOrganization) {
      const projectName = interpretation.projectName;
      console.log(`[ADOAgent] LLM detected project selection: "${projectName}"`);
      
      const projectMatch = availableProjects.find(p => 
        p.name.toLowerCase() === projectName.toLowerCase()
      );
      
      if (projectMatch) {
        state.selectedProject = {
          id: projectMatch.id,
          name: projectMatch.name,
        };
        saveADOAgentState(sessionId, state);
        
        // If we have a pending intent from earlier (e.g., "list all open defects"), auto-run it now.
        if (state.pendingAction && (state.pendingQueryType || state.queryType)) {
          const artifactOrgs = await storage.getArtifactOrganizations();
          const fullOrg = artifactOrgs.find(o => String(o.id) === state.selectedOrganization!.id);
          if (fullOrg?.patToken) {
            const pat = safeDecryptPAT(fullOrg.patToken);
            if (pat) {
              if (state.pendingQueryType) {
                state.queryType = state.pendingQueryType;
              }
              const actionToRun = state.pendingAction;
              const stateFilter = state.pendingStateFilter || "all";
              // Clear pending intent before execution to avoid loops
              state.pendingAction = undefined;
              state.pendingQueryType = undefined;
              state.pendingStateFilter = undefined;
              saveADOAgentState(sessionId, state);
              console.log(`[ADOAgent] Auto-running pending intent after project selection: action=${actionToRun}, queryType=${state.queryType}, stateFilter=${stateFilter}`);
              if (actionToRun === "filter_results") {
                return await executeQueryWithFilter(state, pat, stateFilter);
              } else {
                return await executeQuery(state, pat);
              }
            }
          }
        }
        
        return {
          reply: `You're now exploring **${projectMatch.name}** in **${state.selectedOrganization.name}**. What would you like to see?`,
          usedAgent: "ado",
          metadata: {
            quickReplies: [
              "Show user stories",
              "List epics",
              "View all work items",
              "View repositories",
              "Check pipelines",
            ],
          },
        };
      }
    }
    
    // Handle help action
    if (interpretation.action === "help") {
      const helpMessage = interpretation.directAnswer || "I can help you explore Azure DevOps data. You can ask me to show work items, stories, epics, repositories, pipelines, or pull requests.";
      return {
        reply: helpMessage,
        usedAgent: "ado",
        metadata: {
          quickReplies: state.selectedProject 
            ? ["Show user stories", "List epics", "View repositories", "Check pipelines"]
            : state.selectedOrganization
              ? availableProjects.slice(0, 5).map(p => `Project: ${p.name}`)
              : organizations.filter(o => o.patConfigured).slice(0, 5).map(o => `Use: ${o.name}`),
        },
      };
    }
    
    // Handle conversational responses
    if (interpretation.action === "conversational" && interpretation.directAnswer) {
      return {
        reply: interpretation.directAnswer,
        usedAgent: "ado",
        metadata: {
          quickReplies: state.selectedProject 
            ? ["Show user stories", "List epics", "View repositories", "Check pipelines"]
            : state.selectedOrganization
              ? availableProjects.slice(0, 5).map(p => `Project: ${p.name}`)
              : organizations.filter(o => o.patConfigured).slice(0, 5).map(o => `Use: ${o.name}`),
        },
      };
    }
    
    // If no organization is selected yet and LLM didn't detect org selection, prompt for selection
    if (!state.selectedOrganization) {
      state.awaitingSelection = "organization";
      saveADOAgentState(sessionId, state);
      
      const orgList = `\n\nHere are the configured organizations:\n${organizations.map(org => `- ${org.name}${org.patConfigured ? '' : ' (No PAT)'}`).join('\n')}`;
      
      return {
        reply: `I'd be happy to help you explore your Azure DevOps data. First, which organization would you like to explore?${orgList}`,
        usedAgent: "ado",
        metadata: {
          quickReplies: organizations.filter(o => o.patConfigured).slice(0, 5).map(o => `Use: ${o.name}`),
          organizations,
        },
      };
    }
    
    // If no project is selected yet, prompt for project selection
    if (!state.selectedProject) {
      state.awaitingSelection = "project";
      saveADOAgentState(sessionId, state);
      
      return {
        reply: `Which project in **${state.selectedOrganization.name}** would you like to explore?\n\nI found ${availableProjects.length} project(s).`,
        usedAgent: "ado",
        metadata: {
          quickReplies: availableProjects.slice(0, 5).map(p => `Project: ${p.name}`),
          projects: availableProjects,
        },
      };
    }
    
    // Both org and project are selected - handle data queries
    // Get PAT for API calls
    const artifactOrgs = await storage.getArtifactOrganizations();
    const fullOrg = artifactOrgs.find(o => String(o.id) === state.selectedOrganization!.id);
    
    if (!fullOrg?.patToken) {
      return {
        reply: "I couldn't find the PAT token. Please reconfigure it in Settings.",
        usedAgent: "ado",
        metadata: {
          quickReplies: ["View settings"],
        },
      };
    }
    
    const pat = safeDecryptPAT(fullOrg.patToken);
    if (!pat) {
      return {
        reply: "I couldn't decrypt the PAT token. Please reconfigure it in Settings.",
        usedAgent: "ado",
        metadata: {
          quickReplies: ["View settings"],
        },
      };
    }
    
    // Handle different interpretation actions (using the interpretation from earlier)
    if (interpretation.action === "answer_question" && interpretation.directAnswer) {
      return {
        reply: interpretation.directAnswer,
        usedAgent: "ado",
        metadata: {
          quickReplies: getContextAwareQuickReplies(state.queryType),
        },
      };
    }
    
    if (interpretation.action === "filter_results" && interpretation.stateFilter) {
      const stateFilter = interpretation.stateFilter;
      
      // CRITICAL: Update queryType from interpretation if provided
      // This ensures "list epics" + filter_results uses the correct type
      if (interpretation.queryType) {
        state.queryType = interpretation.queryType;
        saveADOAgentState(sessionId, state);
        console.log(`[ADOAgent] Updated queryType to: ${interpretation.queryType}`);
      }
      
      // Clear any pending intent since we’re executing now
      state.pendingAction = undefined;
      state.pendingQueryType = undefined;
      state.pendingStateFilter = undefined;
      saveADOAgentState(sessionId, state);

      console.log(`[ADOAgent] Filtering by state: ${stateFilter}, query type: ${state.queryType}`);
      
      const results = await executeQueryWithFilter(state, pat, stateFilter);
      return results;
    }
    
    if (interpretation.action === "new_query" && interpretation.queryType) {
      state.queryType = interpretation.queryType;
      saveADOAgentState(sessionId, state);
      // Clear any pending intent since we’re executing now
      state.pendingAction = undefined;
      state.pendingQueryType = undefined;
      state.pendingStateFilter = undefined;
      saveADOAgentState(sessionId, state);
      const results = await executeQuery(state, pat);
      return results;
    }
    
    if (interpretation.action === "clarify" && interpretation.directAnswer) {
      return {
        reply: interpretation.directAnswer,
        usedAgent: "ado",
        metadata: {
          quickReplies: getContextAwareQuickReplies(state.queryType),
        },
      };
    }
    
    // Default response when both org and project are selected
    return {
      reply: interpretation.directAnswer || `I'm here to help you explore **${state.selectedProject.name}** in **${state.selectedOrganization.name}**. What would you like to see?\n\nYou can ask me about user stories, epics, repositories, pipelines, or filter items by their state (open, closed, active).`,
      usedAgent: "ado",
      metadata: {
        quickReplies: [
          "Show user stories",
          "List epics",
          "View all work items",
          "View repositories",
          "Check pipelines",
        ],
      },
    };
  }
};

async function executeQuery(state: ADOAgentState, pat: string): Promise<AgentResponse> {
  const { selectedOrganization, selectedProject, queryType } = state;
  
  if (!selectedOrganization || !selectedProject || !queryType) {
    return {
      reply: "I need more information to complete this query. Please select an organization and project first.",
      usedAgent: "ado",
      metadata: {
        quickReplies: [],
      },
    };
  }
  
  let response: string;
  let items: any[] = [];
  
  switch (queryType) {
    case "stories": {
      const result = await fetchWorkItems(selectedOrganization.organizationUrl, selectedProject.name, pat, "User Story");
      items = result.items;
      response = formatWorkItemsResponse(result.items, "user stories", result.totalCount);
      break;
    }
      
    case "epics": {
      const result = await fetchWorkItems(selectedOrganization.organizationUrl, selectedProject.name, pat, "Epic");
      items = result.items;
      response = formatWorkItemsResponse(result.items, "epics", result.totalCount);
      break;
    }
    
    case "bugs": {
      const result = await fetchWorkItems(selectedOrganization.organizationUrl, selectedProject.name, pat, "Bug");
      items = result.items;
      response = formatWorkItemsResponse(result.items, "bugs", result.totalCount);
      break;
    }
    
    case "tasks": {
      const result = await fetchWorkItems(selectedOrganization.organizationUrl, selectedProject.name, pat, "Task");
      items = result.items;
      response = formatWorkItemsResponse(result.items, "tasks", result.totalCount);
      break;
    }
    
    case "features": {
      const result = await fetchWorkItems(selectedOrganization.organizationUrl, selectedProject.name, pat, "Feature");
      items = result.items;
      response = formatWorkItemsResponse(result.items, "features", result.totalCount);
      break;
    }
      
    case "work_items": {
      const result = await fetchWorkItems(selectedOrganization.organizationUrl, selectedProject.name, pat);
      items = result.items;
      response = formatWorkItemsResponse(result.items, "work items", result.totalCount);
      break;
    }
      
    case "repositories":
      items = await fetchRepositories(selectedOrganization.organizationUrl, selectedProject.name, pat);
      response = formatRepositoriesResponse(items);
      break;
      
    case "pipelines":
      items = await fetchPipelines(selectedOrganization.organizationUrl, selectedProject.name, pat);
      response = formatPipelinesResponse(items);
      break;
      
    case "pull_requests":
      items = await fetchPullRequests(selectedOrganization.organizationUrl, selectedProject.name, pat);
      response = formatPullRequestsResponse(items);
      break;
      
    default:
      response = "I'm not sure what you're looking for. Please choose from the options below.";
  }
  
  // Save the results to state for future reference by LLM
  state.lastQueryResults = items;
  state.lastQueryDescription = getQueryTypeLabel(queryType);
  
  // Generate context-aware quick replies - exclude the action that was just performed
  console.log(`[ADOAgent] executeQuery completed. QueryType: ${queryType}, generating context-aware quick replies`);
  const quickReplies = getContextAwareQuickReplies(queryType);
  console.log(`[ADOAgent] Quick replies generated:`, quickReplies);
  
  return {
    reply: response,
    usedAgent: "ado",
    metadata: {
      quickReplies,
    },
  };
}

// Execute query with state filtering
async function executeQueryWithFilter(
  state: ADOAgentState,
  pat: string,
  stateFilter: "open" | "closed" | "active" | "new" | "resolved" | "all"
): Promise<AgentResponse> {
  const { selectedOrganization, selectedProject, queryType } = state;
  
  if (!selectedOrganization || !selectedProject) {
    return {
      reply: "I need an organization and project selected first.",
      usedAgent: "ado",
      metadata: {
        quickReplies: [],
      },
    };
  }
  
  const effectiveQueryType = queryType || "work_items";
  let response: string;
  let items: any[] = [];
  
  // More descriptive state labels
  const stateLabel = stateFilter === "open" ? "open" : 
                     stateFilter === "closed" ? "closed" : 
                     stateFilter;
  
  // State descriptions for context
  const stateDescription = stateFilter === "closed" 
    ? "(Closed, Done, Resolved, or Removed)" 
    : stateFilter === "open" 
      ? "(New, Active, In Progress, Design, or Committed)" 
      : "";
  
  switch (effectiveQueryType) {
    case "stories": {
      const result = await fetchWorkItems(selectedOrganization.organizationUrl, selectedProject.name, pat, "User Story", stateFilter);
      items = result.items;
      if (result.items.length > 0) {
        response = formatWorkItemsResponse(result.items, `${stateLabel} user stories ${stateDescription}`, result.totalCount);
      } else {
        response = `No ${stateLabel} user stories found ${stateDescription} in the **${selectedProject.name}** project.`;
      }
      break;
    }
      
    case "epics": {
      const result = await fetchWorkItems(selectedOrganization.organizationUrl, selectedProject.name, pat, "Epic", stateFilter);
      items = result.items;
      if (result.items.length > 0) {
        response = formatWorkItemsResponse(result.items, `${stateLabel} epics ${stateDescription}`, result.totalCount);
      } else {
        response = `No ${stateLabel} epics found ${stateDescription} in the **${selectedProject.name}** project.`;
      }
      break;
    }
    
    case "bugs": {
      const result = await fetchWorkItems(selectedOrganization.organizationUrl, selectedProject.name, pat, "Bug", stateFilter);
      items = result.items;
      if (result.items.length > 0) {
        response = formatWorkItemsResponse(result.items, `${stateLabel} bugs ${stateDescription}`, result.totalCount);
      } else {
        response = `No ${stateLabel} bugs found ${stateDescription} in the **${selectedProject.name}** project.`;
      }
      break;
    }
    
    case "tasks": {
      const result = await fetchWorkItems(selectedOrganization.organizationUrl, selectedProject.name, pat, "Task", stateFilter);
      items = result.items;
      if (result.items.length > 0) {
        response = formatWorkItemsResponse(result.items, `${stateLabel} tasks ${stateDescription}`, result.totalCount);
      } else {
        response = `No ${stateLabel} tasks found ${stateDescription} in the **${selectedProject.name}** project.`;
      }
      break;
    }
    
    case "features": {
      const result = await fetchWorkItems(selectedOrganization.organizationUrl, selectedProject.name, pat, "Feature", stateFilter);
      items = result.items;
      if (result.items.length > 0) {
        response = formatWorkItemsResponse(result.items, `${stateLabel} features ${stateDescription}`, result.totalCount);
      } else {
        response = `No ${stateLabel} features found ${stateDescription} in the **${selectedProject.name}** project.`;
      }
      break;
    }
      
    case "work_items":
    default: {
      const result = await fetchWorkItems(selectedOrganization.organizationUrl, selectedProject.name, pat, undefined, stateFilter);
      items = result.items;
      if (result.items.length > 0) {
        response = formatWorkItemsResponse(result.items, `${stateLabel} work items ${stateDescription}`, result.totalCount);
      } else {
        response = `No ${stateLabel} work items found ${stateDescription} in the **${selectedProject.name}** project.`;
      }
      break;
    }
  }
  
  // Update state with new results
  state.lastQueryResults = items;
  state.lastQueryDescription = `${stateLabel} ${getQueryTypeLabel(effectiveQueryType)}`;
  
  const quickReplies = [
    stateFilter === "open" ? "Show closed items" : "Show open items",
    ...getContextAwareQuickReplies(effectiveQueryType).slice(0, 4),
  ];
  
  return {
    reply: response,
    usedAgent: "ado",
    metadata: {
      quickReplies,
    },
  };
}

// Generate quick replies that exclude the action just performed
function getContextAwareQuickReplies(lastQueryType: string | undefined): string[] {
  const allOptions = [
    { key: "stories", label: "Show user stories" },
    { key: "epics", label: "List epics" },
    { key: "bugs", label: "Show bugs" },
    { key: "tasks", label: "List tasks" },
    { key: "features", label: "Show features" },
    { key: "work_items", label: "View all work items" },
    { key: "repositories", label: "View repositories" },
    { key: "pipelines", label: "Check pipelines" },
  ];
  
  // Filter out the action that was just performed and limit to 5 options
  const filteredOptions = allOptions.filter(opt => opt.key !== lastQueryType);
  
  // Return only relevant action options (max 5)
  return filteredOptions.slice(0, 5).map(opt => opt.label);
}

function getQueryTypeLabel(queryType: string): string {
  switch (queryType) {
    case "stories": return "user stories";
    case "epics": return "epics";
    case "bugs": return "bugs";
    case "tasks": return "tasks";
    case "features": return "features";
    case "work_items": return "work items";
    case "repositories": return "repositories";
    case "pipelines": return "pipelines";
    case "pull_requests": return "pull requests";
    default: return "ADO data";
  }
}
