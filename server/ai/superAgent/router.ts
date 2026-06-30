import type { Agent, AgentIntent, AgentRequest, AgentResponse } from "./types";
// import { storyAgent } from "../agents/storyAgent"; // Disabled story agent
import { goldenRepoAgent } from "../agents/goldenRepoAgent";
import { settingsAgent } from "../agents/settingsAgent";
import { generalAgent } from "../agents/generalAgent";
import { adoAgent } from "../agents/adoAgent";
import { jiraAgent } from "../agents/jiraAgent";
import { modernizationAgent } from "../agents/modernizationAgent";
import { getSessionState, saveSessionState } from "./state";
import { getAllowedWorkItemPlatforms } from "../../platform/hosting";

/** Keep in sync with `ASK_DEVX_WELCOME_QUICK_REPLIES` in `client/src/hooks/use-hosting-config.ts`. */
const ASK_DEVX_WELCOME_QUICK_REPLIES: readonly string[] = [
  "Ask about Astra features",
  "Show golden repos",
  "Query ADO data",
  "Query Jira data",
  "Explore Modernization",
  "What can you do?",
];

const agents: Record<AgentIntent, Agent> = {
  // story: storyAgent, // Disabled story agent - routing disabled
  goldenRepo: goldenRepoAgent,
  settings: settingsAgent,
  general: generalAgent,
  ado: adoAgent,
  jira: jiraAgent,
  modernization: modernizationAgent,
};

export async function routeToAgent(
  intent: AgentIntent,
  request: AgentRequest
): Promise<AgentResponse> {
  const agent = agents[intent];
  
  if (!agent) {
    console.warn(`[Router] Unknown intent: ${intent}, falling back to general`);
    return agents.general.process(request);
  }

  console.log(`[Router] Routing to ${agent.name} agent`);
  
  // Update activeAgent in session state for context-aware classification
  const session = getSessionState(request.context.sessionId);
  session.activeAgent = intent;
  saveSessionState(request.context.sessionId, session);
  console.log(`[Router] Updated activeAgent to: ${intent}`);
  
  try {
    const response = await agent.process(request);
    
    if (!response.metadata.quickReplies || response.metadata.quickReplies.length === 0) {
      response.metadata.quickReplies = getDefaultQuickReplies(intent);
    }
    
    return response;
  } catch (error) {
    console.error(`[Router] Error in ${agent.name} agent:`, error);
    
    return {
      reply: `I encountered an issue while processing your request. Let me help you with something else. What would you like to do?`,
      usedAgent: "general",
      metadata: {
        quickReplies: getDefaultQuickReplies("general"),
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function getDefaultQuickReplies(intent: AgentIntent): string[] {
  const platforms = getAllowedWorkItemPlatforms();
  const adoAllowed = platforms.includes("ado");
  const jiraAllowed = platforms.includes("jira");

  switch (intent) {
    case "goldenRepo":
      return [
        "Show repository list",
        "View template details",
        "Use a different template",
        "Help"
      ];
    case "settings":
      return [
        "Show organizations",
        "Configure Azure DevOps",
        "List my projects",
        "Help"
      ];
    case "ado":
      return [
        "List open defects",
        "Show work items",
        "View repositories",
        "Check pipelines",
        "List epics",
        "Show closed bugs"
      ];
    case "jira": {
      const replies = [
        "List Jira issues",
        "Show Jira epics",
        "Jira project details",
        "Go to Settings",
      ];
      if (adoAllowed) replies.push("Query ADO data");
      if (jiraAllowed) replies.push("Query Jira data");
      replies.push("What can you do?");
      return replies;
    }
    case "modernization":
      return [
        "How do I start a tech stack upgrade?",
        "What phases does modernization use?",
        "Explore Modernization",
        ...(adoAllowed ? (["Query ADO data"] as const) : []),
        ...(jiraAllowed ? (["Query Jira data"] as const) : []),
        "What can you do?",
      ];
    case "general":
    default:
      return [...ASK_DEVX_WELCOME_QUICK_REPLIES];
  }
}
