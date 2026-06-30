/**
 * Vector Cache Service
 * 
 * Handles caching of vectorized guidelines to avoid re-processing
 * Uses Azure SQL DB for metadata and Qdrant for vector storage
 */

import { createHash, randomUUID } from 'crypto';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { db } from '../../db';
import * as schema from '@shared/schema';
import { faissVectorService } from './faissVectorService.js';
import type {
  VectorizedGuideline,
  DevxVectorizedGuideline,
  InsertVectorizedGuideline,
  InsertDevxVectorizedGuideline,
  InsertGuidelineChunk,
  GuidelineChunk,
  DevxGuidelineChunk,
  InsertDevxGuidelineChunk
} from '@shared/schema';

export interface CacheCheckResult {
  found: boolean;
  vectorizedGuideline?: VectorizedGuideline;
  chunks?: GuidelineChunk[];
  qdrantCollection?: string;
}

export interface DevxCacheCheckResult {
  found: boolean;
  vectorizedGuideline?: DevxVectorizedGuideline;
  chunks?: DevxGuidelineChunk[];
  qdrantCollection?: string;
}

export interface GuidelineInput {
  name: string;
  content: string;
}

export class VectorCacheService {
  private static instance: VectorCacheService;

  private constructor() {
    console.log('[VectorCacheService] 🚀 Initialized with FAISS Vector Service - optimal performance with database persistence');
  }

  public static getInstance(): VectorCacheService {
    if (!VectorCacheService.instance) {
      VectorCacheService.instance = new VectorCacheService();
    }
    return VectorCacheService.instance;
  }

  /**
   * Generate content hash for caching
   */
  private generateContentHash(content: any): string {
    // Handle non-string content by converting to string
    let contentStr: string;

    if (typeof content === 'string') {
      contentStr = content;
    } else if (content === null || content === undefined) {
      contentStr = '';
    } else if (typeof content === 'object') {
      contentStr = JSON.stringify(content);
    } else {
      contentStr = String(content);
    }

    return createHash('sha256').update(contentStr.trim()).digest('hex');
  }

  /**
   * Generate Qdrant collection name for project
   */
  private generateCollectionName(projectId: string): string {
    return `project_${projectId}_guidelines`;
  }

  /**
   * Check if guideline is already vectorized
   */
  async checkCache(projectId: string, guideline: GuidelineInput): Promise<CacheCheckResult> {
    try {
      const contentHash = this.generateContentHash(guideline.content);

      // Check for existing guideline (any status)
      const [existing] = await db
        .select()
        .from(schema.vectorizedGuidelines)
        .where(
          and(
            eq(schema.vectorizedGuidelines.projectId, projectId),
            eq(schema.vectorizedGuidelines.contentHash, contentHash)
          )
        )
        .limit(1);

      if (!existing) {
        return { found: false };
      }

      // Handle different states dynamically
      switch (existing.status) {
        case 'vectorized':
          // Perfect - get chunks and return cache hit (only if chunks exist)
          const chunks = await db
            .select()
            .from(schema.guidelineChunks)
            .where(eq(schema.guidelineChunks.guidelineId, existing.id))
            .orderBy(schema.guidelineChunks.chunkIndex);

          if (!chunks || chunks.length === 0) {
            console.warn(
              '[BRD-RAG] Cache hit but no chunks found for guideline, will re-chunk:',
              { projectId, guidelineName: guideline.name, guidelineId: existing.id },
            );
            // Treat as cache miss so caller re-processes and stores fresh chunks
            return { found: false };
          }

          // Verify at least some chunks have embeddings — if none do, the cache is useless
          // (embeddings may have failed to generate on the original run)
          const hasAnyEmbedding = chunks.some(chunk => {
            try {
              const meta = typeof chunk.metadata === 'string' ? JSON.parse(chunk.metadata) : chunk.metadata;
              return meta?.embedding && Array.isArray(meta.embedding) && meta.embedding.length > 0;
            } catch { return false; }
          });

          if (!hasAnyEmbedding) {
            console.warn(
              '[BRD-RAG] Cache hit but chunks have NO embeddings — deleting stale cache to force re-processing:',
              { projectId, guidelineName: guideline.name, guidelineId: existing.id, chunkCount: chunks.length },
            );
            // Delete the useless vectorized record so it gets fully re-processed with embeddings
            await db.delete(schema.guidelineChunks).where(eq(schema.guidelineChunks.guidelineId, existing.id));
            await db.delete(schema.vectorizedGuidelines).where(eq(schema.vectorizedGuidelines.id, existing.id));
            return { found: false };
          }

          return {
            found: true,
            vectorizedGuideline: existing,
            chunks: chunks,
            qdrantCollection: existing.qdrantCollection
          };

        case 'processing':
          // Check if processing is stale (> 10 minutes = failed)
          const processingAge = Date.now() - new Date(existing.createdAt).getTime();
          const maxProcessingTime = 10 * 60 * 1000; // 10 minutes

          if (processingAge > maxProcessingTime) {
            console.log(`[VectorCacheService] 🔄 Stale processing detected: ${guideline.name}, reprocessing...`);
            // Delete stale record and allow reprocessing
            await db.delete(schema.vectorizedGuidelines).where(eq(schema.vectorizedGuidelines.id, existing.id));
            return { found: false };
          } else {
            console.log(`[VectorCacheService] ⏳ Currently processing: ${guideline.name}, skipping...`);
            return { found: false }; // Let it be processed by another instance
          }

        case 'failed':
        default:
          // Clean up failed records and allow reprocessing
          console.log(`[VectorCacheService] 🔄 Cleaning up failed record: ${guideline.name}`);
          await db.delete(schema.vectorizedGuidelines).where(eq(schema.vectorizedGuidelines.id, existing.id));
          return { found: false };
      }

    } catch (error) {
      console.error('[VectorCacheService] Error checking cache:', error);
      return { found: false };
    }
  }

