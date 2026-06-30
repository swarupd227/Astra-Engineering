/**
 * Response Synthesis Agent - TypeScript Implementation
 * 
 * Aggregates retrieved chunks and produces
 * a single synthesized explanation per requirement.
 */

import type {
  SemanticChunk,
  Requirement,
  RAGResult
} from '../models';
import { llmClient } from '../llmClient';
import { config } from '../config';

export class ResponseSynthesisAgent {

  groupChunks(chunks: SemanticChunk[]): Record<string, SemanticChunk[]> {
    /**
     * Group chunks by document + section
     */
    const groups: Record<string, SemanticChunk[]> = {};
    for (const chunk of chunks) {
      const key = `${chunk.metadata.docId}_${chunk.metadata.sectionPath.join('/')}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(chunk);
    }
    return groups;
  }

  mergeChunkGroup(group: SemanticChunk[]): string {
    /**
     * Merge multiple related chunks into one text block
     */
    return group
      .map(chunk => chunk.content.trim())
      .join('\n\n');
  }

  async synthesize(
    requirement: Requirement,
    chunks: SemanticChunk[]  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Always contains RAW content
  ): Promise<string> {
    /**
     * Produce final explanation for one requirement
     * ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ IMPORTANT: Chunks contain RAW text - summarization happens HERE
     */
    const grouped = this.groupChunks(chunks);

    const mergedTexts: string[] = [];
    for (const group of Object.values(grouped)) {
      mergedTexts.push(this.mergeChunkGroup(group));
    }

    const evidenceText = mergedTexts.join('\n\n---\n\n');

    const prompt = `You are an expert software architect specializing in guideline interpretation.

Below are official guideline excerpts related to a specific requirement.
These are AUTHORITATIVE RULES that must be followed precisely.

CRITICAL INSTRUCTIONS:
- DO NOT change, modify, or interpret the guidelines
- DO NOT add your own assumptions or suggestions
- PRESERVE the exact technical context and constraints from guidelines
- ONLY synthesize and explain what is explicitly stated
- The guidelines are non-negotiable rules, not suggestions
- Focus on detailed explanation of the guideline content
- Maintain the original intent and technical specifications
- PRESERVE ALL specific codes, identifiers, message types (e.g. MT700, MT760, MT417, pacs.008), field tags (e.g. :50:, :59:, :52A:), and reference numbers EXACTLY as they appear
- PRESERVE ALL table data, field mappings, and structured specifications from the guidelines
- Include ALL relevant message type codes, field tag numbers, and technical identifiers mentioned in the guidelines

REQUIREMENT:
${requirement.description}

OFFICIAL GUIDELINE CONTENT (must be preserved exactly):
${evidenceText}

OUTPUT REQUIREMENTS:
- Detailed explanation of what the guidelines require
- Preserve ALL technical constraints and specifications
- MUST include all specific message type codes (MT###, MX/pacs/camt etc.), field tags, and identifiers from the guideline content
- Use bullet points for clarity
- 12-20 sentences explaining the guideline requirements in detail
- NO personal interpretations or additions
- Focus on "what must be done according to these guidelines"`;

    const messages: { role: 'system' | 'user' | 'assistant'; content: string; }[] = [
      { role: "system", content: "You are a guideline compliance specialist. You explain official guidelines without deviation, interpretation, or modification. Your role is to preserve the exact meaning and requirements of authoritative documentation." },
      { role: "user", content: prompt }
    ];

    return await llmClient.generateCompletion(messages, { temperature: 0.3 });
  }

  async synthesizeAllRequirements(
    ragResults: RAGResult[],
    userQuery?: string
  ): Promise<string> {
    /**
     * Produce ONE final summary for ALL requirements (frontend consumption)
     */
    
    // Combine all requirement descriptions and summaries
    const requirementsContext: string[] = [];
    for (const result of ragResults) {
      const reqContext = `REQUIREMENT: ${result.requirementDescription}
GUIDANCE: ${result.finalSummary}
COVERAGE: ${result.coverage.toFixed(1)}%`;
      requirementsContext.push(reqContext);
    }

    const combinedContext = requirementsContext.join('\n---\n');

    // Create user context if provided
    const userContext = userQuery ? `\nUser Query: ${userQuery}\n` : "";

    const prompt = `You are a guideline compliance architect creating an authoritative implementation guide.

TASK: Synthesize the following requirement-specific guidance into ONE cohesive implementation plan that strictly adheres to all guidelines.

CRITICAL RULES:
- PRESERVE all technical constraints and specifications from guidelines
- DO NOT modify, interpret, or soften any guideline requirements
- Remove redundancy but maintain ALL compliance requirements
- Guidelines are mandatory rules, not suggestions
- Focus on what developers MUST do according to guidelines
- Group related compliance requirements together
- Use clear headings and bullet points for guideline adherence
- Emphasize guideline compliance throughout
- MUST PRESERVE ALL specific codes, message types (e.g. MT700, MT707, MT710, MT717, MT720, MT730, MT740, MT747, MT760, MT767, MT769, MT790, MT799, pacs.008, camt.xxx), field tags (e.g. :20:, :50:, :59:, :52A:, :57A:), and technical identifiers EXACTLY as they appear in the guidance
- Include ALL field-level mapping details, tag specifications, and structured data from the guidelines
- Do NOT generalize or omit specific code references — they are critical for implementation${userContext}

REQUIREMENT-SPECIFIC GUIDANCE (AUTHORITATIVE):
${combinedContext}

OUTPUT: A comprehensive, guideline-compliant implementation guide that ensures full adherence to all specified rules and constraints. Be thorough and detailed — include all message type codes, field tags, and technical specifications. Aim for 40-60 sentences covering all technical detail.`;

    const messages: { role: 'system' | 'user' | 'assistant'; content: string; }[] = [
      { role: "system", content: "You create comprehensive, guideline-compliant implementation guides that strictly preserve all technical requirements and constraints from authoritative documentation. You never deviate from or modify official guidelines." },
      { role: "user", content: prompt }
    ];

    return await llmClient.generateCompletion(messages, { temperature: 0.2 });
  }

  /**
   * PageIndex + RAG Hybrid: Generate a compact but complete index of a document.
   * Preserves ALL codes, identifiers, field tags, table structures, and key rules.
   * Used for Tier 2 documents (30K-100K chars).
   */
  async generatePageIndex(documentName: string, content: string): Promise<string> {
    const prompt = `You are a technical document indexer. Create a COMPLETE structured index of this document.

DOCUMENT: ${documentName}

CONTENT:
${content}

INDEXING RULES:
- Extract EVERY code, identifier, message type (MT###, MX, pacs.###, camt.###), field tag (:20:, :50:, :59: etc.)
- Extract EVERY table with column headers and key data rows
- Extract EVERY rule, constraint, validation requirement
- Extract EVERY field mapping and data specification
- Preserve section hierarchy and structure
- Use compact bullet-point format
- Do NOT summarize or paraphrase — extract and list
- Do NOT skip ANY technical detail, code, or identifier
- If a section has a table, include ALL rows in condensed format

OUTPUT FORMAT:
## [Section Name]
- [All codes/identifiers in this section]
- [All rules/constraints]
- [Table data in compact format: col1|col2|col3]
...repeat for every section...`;

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: 'You are a precise technical document indexer. You extract and list every technical detail without omission. You never summarize — you catalog.' },
      { role: 'user', content: prompt }
    ];

    return await llmClient.generateCompletion(messages, { temperature: 0.1, maxTokens: config.PAGEINDEX_DOC_MAX_TOKENS });
  }

  /**
   * PageIndex for Tier 3: Index a single section of a large document.
   * Same rules as generatePageIndex but for one section at a time.
   * With 10K section size and 10K output tokens, the LLM has enough budget
   * to catalog a section nearly 1:1 without lossy compression.
   */
  async generateSectionIndex(documentName: string, sectionTitle: string, sectionContent: string): Promise<string> {
    const prompt = `You are a technical document indexer. Create a COMPLETE index of this document section.

DOCUMENT: ${documentName}
SECTION: ${sectionTitle}

CONTENT:
${sectionContent}

INDEXING RULES:
- Extract EVERY code, identifier, message type, field tag — no exceptions
- Extract EVERY table row, field mapping, data specification in compact format
- Extract EVERY rule, constraint, validation requirement
- Preserve ALL numeric values, thresholds, limits, and date references
- Use compact bullet-point format — no prose, no filler
- Do NOT skip ANY technical detail, no matter how minor
- For tables: include ALL rows in pipe-delimited format (col1|col2|col3)
- For lists: reproduce ALL list items

OUTPUT: Complete structured index of this section — every detail preserved.`;

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: 'You are a precise technical document indexer. You catalog every detail without omission. Your output must contain every code, identifier, table row, and rule from the input.' },
      { role: 'user', content: prompt }
    ];

    return await llmClient.generateCompletion(messages, { temperature: 0.1, maxTokens: config.PAGEINDEX_SECTION_MAX_TOKENS });
  }

  /**
   * LLM-based coverage checker.
   * Compares the final ragGuidance output against the original source documents
   * and returns a structured coverage report.
   */
  async checkCoverage(
    ragGuidance: string,
    sourceDocuments: Record<string, string>,
    pipelineMode: string
  ): Promise<{
    coveragePercent: number;
    codesFound: string[];
    codesMissing: string[];
    summary: string;
    pipelineMode: string;
  }> {
    // Build a compact representation of source docs (just names + size)
    const sourceList = Object.entries(sourceDocuments).map(([name, content]) =>
      `- ${name} (${content.length} chars)`
    ).join('\n');

    // Extract all code-like identifiers from source documents for the LLM to check against
    const allSourceContent = Object.values(sourceDocuments).join('\n');
    // Pull out MT codes, field tags, pacs/camt codes, and other identifiers via regex
    const codeRegex = /\b(MT\d{3}[A-Z]?|pacs\.\d{3}|camt\.\d{3}|:[A-Z0-9]{2,4}:|SWIFT\s+[A-Z]+)\b/gi;
    const sourceCodesRaw = allSourceContent.match(codeRegex) || [];
    const sourceCodes = [...new Set(sourceCodesRaw.map(c => c.trim()))];

    const prompt = `You are a coverage auditor. Compare the RAG GUIDANCE OUTPUT against the SOURCE DOCUMENTS and determine what was preserved and what was lost.

PIPELINE MODE: ${pipelineMode}

SOURCE DOCUMENTS:
${sourceList}

KNOWN CODES/IDENTIFIERS FROM SOURCE (${sourceCodes.length} unique):
${sourceCodes.join(', ')}

RAG GUIDANCE OUTPUT (${ragGuidance.length} chars):
${ragGuidance.slice(0, 50000)}${ragGuidance.length > 50000 ? '\n... [truncated for analysis]' : ''}

TASK:
1. Check which of the KNOWN CODES/IDENTIFIERS appear in the RAG GUIDANCE OUTPUT
2. List codes that are PRESENT in the output
3. List codes that are MISSING from the output
4. Estimate overall content coverage percentage (0-100)

RESPOND IN THIS EXACT FORMAT (no other text):
COVERAGE_PERCENT: <number>
CODES_FOUND: <comma-separated list>
CODES_MISSING: <comma-separated list>
SUMMARY: <one-line assessment>`;

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: 'You are a precise coverage auditor. Respond only in the requested format.' },
      { role: 'user', content: prompt }
    ];

    try {
      const response = await llmClient.generateCompletion(messages, { temperature: 0.0, maxTokens: 2000 });

      // Parse the structured response
      const coverageMatch = response.match(/COVERAGE_PERCENT:\s*(\d+)/);
      const foundMatch = response.match(/CODES_FOUND:\s*(.+)/);
      const missingMatch = response.match(/CODES_MISSING:\s*(.+)/);
      const summaryMatch = response.match(/SUMMARY:\s*(.+)/);

      const coveragePercent = coverageMatch ? parseInt(coverageMatch[1], 10) : 0;
      const codesFound = foundMatch ? foundMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [];
      const codesMissing = missingMatch ? missingMatch[1].split(',').map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'none') : [];
      const summary = summaryMatch ? summaryMatch[1].trim() : 'Coverage check completed';

      return { coveragePercent, codesFound, codesMissing, summary, pipelineMode };
    } catch (err) {
      console.error('[CoverageCheck] LLM coverage check failed:', err instanceof Error ? err.message : String(err));
      return {
        coveragePercent: -1,
        codesFound: [],
        codesMissing: [],
        summary: `Coverage check failed: ${err instanceof Error ? err.message : String(err)}`,
        pipelineMode
      };
    }
  }
}