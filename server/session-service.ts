import { db } from "./db";
import {
  aiSessions,
  sessionStates,
  aiUsageLogs,
  sessionCostSummaries,
  msalUsers,
  workflowSteps,
  workflowStep1Data,
  workflowStep2Data,
  workflowStep3Data,
  type InsertMsalUser,
  type InsertAiSession,
  type InsertSessionState,
  type InsertAiUsageLog,
  type InsertSessionCostSummary,
  type InsertWorkflowStep,
  type InsertWorkflowStep1Data,
  type InsertWorkflowStep2Data,
  type InsertWorkflowStep3Data,
  type AiSession,
  type SessionState,
  type MsalUser,
  type WorkflowStep,
  type WorkflowStep1Data,
  type WorkflowStep2Data,
  type WorkflowStep3Data,
} from "@shared/schema";
import { eq, and, desc, sql, sum, inArray, isNull } from "drizzle-orm";
import { ai } from "./ai-client";
import { randomUUID } from "crypto";

/**
 * Session Management Service
 * Handles auto-save, resume, cost tracking, and user isolation for AI sessions
 */

export interface UserIdentity {
  aadObjectId: string;
  userName: string;
  userEmail: string;
  displayName?: string;
  homeAccountId?: string;
  tenantId?: string;
  // Optional role for access control - 'admin' can see all sessions
  role?: "admin" | "user";
}

export interface SessionStateData {
  screen: string;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  cursorState?: {
    position?: number;
    selection?: { start: number; end: number };
    focusElement?: string;
  };
  [key: string]: any; // Allow additional state properties
}

export interface CreateSessionRequest {
  projectId: string;
  userIdentity: UserIdentity;
  initialState?: SessionStateData;
}

export interface AutoSaveSessionRequest {
  sessionId: string;
  userIdentity: UserIdentity;
  state: SessionStateData;
}

export interface AIUsageData {
  sessionId: string;
  callId: string;
  model: string;
  provider: "azure" | "anthropic" | "openai";
  inputTokens: number;
  outputTokens: number;
  /**
   * Optional explicit pricing in USD per 1K tokens.
   * If omitted or zero, the service will fall back to
   * built-in defaults based on model + provider.
   */
  inputPricePer1K?: number;
  outputPricePer1K?: number;
  requestMetadata?: {
    temperature?: number;
    maxTokens?: number;
    finishReason?: string;
    duration?: number;
  };
}

/**
 * Default pricing lookup based on public docs (approximate, per 1K tokens).
 *
 * GPT-4o (OpenAI, 2026):
 *   - $2.50 / 1M input  -> $0.0025 / 1K
 *   - $10.00 / 1M output -> $0.01 / 1K
 *
 * Claude Sonnet 4.5 (Anthropic, 2026):
 *   - $3.00 / 1M input  -> $0.003 / 1K
 *   - $15.00 / 1M output -> $0.015 / 1K
 */
function getDefaultPricingForModel(model: string, provider: "azure" | "anthropic" | "openai"): {
  inputPricePer1K: number;
  outputPricePer1K: number;
} {
  const normalizedModel = model.toLowerCase();

  // GPT-4o via Azure/OpenAI
  if (normalizedModel.includes("gpt-4o") && !normalizedModel.includes("mini")) {
    return {
      inputPricePer1K: 0.0025,
      outputPricePer1K: 0.01,
    };
  }

  // GPT-4o-mini (workflow multi-instance / chunking)
  if (normalizedModel.includes("gpt-4o-mini") || (normalizedModel.includes("gpt-4o") && normalizedModel.includes("mini"))) {
    return {
      inputPricePer1K: 0.00015,
      outputPricePer1K: 0.0006,
    };
  }

  // GPT-4.1 nano (workflow multi-instance – lowest cost tier)
  if (
    normalizedModel.includes("4.1") && normalizedModel.includes("nano") ||
    normalizedModel.includes("41") && normalizedModel.includes("nano")
  ) {
    return {
      inputPricePer1K: 0.0001,
      outputPricePer1K: 0.0004,
    };
  }

  // GPT-4.1 mini (workflow multi-instance – same ballpark as gpt-4o-mini)
  if (
    normalizedModel.includes("4.1") && normalizedModel.includes("mini") ||
    normalizedModel.includes("41") && normalizedModel.includes("mini")
  ) {
    return {
      inputPricePer1K: 0.00015,
      outputPricePer1K: 0.0006,
    };
  }

  // Other GPT-4.1 (e.g. 4.1 standard) – use mini-tier as default for workflow
  if (normalizedModel.includes("4.1") || normalizedModel.includes("41")) {
    return {
      inputPricePer1K: 0.00015,
      outputPricePer1K: 0.0006,
    };
  }

  // Claude Sonnet 4.5 via Anthropic (or proxied)
  if (
    normalizedModel.includes("sonnet-4.5") ||
    normalizedModel.includes("claude-sonnet-4.5") ||
    normalizedModel.includes("claude-4.5-sonnet")
  ) {
    return {
      inputPricePer1K: 0.003,
      outputPricePer1K: 0.015,
    };
  }

  // Sensible fallback (very conservative, near-zero)
  return {
    inputPricePer1K: 0.0,
    outputPricePer1K: 0.0,
  };
}