  /**
   * Check multiple guidelines at once
   */
  async checkMultipleCache(projectId: string, guidelines: GuidelineInput[]): Promise<Map<string, CacheCheckResult>> {
    const results = new Map<string, CacheCheckResult>();

    try {
      // Generate all content hashes
      const hashToGuideline = new Map<string, string>();
      const contentHashes = guidelines.map(g => {
        const hash = this.generateContentHash(g.content);
        hashToGuideline.set(hash, g.name);
        return hash;
      });

      // Batch query for all hashes
      const existingGuidelines = await db
        .select()
        .from(schema.vectorizedGuidelines)
        .where(
          and(
            eq(schema.vectorizedGuidelines.projectId, projectId),
            eq(schema.vectorizedGuidelines.status, 'vectorized')
          )
        );

      // Filter by our content hashes
      const relevantGuidelines = existingGuidelines.filter(g =>
        contentHashes.includes(g.contentHash)
      );

      // Get chunks for found guidelines
      const guidelineIds = relevantGuidelines.map(g => g.id);
      const allChunks = guidelineIds.length > 0 ?
        await db
          .select()
          .from(schema.guidelineChunks)
          .where(
            guidelineIds.length === 1
              ? eq(schema.guidelineChunks.guidelineId, guidelineIds[0])
              : inArray(schema.guidelineChunks.guidelineId, guidelineIds)
          )
          .orderBy(schema.guidelineChunks.chunkIndex)
        : [];

      // Group chunks by guideline ID
      const chunksByGuideline = new Map<string, GuidelineChunk[]>();
      allChunks.forEach(chunk => {
        if (!chunksByGuideline.has(chunk.guidelineId)) {
          chunksByGuideline.set(chunk.guidelineId, []);
        }
        chunksByGuideline.get(chunk.guidelineId)!.push(chunk);
      });

      // Build results map
      guidelines.forEach(guideline => {
        const hash = this.generateContentHash(guideline.content);
        const existing = relevantGuidelines.find(g => g.contentHash === hash);

        if (existing) {
          const chunksForGuideline = chunksByGuideline.get(existing.id) || [];
          if (chunksForGuideline.length === 0) {
            console.warn(
              '[BRD-RAG] Cache hit but no chunks found in bulk check, will re-chunk:',
              { projectId, guidelineName: guideline.name, guidelineId: existing.id },
            );
            // Treat as cache miss so orchestrator re-processes this guideline
            results.set(guideline.name, { found: false });
          } else {
            // Verify at least some chunks have embeddings
            const hasAnyEmbedding = chunksForGuideline.some(chunk => {
              try {
                const meta = typeof chunk.metadata === 'string' ? JSON.parse(chunk.metadata) : chunk.metadata;
                return meta?.embedding && Array.isArray(meta.embedding) && meta.embedding.length > 0;
              } catch { return false; }
            });

            if (!hasAnyEmbedding) {
              console.warn(
                '[BRD-RAG] Cache hit but chunks have NO embeddings in bulk check — treating as cache miss:',
                { projectId, guidelineName: guideline.name, guidelineId: existing.id, chunkCount: chunksForGuideline.length },
              );
              results.set(guideline.name, { found: false });
            } else {
              results.set(guideline.name, {
                found: true,
                vectorizedGuideline: existing,
                chunks: chunksForGuideline,
                qdrantCollection: existing.qdrantCollection
              });
            }
          }
        } else {
          results.set(guideline.name, { found: false });
        }
      });

    } catch (error) {
      console.error('[VectorCacheService] Error checking multiple cache:', error);
      guidelines.forEach(g => results.set(g.name, { found: false }));
    }

    return results;
  }

