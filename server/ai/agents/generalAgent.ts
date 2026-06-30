import type { Agent, AgentRequest, AgentResponse } from "../superAgent/types";
import { getOptionalSuperAgentLlmClient } from "../superAgent/optionalLlmClient";

const GENERAL_AGENT_SYSTEM_PROMPT = `You are Ask Astra, an intelligent AI assistant specialized for the Astra development platform. Your role is to be a knowledgeable QnA agent that helps users understand and navigate the Astra platform effectively.

## CRITICAL ROUTING AWARENESS:
You handle questions ABOUT the Astra platform, its features, and how to use it. However, you should RECOGNIZE when users want to ACCESS actual data and guide them appropriately:

### When Users Want Data Access (Route to ADO Agent):
If users ask to "list", "show", "view", "get", "count" work items, defects, bugs, stories, epics, etc., they want ACTUAL data from their Azure DevOps projects **and they do not mention Jira**. In these cases:
- Acknowledge their request warmly  
- Explain that Astra can definitely do this via the ADO integration
- Suggest they use the "Query ADO data" option to access their actual project data
- Provide quick replies to route them to the ADO agent

### When Users Want Jira (Route to Jira Agent):
If users mention **Jira**, **Atlassian**, **JQL**, Jira issues/tickets/epics/backlog, or **what / how Jira integration works in Astra**, the **Jira Agent** should handle it (explainers and live data). In these cases:
- Acknowledge warmly and point them to **"Query Jira data"** so the Jira Agent answers (including **what is Jira integration**)
- Do not confuse this with Azure DevOps unless they explicitly mention ADO

### When Users Want Stack Modernization (Route to Modernization Agent):
If users ask about **Stack Modernization**, **Tech Stack Upgrade**, **repository upgrade analysis**, **dependency graph for upgrades**, **version intelligence**, **code upgrade** workflows, or **Explore Modernization**, the **Modernization Agent** should handle it. Point them to **"Explore Modernization"** or ask them to phrase questions about the modernization module so that agent can answer with the full pipeline (assessment → planning → tasks → code upgrade → tests → publish).

### When Users Want Platform Information (Your expertise):
Answer detailed questions about Astra features, navigation, capabilities, and how to use the platform.

## Your Core Behaviors:

### 1. ANALYZE & UNDERSTAND
- Carefully analyze what the user is trying to accomplish with the Astra platform
- Look for context clues in their questions to understand their true intent
- If they want data access, guide them to the ADO agent
- If they want platform info, provide detailed guidance

### 2. BE CONVERSATIONAL & ENGAGING
- Respond like a knowledgeable platform expert, not a robot
- Use natural language with appropriate enthusiasm
- Show genuine interest in helping them succeed with Astra
- Celebrate their progress and acknowledge their efforts

### 3. ASK CLARIFYING QUESTIONS (When Needed)
- If the user's question about Astra is vague, ask ONE focused clarifying question
- Frame questions in a way that helps them think through what they need
- Offer suggestions WITH your question to guide them
- Example: "I'd love to help! Are you looking to understand a specific Astra feature, or explore what's available in your Azure DevOps integration?"

### 4. PROACTIVELY SUGGEST
- Don't wait to be asked - anticipate what they might need next about Astra
- Offer helpful tips and best practices for using the platform
- Connect related Astra features they might not know about
- When appropriate, suggest using other Astra agents (ADO, Golden Repos, Settings)

### 5. GUIDE INTELLIGENTLY
- If they seem lost with Astra, gently guide them with options
- Break down complex Astra workflows into simple steps
- Provide context for why you're suggesting something

## Astra Platform Structure & Features:

### MAIN NAVIGATION:
1. **Overview Tab** - Dashboard with real-time insights including:
   - Quick Actions (Create Organization, Create Project, Recent Activity)
   - Key Metrics (Organizations count, Projects count, Golden Repositories count)
   - Work Items Summary and charts
   - Recent Projects and Organizations lists

2. **Organizations** - Manage Azure DevOps organizations:
   - Connect to Azure DevOps with PAT tokens
   - View organization details and projects
   - Configure organization settings and permissions

3. **Projects** - Project management and exploration:
   - Browse all configured projects
   - View project details and work items
   - Create new projects within organizations
   - Access project-specific Azure DevOps data

### HUB SECTION (Content Management):
1. **Hub > Artifacts** - Agile artifact management:
   - View and manage Epics, Features, User Stories
   - Filter by type, status, priority
   - Create and edit work items
   - Push artifacts to Azure DevOps
   - Generate acceptance criteria and tests

2. **Hub > Persona Manager** - User persona management:
   - Create and manage user personas for stories
   - Define persona characteristics and goals
   - Use personas in story generation workflows

3. **Hub > Prompt Library** - AI prompt management:
   - Store and organize AI prompts for various workflows
   - Use prompts for artifact generation
   - Customize prompts for specific project needs

### TOOLS SECTION:
1. **Golden Repos** - Template repository browser:
   - Browse curated template repositories from Azure DevOps
   - Search and filter by technology domain
   - Fork repositories to your organizations
   - Quick project setup using proven templates

2. **SDLC** - Full Software Development Lifecycle management:
   - Complete project phases (Requirements, Design, Development, Testing, Deployment, Monitoring)
   - Azure DevOps integration for work items, pipelines, repositories
   - Project configuration and team management
   - Progress tracking and status monitoring

3. **Ask Astra** - Intelligent assistant (you!):
   - Platform guidance and feature explanations
   - Help with workflows and best practices
   - Answer questions about Astra capabilities

### SETTINGS:
- Azure DevOps configuration (organizations, PAT tokens)
- Platform preferences and customization
- Integration settings and API configurations

## When users ask about specific tabs/sections, provide ACCURATE details about what those sections actually contain, not generic assumptions. Use the structure above to give precise information.

## Response Style:
- Start with acknowledgment of what they want (shows you understood)
- Be concise but warm - not robotic or overly formal
- Use formatting (bold, bullets) to make responses scannable
- End with a clear next step or question
- Always provide 4-6 contextually relevant quick replies

## Example Interaction:
User: "What can Astra do?"
Response: "Great question! Astra is a comprehensive development platform that streamlines your workflow in several key ways:

**Golden Repositories** - Browse curated template repositories to quickly start new projects with best practices built-in

**Azure DevOps Integration** - Seamlessly query your work items, view pipelines, explore repositories, and check pull requests

**Smart Settings** - Easily configure organizations, projects, and connections to keep everything organized

**Intelligent Assistance** - Get contextual help and guidance as you work

What specific aspect would you like to explore first?"

Always end with quick reply suggestions in format: [QUICK_REPLIES: ["opt1", "opt2", "opt3"]]`;

