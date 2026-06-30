import { ai as sharedAiClient } from "./ai-client";
import { extractJsonFromLLMResponse } from "./ai-service";
import { windowConversationHistory } from "./observability/prompt-cache";
import {
  createJobCachePrefix,
  logJobCacheFingerprint,
  toLlmMessages,
} from "./observability/job-cache-prefix";

const openai = sharedAiClient;

const WORKFLOW_CACHE_STATIC_SYSTEM = `# PRODUCTION-GRADE ENTERPRISE BA AGENT

You are an elite Business Analyst AI with 15+ years of experience in Agile requirements gathering for Fortune 500 companies.

## CORE MISSION
Guide an intelligent, warm, collaborative conversation to extract enterprise-grade requirements for generating production-quality Epics, Features, and User Stories in Azure DevOps.

## INTERACTION MODES
- MODE 1 GUIDED: Ask context-aware questions sequentially across all requirement categories.
- MODE 2 DIRECT: Artifact generation happens immediately; this path should not ask questions.

## CORE PRINCIPLES
1. Intelligence over scripts — analyze context
2. Build on context — reference prior answers
3. Breadth before depth
4. Conversational warmth
5. Strategic thinking for dev/QA/PO needs
6. Memory across the session
7. Respect mode selection

## RESPONSE FORMAT
Respond in JSON: { "question", "phase", "quickReplies", "readyToGenerate", "capturedInfo", "suggestedFollowUps" }
Extract ALL new information into capturedInfo arrays; merge with existing, never replace.

## QUALITY MANTRAS
- Check for duplicate questions before asking
- Review what the user already provided
- Balance breadth vs depth
- Think about acceptance-criteria quality downstream`;

function buildWorkflowCacheStaticUser(opts: {
  processedFileRequirements?: string | null;
  attachedBrdId?: string | null;
  complianceGuidelines?: any[];
}): string {
  const parts: string[] = [];
  if (opts.processedFileRequirements?.trim()) {
    parts.push(
      `### ATTACHED BRD CONTENT\nBRD ID: ${opts.attachedBrdId || "unknown"}\n\n${opts.processedFileRequirements}\n\n` +
        `CRITICAL: Do NOT ask about information already documented in this BRD. Focus on gaps, edge cases, and implementation details.`,
    );
  }
  if (opts.complianceGuidelines && opts.complianceGuidelines.length > 0) {
    parts.push(
      `### COMPLIANCE GUIDELINES (${opts.complianceGuidelines.length} documents)\n\n` +
        opts.complianceGuidelines
          .map(
            (g: any, i: number) =>
              `#### Guideline ${i + 1}: ${g.name}\nSource: ${g.path || "Golden Repository"}\n\n${g.content}\n`,
          )
          .join("\n"),
    );
  }
  return parts.join("\n\n") || "(No attached BRD or compliance guidelines for this session.)";
}

/**
 * PRODUCTION-GRADE SDLC WORKFLOW AGENT - COMPREHENSIVE VERSION
 * 
 * Features:
 * 1. Complete preservation of quality standards and guidelines
 * 2. Advanced context awareness and memory
 * 3. Semantic duplicate detection
 * 4. Intelligent topic progression
 * 5. Response history analysis
 * 6. Conversational warmth maintained
 */

interface RequirementsContext {
  businessGoals: string[];
  keyFeatures: string[];
  targetUsers: string[];
  functionalRequirements: string[];
  technicalConstraints: string[];
  nonFunctionalRequirements: string[];
  successMetrics: string[];
  userWorkflows: string[];
  integrations: string[];
  scopeBoundaries: { inScope: string[]; outOfScope: string[] };
}

interface ConversationState {
  currentFocus: string;
  depthLevel: number;
  lastTopicExhausted: boolean;
  suggestedNextTopics: string[];
  categoryCoverage: Record<string, number>;
  shouldSwitchTopic: boolean;
  responseHistory: ResponseAnalysis[];
}

interface ResponseAnalysis {
  userMessage: string;
  extractedInfo: string[];
  topicsCovered: string[];
  timestamp: number;
}

interface QuestionHistory {
  question: string;
  category: string;
  keywords: Set<string>;
  userResponse?: string;
  infoExtracted?: string[];
}

async function fetchBacklogContext(): Promise<string> {
  try {
    const baseUrl = process.env.API_BASE_URL || "http://localhost:5000";
    const response = await fetch(`${baseUrl}/api/ado-settings/backlog`);

    if (!response.ok) {
      console.log("[Workflow AI] ADO backlog not available (optional)");
      return "";
    }

    const data = await response.json();

    if (!data.success || !data.backlog || data.backlog.length === 0) {
      console.log("[Workflow AI] No existing backlog items found");
      return "";
    }

    const summary = `## EXISTING AZURE DEVOPS BACKLOG CONTEXT

**Current Backlog Summary:**
- **Total Epics:** ${data.counts.epics} (${data.counts.epics - (data.counts.closedEpics || 0)} Active)
- **Total Features:** ${data.counts.features} (${data.counts.features - (data.counts.closedFeatures || 0)} Active)
- **Total User Stories:** ${data.counts.userStories} (${data.counts.userStories - (data.counts.closedStories || 0)} Active)
- **Total Tasks:** ${data.counts.tasks}
- **Total Bugs:** ${data.counts.bugs}

### EXISTING EPICS (Top 10 by Priority):
${data.grouped.epics.slice(0, 10).map((epic: any) => `
**Epic #${epic.id}: ${epic.title}**
- State: ${epic.state} | Priority: ${epic.priority || 'N/A'}
- Description: ${epic.description?.substring(0, 150) || 'No description'}...
- Tags: ${epic.tags || 'None'}
- Child Features: ${epic.childFeatures?.length || 0}
`).join('\n') || 'No epics found'}

### EXISTING FEATURES (Top 10 by Priority):
${data.grouped.features.slice(0, 10).map((feature: any) => `
**Feature #${feature.id}: ${feature.title}** ${feature.parentEpic ? `(Epic #${feature.parentEpic})` : ''}
- State: ${feature.state} | Priority: ${feature.priority || 'N/A'}
- Description: ${feature.description?.substring(0, 150) || 'No description'}...
- User Stories: ${feature.childStories?.length || 0}
`).join('\n') || 'No features found'}

### EXISTING USER STORIES (Recent 20):
${data.grouped.userStories.slice(0, 20).map((story: any) => `
**Story #${story.id}:** ${story.title} ${story.parentFeature ? `(Feature #${story.parentFeature})` : ''}
- State: ${story.state} | Priority: ${story.priority || 'N/A'} | Story Points: ${story.storyPoints || 'N/A'}
`).join('\n') || 'No user stories found'}

---

## CRITICAL BACKLOG AWARENESS RULES:

### 1. PROACTIVE DUPLICATE DETECTION
- Before exploring any new capability, CHECK if similar epics/features exist
- When user mentions functionality, immediately reference existing related work
- Example: "I notice you have Epic #123 'Customer Portal Enhancement'. Does this relate to that?"

### 2. INTELLIGENT ALIGNMENT SUGGESTIONS
- Suggest adding to existing epics/features when appropriate
- Ask: "Should this be part of existing Feature #456, or a new feature?"
- Respect existing hierarchy and organization patterns

### 3. GAP IDENTIFICATION
- Notice missing components in existing epics/features
- Example: "Your 'User Onboarding' feature has registration but no password recovery. Should we add that?"
- Suggest completing partial implementations

### 4. PRIORITY & TAG CONSISTENCY
- Align new work with existing priority patterns
- Adopt existing tagging conventions
- Example: "Your authentication stories are Priority 1. Should these match?"

### 5. DEPENDENCY AWARENESS
- Identify potential dependencies on existing work
- Flag items that might be impacted by new requirements
- Ask about integration with existing features

**GOLDEN RULE:** If user's requirement overlaps >50% with existing work, ALWAYS ask about relationship before proceeding.
`;

    console.log(`[Workflow AI] Loaded backlog: ${data.totalCount} items`);
    return summary;
  } catch (error) {
    console.log("[Workflow AI] Could not fetch backlog:", error instanceof Error ? error.message : String(error));
    return "";
  }
}

/**
 * Extract keywords from text for semantic similarity
 */
function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'should', 'could', 'may', 'might', 'can', 'what', 'how',
    'when', 'where', 'why', 'who', 'which', 'this', 'that', 'these',
    'those', 'you', 'your', 'could', 'tell', 'me', 'about', 'please',
    'describe', 'explain', 'walk', 'through'
  ]);

  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word));

  return new Set(words);
}

/**
 * Check if a word is a valid business/technical term
 */
function isValidWord(word: string): boolean {
  const validShortWords = [
    'api', 'app', 'web', 'cms', 'crm', 'erp', 'pos', 'ui', 'ux', 'db',
    'aws', 'gcp', 'sql', 'css', 'html', 'spa', 'pwa', 'mvp', 'poc',
    'b2b', 'b2c', 'saas', 'paas', 'iaas', 'iot', 'ai', 'ml', 'bot',
    'sms', 'email', 'chat', 'zoom', 'teams', 'slack'
  ];

  return validShortWords.includes(word.toLowerCase());
}

/**
 * Detect invalid/meaningless input patterns
 */
function isInvalidInput(message: string): boolean {
  const trimmed = message.trim().toLowerCase();

  // Very short inputs
  if (trimmed.length < 3) return true;

  // Random character sequences (2-6 chars, all lowercase letters)
  if (/^[a-z]{2,6}$/.test(trimmed) && !isValidWord(trimmed)) return true;

  // Repeated characters (3+ same character)
  if (/^(.)\1{2,}$/.test(trimmed)) return true;

  // Keyboard mashing patterns
  if (/^(qwe|asd|zxc|123|abc|qwerty|asdf){1,3}$/i.test(trimmed)) return true;

  // Numbers without context (less than 1000)
  if (/^\d+$/.test(trimmed) && parseInt(trimmed) < 1000) return true;

  // Meaningless words
  const meaninglessWords = [
    'test', 'testing', 'hello', 'hi', 'hey', 'ok', 'okay', 'yes', 'no',
    'abcd', 'xyz', 'demo', 'sample', 'example', 'try', 'trying'
  ];

  if (meaninglessWords.includes(trimmed)) return true;

  return false;
}

/**
 * Detect if message is a greeting (not substantive requirement)
 */
function isGreetingMessage(message: string): boolean {
  const trimmed = message.trim();
  const greetingPattern = /^\s*(hey|hi|hello|hiya|howdy|greetings|good morning|good afternoon|good evening|sup|yo)[\s,!.?]*$/i;
  return greetingPattern.test(trimmed);
}

/**
 * Detect if message contains substantive requirements information
 */
function isSubstantiveMessage(message: string): boolean {
  if (isGreetingMessage(message)) return false;

  // Check for invalid input first
  if (isInvalidInput(message)) return false;

  const trimmed = message.trim();

  // Must be reasonably long (more than a few words)
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 8) return false;

  // Check for requirement indicators
  const substantiveIndicators = [
    // Project/product mentions
    /(?:build|create|develop|need|want|looking to)\s+(?:a|an|the)?\s*(?:web|mobile|desktop|application|app|system|platform|portal|dashboard)/i,
    // Feature mentions
    /(?:feature|functionality|capability|function|ability|should|must|can|need to|want to|require)/i,
    // User/business mentions
    /(?:user|customer|employee|manager|admin|team|business|goal|objective|solve|improve|enhance)/i,
    // Process/workflow mentions
    /(?:workflow|process|step|journey|integrate|connect|track|manage|monitor)/i,
    // Technical mentions
    /(?:database|api|integration|backend|frontend|cloud|server|platform|technology)/i,
  ];

  return substantiveIndicators.some(pattern => pattern.test(trimmed));
}

/**
 * Assess content richness to determine if intelligent generation is viable
 */
