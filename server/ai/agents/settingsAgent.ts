import type {
  Agent,
  AgentRequest,
  AgentResponse,
  Organization,
  Project,
} from "../superAgent/types";
import { storage } from "../../storage";
import { safeDecryptPAT } from "../../crypto-utils";
import { getAllowedWorkItemPlatforms } from "../../platform/hosting";

/** Append Query ADO data → Query Jira data (when allowed) for parity with other agents. */
function withQueryDataChips(replies: string[]): string[] {
  const p = getAllowedWorkItemPlatforms();
  const out = [...replies];
  if (p.includes("ado") && !out.includes("Query ADO data")) {
    out.push("Query ADO data");
  }
  if (p.includes("jira") && !out.includes("Query Jira data")) {
    out.push("Query Jira data");
  }
  return out;
}

/**
 * Extract organization name from Azure DevOps URL
 * e.g., "https://dev.azure.com/NareshTestOrg/" -> "NareshTestOrg"
 */
function extractOrgNameFromUrl(organizationUrl: string): string {
  try {
    const match = organizationUrl.match(/https:\/\/dev\.azure\.com\/([^\/]+)/);
    return match?.[1] || organizationUrl;
  } catch (error) {
    return organizationUrl;
  }
}

const SETTINGS_AGENT_DESCRIPTION = `You are an intelligent, friendly Settings Agent - helping users manage their Azure DevOps configurations with ease. Think of yourself as a helpful IT support colleague who makes complex configurations feel simple.

## Your Core Behaviors:

### 1. BE PROACTIVE & HELPFUL
- Anticipate what users might need to configure
- Explain WHY settings matter, not just how to change them
- Offer suggestions based on common use cases
- Connect settings to other platform features

### 2. GUIDE INTELLIGENTLY
- If something isn't configured, explain what they're missing
- Offer to help them set things up step by step
- Provide context about what each setting does

### 3. ASK CLARIFYING QUESTIONS
- If the user's request is vague, help them narrow it down
- Offer options: "Are you looking to view your current settings, or make changes?"

## Response Style:
- Be warm and helpful, not robotic
- Use simple language to explain technical concepts
- Always suggest relevant next steps`;

async function fetchOrganizations(): Promise<Organization[]> {
  try {
    const artifactOrgs = await storage.getArtifactOrganizations();
    return artifactOrgs.map((org) => ({
      id: String(org.id),
      name: extractOrgNameFromUrl(org.organizationUrl || ""),
      organizationUrl: org.organizationUrl || "",
      projectName: org.projectName || "",
      repositoryName: undefined,
      patConfigured: !!org.patToken,
    }));
  } catch (error) {
    console.error("[SettingsAgent] Error fetching organizations:", error);
    return [];
  }
}