// Function to detect if user wants data access (should use ADO agent)
function detectDataAccessRequest(message: string): AgentResponse | null {
  const lowerMessage = message.toLowerCase();

  if (/\b(jira|atlassian|jql)\b/i.test(lowerMessage)) {
    return null;
  }
  
  // Patterns indicating user wants to see actual data
  const dataAccessPatterns = [
    // Work item queries with state filters
    /\b(list|show|get|find|view|display|count|how\s*many)\s+.*\b(open|closed|active|new|resolved|assigned|unassigned)\s+.*\b(defects?|bugs?|stories|epics?|tasks?|features?|work\s*items?)\b/i,
    /\b(open|closed|active|new|resolved|assigned|unassigned)\s+.*\b(defects?|bugs?|stories|epics?|tasks?|features?|work\s*items?)\b/i,
    
    // Direct work item type queries
    /\b(list|show|get|find|view|display|count|how\s*many)\s+.*\b(defects?|bugs?|stories|epics?|tasks?|features?|work\s*items?)\b/i,
    /\b(all|my|our|the)\s+.*\b(defects?|bugs?|stories|epics?|tasks?|features?|work\s*items?)\b/i,
    
    // "What" queries about existing data. Bare "are" intentionally excluded so
    // platform questions like "which features are most useful" are not treated
    // as work-item queries (real queries still match via open/closed/assigned).
    /\b(what|which)\s+.*\b(defects?|bugs?|stories|epics?|tasks?|features?|work\s*items?)\s+.*\b(do\s*we\s*have|exist|assigned|open|closed)\b/i,
    
    // Repository and pipeline queries
    /\b(list|show|get|view)\s+.*\b(repos?|repositories|pipelines?|builds?|pull\s*requests?)\b/i,
    /\b(my|our|project)\s+.*\b(repos?|repositories|pipelines?)\b/i
  ];
  
  for (const pattern of dataAccessPatterns) {
    if (pattern.test(lowerMessage)) {
      console.log(`[GeneralAgent] Data access request detected - suggesting ADO agent routing`);
      
      return {
        reply: `Perfect! I can see you want to view actual data from your Azure DevOps projects. Astra's **ADO integration** is exactly what you need for this!

**✅ Astra can absolutely help you with that** through our Azure DevOps integration. Here's how:

🔍 **Access Your Real Data**: Use the **Query ADO data** feature to fetch and display your actual work items, defects, bugs, stories, epics, and more from your connected Azure DevOps projects.

📊 **Smart Filtering**: Filter by status (open, closed, active), assignee, project, or any other criteria to get exactly what you're looking for.

⚡ **Real-time Results**: Get up-to-date information directly from your Azure DevOps projects.

**Ready to explore your data?** Click **"Query ADO data"** below to start accessing your Azure DevOps information, or I can help you understand how the ADO integration works first.`,
        usedAgent: "general",
        metadata: {
          quickReplies: [
            "Query ADO data",
            "How does ADO integration work?",
            "Show me my organizations",
            "What can I query in ADO?"
          ],
        },
      };
    }
  }
  
  return null;
}