export class SessionService {
  /**
   * Get or create MSAL user in database
   */
  async getOrCreateMsalUser(identity: UserIdentity): Promise<MsalUser> {
    // Try to find existing user by AAD Object ID
    const existing = await db
      .select()
      .from(msalUsers)
      .where(eq(msalUsers.aadObjectId, identity.aadObjectId))
      .limit(1);

    if (existing[0]) {
      // Update user info if changed
      if (
        existing[0].userName !== identity.userName ||
        existing[0].userEmail !== identity.userEmail ||
        existing[0].displayName !== identity.displayName
      ) {
        await db
          .update(msalUsers)
          .set({
            userName: identity.userName,
            userEmail: identity.userEmail,
            displayName: identity.displayName || null,
            homeAccountId: identity.homeAccountId || null,
            tenantId: identity.tenantId || null,
            updatedAt: new Date(),
          })
          .where(eq(msalUsers.id, existing[0].id));
        return {
          ...existing[0],
          userName: identity.userName,
          userEmail: identity.userEmail,
          displayName: identity.displayName || null,
        };
      }
      return existing[0];
    }

    // Create new user
    const id = randomUUID();
    const newUser: InsertMsalUser = {
      id,
      aadObjectId: identity.aadObjectId,
      userName: identity.userName,
      userEmail: identity.userEmail,
      displayName: identity.displayName || null,
      homeAccountId: identity.homeAccountId || null,
      tenantId: identity.tenantId || null,
    };

    await db.insert(msalUsers).values(newUser);
    const created = await db
      .select()
      .from(msalUsers)
      .where(eq(msalUsers.id, id))
      .limit(1);

    if (!created[0]) {
      throw new Error("Failed to create MSAL user");
    }

    return created[0];
  }

