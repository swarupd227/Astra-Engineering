import type {
  Agent,
  AgentRequest,
  AgentResponse,
  Repository,
} from "../superAgent/types";
import { storage } from "../../storage";
import { decryptPAT } from "../../crypto-utils";
import { getOptionalSuperAgentLlmClient } from "../superAgent/optionalLlmClient";

const GOLDEN_REPO_SYSTEM_PROMPT = `You are the Golden Repository Agent - you help users explore and learn about available repository templates. Your ONLY job is to provide INFORMATION about golden repositories.

## YOUR CAPABILITIES (what you CAN do):
1. List all available golden repository templates
2. Show details about specific repositories (technologies, domain, description)
3. Compare different repositories
4. Answer questions about repository features and technologies
5. Help users understand which repository might fit their needs

## YOUR LIMITATIONS (what you CANNOT do):
- You CANNOT create user stories (that's the Story Agent's job)
- You CANNOT "use" or deploy templates - you only provide information
- You CANNOT create work items in Azure DevOps
- You CANNOT fork or clone repositories

## QUICK REPLY RULES (CRITICAL):
Your quick replies MUST only suggest actions you can actually perform:
- Repository names (to show details)
- "Show all repositories"
- "Show more details"
- "Compare repositories"
- "What technologies are used?"
- "Help"

NEVER suggest these (they are outside your scope):
- "Use a template" / "Use [repo name]"
- "Create a story" / "Create story from this"
- Anything about creating, deploying, or using templates

## Response Style:
- Be informative and helpful
- Provide clear details about repositories
- Suggest exploring other repositories if helpful
- Keep quick replies within your actual capabilities

Always provide 3-5 relevant quick reply suggestions that are WITHIN your capabilities.`;

interface GoldenRepository {
  id: string;
  name: string;
  description: string;
  domain: string;
  technologies: string[];
  url?: string;
}

