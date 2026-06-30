import type { AgentIntent, ClassificationResult, ConversationContext } from "./types";
import { getSessionState } from "./state";
import { isAdoWorkItemsAllowed } from "../../platform/hosting";
import { getOptionalSuperAgentLlmClient } from "./optionalLlmClient";

/** Singular + plural; avoids `\b…repo\b` failing on "golden repos" (repo + s breaks trailing word-boundary). */
const GOLDEN_REPO_INTENT_PATTERN =
  /\b(golden\s*repos?|golden\s*repositories|template|starter|scaffold|boilerplate|show\s*templates?|browse\s*templates?)\b/i;

const CLASSIFIER_SYSTEM_PROMPT = `You are an ULTRA-INTELLIGENT intent classifier for the Astra development platform. Your job is to understand what users TRULY want to accomplish and route them to the RIGHT agent that can ACTUALLY help them.

## Your Core Mission:
- Think like ChatGPT - be extremely smart about understanding user intent
- Look beyond surface-level keywords to understand the REAL user goal
- Consider what the user expects to happen after they ask their question
- Route queries to agents that can ACTUALLY fulfill the request, not just give guidance
- When in doubt, choose the agent that can take ACTION rather than just explain

## Intent Categories & Routing Logic:

1. **ado** - User wants to ACCESS, QUERY, VIEW, or EXPLORE existing Azure DevOps data
   - **Key principle**: If user wants to SEE actual data from their ADO, route here
   - Strong signals: "list", "show", "get", "fetch", "view", "find", "search", "what", "which", "how many", "count", "open", "closed", "active"
   - Work item queries: "list defects", "show bugs", "open stories", "all work items", "my tasks", "count epics"
   - ADO exploration: "what's in my project", "show repositories", "check pipelines", "view pull requests"
   - State-based queries: "open defects", "closed bugs", "active stories", "new tasks"
   - **CRITICAL**: User expects to see ACTUAL DATA, not instructions on how to find it

2. **goldenRepo** - User wants TEMPLATE repositories for starting NEW projects
   - Clear signals: "template", "golden repo", "starter", "scaffold", "bootstrap", "boilerplate", "example project"
   - Examples: "Show templates", "React starter", "Node.js boilerplate", "What templates are available?"
   - **Note**: This is for PROJECT TEMPLATES, not existing ADO repos (those go to ado)

3. **settings** - User wants to CONFIGURE, SETUP, or MANAGE platform connections
   - Clear signals: "configure", "setup", "settings", "connect", "PAT", "token", "organization", "add project"
   - Examples: "Configure ADO", "Add organization", "Update settings", "Fix connection", "Set up project"
   - Connection management and platform configuration

4. **jira** - User wants to ACCESS, QUERY, or DISCUSS **Atlassian Jira** (data **or** how Jira fits into Astra)
   - Strong signals: "jira", "atlassian", "jql", "jira issues", "jira tickets", "jira epics", "jira backlog", "jira project", "jira integration"
   - Examples: "List issues in Jira", "Query Jira data", "What is Jira integration?", "How does Jira work in Astra?", "Show my Jira epics"
   - **CRITICAL**: If the user names Jira/Atlassian/JQL, route to **jira** even if they say "stories", "bugs", or "tickets"

5. **modernization** - User wants **Stack Modernization** / **Tech Stack Upgrade** in Astra (assessment, dependency graph, version upgrades, risk report, code upgrade, test generation, publish)
   - Strong signals: "stack modernization", "tech stack upgrade", "explore modernization", "modernization module", "replatform this repo", "upgrade my codebase", "dependency graph for upgrade", "version intelligence", "risk report upgrade"
   - **NOT** golden repository templates (those stay **goldenRepo**)

6. **general** - Platform questions, help, conversation, or truly unclear requests
   - Platform info: "What is Astra?", "How does Astra work?", "What can you do?", "Help me understand"
   - Conversational: Greetings, thanks, general discussion
   - Unclear requests that need clarification
   - **Note**: Only use when user is asking ABOUT the platform, not trying to USE it

## ENHANCED SMART ROUTING RULES:

### Data Access vs Information
**CRITICAL DISTINCTION**: Route based on what user expects to receive:
- "list open defects" → ado (expects to see actual defect data)
- "how to find defects" → general (wants to learn about the process)
- "show my work items" → ado (expects to see their actual work items)
- "what is a work item" → general (wants to understand the concept)

### Context-Aware Routing Examples
- "I need help finding stories" → ado (they want to QUERY and SEE stories)
- "I need help with DevX" → general (they want to LEARN about platform)
- "list all open defects" → ado (they want to SEE the defects)
- "create a story" → general (story creation disabled, redirect to platform guidance)
- "Help" alone → general (need clarification)

### Action Word Intelligence
- SHOW/LIST/VIEW/GET/FETCH/FIND + work items → ado (data access), **unless** the user names **Jira / Atlassian / JQL** → jira
- COUNT/HOW MANY + work items → ado (data query), **unless** Jira is named → jira
- CONFIGURE/SETUP/ADD + platform → settings
- WHAT IS/HOW DOES/EXPLAIN + **Jira / Atlassian / Jira integration** → jira
- WHAT IS/HOW DOES/EXPLAIN + DevX (without Jira) → general

### Work Item Query Detection
**Route to ADO if user mentions:**
- Work item types: "stories", "epics", "tasks", "bugs", "defects", "features", "work items"
- Work item states: "open", "closed", "active", "new", "resolved", "in progress"
- Query actions: "list", "show", "get", "find", "count", "view", "display"
- Combined patterns: "open bugs", "my stories", "all defects", "active tasks"

### Repository Context
- "repos" + "golden/template" → goldenRepo (template repos)
- "repos" + "show/list/my" → ado (actual project repos)
- "repositories in my project" → ado (actual repos)
- "template repositories" → goldenRepo (templates)

### Smart Defaults
- If user wants to SEE data from **Azure DevOps** → ado
- If user wants to SEE data from **Jira** → jira
- If user wants **Stack Modernization / tech stack upgrade** workflows → modernization
- If user wants to LEARN about DevX → general
- If user wants to CONFIGURE platform → settings
- If user wants project TEMPLATES → goldenRepo

## Response Format:
Return ONLY a JSON object:
{
  "intent": "ado" | "goldenRepo" | "settings" | "general" | "jira" | "modernization",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}`;