  /**
   * DevX golden-repo cache: check if guideline is already vectorized (global cache keyed by goldenRepoId + contentHash).
   */
  async checkMultipleDevxCache(
    goldenRepoId: string,
    guidelines: GuidelineInput[]
  ): Promise<Map<string, DevxCacheCheckResult>> {
    const results = new Map<string, DevxCacheCheckResult>();

    try {
      const contentHashes = guidelines.map(g => this.generateContentHash(g.content));

      const existingGuidelines = await db
        .select()
        .from(schema.devxVectorizedGuidelines)
        .where(
          and(
            eq(schema.devxVectorizedGuidelines.goldenRepoId, goldenRepoId),
            eq(schema.devxVectorizedGuidelines.status, 'vectorized')
          )
        );

      const relevant = existingGuidelines.filter(g => contentHashes.includes(g.contentHash));
      const guidelineIds = relevant.map(g => g.id);

      const allChunks = guidelineIds.length > 0
        ? await db
            .select()
            .from(schema.devxGuidelineChunks)
            .where(
              guidelineIds.length === 1
                ? eq(schema.devxGuidelineChunks.guidelineId, guidelineIds[0])
                : inArray(schema.devxGuidelineChunks.guidelineId, guidelineIds)
            )
            .orderBy(schema.devxGuidelineChunks.chunkIndex)
        : [];

      const chunksByGuideline = new Map<string, DevxGuidelineChunk[]>();
      allChunks.forEach(chunk => {
        if (!chunksByGuideline.has(chunk.guidelineId)) chunksByGuideline.set(chunk.guidelineId, []);
        chunksByGuideline.get(chunk.guidelineId)!.push(chunk);
      });

      guidelines.forEach(guideline => {
        const hash = this.generateContentHash(guideline.content);
        const existing = relevant.find(g => g.contentHash === hash);

        if (!existing) {
          results.set(guideline.name, { found: false });
          return;
        }

        const chunksForGuideline = chunksByGuideline.get(existing.id) || [];
        if (!chunksForGuideline.length) {
          console.warn('[BRD-RAG][DevX] Cache hit but no devx chunks found, will re-chunk:', {
            goldenRepoId, guidelineName: guideline.name, guidelineId: existing.id,
          });
          results.set(guideline.name, { found: false });
          return;
        }

        const hasAnyEmbedding = chunksForGuideline.some(chunk => {
          try {
            const meta = typeof chunk.metadata === 'string' ? JSON.parse(chunk.metadata) : chunk.metadata;
            return meta?.embedding && Array.isArray(meta.embedding) && meta.embedding.length > 0;
          } catch { return false; }
        });

        if (!hasAnyEmbedding) {
          console.warn('[BRD-RAG][DevX] Cache hit but devx chunks have NO embeddings — treating as cache miss:', {
            goldenRepoId, guidelineName: guideline.name, guidelineId: existing.id, chunkCount: chunksForGuideline.length,
          });
          results.set(guideline.name, { found: false });
          return;
        }

        results.set(guideline.name, {
          found: true,
          vectorizedGuideline: existing,
          chunks: chunksForGuideline,
          qdrantCollection: existing.qdrantCollection
        });
      });

    } catch (error) {
      console.error('[VectorCacheService] Error checking DevX cache:', error);
      guidelines.forEach(g => results.set(g.name, { found: false }));
    }

    return results;
  }