// Function to handle specific DevX feature questions
function handleSpecificDevXQuestions(message: string): AgentResponse | null {
  const lowerMessage = message.toLowerCase();

  // Astra platform features overview (e.g. "Ask about Astra features",
  // "What can Astra do?"). This response intentionally includes the full SDLC
  // lifecycle so users see the SDLC module whenever they ask about Astra
  // features. NOTE: kept above the SDLC-specific handler below; it only
  // triggers when the user references "astra" features (not "SDLC features").
  const wantsAstraFeatures =
    (lowerMessage.includes("astra") &&
      (lowerMessage.includes("feature") ||
        lowerMessage.includes("capab") ||
        lowerMessage.includes("what can") ||
        lowerMessage.includes("what does") ||
        lowerMessage.includes("offer"))) ||
    lowerMessage.includes("ask about astra features");

  if (wantsAstraFeatures) {
    return {
      reply: `Absolutely! Here's a complete tour of what **Astra** can do for you across the entire development lifecycle:

**📊 Overview Dashboard** — Real-time insights at a glance: organizations, projects, golden repos, work item summaries, and recent activity.

**🏢 Organizations & Projects** — Connect your Azure DevOps organizations with PAT tokens, browse and manage all projects, and create new ones in one place.

**📦 Hub (Content Management)**
- **Artifacts** — Manage Epics, Features, and User Stories; generate acceptance criteria; push items to Azure DevOps
- **Persona Manager** — Define user personas to enrich story generation
- **Prompt Library** — Store and reuse AI prompts for artifact workflows

**🧰 Golden Repos** — Browse curated template repositories, search by tech domain, and fork them to kickstart projects with best practices built in.

**🔄 SDLC — Full Software Development Lifecycle** (the heart of Astra)
End-to-end management across every phase:
- **Requirements** — Business requirements gathering and BRD documentation
- **Design** — Design guidelines and UI/UX generation
- **Development** — Specs generation, story progress, developer assignments, and velocity tracking
- **Testing** — Test cases, BDD feature/step files, end-to-end scenarios, test plans, and QE capabilities
- **Build** — Build pipelines, test reports, package publishing, and build status metrics
- **Deployment** — Release pipelines, deployment status, rollout management, and tracking
- **Monitoring & Maintenance** — Pipeline health, monitoring, error tracking, alerts, and deployment trends

All SDLC phases are backed by live Azure DevOps integration with progress tracking across each stage.

**⚙️ Settings** — Configure Azure DevOps connections, manage PAT tokens, and customize platform preferences.

Want me to dive deeper into any of these — especially the **SDLC** lifecycle?`,
      usedAgent: "general",
      metadata: {
        quickReplies: [
          "How does SDLC work?",
          "Show me SDLC phases",
          "Explain Golden Repos",
          "What does the Hub do?",
          "How do I set up Organizations?",
        ],
      },
    };
  }

  // Overview/Dashboard specific questions
  if (lowerMessage.includes("overview") && (lowerMessage.includes("tab") || lowerMessage.includes("page") || lowerMessage.includes("dashboard"))) {
    return {
      reply: `The **Overview tab** is Astra's main dashboard that provides real-time insights into your development platform. Here's exactly what you'll find:

**Quick Actions Section:**
- Create Organization - Start a new Azure DevOps organization connection
- Create Project - Launch a new project within existing organizations  
- Recent Activity - View your recent project interactions

**Key Metrics Cards:**
- **Organizations** - Count of connected Azure DevOps organizations with direct link to manage them
- **Projects** - Total projects across all organizations with quick access
- **Golden Repositories** - Number of available template repositories

**Work Items Analytics:**
- Visual charts showing distribution of Issues, Epics, Requirements, Backlog items, Documents
- Project-wise breakdown of work item counts
- Phase progress tracking across projects

**Recent Items Lists:**
- Recent Projects with status and creation dates
- Recent Organizations with industry tags and status

The Overview tab is your central command center - giving you a complete snapshot of your Astra environment at a glance!`,
      usedAgent: "general",
      metadata: {
        quickReplies: [
          "What about Projects tab?",
          "Show me Hub features", 
          "How do I create an organization?",
          "Explain Golden Repos"
        ],
      },
    };
  }

  // Hub section questions
  if (lowerMessage.includes("hub") && (lowerMessage.includes("what") || lowerMessage.includes("features") || lowerMessage.includes("contains"))) {
    return {
      reply: `The **Hub section** is Astra's content management center with three powerful tools:

**Hub > Artifacts** - Your agile work item manager:
- Browse and manage Epics, Features, User Stories
- Advanced filtering by type, status, priority, assignee
- Create new work items with AI-powered generation
- Edit acceptance criteria and test cases
- Push artifacts directly to Azure DevOps
- Visual work item type indicators and status tracking

**Hub > Persona Manager** - User persona database:
- Create detailed user personas for your stories
- Define persona characteristics, goals, and pain points
- Use personas in automated story generation
- Maintain consistent user-centered design approach

**Hub > Prompt Library** - AI prompt repository:
- Store and organize custom AI prompts
- Use prompts for consistent artifact generation
- Customize prompts for your specific project needs
- Share prompts across team members

The Hub is where you manage all your project content and leverage AI to accelerate your development process!`,
      usedAgent: "general",
      metadata: {
        quickReplies: [
          "Tell me about Artifacts",
          "How do Personas work?",
          "What are Golden Repos?",
          "Show me SDLC features"
        ],
      },
    };
  }

  // SDLC specific questions
  if (lowerMessage.includes("sdlc") && (lowerMessage.includes("what") || lowerMessage.includes("features") || lowerMessage.includes("phases"))) {
    return {
      reply: `The **SDLC section** provides complete Software Development Lifecycle management with comprehensive Azure DevOps integration:

**Core SDLC Phases:**
- **Requirements** - Business requirements gathering and documentation
- **Design** - System design and architecture planning  
- **Development** - Code development with ADO repository integration
- **Testing** - Test planning, execution, and reporting
- **Deployment** - CI/CD pipeline management and releases
- **Monitoring** - Application monitoring and performance tracking

**Azure DevOps Integration:**
- Live work item synchronization (Stories, Epics, Features, Bugs)
- Repository browser and code exploration
- Build and release pipeline status monitoring
- Pull request tracking and code review workflows
- Developer assignments and velocity tracking

**Project Management:**
- Team member management and role assignments
- Progress tracking across all phases
- Status dashboards and health indicators
- Deployment trends and release management

**Advanced Features:**
- Pipeline health monitoring
- Error tracking and alerting
- Build status metrics and analytics
- Automated deployment workflows

SDLC is your complete project command center - from initial requirements to production monitoring!`,
      usedAgent: "general",
      metadata: {
        quickReplies: [
          "How do I configure SDLC?",
          "Explain Golden Repos",
          "What about Organizations?",
          "Show me Settings"
        ],
      },
    };
  }

  // Golden Repositories questions
  if ((lowerMessage.includes("golden") && lowerMessage.includes("repo")) || (lowerMessage.includes("template") && lowerMessage.includes("repo"))) {
    return {
      reply: `**Golden Repositories** is Astra's template repository browser that accelerates project setup:

**Core Features:**
- Browse curated template repositories from your Azure DevOps organizations
- Search and filter by technology domains (web, mobile, data, etc.)
- Preview repository contents before using
- One-click fork to your target organizations

**Repository Information:**
- Technology stack and framework details
- Repository size and last update information  
- Branch structure and main files preview
- Integration with Azure DevOps permissions

**Forking Capabilities:**
- Fork within same organization or cross-organization
- Customize repository name and description
- Include or exclude original permissions
- Specify target branch for forking

**Domain-Based Filtering:**
- Filter by technology domains for relevant templates
- Quick access to project type-specific templates
- Smart search across repository names and descriptions

**Best Practice Integration:**
- Templates include proven project structures
- Pre-configured CI/CD pipelines in many templates
- Industry-standard coding patterns and practices
- Ready-to-use development environments

Golden Repos saves hours of project setup time by providing battle-tested starting points for any technology stack!`,
      usedAgent: "general",
      metadata: {
        quickReplies: [
          "How do I fork a repository?",
          "What about Organizations setup?",
          "Show me Hub Artifacts",
          "Explain SDLC phases"
        ],
      },
    };
  }

  // Organizations/Projects questions
  if ((lowerMessage.includes("organization") || lowerMessage.includes("project")) && (lowerMessage.includes("tab") || lowerMessage.includes("page") || lowerMessage.includes("manage"))) {
    return {
      reply: `Astra provides dedicated sections for managing your Azure DevOps connections:

**Organizations Tab:**
- Connect to multiple Azure DevOps organizations using PAT tokens
- View organization details (name, URL, description, industry)
- Monitor organization status and health
- Configure organization-level settings and permissions
- Browse all projects within each organization

**Projects Tab:**
- Comprehensive view of all projects across organizations
- Project details including status, creation date, and team size
- Quick access to project-specific Azure DevOps data
- Create new projects within existing organizations
- Filter and search across all your projects

**Key Integration Features:**
- **PAT Token Management** - Secure authentication with Azure DevOps
- **Real-time Sync** - Live data from your ADO organizations
- **Permission Mapping** - Respect Azure DevOps security settings
- **Multi-Organization Support** - Manage multiple ADO instances seamlessly

**Project Creation Workflow:**
- Select target organization
- Choose from Golden Repository templates
- Configure project settings and team assignments
- Automatic Azure DevOps project provisioning

**Organization Setup:**
- Input Azure DevOps organization URL
- Provide Personal Access Token (PAT)
- Verify connectivity and permissions
- Begin exploring projects and repositories

This centralized management makes it easy to work across multiple organizations and projects from a single Astra interface!`,
      usedAgent: "general",
      metadata: {
        quickReplies: [
          "How do I add an organization?",
          "What about Settings?",
          "Show me Golden Repos",
          "Explain SDLC workflow"
        ],
      },
    };
  }

  // Settings questions
  if (lowerMessage.includes("setting") && (lowerMessage.includes("what") || lowerMessage.includes("configure") || lowerMessage.includes("manage"))) {
    return {
      reply: `The **Settings page** is your central configuration hub for the Astra platform:

**Azure DevOps Configuration:**
- **Organizations Management** - Add, edit, and remove Azure DevOps organizations
- **PAT Token Configuration** - Secure Personal Access Token management
- **Connection Testing** - Verify connectivity and permissions
- **API Version Settings** - Configure Azure DevOps REST API versions

**Golden Repository Settings:**
- Configure source organizations for template repositories
- Set up repository forking preferences
- Manage domain filtering and categorization
- Configure default fork settings

**Platform Preferences:**
- Theme and appearance customization
- Notification preferences and alerts
- Default values for project creation
- User interface personalization

**Integration Settings:**
- AI service configuration for artifact generation
- Webhook configurations for real-time updates
- Custom API endpoints and authentication
- Third-party tool integrations

**Security & Access:**
- Token expiration monitoring and alerts
- Permission verification and troubleshooting
- Audit logs and access tracking
- Secure credential storage

**Backup & Sync:**
- Data export and backup options
- Synchronization preferences with Azure DevOps
- Conflict resolution settings
- Data retention policies

Settings ensures your Astra platform is properly configured and secure for your development workflows!`,
      usedAgent: "general",
      metadata: {
        quickReplies: [
          "How do I configure Azure DevOps?",
          "What about PAT tokens?",
          "Show me Hub features",
          "Explain Organizations setup"
        ],
      },
    };
  }

  return null;
}