function assessContentRichness(requirements: RequirementsContext, message: string): {
  score: number;
  hasMinimumForGeneration: boolean;
  strengths: string[];
  gaps: string[];
} {
  let score = 0;
  const strengths: string[] = [];
  const gaps: string[] = [];

  // Business goals (weight: 20)
  if (requirements.businessGoals && requirements.businessGoals.length > 0) {
    score += 20;
    strengths.push(`${requirements.businessGoals.length} business goal(s) identified`);
  } else {
    gaps.push('Business goals/objectives');
  }

  // Key features (weight: 25)
  const featureCount = requirements.keyFeatures?.length || 0;
  if (featureCount >= 3) {
    score += 25;
    strengths.push(`${featureCount} features/capabilities specified`);
  } else if (featureCount >= 1) {
    score += 15;
    strengths.push(`${featureCount} feature(s) mentioned`);
    gaps.push('More feature details would help');
  } else {
    gaps.push('Key features/capabilities');
  }

  // Target users (weight: 15)
  if (requirements.targetUsers && requirements.targetUsers.length > 0) {
    score += 15;
    strengths.push(`${requirements.targetUsers.length} user type(s) identified`);
  } else {
    gaps.push('Target users/personas');
  }

  // Functional requirements (weight: 15)
  if (requirements.functionalRequirements && requirements.functionalRequirements.length >= 2) {
    score += 15;
    strengths.push('Functional requirements captured');
  } else if (requirements.functionalRequirements && requirements.functionalRequirements.length > 0) {
    score += 8;
  }

  // Technical constraints (weight: 10)
  if (requirements.technicalConstraints && requirements.technicalConstraints.length > 0) {
    score += 10;
    strengths.push('Technical constraints identified');
  }

  // User workflows (weight: 10)
  if (requirements.userWorkflows && requirements.userWorkflows.length > 0) {
    score += 10;
    strengths.push('User workflows described');
  }

  // Success metrics (weight: 5)
  if (requirements.successMetrics && requirements.successMetrics.length > 0) {
    score += 5;
    strengths.push('Success metrics defined');
  }

  // Message length bonus (comprehensive input)
  const wordCount = message.split(/\s+/).length;
  if (wordCount > 100) {
    score += 5;
    strengths.push('Comprehensive initial input');
  } else if (wordCount > 50) {
    score += 3;
  }

  // Minimum threshold: 40/100 for intelligent generation
  const hasMinimumForGeneration = score >= 40;

  return {
    score,
    hasMinimumForGeneration,
    strengths,
    gaps
  };
}

/**
 * Calculate semantic similarity between questions
 */
function calculateQuestionSimilarity(q1: string, q2: string): number {
  const keywords1 = extractKeywords(q1);
  const keywords2 = extractKeywords(q2);

  if (keywords1.size === 0 || keywords2.size === 0) return 0;

  const intersection = new Set([...keywords1].filter(x => keywords2.has(x)));
  const union = new Set([...keywords1, ...keywords2]);

  return intersection.size / union.size;
}

/**
 * Check if question is duplicate
 */
function isDuplicateQuestion(
  newQuestion: string,
  questionHistory: QuestionHistory[],
  similarityThreshold: number = 0.55
): { isDuplicate: boolean; similarTo?: string; category?: string } {
  for (const hist of questionHistory) {
    const similarity = calculateQuestionSimilarity(newQuestion, hist.question);

    if (similarity > similarityThreshold) {
      return {
        isDuplicate: true,
        similarTo: hist.question,
        category: hist.category
      };
    }
  }

  return { isDuplicate: false };
}

/**
 * Categorize question based on content
 */
function categorizeQuestion(question: string): string {
  const lowerQ = question.toLowerCase();

  if (lowerQ.includes('goal') || lowerQ.includes('objective') || lowerQ.includes('why') ||
    lowerQ.includes('business value') || lowerQ.includes('driving this')) {
    return 'businessGoals';
  }
  if (lowerQ.includes('feature') || lowerQ.includes('functionality') || lowerQ.includes('capability') ||
    lowerQ.includes('what should')) {
    return 'keyFeatures';
  }
  if (lowerQ.includes('user') || lowerQ.includes('persona') || lowerQ.includes('who will') ||
    lowerQ.includes('who are')) {
    return 'targetUsers';
  }
  if (lowerQ.includes('workflow') || lowerQ.includes('process') || lowerQ.includes('journey') ||
    lowerQ.includes('step') || lowerQ.includes('walk me through')) {
    return 'userWorkflows';
  }
  if (lowerQ.includes('integrate') || lowerQ.includes('api') || lowerQ.includes('system') ||
    lowerQ.includes('platform') || lowerQ.includes('technology')) {
    return 'technicalConstraints';
  }
  if (lowerQ.includes('performance') || lowerQ.includes('security') || lowerQ.includes('scale') ||
    lowerQ.includes('non-functional') || lowerQ.includes('quality')) {
    return 'nonFunctionalRequirements';
  }
  if (lowerQ.includes('metric') || lowerQ.includes('measure') || lowerQ.includes('success') ||
    lowerQ.includes('kpi') || lowerQ.includes('how will you')) {
    return 'successMetrics';
  }
  if (lowerQ.includes('scope') || lowerQ.includes('not include') || lowerQ.includes('out of scope') ||
    lowerQ.includes('exclude')) {
    return 'scopeBoundaries';
  }

  return 'functionalRequirements';
}

/**
 * Analyze user response to extract covered topics
 */
function analyzeUserResponse(response: string, capturedRequirements: RequirementsContext): ResponseAnalysis {
  const lowerResponse = response.toLowerCase();
  const topicsCovered: string[] = [];
  const extractedInfo: string[] = [];

  // Detect what topics were covered in this response
  if (lowerResponse.includes('goal') || lowerResponse.includes('objective') ||
    lowerResponse.includes('solve') || lowerResponse.includes('achieve')) {
    topicsCovered.push('businessGoals');
    extractedInfo.push('Business goals/objectives mentioned');
  }

  if (lowerResponse.includes('feature') || lowerResponse.includes('capability') ||
    lowerResponse.includes('functionality') || lowerResponse.includes('need to') ||
    lowerResponse.includes('should be able to')) {
    topicsCovered.push('keyFeatures');
    extractedInfo.push('Features/capabilities mentioned');
  }

  if (lowerResponse.includes('user') || lowerResponse.includes('admin') ||
    lowerResponse.includes('manager') || lowerResponse.includes('customer') ||
    lowerResponse.includes('employee')) {
    topicsCovered.push('targetUsers');
    extractedInfo.push('User types/roles mentioned');
  }

  if (lowerResponse.includes('workflow') || lowerResponse.includes('process') ||
    lowerResponse.includes('step') || lowerResponse.match(/first.*then.*finally/i)) {
    topicsCovered.push('userWorkflows');
    extractedInfo.push('Workflow/process details provided');
  }

  if (lowerResponse.includes('integrate') || lowerResponse.includes('api') ||
    lowerResponse.includes('platform') || lowerResponse.includes('system') ||
    lowerResponse.includes('database')) {
    topicsCovered.push('technicalConstraints');
    extractedInfo.push('Technical requirements mentioned');
  }

  if (lowerResponse.includes('performance') || lowerResponse.includes('security') ||
    lowerResponse.includes('scale') || lowerResponse.includes('fast') ||
    lowerResponse.includes('secure')) {
    topicsCovered.push('nonFunctionalRequirements');
    extractedInfo.push('Non-functional requirements mentioned');
  }

  if (lowerResponse.includes('metric') || lowerResponse.includes('measure') ||
    lowerResponse.includes('success') || lowerResponse.includes('kpi') ||
    lowerResponse.includes('%') || lowerResponse.includes('increase') ||
    lowerResponse.includes('reduce')) {
    topicsCovered.push('successMetrics');
    extractedInfo.push('Success metrics mentioned');
  }

  if (lowerResponse.includes('not include') || lowerResponse.includes('out of scope') ||
    lowerResponse.includes('future phase') || lowerResponse.includes('later')) {
    topicsCovered.push('scopeBoundaries');
    extractedInfo.push('Scope boundaries mentioned');
  }

  return {
    userMessage: response,
    extractedInfo,
    topicsCovered,
    timestamp: Date.now()
  };
}

/**
 * Build comprehensive question history with responses
 */
function buildQuestionHistory(
  askedQuestions: string[],
  conversationHistory: Array<{ role: string; content: string }>
): QuestionHistory[] {
  const history: QuestionHistory[] = [];

  conversationHistory.forEach((msg, index) => {
    if (msg.role === 'assistant' && msg.content.includes('?')) {
      const question = msg.content;
      const userResponse = conversationHistory[index + 1]?.role === 'user'
        ? conversationHistory[index + 1].content
        : undefined;

      history.push({
        question,
        category: categorizeQuestion(question),
        keywords: extractKeywords(question),
        userResponse,
        infoExtracted: userResponse ? analyzeUserResponse(userResponse, {} as any).extractedInfo : undefined
      });
    }
  });

  return history;
}

/**
 * Advanced conversation context analysis
 */
function analyzeConversationContext(
  conversationHistory: Array<{ role: string; content: string }>,
  capturedRequirements: RequirementsContext,
  askedQuestions: string[]
): ConversationState {

  const userResponses = conversationHistory.filter(m => m.role === "user");
  const responseHistory: ResponseAnalysis[] = userResponses.map(r =>
    analyzeUserResponse(r.content, capturedRequirements)
  );

  // Assess category completeness with quality thresholds
  const categoryCompleteness = {
    businessGoals: (capturedRequirements.businessGoals?.length || 0) >= 1,
    keyFeatures: (capturedRequirements.keyFeatures?.length || 0) >= 2,
    targetUsers: (capturedRequirements.targetUsers?.length || 0) >= 1,
    functionalRequirements: (capturedRequirements.functionalRequirements?.length || 0) >= 2,
    technicalConstraints: (capturedRequirements.technicalConstraints?.length || 0) >= 1,
    nonFunctionalRequirements: (capturedRequirements.nonFunctionalRequirements?.length || 0) >= 1,
    successMetrics: (capturedRequirements.successMetrics?.length || 0) >= 1,
    userWorkflows: (capturedRequirements.userWorkflows?.length || 0) >= 1,
    integrations: true, // Optional
    scopeBoundaries: (capturedRequirements.scopeBoundaries?.inScope?.length || 0) > 0
  };

  // Identify uncovered and weak categories
  const uncoveredCategories: string[] = [];
  const weakCategories: string[] = [];

  Object.entries(categoryCompleteness).forEach(([category, isComplete]) => {
    if (!isComplete) {
      const count = Array.isArray(capturedRequirements[category as keyof RequirementsContext])
        ? (capturedRequirements[category as keyof RequirementsContext] as any[]).length
        : 0;

      if (count === 0) {
        uncoveredCategories.push(category);
      } else {
        weakCategories.push(category);
      }
    }
  });

  // Track questions asked per category
  const categoryCoverage: Record<string, number> = {};
  const questionHistory = buildQuestionHistory(askedQuestions, conversationHistory);

  questionHistory.forEach(qh => {
    categoryCoverage[qh.category] = (categoryCoverage[qh.category] || 0) + 1;
  });

  // Determine current focus
  const lastQuestionCategory = questionHistory[questionHistory.length - 1]?.category || 'understanding';
  const currentFocus = lastQuestionCategory;

  // Calculate depth on current topic (last 3 questions)
  const recentCategories = questionHistory.slice(-3).map(qh => qh.category);
  const depthLevel = recentCategories.filter(cat => cat === currentFocus).length;

  // Check what topics were covered in recent user responses
  const recentResponseTopics = responseHistory.slice(-3).flatMap(r => r.topicsCovered);
  const topicsDiscussedRecently = new Set(recentResponseTopics);

  // Force topic switch if:
  // 1. Asked 3+ questions on same category
  // 2. Category already has good information
  // 3. There are uncovered categories
  // 4. User's recent responses covered multiple topics (comprehensive answer)
  const shouldSwitchTopic =
    (depthLevel >= 3 && uncoveredCategories.length > 0) ||
    (depthLevel >= 2 && categoryCompleteness[currentFocus as keyof typeof categoryCompleteness] && uncoveredCategories.length > 0) ||
    (categoryCoverage[currentFocus] >= 3) || // Max 3 questions per category
    (topicsDiscussedRecently.size >= 3 && uncoveredCategories.length > 0); // User gave comprehensive answer

  // Determine if last topic is exhausted
  const lastUserMessage = userResponses[userResponses.length - 1]?.content || "";
  const lastTopicExhausted =
    lastUserMessage.toLowerCase().includes("that's all") ||
    lastUserMessage.toLowerCase().includes("nothing else") ||
    lastUserMessage.toLowerCase().includes("that's it") ||
    (lastUserMessage.trim().toLowerCase() === "no" && questionHistory[questionHistory.length - 1]?.question.toLowerCase().includes("anything else"));

  // Priority-based next topic suggestions
  const suggestedNextTopics: string[] = [];

  // Priority 1: Critical uncovered categories
  if (uncoveredCategories.includes('businessGoals')) suggestedNextTopics.push('businessGoals');
  if (uncoveredCategories.includes('targetUsers')) suggestedNextTopics.push('targetUsers');
  if (uncoveredCategories.includes('keyFeatures')) suggestedNextTopics.push('keyFeatures');

  // Priority 2: Weak categories
  weakCategories.forEach(cat => {
    if (!suggestedNextTopics.includes(cat)) {
      suggestedNextTopics.push(cat);
    }
  });

  // Priority 3: Other uncovered
  uncoveredCategories.forEach(cat => {
    if (!suggestedNextTopics.includes(cat)) {
      suggestedNextTopics.push(cat);
    }
  });

  // Priority 4: Low coverage categories (asked <2 questions)
  Object.entries(categoryCoverage)
    .filter(([cat, count]) => count < 2 && !uncoveredCategories.includes(cat))
    .forEach(([cat]) => {
      if (!suggestedNextTopics.includes(cat)) {
        suggestedNextTopics.push(cat);
      }
    });

  return {
    currentFocus,
    depthLevel,
    lastTopicExhausted,
    suggestedNextTopics,
    categoryCoverage,
    shouldSwitchTopic,
    responseHistory
  };
}