  /**
   * DevX golden-repo cache: mark guideline as processing (prevents duplicate work).
   */
  async markDevxAsProcessing(goldenRepoId: string, guideline: GuidelineInput): Promise<string> {
    const contentHash = this.generateContentHash(guideline.content);
    const qdrantCollection = `golden_repo_${goldenRepoId}_guidelines`;

    const [existing] = await db
      .select()
      .from(schema.devxVectorizedGuidelines)
      .where(
        and(
          eq(schema.devxVectorizedGuidelines.goldenRepoId, goldenRepoId),
          eq(schema.devxVectorizedGuidelines.contentHash, contentHash)
        )
      )
      .limit(1);

    if (existing) return existing.id;

    const processingId = randomUUID();
    const guidelineData: InsertDevxVectorizedGuideline = {
      id: processingId,
      goldenRepoId,
      guidelineName: guideline.name,
      contentHash,
      qdrantCollection,
      chunkCount: 0,
      embeddingModel: 'text-embedding-ada-002',
      status: 'processing'
    } as any;

    try {
      await db.insert(schema.devxVectorizedGuidelines).values(guidelineData as any);
      return processingId;
    } catch (insertError: any) {
      if (insertError.code === 'ER_DUP_ENTRY') {
        const [raceExisting] = await db
          .select()
          .from(schema.devxVectorizedGuidelines)
          .where(
            and(
              eq(schema.devxVectorizedGuidelines.goldenRepoId, goldenRepoId),
              eq(schema.devxVectorizedGuidelines.contentHash, contentHash)
            )
          )
          .limit(1);
        return raceExisting?.id || processingId;
      }
      throw insertError;
    }
  }

  /**
   * DevX golden-repo cache: store vectorized guideline + chunks and generate embeddings (FAISS).
   */
  async storeInDevxCache(
    goldenRepoId: string,
    guideline: GuidelineInput,
    chunks: Array<{
      index: number;
      text: string;
      qdrantPointId: string;
      size: number;
      overlapSize?: number;
      metadata?: any;
    }>,
    processingTime: number
  ): Promise<string> {
    const contentHash = this.generateContentHash(guideline.content);
    const qdrantCollection = `golden_repo_${goldenRepoId}_guidelines`;
    const maxAttempts = 4;
    const RACE_RETRY_MS = 300;

    const runTransaction = () =>
      db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.devxVectorizedGuidelines)
          .where(
            and(
              eq(schema.devxVectorizedGuidelines.goldenRepoId, goldenRepoId),
              eq(schema.devxVectorizedGuidelines.contentHash, contentHash)
            )
          )
          .limit(1);

        let guidelineId: string;

