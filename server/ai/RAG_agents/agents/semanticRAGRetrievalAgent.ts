/**
 * Semantic RAG Retrieval Agent - FAISS Vector Implementation
 * 
 * Uses FAISS vector similarity search for optimal semantic retrieval performance
 * Combines FAISS speed with database persistence for production deployment
 */

import type { 
  SemanticChunk, 
  NormalizedDocument, 
  Requirement 
} from '../models';
import { faissVectorService } from '../faissVectorService.js';

export class SemanticRAGRetrievalAgent {
  private chunkStore: Record<string, SemanticChunk>;
  private normalizedDocs: Record<string, NormalizedDocument>;
  private chunkSource: 'project' | 'devx';

  constructor(
    chunkStore: Record<string, SemanticChunk>,
    normalizedDocs: Record<string, NormalizedDocument>,
    options?: { chunkSource?: 'project' | 'devx' }
  ) {
    console.log("[SemanticRAG] Initializing Semantic RAG - FAISS for optimal performance");
    this.chunkStore = chunkStore;
    this.normalizedDocs = normalizedDocs;
    this.chunkSource = options?.chunkSource ?? 'project';
  }

  /**
   * Retrieve semantically similar chunks using vector search
   */
  async retrieveForRequirement(
    requirement: Requirement,
    matchedDocuments: string[],
    projectId: string,
    topK: number = 5,
    scoreThreshold: number = 0.7
  ): Promise<SemanticChunk[]> {

    console.log(`\n[SemanticRAG] 🔍 Retrieving for requirement: ${requirement.requirementId}`);
    console.log(`[SemanticRAG] Query: ${requirement.description}`);
    console.log(`[SemanticRAG] Matched documents: ${matchedDocuments.length}`);

    try {
      // Build search query from requirement
      const searchQuery = this.buildSearchQuery(requirement);
      console.log(`[SemanticRAG] Search query: ${searchQuery}`);

      // Get guideline IDs from matched documents (matchedDocuments are doc keys or sourceFile from batch matcher)
      const guidelineIds: string[] = [];
      
      if (matchedDocuments && matchedDocuments.length > 0) {
        for (const docKeyOrName of matchedDocuments) {
          const doc = this.normalizedDocs[docKeyOrName]
            ?? Object.values(this.normalizedDocs).find(d => d.sourceFile === docKeyOrName);
          if (doc && doc.id) {
            guidelineIds.push(doc.id); // Use vectorized_guidelines.id (UUID) for FAISS
          }
        }
      } else {
        // If no specific documents, search all available guidelines
        Object.values(this.normalizedDocs).forEach(doc => {
          if (doc.id) {
            guidelineIds.push(doc.id); // Keep as string for FAISS
          }
        });
      }

      console.log(`[SemanticRAG] Searching in ${guidelineIds.length} guidelines: ${guidelineIds}`);

      // Perform FAISS vector similarity search
      const searchResults = await faissVectorService.searchSimilar(
        searchQuery,
        guidelineIds,
        topK * 2, // Get more results to ensure we have enough after filtering
        scoreThreshold,
        { source: this.chunkSource }
      );

      console.log(`[SemanticRAG] Found ${searchResults.length} semantically similar chunks with FAISS`);

      // Convert FAISS results to SemanticChunk format
      const retrievedChunks: SemanticChunk[] = [];
      
      for (const result of searchResults) {
        // Create SemanticChunk from FAISS result
        const chunk: SemanticChunk = {
          chunkId: `chunk_${result.guidelineId}_${result.chunkIndex}`,
          content: result.content,
          metadata: {
            chunkId: `chunk_${result.guidelineId}_${result.chunkIndex}`,
            chunkType: 'semantic' as any,
            sectionPath: result.metadata?.sectionPath || ['cached'],
            docId: result.guidelineId.toString(),
            sourceFile: this.getGuidelineNameFromId(result.guidelineId.toString()),
            tokenCount: result.content.length,
            isAtomic: false,
            semanticScore: result.similarity // Add similarity score from FAISS
          },
          isComplete: true,
          validationStatus: 'valid'
        };

        retrievedChunks.push(chunk);

        if (retrievedChunks.length >= topK) {
          break;
        }
      }

      console.log(`[SemanticRAG] ✅ Retrieved ${retrievedChunks.length} chunks with avg similarity: ${this.calculateAverageScore(searchResults.slice(0, retrievedChunks.length))}`);
      
      return retrievedChunks;

    } catch (error) {
      console.error('[SemanticRAG] Error in semantic retrieval:', error);
      
      // Fallback to keyword-based retrieval if vector search fails
      console.log('[SemanticRAG] ⚠️ Falling back to keyword-based retrieval...');
      return this.fallbackKeywordRetrieval(requirement, matchedDocuments, topK);
    }
  }

  /**
   * Build optimized search query from requirement
   */
  private buildSearchQuery(requirement: Requirement): string {
    // Combine description and keywords for richer semantic context
    const queryParts = [requirement.description];
    
    if (requirement.keywords && requirement.keywords.length > 0) {
      queryParts.push(`Keywords: ${requirement.keywords.join(', ')}`);
    }

    return queryParts.join(' ');
  }

  /**
   * Get guideline name from guideline ID (for document filtering)
   */
  private getGuidelineNameFromId(guidelineId: string): string {
    // This is a simplified version - in a real implementation,
    // you might need to query the database or maintain a mapping
    const doc = Object.values(this.normalizedDocs).find(d => d.id === guidelineId);
    return doc?.sourceFile || 'unknown_guideline.md';
  }

  /**
   * Calculate average similarity score
   */
  private calculateAverageScore(results: Array<{ similarity: number }>): number {
    if (results.length === 0) return 0;
    const sum = results.reduce((acc, result) => acc + result.similarity, 0);
    return Math.round((sum / results.length) * 100) / 100;
  }

  /**
   * Fallback keyword-based retrieval (original method)
   */
  private fallbackKeywordRetrieval(
    requirement: Requirement,
    matchedDocuments: string[],
    topK: number
  ): SemanticChunk[] {
    console.log('[SemanticRAG] Using fallback keyword retrieval...');
    
    const scoredChunks: Array<{ chunk: SemanticChunk; score: number }> = [];

    for (const chunk of Object.values(this.chunkStore)) {
      if (matchedDocuments && matchedDocuments.length > 0) {
        const doc = this.normalizedDocs[chunk.metadata.docId];
        // matchedDocuments contains docId keys (e.g. "doc_feature_guideline_md") from batch matcher,
        // so check both the docId key and the sourceFile name for a match
        if (!doc || (!matchedDocuments.includes(chunk.metadata.docId) && !matchedDocuments.includes(doc.sourceFile))) {
          continue;
        }
      }

      const score = this.scoreChunkKeywords(chunk, requirement);
      if (score > 0) {
        scoredChunks.push({ chunk, score });
      }
    }

    scoredChunks.sort((a, b) => b.score - a.score);
    const selected = scoredChunks.slice(0, topK).map(item => item.chunk);
    
    console.log(`[SemanticRAG] Fallback retrieved ${selected.length} chunks`);
    return selected;
  }

  /**
   * Keyword-based scoring (fallback method)
   */
  private scoreChunkKeywords(chunk: SemanticChunk, requirement: Requirement): number {
    const content = chunk.content.toLowerCase();
    let score = 0.0;

    for (const kw of requirement.keywords || []) {
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