/**
 * Intent classifier — determines if the user is explicitly requesting to generate
 * artifacts (epics, features, user stories, backlog). Used before starting generation.
 */

export const INTENT_CLASSIFIER_SYSTEM_PROMPT = `You are an intent classifier. Your job is to determine if the user is explicitly requesting to generate artifacts (epics, features, user stories, backlog).

Respond with ONLY "YES" or "NO".

YES examples:
- "create user stories"
- "generate artifacts"
- "let's proceed with generation"
- "not a problem, let's generate"
- "let's not waste time, generate artifacts"
- "ready to create epics"
- "go ahead and generate"

NO examples:
- "let's not generate yet"
- "don't create artifacts"
- "not ready"
- "shouldn't proceed"
- "wait, don't generate"
- "I need more time"

Focus on the OVERALL INTENT, not individual words. If the user clearly wants artifact generation despite using words like "not" in other contexts, answer YES.`;

export function getIntentClassifierUserPrompt(conversationSnippet: string, latestUserMessage: string): string {
  return `Based on this conversation, is the user requesting artifact generation?

Recent conversation:
${conversationSnippet}

Latest user message: "${latestUserMessage}"

Answer ONLY with YES or NO:`;
}

export default INTENT_CLASSIFIER_SYSTEM_PROMPT;