  /**
   * Generate AI session title from what the user actually did: chat, BRD, or files.
   * Title is derived only from this content—no generic titles.
   */
  async generateSessionTitle(
    projectId: string,
    initialState?: SessionStateData
  ): Promise<string> {
    try {
      const inputs = initialState?.inputs as Record<string, unknown> | undefined;
      const state = initialState as Record<string, unknown> | undefined;

      // 0) Explicit user query for title (from frontend) – primary source so chat intent is never lost
      const userQueryForTitle = (state?.userQueryForTitle ?? inputs?.userQueryForTitle) as string | undefined;
      const userQuerySnippet =
        typeof userQueryForTitle === "string" && userQueryForTitle.trim()
          ? userQueryForTitle.trim().substring(0, 400).replace(/\s+/g, " ")
          : "";

      // 1) Chat: last N messages (user + assistant) for topic
      const conversationMessages = (state?.conversationMessages ?? inputs?.conversationMessages) as
        | Array<{ role?: string; content?: string }>
        | undefined;
      const chatSnippet = this.buildChatSnippet(conversationMessages);

      // 2) BRD: prefer content/descriptions for title (so we get "Payment flow" not "FR-013 – FR-016")
      const brdContentForTitle = (state?.brdContentForTitle ?? inputs?.brdContentForTitle) as string | undefined;
      const brdRequirementNames = (state?.brdRequirementNames ?? inputs?.brdRequirementNames) as
        | string[]
        | undefined;
      const brdLine =
        typeof brdContentForTitle === "string" && brdContentForTitle.trim()
          ? `BRD content (derive title from this, NOT from requirement codes like FR-XXX):\n${brdContentForTitle.trim().substring(0, 800)}`
          : Array.isArray(brdRequirementNames) && brdRequirementNames.length > 0
            ? `BRD requirement codes (prefer content if available): ${brdRequirementNames.slice(0, 8).join(", ")}`
            : "";

      // 3) Uploaded file content (from chat) – analyse for title
      const fileContentForTitle = (state?.fileContentForTitle ?? inputs?.fileContentForTitle) as string | undefined;
      const fileContentLine =
        typeof fileContentForTitle === "string" && fileContentForTitle.trim()
          ? `Uploaded file content (derive title from this):\n${fileContentForTitle.trim().substring(0, 600)}`
          : "";

      // 4) Guidelines / compliance files used
      const guidelineNames = (state?.guidelineNames ?? inputs?.guidelineNames) as string[] | undefined;
      const guidelinesFromInput = inputs?.complianceGuidelines as Array<{ name?: string }> | undefined;
      const fileNames = Array.isArray(guidelineNames)
        ? guidelineNames
        : Array.isArray(guidelinesFromInput)
          ? guidelinesFromInput.map((g) => (typeof g?.name === "string" ? g.name : "")).filter(Boolean)
          : [];
      const filesLine =
        fileNames.length > 0 ? `Guideline files: ${fileNames.slice(0, 5).join(", ")}` : "";

      // 5) Requirement/summary text (from chat or BRD) as extra context
      const requirement =
        typeof inputs?.requirement === "string"
          ? (inputs.requirement as string).trim().substring(0, 400).replace(/\s+/g, " ")
          : "";

      const contextParts: string[] = [];
      if (userQuerySnippet) {
        contextParts.push(`User's request (use this for the title): ${userQuerySnippet}`);
      }
      if (chatSnippet) contextParts.push(chatSnippet);
      if (brdLine) contextParts.push(brdLine);
      if (fileContentLine) contextParts.push(fileContentLine);
      if (filesLine) contextParts.push(filesLine);
      if (requirement) contextParts.push(`Summary: ${requirement}`);

      const context =
        contextParts.length > 0
          ? contextParts.join("\n")
          : "No chat, BRD, or file context provided.";

      // Strip "FR-XXX: " (and similar) so fallback title is topic-only, not "FR-013: Agents shall..."
      const stripRequirementCodes = (text: string): string =>
        text.replace(/^FR-\d+:\s*/i, "").replace(/\s*FR-\d+:\s*/g, " | ").replace(/\s+/g, " ").trim();

      // Fallback: prefer content-based snippet; for BRD/file use topic only (no FR-XXX prefix), max 50 chars for a title
      const brdContentSnippet =
        typeof brdContentForTitle === "string" && brdContentForTitle.trim()
          ? stripRequirementCodes(brdContentForTitle).substring(0, 50)
          : "";
      const fileContentSnippet =
        typeof fileContentForTitle === "string" && fileContentForTitle.trim()
          ? fileContentForTitle.replace(/\s+/g, " ").trim().substring(0, 50)
          : "";
      const fallbackFromContent =
        (userQuerySnippet && userQuerySnippet.substring(0, 80)) ||
        (brdContentSnippet || fileContentSnippet) ||
        (conversationMessages
          ? conversationMessages.find((m) => m?.role === "user")?.content?.trim?.()?.substring(0, 80)
          : "") ||
        (requirement ? requirement.substring(0, 80) : "") ||
        (fileNames.length ? fileNames[0] : "") ||
        (brdRequirementNames?.length ? brdRequirementNames.slice(0, 3).join(" – ") : "") ||
        `Workflow – ${new Date().toLocaleDateString()}`;

      const prompt = `Generate a short session title (max 60 characters) from the content below.
Rules:
- Output ONLY a short topic phrase (e.g. "Underwriting & compliance alerts for agents"). Do NOT start with or include "FR-013", "FR-016", or any requirement code.
- When BRD content is provided: summarize the topic from the description text only (e.g. "Payment flow & user auth").
- When file content is provided: summarize that in a few words.
- Do NOT use "Workflow" or "Session" with a date. No colons, no "FR-XXX:" prefix.

Content:
${context}

Return only the title, no quotes, no period.`;

      const model =
        process.env.AZURE_OPENAI_DEPLOYMENT ||
        process.env.ANTHROPIC_MODEL_NAME ||
        "gpt-4o";
      console.log("[Session Service] Generating AI title from content, model:", model);

      const response = await ai.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              "You output a short topic phrase only (e.g. 'Underwriting & compliance alerts for agents'). Never start the title with FR-XXX or include requirement codes. Never use 'Workflow' or 'Session' with a date. Output only the title, nothing else.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 60,
        temperature: 0.4,
      });

