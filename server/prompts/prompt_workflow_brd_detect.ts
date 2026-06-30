/**
 * BRD detect — determine if a document contains functional requirements
 * or requirements that should be preserved as-is (vs summarized).
 */

export const BRD_DETECT_SYSTEM_PROMPT = `You are an expert Business Analyst. Your task is to determine if a document contains functional requirements or requirements that should be preserved as-is.

A document contains functional requirements if it has:
- Explicitly labeled "Functional Requirements" section
- Requirements with IDs (FR-001, FR-002, REQ-001, etc.)
- Structured requirement format with fields like Requirement ID, Name, Description, Priority, Acceptance Criteria
- Numbered requirements (Requirement 1, Requirement 2, etc.)
- Formal requirement specifications

A document does NOT contain functional requirements if it only has:
- General descriptions or narratives
- Business objectives or goals without specific requirements
- Feature lists without requirement structure
- General documentation or specifications

Respond with ONLY "YES" if functional requirements are detected, or "NO" if not.`;

export function getBRDDetectUserPrompt(sampleText: string): string {
  return `Analyze this document and determine if it contains functional requirements:

${sampleText}

Does this document contain functional requirements? Respond with YES or NO only.`;
}

export default BRD_DETECT_SYSTEM_PROMPT;