async function fetchProjectsForOrg(org: Organization): Promise<Project[]> {
  try {
    const artifactOrgs = await storage.getArtifactOrganizations();
    const fullOrg = artifactOrgs.find((o) => {
      const orgNameFromUrl = extractOrgNameFromUrl(o.organizationUrl || "");
      return orgNameFromUrl === org.name;
    });

    if (!fullOrg?.patToken) {
      return [];
    }

    const pat = safeDecryptPAT(fullOrg.patToken);
    if (!pat) {
      return [];
    }

    const orgName = extractOrgNameFromUrl(org.organizationUrl);
    const authToken = Buffer.from(`:${pat}`).toString("base64");

    const response = await fetch(
      `https://dev.azure.com/${orgName}/_apis/projects?api-version=7.0`,
      {
        headers: {
          Authorization: `Basic ${authToken}`,
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return (data.value || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));
  } catch (error) {
    console.error("[SettingsAgent] Error fetching projects:", error);
    return [];
  }
}

function formatOrganizationList(orgs: Organization[]): string {
  if (orgs.length === 0) {
    return "No organizations configured. Please add one in Settings > Central Settings.";
  }

  return orgs
    .map(
      (org, index) =>
        `**${index + 1}. ${org.name}**\n   URL: ${
          org.organizationUrl
        }\n   PAT Configured: ${org.patConfigured ? "Yes" : "No"}`,
    )
    .join("\n\n");
}

/**
 * Prefix replies with conversation summary if available.
 * This makes Settings Agent aware of the ongoing conversation context.
 */
function applySummaryPrefix(
  baseReply: string,
  context: AgentRequest["context"],
): string {
  const summary = context.summary?.trim();
  if (!summary) {
    return baseReply;
  }

  return (
    `Here is a summary of your previous conversation for context:\n` +
    `${summary}\n\n` +
    baseReply
  );
}

export const settingsAgent: Agent = {
  name: "Settings Agent",
  description: SETTINGS_AGENT_DESCRIPTION,

  async process(request: AgentRequest): Promise<AgentResponse> {
    const { message, context } = request;
    const lowerMessage = message.toLowerCase();

    const organizations = await fetchOrganizations();

    if (lowerMessage.includes("organization") || lowerMessage.includes("org")) {
      const orgList = formatOrganizationList(organizations);
      
      let replyMessage = "";
      if (organizations.length === 0) {
        replyMessage = `I don't see any Azure DevOps organizations configured yet. Would you like me to help you set one up?\n\n**To add an organization, you'll need:**\n- Your Azure DevOps organization URL (e.g., https://dev.azure.com/your-org)\n- A Personal Access Token (PAT) with appropriate permissions\n\nYou can configure these in the Settings page, or I can guide you through the process!`;
      } else {
        replyMessage = `Great! Here are your configured Azure DevOps organizations:\n\n${orgList}\n\n**What would you like to do?** I can help you:\n- Select an organization to explore its projects\n- Add a new organization\n- Update PAT tokens or other settings`;
      }

      return {
        reply: applySummaryPrefix(replyMessage, context),
        usedAgent: "settings",
        metadata: {
          quickReplies: withQueryDataChips(
            organizations.length > 0
              ? [
                  ...organizations.slice(0, 4).map((o) => `Select: ${o.name}`),
                  "Add new organization",
                  "Configure PAT token",
                  "Create a story",
                  "Help",
                ]
              : [
                  "Go to Settings page",
                  "What's a PAT token?",
                  "Help me understand",
                  "Create a story first",
                ],
          ),
          organizations,
        },
      };
    }

    if (lowerMessage.includes("project") || lowerMessage.includes("projects")) {
      const org = context.selectedOrganization || organizations[0];

      if (!org) {
        return {
          reply: applySummaryPrefix(
            "Please select an organization first to view its projects.",
            context,
          ),
          usedAgent: "settings",
          metadata: {
            quickReplies: withQueryDataChips([
              "Show organizations",
              ...organizations.slice(0, 3).map((o) => `Select: ${o.name}`),
              "Help",
            ]),
            organizations,
          },
        };
      }

      const projects = await fetchProjectsForOrg(org);

      if (projects.length === 0) {
        return {
          reply: applySummaryPrefix(
            `No projects found for **${org.name}**. This could be due to PAT permissions or the organization being empty.`,
            context,
          ),
          usedAgent: "settings",
          metadata: {
            quickReplies: withQueryDataChips([
              "Show organizations",
              "Configure PAT token",
              "Create new project",
              "Help",
            ]),
            organizations: [org],
            projects: [],
          },
        };
      }

      const projectList = projects
        .map(
          (p, i) =>
            `**${i + 1}. ${p.name}**${
              p.description ? `\n   ${p.description}` : ""
            }`,
        )
        .join("\n\n");

      return {
        reply: applySummaryPrefix(
          `Here are the projects in **${org.name}**:\n\n${projectList}\n\nWhich project would you like to work with?`,
          context,
        ),
        usedAgent: "settings",
        metadata: {
          quickReplies: withQueryDataChips([
            ...projects.slice(0, 5).map((p) => `Project: ${p.name}`),
            "Create a story",
            "View repositories",
            "Help",
          ]),
          organizations: [org],
          projects,
        },
      };
    }

    if (lowerMessage.includes("select:") || lowerMessage.includes("use:")) {
      const selectedName = message.replace(/^(select:|use:)/i, "").trim();
      const matchedOrg = organizations.find(
        (o) => o.name.toLowerCase() === selectedName.toLowerCase(),
      );

      if (matchedOrg) {
        context.selectedOrganization = matchedOrg;

        return {
          reply: applySummaryPrefix(
            `I've selected **${matchedOrg.name}** as your active organization.\n\nURL: ${matchedOrg.organizationUrl}\nPAT Configured: ${
              matchedOrg.patConfigured ? "Yes" : "No"
            }\n\nWhat would you like to do next?`,
            context,
          ),
          usedAgent: "settings",
          metadata: {
            quickReplies: withQueryDataChips([
              "View projects",
              "View repositories",
              "Create a story",
              "Show organizations",
              "Help",
            ]),
            organizations: [matchedOrg],
          },
        };
      }
    }

    if (lowerMessage.includes("pat") || lowerMessage.includes("token")) {
      return {
        reply: applySummaryPrefix(
          "To configure your Azure DevOps Personal Access Token (PAT):\n\n1. Go to **Settings > Central Settings**\n2. Select your organization\n3. Enter your PAT token\n\nYour PAT should have permissions for:\n- Work Items (Read & Write)\n- Code (Read)\n- Build (Read)\n\nWould you like me to help with something else?",
          context,
        ),
        usedAgent: "settings",
        metadata: {
          quickReplies: withQueryDataChips([
            "Show organizations",
            "View projects",
            "Create a story",
            "Help",
          ]),
          organizations,
        },
      };
    }

    return {
      reply: applySummaryPrefix(
        `I can help you manage your Azure DevOps settings. Here's what I can do:\n\n- **Show Organizations**: View your configured ADO organizations\n- **View Projects**: List projects in an organization\n- **Configure PAT**: Set up your Personal Access Token\n\nWhat would you like to do?`,
        context,
      ),
      usedAgent: "settings",
      metadata: {
        quickReplies: withQueryDataChips([
          "Show organizations",
          "View projects",
          "Configure PAT token",
          "Create a story",
          "Help",
        ]),
        organizations,
      },
    };
  },
};