async function fetchGoldenRepositories(): Promise<GoldenRepository[]> {
  try {
    // Use ADO settings (same as the golden repos page)
    const settings = await storage.getAdoSettings();

    if (!settings?.organizationUrl || !settings?.projectName) {
      console.log(
        "[GoldenRepoAgent] No ADO settings configured, returning defaults",
      );
      return getDefaultGoldenRepos();
    }

    if (!settings.patToken) {
      console.log(
        "[GoldenRepoAgent] No PAT token in ADO settings, returning defaults",
      );
      return getDefaultGoldenRepos();
    }

    // Decrypt PAT from ADO settings (same as the working API)
    const pat = decryptPAT(settings.patToken);
    if (!pat) {
      console.log(
        "[GoldenRepoAgent] Failed to decrypt PAT, returning defaults",
      );
      return getDefaultGoldenRepos();
    }

    // Normalize organization URL
    let normalizedOrgUrl = settings.organizationUrl.trim();
    if (!normalizedOrgUrl.endsWith("/")) {
      normalizedOrgUrl += "/";
    }

    const authToken = Buffer.from(`:${pat}`).toString("base64");

    console.log(
      `[GoldenRepoAgent] Fetching repositories from: ${normalizedOrgUrl}, Project: ${settings.projectName}`,
    );

    const response = await fetch(
      `${normalizedOrgUrl}_apis/git/repositories?api-version=${settings.apiVersion || "7.0"}`,
      {
        headers: {
          Authorization: `Basic ${authToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      console.error(
        "[GoldenRepoAgent] Failed to fetch repos:",
        response.status,
      );
      return getDefaultGoldenRepos();
    }

    const data = await response.json();

    // Filter by project name (same as the golden repos page)
    const repositories = (data.value || []).filter(
      (repo: any) => repo.project?.name === settings.projectName,
    );

    console.log(
      `[GoldenRepoAgent] Found ${repositories.length} repositories for project ${settings.projectName}`,
    );

    return repositories.map((repo: any) => ({
      id: repo.id,
      name: repo.name,
      description: repo.description || `${repo.name} repository`,
      domain: detectDomain(repo.name),
      technologies: detectTechnologies(repo.name),
      url: repo.webUrl,
    }));
  } catch (error) {
    console.error("[GoldenRepoAgent] Error fetching golden repos:", error);
    return getDefaultGoldenRepos();
  }
}

function detectDomain(name: string): string {
  const lowerName = name.toLowerCase();
  if (
    lowerName.includes("web") ||
    lowerName.includes("react") ||
    lowerName.includes("angular")
  )
    return "Web Application";
  if (
    lowerName.includes("api") ||
    lowerName.includes("backend") ||
    lowerName.includes("service")
  )
    return "Backend Service";
  if (lowerName.includes("mobile") || lowerName.includes("app"))
    return "Mobile Application";
  if (lowerName.includes("data") || lowerName.includes("analytics"))
    return "Data & Analytics";
  if (lowerName.includes("devops") || lowerName.includes("infra"))
    return "DevOps";
  return "General";
}

function detectTechnologies(name: string): string[] {
  const techs: string[] = [];
  const lowerName = name.toLowerCase();

  if (lowerName.includes("react")) techs.push("React");
  if (lowerName.includes("angular")) techs.push("Angular");
  if (lowerName.includes("vue")) techs.push("Vue.js");
  if (lowerName.includes("node")) techs.push("Node.js");
  if (lowerName.includes("python")) techs.push("Python");
  if (lowerName.includes("dotnet") || lowerName.includes(".net"))
    techs.push(".NET");
  if (lowerName.includes("typescript") || lowerName.includes("ts"))
    techs.push("TypeScript");

  return techs.length > 0 ? techs : ["JavaScript"];
}

function getDefaultGoldenRepos(): GoldenRepository[] {
  return [
    {
      id: "1",
      name: "React-Enterprise-Template",
      description:
        "Production-ready React application with TypeScript, authentication, and state management",
      domain: "Web Application",
      technologies: ["React", "TypeScript", "Redux", "Jest"],
    },
    {
      id: "2",
      name: "Node-API-Starter",
      description:
        "RESTful API template with Express, authentication, and database integration",
      domain: "Backend Service",
      technologies: ["Node.js", "Express", "PostgreSQL", "JWT"],
    },
    {
      id: "3",
      name: "Python-ML-Pipeline",
      description:
        "Machine learning project template with data processing and model training",
      domain: "Data & Analytics",
      technologies: ["Python", "Pandas", "Scikit-learn", "Jupyter"],
    },
    {
      id: "4",
      name: "Azure-DevOps-Templates",
      description:
        "CI/CD pipeline templates for Azure DevOps with multi-stage deployments",
      domain: "DevOps",
      technologies: ["YAML", "Azure Pipelines", "Docker", "Kubernetes"],
    },
    {
      id: "5",
      name: "Mobile-React-Native",
      description:
        "Cross-platform mobile app template with navigation and common components",
      domain: "Mobile Application",
      technologies: ["React Native", "TypeScript", "Expo", "Redux"],
    },
  ];
}

function formatRepositoryList(repos: GoldenRepository[]): string {
  return repos
    .map(
      (repo, index) =>
        `**${index + 1}. ${repo.name}**\n   ${repo.description}\n   Technologies: ${repo.technologies.join(
          ", ",
        )}\n   Domain: ${repo.domain}`,
    )
    .join("\n\n");
}

// Check if message is a follow-up question about the current repository
function isFollowUpQuestion(message: string): boolean {
  const followUpPatterns = [
    /what\s+(technologies?|tech|stack)/i,
    /which\s+technologies?/i,
    /technologies?\s+(does|used|are)/i,
    /tell\s+me\s+more/i,
    /more\s+(details?|info|information)/i,
    /what\s+domain/i,
    /what\s+is\s+it\s+(for|about)/i,
    /describe\s+(it|this)/i,
  ];
  return followUpPatterns.some((pattern) => pattern.test(message));
}

export const goldenRepoAgent: Agent = {
  name: "Golden Repo Agent",
  description:
    "Returns curated golden repositories and provides recommendations",

  async process(request: AgentRequest): Promise<AgentResponse> {
    const { message, context } = request;
    const lowerMessage = message.toLowerCase();

    const repositories = await fetchGoldenRepositories();

    // Check if user is asking a follow-up question about currently selected repo
    const currentRepo = context.selectedRepository;
    if (currentRepo && isFollowUpQuestion(message)) {
      // Find full repo details (context may only have basic info)
      const fullRepo = repositories.find(
        (r) => r.id === currentRepo.id || r.name.toLowerCase() === currentRepo.name.toLowerCase()
      );

      if (fullRepo) {
        console.log(`[GoldenRepoAgent] Follow-up question about: ${fullRepo.name}`);
        
        // Answer the follow-up question using the selected repo context
        if (/technolog/i.test(message)) {
          return {
            reply: `**${fullRepo.name}** uses the following technologies:\n\n${fullRepo.technologies.map(t => `- ${t}`).join('\n')}\n\nWould you like to know more about this repository or explore others?`,
            usedAgent: "goldenRepo",
            metadata: {
              quickReplies: [
                "Show all repositories",
                "What domain is it for?",
                "Compare with other repos",
                "Help",
              ],
              selectedRepository: {
                id: fullRepo.id,
                name: fullRepo.name,
                description: fullRepo.description,
                url: fullRepo.url,
              },
              repositories: [fullRepo],
            },
          };
        }
        
        if (/domain/i.test(message)) {
          return {
            reply: `**${fullRepo.name}** is designed for the **${fullRepo.domain}** domain.\n\n${fullRepo.description}\n\nWould you like to know more?`,
            usedAgent: "goldenRepo",
            metadata: {
              quickReplies: [
                "Show all repositories",
                "What technologies does it use?",
                "Compare with other repos",
                "Help",
              ],
              selectedRepository: {
                id: fullRepo.id,
                name: fullRepo.name,
                description: fullRepo.description,
                url: fullRepo.url,
              },
              repositories: [fullRepo],
            },
          };
        }
        
        // Generic "tell me more" response
        return {
          reply: `**${fullRepo.name}**\n\n${fullRepo.description}\n\n**Domain:** ${fullRepo.domain}\n**Technologies:** ${fullRepo.technologies.join(", ")}\n\nWhat else would you like to know?`,
          usedAgent: "goldenRepo",
          metadata: {
            quickReplies: [
              "Show all repositories",
              "Compare with other repos",
              "Help",
            ],
            selectedRepository: {
              id: fullRepo.id,
              name: fullRepo.name,
              description: fullRepo.description,
              url: fullRepo.url,
            },
            repositories: [fullRepo],
          },
        };
      }
    }

    // Handle "show repos" or "list" commands
    if (
      lowerMessage.includes("list") ||
      lowerMessage.includes("show") ||
      lowerMessage.includes("repo")
    ) {
      const repoList = formatRepositoryList(repositories);

      return {
        reply: `Here are the available golden repository templates:\n\n${repoList}\n\nWhich repository would you like to learn more about?`,
        usedAgent: "goldenRepo",
        metadata: {
          quickReplies: [
            ...repositories.slice(0, 3).map((r) => r.name),
            "Compare repositories",
            "Help",
          ],
          repositories: repositories.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            url: r.url,
          })),
        },
      };
    }

    // Check if user selected a specific repository by name
    const selectedRepo = repositories.find((r) =>
      lowerMessage.includes(r.name.toLowerCase()),
    );

    if (selectedRepo) {
      console.log(`[GoldenRepoAgent] User selected repository: ${selectedRepo.name}`);
      return {
        reply: `**${selectedRepo.name}**\n\n${selectedRepo.description}\n\n**Domain:** ${selectedRepo.domain}\n**Technologies:** ${selectedRepo.technologies.join(
          ", ",
        )}\n\nWould you like to explore other repositories or learn more about this one?`,
        usedAgent: "goldenRepo",
        metadata: {
          quickReplies: [
            "Show all repositories",
            "What technologies does it use?",
            "Compare with other repos",
            "Help",
          ],
          // Persist the selected repository in metadata
          selectedRepository: {
            id: selectedRepo.id,
            name: selectedRepo.name,
            description: selectedRepo.description,
            url: selectedRepo.url,
          },
          repositories: [selectedRepo],
        },
      };
    }

    try {
      // Build system prompt with optional summary and selected repo context
      let systemPrompt = GOLDEN_REPO_SYSTEM_PROMPT;

      const summary = context.summary?.trim();
      if (summary && summary.length > 0) {
        const summaryBlock = `
## CONVERSATION SUMMARY CONTEXT

Below is a concise summary of the previous conversation in this chat.
Use this as context. Do NOT ask for information that is already present here.
Continue the conversation using this context and only ask new questions to move forward.

Summary:
${summary}
`.trim();

        systemPrompt = `${summaryBlock}\n\n${GOLDEN_REPO_SYSTEM_PROMPT}`;
      }

      // Build context about selected repository
      let selectedRepoContext = "";
      if (context.selectedRepository) {
        const fullRepo = repositories.find(
          (r) => r.id === context.selectedRepository!.id || 
                 r.name.toLowerCase() === context.selectedRepository!.name.toLowerCase()
        );
        if (fullRepo) {
          selectedRepoContext = `
## CURRENTLY SELECTED REPOSITORY
The user has already selected this repository - use it as context for follow-up questions:
- Name: ${fullRepo.name}
- Description: ${fullRepo.description}
- Domain: ${fullRepo.domain}
- Technologies: ${fullRepo.technologies.join(", ")}
${fullRepo.url ? `- URL: ${fullRepo.url}` : ""}

If the user asks about "this", "it", or asks follow-up questions, answer about THIS repository.
`;
        }
      }

      const userContent = `${selectedRepoContext}
Available Repositories:
${repositories.map((r) => `- ${r.name}: ${r.description} (Domain: ${detectDomain(r.name)}, Tech: ${detectTechnologies(r.name).join(", ")})`).join("\n")}

User Query: ${message}

Provide a helpful response. End with quick replies in format: [QUICK_REPLIES: ["opt1", "opt2"]]`;

      const messagesForLLM = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ] as const;

      // Debug log for inspection
      console.log("===== [GoldenRepoAgent] LLM messages payload =====");
      console.dir(messagesForLLM, { depth: null });
      console.log("==================================================");

      const openai = getOptionalSuperAgentLlmClient();
      if (!openai) {
        return {
          reply: `I can help you explore golden repositories. Here are the available templates:\n\n${formatRepositoryList(repositories)}\n\nWhich repository would you like to learn more about?`,
          usedAgent: "goldenRepo",
          metadata: {
            quickReplies: [
              "Show all repositories",
              ...repositories.slice(0, 3).map((repo) => repo.name),
              "Help",
            ].slice(0, 5),
            repositories: repositories.map((repo) => ({
              id: repo.id,
              name: repo.name,
              description: repo.description,
            })),
          },
        };
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.7,
        max_tokens: 800,
      });

      const content = response.choices[0]?.message?.content || "";
      const quickRepliesMatch = content.match(
        /\[QUICK_REPLIES:\s*(\[[\s\S]*?\])\]/,
      );
      let quickReplies: string[] = [];
      let reply = content;

      if (quickRepliesMatch) {
        try {
          quickReplies = JSON.parse(quickRepliesMatch[1]);
          reply = content.replace(quickRepliesMatch[0], "").trim();
        } catch {
          quickReplies = [];
        }
      }

      if (quickReplies.length === 0) {
        quickReplies = [
          "Show repository list",
          ...repositories.slice(0, 3).map((r) => r.name),
          "Help",
        ];
      }

      // Preserve selected repository in metadata if we had one
      const metadataWithRepo: any = {
        quickReplies,
        repositories: repositories.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
        })),
      };
      
      if (context.selectedRepository) {
        metadataWithRepo.selectedRepository = context.selectedRepository;
      }

      return {
        reply,
        usedAgent: "goldenRepo",
        metadata: metadataWithRepo,
      };
    } catch (error) {
      console.error("[GoldenRepoAgent] AI error:", error);

      return {
        reply:
          "I can help you find the right repository template. What type of project are you working on?",
        usedAgent: "goldenRepo",
        metadata: {
          quickReplies: [
            "Show repository list",
            "Web application",
            "Backend API",
            "Mobile app",
            "Data project",
            "Help",
          ],
          repositories: repositories.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
          })),
        },
      };
    }
  },
};
