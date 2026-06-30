# Tiered RAG Approach for 100% Document Retrieval

## Problem
Current RAG pipeline is lossy: documents are chunked → only TOP_K (15) chunks retrieved per requirement via FAISS → synthesis. This means large portions of guideline content never reach the BRD prompt.

## Solution: Size-Aware Tiered Processing
Replace the current 5-phase pipeline with a tiered approach that guarantees 100% document content reaches the BRD LLM.

### Tier Definitions
- **Tier 1 (<30K chars, ~7.5K tokens)**: Pass entire document content directly — zero loss
- **Tier 2 (30K-100K chars, ~7.5K-25K tokens)**: Single LLM summary call preserving all codes/specs/tables → ~15K output
- **Tier 3 (100K+ chars, ~25K+ tokens)**: Section-by-section summarization → merge → consolidation pass

### Why This Works
- `ragGuidance` has NO size limit in the BRD prompt (line 1829 of brd-ai-service.ts)
- Claude Opus 4.1 has ~200K token context window with 12K max output
- Practical budget for ragGuidance: ~100K+ tokens after system prompt/input/output reservation
- Most guideline files are <30K chars → Tier 1 passthrough covers majority of cases

## Implementation Steps

### Step 1: Add `tieredProcessGuidelines` method to `OptimizedRAGOrchestrator`
**File**: `server/ai/RAG_agents/optimizedRAGOrchestrator.ts`

Add a new private method that:
1. Categorizes each guideline by size (Tier 1/2/3)
2. Tier 1: Returns raw content directly
3. Tier 2: Calls `llmClient.generateCompletion` with a preservation-focused prompt (max_tokens: 4000 is limiting — we'll need to handle this)
4. Tier 3: Splits by sections, summarizes each, merges results
5. Returns combined full-content string for all guidelines

### Step 2: Add `summarizeForFullRetrieval` method to `ResponseSynthesisAgent`
**File**: `server/ai/RAG_agents/agents/responseSynthesisAgent.ts`

Add two new methods:
- `summarizeDocument(content: string)`: Single-pass summary for Tier 2 docs, preserving all codes/identifiers/tables
- `summarizeSections(sections: {title: string, content: string}[])`: Section-by-section for Tier 3 docs

### Step 3: Modify `processBrdWithGuidelines` to use tiered approach
**File**: `server/ai/RAG_agents/optimizedRAGOrchestrator.ts`

In the main method, add a new step between Phase 2 (guideline processing) and Phase 5 (final synthesis):
- Call `tieredProcessGuidelines` on the raw guideline documents
- This produces a `fullContentGuidance` string that contains 100% of document content (either raw or summarized)
- Use this `fullContentGuidance` as the `finalSummary` instead of going through the lossy Phase 3→4→5 pipeline

**Key change**: For Tier 1 docs, skip chunking/FAISS/retrieval entirely. For Tier 2/3, use LLM summarization instead of chunk retrieval.

### Step 4: Keep existing chunking pipeline as fallback
The existing 5-phase pipeline stays intact for:
- Cache/vector store building (still useful for future queries)
- Fallback if tiered approach fails
- Debug/analytics purposes

### Step 5: Update config with tier thresholds
**File**: `server/ai/RAG_agents/config.ts`

Add:
```typescript
TIER1_MAX_CHARS = 30000;   // ~7.5K tokens — pass through directly
TIER2_MAX_CHARS = 100000;  // ~25K tokens — single LLM summary
// Above TIER2_MAX_CHARS → Tier 3 section-by-section
```

### Step 6: Handle `max_tokens: 4000` limitation in llmClient
The current `generateCompletion` has `max_tokens: 4000`. For Tier 2/3 summarization, we need larger outputs. Options:
- Add an optional `maxTokens` parameter to `generateCompletion`
- Or create a separate method for long-form generation

## File Changes Summary
1. `server/ai/RAG_agents/config.ts` — Add tier thresholds
2. `server/ai/RAG_agents/llmClient.ts` — Support configurable max_tokens
3. `server/ai/RAG_agents/agents/responseSynthesisAgent.ts` — Add summarization methods
4. `server/ai/RAG_agents/optimizedRAGOrchestrator.ts` — Add tiered processing, modify main flow

## Risk Mitigation
- Tier 1 passthrough is zero-risk (no LLM call, no loss)
- Tier 2/3 summarization preserves codes/identifiers via explicit prompt instructions
- Existing pipeline kept as fallback
- If total combined content exceeds context budget (~400K chars), fall back to existing chunked approach