const VALID_CLASSIFIER_INTENTS: AgentIntent[] = [
  "ado",
  "goldenRepo",
  "settings",
  "general",
  "jira",
  "modernization",
];

function sanitizeIntent(raw: unknown): AgentIntent {
  if (
    typeof raw === "string" &&
    VALID_CLASSIFIER_INTENTS.includes(raw as AgentIntent)
  ) {
    return raw as AgentIntent;
  }
  return "general";
}

/** User wants Jira: data fetch, JQL, Atlassian, or integration *explainer* questions. */
function isExplicitJiraQuery(lowerMessage: string): boolean {
  if (/\bquery\s+jira\s+data\b/i.test(lowerMessage)) return true;
  if (/\b(atlassian|jql)\b/i.test(lowerMessage)) return true;
  if (/\bjira\b/i.test(lowerMessage)) return true;
  return false;
}

/** Stack Modernization / Tech Stack Upgrade — not Jira, not golden templates. */
function isExplicitModernizationQuery(lowerMessage: string): boolean {
  if (/\bexplore\s+modernization\b/i.test(lowerMessage)) return true;
  if (/\bstack\s*modernization\b/i.test(lowerMessage)) return true;
  if (/\btech\s*stack\s*upgrad(e|ing)\b/i.test(lowerMessage)) return true;
  if (/\bmodernization\s+module\b/i.test(lowerMessage)) return true;
  if (/\bstack\s*mod\b/i.test(lowerMessage)) return true;
  if (
    /\breplatform(ing)?\b/i.test(lowerMessage) &&
    /\b(repo|repos|codebase|code|project|app|application)\b/i.test(lowerMessage)
  ) {
    return true;
  }
  if (
    /\b(code\s*upgrade|upgrade\s*analysis|version\s*intelligence)\b/i.test(lowerMessage) &&
    /\b(modern|stack|repo|dependency)\b/i.test(lowerMessage)
  ) {
    return true;
  }
  return false;
}

function isViewSettingsMessage(lowerMessage: string): boolean {
  return (
    /\bview\s+my\s+settings\b/i.test(lowerMessage) ||
    /\b(go\s*to|open|view|show|visit)\s*(the\s*)?(settings|config|configuration)\s*(page)?\b/i.test(
      lowerMessage,
    ) ||
    /\b(my\s+)?settings\s+(page|screen)\b/i.test(lowerMessage)
  );
}