      const rawContent = response?.choices?.[0]?.message?.content;
      const trimmed = typeof rawContent === "string" ? rawContent.trim() : "";
      let title = trimmed || fallbackFromContent;
      title = title.replace(/^["']|["']$/g, "").trim() || title;

      // If AI returned generic or FR-based title (e.g. "FR-013: Agents shall receive..."), use content-based fallback (already stripped of FR-XXX)
      const looksGeneric =
        !title ||
        /^Workflow\s*[–-]?\s*\d/i.test(title) ||
        /^Session\s*[–-]?\s*\d/i.test(title) ||
        title.toLowerCase() === "workflow" ||
        title.toLowerCase() === "session" ||
        /^FR-\d+(\s*[–-]\s*FR-\d+)*\s*$/i.test(title.trim()) ||
        /^FR-\d+:\s*/i.test(title.trim()) ||
        /no content provided|topic generation/i.test(title);
      if (looksGeneric && fallbackFromContent && !fallbackFromContent.startsWith("Workflow –")) {
        title = fallbackFromContent;
      }
      // If still a placeholder (e.g. "No content provided for topic generation"), use date-based title
      if (/no content provided|topic generation/i.test(title)) {
        title = `Workflow – ${new Date().toLocaleDateString()}`;
      }

      if (trimmed && !looksGeneric) {
        console.log("[Session Service] AI title generated:", title.substring(0, 80));
      } else if (looksGeneric) {
        console.log("[Session Service] Replaced generic title with user content:", title.substring(0, 80));
      } else {
        console.warn("[Session Service] AI returned empty title, using content fallback.");
      }

      return title.substring(0, 120);
    } catch (error) {
      console.error("[Session Service] Error generating title:", error);
      const state = initialState as Record<string, unknown> | undefined;
      const inputs = state?.inputs as Record<string, unknown> | undefined;
      const userQuery = (state?.userQueryForTitle ?? inputs?.userQueryForTitle) as string | undefined;
      const brdContent = (state?.brdContentForTitle ?? inputs?.brdContentForTitle) as string | undefined;
      const fileContent = (state?.fileContentForTitle ?? inputs?.fileContentForTitle) as string | undefined;
      const req = typeof inputs?.requirement === "string" ? (inputs.requirement as string).trim() : "";
      const stripCodes = (t: string) => t.replace(/^FR-\d+:\s*/i, "").replace(/\s+/g, " ").trim().substring(0, 50);
      const safeFallback =
        (typeof userQuery === "string" && userQuery.trim() && userQuery.trim().substring(0, 80)) ||
        (typeof brdContent === "string" && brdContent.trim() && stripCodes(brdContent)) ||
        (typeof fileContent === "string" && fileContent.trim() && fileContent.replace(/\s+/g, " ").trim().substring(0, 50)) ||
        (req && req.substring(0, 80)) ||
        `Workflow – ${new Date().toLocaleDateString()}`;
      return safeFallback.substring(0, 120);
    }
  }

  private buildChatSnippet(
    messages: Array<{ role?: string; content?: string }> | undefined
  ): string {
    if (!Array.isArray(messages) || messages.length === 0) return "";
    const lines = messages
      .slice(-8)
      .map((m) => {
        const role = m?.role === "user" ? "User" : "Assistant";
        const text = typeof m?.content === "string" ? m.content.trim() : "";
        return text ? `${role}: ${text.substring(0, 150)}` : "";
      })
      .filter(Boolean);
    return lines.length > 0 ? `Chat:\n${lines.join("\n")}` : "";
  }

  /**
   * Create a new session
   */
  async createSession(
    request: CreateSessionRequest
  ): Promise<{ session: AiSession; state: SessionState }> {
    // Get or create user
    const user = await this.getOrCreateMsalUser(request.userIdentity);

    // Generate AI title
    const title = await this.generateSessionTitle(
      request.projectId,
      request.initialState
    );

    // Create session
    const sessionId = randomUUID();
    const newSession: InsertAiSession = {
      id: sessionId,
      projectId: request.projectId,
      userId: user.id,
      title,
      status: "IN_PROGRESS",
      currentScreen: request.initialState?.screen || null,
    };

    await db.insert(aiSessions).values(newSession);

    // Get created session
    const session = await db
      .select()
      .from(aiSessions)
      .where(eq(aiSessions.id, sessionId))
      .limit(1);

    if (!session[0]) {
      throw new Error("Failed to create session");
    }

    // Create initial state
    const stateId = randomUUID();
    const stateData: InsertSessionState = {
      id: stateId,
      sessionId: session[0].id,
      stateSnapshot: JSON.stringify(request.initialState || {}),
      cursorState: request.initialState?.cursorState || null,
      inputs: request.initialState?.inputs || null,
      outputs: request.initialState?.outputs || null,
      version: 1,
    };

    await db.insert(sessionStates).values(stateData);

    const state = await db
      .select()
      .from(sessionStates)
      .where(eq(sessionStates.sessionId, session[0].id))
      .limit(1);

    if (!state[0]) {
      throw new Error("Failed to create session state");
    }

    // Initialize cost summary
    const costSummaryId = randomUUID();
    const costSummary: InsertSessionCostSummary = {
      id: costSummaryId,
      sessionId: session[0].id,
      totalCost: "0",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCalls: 0,
    };

    await db.insert(sessionCostSummaries).values(costSummary);

    return { session: session[0], state: state[0] };
  }

