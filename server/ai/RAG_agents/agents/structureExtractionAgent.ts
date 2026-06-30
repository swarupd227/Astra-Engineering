/**
 * Agent 1: Structure Extraction & Document Normalization
 * PRODUCTION-GRADE VERSION
 */

import { randomUUID } from 'crypto';
import type { 
  NormalizedDocument, 
  DocumentSection, 
  ContentBlock
} from '../models';
import { ContentBlockType } from '../models';

export class StructureExtractionAgent {
  /**
   * Extracts semantic structure and produces
   * LOGICAL (not line-level) content blocks.
   */
  
  private extractedDocs: Map<string, NormalizedDocument> = new Map();

  constructor() {
    // console.log('Initializing Structure Extraction Agent...');
  }

  // ==========================================================
  // PUBLIC API
  // ==========================================================

  extractFromText(
    documentText: string,
    sourceFile: string,
    docType: string = 'guideline'
  ): NormalizedDocument {
    const docId = randomUUID();
    const sections = this._parseStructure(documentText);

    const totalBlocks = sections.reduce((sum, s) => sum + s.blocks.length, 0);

    const normalizedDoc: NormalizedDocument = {
      id: docId,
      sourceFile,
      docType,
      title: this._extractTitle(documentText),
      summary: this._generateSummary(documentText),
      sections,
      totalBlocks,
      extractedStructure: {
        method: 'logical_block_parsing',
        sections: sections.length,
        timestamp: new Date().toISOString()
      }
    };

    this.extractedDocs.set(docId, normalizedDoc);
    // console.log(`Î“Â£Ã´ ${sourceFile}: ${sections.length} sections, ${totalBlocks} blocks`);

    return normalizedDoc;
  }

  // ==========================================================
  // CORE PARSING LOGIC
  // ==========================================================

  private _parseStructure(text: string): DocumentSection[] {
    const lines = text.split('\n');
    const sections: DocumentSection[] = [];

    let currentSectionTitle = 'Introduction';
    let currentBlocks: ContentBlock[] = [];

    let buffer: string[] = [];
    let bufferType: ContentBlockType | null = null;

    const flushBuffer = () => {
      if (buffer.length > 0) {
        currentBlocks.push({
          type: bufferType || ContentBlockType.PARAGRAPH,
          content: buffer.join('\n'),
          metadata: {}
        });
        buffer = [];
        bufferType = null;
      }
    };

    for (const line of lines) {
      const stripped = line.trim();

      // ----------------------------
      // SECTION HEADERS
      // ----------------------------
      if (this._isSectionHeader(stripped)) {
        flushBuffer();

        if (currentBlocks.length > 0) {
          sections.push({
            sectionId: randomUUID(),
            sectionPath: [currentSectionTitle],
            blocks: currentBlocks
          });
          currentBlocks = [];
        }

        currentSectionTitle = stripped.replace(/^[#=\s]*/, '').replace(/[=\s]*$/, '').trim();
        continue;
      }

      // ----------------------------
      // CODE BLOCKS
      // ----------------------------
      if (stripped.startsWith('```')) {
        flushBuffer();
        buffer = [line];
        bufferType = ContentBlockType.CODE_BLOCK;
        continue;
      }

      if (bufferType === ContentBlockType.CODE_BLOCK) {
        buffer.push(line);
        if (stripped.endsWith('```')) {
          flushBuffer();
        }
        continue;
      }

      // ----------------------------
      // TABLES
      // ----------------------------
      if (stripped.startsWith('|')) {
        if (bufferType !== ContentBlockType.TABLE) {
          flushBuffer();
          buffer = [line];
          bufferType = ContentBlockType.TABLE;
        } else {
          buffer.push(line);
        }
        continue;
      }

      // ----------------------------
      // BULLET / NUMBERED LISTS  
      // ----------------------------
      if (stripped.startsWith('-') || stripped.startsWith('*') || (stripped.length >= 2 && /^\d/.test(stripped.slice(0, 2)))) {
        if (bufferType !== ContentBlockType.PARAGRAPH) {
          flushBuffer();
          buffer = [line];
          bufferType = ContentBlockType.PARAGRAPH;
        } else {
          buffer.push(line);
        }
        continue;
      }

      // ----------------------------
      // BLANK LINE
      // ----------------------------
      if (!stripped) {
        flushBuffer();
        continue;
      }

      // ----------------------------
      // NORMAL PARAGRAPH
      // ----------------------------
      if (bufferType !== ContentBlockType.PARAGRAPH && bufferType !== null) {
        flushBuffer();
      }

      buffer.push(line);
      bufferType = ContentBlockType.PARAGRAPH;
    }

    flushBuffer();

    if (currentBlocks.length > 0) {
      sections.push({
        sectionId: `section-${sections.length + 1}`,
        sectionPath: [currentSectionTitle],
        blocks: currentBlocks
      });
    }

    return sections;
  }
  // ==========================================================
  // HELPERS
  // ==========================================================

  private _isSectionHeader(line: string): boolean {
    // Markdown headers
    if (line.startsWith('#')) return true;

    // Underline-style headers (e.g. "====")
    if (line.length > 3 && Array.from(line).every(c => c === '=')) return true;

    // Numbered section headers like "1. Document Information" or "12. Migration Strategy"
    // Must have digit(s), period, space, then text — short enough to be a title (not a list item sentence)
    if (/^\d+\.\s+[A-Z]/.test(line) && line.length < 120 && !line.endsWith('.')) return true;

    // NOTE: Removed the all-caps heuristic (line.toUpperCase() === line).
    // It was too aggressive — treating short uppercase lines like "INDIA", "MUMBAI",
    // "MT700, MT701, MT707" as section headers, which fragmented documents into
    // tiny chunks and destroyed semantic context for RAG retrieval.

    return false;
  }

  private _extractTitle(text: string): string {
    for (const line of text.split('\n')) {
      if (line.startsWith('# ')) {
        return line.slice(2).trim();
      }
    }
    return 'Untitled Document';
  }

  private _generateSummary(text: string): string {
    const lines = text.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
    return lines.slice(0, 3).join(' ').slice(0, 500);
  }
}
