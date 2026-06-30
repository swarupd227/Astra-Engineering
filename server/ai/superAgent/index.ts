import { classifyIntent } from "./classifier";
import { routeToAgent } from "./router";
import { resetState, clearFullSessionState } from "./state";
import type {
  AgentRequest,
  AgentResponse,
  ConversationContext,
  ChatMessage,
  AgentIntent,
} from "./types";

export * from "./types";

export class SuperAgent {
  private context: ConversationContext;

  constructor(sessionId: string) {
    this.context = {
      sessionId,
      conversationHistory: [],
      conversationId: undefined,   // ⬅ added
      summary: undefined,           // ⬅ added
    };
  }

  /* ⬇ UPDATED SIGNATURE — now accepts message + summary + conversationId */
  async chat(input: {
    message: string;
    conversationId?: string;
    summary?: string;
  }): Promise<AgentResponse> {
    const { message, conversationId, summary } = input;

    // ⬇ store summary + conversationId into context
    if (conversationId) {
      this.context.conversationId = conversationId;
    }
    if (typeof summary === "string") {
      this.context.summary = summary;
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: message,
      timestamp: new Date(),
    };
    this.context.conversationHistory.push(userMessage);

    console.log(
      `[SuperAgent] Processing message: "${message.substring(0, 100)}..."`
    );
    if (this.context.summary) {
      console.log(
        "[SuperAgent] Summary present in context (chars):",
        this.context.summary.length
      );
    }

    // Story agent is disabled; routing follows classifier only (see router.ts).
    const classification = await classifyIntent(message, this.context);
    console.log(
      `[SuperAgent] Classified intent: ${classification.intent} (confidence: ${classification.confidence})`
    );
    const intent: AgentIntent = classification.intent;

    const request: AgentRequest = {
      message,
      context: this.context,
    };

    const response = await routeToAgent(intent, request);

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: response.reply,
      timestamp: new Date(),
      agentUsed: response.usedAgent,
      metadata: response.metadata,
    };
    this.context.conversationHistory.push(assistantMessage);

    this.updateContextFromResponse(response);

    return response;
  }

  private updateContextFromResponse(response: AgentResponse): void {
    const { metadata } = response;

    if (metadata.organizations && metadata.organizations.length > 0) {
      if (
        !this.context.selectedOrganization &&
        metadata.organizations.length === 1
      ) {
        this.context.selectedOrganization = metadata.organizations[0];
      }
    }

    // Persist selected repository from Golden Repo agent
    if (metadata.selectedRepository) {
      this.context.selectedRepository = metadata.selectedRepository;
      console.log(`[SuperAgent] Selected repository updated: ${metadata.selectedRepository.name}`);
    }

    if (metadata.generatedStory) {
      this.context.storyDetails = {
        title: metadata.generatedStory.title,
        description: metadata.generatedStory.description,
        acceptanceCriteria: metadata.generatedStory.acceptanceCriteria,
        priority: metadata.generatedStory.priority,
        storyPoints: metadata.generatedStory.storyPoints,
        assignee: metadata.generatedStory.assignee,
      };
    }
  }

  getContext(): ConversationContext {
    return this.context;
  }

  updateContext(updates: Partial<ConversationContext>): void {
    this.context = { ...this.context, ...updates };
  }

  setSelectedOrganization(org: ConversationContext["selectedOrganization"]): void {
    this.context.selectedOrganization = org;
  }

  setSelectedProject(project: ConversationContext["selectedProject"]): void {
    this.context.selectedProject = project;
  }

  setSelectedRepository(repo: ConversationContext["selectedRepository"]): void {
    this.context.selectedRepository = repo;
  }

  resetContext(): void {
    resetState(this.context.sessionId, this.context.sessionId);
    this.context = {
      sessionId: this.context.sessionId,
      conversationHistory: [],
      conversationId: undefined,   // ⬅ keep new fields
      summary: undefined,           // ⬅ keep new fields
    };
  }

  getConversationHistory(): ChatMessage[] {
    return this.context.conversationHistory;
  }
}

const activeSessions = new Map<string, SuperAgent>();

export function getOrCreateSuperAgent(sessionId: string): SuperAgent {
  if (!activeSessions.has(sessionId)) {
    activeSessions.set(sessionId, new SuperAgent(sessionId));
  }
  return activeSessions.get(sessionId)!;
}

export function removeSuperAgent(sessionId: string): void {
  // Clear the SuperAgent instance
  activeSessions.delete(sessionId);
  
  // Also clear all session state (activeAgent, story state, settings state, etc.)
  clearFullSessionState(sessionId);
  
  console.log(`[SuperAgent] Session removed and state cleared: ${sessionId}`);
}
