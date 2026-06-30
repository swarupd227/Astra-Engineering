import { randomUUID } from 'crypto';
import type { 
  NormalizedDocument, 
  SemanticChunk, 
  ChunkMetadata
} from '../models';
import { 
  ChunkType,
  ContentBlockType
} from '../models';
import { llmClient } from '../llmClient';

export class SmartChunkingEngine {
  private targetChunkSize: number;
  private maxChunkSize: number;
  private overlapTokens: number;
  private tokenizerModel: string;
  private chunks: Map<string, SemanticChunk> = new Map();

  constructor(
    targetChunkSize: number = 800,
    maxChunkSize: number = 1200,
    overlapTokens: number = 150,
    tokenizerModel: string = 'gpt-4o-mini'
  ) {
    this.targetChunkSize = targetChunkSize;
    this.maxChunkSize = maxChunkSize;
    this.overlapTokens = overlapTokens;
    this.tokenizerModel = tokenizerModel;
  }

  // ======================================================
  // PUBLIC ENTRY
  // ======================================================

  chunkDocument(normalizedDoc: NormalizedDocument): SemanticChunk[] {
    const chunks: SemanticChunk[] = [];

    for (const section of normalizedDoc.sections) {
      const sectionChunks = this._chunkWholeSection(
        section,
        normalizedDoc.id,
        normalizedDoc.sourceFile
      );
      chunks.push(...sectionChunks);
    }

    this._linkChunks(chunks);

    for (const c of chunks) {
      this.chunks.set(c.chunkId, c);
    }

    return chunks;
  }

  // ======================================================
  // CORE LOGIC Î“Ã‡Ã¶ SECTION FIRST
  // ======================================================

  private _chunkWholeSection(
    section: any,
    docId: string,
    sourceFile: string
  ): SemanticChunk[] {
    const units = this._mergeSectionBlocks(section.blocks);

    const chunks: SemanticChunk[] = [];
    let buffer: string[] = [];
    let bufferTokens = 0;

    for (const unit of units) {
      const unitTokens = this._countTokens(unit.text);

      // Atomic units must stand alone
      if (unit.isAtomic) {
        if (buffer.length > 0) {
          chunks.push(
            this._createChunk(
              buffer.join('\n'),
              bufferTokens,
              docId,
              sourceFile,
              section,
              ChunkType.PARAGRAPH,
              false
            )
          );
          buffer = [];
          bufferTokens = 0;
        }

        chunks.push(
          this._createChunk(
            unit.text,
            unitTokens,
            docId,
            sourceFile,
            section,
            this._mapBlockType(unit.type),
            true
          )
        );
        continue;
      }

      // Non-atomic accumulation
      if (bufferTokens + unitTokens > this.maxChunkSize) {
        chunks.push(
          this._createChunk(
            buffer.join('\n'),
            bufferTokens,
            docId,
            sourceFile,
            section,
            ChunkType.PARAGRAPH,
            false
          )
        );
        buffer = [];
        bufferTokens = 0;
      }

      buffer.push(unit.text);
      bufferTokens += unitTokens;
    }

    if (buffer.length > 0) {
      chunks.push(
        this._createChunk(
          buffer.join('\n'),
          bufferTokens,
          docId,
          sourceFile,
          section,
          ChunkType.PARAGRAPH,
          false
        )
      );
    }

    return chunks;
  }

  // ======================================================
  // SECTION SPLITTING (ONLY WHEN REQUIRED)
  // ======================================================

  private _splitLargeSection(
    text: string,
    docId: string,
    sourceFile: string,
    section: any
  ): SemanticChunk[] {
    const chunks: SemanticChunk[] = [];
    const tokens = this._getTokens(text);

    let start = 0;
    while (start < tokens.length) {
      const end = Math.min(start + this.targetChunkSize, tokens.length);
      const chunkTokens = tokens.slice(start, end);
      const chunkText = this._decodeTokens(chunkTokens);

      chunks.push(
        this._createChunk(
          chunkText,
          chunkTokens.length,
          docId,
          sourceFile,
          section,
          ChunkType.PARAGRAPH,
          false
        )
      );

      start = end - this.overlapTokens;
    }

    return chunks;
  }

  // ======================================================
  // BLOCK MERGING (THE KEY FIX)
  // ======================================================

  private _mergeSectionBlocks(blocks: any[]): Array<{
    text: string;
    type: ContentBlockType;
    isAtomic: boolean;
  }> {
    const merged: Array<{
      text: string;
      type: ContentBlockType;
      isAtomic: boolean;
    }> = [];

    for (const block of blocks) {
      merged.push({
        text: block.content,
        type: block.type,
        isAtomic: [
          ContentBlockType.TABLE,
          ContentBlockType.FORMULA,
          ContentBlockType.CODE_BLOCK,
          ContentBlockType.FIGURE
        ].includes(block.type)
      });
    }

    return merged;
  }

  // ======================================================
  // CHUNK CREATION
  // ======================================================

  private _createChunk(
    text: string,
    tokens: number,
    docId: string,
    sourceFile: string,
    section: any,
    chunkType: ChunkType,
    isAtomic: boolean
  ): SemanticChunk {
    const chunkId = randomUUID();
    const summary = this._summarize(text);

    const metadata: ChunkMetadata = {
      chunkId,
      chunkType,
      sectionPath: section.sectionPath,
      docId,
      sourceFile,
      isAtomic,
      tokenCount: tokens,
      parentSectionId: section.sectionId
    };

    return {
      chunkId,
      content: text, // Î“ÃœÃ¡âˆ©â••Ã… ALWAYS RAW - Never summarize at chunk level
      metadata,
      isComplete: true,
      validationStatus: 'valid'
    };
  }

  // ======================================================
  // HELPERS
  // ======================================================

  private _countTokens(text: string): number {
    // Simple approximation: 4 chars per token
    return Math.ceil(text.length / 4);
  }

  private _getTokens(text: string): number[] {
    // Simple tokenization approximation
    const words = text.split(/\s+/);
    return Array.from({length: words.length}, (_, i) => i);
  }

  private _decodeTokens(tokens: number[]): string {
    // Simple approximation - in real implementation would use proper tokenizer
    return tokens.map(t => `token_${t}`).join(' ');
  }

  private _summarize(text: string): string {
    // Simple summarization - first few sentences
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return sentences.slice(0, 2).join('. ').slice(0, 150) + '...';
  }

  private _linkChunks(chunks: SemanticChunk[]): void {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (i > 0) {
        chunk.metadata.prevChunkId = chunks[i - 1].chunkId;
      }
      if (i < chunks.length - 1) {
        chunk.metadata.nextChunkId = chunks[i + 1].chunkId;
      }
    }
  }

  private _mapBlockType(blockType: ContentBlockType): ChunkType {
    const mapping: Record<ContentBlockType, ChunkType> = {
      [ContentBlockType.PARAGRAPH]: ChunkType.PARAGRAPH,
      [ContentBlockType.DEFINITION]: ChunkType.PARAGRAPH,
      [ContentBlockType.SECTION_HEADER]: ChunkType.PARAGRAPH,
      [ContentBlockType.TABLE]: ChunkType.TABLE,
      [ContentBlockType.FORMULA]: ChunkType.FORMULA,
      [ContentBlockType.CODE_BLOCK]: ChunkType.CODE_BLOCK,
      [ContentBlockType.FIGURE]: ChunkType.FIGURE
    };
    return mapping[blockType] || ChunkType.PARAGRAPH;
  }
}