export const generalAgent: Agent = {
  name: "General Agent",
  description:
    "Handles general conversation, greetings, and fallback responses",

  async process(request: AgentRequest): Promise<AgentResponse> {
    const { message, context } = request;
    const lowerMessage = message.toLowerCase();

    // FIRST: Check if user wants data access (should use ADO agent)
    const dataAccessResponse = detectDataAccessRequest(message);
    if (dataAccessResponse) {
      return dataAccessResponse;
    }

    // SECOND: Check for specific DevX feature questions
    const specificResponse = handleSpecificDevXQuestions(message);
    if (specificResponse) {
      return specificResponse;
    }

    // Treat as a greeting ONLY when the message is essentially nothing but a
    // greeting. Two guards:
    //  1) It must START with a real greeting word (word boundary) — this stops
    //     substrings like "hi" inside "this"/"which" or "hey" inside "they"
    //     from hijacking real questions.
    //  2) After removing the greeting + common filler words, nothing actionable
    //     may remain — this stops short action/questions that merely begin with
    //     a greeting (e.g. "hey show my repos", "hi what is astra") from being
    //     swallowed by the canned greeting instead of being answered/routed.
    const trimmedMessage = message.trim();
    const GREETING_PREFIX =
      /^(hi|hiya|hey|hello|yo|greetings?|good\s+(morning|afternoon|evening))\b/i;
    const startsWithGreeting = GREETING_PREFIX.test(trimmedMessage);
    const greetingRemainder = trimmedMessage
      .replace(GREETING_PREFIX, "")
      .replace(/\b(there|astra|team|everyone|all|folks|guys|buddy|friend)\b/gi, "")
      .replace(/[^a-z0-9]/gi, "");
    const isGreeting = startsWithGreeting && greetingRemainder.length === 0;

    if (isGreeting) {
      return {
        reply:
          "Hey there! Great to see you. I'm Ask Astra, your intelligent assistant for the Astra platform.\n\n**What would you like to know about Astra today?** I can help you:\n- **Navigate** the platform (Overview, Hub, SDLC, Golden Repos)\n- **Configure** Azure DevOps organizations and projects\n- **Understand** specific features and their exact capabilities\n- **Optimize** your development workflows\n\nJust ask me about any Astra feature, and I'll give you detailed, accurate information!",
        usedAgent: "general",
        metadata: {
          quickReplies: [
            "What does Overview tab have?",
            "Explain Hub features",
            "Show me Golden Repos",
            "How does SDLC work?",
            "Help with setup",
          ],
        },
      };
    }

    // Only show the canned capabilities menu for a BARE help/capabilities
    // request. "help me design X", "help me optimize Y", etc. are real tasks
    // and must reach the LLM, so we anchor the help phrases instead of using a
    // loose includes("help") that matches the verb "help".
    const isHelpMenuRequest =
      /^(help|help me|i need (some )?help|can you help( me)?|please help( me)?)\s*\??$/i.test(
        trimmedMessage,
      ) || /\bwhat can you (do|help)\b/i.test(lowerMessage);

    if (isHelpMenuRequest) {
      return {
        reply: `I'm glad you asked! Here's how I can help you make the most of the Astra platform:

**Platform Navigation** (Know Your Way Around)
- Understand what each tab contains (Overview, Organizations, Projects, Hub, Tools)
- Learn about specific features and their exact capabilities
- Get detailed explanations of workflows and processes

**Azure DevOps Integration** (Connect & Explore)
- Configure organizations and PAT token authentication
- Browse work items, pipelines, and repositories from your ADO
- Understand how Astra syncs with your existing Azure DevOps setup

**Project & Content Management** (Create & Organize)
- Use Golden Repository templates for quick project setup
- Manage artifacts (Epics, Features, User Stories) through the Hub
- Configure personas and prompt libraries for AI-assisted development

**SDLC Workflow Guidance** (Complete Development Lifecycle)
- Navigate all SDLC phases from requirements to monitoring
- Understand deployment pipelines and testing workflows
- Track project progress and team assignments

**Best Practices & Tips** (Get the Most Value)
- Learn optimal workflows for your development process
- Understand when and how to use different Astra features
- Get guidance on platform configuration and setup

**What specific aspect of Astra would you like to explore?** I can give you detailed information about any feature, tab, or workflow!`,
        usedAgent: "general",
        metadata: {
          quickReplies: [
            "What does Overview tab have?",
            "Explain Hub features",
            "How do Golden Repos work?",
            "Show me SDLC phases",
            "Help with Organizations setup",
          ],
        },
      };
    }

    // Only a pure thank-you closer — not "thanks, now can you also ...".
    const isThanks =
      /^(thanks?|thank you|thank u|thx|ty|thanks a lot|thank you so much|much appreciated|appreciate it)[\s!.]*$/i.test(
        trimmedMessage,
      );
    if (isThanks) {
      return {
        reply: "You're very welcome! Happy I could help. Is there anything else about Astra you'd like to know? I'm here whenever you need guidance!",
        usedAgent: "general",
        metadata: {
          quickReplies: [
            "Ask about Astra features",
            "Explore ADO projects",
            "Browse templates",
            "That's all for now",
          ],
        },
      };
    }

    // Only a pure farewell — not "goodbye world is the title of my project".
    const isFarewell =
      /^(bye|goodbye|good bye|see ya|see you|cya|that'?s all|that is all|i'?m done|im done)[\s!.]*$/i.test(
        trimmedMessage,
      );
    if (isFarewell) {
      return {
        reply:
          "Great working with you! Come back anytime you have questions about Astra or need help with the platform. Have a productive day!",
        usedAgent: "general",
        metadata: {
          quickReplies: [
            "Actually, one more thing",
            "Ask about Astra",
            "Browse templates",
            "Thanks!",
          ],
        },
      };
    }

    try {
      let systemPrompt = GENERAL_AGENT_SYSTEM_PROMPT;
      const summary = context.summary?.trim();
      if (summary && summary.length > 0) {
        const summaryBlock = `
## CONVERSATION SUMMARY CONTEXT

Below is a concise summary of the previous conversation in this chat.
Use this as context. DO NOT ask for information that is already present here.
Continue the conversation using this context and only ask new questions to move forward.

Summary:
${summary}
`.trim();

        systemPrompt = `${summaryBlock}\n\n${GENERAL_AGENT_SYSTEM_PROMPT}`;
      }

      const messagesForLLM = [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ] as const;

      // Debug log: confirm the LLM is being called, without dumping the full
      // system prompt (which buries other logs). Length is enough to verify.
      console.log(
        `[GeneralAgent] Calling LLM → systemPromptChars=${systemPrompt.length} userMessage="${message}"`,
      );

      const openai = getOptionalSuperAgentLlmClient();
      if (!openai) {
        return {
          reply: "I can help you understand Astra features, SDLC workflows, project setup, Golden Repos, and connected work-item data. What would you like to explore?",
          usedAgent: "general",
          metadata: {
            quickReplies: [
              "What can Astra do?",
              "How does SDLC work?",
              "Explain Golden Repos",
              "Query Jira data",
            ],
          },
        };
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        temperature: 0.8,
        max_tokens: 500,
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
          "What does Overview tab have?",
          "Explain Hub features", 
          "How do Golden Repos work?",
          "Show me SDLC phases",
        ];
      }

      return {
        reply,
        usedAgent: "general",
        metadata: {
          quickReplies,
        },
      };
    } catch (error) {
      console.error("[GeneralAgent] AI error:", error);

      return {
        reply:
          "I'm here to help with Astra! You can ask me about any platform feature, tab, or workflow. For example, I can explain what the Overview tab contains, how Hub features work, or guide you through Golden Repository setup. What would you like to know?",
        usedAgent: "general",
        metadata: {
          quickReplies: [
            "What does Overview tab have?",
            "Explain Hub features",
            "How do Golden Repos work?", 
            "Show me SDLC phases",
          ],
        },
      };
    }
  },
};
