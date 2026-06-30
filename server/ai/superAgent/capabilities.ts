/**
 * Agent Capability Registry
 * 
 * Defines what each agent can actually do.
 * Used by QuickReplyManager to validate suggestions through LLM.
 */

export interface AgentCapability {
  id: string;
  description: string;
  examplePhrases: string[];
}

export interface AgentCapabilitySet {
  agentName: string;
  description: string;
  capabilities: AgentCapability[];
}

/**
 * Complete capability registry for all agents
 */
export const AGENT_CAPABILITIES: Record<string, AgentCapabilitySet> = {
  story: {
    agentName: "Story Agent",
    description: "Creates user stories in Azure DevOps with all required fields",
    capabilities: [
      {
        id: "create_user_story",
        description: "Create a new user story in Azure DevOps",
        examplePhrases: ["Create a user story", "I want to create a story", "New user story", "Add a story"]
      },
      {
        id: "select_organization",
        description: "Select or switch Azure DevOps organization for story creation",
        examplePhrases: ["Use organization X", "Switch to org Y", "Select organization"]
      },
      {
        id: "select_project",
        description: "Select Azure DevOps project within chosen organization",
        examplePhrases: ["Use project X", "Select project Y", "Switch to project"]
      },
      {
        id: "generate_acceptance_criteria",
        description: "Generate AI-powered acceptance criteria for a user story",
        examplePhrases: ["Generate acceptance criteria", "Create acceptance criteria", "Add criteria"]
      },
      {
        id: "generate_test_cases",
        description: "Generate AI-powered test cases for a user story",
        examplePhrases: ["Generate test cases", "Create test cases", "Add tests"]
      },
      {
        id: "assign_story",
        description: "Assign user story to a team member",
        examplePhrases: ["Assign to someone", "Add assignee", "Who should work on this"]
      }
    ]
  },
  
  goldenRepo: {
    agentName: "Golden Repo Agent",
    description: "Provides access to golden repository templates across business domains",
    capabilities: [
      {
        id: "list_templates",
        description: "List available golden repository templates",
        examplePhrases: ["Show golden repos", "List templates", "What templates are available", "Show repositories"]
      },
      {
        id: "view_template",
        description: "View details of a specific template",
        examplePhrases: ["Show template details", "Tell me about template X", "View template"]
      },
      {
        id: "explore_domains",
        description: "Explore different business domains for templates",
        examplePhrases: ["Show domains", "What domains are available", "Healthcare templates", "Finance templates"]
      }
    ]
  },
  
  settings: {
    agentName: "Settings Agent",
    description: "Manages platform configuration and Azure DevOps settings",
    capabilities: [
      {
        id: "view_organizations",
        description: "View configured Azure DevOps organizations",
        examplePhrases: ["Show organizations", "List my orgs", "What organizations are configured"]
      },
      {
        id: "view_projects",
        description: "View projects within an organization",
        examplePhrases: ["Show projects", "List projects", "What projects are in this org"]
      },
      {
        id: "check_connection",
        description: "Check Azure DevOps connection status",
        examplePhrases: ["Check connection", "Is ADO connected", "Verify settings"]
      }
    ]
  },
  
  ado: {
    agentName: "ADO Agent",
    description: "Queries Azure DevOps data - work items, repos, pipelines, pull requests",
    capabilities: [
      {
        id: "query_work_items",
        description: "Query work items like user stories, epics, bugs, tasks",
        examplePhrases: ["Show user stories", "List epics", "View bugs", "What tasks are assigned to me"]
      },
      {
        id: "view_repositories",
        description: "List repositories in Azure DevOps",
        examplePhrases: ["Show repositories", "List repos", "View repos"]
      },
      {
        id: "check_pipelines",
        description: "View pipeline status and builds",
        examplePhrases: ["Check pipelines", "Show builds", "View pipeline status"]
      },
      {
        id: "view_pull_requests",
        description: "View pull requests",
        examplePhrases: ["Show pull requests", "List PRs", "View open PRs"]
      }
    ]
  },

  jira: {
    agentName: "Jira Agent",
    description: "Queries Atlassian Jira issues, epics, and backlog data for Jira-connected projects",
    capabilities: [
      {
        id: "query_jira_issues",
        description: "List or summarize Jira issues, tickets, bugs, and stories",
        examplePhrases: ["List Jira issues", "Show Jira bugs", "Query Jira data", "Fetch tickets from Jira"]
      },
      {
        id: "query_jira_epics",
        description: "Show epics or top-level Jira work",
        examplePhrases: ["Show Jira epics", "List epics in Jira"]
      },
      {
        id: "jira_project_context",
        description: "Explain Jira instance URL, project key, and integration status",
        examplePhrases: ["Jira project details", "Which Jira project is connected?"]
      }
    ]
  },

  modernization: {
    agentName: "Modernization Agent",
    description:
      "Explains Stack Modernization (tech stack upgrade): workflow phases, navigation, LLM selection, and publishing",
    capabilities: [
      {
        id: "modernization_overview",
        description: "Summarize what Stack Modernization does in Astra",
        examplePhrases: ["Explore Modernization", "What is stack modernization?", "How does tech stack upgrade work?"]
      },
      {
        id: "modernization_phases",
        description: "Describe assessment, planning, code upgrade, tests, and validation phases",
        examplePhrases: ["What phases does modernization use?", "Explain the upgrade pipeline", "What happens after assessment?"]
      },
      {
        id: "modernization_getting_started",
        description: "Guide user to routes and first steps to start an analysis",
        examplePhrases: ["How do I start a tech stack upgrade?", "Where is Stack Modernization?", "Upload repo for upgrade"]
      }
    ]
  },
  
  general: {
    agentName: "General Agent",
    description: "Provides platform guidance and handles general queries",
    capabilities: [
      {
        id: "explain_platform",
        description: "Explain what the platform can do",
        examplePhrases: ["What can you do", "Help", "What features are available"]
      },
      {
        id: "route_to_agent",
        description: "Help user navigate to the right agent for their task",
        examplePhrases: ["I want to create something", "How do I manage settings", "Show me templates"]
      }
    ]
  }
};

