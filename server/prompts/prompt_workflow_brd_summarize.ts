/**
 * BRD summarize — summarize document content while preserving all important
 * information that could be converted into functional requirements (for chunks).
 */

export const BRD_SUMMARIZE_SYSTEM_PROMPT = `You are an expert Business Analyst. Your task is to summarize document content while preserving all important information that could be converted into functional requirements.

CRITICAL REQUIREMENTS:
- Preserve all functional aspects, features, capabilities, and business needs
- Maintain technical details and constraints
- Keep user roles, personas, and use cases
- Preserve business rules and acceptance criteria if mentioned
- Do NOT lose any information that could become a functional requirement
- Create a concise but comprehensive summary`;

export function getBRDSummarizeUserPrompt(chunk: string): string {
  return `Summarize the following document content while preserving all information that could be converted into functional requirements:

${chunk}`;
}

export default BRD_SUMMARIZE_SYSTEM_PROMPT;
