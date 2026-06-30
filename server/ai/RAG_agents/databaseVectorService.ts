/**
 * Database Vector Service
 * 
 * Simple vector storage using existing database tables
 * No external dependencies, no file storage, just database
 */

import { llmClient } from './llmClient';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import * as schema from '@shared/schema';

export interface SearchResult {
  id: string;
  score: number;
  payload: {
    text: string;
    guidelineId: string;
    chunkIndex: number;
    projectId: string;
    metadata?: any;
  };
}

/**
 * Simple Database Vector Service
 */
export class DatabaseVectorService {
  private static instance: DatabaseVectorService;

  private constructor() {
    console.log('[DatabaseVectorService] 🚀 Initialized using database tables');
  }

  public static getInstance(): DatabaseVectorService {
    if (!DatabaseVectorService.instance) {
      DatabaseVectorService.instance = new DatabaseVectorService();
    }
    return DatabaseVectorService.instance;
  }

  /**
   * Store vectors in database
   */
  async storeChunkVectors(
    collectionName: string,
    chunks: Array<{
      id: string;
      text: string;
      guidelineId: string;
      chunkIndex: number;
      projectId: string;
      metadata?: any;
    }>
  ): Promise<void> {
    console.log(`[DatabaseVectorService] 📝 Storing ${chunks.length} vectors for ${collectionName}`);

    try {
      // Generate embeddings and store in chunks table with vector data
      for (const chunk of chunks) {
        console.log(`[DatabaseVectorService] 🔄 Generating embedding for chunk ${chunk.chunkIndex}...`);
        const embedding = await llmClient.getEmbeddings(chunk.text);
        
        // Update the chunk record to include vector data in metadata
        const vectorMetadata = {
          ...chunk.metadata,
          vector: embedding,
          vectorDimension: embedding.length,
          collectionName,
          storedAt: new Date().toISOString()
        };

        // Update the existing chunk with vector data
        await db
          .update(schema.guidelineChunks)
          .set({ 
            metadata: vectorMetadata 
          })
          .where(eq(schema.guidelineChunks.qdrantPointId, chunk.id));
      }

      console.log(`[DatabaseVectorService] ✅ Stored ${chunks.length} vectors in database`);
      
    } catch (error) {
      console.error('[DatabaseVectorService] Error storing vectors:', error);
      throw error;
    }
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Search for similar vectors in database
   */
  async searchSimilar(
    collectionName: string,
    queryText: string,
    limit: number = 5,
    scoreThreshold: number = 0.7,
    projectId?: string
  ): Promise<SearchResult[]> {
    console.log(`[DatabaseVectorService] 🔍 Searching for: "${queryText.substring(0, 100)}..."`);

    try {
      // Generate query embedding
      const queryVector = await llmClient.getEmbeddings(queryText);

      // Get all chunks with vectors from database
      const chunksWithVectors = await db
        .select()
        .from(schema.guidelineChunks)
        .innerJoin(
          schema.vectorizedGuidelines, 
          eq(schema.guidelineChunks.guidelineId, schema.vectorizedGuidelines.id)
        )
        .where(
          projectId 
            ? eq(schema.vectorizedGuidelines.projectId, projectId)
            : undefined
        );

      if (chunksWithVectors.length === 0) {
        console.log(`[DatabaseVectorService] 📭 No vectors found for project: ${projectId}`);
        return [];
      }

      // Calculate similarity for all vectors
      const results: { chunk: any; guideline: any; score: number }[] = [];
      
      for (const { guideline_chunks: chunk, vectorized_guidelines: guideline } of chunksWithVectors) {
        // Extract vector from metadata
        const metadata = chunk.metadata as any;
        if (!metadata?.vector) {
          continue; // Skip chunks without vectors
        }

        const chunkVector = metadata.vector;
        const similarity = this.cosineSimilarity(queryVector, chunkVector);
        
        if (similarity >= scoreThreshold) {
          results.push({ chunk, guideline, score: similarity });
        }
      }

      // Sort by similarity score (highest first)
      results.sort((a, b) => b.score - a.score);

      // Limit results
      const topResults = results.slice(0, limit);

      console.log(`[DatabaseVectorService] 📊 Found ${topResults.length} similar chunks (threshold: ${scoreThreshold})`);

      return topResults.map(result => ({
        id: result.chunk.qdrantPointId,
        score: result.score,
        payload: {
          text: result.chunk.chunkText,
          guidelineId: result.chunk.guidelineId,
          chunkIndex: result.chunk.chunkIndex,
          projectId: result.guideline.projectId,
          metadata: result.chunk.metadata
        }
      }));
      
    } catch (error) {
      console.error('[DatabaseVectorService] Error searching vectors:', error);
      throw error;
    }
  }

  /**
   * Delete vectors for a guideline
   */
  async deleteGuidelineVectors(collectionName: string, guidelineId: string): Promise<void> {
    try {
      // Clear vector data from chunks metadata
      await db
        .update(schema.guidelineChunks)
        .set({ 
          metadata: {} 
        })
        .where(eq(schema.guidelineChunks.guidelineId, guidelineId));
      
      console.log(`[DatabaseVectorService] 🗑️ Deleted vectors for guideline: ${guidelineId}`);
    } catch (error) {
      console.error('[DatabaseVectorService] Error deleting vectors:', error);
    }
  }

  /**
   * Get collection statistics
   */
  async getCollectionStats(collectionName: string, projectId?: string): Promise<any> {
    try {
      const chunks = await db
        .select()
        .from(schema.guidelineChunks)
        .innerJoin(
          schema.vectorizedGuidelines, 
          eq(schema.guidelineChunks.guidelineId, schema.vectorizedGuidelines.id)
        )
        .where(
          projectId 
            ? eq(schema.vectorizedGuidelines.projectId, projectId)
            : undefined
        );

      const vectorCount = chunks.filter(({ guideline_chunks: chunk }) => {
        const metadata = chunk.metadata as any;
        return metadata?.vector;
      }).length;

      return {
        name: collectionName,
        vectorCount,
        totalChunks: chunks.length,
        storage: 'database'
      };
    } catch (error) {
      console.error('[DatabaseVectorService] Error getting stats:', error);
      return { name: collectionName, vectorCount: 0, totalChunks: 0 };
    }
  }
}