  /**
   * Auto-save session state
   */
  async autoSaveSession(
    request: AutoSaveSessionRequest
  ): Promise<SessionState> {
    // Verify user owns session
    const session = await this.getSessionById(
      request.sessionId,
      request.userIdentity
    );
    if (!session) {
      throw new Error("Session not found or access denied");
    }

    // Update session last accessed
    await db
      .update(aiSessions)
      .set({
        lastAccessedAt: new Date(),
        currentScreen: request.state.screen || null,
        updatedAt: new Date(),
      })
      .where(eq(aiSessions.id, request.sessionId));

    // Update or create state
    const existingState = await db
      .select()
      .from(sessionStates)
      .where(eq(sessionStates.sessionId, request.sessionId))
      .limit(1);

    const stateData: InsertSessionState = {
      sessionId: request.sessionId,
      stateSnapshot: JSON.stringify(request.state),
      cursorState: request.state.cursorState || null,
      inputs: request.state.inputs || null,
      outputs: request.state.outputs || null,
      version: existingState[0] ? existingState[0].version + 1 : 1,
    };

    if (existingState[0]) {
      await db
        .update(sessionStates)
        .set({
          stateSnapshot: stateData.stateSnapshot,
          cursorState: stateData.cursorState,
          inputs: stateData.inputs,
          outputs: stateData.outputs,
          version: stateData.version,
          updatedAt: new Date(),
        })
        .where(eq(sessionStates.id, existingState[0].id));
    } else {
      const stateId = randomUUID();
      await db.insert(sessionStates).values({
        ...stateData,
        id: stateId,
      });
    }

    const updatedState = await db
      .select()
      .from(sessionStates)
      .where(eq(sessionStates.sessionId, request.sessionId))
      .limit(1);

    if (!updatedState[0]) {
      throw new Error("Failed to save session state");
    }

    return updatedState[0];
  }

  /**
   * Get session by ID (with user verification)
   */
  async getSessionById(
    sessionId: string,
    userIdentity: UserIdentity
  ): Promise<AiSession | null> {
    const user = await this.getOrCreateMsalUser(userIdentity);

    const conditions = [eq(aiSessions.id, sessionId), isNull(aiSessions.deletedAt)];

    // For non-admins, enforce user-level isolation
    if (userIdentity.role !== "admin") {
      conditions.push(eq(aiSessions.userId, user.id));
    }

    const sessions = await db
      .select()
      .from(aiSessions)
      .where(and(...conditions))
      .limit(1);

    return sessions[0] || null;
  }

  /**
   * Get session state for resume
   */
  async getSessionState(
    sessionId: string,
    userIdentity: UserIdentity
  ): Promise<SessionState | null> {
    // Verify access
    const session = await this.getSessionById(sessionId, userIdentity);
    if (!session) {
      return null;
    }

    const states = await db
      .select()
      .from(sessionStates)
      .where(eq(sessionStates.sessionId, sessionId))
      .limit(1);

    return states[0] || null;
  }

