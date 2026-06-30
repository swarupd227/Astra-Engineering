/**
 * RAG Retrieval Agent - TypeScript Implementation
 * 
 * Retrieval-only agent.
 * Returns semantically relevant chunks.
 * Does NOT construct API response models.
 */

import type { 
  SemanticChunk, 
  NormalizedDocument, 
  Requirement 
} from '../models';

export class RAGRetrievalAgent {
  private chunkStore: Record<string, SemanticChunk>;
  private normalizedDocs: Record<string, NormalizedDocument>;

  constructor(
    chunkStore: Record<string, SemanticChunk>,
    normalizedDocs: Record<string, NormalizedDocument>
  ) {
    // console.log("Initializing RAG Retrieval Agent...");
    this.chunkStore = chunkStore;
    this.normalizedDocs = normalizedDocs;
  }

  // ======================================================
  // RETRIEVE CHUNKS
  // ======================================================

  retrieveForRequirement(
    requirement: Requirement,
    matchedDocuments: string[],
    topK: number = 5
  ): SemanticChunk[] {

    // console.log("\n[RAG RETRIEVAL]");
    // console.log(`  Requirement: ${requirement.requirementId}`);
    // console.log(`  Keywords: ${requirement.keywords}`);

    const scoredChunks: Array<{ chunk: SemanticChunk; score: number }> = [];

    for (const chunk of Object.values(this.chunkStore)) {
      if (matchedDocuments && matchedDocuments.length > 0) {
        const doc = this.normalizedDocs[chunk.metadata.docId];
        if (!doc || !matchedDocuments.includes(doc.sourceFile)) {
          continue;
        }
      }

      const score = this.scoreChunk(chunk, requirement);
      if (score > 0) {
        scoredChunks.push({ chunk, score });
      }
    }

    scoredChunks.sort((a, b) => b.score - a.score);

    const selected = scoredChunks.slice(0, topK).map(item => item.chunk);

    // console.log(`  Retrieved ${selected.length} chunks`);
    return selected;
  }

  // ======================================================
  // SCORING
  // ======================================================

  private scoreChunk(chunk: SemanticChunk, requirement: Requirement): number {
    /**
     * Lightweight semantic scoring.
     * (Vector DB can replace this later.)
     */
    const content = chunk.content.toLowerCase();
    let score = 0.0;

    for (const kw of requirement.keywords) {
      if (content.includes(kw.toLowerCase())) {
        score += 1.0;
      }
    }

    if (content.includes(requirement.description.toLowerCase())) {
      score += 0.5;
    }

    return score;
  }
}