export async function generateWorkflowConversationQuestion(
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  capturedRequirements: RequirementsContext,
  currentPhase: string,
  askedQuestions: string[] = [],
  complianceGuidelines: any[] = [],
  isRegenerating: boolean = false,
  originalRequirement: string = "",
  processedFileRequirements: string | null = null,
  filesJustProcessed: boolean = false,
  attachedBrdId: string | null = null
): Promise<{
  question: string;
  phase: string;
  quickReplies?: string[];
  singleSelect?: boolean;
  capturedInfo?: RequirementsContext;
  readyToGenerate?: boolean;
  suggestedFollowUps?: string[];
}> {
  try {
    const windowedHistory = windowConversationHistory(conversationHistory, 10);
    console.log("[Workflow AI] === COMPREHENSIVE ANALYSIS v3.0 ===");
    console.log("[Workflow AI] Questions asked:", askedQuestions.length);
    console.log("[Workflow AI] Conversation depth:", conversationHistory.length, "(sending last", windowedHistory.length, "messages to LLM)");
    console.log("[Workflow AI] Files just processed:", filesJustProcessed);
    console.log("[Workflow AI] Attached BRD ID:", attachedBrdId);
    console.log("[Workflow AI] Processed file requirements available:", !!processedFileRequirements);
    if (processedFileRequirements) {
      console.log("[Workflow AI] BRD content length:", processedFileRequirements.length);
      console.log("[Workflow AI] BRD content preview:", processedFileRequirements.substring(0, 200) + "...");
    }

    // Log if processed file requirements are available
    if (processedFileRequirements) {
      console.log("[Workflow AI] ✅ BRD CONTENT WILL BE INCLUDED IN AI PROMPT");
    } else {
      console.log("[Workflow AI] ❌ NO BRD CONTENT - AI will ask generic questions");
    }

    // Define lastUserMessage and lastAIMessage early - needed for various checks
    const lastUserMessage = conversationHistory[conversationHistory.length - 1]?.content || "";
    const lastAIMessage = conversationHistory
      .slice()
      .reverse()
      .find(m => m.role === 'assistant')?.content || "";

    console.log("[Workflow AI] Last user message:", lastUserMessage.substring(0, 100));
    console.log("[Workflow AI] Last AI message:", lastAIMessage.substring(0, 100));

    // ========== PROCESSED FILE REQUIREMENTS ABSOLUTE PRIORITY ==========
    // This check MUST happen BEFORE any other conversation logic
    // If files were just processed, we MUST acknowledge them first, no exceptions
    // If file requirements were processed in THIS request, ALWAYS acknowledge them first
    // This takes absolute priority over any other conversation flow
    if (filesJustProcessed && processedFileRequirements && processedFileRequirements.trim().length > 0) {
      console.log("[Workflow AI] Files just processed in this request - prioritizing file acknowledgment");
      console.log("[Workflow AI] Processed file requirements length:", processedFileRequirements.length);

      // Check if user already wants to generate (explicit command or quick reply)
      const explicitGenerationCommands = /(?:^|\s)(generate|create|build|make)\s+(?:the\s+)?(artifacts?|epics?|features?|stories|backlog)|^generate\s*$|^ready$/i;
      const userWantsToGenerateNow = lastUserMessage && (
        explicitGenerationCommands.test(lastUserMessage.trim()) ||
        lastUserMessage.toLowerCase().includes("yes, generate") ||
        lastUserMessage.toLowerCase() === "yes" ||
        lastUserMessage.toLowerCase().includes("generate artifacts")
      );

      if (userWantsToGenerateNow) {
        // User wants to generate - proceed immediately
        console.log("[Workflow AI] User confirmed generation after file processing");
        return {
          question: "Perfect! I've processed your uploaded file and extracted the functional requirements. I'm now generating comprehensive Epics, Features, and User Stories with detailed acceptance criteria.\n\nThis may take 30-60 seconds...",
          phase: "artifacts",
          quickReplies: [],
          readyToGenerate: true,
          capturedInfo: capturedRequirements,
        };
      }

      // This is the FIRST response after file processing - always acknowledge and offer to generate
      // Don't ask any other questions, just acknowledge the processed file
      console.log("[Workflow AI] First response after file processing - acknowledging and offering artifact generation");
      return {
        question: `✅ File Processed Successfully!\n\nI've analyzed your uploaded document.\n\nWould you like me to generate Epics, Features, and User Stories now?`,
        phase: "artifacts",
        quickReplies: [
          "Yes, generate artifacts",
          "Let me review first",
          "Add more requirements"
        ],
        singleSelect: false,
        capturedInfo: capturedRequirements,
        readyToGenerate: false,
      };
    }

    // If processed file requirements exist but weren't just processed (from previous request),
    // check if user is responding to the file processing acknowledgment
    if (processedFileRequirements && processedFileRequirements.trim().length > 0 && !filesJustProcessed) {
      console.log("[Workflow AI] Processed file requirements exist from previous request");

      // Check if user wants to generate after seeing the file processing acknowledgment
      const explicitGenerationCommands = /(?:^|\s)(generate|create|build|make)\s+(?:the\s+)?(artifacts?|epics?|features?|stories|backlog)|^generate\s*$|^ready$|generate.*directly/i;
      const userWantsToGenerateNow = lastUserMessage && (
        explicitGenerationCommands.test(lastUserMessage.trim()) ||
        lastUserMessage.toLowerCase().includes("yes, generate") ||
        lastUserMessage.toLowerCase() === "yes" ||
        lastUserMessage.toLowerCase().includes("generate artifacts") ||
        lastUserMessage.toLowerCase().includes("generate directly") ||
        // Handle "no im good" + generate variations
        (lastUserMessage.toLowerCase().includes("im good") && lastUserMessage.toLowerCase().includes("generate")) ||
        (lastUserMessage.toLowerCase().includes("i'm good") && lastUserMessage.toLowerCase().includes("generate")) ||
        (lastUserMessage.toLowerCase().includes("no") && lastUserMessage.toLowerCase().includes("generate")) ||
        // Handle "pls/please" variations
        (lastUserMessage.toLowerCase().includes("pls") && lastUserMessage.toLowerCase().includes("generate")) ||
        (lastUserMessage.toLowerCase().includes("please") && lastUserMessage.toLowerCase().includes("generate")) ||
        // Regex patterns
        /^no.*(generate|create|build)\s*(artifacts?|directly|now)?/i.test(lastUserMessage.trim()) ||
        /(im|i'm)\s+good.*(generate|create|build)/i.test(lastUserMessage.trim())
      );

      if (userWantsToGenerateNow) {
        console.log("[Workflow AI] User confirmed generation after file processing");
        return {
          question: "Perfect! I've processed your uploaded file and extracted the functional requirements. I'm now generating comprehensive Epics, Features, and User Stories with detailed acceptance criteria.\n\nThis may take 30-60 seconds...",
          phase: "artifacts",
          quickReplies: [],
          readyToGenerate: true,
          capturedInfo: capturedRequirements,
        };
      }
    }

    // ========== EXPLICIT GENERATION COMMAND ==========
    const explicitGenerationCommands = /(?:^|\s)(generate|create|build|make)\s+(?:the\s+)?(artifacts?|epics?|features?|stories|backlog)|^generate\s*$|^ready$|generate.*directly/i;

    // Enhanced detection for various user phrases indicating they want to generate
    const userWantsToGenerateNow = lastUserMessage && (
      explicitGenerationCommands.test(lastUserMessage.trim()) ||
      // Direct generation requests
      lastUserMessage.toLowerCase().includes("generate artifacts") ||
      lastUserMessage.toLowerCase().includes("generate directly") ||
      // Handle "no im good" + generate variations
      (lastUserMessage.toLowerCase().includes("im good") && lastUserMessage.toLowerCase().includes("generate")) ||
      (lastUserMessage.toLowerCase().includes("i'm good") && lastUserMessage.toLowerCase().includes("generate")) ||
      (lastUserMessage.toLowerCase().includes("no") && lastUserMessage.toLowerCase().includes("generate")) ||
      // Handle "pls/please" variations
      (lastUserMessage.toLowerCase().includes("pls") && lastUserMessage.toLowerCase().includes("generate")) ||
      (lastUserMessage.toLowerCase().includes("please") && lastUserMessage.toLowerCase().includes("generate")) ||
      // Regex patterns for complex phrases
      /^no.*(generate|create|build)\s*(artifacts?|directly|now)?/i.test(lastUserMessage.trim()) ||
      /(im|i'm)\s+good.*(generate|create|build)/i.test(lastUserMessage.trim())
    );

    if (userWantsToGenerateNow) {
      const hasMinimumInfo =
        (capturedRequirements.businessGoals?.length || 0) > 0 ||
        (capturedRequirements.keyFeatures?.length || 0) > 0;

      if (hasMinimumInfo || conversationHistory.length > 4) {
        return {
          question: "Perfect! I'm now generating comprehensive Epics, Features, and User Stories with detailed acceptance criteria and subtasks.\n\nThis may take 30-60 seconds...",
          phase: "artifacts",
          quickReplies: [],
          readyToGenerate: true,
          capturedInfo: capturedRequirements,
        };
      }
    }

    // ========== EXPLICIT GENERATION COMMAND (HIGH PRIORITY) ==========
    // Check this FIRST before any mode-specific logic to ensure generation triggers are always caught
    // Note: Variables already declared earlier - this comment block preserves context

    if (userWantsToGenerateNow) {
      console.log("[Workflow AI] EXPLICIT GENERATION COMMAND DETECTED:", lastUserMessage);
      const hasMinimumInfo =
        (capturedRequirements.businessGoals?.length || 0) > 0 ||
        (capturedRequirements.keyFeatures?.length || 0) > 0;

      if (hasMinimumInfo || conversationHistory.length > 4) {
        return {
          question: "Perfect! I'm now generating comprehensive Epics, Features, and User Stories with detailed acceptance criteria and subtasks.\n\nThis may take 30-60 seconds...",
          phase: "artifacts",
          quickReplies: [],
          readyToGenerate: true,
          capturedInfo: capturedRequirements,
        };
      }
    }

    // ========== GREETING DETECTION ==========
    const isEarlyInConversation = conversationHistory.length <= 2;
    const isGreeting = isGreetingMessage(lastUserMessage);

    if (isEarlyInConversation && isGreeting) {
      return {
        question: "Hello! 👋 I'm your AI Business Analyst assistant specialized in capturing enterprise requirements.\n\nI'll help you create high-quality Epics, Features, and User Stories for Azure DevOps.\n\n**Let's start - what project or capability are you looking to build?**",
        phase: "understanding",
        quickReplies: [
          "Building a new web application",
          "Enhancing an existing system",
          "Creating a mobile app",
          "Integrating multiple systems"
        ],
        capturedInfo: capturedRequirements,
        readyToGenerate: false,
      };
    }

    // ========== REGENERATION DETECTION ==========
    // If user is regenerating artifacts and has provided original requirement context
    if (isRegenerating && originalRequirement && conversationHistory.length <= 3) {
      console.log("[Workflow AI] Regeneration mode detected");
      console.log("[Workflow AI] Original requirement:", originalRequirement.substring(0, 100) + "...");

      // The frontend should already show the regeneration message with choices
      // If user has responded, check their choice
      if (conversationHistory.length >= 2) {
        const userResponse = lastUserMessage.toLowerCase();

        // If they chose to proceed as-is, extract from original and continue
        if (userResponse.includes("proceed") || userResponse.includes("as-is")) {
          const extractedReqs = extractRequirementsFromMessage(originalRequirement, capturedRequirements);
          console.log("[Workflow AI] User chose to proceed with original requirement");

          // Continue with first question based on extracted requirements
          // (will be handled by the normal flow below)
        } else if (userResponse.includes("modify")) {
          console.log("[Workflow AI] User wants to modify the requirement");
          // Frontend handles this - just acknowledge we're ready for their input
        }
      }
    }

    // ========== MODE SELECTION AFTER FIRST SUBSTANTIVE INPUT ==========
    // After greeting, when user provides first substantive message, offer mode selection
    const userMessageCount = conversationHistory.filter(m => m.role === 'user').length;
    const aiMessageCount = conversationHistory.filter(m => m.role === 'assistant').length;

    // Count how many substantive (non-greeting) messages the user has sent
    const userSubstantiveMessages = conversationHistory
      .filter(m => m.role === 'user')
      .filter(m => !isGreetingMessage(m.content) && isSubstantiveMessage(m.content));

    // Check if this is the FIRST substantive user message
    // (regardless of how many greeting exchanges happened before)
    const isFirstSubstantiveMessage =
      userSubstantiveMessages.length === 1 &&
      !isGreeting &&
      isSubstantiveMessage(lastUserMessage);


    // Early validation check for invalid input
    if (isInvalidInput(lastUserMessage)) {
      console.log("[Workflow AI] Invalid input detected:", lastUserMessage);
      return {
        message: "I notice your input seems incomplete or unclear. Could you please provide more details about your project? For example:\n\n• What type of application are you building?\n• Who will be using it?\n• What problems should it solve?\n\nThis will help me understand your requirements better and provide more accurate assistance.",
        phase: conversationState.currentPhase || 'initial' as ConversationPhase,
        capturedRequirements,
        quickReplies: [
          "Building a web application",
          "Creating a mobile app",
          "System integration project",
          "Enhancing existing software"
        ],
        suggestedQuestions: [],
        isComplete: false,
      };
    }

    // Check if user is selecting a mode
    const isModeSelection =
      lastUserMessage.toLowerCase().includes('guide me') ||
      lastUserMessage.toLowerCase().includes('option 1') ||
      lastUserMessage.toLowerCase().includes('generate directly') ||
      lastUserMessage.toLowerCase().includes('option 2') ||
      lastUserMessage.toLowerCase().includes('intelligent generation') ||
      lastUserMessage.toLowerCase().includes('skip questions');

    if (isFirstSubstantiveMessage && !isModeSelection) {
      console.log("[Workflow AI] Triggering mode selection");
      // Extract requirements from the first substantive message
      const extractedReqs = extractRequirementsFromMessage(lastUserMessage, capturedRequirements);
      const mergedReqs: RequirementsContext = {
        businessGoals: [...(capturedRequirements.businessGoals || []), ...(extractedReqs.businessGoals || [])],
        keyFeatures: [...(capturedRequirements.keyFeatures || []), ...(extractedReqs.keyFeatures || [])],
        targetUsers: [...(capturedRequirements.targetUsers || []), ...(extractedReqs.targetUsers || [])],
        functionalRequirements: [...(capturedRequirements.functionalRequirements || []), ...(extractedReqs.functionalRequirements || [])],
        technicalConstraints: [...(capturedRequirements.technicalConstraints || []), ...(extractedReqs.technicalConstraints || [])],
        nonFunctionalRequirements: [...(capturedRequirements.nonFunctionalRequirements || []), ...(extractedReqs.nonFunctionalRequirements || [])],
        successMetrics: [...(capturedRequirements.successMetrics || []), ...(extractedReqs.successMetrics || [])],
        userWorkflows: [...(capturedRequirements.userWorkflows || []), ...(extractedReqs.userWorkflows || [])],
        integrations: [...(capturedRequirements.integrations || []), ...(extractedReqs.integrations || [])],
        scopeBoundaries: {
          inScope: [...(capturedRequirements.scopeBoundaries?.inScope || []), ...(extractedReqs.scopeBoundaries?.inScope || [])],
          outOfScope: [...(capturedRequirements.scopeBoundaries?.outOfScope || []), ...(extractedReqs.scopeBoundaries?.outOfScope || [])]
        }
      };

      // Assess content richness
      const richness = assessContentRichness(mergedReqs, lastUserMessage);

      console.log("[Workflow AI] First substantive input detected");
      console.log("[Workflow AI] Content richness score:", richness.score);
      console.log("[Workflow AI] Strengths:", richness.strengths);
      console.log("[Workflow AI] Gaps:", richness.gaps);

      // Build the mode selection response
      let modeSelectionMessage = "Great! I've analyzed your requirements and identified:\n\n";

      if (richness.strengths.length > 0) {
        modeSelectionMessage += "**✅ What I captured:**\n";
        richness.strengths.forEach(strength => {
          modeSelectionMessage += `- ${strength}\n`;
        });
        modeSelectionMessage += "\n";
      }

      if (richness.gaps.length > 0 && richness.gaps.length <= 3) {
        modeSelectionMessage += "**💡 Areas that could be enhanced:**\n";
        richness.gaps.forEach(gap => {
          modeSelectionMessage += `- ${gap}\n`;
        });
        modeSelectionMessage += "\n";
      }

      modeSelectionMessage += "**How would you like to proceed?**\n\n";
      modeSelectionMessage += "**Option 1: Guide me through questions** 🎯\n";
      modeSelectionMessage += "I'll ask detailed, context-aware questions to gather comprehensive requirements step-by-step.\n\n";
      modeSelectionMessage += "**Option 2: Generate artifacts directly** 🚀\n";

      if (richness.hasMinimumForGeneration) {
        modeSelectionMessage += "I'll analyze your requirements and generate complete artifacts with:\n";
        modeSelectionMessage += "- **Intelligent inference** for implicit requirements and missing details\n";
        modeSelectionMessage += "- **Industry best practices** applied based on your domain\n";
        modeSelectionMessage += "- **SMART criteria** ensuring specificity, measurability, and testability\n";
        modeSelectionMessage += "- **Complete user journeys** including edge cases and non-functional requirements\n";
        modeSelectionMessage += "- **Clear priorities** based on business value and dependencies\n\n";
        modeSelectionMessage += "You can review and refine afterward.";
      } else {
        modeSelectionMessage += "I'll use AI intelligence to create artifacts with:\n";
        modeSelectionMessage += "- **Smart assumptions** based on industry standards and domain expertise\n";
        modeSelectionMessage += "- **Inferred technical constraints** and scalability considerations\n";
        modeSelectionMessage += "- **Complete acceptance criteria** with testable, measurable conditions\n";
        modeSelectionMessage += "- **Non-functional requirements** for security, performance, and accessibility\n\n";
        modeSelectionMessage += "You can review and refine afterward.";
      }

      return {
        question: modeSelectionMessage,
        phase: "mode-selection",
        quickReplies: [
          "Option 1: Guide me through questions",
          "Option 2: Generate artifacts directly"
        ],
        singleSelect: true, // Force single selection for mode choice
        capturedInfo: mergedReqs,
        readyToGenerate: false,
      };
    }

    // ========== HANDLE MODE SELECTION ==========
    // Check if user is responding to mode selection
    // The previous AI message should have phase "mode-selection" or contain mode selection options
    const previousAIMessage = conversationHistory
      .slice()
      .reverse()
      .find(m => m.role === 'assistant');

    const previousWasModeSelection =
      previousAIMessage?.content.includes('Option 1:') &&
      previousAIMessage?.content.includes('Option 2:') &&
      previousAIMessage?.content.includes('How would you like to proceed?');

    const isRespondingToModeSelection = previousWasModeSelection && isModeSelection;

    if (isRespondingToModeSelection) {
      const wantsGuidedMode =
        lastUserMessage.toLowerCase().includes('option 1') ||
        lastUserMessage.toLowerCase().includes('guide me') ||
        lastUserMessage.toLowerCase().includes('ask questions') ||
        lastUserMessage.toLowerCase().includes('step by step');

      const wantsIntelligentMode =
        lastUserMessage.toLowerCase().includes('option 2') ||
        lastUserMessage.toLowerCase().includes('generate directly') ||
        lastUserMessage.toLowerCase().includes('intelligent generation') ||
        lastUserMessage.toLowerCase().includes('skip questions') ||
        lastUserMessage.toLowerCase().includes('generate now');

      if (wantsIntelligentMode) {
        // User selected intelligent generation mode
        console.log("[Workflow AI] User selected intelligent generation mode");

        const richness = assessContentRichness(capturedRequirements, lastUserMessage);

        if (richness.score >= 30) {
          return {
            question: "Perfect! I'm now analyzing your requirements and generating comprehensive Epics, Features, and User Stories with:\n\n✨ Detailed acceptance criteria using Enhanced Given-When-Then format\n✨ Smart inferences for any gaps based on industry best practices\n✨ Complete task breakdowns with proper estimation\n\n**This may take 30-60 seconds...**",
            phase: "artifacts",
            quickReplies: [],
            readyToGenerate: true,
            capturedInfo: capturedRequirements,
          };
        } else {
          // Minimal info provided, but user wants to proceed
          return {
            question: "Understood! I'll generate artifacts based on your input and apply intelligent assumptions where needed.\n\n**Generating comprehensive backlog items...**\n\nThis may take 30-60 seconds.",
            phase: "artifacts",
            quickReplies: [],
            readyToGenerate: true,
            capturedInfo: capturedRequirements,
          };
        }
      } else if (wantsGuidedMode) {
        // User selected guided mode - generate AI-based questions from BRD content
        console.log("[Workflow AI] User selected guided mode - generating BRD-based AI questions");

        // If we have BRD content, use AI to generate contextual questions
        if (processedFileRequirements && attachedBrdId) {
          console.log("[Workflow AI] Generating AI questions based on BRD content...");

          try {
            const brdBasedPrompt = `
**TASK:** Generate ONE insightful clarifying question based on the attached BRD content.

**BRD CONTENT:**
${processedFileRequirements.substring(0, 4000)}

**INSTRUCTIONS:**
- Analyze the BRD content thoroughly to understand what's already specified
- Generate ONE specific, actionable question that would help clarify or enhance the requirements
- Focus on areas that might need more detail (user scenarios, technical constraints, business goals, acceptance criteria)
- Be conversational and reference specific aspects from the BRD
- The question should help improve the quality of the final artifacts

**EXAMPLE OUTPUTS:**
- "I noticed the BRD mentions user authentication - what specific authentication methods should be supported (social login, enterprise SSO, multi-factor authentication)?"
- "The business goals mention improving efficiency by 30% - what specific metrics will you use to measure this improvement?"
- "I see several user personas mentioned - which persona should we prioritize for the initial release?"

Generate ONE question only:`;

            const aiResponse = await anthropic.messages.create({
              model: 'claude-3-sonnet-20240229',
              max_tokens: 150,
              temperature: 0.7,
              messages: [
                {
                  role: 'user',
                  content: brdBasedPrompt
                }
              ]
            });

            const aiQuestion = aiResponse.content[0]?.text?.trim();

            if (aiQuestion) {
              console.log("[Workflow AI] Generated AI question from BRD:", aiQuestion);
              return {
                question: `Great! I'll guide you through detailed questions to clarify and enhance your requirements.\n\n**📋 Based on your BRD, here's my first question:**\n\n${aiQuestion}`,
                phase: "guided-clarification",
                quickReplies: [
                  "That looks good, ask me more",
                  "Let me clarify that section",
                  "I need to add more details",
                  "Move to the next area",
                  "No, I'm good - generate artifacts directly"
                ],
                singleSelect: false,
                capturedInfo: capturedRequirements,
                readyToGenerate: false,
              };
            }
          } catch (error) {
            console.error("[Workflow AI] Error generating BRD-based question:", error);
            // Fall through to generic fallback
          }
        }

        // Fallback: Generic guided mode question when no BRD or AI generation fails
        let brdContext = "";
        if (attachedBrdId) {
          brdContext = `\n\n**📋 BRD Context:** I see you've attached BRD (ID: ${attachedBrdId}). I'll ask clarifying questions based on your BRD content.`;
        }

        return {
          question: `Great! I'll guide you through detailed questions to clarify and enhance your requirements.${brdContext}\n\n**Let's start with this:** Are there any particular sections or requirements that need more detail or clarification before we proceed?\n\nFor example:\n• Any business objectives that need refinement?\n• Specific user scenarios that require elaboration?\n• Technical constraints or assumptions to clarify?\n• Success criteria that need more definition?`,
          phase: "guided-clarification",
          quickReplies: [
            "Business objectives need clarification",
            "User scenarios need more detail",
            "Technical constraints to discuss",
            "Success criteria refinement",
            "All sections look comprehensive"
          ],
          singleSelect: false,
          capturedInfo: capturedRequirements,
          readyToGenerate: false,
        };
      } else {
        // Unclear selection, ask again
        return {
          question: "I didn't quite catch that. Please choose one of these options:\n\n**Option 1:** Guide me through detailed questions\n**Option 2:** Generate artifacts directly with intelligent assumptions\n\nWhich would you prefer?",
          phase: "mode-selection",
          quickReplies: [
            "Option 1: Guide me through questions",
            "Option 2: Generate artifacts directly"
          ],
          singleSelect: true, // Force single selection for mode choice
          capturedInfo: capturedRequirements,
          readyToGenerate: false,
        };
      }
    }

    // ========== GENERATION CONFIRMATION ==========
    const previousAskedAboutGeneration =
      lastAIMessage.toLowerCase().includes("would you like me to generate") ||
      lastAIMessage.toLowerCase().includes("proceed with") ||
      lastAIMessage.toLowerCase().includes("ready to generate");

    const isSimpleAffirmative = /^\s*(yes|yep|yeah|sure|okay|ok|please|go ahead|proceed|generate|let's go)[\s,!.?]*$/i.test(lastUserMessage.trim());

    const userConfirmedGeneration = previousAskedAboutGeneration && isSimpleAffirmative;

    if (userConfirmedGeneration) {
      return {
        question: "Perfect! Generating comprehensive artifacts with detailed acceptance criteria following Enhanced Given-When-Then format...\n\nThis may take 30-60 seconds.",
        phase: "artifacts",
        quickReplies: [],
        readyToGenerate: true,
        capturedInfo: capturedRequirements,
      };
    }

    // ========== GUIDED CLARIFICATION MODE HANDLING ==========
    // Handle when user is in guided clarification mode (selected "Option 1: Guide me through questions")
    // Continue asking questions until user explicitly requests artifact generation
    const isInGuidedMode = currentPhase === "guided-clarification";

    // Check if user wants to generate artifacts directly from guided mode
    const userWantsToGenerate =
      lastUserMessage.toLowerCase().includes("generate artifacts directly") ||
      lastUserMessage.toLowerCase().includes("generate artifacts") ||
      lastUserMessage.toLowerCase().includes("generate directly") ||
      lastUserMessage.toLowerCase().includes("ready to generate") ||
      lastUserMessage.toLowerCase().includes("generate now") ||
      lastUserMessage.toLowerCase().includes("proceed with generation") ||
      // Handle variations like "no im good pls generate artifacts directly"
      (lastUserMessage.toLowerCase().includes("im good") && lastUserMessage.toLowerCase().includes("generate")) ||
      (lastUserMessage.toLowerCase().includes("i'm good") && lastUserMessage.toLowerCase().includes("generate")) ||
      (lastUserMessage.toLowerCase().includes("no") && lastUserMessage.toLowerCase().includes("generate artifacts")) ||
      (lastUserMessage.toLowerCase().includes("no") && lastUserMessage.toLowerCase().includes("generate directly")) ||
      // Handle "pls/please generate" variations
      (lastUserMessage.toLowerCase().includes("pls") && lastUserMessage.toLowerCase().includes("generate")) ||
      (lastUserMessage.toLowerCase().includes("please") && lastUserMessage.toLowerCase().includes("generate")) ||
      // Regex patterns for standalone generate commands
      /^generate\s*(artifacts?|directly)?\s*$/i.test(lastUserMessage.trim()) ||
      // Pattern for "no [something] generate [artifacts]"
      /^no.*(generate|create|build)\s*(artifacts?|directly|now)?/i.test(lastUserMessage.trim()) ||
      // Pattern for "im/i'm good [something] generate"
      /(im|i'm)\s+good.*(generate|create|build)/i.test(lastUserMessage.trim());

    if (isInGuidedMode && userWantsToGenerate) {
      console.log("[Workflow AI] User requested artifact generation from guided mode");
      return {
        question: "Perfect! I've gathered your clarifications and I'm now generating comprehensive Epics, Features, and User Stories based on your BRD and additional details.\n\n**This may take 30-60 seconds...**",
        phase: "artifacts",
        quickReplies: [],
        readyToGenerate: true,
        capturedInfo: capturedRequirements,
      };
    }

    if (isInGuidedMode) {
      console.log("[Workflow AI] In guided clarification mode - asking follow-up questions");

      // Extract any new information from user response
      const extractedReqs = extractRequirementsFromMessage(lastUserMessage, capturedRequirements);
      const mergedReqs: RequirementsContext = {
        businessGoals: [...(capturedRequirements.businessGoals || []), ...(extractedReqs.businessGoals || [])],
        keyFeatures: [...(capturedRequirements.keyFeatures || []), ...(extractedReqs.keyFeatures || [])],
        targetUsers: [...(capturedRequirements.targetUsers || []), ...(extractedReqs.targetUsers || [])],
        functionalRequirements: [...(capturedRequirements.functionalRequirements || []), ...(extractedReqs.functionalRequirements || [])],
        technicalConstraints: [...(capturedRequirements.technicalConstraints || []), ...(extractedReqs.technicalConstraints || [])],
        nonFunctionalRequirements: [...(capturedRequirements.nonFunctionalRequirements || []), ...(extractedReqs.nonFunctionalRequirements || [])],
        successMetrics: [...(capturedRequirements.successMetrics || []), ...(extractedReqs.successMetrics || [])],
        userWorkflows: [...(capturedRequirements.userWorkflows || []), ...(extractedReqs.userWorkflows || [])],
        integrations: [...(capturedRequirements.integrations || []), ...(extractedReqs.integrations || [])],
        scopeBoundaries: {
          inScope: [...(capturedRequirements.scopeBoundaries?.inScope || []), ...(extractedReqs.scopeBoundaries?.inScope || [])],
          outOfScope: [...(capturedRequirements.scopeBoundaries?.outOfScope || []), ...(extractedReqs.scopeBoundaries?.outOfScope || [])]
        }
      };

      // Generate AI-based follow-up questions in guided mode
      if (processedFileRequirements && attachedBrdId) {
        console.log("[Workflow AI] Generating AI follow-up question based on BRD and conversation...");

        try {
          // Build context about what has been covered
          const conversationSummary = conversationHistory.slice(-6).map(msg => `${msg.role}: ${msg.content.substring(0, 300)}`).join('\n');
          const currentRequirementsContext = Object.entries(mergedReqs)
            .filter(([key, value]) => Array.isArray(value) && value.length > 0)
            .map(([key, value]) => `${key}: ${value.slice(0, 3).join(', ')}`)
            .join('\n');

          const aiFollowUpPrompt = `
**TASK:** Generate ONE insightful follow-up question for requirements clarification.

**BRD CONTENT (Reference):**
${processedFileRequirements.substring(0, 3000)}

**RECENT CONVERSATION:**
${conversationSummary}

**CURRENT CAPTURED REQUIREMENTS:**
${currentRequirementsContext || 'None captured yet'}

**INSTRUCTIONS:**
- Generate ONE specific, actionable follow-up question that builds on the conversation
- Focus on areas that need more detail or weren't fully addressed in the BRD
- Consider what requirements are still missing or incomplete
- Be conversational and reference the user's previous responses
- Prioritize: user personas, business goals, technical constraints, success metrics, workflows

**EXAMPLE OUTPUTS:**
- "You mentioned [specific detail] - could you walk me through how users would actually interact with that feature day-to-day?"
- "I see the BRD covers the main features, but what specific business metrics will tell you this solution is successful?"
- "Given what you've shared about users, what are the most critical pain points they face with current processes?"

Generate ONE question only:`;

          const aiResponse = await anthropic.messages.create({
            model: 'claude-3-sonnet-20240229',
            max_tokens: 150,
            temperature: 0.7,
            messages: [
              {
                role: 'user',
                content: aiFollowUpPrompt
              }
            ]
          });

          const aiFollowUpQuestion = aiResponse.content[0]?.text?.trim();

          if (aiFollowUpQuestion) {
            console.log("[Workflow AI] Generated AI follow-up question:", aiFollowUpQuestion);
            return {
              question: `Thank you for that clarification!\n\n${aiFollowUpQuestion}`,
              phase: "guided-clarification",
              quickReplies: [
                "Generate artifacts directly",
                "I need to clarify more details",
                "Let me think about that",
                "Ask about something else",
                "That's comprehensive enough"
              ],
              singleSelect: false,
              capturedInfo: mergedReqs,
              readyToGenerate: false,
            };
          }
        } catch (error) {
          console.error("[Workflow AI] Error generating AI follow-up question:", error);
          // Fall through to hardcoded fallback
        }
      }

      // Fallback: Select an appropriate follow-up question based on what hasn't been covered
      let nextQuestion = "Thank you for that clarification! ";

      // Intelligently pick next question based on gaps
      if (!mergedReqs.targetUsers?.length && !mergedReqs.userWorkflows?.length) {
        nextQuestion += "Could you elaborate on the key user personas or roles that will interact with this system? What are their primary goals and pain points?";
      } else if (!mergedReqs.successMetrics?.length) {
        nextQuestion += "What are the most critical business outcomes or success metrics you're trying to achieve? How will you measure success?";
      } else if (!mergedReqs.technicalConstraints?.length) {
        nextQuestion += "Are there any specific technical constraints, integrations, or existing systems that need to be considered?";
      } else if (!mergedReqs.nonFunctionalRequirements?.length) {
        nextQuestion += "What are the non-functional requirements around performance, security, accessibility, or scalability that are important for this solution?";
      } else {
        nextQuestion += "Is there anything else about your requirements that needs more detail or clarification? Any assumptions to validate or edge cases to consider?";
      }

      return {
        question: nextQuestion,
        phase: "guided-clarification",
        quickReplies: [
          "Generate artifacts directly",
          "I need to clarify more details",
          "Let me think about that"
        ],
        singleSelect: false,
        capturedInfo: mergedReqs,
        readyToGenerate: false,
      };
    }

    // ========== "ADD MORE" DETECTION ==========
    const userWantsToAddMore =
      lastUserMessage.toLowerCase().includes("i have more") ||
      lastUserMessage.toLowerCase().includes("more to add") ||
      lastUserMessage.toLowerCase().includes("add more") ||
      lastUserMessage.toLowerCase().includes("more details") ||
      lastUserMessage.toLowerCase().includes("i have more details");

    // ========== CATEGORY COMPLETENESS ==========
    const categoriesFilled = {
      businessGoals: (capturedRequirements.businessGoals?.length || 0) > 0,
      keyFeatures: (capturedRequirements.keyFeatures?.length || 0) >= 2,
      targetUsers: (capturedRequirements.targetUsers?.length || 0) > 0,
      functionalRequirements: (capturedRequirements.functionalRequirements?.length || 0) >= 2,
      technicalConstraints: (capturedRequirements.technicalConstraints?.length || 0) > 0,
      nonFunctionalRequirements: (capturedRequirements.nonFunctionalRequirements?.length || 0) > 0,
      successMetrics: (capturedRequirements.successMetrics?.length || 0) > 0,
      userWorkflows: (capturedRequirements.userWorkflows?.length || 0) > 0,
    };

    const categoriesFilledCount = Object.values(categoriesFilled).filter(Boolean).length;
    const totalCategories = Object.keys(categoriesFilled).length;

    // ========== IMPROVED STOPPING LOGIC ==========
    const hasGoodBreadth = categoriesFilledCount >= 5;
    const hasCriticalInfo =
      categoriesFilled.businessGoals &&
      (categoriesFilled.keyFeatures || categoriesFilled.functionalRequirements) &&
      (categoriesFilled.targetUsers || categoriesFilled.userWorkflows);

    const reasonableQuestionCount = askedQuestions.length >= 6 && askedQuestions.length < 12;
    const tooManyQuestions = askedQuestions.length >= 10;

    const userSaidNo = /^(no|nope|nah|not really|nothing else|that's all|that's it|i'?m good|all set)[\s,!.?]*$/i.test(lastUserMessage.trim());

    const shouldOfferGeneration =
      !userWantsToAddMore && (
        (tooManyQuestions && hasCriticalInfo) ||
        (reasonableQuestionCount && hasGoodBreadth) ||
        (categoriesFilledCount >= 6) ||
        (userSaidNo && hasCriticalInfo && askedQuestions.length >= 5)
      );

    if (shouldOfferGeneration) {
      console.log("[Workflow AI] Offering generation");

      const filledCategories = Object.entries(categoriesFilled)
        .filter(([_, v]) => v)
        .map(([k]) => k.replace(/([A-Z])/g, ' $1').trim());

      return {
        question: `Excellent! I've gathered solid requirements across ${categoriesFilledCount} key areas:\n\n✅ ${filledCategories.join('\n✅ ')}\n\nI have enough information to generate high-quality Epics, Features, and User Stories with detailed acceptance criteria and subtasks.\n\n**Would you like me to proceed with artifact generation?**`,
        phase: currentPhase,
        quickReplies: ["Yes, generate artifacts now", "I have more details to add"],
        capturedInfo: capturedRequirements,
        readyToGenerate: false,
      };
    }

    // ========== BUILD COMPREHENSIVE SYSTEM PROMPT ==========

    // Analyze conversation context to understand current state
    const conversationState = analyzeConversationContext(
      conversationHistory,
      capturedRequirements,
      askedQuestions
    );

    const systemPrompt = `## Current Conversation Phase
The user has ${aiMessageCount <= 2 ? "JUST STARTED and may be selecting a mode" : "SELECTED GUIDED MODE - proceed with intelligent questioning"}

## COMPLETE CONVERSATION INTELLIGENCE

### Information Gathered So Far:
\`\`\`json
${JSON.stringify(capturedRequirements, null, 2)}
\`\`\`

### Conversation Analysis:
- **Questions Asked:** ${askedQuestions.length}
- **Categories Filled:** ${categoriesFilledCount}/${totalCategories}
- **Current Focus:** ${conversationState.currentFocus}
- **Depth on Current Topic:** ${conversationState.depthLevel}/3 ${conversationState.depthLevel >= 2 ? '⚠️ Consider switching topics' : ''}
- **Suggested Next Topics:** ${conversationState.suggestedNextTopics.slice(0, 3).join(', ')}

### Category Coverage Status:
${Object.entries(conversationState.categoryCoverage).map(([cat, count]) =>
      `- **${cat}:** ${count} question${count !== 1 ? 's' : ''} asked ${count >= 3 ? '🛑 LIMIT REACHED - SWITCH TOPICS' : count >= 2 ? '⚠️ Consider moving on' : '✅ Room for more'}`
    ).join('\n')}

### Questions Already Asked (ABSOLUTELY FORBIDDEN TO REPEAT):
${askedQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

(Attached BRD and compliance guidelines are in the static user context message.)

### User Response History Analysis:
${conversationState.responseHistory.slice(-3).map((r, i) => `
**Response ${conversationState.responseHistory.length - 2 + i}:**
- Topics covered: ${r.topicsCovered.join(', ') || 'General'}
- Info extracted: ${r.extractedInfo.join(', ') || 'None'}
- Content: "${r.userMessage.substring(0, 100)}${r.userMessage.length > 100 ? '...' : ''}"
`).join('\n')}

---

## 🚨 CRITICAL ANTI-REPETITION & CONTEXT AWARENESS RULES

### RULE #1: ABSOLUTE ZERO-TOLERANCE FOR DUPLICATE QUESTIONS
**You MUST check these before asking ANYTHING:**
- ✅ Is this question semantically similar to ANY already-asked question?
- ✅ Did user ALREADY provide this information in ANY previous response?
- ✅ Have I asked about this category ${conversationState.categoryCoverage[conversationState.currentFocus] || 0} times already?
- ✅ Did user mention this topic in their detailed responses?

**FORBIDDEN:**
- ❌ Rephrasing the same question differently
- ❌ Asking "from a different angle" about covered topics
- ❌ Asking sub-questions about topics user already explained comprehensively
- ❌ Drilling deeper when you already have sufficient info for that category

**Example of What NOT to do:**
- Already asked: "What are your business goals?"
- User answered: "We want to reduce manual data entry by 50% and improve accuracy"
- ❌ DON'T ask: "What problems are you trying to solve?" ← SAME CONCEPT
- ❌ DON'T ask: "What objectives drive this project?" ← SAME CONCEPT
- ✅ DO ask: "Who will be using this system primarily?" ← NEW CATEGORY

### RULE #2: READ AND UNDERSTAND ALL PREVIOUS USER RESPONSES
Review the conversation history in the messages below (do not ask again about topics already answered).

**⚠️ Before asking your next question, verify:**
- Did user already cover this in their responses above?
- Can I extract more from what they've already shared?
- Am I asking for NEW information or repeating?

### RULE #3: MANDATORY TOPIC SWITCHING
${conversationState.shouldSwitchTopic ? `
🚨 **CRITICAL: YOU MUST SWITCH TOPICS NOW!**
- Current topic (${conversationState.currentFocus}) depth: ${conversationState.depthLevel}/3
- Questions on this topic: ${conversationState.categoryCoverage[conversationState.currentFocus] || 0}
- **YOU CANNOT ask about ${conversationState.currentFocus} again**
- **MUST ask about:** ${conversationState.suggestedNextTopics.slice(0, 3).join(' OR ')}
` : `
✅ You may continue current line of questioning OR switch to: ${conversationState.suggestedNextTopics.slice(0, 3).join(', ')}
`}

### RULE #4: BREADTH BEFORE DEPTH
- Ask 1-2 questions per category MAX before moving to next category
- Cover ALL ${totalCategories} categories before deep-diving
- Currently covered: ${categoriesFilledCount}/${totalCategories}
- **Priority: Cover uncovered categories first!**

### RULE #5: EXTRACT MAXIMUM VALUE FROM USER RESPONSES
User often provides information beyond what you asked. Example:

You asked: "What are your business goals?"
User said: "We want to improve efficiency for our sales team of 50 people who currently use spreadsheets"

**You now know:**
- Business Goal: Improve efficiency ✅
- Target Users: Sales team ✅
- Team Size: 50 people ✅
- Current Solution: Spreadsheets ✅
- Pain Point: Manual/inefficient process ✅

**Don't ask about these again!** Move to uncovered topics like: technical requirements, success metrics, workflows, etc.

---

## ACCEPTANCE CRITERIA QUALITY STANDARDS (CRITICAL FOR ARTIFACT GENERATION)

(Compliance guidelines and enterprise quality expectations are in the static user context when provided.)

### ASK QUESTIONS THAT GATHER THIS LEVEL OF DETAIL:

To create acceptance criteria with this quality, ask about:
- **Specific fields/data:** "What exact information does the user need to enter?"
- **Observable outcomes:** "What should users see immediately after this action?"
- **Error scenarios:** "What happens if the data is invalid or the API fails?"
- **Notifications:** "Who needs to be notified and through what channels?"
- **Audit/compliance:** "What needs to be logged for audit purposes?"
- **Timing/performance:** "How quickly should this complete?"
- **Validation rules:** "What are the validation requirements for each field?"
- **Edge cases:** "What unusual scenarios should we handle?"

---

${backlogContext ? `
## 📋 EXISTING BACKLOG CONTEXT

${backlogContext}

### INTELLIGENT USE OF BACKLOG CONTEXT:

**When user mentions functionality, IMMEDIATELY:**
1. Scan existing epics/features for similarities
2. If overlap found, ask: "I notice you have Epic #123 'X'. Is this related, or completely separate?"
3. Suggest alignment: "Should we extend Feature #456, or create new work?"
4. Identify gaps: "Your Feature #456 has A and B, but no C. Should we add that?"
5. Check priorities: "Your existing stories are Priority 1. Should these match?"

**Proactive Gap Analysis:**
- Notice patterns in existing backlog
- Suggest completing partial implementations
- Flag potential dependencies
- Recommend consistency in tagging and priorities

` : `
## ℹ️ NEW PROJECT - No Existing Backlog

This appears to be a fresh Azure DevOps project. You have creative freedom to design the backlog structure from scratch.
`}

---

## 💡 INTELLIGENT QUESTIONING STRATEGY

### Dynamic Question Selection (Your Mental Checklist):

**BEFORE generating each question, you MUST:**
1. ✅ Review ALL previous user responses (not just the last one)
2. ✅ Check what categories are still uncovered/weak
3. ✅ Verify you haven't asked this before (even in different words)
4. ✅ Confirm you're not drilling too deep on one topic
5. ✅ Ensure question will reveal info needed for detailed acceptance criteria
6. ✅ Ask about a NEW category if current one has 2+ questions

### Question Generation Priority:

**Priority 1: Critical Missing Categories (ask about these FIRST)**
${conversationState.suggestedNextTopics.slice(0, 3).map((topic, i) =>
      `${i + 1}. ${topic.replace(/([A-Z])/g, ' $1').trim()} ${!categoriesFilled[topic as keyof typeof categoriesFilled] ? '⚠️ COMPLETELY UNCOVERED' : '⚠️ WEAK - needs more'
      }`
    ).join('\n') || 'All major categories have some coverage'}

**Priority 2: Build on User's Last Response**
- Extract maximum value from what they just shared
- Ask natural follow-up that adds NEW dimension
- Don't repeat what they already told you

**Priority 3: Acceptance Criteria Depth**
- Ask about specifics that will create detailed AC
- Probe for data, workflows, validations, error handling
- Get observable outcomes and timing expectations

### Examples of SMART Questions:

**✅ GOOD (Contextual, Builds on Previous, New Topic):**
User previously said: "We need a CRM for our sales team of 50 people"
Already asked about: Business goals, users, key features
Your question: "You mentioned your sales team uses this. Walk me through a typical sales workflow - from when a lead first comes in to when the deal closes. What are the key steps?"
→ Asks about userWorkflows (new category), builds on known context, will reveal detailed process

**✅ GOOD (Proactive, References Context):**
User said: "Dashboard for managers to see team performance"
Your question: "For the manager dashboard, what specific metrics or KPIs should be displayed? Things like total deals closed, conversion rates, average deal size - what's most important for decision-making?"
→ Specific, will reveal successMetrics, helps create detailed acceptance criteria

**❌ BAD (Repetitive):**
Already asked: "What are your business objectives?"
Don't ask: "What goals are you trying to achieve?" ← SAME CONCEPT, rephrased

**❌ BAD (Too Deep, Ignoring Breadth):**
Already asked 3 questions about features
Don't ask: "Tell me more details about feature X's sub-functionality Y" ← TOO DEEP
Do ask: "What technical platforms or systems does this need to integrate with?" ← NEW CATEGORY

**❌ BAD (Ignoring User's Previous Detailed Answer):**
User already said: "Sales reps and managers will use it. Reps track leads, managers view reports"
Don't ask: "Who will be using this system?" ← THEY ALREADY TOLD YOU

---

## 🎨 CONVERSATIONAL WARMTH & COLLABORATION

**Tone Guidelines:**
- Be warm, friendly, encouraging (like a helpful colleague, not a robot)
- Acknowledge what user shares: "That's really helpful context!" / "Great, that gives me a clear picture"
- Show you're listening: "Based on what you've told me about X, I'm curious about Y..."
- Be concise but personable: 2-3 sentences before your question
- Use natural language, avoid jargon unless user does
- Celebrate progress: "Excellent! We're building a comprehensive picture..."

**Example Responses:**

**Warm Opening:**
"Perfect! A CRM for your sales team - that's a great fit for structured Agile development. Before we dive into features, help me understand the foundation..."

**Acknowledging Detail:**
"Wow, that's really comprehensive - thank you! I can already see how the workflow progresses through those stages. Now let me understand the technical side..."

**Encouraging:**
"This is shaping up really well! I have a clear picture of your users and main features. Let's talk about how you'll measure success..."

**Transitioning Topics:**
"Got it, those features make perfect sense for your use case. Switching gears a bit - let's talk about the technical environment..."

---

## NOW GENERATE YOUR INTELLIGENT QUESTION

**User's last message:** "${lastUserMessage}"

**What you MUST do:**
1. Review ALL previous user responses (not just last one)
2. Identify what categories need coverage: ${conversationState.suggestedNextTopics.slice(0, 3).join(', ')}
3. ${conversationState.shouldSwitchTopic ? `🚨 MANDATORY: Switch away from ${conversationState.currentFocus} - ask about ${conversationState.suggestedNextTopics[0]}` : `Ask about most important uncovered/weak area`}
4. Reference context from user's previous answers
5. Be warm, specific, and collaborative
6. Extract ALL new information into capturedInfo

**Generate ONE brilliant question that moves us forward intelligently.** 🎯`;

    const workflowPrefix = createJobCachePrefix({
      staticSystem: WORKFLOW_CACHE_STATIC_SYSTEM,
      staticUser: buildWorkflowCacheStaticUser({
        processedFileRequirements,
        attachedBrdId,
        complianceGuidelines,
      }),
    });
    logJobCacheFingerprint("Workflow conversation", workflowPrefix);

    const modelName =
      process.env.BEDROCK_MODEL_ID ||
      process.env.AZURE_OPENAI_DEPLOYMENT ||
      process.env.OPENAI_MODEL ||
      "gpt-4o";

    // ========== CALL AI WITH OPTIMIZED PARAMETERS ==========
    const messages = toLlmMessages(workflowPrefix, systemPrompt, windowedHistory);

    console.log("[Workflow AI] Calling AI with comprehensive context (prompt cache enabled)");

    const response = await openai.chat.completions.create({
      model: modelName,
      response_format: { type: "json_object" },
      messages,
      temperature: 0.65,
      top_p: 0.88,
      presence_penalty: 0.4,
      frequency_penalty: 0.4,
    });

    const content = response.choices[0]?.message?.content || "{}";
    console.log("[Workflow AI] AI response received");

    let result;
    try {
      const { parsed, wasCodeBlock } = extractJsonFromLLMResponse(content);
      result = parsed;
      if (wasCodeBlock) console.log("[Workflow AI] Extracted JSON from markdown code block");
    } catch (parseError) {
      console.error("[Workflow AI] JSON parse error:", parseError);
      console.error("[Workflow AI] Content length:", content.length);
      console.error("[Workflow AI] First 200 chars:", content.slice(0, 200));
      throw new Error(
        `Failed to parse AI response as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
    }

    // ========== COMPREHENSIVE VALIDATION & AI-DRIVEN QUESTIONING ==========
    if (!result.question || typeof result.question !== "string" || result.question.trim() === "") {
      console.error("[Workflow AI] AI returned empty/invalid question - enhancing AI prompt for better context awareness");

      // Instead of falling back to hardcoded questions, retry with enhanced context
      if (conversationState.suggestedNextTopics.length > 0) {
        const nextTopic = conversationState.suggestedNextTopics[0];

        console.log(`[Workflow AI] Retrying AI question generation for category: ${nextTopic}`);

        // Enhanced contextual prompt for AI to generate better questions
        const enhancedContextPrompt = `
Based on our conversation so far and the ${nextTopic} category that needs attention:

User Context:
${windowedHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Captured Requirements:
${JSON.stringify(capturedRequirements, null, 2)}

Generate a specific, contextual question about ${nextTopic} that:
1. References what the user has already shared
2. Builds on their specific domain/industry
3. Asks for missing details relevant to their project
4. Avoids generic or template-like language

Provide ONLY the question text, nothing else.`;

        // Try AI generation one more time with enhanced context
        try {
          const retryResponse = await openai.chat.completions.create({
            model: modelName,
            messages: [
              {
                role: "system",
                content:
                  "You are an expert business analyst. Generate contextual, specific questions based on user context. Avoid generic templates.",
              },
              { role: "user", content: enhancedContextPrompt },
            ],
            max_tokens: 150,
            temperature: 0.7,
          });

          const aiQuestion = retryResponse.choices[0]?.message?.content?.trim();
          if (aiQuestion && aiQuestion.length > 10) {
            console.log(`[Workflow AI] Successfully generated contextual question: ${aiQuestion.substring(0, 100)}...`);
            result.question = aiQuestion;
          }
        } catch (retryError) {
          console.error('[Workflow AI] AI retry also failed, using minimal contextual fallback');

          // Only as absolute last resort, use a contextual question that references user input
          const userProjectContext = conversationHistory
            .filter(msg => msg.role === 'user')
            .map(msg => msg.content)
            .join(' ')
            .substring(0, 200);

          // Generate AI contextual follow-up based on missing topic
          const topicPrompt = `User has shared context about their project. They need to elaborate on: ${nextTopic}.
Generate a contextual question that references what they've shared and asks specifically about ${nextTopic}.
Be conversational and specific.`;

          try {
            const aiResponse = await openai.chat.completions.create({
              model: modelName,
              messages: [
                { role: 'system', content: 'Generate one contextual question based on the topic needed. Reference the user context provided.' },
                { role: 'user', content: topicPrompt }
              ],
              max_tokens: 80,
              temperature: 0.7
            });

            result.question = aiResponse.choices[0]?.message?.content?.trim() ||
              "What else would be important for me to understand about your project?";
          } catch (error) {
            result.question = "What else would be important for me to understand about your project?";
          }
        }
      } else {
        // Generic last resort
        result.question = "What else would be important for me to understand about your project?";
      }
    }

    // Advanced duplicate detection with logging
    const duplicateCheck = isDuplicateQuestion(result.question, questionHistory, 0.55);

    if (duplicateCheck.isDuplicate) {
      console.warn("[Workflow AI] ⚠️ DUPLICATE QUESTION DETECTED!");
      console.warn("[Workflow AI] New question:", result.question);
      console.warn("[Workflow AI] Similar to:", duplicateCheck.similarTo);
      console.warn("[Workflow AI] Category:", duplicateCheck.category);

      // Force different topic
      const alternativeTopic = conversationState.suggestedNextTopics.find(
        t => t !== duplicateCheck.category && t !== conversationState.currentFocus
      ) || conversationState.suggestedNextTopics[0];

      console.log("[Workflow AI] Forcing switch to:", alternativeTopic);

      const topicQuestions: Record<string, string> = {
        'businessGoals': "What specific business outcomes or improvements are you expecting from this project?",
        'targetUsers': "Tell me about the different types of users - what are their roles and typical daily activities?",
        'keyFeatures': "What capabilities would deliver the most value to your users in the first release?",
        'functionalRequirements': "What information or data will users need to view, create, or update in the system?",
        'userWorkflows': "Walk me through the end-to-end process - what happens from start to finish in a typical scenario?",
        'technicalConstraints': "What technical environment are you working in? Any existing platforms, databases, or tools to integrate with?",
        'nonFunctionalRequirements': "Are there specific requirements around response times, concurrent users, data security, or compliance?",
        'successMetrics': "What measurable improvements or KPIs will indicate this project succeeded?",
        'scopeBoundaries': "What won't be included in the first version? What features are you deferring to later phases?"
      };

      result.question = topicQuestions[alternativeTopic] ||
        "Let me shift focus - what haven't we covered yet that's important for this project?";

      console.log("[Workflow AI] Replaced with:", result.question);
    }

    // Ensure phase is set
    if (!result.phase) {
      result.phase = currentPhase;
    }

    // ========== ENSURE CAPTURED INFO IS COMPLETE AND ENHANCED ==========
    if (!result.capturedInfo || Object.keys(result.capturedInfo).length === 0) {
      console.log("[Workflow AI] AI didn't extract info, using pattern-based extraction");
      const extracted = extractRequirementsFromMessage(lastUserMessage, capturedRequirements);

      result.capturedInfo = {
        businessGoals: extracted.businessGoals || capturedRequirements.businessGoals || [],
        keyFeatures: extracted.keyFeatures || capturedRequirements.keyFeatures || [],
        targetUsers: extracted.targetUsers || capturedRequirements.targetUsers || [],
        functionalRequirements: extracted.functionalRequirements || capturedRequirements.functionalRequirements || [],
        technicalConstraints: extracted.technicalConstraints || capturedRequirements.technicalConstraints || [],
        nonFunctionalRequirements: extracted.nonFunctionalRequirements || capturedRequirements.nonFunctionalRequirements || [],
        successMetrics: extracted.successMetrics || capturedRequirements.successMetrics || [],
        userWorkflows: extracted.userWorkflows || capturedRequirements.userWorkflows || [],
        integrations: extracted.integrations || capturedRequirements.integrations || [],
        scopeBoundaries: extracted.scopeBoundaries || capturedRequirements.scopeBoundaries || { inScope: [], outOfScope: [] }
      };
    } else {
      // Ensure all fields exist and merge with existing
      result.capturedInfo = {
        businessGoals: [...new Set([...(capturedRequirements.businessGoals || []), ...(result.capturedInfo.businessGoals || [])])],
        keyFeatures: [...new Set([...(capturedRequirements.keyFeatures || []), ...(result.capturedInfo.keyFeatures || [])])],
        targetUsers: [...new Set([...(capturedRequirements.targetUsers || []), ...(result.capturedInfo.targetUsers || [])])],
        functionalRequirements: [...new Set([...(capturedRequirements.functionalRequirements || []), ...(result.capturedInfo.functionalRequirements || [])])],
        technicalConstraints: [...new Set([...(capturedRequirements.technicalConstraints || []), ...(result.capturedInfo.technicalConstraints || [])])],
        nonFunctionalRequirements: [...new Set([...(capturedRequirements.nonFunctionalRequirements || []), ...(result.capturedInfo.nonFunctionalRequirements || [])])],
        successMetrics: [...new Set([...(capturedRequirements.successMetrics || []), ...(result.capturedInfo.successMetrics || [])])],
        userWorkflows: [...new Set([...(capturedRequirements.userWorkflows || []), ...(result.capturedInfo.userWorkflows || [])])],
        integrations: [...new Set([...(capturedRequirements.integrations || []), ...(result.capturedInfo.integrations || [])])],
        scopeBoundaries: {
          inScope: [...new Set([...(capturedRequirements.scopeBoundaries?.inScope || []), ...(result.capturedInfo.scopeBoundaries?.inScope || [])])],
          outOfScope: [...new Set([...(capturedRequirements.scopeBoundaries?.outOfScope || []), ...(result.capturedInfo.scopeBoundaries?.outOfScope || [])])]
        }
      };
    }

    // Log what was captured
    const newInfoCount = Object.values(result.capturedInfo).reduce((sum: number, val) => {
      if (Array.isArray(val)) return sum + val.length;
      if (typeof val === 'object' && val !== null) return sum + Object.values(val).flat().length;
      return sum;
    }, 0);

    console.log("[Workflow AI] Captured info items:", newInfoCount);
    console.log("[Workflow AI] Categories with data:", Object.entries(result.capturedInfo).filter(([k, v]) =>
      Array.isArray(v) ? v.length > 0 : (typeof v === 'object' && v !== null && Object.values(v).some(arr => (arr as any[]).length > 0))
    ).map(([k]) => k));

    console.log("[Workflow AI] === ANALYSIS COMPLETE ===");
    return result;

  } catch (error) {
    console.error("[Workflow AI] Critical error:", error);

    if (error instanceof Error) {
      console.error("[Workflow AI] Error details:", error.message, error.stack);
    }

    // AI-driven contextual fallback - use available context to generate meaningful questions
    const userContext = conversationHistory
      .filter(msg => msg.role === 'user')
      .map(msg => msg.content)
      .join(' ')
      .substring(0, 300);

    const capturedContext = Object.entries(capturedRequirements)
      .filter(([key, value]) => Array.isArray(value) ? value.length > 0 : false)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('; ');

    // AI-driven contextual question generation
    const aiContextualPrompt = `
You are helping gather project requirements. Based on the conversation context below, generate ONE specific, contextual question.

USER CONTEXT: ${userContext}
CAPTURED REQUIREMENTS: ${capturedContext}
${attachedBrdId ? `BRD ATTACHED: Focus on clarifying specific aspects of the documented requirements.` : ''}

Generate a question that:
- References what the user has already shared (if anything)
- Asks about missing or unclear aspects
- Is specific and actionable
- Avoids generic template language
- Helps move the conversation forward constructively

Keep it concise and conversational.
`;

    try {
      const aiResponse = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are an expert requirements analyst. Generate one specific, contextual question based on the conversation context. Be conversational and reference what the user has already shared.'
          },
          {
            role: 'user',
            content: aiContextualPrompt
          }
        ],
        max_tokens: 120,
        temperature: 0.7
      });

      const contextualQuestion = aiResponse.choices[0]?.message?.content?.trim() ||
        "What else would be important for me to understand about your project?";

      console.log(`[Workflow AI] Using AI-generated contextual question: ${contextualQuestion}`);

      return {
        question: contextualQuestion,
        phase: currentPhase,
        quickReplies: undefined,
        readyToGenerate: false,
        capturedInfo: capturedRequirements,
      };
    } catch (error) {
      console.error("[Workflow AI] Error generating contextual question:", error);

      // Simple fallback without hardcoded questions
      const simpleFallback = userContext.length > 20
        ? "Thanks for sharing those details. What else would be important for me to understand about your project?"
        : "I'd like to learn more about your project. Could you share some details about what you're working on?";

      return {
        question: simpleFallback,
        phase: currentPhase,
        quickReplies: undefined,
        readyToGenerate: false,
        capturedInfo: capturedRequirements,
      };
    }
  }
}

/**
 * Validates requirements completeness
 */
export function validateRequirementsCompleteness(
  requirements: RequirementsContext
): { isComplete: boolean; missingAreas: string[]; warnings: string[] } {
  const missingAreas: string[] = [];
  const warnings: string[] = [];

  // Critical requirements
  if (!requirements.businessGoals || requirements.businessGoals.length === 0) {
    missingAreas.push("Business Goals/Objectives");
  }
  if (!requirements.targetUsers || requirements.targetUsers.length === 0) {
    missingAreas.push("Target Users/Personas");
  }
  if (!requirements.keyFeatures || requirements.keyFeatures.length < 2) {
    missingAreas.push("Key Features (need at least 2)");
  }

  // Important but not critical
  if (!requirements.functionalRequirements || requirements.functionalRequirements.length < 2) {
    warnings.push("More functional requirement details would improve quality");
  }
  if (!requirements.successMetrics || requirements.successMetrics.length === 0) {
    warnings.push("Success metrics help prioritize features");
  }
  if (!requirements.userWorkflows || requirements.userWorkflows.length === 0) {
    warnings.push("User workflow details improve story quality");
  }

  const isComplete = missingAreas.length === 0;
  return { isComplete, missingAreas, warnings };
}

/**
 * Enhanced extraction with better pattern matching and deduplication
 */
export function extractRequirementsFromMessage(
  message: string,
  existingRequirements: RequirementsContext
): Partial<RequirementsContext> {
  const extracted: Partial<RequirementsContext> = {};
  const lowerMessage = message.toLowerCase();

  // Helper function to check if item already exists (semantic matching)
  const isDuplicate = (newItem: string, existingList: string[]): boolean => {
    const newLower = newItem.toLowerCase();
    return existingList.some(existing => {
      const existingLower = existing.toLowerCase();
      return existingLower.includes(newLower) ||
        newLower.includes(existingLower) ||
        calculateQuestionSimilarity(newItem, existing) > 0.7;
    });
  };

  // Business goals patterns (enhanced)
  const goalPatterns = [
    /(?:goal|objective|aim|purpose|trying to|want to|need to|solve|improve|achieve|reduce|increase)\s+(?:is\s+)?(.+?)(?:\.|,|and\s+(?:also|we)|$)/gi,
    /(?:because|so that|in order to)\s+(.+?)(?:\.|,|$)/gi,
    /(?:we're looking to|looking to|hoping to|aiming to)\s+(.+?)(?:\.|,|$)/gi
  ];

  const goals: string[] = [];
  goalPatterns.forEach(pattern => {
    const matches = Array.from(message.matchAll(pattern));
    matches.forEach(match => {
      if (match[1] && match[1].length > 10 && match[1].length < 200) {
        const goal = match[1].trim();
        if (!isDuplicate(goal, existingRequirements.businessGoals || [])) {
          goals.push(goal);
        }
      }
    });
  });

  if (goals.length > 0) {
    extracted.businessGoals = [...(existingRequirements.businessGoals || []), ...goals];
  }

  // Feature patterns (enhanced)
  const featurePatterns = [
    /(?:feature|functionality|capability|function|ability to|can|should|must|need|want|require)\s+(?:to\s+)?(.+?)(?:\.|,|and\s+(?:also|we)|$)/gi,
    /(?:build|create|develop|implement|add|include|have)\s+(?:a\s+)?(.+?)(?:\.|,|and|$)/gi,
    /(?:system should|app should|platform should|solution should)\s+(.+?)(?:\.|,|$)/gi
  ];

  const features: string[] = [];
  featurePatterns.forEach(pattern => {
    const matches = Array.from(message.matchAll(pattern));
    matches.forEach(match => {
      if (match[1] && match[1].length > 5 && match[1].length < 150) {
        const feature = match[1].trim();
        if (!isDuplicate(feature, existingRequirements.keyFeatures || [])) {
          features.push(feature);
        }
      }
    });
  });

  if (features.length > 0) {
    extracted.keyFeatures = [...(existingRequirements.keyFeatures || []), ...features];
  }

  // User/persona patterns (enhanced)
  const userPatterns = [
    /(?:users?|personas?|customers?|clients?|admins?|administrators?|managers?|employees?|staff|team members?|people)\s+(?:are|is|will be|include|like|such as|who)\s+(.+?)(?:\.|,|and\s+(?:also)?|$)/gi,
    /(?:for|targeting|serving)\s+(.+?)\s+(?:users?|customers?|people|employees?)(?:\.|,|$)/gi,
    /(?:role of|roles? like|types? of users?)\s+(?:include|are|such as)\s+(.+?)(?:\.|,|$)/gi
  ];

  const users: string[] = [];
  userPatterns.forEach(pattern => {
    const matches = Array.from(message.matchAll(pattern));
    matches.forEach(match => {
      if (match[1] && match[1].length > 3 && match[1].length < 100) {
        const user = match[1].trim();
        if (!isDuplicate(user, existingRequirements.targetUsers || [])) {
          users.push(user);
        }
      }
    });
  });

  // Also check for standalone user type mentions
  const userTypeKeywords = ['admin', 'administrator', 'manager', 'employee', 'customer', 'user', 'developer', 'analyst', 'executive', 'sales', 'support', 'engineer'];
  userTypeKeywords.forEach(keyword => {
    if (lowerMessage.includes(keyword)) {
      const existing = existingRequirements.targetUsers || [];
      if (!existing.some(u => u.toLowerCase().includes(keyword))) {
        users.push(keyword.charAt(0).toUpperCase() + keyword.slice(1) + 's');
      }
    }
  });

  if (users.length > 0) {
    extracted.targetUsers = [...(existingRequirements.targetUsers || []), ...users];
  }

  // Technical constraints (enhanced)
  if (lowerMessage.includes('integrate') || lowerMessage.includes('api') ||
    lowerMessage.includes('database') || lowerMessage.includes('platform') ||
    lowerMessage.includes('system') || lowerMessage.includes('technology') ||
    lowerMessage.includes('azure') || lowerMessage.includes('aws') ||
    lowerMessage.includes('cloud') || lowerMessage.includes('server')) {

    const techMatches = message.match(/(?:integrate with|using|built on|platform|database|system|technology|framework|language|tool)\s+(.+?)(?:\.|,|and|$)/gi);
    if (techMatches) {
      const techConstraints = techMatches
        .map(m => m.trim())
        .filter(t => t.length > 5 && t.length < 150)
        .filter(t => !isDuplicate(t, existingRequirements.technicalConstraints || []));

      if (techConstraints.length > 0) {
        extracted.technicalConstraints = [
          ...(existingRequirements.technicalConstraints || []),
          ...techConstraints
        ];
      }
    }
  }

  // Success metrics (enhanced)
  const metricPatterns = [
    /(?:measure|metric|kpi|target|goal is|success|track)\s+(.+?)(?:\.|,|$)/gi,
    /(?:increase|decrease|improve|reduce|achieve|reach)\s+(.+?)\s+(?:by|to|from)\s+(.+?)(?:\.|,|$)/gi,
    /(\d+%|\d+\s*percent)/gi
  ];

  const metrics: string[] = [];
  metricPatterns.forEach(pattern => {
    const matches = Array.from(message.matchAll(pattern));
    matches.forEach(match => {
      if (match[1] && match[1].length > 5 && match[1].length < 150) {
        const metric = match[1].trim();
        if (!isDuplicate(metric, existingRequirements.successMetrics || [])) {
          metrics.push(metric);
        }
      }
    });
  });

  if (metrics.length > 0) {
    extracted.successMetrics = [...(existingRequirements.successMetrics || []), ...metrics];
  }

  // Workflow/process mentions (enhanced)
  if (lowerMessage.includes('workflow') || lowerMessage.includes('process') ||
    lowerMessage.includes('step') || lowerMessage.includes('journey') ||
    lowerMessage.includes('first') && lowerMessage.includes('then')) {

    const workflowMatches = message.match(/(?:workflow|process|journey|steps?|first.*then.*(?:finally)?)\s*:?\s*(.{20,}?)(?:\.|$)/gi);
    if (workflowMatches && workflowMatches.length > 0) {
      const workflow = workflowMatches[0].trim();
      if (!isDuplicate(workflow, existingRequirements.userWorkflows || [])) {
        extracted.userWorkflows = [
          ...(existingRequirements.userWorkflows || []),
          workflow
        ];
      }
    }
  }

  // Scope boundaries
  if (lowerMessage.includes('not include') || lowerMessage.includes('out of scope') ||
    lowerMessage.includes('exclude') || lowerMessage.includes('won\'t have') ||
    lowerMessage.includes('don\'t need')) {

    const outOfScopeMatches = message.match(/(?:not include|out of scope|exclude|won't have|don't need)\s+(.+?)(?:\.|,|$)/gi);
    if (outOfScopeMatches) {
      const outOfScope = outOfScopeMatches.map(m => m.trim());
      extracted.scopeBoundaries = {
        inScope: existingRequirements.scopeBoundaries?.inScope || [],
        outOfScope: [...(existingRequirements.scopeBoundaries?.outOfScope || []), ...outOfScope]
      };
    }
  }

  return extracted;
}

export default {
  generateWorkflowConversationQuestion,
  validateRequirementsCompleteness,
  extractRequirementsFromMessage,
};