  /**
   * Set session status (IN_PROGRESS when generating, PAUSED when step 2 done, COMPLETED when step 3 push/save)
   */
  async setSessionStatus(
    sessionId: string,
    userIdentity: UserIdentity,
    status: "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "INACTIVE" | "CANCELLED"
  ): Promise<AiSession | null> {
    const session = await this.getSessionById(sessionId, userIdentity);
    if (!session) return null;
    await db
      .update(aiSessions)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(aiSessions.id, sessionId));
    const updated = await db
      .select()
      .from(aiSessions)
      .where(eq(aiSessions.id, sessionId))
      .limit(1);
    return updated[0] || null;
  }

  /**
   * Get all sessions for a project (user-scoped)
   */
  async getSessionsByProject(
    projectId: string,
    userIdentity: UserIdentity,
    status?: "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "INACTIVE" | "CANCELLED"
  ): Promise<AiSession[]> {
    const user = await this.getOrCreateMsalUser(userIdentity);

    const conditions = [
      eq(aiSessions.projectId, projectId),
      isNull(aiSessions.deletedAt),
    ];

    // For non-admins, only return their own sessions
    if (userIdentity.role !== "admin") {
      conditions.push(eq(aiSessions.userId, user.id));
    }

    if (status) {
      conditions.push(eq(aiSessions.status, status));
    }

    const sessions = await db
      .select()
      .from(aiSessions)
      .where(and(...conditions))
      .orderBy(desc(aiSessions.lastAccessedAt));

    return sessions;
  }

  /**
   * Rename session title
   */
  async renameSession(
    sessionId: string,
    newTitle: string,
    userIdentity: UserIdentity
  ): Promise<AiSession> {
    const session = await this.getSessionById(sessionId, userIdentity);
    if (!session) {
      throw new Error("Session not found or access denied");
    }

    await db
      .update(aiSessions)
      .set({
        title: newTitle.substring(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(aiSessions.id, sessionId));

    const updated = await db
      .select()
      .from(aiSessions)
      .where(eq(aiSessions.id, sessionId))
      .limit(1);

    if (!updated[0]) {
      throw new Error("Failed to update session");
    }

    return updated[0];
  }

  /**
   * Delete session (soft delete)
   */
  async deleteSession(
    sessionId: string,
    userIdentity: UserIdentity
  ): Promise<void> {
    const session = await this.getSessionById(sessionId, userIdentity);
    if (!session) {
      throw new Error("Session not found or access denied");
    }

    await db
      .update(aiSessions)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(aiSessions.id, sessionId));
  }

  /**
   * Mark session as completed
   */
  async completeSession(
    sessionId: string,
    userIdentity: UserIdentity
  ): Promise<AiSession> {
    const session = await this.getSessionById(sessionId, userIdentity);
    if (!session) {
      throw new Error("Session not found or access denied");
    }

    await db
      .update(aiSessions)
      .set({
        status: "COMPLETED",
        updatedAt: new Date(),
      })
      .where(eq(aiSessions.id, sessionId));

    const updated = await db
      .select()
      .from(aiSessions)
      .where(eq(aiSessions.id, sessionId))
      .limit(1);

    if (!updated[0]) {
      throw new Error("Failed to complete session");
    }

    return updated[0];
  }

  /**
   * Track AI usage and calculate cost
   */
  async trackAIUsage(usage: AIUsageData): Promise<void> {
    // Resolve effective pricing: prefer explicit values, otherwise fall back
    // to built-in defaults based on model + provider.
    const defaults = getDefaultPricingForModel(usage.model, usage.provider);
    const inputPricePer1K = usage.inputPricePer1K ?? defaults.inputPricePer1K;
    const outputPricePer1K = usage.outputPricePer1K ?? defaults.outputPricePer1K;

    // Calculate cost
    const inputCost = (usage.inputTokens / 1000) * inputPricePer1K;
    const outputCost = (usage.outputTokens / 1000) * outputPricePer1K;
    const totalCost = inputCost + outputCost;

    // Log usage
    const usageLogId = randomUUID();
    const usageLog: InsertAiUsageLog = {
      id: usageLogId,
      sessionId: usage.sessionId,
      callId: usage.callId,
      model: usage.model,
      provider: usage.provider,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
      inputPricePer1K: inputPricePer1K.toString(),
      outputPricePer1K: outputPricePer1K.toString(),
      cost: totalCost.toString(),
      requestMetadata: usage.requestMetadata || null,
    };

    await db.insert(aiUsageLogs).values(usageLog);

    // Update cost summary (incremental)
    const summary = await db
      .select()
      .from(sessionCostSummaries)
      .where(eq(sessionCostSummaries.sessionId, usage.sessionId))
      .limit(1);

    if (summary[0]) {
      const newTotalCost =
        parseFloat(summary[0].totalCost) + totalCost;
      const newTotalInputTokens =
        summary[0].totalInputTokens + usage.inputTokens;
      const newTotalOutputTokens =
        summary[0].totalOutputTokens + usage.outputTokens;

      await db
        .update(sessionCostSummaries)
        .set({
          totalCost: newTotalCost.toString(),
          totalInputTokens: newTotalInputTokens,
          totalOutputTokens: newTotalOutputTokens,
          totalCalls: summary[0].totalCalls + 1,
          lastCalculatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sessionCostSummaries.sessionId, usage.sessionId));
    } else {
      // Create summary if it doesn't exist
      const summaryId = randomUUID();
      const newSummary: InsertSessionCostSummary = {
        id: summaryId,
        sessionId: usage.sessionId,
        totalCost: totalCost.toString(),
        totalInputTokens: usage.inputTokens,
        totalOutputTokens: usage.outputTokens,
        totalCalls: 1,
      };
      await db.insert(sessionCostSummaries).values(newSummary);
    }
  }

  /**
   * Get session cost summary
   */
  async getSessionCost(
    sessionId: string,
    userIdentity: UserIdentity
  ): Promise<SessionCostSummary | null> {
    const session = await this.getSessionById(sessionId, userIdentity);
    if (!session) {
      return null;
    }

    const summary = await db
      .select()
      .from(sessionCostSummaries)
      .where(eq(sessionCostSummaries.sessionId, sessionId))
      .limit(1);

    return summary[0] || null;
  }

  /**
   * Get total cost across all sessions for a user
   */
  async getTotalUserCost(
    userIdentity: UserIdentity
  ): Promise<{ totalCost: number; sessionCount: number }> {
    const user = await this.getOrCreateMsalUser(userIdentity);

    // Get all sessions for this user (or all sessions for admin)
    const sessionConditions = [isNull(aiSessions.deletedAt)];
    if (userIdentity.role !== "admin") {
      sessionConditions.push(eq(aiSessions.userId, user.id));
    }

    const sessions = await db
      .select({ id: aiSessions.id })
      .from(aiSessions)
      .where(and(...sessionConditions));

    if (sessions.length === 0) {
      return { totalCost: 0, sessionCount: 0 };
    }

    const sessionIds = sessions.map((s) => s.id);

    // Calculate total cost
    if (sessionIds.length === 0) {
      return { totalCost: 0, sessionCount: 0 };
    }

    const result = await db
      .select({
        totalCost: sum(sessionCostSummaries.totalCost),
      })
      .from(sessionCostSummaries)
      .where(inArray(sessionCostSummaries.sessionId, sessionIds));

    const totalCost = result[0]?.totalCost
      ? parseFloat(result[0].totalCost.toString())
      : 0;

    return {
      totalCost,
      sessionCount: sessions.length,
    };
  }

  /**
   * Save workflow step data
   */
  async saveWorkflowStepData(
    sessionId: string,
    stepNumber: number,
    stepName: string,
    data: {
      step1Data?: Partial<InsertWorkflowStep1Data>;
      step2Data?: Partial<InsertWorkflowStep2Data>;
      step3Data?: Partial<InsertWorkflowStep3Data>;
    },
    userIdentity: UserIdentity
  ): Promise<void> {
    // Try strict ownership check first, fall back to session-exists-only check
    let session = await this.getSessionById(sessionId, userIdentity);
    if (!session) {
      const [anySession] = await db
        .select()
        .from(aiSessions)
        .where(and(eq(aiSessions.id, sessionId), isNull(aiSessions.deletedAt)))
        .limit(1);
      if (!anySession) {
        throw new Error("Session not found or access denied");
      }
      session = anySession;
      console.warn(`[Session API] Relaxed ownership check for session ${sessionId} — user identity mismatch but session exists`);
    }

    // Update or create workflow step tracking
    const existingStep = await db
      .select()
      .from(workflowSteps)
      .where(
        and(
          eq(workflowSteps.sessionId, sessionId),
          eq(workflowSteps.stepNumber, stepNumber)
        )
      )
      .limit(1);

    if (existingStep[0]) {
      await db
        .update(workflowSteps)
        .set({
          stepName,
          status: "IN_PROGRESS",
          updatedAt: new Date(),
        })
        .where(eq(workflowSteps.id, existingStep[0].id));
    } else {
      const stepId = randomUUID();
      await db.insert(workflowSteps).values({
        id: stepId,
        sessionId,
        stepNumber,
        stepName,
        status: "IN_PROGRESS",
      });
    }

    // Save step-specific data
    if (stepNumber === 1 && data.step1Data) {
      const existing = await db
        .select()
        .from(workflowStep1Data)
        .where(eq(workflowStep1Data.sessionId, sessionId))
        .limit(1);

      if (existing[0]) {
        await db
          .update(workflowStep1Data)
          .set({
            ...data.step1Data,
            updatedAt: new Date(),
          })
          .where(eq(workflowStep1Data.id, existing[0].id));
      } else {
        const step1Id = randomUUID();
        await db.insert(workflowStep1Data).values({
          id: step1Id,
          sessionId,
          ...data.step1Data,
        });
      }
    } else if (stepNumber === 2 && data.step2Data) {
      const existing = await db
        .select()
        .from(workflowStep2Data)
        .where(eq(workflowStep2Data.sessionId, sessionId))
        .limit(1);

      if (existing[0]) {
        await db
          .update(workflowStep2Data)
          .set({
            ...data.step2Data,
            updatedAt: new Date(),
          })
          .where(eq(workflowStep2Data.id, existing[0].id));
      } else {
        const step2Id = randomUUID();
        await db.insert(workflowStep2Data).values({
          id: step2Id,
          sessionId,
          ...data.step2Data,
        });
      }
    } else if (stepNumber === 3 && data.step3Data) {
      const existing = await db
        .select()
        .from(workflowStep3Data)
        .where(eq(workflowStep3Data.sessionId, sessionId))
        .limit(1);

      if (existing[0]) {
        await db
          .update(workflowStep3Data)
          .set({
            ...data.step3Data,
            updatedAt: new Date(),
          })
          .where(eq(workflowStep3Data.id, existing[0].id));
      } else {
        const step3Id = randomUUID();
        await db.insert(workflowStep3Data).values({
          id: step3Id,
          sessionId,
          ...data.step3Data,
        });
      }
    }
  }

  /**
   * Mark workflow step as completed
   */
  async completeWorkflowStep(
    sessionId: string,
    stepNumber: number,
    userIdentity: UserIdentity
  ): Promise<void> {
    const session = await this.getSessionById(sessionId, userIdentity);
    if (!session) {
      throw new Error("Session not found or access denied");
    }

    const existingStep = await db
      .select()
      .from(workflowSteps)
      .where(
        and(
          eq(workflowSteps.sessionId, sessionId),
          eq(workflowSteps.stepNumber, stepNumber)
        )
      )
      .limit(1);

    if (existingStep[0]) {
      await db
        .update(workflowSteps)
        .set({
          status: "COMPLETED",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workflowSteps.id, existingStep[0].id));
    } else {
      // Create step record if it doesn't exist
      const stepId = randomUUID();
      const stepName = stepNumber === 1 ? "conversational_refinement" :
                      stepNumber === 2 ? "artifact_generation" :
                      stepNumber === 3 ? "devops_push" : "unknown";
      
      await db.insert(workflowSteps).values({
        id: stepId,
        sessionId,
        stepNumber,
        stepName,
        status: "COMPLETED",
        completedAt: new Date(),
      });
    }
  }

  /**
   * Get all workflow steps for a session
   */
  async getWorkflowSteps(
    sessionId: string,
    userIdentity: UserIdentity
  ): Promise<WorkflowStep[]> {
    const session = await this.getSessionById(sessionId, userIdentity);
    if (!session) {
      throw new Error("Session not found or access denied");
    }

    const steps = await db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.sessionId, sessionId))
      .orderBy(workflowSteps.stepNumber);

    return steps;
  }

  /**
   * Get workflow step data for resume
   */
  async getWorkflowStepData(
    sessionId: string,
    userIdentity: UserIdentity
  ): Promise<{
    steps: WorkflowStep[];
    step1Data: WorkflowStep1Data | null;
    step2Data: WorkflowStep2Data | null;
    step3Data: WorkflowStep3Data | null;
  }> {
    const session = await this.getSessionById(sessionId, userIdentity);
    if (!session) {
      throw new Error("Session not found or access denied");
    }

    const steps = await this.getWorkflowSteps(sessionId, userIdentity);

    // Load step data
    const [step1] = await db
      .select()
      .from(workflowStep1Data)
      .where(eq(workflowStep1Data.sessionId, sessionId))
      .limit(1);

    const [step2] = await db
      .select()
      .from(workflowStep2Data)
      .where(eq(workflowStep2Data.sessionId, sessionId))
      .limit(1);

    const [step3] = await db
      .select()
      .from(workflowStep3Data)
      .where(eq(workflowStep3Data.sessionId, sessionId))
      .limit(1);

    return {
      steps,
      step1Data: step1 || null,
      step2Data: step2 || null,
      step3Data: step3 || null,
    };
  }
}

export const sessionService = new SessionService();
