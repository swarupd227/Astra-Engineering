import { llmClient } from './llmClient.js';
import { db } from '../../db.js';
import * as schema from '@shared/schema';
import { eq, and, asc } from 'drizzle-orm';

// Optional import of faiss-node - handle gracefully if native module fails to load
// Lazy-loaded to avoid blocking module initialization
let faiss: any = null;
let IndexFlatIP: any = null;
let faissAvailable = false;
let faissLoadAttempted = false;
let faissLoadPromise: Promise<boolean> | null = null;

// Function to safely load faiss-node (lazy-loaded, only when needed)
async function loadFaissModule(): Promise<boolean> {
  // Return cached result if already attempted
  if (faissLoadAttempted) {
    return faissAvailable;
  }
  
  // If a load is in progress, wait for it
  if (faissLoadPromise) {
    return await faissLoadPromise;
  }
  
  // Start loading
  faissLoadPromise = (async () => {
    faissLoadAttempted = true;
    
    try {
      // Try dynamic import (works in both ESM and CommonJS)
      const faissModule = await import('faiss-node');
      faiss = faissModule.default || faissModule;
      IndexFlatIP = faiss?.IndexFlatIP;
      faissAvailable = !!IndexFlatIP;
      
      if (faissAvailable) {
        console.log('[FAISS] ✅ Native module loaded successfully');
        return true;
      } else {
        console.warn('[FAISS] ⚠️ faiss-node module loaded but IndexFlatIP not available');
        return false;
      }
    } catch (error: any) {
      // If dynamic import fails, try require (for CommonJS contexts)
      try {
        if (typeof require !== 'undefined') {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          faiss = require('faiss-node');
          IndexFlatIP = faiss?.IndexFlatIP;
          faissAvailable = !!IndexFlatIP;
          
          if (faissAvailable) {
            console.log('[FAISS] ✅ Native module loaded successfully (via require)');
            return true;
          }
        }
      } catch (requireError) {
        // Both import and require failed
      }
      
      console.warn('[FAISS] ⚠️ faiss-node native module not available:', error?.message || String(error));
      console.warn('[FAISS] ⚠️ Vector search will fall back to database-only mode');
      faissAvailable = false;
      return false;
    }
  })();
  
  return await faissLoadPromise;
}

export class FaissVectorService {
  private static indexCache: Map<string, any> = new Map();
  private static detectedDimension: number | null = null;

  private static getVectorDimension(sampleVector?: number[]): number {
    if (sampleVector && sampleVector.length > 0) {
      if (FaissVectorService.detectedDimension !== sampleVector.length) {
        console.log(`[FAISS] Embedding dimension: ${sampleVector.length}`);
      }
      FaissVectorService.detectedDimension = sampleVector.length;
    }
    return FaissVectorService.detectedDimension ?? 1024;
  }