export async function classifyIntent(
  message: string,
  context: ConversationContext
): Promise<ClassificationResult> {
  const sessionState = getSessionState(context.sessionId);
  const activeAgent = sessionState.activeAgent;
  
  const contextAwareResult = contextAwareClassification(message, activeAgent);
  if (contextAwareResult) {
    console.log(`[Classifier] Context-aware classification: ${contextAwareResult.intent} (activeAgent: ${activeAgent})`);
    return contextAwareResult;
  }

  const openai = getOptionalSuperAgentLlmClient();
  if (!openai) {
    console.log("[Classifier] LLM classifier not configured; using fallback classification");
    return fallbackClassification(message, activeAgent);
  }
  
  try {
    const recentHistory = context.conversationHistory
      .slice(-5)
      .map(m => `${m.role}: ${m.content}`)
      .join("\n");

    const contextInfo = `
CURRENT ASTRA CONTEXT:
- Organization: ${context.selectedOrganization?.name || "NOT SELECTED"}
- Project: ${context.selectedProject?.name || "NOT SELECTED"}
- Repository: ${context.selectedRepository?.name || "None"}
- Active agent: ${activeAgent || "None"}

RECENT CONVERSATION:
${recentHistory}

USER'S CURRENT MESSAGE TO CLASSIFY: "${message}"

AGENT CAPABILITIES SUMMARY:
- **ADO Agent**: Can fetch and display actual Azure DevOps data (work items, stories, bugs, defects, epics, repositories, pipelines, pull requests). Route here when user wants to SEE real data.
- **Golden Repo Agent**: Provides template repositories for starting new projects. Route here for project templates and starters.
- **Settings Agent**: Handles platform configuration, organization setup, project connections. Route here for configuration tasks.
- **Jira Agent**: Fetches and explains **Atlassian Jira** issues, epics, backlog, and Jira integration for the current project. Route here when the user mentions Jira, Atlassian, JQL, or "Query Jira data".
- **Modernization Agent**: Explains **Stack Modernization** (tech stack upgrade): phases, navigation, assessment, planning, code upgrade, tests, publish. Route when the user says **stack modernization**, **tech stack upgrade**, **explore modernization**, **modernization module**, or **replatform** a repo/codebase in Astra.
- **General Agent**: Answers questions ABOUT the Astra platform, provides help and guidance. Route here for platform information or when unclear.

CRITICAL ROUTING DECISION:
If user wants to ACCESS/VIEW/LIST actual data from their Azure DevOps projects (like "list open defects", "show bugs", "my work items"), route to **ado**.
If user wants to ACCESS/VIEW/LIST **Jira** issues, epics, tickets, backlog, **or asks what/how Jira integration works in Astra**, route to **jira** (the Jira Agent answers setup explainers and live queries).
If user wants **Stack Modernization** workflows (upgrade analysis, dependency graph for upgrades, risk report, code upgrade module), route to **modernization**.
If user wants to LEARN about **non-Jira** Astra platform features or needs broad help, route to **general**.
If user wants project TEMPLATES or starters, route to **goldenRepo**.
If user wants to CONFIGURE or setup platform connections, route to **settings**.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
        { role: "user", content: contextInfo }
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: "json_object" }
    });

    // Bedrock ignores the OpenAI-only `response_format` flag and may wrap the
    // JSON in a ```json ... ``` markdown fence, which breaks JSON.parse
    // ("Unexpected token '`'"). Strip the fence before parsing.
    let rawContent = (response.choices[0]?.message?.content || "{}").trim();
    if (rawContent.startsWith("```")) {
      rawContent = rawContent
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?```\s*$/i, "")
        .trim();
    }
    const result = JSON.parse(rawContent);
    console.log(
      `[Classifier] LLM classification OK → intent=${result.intent} confidence=${result.confidence}`,
    );

    let intent = sanitizeIntent(result.intent);
    const lowerLlm = message.toLowerCase().trim();
    if (GOLDEN_REPO_INTENT_PATTERN.test(lowerLlm)) {
      intent = "goldenRepo";
      return {
        intent,
        confidence: Math.max(0.94, Number(result.confidence) || 0.94),
        reasoning: "Golden repo / template phrase — override LLM routing to goldenRepo",
      };
    }

    if (isExplicitModernizationQuery(lowerLlm)) {
      intent = "modernization";
      return {
        intent,
        confidence: Math.max(0.93, Number(result.confidence) || 0.93),
        reasoning: "Stack Modernization / tech stack upgrade phrase — override to modernization",
      };
    }

    return {
      intent,
      confidence: result.confidence || 0.5,
      reasoning: result.reasoning,
    };
  } catch (error) {
    console.error("[Classifier] Error classifying intent:", error);
    return fallbackClassification(message, activeAgent);
  }
}

function contextAwareClassification(
  message: string, 
  activeAgent?: string
): ClassificationResult | null {
  const lowerMessage = message.toLowerCase().trim();
  
  console.log(`[Classifier] contextAwareClassification - activeAgent: ${activeAgent}, message: "${lowerMessage.substring(0, 50)}"`);
  
  // CRITICAL FIRST CHECK: Golden Repo requests BEFORE anything else can intercept them
  // This prevents "show golden repo" from matching the general "show repos" pattern
  if (GOLDEN_REPO_INTENT_PATTERN.test(lowerMessage)) {
    console.log(`[Classifier] Golden repo request detected at early stage - routing to Golden Repo Agent`);
    return { 
      intent: "goldenRepo", 
      confidence: 0.96, 
      reasoning: "Golden repo/template request detected early before data patterns" 
    };
  }

  if (isExplicitJiraQuery(lowerMessage)) {
    console.log(`[Classifier] Jira-specific request detected — routing to Jira Agent`);
    return {
      intent: "jira",
      confidence: 0.97,
      reasoning: "Jira / Atlassian / JQL signal — route to Jira Agent",
    };
  }

  if (isExplicitModernizationQuery(lowerMessage)) {
    console.log(`[Classifier] Stack Modernization request — routing to Modernization Agent`);
    return {
      intent: "modernization",
      confidence: 0.96,
      reasoning: "Stack Modernization / tech stack upgrade signal",
    };
  }
  
  // SMART DATA QUERY DETECTION - Route to ADO regardless of active agent
  // These patterns indicate user wants to ACCESS/VIEW actual data
  const dataQueryPatterns = [
    // Work item queries with state filters
    /\b(list|show|get|find|view|display|count|how\s*many)\s+.*\b(open|closed|active|new|resolved|assigned|unassigned)\s+.*\b(defects?|bugs?|stories|epics?|tasks?|features?|work\s*items?)\b/i,
    /\b(open|closed|active|new|resolved|assigned|unassigned)\s+.*\b(defects?|bugs?|stories|epics?|tasks?|features?|work\s*items?)\b/i,
    
    // Direct work item type queries
    /\b(list|show|get|find|view|display|count|how\s*many)\s+.*\b(defects?|bugs?|stories|epics?|tasks?|features?|work\s*items?)\b/i,
    /\b(all|my|our|the)\s+.*\b(defects?|bugs?|stories|epics?|tasks?|features?|work\s*items?)\b/i,
    
    // "What" queries about existing data. Note: deliberately NOT matching a
    // bare "are" — it false-matches platform questions like "which features
    // are most useful". Real data queries still match via the state words
    // (open/closed/assigned/...) which already appear after "are".
    /\b(what|which)\s+.*\b(defects?|bugs?|stories|epics?|tasks?|features?|work\s*items?)\s+.*\b(do\s*we\s*have|exist|assigned|open|closed)\b/i,
    
    // Repository and pipeline queries
    /\b(list|show|get|view)\s+.*\b(repos?|repositories|pipelines?|builds?|pull\s*requests?)\b/i,
    /\b(my|our|project)\s+.*\b(repos?|repositories|pipelines?)\b/i
  ];
  
  for (const pattern of dataQueryPatterns) {
    if (pattern.test(lowerMessage)) {
      if (GOLDEN_REPO_INTENT_PATTERN.test(lowerMessage)) {
        continue;
      }

      // If the user is already in Jira context (last agent was Jira) OR ADO work
      // items are not allowed in this hosting mode (e.g. AWS / Jira-only), keep
      // generic data queries like "show stories/tasks/bugs" in the Jira agent.
      // This prevents the ADO agent from intercepting Jira chip replies such as
      // "show Sample issues (stories/tasks/bugs, up to 15)".
      const adoAllowed = isAdoWorkItemsAllowed();
      if (activeAgent === "jira" || !adoAllowed) {
        console.log(
          `[Classifier] SMART ROUTING: Data query detected — keeping in Jira agent (activeAgent=${activeAgent}, adoAllowed=${adoAllowed}). Pattern: ${pattern}`,
        );
        return {
          intent: "jira",
          confidence: 0.98,
          reasoning:
            "Smart routing: data query while Jira is the active platform / Jira-only hosting — route to Jira agent",
        };
      }

      console.log(`[Classifier] SMART ROUTING: Data query detected - routing to ADO agent. Pattern: ${pattern}`);
      return { 
        intent: "ado", 
        confidence: 0.98, 
        reasoning: "Smart routing: User wants to access/view actual project data - routing to ADO agent" 
      };
    }
  }
  
  // ADO Agent context - Check if this is still an ADO query or if user is asking about something else
  if (activeAgent === "ado") {
    console.log(`[Classifier] ADO Agent active - validating if this is still an ADO query`);

    if (
      isExplicitJiraQuery(lowerMessage) &&
      !/\b(ado|azure\s*devops?)\b/i.test(lowerMessage)
    ) {
      console.log(`[Classifier] Jira query during ADO flow — switching to Jira Agent`);
      return {
        intent: "jira",
        confidence: 0.95,
        reasoning: "User pivoted to Jira — leave ADO agent",
      };
    }
    
    // FIRST: Check for explicit settings/config request - this should switch
    if (
      isViewSettingsMessage(lowerMessage) ||
      /\b(go\s*to|open|configure|setup)\s*(the\s*)?(settings|config|configuration)\b/i.test(lowerMessage)
    ) {
      console.log(`[Classifier] Explicit settings request during ADO flow - switching to Settings Agent`);
      return { intent: "settings", confidence: 0.95, reasoning: "Settings request - switching from ADO to Settings Agent" };
    }
    
    // SECOND: Check for explicit golden repo request - this should switch
    if (GOLDEN_REPO_INTENT_PATTERN.test(lowerMessage)) {
      console.log(`[Classifier] Explicit golden repo request during ADO flow - switching to Golden Repo Agent`);
      return { intent: "goldenRepo", confidence: 0.95, reasoning: "Golden repo request - switching from ADO to Golden Repo Agent" };
    }

    if (isExplicitModernizationQuery(lowerMessage)) {
      console.log(`[Classifier] Stack Modernization request during ADO flow — switching to Modernization Agent`);
      return {
        intent: "modernization",
        confidence: 0.94,
        reasoning: "User asking about Stack Modernization while in ADO context",
      };
    }
    
    // THIRD: Check if this is a GENERAL/PLATFORM question (asking about DevX features, help, navigation)
    // If user is asking "What is DevX?", "How does X work?", "Help", etc., they want the general agent
    const generalQuestionPatterns = [
      /\b(what\s+is|what\s+are|how\s+do(es)?|how\s+to|tell\s+me\s+about)\s+(astra|the\s+platform|this\s+feature|the\s+overview|the\s+hub|golden\s+repos?|settings|asking|persona|prompt|sdlc)/i,
      /\b(help|guide|explain|teach|show\s+me|tutorial|how\s+does\s+it\s+work|what\s+can\s+i\s+do)\b/i,
      /\b(what\s+is\s+astra|what\s+features\s+does|capabilities|can\s+you\s+help|assistance)\b/i,
      /^(help|hi|hello|hey|greetings?)\s*$/i,
      /\b(overview|dashboard|navigation|main\s+menu|getting\s+started|getting\s+help)\b/i
    ];
    
    for (const pattern of generalQuestionPatterns) {
      if (pattern.test(lowerMessage)) {
        console.log(`[Classifier] General platform question detected during ADO flow - switching to General Agent`);
        return { 
          intent: "general", 
          confidence: 0.92, 
          reasoning: "User asking about DevX platform features/help - not an ADO data query" 
        };
      }
    }
    
    // FOURTH: If message matches ADO data patterns, stay with ADO
    // This ensures repeated ADO queries keep using ADO agent
    if (dataQueryPatterns.some(pattern => pattern.test(lowerMessage))) {
      console.log(`[Classifier] ADO data query pattern confirmed - staying with ADO Agent`);
      return { 
        intent: "ado", 
        confidence: 0.99, 
        reasoning: "ADO data query pattern detected - continuing with ADO Agent" 
      };
    }
    
    // FIFTH: For ambiguous messages during ADO flow, forward to ADO Agent's LLM
    // This includes: "use X", "select X", organization names, project names, navigation, etc.
    console.log(`[Classifier] ADO Agent active - forwarding ambiguous message to ADO Agent's LLM for interpretation`);
    return { intent: "ado", confidence: 0.85, reasoning: "Ambiguous message in ADO context - ADO Agent LLM will interpret in context" };
  }

  // Jira Agent context — stay on Jira unless user clearly switches
  if (activeAgent === "jira") {
    console.log(`[Classifier] Jira Agent active — validating continuation vs agent switch`);

    if (/\bquery\s+ado\s+data\b/i.test(lowerMessage)) {
      return {
        intent: "ado",
        confidence: 0.99,
        reasoning: "Query ADO data from Jira context",
      };
    }

    if (
      isViewSettingsMessage(lowerMessage) ||
      /\b(go\s*to|open|configure|setup)\s*(the\s*)?(settings|config|configuration)\b/i.test(lowerMessage)
    ) {
      return {
        intent: "settings",
        confidence: 0.95,
        reasoning: "Settings navigation from Jira flow",
      };
    }

    if (GOLDEN_REPO_INTENT_PATTERN.test(lowerMessage)) {
      return {
        intent: "goldenRepo",
        confidence: 0.96,
        reasoning: "Golden repo / template request from Jira context",
      };
    }

    if (isExplicitModernizationQuery(lowerMessage)) {
      return {
        intent: "modernization",
        confidence: 0.95,
        reasoning: "Stack Modernization from Jira context",
      };
    }

    if (
      /\b(ado|azure\s*devops?)\b/i.test(lowerMessage) &&
      /\b(list|show|get|fetch|work\s*items?|pipelines?|repos?|defects?|bugs?)\b/i.test(lowerMessage)
    ) {
      return {
        intent: "ado",
        confidence: 0.93,
        reasoning: "Explicit Azure DevOps data request from Jira context",
      };
    }

    const generalQuestionPatterns = [
      /\b(what\s+is|what\s+are|how\s+do(es)?|how\s+to|tell\s+me\s+about)\s+(astra|the\s+platform|this\s+feature|the\s+overview|the\s+hub|golden\s+repos?|settings|asking|persona|prompt|sdlc)/i,
      /\b(help|guide|explain|teach|show\s+me|tutorial|how\s+does\s+it\s+work|what\s+can\s+i\s+do)\b/i,
      /\b(what\s+is\s+astra|what\s+features\s+does|capabilities|can\s+you\s+help|assistance)\b/i,
      /^(help|hi|hello|hey|greetings?)\s*$/i,
      /\b(overview|dashboard|navigation|main\s+menu|getting\s+started|getting\s+help)\b/i,
    ];

    for (const pattern of generalQuestionPatterns) {
      if (pattern.test(lowerMessage)) {
        if (GOLDEN_REPO_INTENT_PATTERN.test(lowerMessage)) {
          break;
        }
        return {
          intent: "general",
          confidence: 0.9,
          reasoning: "General DevX platform question from Jira context",
        };
      }
    }

    if (GOLDEN_REPO_INTENT_PATTERN.test(lowerMessage)) {
      return {
        intent: "goldenRepo",
        confidence: 0.96,
        reasoning: "Golden repo after general-pattern skip from Jira context",
      };
    }

    if (isExplicitJiraQuery(lowerMessage)) {
      return {
        intent: "jira",
        confidence: 0.99,
        reasoning: "Continuing Jira-focused conversation",
      };
    }

    return {
      intent: "jira",
      confidence: 0.85,
      reasoning: "Ambiguous message in Jira context — Jira Agent will interpret",
    };
  }

  // Modernization Agent context — stay focused unless user clearly switches
  if (activeAgent === "modernization") {
    if (/\bquery\s+ado\s+data\b/i.test(lowerMessage)) {
      return {
        intent: "ado",
        confidence: 0.99,
        reasoning: "Query ADO data from Modernization context",
      };
    }
    if (/\bquery\s+jira\s+data\b/i.test(lowerMessage)) {
      return {
        intent: "jira",
        confidence: 0.99,
        reasoning: "Query Jira data from Modernization context",
      };
    }
    if (
      isViewSettingsMessage(lowerMessage) ||
      /\b(go\s*to|open|configure|setup)\s*(the\s*)?(settings|config|configuration)\b/i.test(lowerMessage)
    ) {
      return {
        intent: "settings",
        confidence: 0.95,
        reasoning: "Settings navigation from Modernization context",
      };
    }
    if (GOLDEN_REPO_INTENT_PATTERN.test(lowerMessage)) {
      return {
        intent: "goldenRepo",
        confidence: 0.96,
        reasoning: "Golden repo from Modernization context",
      };
    }
    if (
      isExplicitJiraQuery(lowerMessage) &&
      !/\b(stack\s*modern|tech\s*stack\s*upgrad|modernization\s+module)\b/i.test(lowerMessage)
    ) {
      return {
        intent: "jira",
        confidence: 0.92,
        reasoning: "Jira pivot from Modernization context",
      };
    }
    if (
      /\b(ado|azure\s*devops?)\b/i.test(lowerMessage) &&
      /\b(list|show|get|fetch|work\s*items?|pipelines?|repos?|defects?|bugs?)\b/i.test(lowerMessage)
    ) {
      return {
        intent: "ado",
        confidence: 0.93,
        reasoning: "Explicit ADO data request from Modernization context",
      };
    }
    const generalQuestionPatterns = [
      /\b(what\s+is|what\s+are|how\s+do(es)?|how\s+to|tell\s+me\s+about)\s+(astra|the\s+platform|this\s+feature|the\s+overview|the\s+hub|golden\s+repos?|settings|asking|persona|prompt|sdlc)/i,
      /\b(help|guide|explain|teach|show\s+me|tutorial|how\s+does\s+it\s+work|what\s+can\s+i\s+do)\b/i,
      /\b(what\s+is\s+astra|what\s+features\s+does|capabilities|can\s+you\s+help|assistance)\b/i,
      /^(help|hi|hello|hey|greetings?)\s*$/i,
      /\b(overview|dashboard|navigation|main\s+menu|getting\s+started|getting\s+help)\b/i,
    ];
    for (const pattern of generalQuestionPatterns) {
      if (pattern.test(lowerMessage)) {
        if (GOLDEN_REPO_INTENT_PATTERN.test(lowerMessage)) break;
        return {
          intent: "general",
          confidence: 0.9,
          reasoning: "General DevX platform question from Modernization context",
        };
      }
    }
    if (isExplicitModernizationQuery(lowerMessage)) {
      return {
        intent: "modernization",
        confidence: 0.99,
        reasoning: "Continuing Stack Modernization conversation",
      };
    }
    return {
      intent: "modernization",
      confidence: 0.85,
      reasoning: "Modernization context — Modernization Agent will interpret",
    };
  }
  
  // Settings Agent context - Handle settings-specific interactions
  if (activeAgent === "settings") {
    console.log(`[Classifier] Settings Agent active - validating if this is still a settings question`);

    if (isExplicitModernizationQuery(lowerMessage)) {
      return {
        intent: "modernization",
        confidence: 0.94,
        reasoning: "Stack Modernization from Settings context",
      };
    }

    if (
      /\b(configure|config|setup|set\s*up|add|update|token|api)\b/i.test(lowerMessage) &&
      /\bjira\b/i.test(lowerMessage)
    ) {
      return {
        intent: "settings",
        confidence: 0.95,
        reasoning: "Jira configuration task — stay in Settings Agent",
      };
    }

    if (isExplicitJiraQuery(lowerMessage)) {
      console.log(`[Classifier] Jira data query during Settings flow — switching to Jira Agent`);
      return {
        intent: "jira",
        confidence: 0.93,
        reasoning: "Jira data / integration question — switch to Jira Agent",
      };
    }
    
    // Organization and project selection quick replies in settings
    if (/^use:\s*/i.test(lowerMessage) || /^project:\s*/i.test(lowerMessage)) {
      console.log(`[Classifier] Settings context: Organization/project selection detected`);
      return { intent: "settings", confidence: 0.99, reasoning: "Organization/project selection in Settings context" };
    }
    
    // View projects/repos in settings context
    if (/\b(view|show|list)\s*(the\s*)?(projects?|repos?|repositories)/i.test(lowerMessage)) {
      return { intent: "settings", confidence: 0.95, reasoning: "View projects/repos in Settings context" };
    }
    
    // Navigation in settings
    if (/\b(start\s*over|reset|back|main\s*menu|show\s*organizations)/i.test(lowerMessage)) {
      return { intent: "settings", confidence: 0.9, reasoning: "Navigation in Settings context" };
    }
    
    // Help in settings context
    if (/^help$/i.test(lowerMessage)) {
      return { intent: "settings", confidence: 0.9, reasoning: "Help in Settings context" };
    }
    
    // Check for explicit ADO query - this should switch to ADO
    const hasAdoReference = /\b(ado|azure\s*devops?)\b/i.test(lowerMessage);
    if (hasAdoReference && /\b(list|show|get|fetch|what|which)\b.*\b(work\s*items?|stories|epics?|pipelines?)/i.test(lowerMessage)) {
      console.log(`[Classifier] Explicit ADO query during Settings flow - switching to ADO Agent`);
      return { intent: "ado", confidence: 0.95, reasoning: "ADO query - switching from Settings to ADO Agent" };
    }
    
    // Check for platform/help questions - redirect to general for DevX QnA
    const platformHelpPatterns = [
      /\b(what\s+is|how\s+do(es)?|tell\s+me\s+about)\s+(astra|the\s+platform|settings)/i,
      /\b(help|guide|how\s+to)\b/i,
      /\b(what\s+can\s+i|capabilities|features)\b/i
    ];
    
    for (const pattern of platformHelpPatterns) {
      if (pattern.test(lowerMessage)) {
        console.log(`[Classifier] Platform help question during Settings flow - switching to General Agent`);
        return { intent: "general", confidence: 0.9, reasoning: "Platform help question - switching from Settings to General Agent" };
      }
    }
    
    // Check for golden repo request - this should switch
    if (GOLDEN_REPO_INTENT_PATTERN.test(lowerMessage)) {
      console.log(`[Classifier] Golden repo request during Settings flow - switching to Golden Repo Agent`);
      return { intent: "goldenRepo", confidence: 0.95, reasoning: "Golden repo request - switching from Settings to Golden Repo Agent" };
    }
  }
  
  // Only check for intent switches when NOT in an active multi-step flow
  if (/\bgolden\s*(repo|repos|repositories|template)/i.test(lowerMessage)) {
    return { intent: "goldenRepo", confidence: 0.95, reasoning: "Explicit golden repo/template reference" };
  }
  
  if (/\b(show|list|view|display)\s*(the\s*)?template/i.test(lowerMessage)) {
    return { intent: "goldenRepo", confidence: 0.9, reasoning: "Template viewing request" };
  }
  
  if (/\bexplore\s+modernization\b/i.test(lowerMessage)) {
    return {
      intent: "modernization",
      confidence: 0.99,
      reasoning: "Explore Modernization quick action",
    };
  }

  const adoQueryPatterns = [
    /\b(what|which|show|list|tell|get|display)\s*(me\s*)?(the\s*)?(user\s*)?stor(y|ies)\s*(are|in|from|present)/i,
    /\b(what|which|show|list|tell|get|display)\s*(me\s*)?(the\s*)?epics?\b/i,
    /\b(what|which|show|list|tell|get|display)\s*(me\s*)?(the\s*)?(all\s*)?(open|closed|active|my)?\s*work\s*items?\b/i,
    /\b(what|show|list)\s*(is|are)\s*(in|present|there)\s*(the\s*)?(ado|azure|project)/i,
    /\b(what|show|list)\s*(pull\s*request|pr|pipeline|build)/i,
    /\bstories\s*(in|from|present)\s*(the\s*)?(ado|azure|project)/i,
    /\b(what|which)\s*(stories|epics|tasks|items)\s*(do\s*we|are\s*there)/i,
    /\b(open|closed|active|my)\s*work\s*items?\b/i,
    // Pattern for "Query ADO data" quick reply button
    /\b(query)\s*(the\s*)?(ado|azure\s*devops?)\s*(data)?\b/i,
    /\b(query)\s*(the\s*)?jira\s*(data)?\b/i,
  ];
  
  for (const pattern of adoQueryPatterns) {
    if (pattern.test(lowerMessage)) {
      const isJiraPattern = /\b(query)\s*(the\s*)?jira\s*(data)?\b/i.test(lowerMessage);
      if (isJiraPattern) {
        return { intent: "jira", confidence: 0.98, reasoning: "Query Jira data quick action" };
      }
      return { intent: "ado", confidence: 0.95, reasoning: "ADO data query detected" };
    }
  }
  
  // ADO context checks are now at the beginning of this function
  
  if (activeAgent === "settings") {
    if (GOLDEN_REPO_INTENT_PATTERN.test(lowerMessage)) {
      return {
        intent: "goldenRepo",
        confidence: 0.96,
        reasoning: "Golden repo request in settings context",
      };
    }
    if (/\b(view|show|list|get)\s*(the\s*)?(ado\s*)?(repo|repos|repositories)\b/i.test(lowerMessage)) {
      return { intent: "settings", confidence: 0.95, reasoning: "Repository request in settings context -> ADO repos" };
    }
    
    if (/\b(view|show|list|get)\s*(the\s*)?project/i.test(lowerMessage)) {
      return { intent: "settings", confidence: 0.95, reasoning: "Project request in settings context" };
    }
  }
  
  return null;
}

function fallbackClassification(message: string, activeAgent?: string): ClassificationResult {
  const lowerMessage = message.toLowerCase().trim();

  if (GOLDEN_REPO_INTENT_PATTERN.test(lowerMessage)) {
    return {
      intent: "goldenRepo",
      confidence: 0.95,
      reasoning: "Golden repo / template (fallback classifier)",
    };
  }

  if (isExplicitJiraQuery(lowerMessage)) {
    return {
      intent: "jira",
      confidence: 0.9,
      reasoning: "Jira / Atlassian signal (fallback classifier)",
    };
  }

  if (isExplicitModernizationQuery(lowerMessage)) {
    return {
      intent: "modernization",
      confidence: 0.93,
      reasoning: "Stack Modernization signal (fallback classifier)",
    };
  }
  
  // Removed storyPatterns - story agent is disabled
  
  const adoQueryPatterns = [
    { pattern: /\b(what|which|tell)\s*(me\s*)?(the\s*)?(user\s*)?stor(y|ies)\s*(are|in|from|present)/i, score: 0.95 },
    { pattern: /\b(show|list|view|display|get)\s*(me\s*)?(the\s*)?(existing\s*)?(user\s*)?stor(y|ies)/i, score: 0.9 },
    { pattern: /\b(what|which|show|list|tell)\s*(me\s*)?(the\s*)?epics?\b/i, score: 0.9 },
    { pattern: /\b(what|which|show|list)\s*(me\s*)?(the\s*)?(all\s*)?(open|closed|active|my)?\s*work\s*items?\b/i, score: 0.95 },
    { pattern: /\b(what|show|list)\s*(pull\s*request|pr|pipeline|build)/i, score: 0.9 },
    { pattern: /\bstories\s*(in|from|present)\s*(the\s*)?(ado|azure|project)/i, score: 0.9 },
    { pattern: /\b(what|which)\s*(stories|epics|tasks|items)\s*(do\s*we|are\s*there)/i, score: 0.9 },
    { pattern: /\bin\s*(the\s*)?(ado|azure\s*devops)/i, score: 0.85 },
    { pattern: /\b(open|closed|active|my)\s*work\s*items?\b/i, score: 0.95 },
    // Pattern for "Query ADO data" quick reply button
    { pattern: /\b(query)\s*(the\s*)?(ado|azure\s*devops?)\s*(data)?\b/i, score: 0.95 },
    { pattern: /\b(query)\s*(the\s*)?jira\s*(data)?\b/i, score: 0.98 },
  ];
  
  const repoPatterns = [
    { pattern: /\bgolden\s*(repo|repos|repositories|template)\b/i, score: 0.95 },
    { pattern: /\b(show|list|view)\s*(the\s*)?template/i, score: 0.85 },
    { pattern: /\buse\s*(this\s*)?(golden\s*)?(repo|template)\b/i, score: 0.85 },
  ];
  
  const settingsPatterns = [
    { pattern: /\b(configure|config|setup|set\s*up)\s*(ado|azure|devops|settings)\b/i, score: 0.9 },
    { pattern: /\bsettings?\b/i, score: 0.7 },
    { pattern: /\b(change|update|modify)\s*(my\s*)?(organization|pat|token)\b/i, score: 0.85 },
    { pattern: /\bpat\s*token\b/i, score: 0.8 },
  ];
  
  const checkPatterns = (patterns: Array<{ pattern: RegExp; score: number }>) => {
    for (const { pattern, score } of patterns) {
      if (pattern.test(lowerMessage)) {
        return score;
      }
    }
    return 0;
  };
  
  const storyScore = 0; // Story agent disabled
  const adoQueryScore = checkPatterns(adoQueryPatterns);
  const repoScore = checkPatterns(repoPatterns);
  const settingsScore = checkPatterns(settingsPatterns);
  
  const maxScore = Math.max(storyScore, adoQueryScore, repoScore, settingsScore);
  
  if (maxScore === 0) {
    return { intent: "general", confidence: 0.5, reasoning: "No specific intent detected" };
  }
  
  if (adoQueryScore === maxScore && adoQueryScore >= 0.7) {
    return { intent: "ado", confidence: adoQueryScore, reasoning: "Matched ADO query patterns" };
  }
  
  if (repoScore === maxScore && repoScore >= 0.7) {
    return { intent: "goldenRepo", confidence: repoScore, reasoning: "Matched golden repo patterns" };
  }
  
  // Story patterns would redirect to general instead (story agent disabled)
  
  if (settingsScore === maxScore && settingsScore >= 0.7) {
    return { intent: "settings", confidence: settingsScore, reasoning: "Matched settings patterns" };
  }
  
  return { intent: "general", confidence: 0.5, reasoning: "Low confidence match - routing to general for DevX QnA" };
}