/**
 * Generates a capability summary string for LLM validation
 */
export function getCapabilitySummary(): string {
  const lines: string[] = ["AGENT CAPABILITIES:"];
  
  for (const [agentKey, agentData] of Object.entries(AGENT_CAPABILITIES)) {
    lines.push(`\n${agentData.agentName} (${agentKey}):`);
    lines.push(`  Description: ${agentData.description}`);
    lines.push("  Can do:");
    for (const cap of agentData.capabilities) {
      lines.push(`    - ${cap.description}`);
    }
  }
  
  lines.push("\nIMPORTANT LIMITATIONS:");
  lines.push("- NO agent can create projects in Azure DevOps");
  lines.push("- NO agent can create organizations in Azure DevOps");
  lines.push("- NO agent can manage Azure DevOps permissions or team settings");
  lines.push("- NO agent can delete or modify existing work items (only create new ones)");
  lines.push("- NO agent can manage PAT tokens (user must configure in settings UI)");
  
  return lines.join("\n");
}

/**
 * List of banned generic quick replies that should never appear
 * Note: "yes" and "no" are NOT banned here - they're valid flow responses for Y/N questions
 * Note: "done" is NOT banned - it's a valid flow response for multi-input steps
 */
export const BANNED_QUICK_REPLIES = [
  "skip",
  "help",
  "cancel",
  "back",
  "next",
  "continue",
  "ok",
  "maybe",
  "never mind",
  "none",
  "nothing",
  "i don't know",
  "skip for now"
];

/**
 * Flow-specific quick replies that should NEVER be banned
 * These are valid responses within specific conversation flows
 */
const ALLOWED_FLOW_REPLIES = [
  "yes",
  "no",
  "done",
  "accept",
  "reject",
  "edit",
  "add more",
  "start over",
  "leave unassigned",
  "high",
  "medium", 
  "low"
];

/**
 * Checks if a quick reply is a banned generic response
 * Flow-specific replies like "Yes", "No", "Accept", "Done" are explicitly allowed
 */
export function isBannedGenericReply(reply: string): boolean {
  const normalized = reply.toLowerCase().trim();
  
  // First check if it's an allowed flow reply
  if (ALLOWED_FLOW_REPLIES.includes(normalized)) {
    return false; // Explicitly allow these
  }
  
  // Check for contextual phrases that start with allowed flow words
  // e.g., "Yes - generate", "No - leave unassigned", "Accept", "Done with test cases"
  const allowedPrefixes = ["yes", "no", "done", "accept", "reject", "edit", "add", "leave", "start"];
  const firstWord = normalized.split(/\s+/)[0];
  if (allowedPrefixes.includes(firstWord)) {
    return false; // Allow contextual responses starting with these words
  }
  
  // Only ban exact matches of generic words
  if (BANNED_QUICK_REPLIES.includes(normalized)) {
    return true;
  }
  
  // For short phrases (2 words or less), check if first word is banned
  const words = normalized.split(/\s+/);
  if (words.length <= 2) {
    return BANNED_QUICK_REPLIES.includes(words[0]);
  }
  
  // For longer phrases with contextual meaning, allow them
  return false;
}