  /**
   * L2-normalize a vector so IndexFlatIP computes cosine similarity.
   */
  private static normalizeVector(vec: number[]): number[] {
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm === 0) return vec;
    return vec.map(v => v / norm);
  }
  
  // Check if FAISS is available (lazy-loaded)
  private static get isFaissAvailable(): boolean {
    return faissAvailable;
  }

  /**
   * Store chunk vectors using FAISS for fast similarity search and database for persistence
   */
  async storeChunkVectors(
    guidelineId: string,
    chunks: Array<{ content: string; chunkIndex: number; metadata?: any }>,
    options?: { source?: 'project' | 'devx' }
  ): Promise<void> {
    try {
      const source = options?.source ?? 'project';
      const cacheKey = `${source}:${guidelineId}`;
      // Lazy-load faiss module if not already attempted
      if (!faissLoadAttempted) {
        await loadFaissModule();
      }
      
      if (!faissAvailable) {
        console.warn(`⚠️ FAISS: Native module not available, storing vectors in database only for guideline ${guidelineId}`);
        // Fall back to database-only storage
        await this.storeChunkVectorsDatabaseOnly(guidelineId, chunks, { source });
        return;
      }

      const validChunks = chunks.filter(c => c.content?.trim().length > 0);
      if (validChunks.length === 0) {
        console.warn(`⚠️ FAISS: All ${chunks.length} chunks are empty for guideline ${guidelineId}, skipping`);
        return;
      }
      if (validChunks.length < chunks.length) {
        console.warn(`⚠️ FAISS: Filtered out ${chunks.length - validChunks.length} empty chunks for guideline ${guidelineId}`);
      }
      console.log(`📦 FAISS: Starting vector storage for guideline ${guidelineId}, ${validChunks.length} chunks`);

      const chunkTexts = validChunks.map(c => c.content);
      const embeddings = await llmClient.getBatchEmbeddings(chunkTexts);

      const chunkEmbeddings = validChunks
        .map((chunk, i) => ({
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          embedding: embeddings[i],
          metadata: chunk.metadata || {}
        }))
        .filter(ce => ce.embedding && ce.embedding.length > 0);
      console.log(`🔢 FAISS: Generated ${chunkEmbeddings.length} embeddings via batch API`);

      // Create FAISS index for fast similarity search
      if (!IndexFlatIP) {
        throw new Error('IndexFlatIP is not available');
      }
      const dim = FaissVectorService.getVectorDimension(chunkEmbeddings[0]?.embedding);
      const index = new IndexFlatIP(dim);
      const vectors: number[][] = [];
      
      // Load existing chunks (inserted by VectorCacheService) to merge metadata
      const existingChunks = source === 'devx'
        ? await db.select()
            .from(schema.devxGuidelineChunks)
            .where(eq(schema.devxGuidelineChunks.guidelineId, guidelineId))
        : await db.select()
            .from(schema.guidelineChunks)
            .where(eq(schema.guidelineChunks.guidelineId, guidelineId));
      
      for (let i = 0; i < chunkEmbeddings.length; i++) {
        const chunkData = chunkEmbeddings[i];
        const normalized = FaissVectorService.normalizeVector(chunkData.embedding);
        vectors.push(normalized);
        const faissPosition = vectors.length - 1;
        
        const row = existingChunks.find(c => c.chunkIndex === chunkData.chunkIndex);
        if (!row) continue;
        
        const existingMeta = typeof row.metadata === 'string' ? JSON.parse(row.metadata as string) : (row.metadata || {});
        const merged = {
          ...existingMeta,
          embedding: normalized,
          faissPosition,
          originalGuidelineId: guidelineId
        };
        
        if (source === 'devx') {
          await db.update(schema.devxGuidelineChunks)
            .set({ metadata: merged } as any)
            .where(
              and(
                eq(schema.devxGuidelineChunks.guidelineId, guidelineId),
                eq(schema.devxGuidelineChunks.chunkIndex, chunkData.chunkIndex)
              )
            );
        } else {
          await db.update(schema.guidelineChunks)
            .set({ metadata: merged })
            .where(
              and(
                eq(schema.guidelineChunks.guidelineId, guidelineId),
                eq(schema.guidelineChunks.chunkIndex, chunkData.chunkIndex)
              )
            );
        }
      }

      // Add all vectors to FAISS index at once
      if (vectors.length > 0) {
        const vectorMatrix = vectors.reduce((acc, vector) => acc.concat(vector), []);
        index.add(vectorMatrix);
        
        // Cache the index for fast access (keyed by source + guideline UUID)
        FaissVectorService.indexCache.set(cacheKey, index);
        console.log(`🚀 FAISS: Created and cached index for guideline ${guidelineId} with ${vectors.length} vectors`);
      }

      const updatedCount = chunkEmbeddings.length;
      if (updatedCount > 0) {
        console.log(`💾 FAISS: Updated ${updatedCount} chunk metadata in database`);
      }

    } catch (error) {
      // If the embedding deployment itself is missing, don't fail chunking — just skip FAISS.
      const code = (error as any)?.error?.code || (error as any)?.code;
      if (code === 'DeploymentNotFound' || code === 'deployment_not_found') {
        console.warn(`⚠️ FAISS/Embeddings: Deployment not found while storing vectors for guideline ${guidelineId}. Skipping vector storage but keeping DevX chunks.`);
        return;
      }
      console.error(`❌ FAISS: Error storing vectors for guideline ${guidelineId}:`, error);
      throw error;
    }
  }

  /**
   * Store chunk vectors in database only (fallback when FAISS is not available).
   * Chunks already exist from VectorCacheService; we only update metadata with embeddings.
   */
  private async storeChunkVectorsDatabaseOnly(
    guidelineId: string,
    chunks: Array<{ content: string; chunkIndex: number; metadata?: any }>,
    options?: { source?: 'project' | 'devx' }
  ): Promise<void> {
    try {
      const source = options?.source ?? 'project';
      const validChunks = chunks.filter(c => c.content?.trim().length > 0);
      if (validChunks.length === 0) {
        console.warn(`⚠️ Database-only: All chunks empty for guideline ${guidelineId}, skipping`);
        return;
      }
      const chunkTexts = validChunks.map(c => c.content);
      const embeddings = await llmClient.getBatchEmbeddings(chunkTexts);

      const chunkEmbeddings = validChunks
        .map((chunk, i) => ({
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          embedding: embeddings[i],
          metadata: chunk.metadata || {}
        }))
        .filter(ce => ce.embedding && ce.embedding.length > 0);

      const existingChunks = source === 'devx'
        ? await db.select().from(schema.devxGuidelineChunks).where(eq(schema.devxGuidelineChunks.guidelineId, guidelineId))
        : await db.select().from(schema.guidelineChunks).where(eq(schema.guidelineChunks.guidelineId, guidelineId));

      for (const chunkData of chunkEmbeddings) {
        const row = existingChunks.find(c => c.chunkIndex === chunkData.chunkIndex);
        if (!row) continue;
        const existingMeta = typeof row.metadata === 'string' ? JSON.parse(row.metadata as string) : (row.metadata || {});
        const merged = {
          ...existingMeta,
          embedding: chunkData.embedding,
          originalGuidelineId: guidelineId
        };
        if (source === 'devx') {
          await db.update(schema.devxGuidelineChunks)
            .set({ metadata: merged } as any)
            .where(
              and(
                eq(schema.devxGuidelineChunks.guidelineId, guidelineId),
                eq(schema.devxGuidelineChunks.chunkIndex, chunkData.chunkIndex)
              )
            );
        } else {
          await db.update(schema.guidelineChunks)
            .set({ metadata: merged })
            .where(
              and(
                eq(schema.guidelineChunks.guidelineId, guidelineId),
                eq(schema.guidelineChunks.chunkIndex, chunkData.chunkIndex)
              )
            );
        }
      }

      if (chunkEmbeddings.length > 0) {
        console.log(`💾 Database-only: Updated ${chunkEmbeddings.length} chunk metadata for guideline ${guidelineId}`);
      }
    } catch (error) {
      const code = (error as any)?.error?.code || (error as any)?.code;
      if (code === 'DeploymentNotFound' || code === 'deployment_not_found') {
        console.warn(`⚠️ Database-only embeddings: Deployment not found for guideline ${guidelineId}. Proceeding without embeddings.`);
        return;
      }
      console.error(`❌ Database-only: Error storing vectors for guideline ${guidelineId}:`, error);
      throw error;
    }
  }

  /**
   * Search for similar chunks using FAISS for speed and database for metadata
   */
  async searchSimilar(
    query: string,
    guidelineIds: string[],
    topK: number = 10,
    threshold: number = 0.35,
    options?: { source?: 'project' | 'devx' }
  ): Promise<Array<{ content: string; similarity: number; chunkIndex: number; guidelineId: string; metadata: any }>> {
    try {
      const source = options?.source ?? 'project';
      // Lazy-load faiss module if not already attempted
      if (!faissLoadAttempted) {
        await loadFaissModule();
      }
      
      if (!faissAvailable) {
        console.warn(`⚠️ FAISS: Native module not available, using database-only search`);
        return await this.searchSimilarDatabaseOnly(query, guidelineIds, topK, threshold, { source });
      }

      console.log(`🔍 FAISS: Searching for similar chunks across ${guidelineIds.length} guidelines`);
      
      const rawQueryVector = await llmClient.getEmbeddings(query);
      const queryVector = FaissVectorService.normalizeVector(rawQueryVector);

      const results: Array<{ content: string; similarity: number; chunkIndex: number; guidelineId: string; metadata: any }> = [];

      for (const guidelineId of guidelineIds) {
        try {
          // guidelineId is the canonical UUID from vectorized_guidelines
          // Get or build FAISS index for this guideline
          const cacheKey = `${source}:${guidelineId}`;
          let index = FaissVectorService.indexCache.get(cacheKey);
          
          if (!index) {
            console.log(`🔄 FAISS: Building index for guideline ${guidelineId}`);
            index = await this.buildIndexForGuideline(guidelineId, source);
            if (!index) continue; // Skip if no chunks found
          }

          // Search using FAISS for fast similarity matching
          const searchResults = index.search(queryVector, Math.min(topK, index.ntotal()));
          
          if (searchResults.distances.length === 0) {
            console.log(`📭 FAISS: No results from index for guideline ${guidelineId}`);
            continue;
          }

          const resultsBeforeGuideline = results.length;
          // Get chunks in same order as buildIndexForGuideline (by chunkIndex) for position-based lookup
          const chunks = source === 'devx'
            ? await db.select()
                .from(schema.devxGuidelineChunks)
                .where(eq(schema.devxGuidelineChunks.guidelineId, guidelineId))
                .orderBy(asc(schema.devxGuidelineChunks.chunkIndex))
            : await db.select()
                .from(schema.guidelineChunks)
                .where(eq(schema.guidelineChunks.guidelineId, guidelineId))
                .orderBy(asc(schema.guidelineChunks.chunkIndex));

          // Build ordered list of chunks that have embeddings (same filter as buildIndexForGuideline)
          const chunksWithEmbedding: typeof chunks = [];
          for (const c of chunks) {
            try {
              const metadata = typeof c.metadata === 'string' ? JSON.parse(c.metadata) : c.metadata;
              if (metadata?.embedding && Array.isArray(metadata.embedding)) chunksWithEmbedding.push(c);
            } catch {
              // skip
            }
          }

          // Map FAISS labels (index positions) to chunks by position
          for (let i = 0; i < searchResults.labels.length; i++) {
            const similarity = searchResults.distances[i]; // FAISS returns inner product (similarity)
            const indexPosition = searchResults.labels[i];
            
            if (similarity < threshold) continue;

            const chunk = indexPosition >= 0 && indexPosition < chunksWithEmbedding.length
              ? chunksWithEmbedding[indexPosition]
              : undefined;

            if (chunk) {
              const metadata = typeof chunk.metadata === 'string' ? JSON.parse(chunk.metadata) : chunk.metadata;
              results.push({
                content: chunk.chunkText || '',
                similarity,
                chunkIndex: chunk.chunkIndex || 0,
                guidelineId: metadata.originalGuidelineId || guidelineId, // Return original guideline ID
                metadata: metadata || {}
              });
            }
          }

          const addedForGuideline = results.length - resultsBeforeGuideline;
          if (searchResults.distances.length > 0 && addedForGuideline === 0) {
            const topDistances = [...searchResults.distances].sort((a, b) => b - a).slice(0, 5);
            console.log(`📊 FAISS: Guideline ${guidelineId.slice(0, 8)}: all similarities below threshold ${threshold}; max=${Math.max(...searchResults.distances).toFixed(4)} top5=${topDistances.map(d => d.toFixed(4)).join(', ')}`);
          }
        } catch (error) {
          console.error(`❌ FAISS: Error searching guideline ${guidelineId}:`, error);
          continue; // Continue with other guidelines
        }
      }

      // Sort by similarity and return top results
      const sortedResults = results
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);

      console.log(`✨ FAISS: Found ${sortedResults.length} similar chunks with similarity > ${threshold}`);
      return sortedResults;

    } catch (error) {
      console.error('❌ FAISS: Error in similarity search:', error);
      throw error;
    }
  }

  /**
   * Search for similar chunks using database-only mode (fallback when FAISS is not available)
   */
  private async searchSimilarDatabaseOnly(
    query: string,
    guidelineIds: string[],
    topK: number = 10,
    threshold: number = 0.35,
    options?: { source?: 'project' | 'devx' }
  ): Promise<Array<{ content: string; similarity: number; chunkIndex: number; guidelineId: string; metadata: any }>> {
    const source = options?.source ?? 'project';
    try {
      // Generate embedding for the query
      const queryVector = await llmClient.getEmbeddings(query);
      const results: Array<{ content: string; similarity: number; chunkIndex: number; guidelineId: string; metadata: any }> = [];

      for (const guidelineId of guidelineIds) {
        try {
          // Retry DB query up to 3 times on transient connection errors (ECONNRESET, ETIMEDOUT)
          let chunks: any[] = [];
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              chunks = source === 'devx'
                ? await db.select()
                    .from(schema.devxGuidelineChunks)
                    .where(eq(schema.devxGuidelineChunks.guidelineId, guidelineId))
                : await db.select()
                    .from(schema.guidelineChunks)
                    .where(eq(schema.guidelineChunks.guidelineId, guidelineId));
              break; // success
            } catch (dbErr: any) {
              const isTransient = dbErr?.code === 'ECONNRESET' || dbErr?.code === 'ETIMEDOUT' || dbErr?.code === 'EPIPE';
              if (isTransient && attempt < 3) {
                console.warn(`⚠️ Database-only: Transient DB error (attempt ${attempt}/3) for guideline ${guidelineId}: ${dbErr.code}. Retrying...`);
                await new Promise(r => setTimeout(r, 500 * attempt));
                continue;
              }
              throw dbErr;
            }
          }

          // Calculate cosine similarity for each chunk
          for (const chunk of chunks) {
            try {
              const metadata = typeof chunk.metadata === 'string' ? JSON.parse(chunk.metadata) : chunk.metadata;
              const embedding = metadata?.embedding;

              if (!embedding || !Array.isArray(embedding)) continue;

              // Calculate cosine similarity (dot product for normalized vectors)
              const similarity = this.cosineSimilarity(queryVector, embedding);

              if (similarity >= threshold) {
                results.push({
                  content: chunk.chunkText || '',
                  similarity,
                  chunkIndex: chunk.chunkIndex || 0,
                  guidelineId: metadata.originalGuidelineId || guidelineId,
                  metadata: metadata || {}
                });
              }
            } catch (error) {
              console.error(`❌ Database-only: Error processing chunk ${chunk.qdrantPointId}:`, error);
              continue;
            }
          }
        } catch (error) {
          console.error(`❌ Database-only: Error searching guideline ${guidelineId}:`, error);
          continue;
        }
      }

      // Sort by similarity and return top results
      const sortedResults = results
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);

      console.log(`✨ Database-only: Found ${sortedResults.length} similar chunks with similarity > ${threshold}`);
      return sortedResults;
    } catch (error) {
      console.error('❌ Database-only: Error in similarity search:', error);
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Build FAISS index for a guideline from database vectors
   */
  private async buildIndexForGuideline(guidelineId: string, source: 'project' | 'devx' = 'project'): Promise<any | undefined> {
    try {
      // guidelineId is the canonical UUID from vectorized_guidelines
      // Order by chunkIndex so index position i matches the same ordering used in searchSimilar
      const chunks = source === 'devx'
        ? await db.select()
            .from(schema.devxGuidelineChunks)
            .where(eq(schema.devxGuidelineChunks.guidelineId, guidelineId))
            .orderBy(asc(schema.devxGuidelineChunks.chunkIndex))
        : await db.select()
            .from(schema.guidelineChunks)
            .where(eq(schema.guidelineChunks.guidelineId, guidelineId))
            .orderBy(asc(schema.guidelineChunks.chunkIndex));

      if (chunks.length === 0) {
        console.log(`📭 FAISS: No chunks found for guideline ${guidelineId}`);
        return undefined;
      }

      // Extract vectors in chunkIndex order (same order as search will use for position lookup)
      const vectors: number[][] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        try {
          const metadata = typeof chunk.metadata === 'string' ? JSON.parse(chunk.metadata) : chunk.metadata;
          if (metadata?.embedding && Array.isArray(metadata.embedding)) {
            vectors.push(FaissVectorService.normalizeVector(metadata.embedding));
          }
        } catch (error) {
          console.error(`❌ FAISS: Error parsing metadata for chunk ${chunk.qdrantPointId}:`, error);
          continue;
        }
      }

      if (vectors.length === 0) {
        console.log(`📭 FAISS: No valid vectors found for guideline ${guidelineId}`);
        return undefined;
      }

      // Create FAISS index
      if (!IndexFlatIP) {
        console.warn(`⚠️ FAISS: IndexFlatIP not available, cannot build index for guideline ${guidelineId}`);
        return undefined;
      }
      const dim = FaissVectorService.getVectorDimension(vectors[0]);
      const index = new IndexFlatIP(dim);
      const vectorMatrix = vectors.reduce((acc, vector) => acc.concat(vector), []);
      index.add(vectorMatrix);

      // Cache the index
      FaissVectorService.indexCache.set(`${source}:${guidelineId}`, index);
      console.log(`🚀 FAISS: Built and cached index for guideline ${guidelineId} with ${vectors.length} vectors`);

      return index;
    } catch (error) {
      console.error(`❌ FAISS: Error building index for guideline ${guidelineId}:`, error);
      return undefined;
    }
  }

  /**
   * Clear cached index for a guideline (useful for updates)
   */
  clearCache(guidelineId: string): void {
    FaissVectorService.indexCache.delete(`project:${guidelineId}`);
    FaissVectorService.indexCache.delete(`devx:${guidelineId}`);
    console.log(`🧹 FAISS: Cleared cache for guideline ${guidelineId}`);
  }

  /**
   * Clear all cached indices
   */
  clearAllCaches(): void {
    FaissVectorService.indexCache.clear();
    console.log('🧹 FAISS: Cleared all cached indices');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { cachedGuidelineIds: string[]; totalIndices: number } {
    return {
      cachedGuidelineIds: Array.from(FaissVectorService.indexCache.keys()),
      totalIndices: FaissVectorService.indexCache.size
    };
  }
}

export const faissVectorService = new FaissVectorService();