// Configuration - TypeScript equivalent of config.py
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

/**
 * Pipeline mode switch:
 * - 'cag_pageindex': CAG + PageIndex — stuffs full/indexed content into context (no FAISS retrieval)
 * - 'rag_pageindex': RAG + PageIndex hybrid — PageIndex for 100% coverage + FAISS for deep detail
 */
export type PipelineMode = 'rag_pageindex' | 'cag_pageindex';

interface RAGConfig {
  // Azure OpenAI Configuration
  AZURE_OPENAI_API_KEY: string | undefined;
  AZURE_OPENAI_API_VERSION: string | undefined;
  AZURE_OPENAI_DEPLOYMENT: string | undefined;
  AZURE_OPENAI_FAST_DEPLOYMENT: string | undefined;
  AZURE_OPENAI_ENDPOINT: string | undefined;

  // Azure Embedding Configuration
  AZURE_EMBEDDING_DEPLOYMENT: string | undefined;
  AZURE_EMBEDDING_ENDPOINT: string | undefined;
  AZURE_EMBEDDING_API_KEY: string | undefined;
  AZURE_EMBEDDING_API_VERSION: string | undefined;

  // Vector Store Configuration
  BASE_DIR: string;
  CHROMA_PERSIST_DIR: string;
  GUIDELINES_DIR: string;

  // Agent Configuration
  CHUNK_SIZE: number;
  CHUNK_OVERLAP: number;
  TOP_K_RESULTS: number;
  PAGEINDEX_MAX_PARALLEL_SECTIONS: number;
  DISABLE_PAGEINDEX: boolean;
}

class Config {
  private normalizeOptionalDeployment(value: string | undefined): string | undefined {
    const normalized = (value ?? "").trim();
    if (!normalized) return undefined;
    const lowered = normalized.toLowerCase();
    if (["false", "off", "0", "no", "disabled"].includes(lowered)) {
      return undefined;
    }
    return normalized;
  }

  // Azure OpenAI Configuration
  AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;
  AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION;
  AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;
  // Optional: a faster/cheaper deployment for extraction steps (e.g. requirement extraction)
  AZURE_OPENAI_FAST_DEPLOYMENT = this.normalizeOptionalDeployment(process.env.AZURE_OPENAI_FAST_DEPLOYMENT);
  AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;

  // Azure Embedding Configuration
  AZURE_EMBEDDING_DEPLOYMENT = process.env.AZURE_EMBEDDING_DEPLOYMENT;
  AZURE_EMBEDDING_ENDPOINT = process.env.AZURE_EMBEDDING_ENDPOINT;
  AZURE_EMBEDDING_API_KEY = process.env.AZURE_EMBEDDING_API_KEY;
  AZURE_EMBEDDING_API_VERSION = process.env.AZURE_EMBEDDING_API_VERSION;

  // Vector Store Configuration
  // Use process.cwd() for compatibility in both CommonJS and ES modules
  BASE_DIR = process.cwd();
  CHROMA_PERSIST_DIR = path.join(this.BASE_DIR, "chroma_db");
  GUIDELINES_DIR = path.join(this.BASE_DIR, "guidelines");

  // =========================================================
  // RAG CHUNKING CONFIG (only used in rag_pageindex mode)
  // =========================================================
  // TWEAK: Increase CHUNK_SIZE for more context per chunk (fewer chunks, less embedding calls)
  //        Decrease for more granular retrieval (more chunks, better precision)
  // TWEAK: Increase CHUNK_OVERLAP if chunks miss context at boundaries
  // TWEAK: Increase TOP_K_RESULTS to retrieve more chunks per requirement (higher coverage, more tokens)
  CHUNK_SIZE = 2500;       // chars per chunk (~625 tokens). Range: 1000-5000
  CHUNK_OVERLAP = 300;     // overlap between chunks. Range: 100-500
  TOP_K_RESULTS = 15;      // chunks retrieved per requirement. Range: 5-30

