/**
 * Production-Grade RAG Pipeline Data Models
 * Structure-aware, semantic-safe, synthesis-first
 */

// =====================================================
// API REQUEST MODELS
// =====================================================

export interface Guideline {
  id: string;
  name: string;
  path: string;
  content: string;
}

export interface ProcessingRequest {
  sessionId: string;
  guidelines: Guideline[];  // Client-provided guidelines
  userQuery?: string;
  requirementId?: string;  // Optional single requirement ID for filtering
  requirementIds?: string[];  // Optional multiple requirement IDs for filtering
  context?: any;  // Optional context data
}

// =====================================================
// DOCUMENT STRUCTURE MODELS
// =====================================================

export enum ContentBlockType {
  PARAGRAPH = 'paragraph',
  TABLE = 'table',
  FORMULA = 'formula',
  CODE_BLOCK = 'code_block',
  FIGURE = 'figure',
  DEFINITION = 'definition',
  SECTION_HEADER = 'section_header'
}

export enum ChunkType {
  TABLE = 'table',
  FORMULA = 'formula',
  PARAGRAPH = 'paragraph',
  SECTION_SUMMARY = 'section_summary',
  CODE_BLOCK = 'code_block',
  FIGURE = 'figure'
}

export interface ContentBlock {
  type: ContentBlockType;
  content: string;
  label?: string;
  caption?: string;
  metadata: Record<string, any>;
}

export interface DocumentSection {
  sectionPath: string[];
  sectionId: string;
  blocks: ContentBlock[];
  parentSectionId?: string;
}

export interface NormalizedDocument {
  id: string;
  sourceFile: string;
  docType: string;
  title: string;
  summary: string;
  sections: DocumentSection[];
  totalBlocks: number;
  extractedStructure?: {
    method: string;
    sections: number;
    timestamp: string;
  };
  createdAt?: Date;
}

// =====================================================
// CHUNK MODELS (INTERNAL ONLY)
// =====================================================

export interface ChunkMetadata {
  chunkId: string;
  chunkType: ChunkType;
  sectionPath: string[];
  docId: string;
  sourceFile: string;
  tokenCount: number;
  parentSectionId?: string;
  prevChunkId?: string;
  nextChunkId?: string;
  isAtomic?: boolean;
  createdAt?: Date;
  semanticScore?: number; // Semantic similarity score for retrieval
}

export interface SemanticChunk {
  chunkId: string;
  content: string;
  metadata: ChunkMetadata;
  isComplete: boolean;
  validationStatus: string;
}

// =====================================================
// REQUIREMENT MODELS
// =====================================================

export interface Requirement {
  requirementId: string;
  category: 'functional' | 'non-functional' | 'constraint' | 'dependency' | 'priority';
  description: string;
  acceptanceCriteria?: string;
  priority: string;
  keywords: string[];
}

export interface ExtractedRequirements {
  requirements: Requirement[];
  totalCount?: number;
  extractionTimestamp: Date;
  brdSummary?: string;
}

// =====================================================
// RAG OUTPUT MODELS (SYNTHESIS-FIRST)
// =====================================================

export interface RAGResult {
  /**
   * FINAL result per requirement (API-safe)
   */
  requirementId: string;
  requirementDescription: string;
  finalSummary: string;
  totalChunksFound: number;
  coverage: number;
}

/** Per-file discovery info for BRD RAG debug */
export interface RagDebugFileDiscovered {
  path: string;
  name: string;
  extension: string;
}

/** Per-file skip info for BRD RAG debug */
export interface RagDebugFileSkipped {
  path: string;
  name: string;
  extension: string;
  reason: string;
}

/** Per-file read/parse result for BRD RAG debug */
export interface RagDebugParseResult {
  name: string;
  path: string;
  parseStatus: 'success' | 'failed' | 'cache_hit';
  parseError?: string;
  extractedTextLength: number;
  chunkCount: number;
  contributedToSummary: boolean;
}

/** Debug payload for BRD RAG pipeline (included in response when BRD_RAG_DEBUG or brdRagDebug is enabled) */
export interface RagDebugPayload {
  enabled: true;
  filesDiscovered: RagDebugFileDiscovered[];
  filesSelected: string[];
  filesSkipped: RagDebugFileSkipped[];
  parseResults: RagDebugParseResult[];
  finalFilesUsedForSummary: string[];
  summaryInputCharCount: number;
}

export interface RAGProcessingResponse {
  success: boolean;
  message: string;
  sessionId: string;
  
  // Frontend uses THIS
  finalSummary: string;
  
  // Internal / debugging
  extractedRequirements: ExtractedRequirements;
  ragResults: RAGResult[];  // Per-requirement summaries for traceability
  vectorDbInstances: VectorDBInstance[];
  processingTimestamp: Date;
  totalChunksRetrieved: number;
  coveragePercentage: number;

  /** Present when RAG was run with debug enabled */
  ragDebug?: RagDebugPayload;
}

// =====================================================
// VECTOR DB & SESSION TRACKING
// =====================================================

export interface VectorDBInstance {
  instanceId: string;

  // Upload-safe identifiers
  sourceId: string;
  sourceName: string;
  sourceType: 'upload' | 'filesystem' | 's3';

  docId: string;
  documentType: string;
  vectorDbType: string;
  persistPath: string;
  chunkCount: number;
  status: string;

  createdAt: Date;
}

export interface ProcessingSession {
  sessionId: string;
  projectId: string; // Project identifier for vector collection isolation
  status: string;

  extractedRequirements?: ExtractedRequirements;
  ragResults: RAGResult[];
  vectorDbInstances: VectorDBInstance[];

  errorMessage?: string;
  createdAt: Date;
  completedAt?: Date;
}

// =====================================================
// LLM CLIENT INTERFACES
// =====================================================

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /**
   * When true, use AZURE_OPENAI_FAST_DEPLOYMENT if configured.
   * Intended for faster extraction steps (e.g., requirement extraction).
   */
  useFastModel?: boolean;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface LLMResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
}