        if (existing) {
          guidelineId = existing.id;
          await tx
            .update(schema.devxVectorizedGuidelines)
            .set({
              status: 'vectorized',
              chunkCount: chunks.length,
              processingTime,
              updatedAt: new Date()
            } as any)
            .where(eq(schema.devxVectorizedGuidelines.id, guidelineId));
        } else {
          guidelineId = randomUUID();
          const row: InsertDevxVectorizedGuideline = {
            id: guidelineId,
            goldenRepoId,
            guidelineName: guideline.name,
            contentHash,
            qdrantCollection,
            chunkCount: chunks.length,
            embeddingModel: 'text-embedding-ada-002',
            status: 'vectorized',
            processingTime
          } as any;

          try {
            await tx.insert(schema.devxVectorizedGuidelines).values(row as any);
          } catch (insertError: any) {
            if (insertError.code === 'ER_DUP_ENTRY') {
              // The unique constraints are:
              //   1. content_hash (globally unique across all repos)
              //   2. (golden_repo_id, guideline_name, content_hash) composite
              // Try all lookup paths to find the colliding record.
              const [byHash] = await tx
                .select()
                .from(schema.devxVectorizedGuidelines)
                .where(eq(schema.devxVectorizedGuidelines.contentHash, contentHash))
                .limit(1);

              const [byName] = byHash
                ? [byHash]
                : await tx
                    .select()
                    .from(schema.devxVectorizedGuidelines)
                    .where(
                      and(
                        eq(schema.devxVectorizedGuidelines.goldenRepoId, goldenRepoId),
                        eq(schema.devxVectorizedGuidelines.guidelineName, guideline.name)
                      )
                    )
                    .limit(1);

              if (byName) {
                guidelineId = byName.id;
                await tx
                  .update(schema.devxVectorizedGuidelines)
                  .set({
                    goldenRepoId,
                    guidelineName: guideline.name,
                    contentHash,
                    qdrantCollection,
                    status: 'vectorized',
                    chunkCount: chunks.length,
                    processingTime,
                    updatedAt: new Date()
                  } as any)
                  .where(eq(schema.devxVectorizedGuidelines.id, guidelineId));
              } else {
                // Could not find the colliding record — genuine unpredictable race. Retry.
                const err = new Error(`Race condition detected but couldn't insert devx record for ${guideline.name}`) as Error & { code?: string };
                err.code = 'VECTOR_CACHE_RACE_RETRY';
                throw err;
              }
            } else {
              throw insertError;
            }
          }
        }

        // Replace chunks
        await tx.delete(schema.devxGuidelineChunks).where(eq(schema.devxGuidelineChunks.guidelineId, guidelineId));

        const chunkRows: InsertDevxGuidelineChunk[] = chunks.map(chunk => ({
          guidelineId,
          chunkIndex: chunk.index,
          chunkText: chunk.text,
          qdrantPointId: chunk.qdrantPointId,
          chunkSize: chunk.size,
          overlapSize: chunk.overlapSize || 0,
          metadata: chunk.metadata || {}
        })) as any;

        if (chunkRows.length) {
          await tx.insert(schema.devxGuidelineChunks).values(chunkRows as any);
        }