  // =========================================================
  // PIPELINE MODE SWITCH                     [ENV: RAG_PIPELINE_MODE]
  // =========================================================
  //
  // ┌─────────────────────┬──────────────────────────────────────────────────┐
  // │ 'cag_pageindex'     │ CAG-first mode.                                 │
  // │ (DEFAULT)           │ Skips: chunking, embeddings, FAISS, batch match │
  // │                     │ Runs:  Phase 1 (extract reqs) + PageIndex       │
  // │                     │ Best:  Small-medium files (<30K), speed          │
  // │                     │ LLM calls: 1 + 0-N (only for Tier 2/3 docs)    │
  // ├─────────────────────┼──────────────────────────────────────────────────┤
  // │ 'rag_pageindex'     │ RAG + PageIndex hybrid mode.                    │
  // │                     │ Runs:  ALL phases (1-4) + PageIndex in parallel │
  // │                     │ Best:  Large files, needs semantic depth         │
  // │                     │ LLM calls: N+2 (RAG) + 0-N (PageIndex)          │
  // └─────────────────────┴──────────────────────────────────────────────────┘
  //
  // TWEAK: Switch mode via env var:
  //   RAG_PIPELINE_MODE=cag_pageindex npm run dev   (fast, fewer LLM calls)
  //   RAG_PIPELINE_MODE=rag_pageindex npm run dev   (thorough, semantic depth)
  PIPELINE_MODE: PipelineMode = (process.env.RAG_PIPELINE_MODE as PipelineMode) || 'cag_pageindex';

  // =========================================================
  // COVERAGE CHECKER (LLM-based)             [ENV: RAG_COVERAGE_CHECK]
  // =========================================================
  // When enabled, an extra LLM call verifies the final ragGuidance against source docs
  // and logs a coverage report: codes found, codes missing, coverage %.
  //
  // TWEAK: Set to 'false' in production for speed. Set to 'true' during testing.
  //   RAG_COVERAGE_CHECK=true npm run dev    (enable)
  //   RAG_COVERAGE_CHECK=false npm run dev   (disable, default)
  COVERAGE_CHECK_ENABLED = (process.env.RAG_COVERAGE_CHECK ?? 'false') === 'true';

  // =========================================================
  // PageIndex TIER THRESHOLDS (characters)
  // =========================================================
  //
  // How documents are processed based on size:
  //
  // ┌──────────────┬──────────────────┬────────────────────────────────────────┐
  // │ Tier         │ Size range       │ What happens                           │
  // ├──────────────┼──────────────────┼────────────────────────────────────────┤
  // │ Tier 1       │ 0 - 30K chars    │ Full passthrough (ZERO loss)           │
  // │ Tier 2       │ 30K - 100K chars │ Single LLM page-index call             │
  // │ Tier 3       │ 100K+ chars      │ Section-by-section index → merge       │
  // └──────────────┴──────────────────┴────────────────────────────────────────┘
  //
  // TWEAK: Increase TIER1 to pass more docs through raw (uses more context budget)
  // TWEAK: Increase TIER2 to avoid section splitting for medium-large docs
  PAGEINDEX_TIER1_MAX_CHARS = 30000;   // Below this → full passthrough
  PAGEINDEX_TIER2_MAX_CHARS = 100000;  // Below this → single LLM index. Above → section-by-section

  // TWEAK: Decrease SECTION_SIZE for higher fidelity (more LLM calls, less compression per section)
  //        Increase SECTION_SIZE for fewer LLM calls (more compression, lower fidelity)
  PAGEINDEX_SECTION_SIZE = 10000;      // chars per section for Tier 3. Range: 5000-25000

  // TWEAK: Increase for more detailed section indices (uses more output tokens)
  //        Must not exceed LLM's max output limit (16K for most Azure deployments)
  PAGEINDEX_SECTION_MAX_TOKENS = 10000;  // max output tokens per section index call
  PAGEINDEX_DOC_MAX_TOKENS = 10000;      // max output tokens for Tier 2 full-doc index

  // Cap parallel section-index LLM calls (Tier 3) to avoid 429 rate limits
  PAGEINDEX_MAX_PARALLEL_SECTIONS = Number(process.env.PAGEINDEX_MAX_PARALLEL_SECTIONS || "4");

  // Disable PageIndex entirely (avoids extra LLM calls; fastest path)
  DISABLE_PAGEINDEX = (process.env.RAG_DISABLE_PAGEINDEX ?? "false") === "true";

  // =========================================================
  // CAG CONTEXT BUDGET (characters)
  // =========================================================
  // Only applies to 'cag_pageindex' mode.
  // Max combined guideline size stuffed into the BRD LLM context.
  // Documents exceeding this get PageIndex-compressed.
  //
  // ~400K chars ≈ 100K tokens — leaves room for BRD prompt (~50K tokens) + output (12K tokens)
  //
  // TWEAK: Increase if your LLM has a larger context window (e.g., 500K for 128K token models)
  //        Decrease if BRD generation is hitting context limits
  CAG_CONTEXT_BUDGET_CHARS = 400000;   // Range: 200000-600000
}

const config = new Config();

export { config };