        return guidelineId;
      });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const guidelineId = await runTransaction();
        if (chunks.length) {
          const vectorChunks = chunks.map(chunk => ({
            content: chunk.text,
            chunkIndex: chunk.index,
            metadata: chunk.metadata
          }));
          try {
            await faissVectorService.storeChunkVectors(guidelineId, vectorChunks, { source: 'devx' });
          } catch (faissErr: any) {
            console.warn(`⚠️ [VectorCacheService] FAISS embedding failed for guideline ${guideline.name}:`, faissErr?.message || faissErr);
            try {
              await db
                .update(schema.vectorizedGuidelines)
                .set({ status: 'failed', updatedAt: new Date() })
                .where(eq(schema.vectorizedGuidelines.id, guidelineId));
            } catch { /* best-effort */ }
          }
        }
        return guidelineId;
      } catch (error: any) {
        const isRetryable = error?.code === 'VECTOR_CACHE_RACE_RETRY' || error?.code === 'ER_LOCK_DEADLOCK';
        if (attempt < maxAttempts && isRetryable) {
          const jitter = Math.floor(Math.random() * 500);
          await new Promise(r => setTimeout(r, RACE_RETRY_MS * attempt + jitter));
          continue;
        }
        throw error;
      }
    }

    throw new Error(`[VectorCacheService] storeInDevxCache failed after ${maxAttempts} attempts for ${guideline.name}`);
  }

  /**
   * Store vectorized guideline in cache
   */
  async storeInCache(
    projectId: string,
    guideline: GuidelineInput,
    chunks: Array<{
      index: number;
      text: string;
      qdrantPointId: string;
      size: number;
      overlapSize?: number;
      metadata?: any;
    }>,
    processingTime: number
  ): Promise<string> {
    const maxAttempts = 2;
    const RACE_RETRY_MS = 200;

    const runTransaction = () =>
      db.transaction(async (tx) => {
        try {
          const contentHash = this.generateContentHash(guideline.content);
          const collectionName = this.generateCollectionName(projectId);

          // Check if already exists (any status) within transaction
          const [existing] = await tx
            .select()
            .from(schema.vectorizedGuidelines)
            .where(
              and(
                eq(schema.vectorizedGuidelines.projectId, projectId),
                eq(schema.vectorizedGuidelines.contentHash, contentHash)
              )
            )
            .limit(1);

          let guidelineId: string;
          let existingAfterRace = null;

          if (existing) {
            if (existing.status === 'vectorized') {
              console.log(`[VectorCacheService] ✅ Already cached: ${guideline.name} (race condition avoided)`);
              return existing.id;
            } else if (existing.status === 'processing') {
              // Update the existing 'processing' record to 'vectorized'
              console.log(`[VectorCacheService] 🔄 Updating processing record to vectorized: ${guideline.name}`);

              await tx
                .update(schema.vectorizedGuidelines)
                .set({
                  status: 'vectorized',
                  chunkCount: chunks.length,
                  processingTime,
                  updatedAt: new Date()
                })
                .where(eq(schema.vectorizedGuidelines.id, existing.id));

              guidelineId = existing.id;
            } else {
              // Failed or unknown status - update to vectorized
              console.log(`[VectorCacheService] 🔄 Updating failed record to vectorized: ${guideline.name}`);

              await tx
                .update(schema.vectorizedGuidelines)
                .set({
                  status: 'vectorized',
                  chunkCount: chunks.length,
                  processingTime,
                  updatedAt: new Date()
                })
                .where(eq(schema.vectorizedGuidelines.id, existing.id));

              guidelineId = existing.id;
            }
          } else {
            // No existing record - insert new one within transaction using UPSERT to handle race conditions
            guidelineId = randomUUID();
            const guidelineData: InsertVectorizedGuideline = {
              id: guidelineId,
              projectId,
              guidelineName: guideline.name,
              contentHash,
              qdrantCollection: collectionName,
              chunkCount: chunks.length,
              embeddingModel: 'text-embedding-ada-002',
              status: 'vectorized',
              processingTime
            };

            try {
              await tx
                .insert(schema.vectorizedGuidelines)
                .values(guidelineData);

              console.log(`[VectorCacheService] ✅ Inserted new guideline record: ${guideline.name}`);
            } catch (insertError: any) {
              // Handle race condition - another process inserted the same record (unique on contentHash)
              if (insertError.code === 'ER_DUP_ENTRY') {
                console.log(`[VectorCacheService] 🔄 Race condition detected, fetching existing record: ${guideline.name}`);

                // Fetch by projectId + contentHash first
                let [raceRecord] = await tx
                  .select()
                  .from(schema.vectorizedGuidelines)
                  .where(
                    and(
                      eq(schema.vectorizedGuidelines.projectId, projectId),
                      eq(schema.vectorizedGuidelines.contentHash, contentHash)
                    )
                  )
                  .limit(1);

                // If not found (e.g. other transaction not committed yet), try by contentHash only -
                // the duplicate key is on contentHash so the row that caused ER_DUP_ENTRY has this hash
                if (!raceRecord) {
                  [raceRecord] = await tx
                    .select()
                    .from(schema.vectorizedGuidelines)
                    .where(eq(schema.vectorizedGuidelines.contentHash, contentHash))
                    .limit(1);
                }

                if (raceRecord) {
                  console.log(`[VectorCacheService] ✅ Using existing record from race condition: ${guideline.name}`);
                  guidelineId = raceRecord.id;
                  existingAfterRace = raceRecord;

                  // Update the existing record to ensure it's marked as vectorized
                  await tx
                    .update(schema.vectorizedGuidelines)
                    .set({
                      status: 'vectorized',
                      chunkCount: chunks.length,
                      processingTime,
                      updatedAt: new Date()
                    })
                    .where(eq(schema.vectorizedGuidelines.id, raceRecord.id));
                } else {
                  // Other transaction likely not committed yet; throw so caller can retry
                  const err = new Error(`Race condition detected but couldn't find existing record for ${guideline.name}`) as Error & { code?: string };
                  err.code = 'VECTOR_CACHE_RACE_RETRY';
                  throw err;
                }
              } else {
                throw insertError;
              }
            }
          }

          // Insert chunk records (delete existing first if updating) within transaction
          if (existing || existingAfterRace) {
            // Delete existing chunks to replace with new ones
            const deleteCount = await tx
              .delete(schema.guidelineChunks)
              .where(eq(schema.guidelineChunks.guidelineId, guidelineId));
            console.log(`[VectorCacheService] 🗑️ Deleted ${deleteCount || 0} existing chunks for ${guideline.name}`);
          }

          const chunkData: InsertGuidelineChunk[] = chunks.map(chunk => ({
            guidelineId,
            chunkIndex: chunk.index,
            chunkText: chunk.text,
            qdrantPointId: chunk.qdrantPointId,
            chunkSize: chunk.size,
            overlapSize: chunk.overlapSize || 0,
            metadata: chunk.metadata || {}
          }));

          if (chunkData.length > 0) {
            console.log(`[VectorCacheService] 💾 Storing ${chunkData.length} chunks for ${guideline.name}...`);
            try {
              await tx.insert(schema.guidelineChunks).values(chunkData);
              console.log(`[VectorCacheService] ✅ Successfully stored ${chunkData.length} chunks in database`);
            } catch (chunkError) {
              console.error(`[VectorCacheService] ⚠️ Chunk insertion error for ${guideline.name}:`, chunkError);
              // If chunk insertion fails, it might be because another process already inserted them
              // This is acceptable since the guideline record exists and will be usable
              console.log(`[VectorCacheService] 🔄 Continuing despite chunk insertion issue - guideline record exists`);
            }
          }

          console.log(`[VectorCacheService] ✅ Transaction complete for guideline: ${guideline.name} (${chunks.length} chunks)`);
          return guidelineId;

        } catch (error) {
          console.error(`[VectorCacheService] Transaction failed for ${guideline.name}:`, error);
          throw error;
        }
      });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const guidelineId = await runTransaction();
        // Generate and store embeddings outside of database transaction
        try {
          if (chunks.length > 0) {
            console.log(`[VectorCacheService] 🔄 Generating embeddings for ${chunks.length} chunks with FAISS...`);
            const vectorChunks = chunks.map(chunk => ({
              content: chunk.text,
              chunkIndex: chunk.index,
              metadata: chunk.metadata
            }));
            await faissVectorService.storeChunkVectors(guidelineId, vectorChunks);
            console.log(`[VectorCacheService] ✅ Successfully stored embeddings in FAISS + database`);
          }
          console.log(`[VectorCacheService] ✅ Cached guideline: ${guideline.name} (${chunks.length} chunks)`);
          return guidelineId;
        } catch (embeddingError) {
          console.error('[VectorCacheService] ❌ Embedding generation failed — marking guideline as failed so it will be re-processed:', embeddingError);
          // Mark as 'failed' so next run re-processes instead of returning a useless cache hit with no embeddings
          try {
            await db
              .update(schema.vectorizedGuidelines)
              .set({ status: 'failed', updatedAt: new Date() })
              .where(eq(schema.vectorizedGuidelines.id, guidelineId));
          } catch (statusErr) {
            console.error('[VectorCacheService] Failed to mark guideline as failed:', statusErr);
          }
          return guidelineId;
        }
      } catch (error: any) {
        const isRetryable = error?.code === 'VECTOR_CACHE_RACE_RETRY' || error?.code === 'ER_LOCK_DEADLOCK';
        if (attempt < maxAttempts && isRetryable) {
          console.log(`[VectorCacheService] 🔄 Retrying after ${error?.code} (attempt ${attempt + 1}/${maxAttempts}): ${guideline.name}`);
          const jitter = Math.floor(Math.random() * 500);
          await new Promise(r => setTimeout(r, RACE_RETRY_MS * attempt + jitter));
          continue;
        }
        console.error('[VectorCacheService] Error storing in cache:', error);
        try {
          const contentHash = this.generateContentHash(guideline.content);
          const [failedRecord] = await db
            .select()
            .from(schema.vectorizedGuidelines)
            .where(
              and(
                eq(schema.vectorizedGuidelines.projectId, projectId),
                eq(schema.vectorizedGuidelines.contentHash, contentHash)
              )
            )
            .limit(1);
          if (failedRecord && failedRecord.status === 'processing') {
            await db
              .update(schema.vectorizedGuidelines)
              .set({ status: 'failed', updatedAt: new Date() })
              .where(eq(schema.vectorizedGuidelines.id, failedRecord.id));
          }
        } catch (updateError) {
          console.error('[VectorCacheService] Failed to mark as failed:', updateError);
        }
        throw error;
      }
    }
    throw new Error(`[VectorCacheService] storeInCache failed after ${maxAttempts} attempts for ${guideline.name}`);
  }

  /**
   * Mark guideline as processing to prevent duplicate processing
   */
  async markAsProcessing(projectId: string, guideline: GuidelineInput): Promise<string> {
    try {
      const contentHash = this.generateContentHash(guideline.content);
      const collectionName = this.generateCollectionName(projectId);

      // Check if already exists or is being processed
      const [existing] = await db
        .select()
        .from(schema.vectorizedGuidelines)
        .where(
          and(
            eq(schema.vectorizedGuidelines.projectId, projectId),
            eq(schema.vectorizedGuidelines.contentHash, contentHash)
          )
        )
        .limit(1);

      if (existing) {
        console.log(`[VectorCacheService] ⏳ Already marked or cached: ${guideline.name} (${existing.status})`);
        return existing.id;
      }

      const processingId = randomUUID();
      const guidelineData: InsertVectorizedGuideline = {
        id: processingId,
        projectId,
        guidelineName: guideline.name,
        contentHash,
        qdrantCollection: collectionName,
        chunkCount: 0,
        embeddingModel: 'text-embedding-ada-002',
        status: 'processing'
      };

      try {
        await db
          .insert(schema.vectorizedGuidelines)
          .values(guidelineData);

        return processingId;

      } catch (insertError: any) {
        // Handle duplicate entry race condition
        if (insertError.code === 'ER_DUP_ENTRY') {
          console.log(`[VectorCacheService] ⏳ Race condition: ${guideline.name} already being processed`);

          // Fetch the existing record
          const [raceExisting] = await db
            .select()
            .from(schema.vectorizedGuidelines)
            .where(
              and(
                eq(schema.vectorizedGuidelines.projectId, projectId),
                eq(schema.vectorizedGuidelines.contentHash, contentHash)
              )
            )
            .limit(1);

          return raceExisting?.id || 'unknown';
        }

        throw insertError;
      }

    } catch (error) {
      console.error('[VectorCacheService] Error marking as processing:', error);
      throw error;
    }
  }

  /**
   * Update processing status
   */
  async updateStatus(guidelineId: string, status: 'vectorized' | 'failed', processingTime?: number): Promise<void> {
    try {
      const updateData: any = {
        status,
        updatedAt: new Date()
      };

      if (processingTime) {
        updateData.processingTime = processingTime;
      }

      await db
        .update(schema.vectorizedGuidelines)
        .set(updateData)
        .where(eq(schema.vectorizedGuidelines.id, guidelineId));

    } catch (error) {
      console.error('[VectorCacheService] Error updating status:', error);
      throw error;
    }
  }

  /**
   * Get cache statistics for a project
   */
  async getCacheStats(projectId: string) {
    try {
      const [stats] = await db
        .select({
          totalGuidelines: schema.vectorizedGuidelines.id,
          vectorizedCount: schema.vectorizedGuidelines.id,
          processingCount: schema.vectorizedGuidelines.id,
          failedCount: schema.vectorizedGuidelines.id,
          totalChunks: schema.vectorizedGuidelines.chunkCount
        })
        .from(schema.vectorizedGuidelines)
        .where(eq(schema.vectorizedGuidelines.projectId, projectId));

      return stats || {
        totalGuidelines: 0,
        vectorizedCount: 0,
        processingCount: 0,
        failedCount: 0,
        totalChunks: 0
      };

    } catch (error) {
      console.error('[VectorCacheService] Error getting cache stats:', error);
      return null;
    }
  }

  /**
   * Clear project cache (for testing/debugging)
   */
  async clearProjectCache(projectId: string): Promise<void> {
    try {
      await db
        .delete(schema.vectorizedGuidelines)
        .where(eq(schema.vectorizedGuidelines.projectId, projectId));

      console.log(`[VectorCacheService] Cleared cache for project: ${projectId}`);
    } catch (error) {
      console.error('[VectorCacheService] Error clearing cache:', error);
      throw error;
    }
  }
}

export default VectorCacheService;