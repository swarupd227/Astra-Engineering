/**
 * Optimized RAG Orchestrator with Parallel Processing & Vector Caching
 * 
 * Key Optimizations:
 * 1. Parallel requirement processing
 * 2. Batch document matching (single LLM call)
 * 3. Azure SQL + Qdrant hybrid caching
 * 4. Concurrent guideline processing
 * 5. Reduced LLM API calls from 2N+1 to N+2
 */

import { randomUUID } from 'crypto';
import type {
  ProcessingSession,
  VectorDBInstance, 
  ExtractedRequirements,
  RAGProcessingResponse,
  Requirement,
  RAGResult,
  NormalizedDocument,
  SemanticChunk,
  RagDebugPayload,
  RagDebugParseResult
} from './models';

// Individual agent imports
import { 
  StructureExtractionAgent, 
  SmartChunkingEngine,
  SemanticRAGRetrievalAgent, 
  RequirementExtractorAgent,
  ResponseSynthesisAgent
} from './agents';

import { llmClient } from './llmClient';
import { config } from './config';
import { VectorCacheService } from './vectorCacheService';
import { db } from '../../db';
import { eq } from 'drizzle-orm';
import * as schema from '@shared/schema';

export class OptimizedRAGOrchestrator {
  private structureExtractor: StructureExtractionAgent;
  private chunkingEngine: SmartChunkingEngine;
  private requirementExtractor: RequirementExtractorAgent;
  private synthesizer: ResponseSynthesisAgent;
  private vectorCache: VectorCacheService;
  
  private sessions: Map<string, ProcessingSession> = new Map();
  private vectorDbInstances: Map<string, VectorDBInstance> = new Map();

  constructor() {
    console.log('[OptimizedRAG] Initializing with parallel processing + vector caching...');

    this.structureExtractor = new StructureExtractionAgent();
    this.chunkingEngine = new SmartChunkingEngine(
      config.CHUNK_SIZE,
      config.CHUNK_SIZE + 200,
      config.CHUNK_OVERLAP
    );
    this.requirementExtractor = new RequirementExtractorAgent();
    this.synthesizer = new ResponseSynthesisAgent();
    this.vectorCache = VectorCacheService.getInstance();

    console.log(`[OptimizedRAG] Initialized — pipeline mode: "${config.PIPELINE_MODE}", coverage check: ${config.COVERAGE_CHECK_ENABLED}`);
  }

  /**
   * Main entry point - Optimized with parallel processing and caching
   * @param options.debug - When true, collect and return ragDebug (files, parse, chunk, summary usage)
   */
  async processBrdWithGuidelines(
    sessionId: string,
    brdContent: string,
    guidelineDocuments: Record<string, string>,
    projectId: string,
    userQuery?: string,
    options?: { debug?: boolean; goldenRepoId?: string; pipelineModeOverride?: string }
  ): Promise<RAGProcessingResponse> {
    const startTime = Date.now();
    const debug = options?.debug === true;

    try {
      console.log(`\n[OptimizedRAG] Starting PARALLEL session ${sessionId} for project ${projectId}`);

      // Create RAG session record in database (with duplicate handling)
      try {
        await db.insert(schema.ragSessions).values({
          id: sessionId,
          projectId,
          sessionType: 'artifact_generation',
          status: 'processing',
          cacheHitCount: 0,
          cacheMissCount: 0
        });
      } catch (insertError: any) {
        if (insertError.code === 'ER_DUP_ENTRY') {
          console.log(`[OptimizedRAG] ⚠️ Session ${sessionId} already exists, checking status...`);
          
          // Check if existing session is completed or failed
          const [existingSession] = await db
            .select()
            .from(schema.ragSessions)
            .where(eq(schema.ragSessions.id, sessionId))
            .limit(1);
          
          if (existingSession && existingSession.status === 'processing') {
            // If still processing, check if it's stale (> 10 minutes)
            const sessionAge = Date.now() - new Date(existingSession.createdAt).getTime();
            const maxSessionTime = 10 * 60 * 1000; // 10 minutes
            
            if (sessionAge > maxSessionTime) {
              console.log(`[OptimizedRAG] 🔄 Stale session detected, updating to new processing...`);
              await db
                .update(schema.ragSessions)
                .set({
                  status: 'processing',
                  cacheHitCount: 0,
                  cacheMissCount: 0,
                  createdAt: new Date()
                })
                .where(eq(schema.ragSessions.id, sessionId));
            } else {
              console.log(`[OptimizedRAG] ❌ Session ${sessionId} is currently being processed by another instance`);
              throw new Error(`Session ${sessionId} is already being processed`);
            }
          } else if (existingSession) {
            // Reset completed/failed session for reuse
            console.log(`[OptimizedRAG] 🔄 Resetting existing session ${sessionId}...`);
            await db
              .update(schema.ragSessions)
              .set({
                status: 'processing',
                cacheHitCount: 0,
                cacheMissCount: 0,
                totalProcessingTime: null,
                ragProcessingTime: null,
                requirementIds: null,
                guidelineIds: null,
                completedAt: null,
                createdAt: new Date()
              })
              .where(eq(schema.ragSessions.id, sessionId));
          }
        } else {
          throw insertError;
        }
      }

      // Initialize session
      const session: ProcessingSession = {
        sessionId,
        projectId, // Add project identifier
        status: 'processing',
        ragResults: [],
        vectorDbInstances: [],
        createdAt: new Date()
      };
      this.sessions.set(sessionId, session);

      // Log which files are being used for RAG (guideline documents = golden repo files)
      const ragFileNames = Object.keys(guidelineDocuments);
      const ragFileStats = ragFileNames.map((name) => ({
        file: name,
        contentLength: (guidelineDocuments[name] ?? '').length,
      }));
      console.log('[OptimizedRAG] RAG usage — files going for RAG:', ragFileNames);
      console.log('[OptimizedRAG] RAG usage — file stats (name, content length):', ragFileStats);
      if (debug) {
        console.log('[BRD-RAG-DEBUG] Orchestrator: guideline documents received', { count: ragFileNames.length, names: ragFileNames, stats: ragFileStats });
      }

      // ===========================================
      // PIPELINE MODE BRANCHING
      // ===========================================
      const pipelineMode = (options?.pipelineModeOverride || config.PIPELINE_MODE).trim();
      console.log(`[OptimizedRAG] Pipeline mode: "${pipelineMode}"`);

      let finalSummary: string;
      let extractedRequirements: ExtractedRequirements;
      let ragResults: RAGResult[] = [];
      let cacheStats = { hits: 0, misses: 0 };
      let debugParseResults: RagDebugParseResult[] | undefined;
      const sourceFilesUsedInSummary = new Set<string>();

      if (pipelineMode === 'cag_pageindex') {
        // =============================================
        // CAG + PageIndex MODE
        // =============================================
        // Skips: chunking, embeddings, FAISS, batch matching, per-requirement synthesis
        // Does: Extract requirements (for BRD) + PageIndex (for 100% coverage)
        // LLM calls: 1 (requirement extraction) + 0-N (PageIndex for Tier 2/3 docs only)
        // =============================================
        console.log('[OptimizedRAG] [CAG+PageIndex] === CAG MODE: Skipping Phases 2-4 (no chunking/FAISS/retrieval) ===');
        const cagStartTime = Date.now();

        // Phase 1 only: Extract requirements (needed for BRD generation, not for retrieval)
        console.log('[OptimizedRAG] [CAG+PageIndex] Phase 1: Extracting requirements...');
        extractedRequirements = await this.requirementExtractor.extractRequirements(brdContent);
        session.extractedRequirements = extractedRequirements;
        console.log(`[OptimizedRAG] [CAG+PageIndex] Extracted ${extractedRequirements.requirements.length} requirements`);

        // Build PageIndex directly from raw guideline documents
        const guidelineEntries = Object.entries(guidelineDocuments);
        const totalSourceChars = guidelineEntries.reduce((sum, [, c]) => sum + (c ?? '').length, 0);
        console.log(`[OptimizedRAG] [CAG+PageIndex] Total source content: ${totalSourceChars} chars across ${guidelineEntries.length} files`);
        console.log(`[OptimizedRAG] [CAG+PageIndex] Context budget: ${config.CAG_CONTEXT_BUDGET_CHARS} chars`);

        // Sort by size ascending so we can greedily fill context with full docs first
        const sortedEntries = [...guidelineEntries].sort((a, b) => (a[1] ?? '').length - (b[1] ?? '').length);

        const cagParts: string[] = [];
        let cagCharBudget = config.CAG_CONTEXT_BUDGET_CHARS;
        const tierStats = { tier1: 0, tier2: 0, tier3: 0 };

        for (let docIdx = 0; docIdx < sortedEntries.length; docIdx++) {
          const [name, content] = sortedEntries[docIdx];
          const charLen = (content ?? '').length;
          // Recalculate fair share for remaining docs
          const remainingDocs = sortedEntries.length - docIdx;
          const fairBudget = Math.floor(cagCharBudget / Math.max(remainingDocs, 1));

          try {
            if (charLen <= fairBudget && charLen <= config.PAGEINDEX_TIER1_MAX_CHARS) {
              // Tier 1: fits in fair budget AND is small — full passthrough (ZERO loss)
              console.log(`[OptimizedRAG] [CAG+PageIndex] Tier1 PASSTHROUGH: ${name} [${charLen} chars] — full content in context`);
              cagParts.push(`=== FULL DOCUMENT: ${name} ===\n${content}`);
              cagCharBudget -= charLen;
              tierStats.tier1++;
            } else if (charLen <= fairBudget) {
              // Larger doc but fits in fair budget — still pass through
              console.log(`[OptimizedRAG] [CAG+PageIndex] Tier1 PASSTHROUGH (large): ${name} [${charLen} chars] — fits in fair budget`);
              cagParts.push(`=== FULL DOCUMENT: ${name} ===\n${content}`);
              cagCharBudget -= charLen;
              tierStats.tier1++;
            } else if (charLen <= config.PAGEINDEX_TIER2_MAX_CHARS) {
              // Doesn't fit raw — compress with PageIndex (Tier 2)
              if (config.DISABLE_PAGEINDEX) {
                console.log(`[OptimizedRAG] [CAG+PageIndex] Tier2 (PageIndex disabled): ${name} [${charLen} chars] — truncating to budget`);
                const keep = Math.min(Math.max(cagCharBudget, 5000), config.PAGEINDEX_TIER1_MAX_CHARS);
                const truncated = (content ?? '').slice(0, keep);
                cagParts.push(`=== DOCUMENT (truncated): ${name} ===\n${truncated}`);
                cagCharBudget -= truncated.length;
                tierStats.tier2++;
              } else {
                console.log(`[OptimizedRAG] [CAG+PageIndex] Tier2 PAGE-INDEX: ${name} [${charLen} chars] — exceeds fair budget (${fairBudget}), indexing...`);
                const index = await this.synthesizer.generatePageIndex(name, content);
                cagParts.push(`=== PAGE INDEX (compressed): ${name} ===\n${index}`);
                cagCharBudget -= index.length;
                tierStats.tier2++;
              }
            } else {
              // Very large doc — Tier 3 section-by-section
              if (config.DISABLE_PAGEINDEX) {
                console.log(`[OptimizedRAG] [CAG+PageIndex] Tier3 (PageIndex disabled): ${name} [${charLen} chars] — truncating to budget`);
                const keep = Math.min(Math.max(cagCharBudget, 8000), config.PAGEINDEX_TIER1_MAX_CHARS);
                const truncated = (content ?? '').slice(0, keep);
                cagParts.push(`=== DOCUMENT (truncated): ${name} ===\n${truncated}`);
                cagCharBudget -= truncated.length;
                tierStats.tier3++;
              } else {
                console.log(`[OptimizedRAG] [CAG+PageIndex] Tier3 SECTION-INDEX: ${name} [${charLen} chars] — section-by-section indexing...`);
                const sectionIndex = await this.buildSectionIndex(name, content);
                cagParts.push(`=== PAGE INDEX (sections): ${name} ===\n${sectionIndex}`);
                cagCharBudget -= sectionIndex.length;
                tierStats.tier3++;
              }
            }
          } catch (err) {
            console.warn(`[OptimizedRAG] [CAG+PageIndex] Failed for ${name}, falling back to truncated:`, err instanceof Error ? err.message : String(err));
            const truncated = (content ?? '').slice(0, Math.min(config.PAGEINDEX_TIER1_MAX_CHARS, Math.max(cagCharBudget, 5000)));
            cagParts.push(`=== DOCUMENT (truncated fallback): ${name} ===\n${truncated}`);
            cagCharBudget -= truncated.length;
          }
        }

        finalSummary = cagParts.join('\n\n');
        const cagTime = Date.now() - cagStartTime;

        console.log(`[OptimizedRAG] [CAG+PageIndex] Complete in ${cagTime}ms`);
        console.log(`[OptimizedRAG] [CAG+PageIndex] Tier stats: Tier1(passthrough)=${tierStats.tier1}, Tier2(page-index)=${tierStats.tier2}, Tier3(section-index)=${tierStats.tier3}`);
        console.log(`[OptimizedRAG] [CAG+PageIndex] Final output: ${finalSummary.length} chars (budget remaining: ${cagCharBudget} chars)`);
        console.log(`[OptimizedRAG] [CAG+PageIndex] Phases skipped: 2 (chunking), 3 (batch match), 4 (FAISS retrieval)`);

      } else {
        // =============================================
        // RAG + PageIndex HYBRID MODE
        // =============================================
        // Runs: ALL phases (1-4) for semantic retrieval
        // Plus: PageIndex layer in parallel for 100% coverage
        // Merges: PageIndex (breadth) + RAG synthesis (depth)
        // =============================================
        console.log('[OptimizedRAG] [RAG+PageIndex] === HYBRID MODE: Running full RAG pipeline + PageIndex ===');

        // --- Phase 1: Extract requirements ---
        console.log('[OptimizedRAG] [RAG+PageIndex] Phase 1: Extracting requirements...');
        extractedRequirements = await this.requirementExtractor.extractRequirements(brdContent);
        session.extractedRequirements = extractedRequirements;
        console.log(`[OptimizedRAG] [RAG+PageIndex] Extracted ${extractedRequirements.requirements.length} requirements`);

        // --- Phase 2: Parallel guideline chunking + embedding ---
        console.log('[OptimizedRAG] [RAG+PageIndex] Phase 2: Processing guidelines in PARALLEL...');
        const guidelines = Object.entries(guidelineDocuments).map(([name, content]) => ({
          name,
          content
        }));

        // DevX is the single source of truth: always use DevX cache (goldenRepoId or projectId as key)
        const devxCacheKey = options?.goldenRepoId ?? projectId;
        const guidelineResult = await this.processGuidelinesInParallel(
          guidelines,
          session,
          debug,
          devxCacheKey
        );
        const { normalizedDocs, flatChunks } = guidelineResult;
        cacheStats = guidelineResult.cacheStats;
        debugParseResults = guidelineResult.debugParseResults;

        console.log(`[OptimizedRAG] [RAG+PageIndex] Guidelines processed: ${cacheStats.hits} cached, ${cacheStats.misses} new`);

        // RAG usage logging
        const chunkCountBySource: Record<string, number> = {};
        for (const chunk of Object.values(flatChunks)) {
          const src = chunk.metadata?.sourceFile ?? chunk.metadata?.docId ?? 'unknown';
          chunkCountBySource[src] = (chunkCountBySource[src] ?? 0) + 1;
        }
        console.log('[OptimizedRAG] [RAG+PageIndex] Chunks per file:', chunkCountBySource);
        const totalAvailableChunks = Object.keys(flatChunks).length;
        console.log(`[OptimizedRAG] [RAG+PageIndex] Total chunks available: ${totalAvailableChunks}`);

        const chunkEntries = Object.entries(flatChunks);
        const maxChunksToLog = 10;
        console.log('[BRD-RAG] Chunking complete — sample of chunks:');
        chunkEntries.slice(0, maxChunksToLog).forEach(([chunkId, chunk], i) => {
          const contentPreview = typeof chunk.content === 'string'
            ? chunk.content.slice(0, 120) + (chunk.content.length > 120 ? '...' : '')
            : String(chunk.content).slice(0, 120);
          console.log(`[BRD-RAG]   chunk[${i}] id=${chunkId} sourceFile=${chunk.metadata?.sourceFile ?? 'n/a'} contentPreview=${JSON.stringify(contentPreview)}`);
        });
        if (chunkEntries.length > maxChunksToLog) {
          console.log(`[BRD-RAG]   ... and ${chunkEntries.length - maxChunksToLog} more chunks`);
        }
        if (debug && debugParseResults?.length) {
          console.log('[BRD-RAG-DEBUG] Parse/chunk results:', debugParseResults);
        }

        // --- Phase 3: Batch document matching ---
        console.log('[OptimizedRAG] [RAG+PageIndex] Phase 3: Batch document matching...');
        const requirementToDocsMapping = await this.batchMatchRequirementsToGuidelines(
          extractedRequirements.requirements,
          normalizedDocs
        );

        // --- Phase 4: Parallel FAISS semantic retrieval ---
        console.log('[OptimizedRAG] [RAG+PageIndex] Phase 4: Semantic retrieval...');
        const semanticRAGRetriever = new SemanticRAGRetrievalAgent(flatChunks, normalizedDocs, {
          chunkSource: 'devx' // DevX is the single source of truth
        });

        ragResults = await Promise.all(
          extractedRequirements.requirements.map(async (req) => {
            const matchedDocs = requirementToDocsMapping[req.requirementId] || [];

            const retrievedChunks = await semanticRAGRetriever.retrieveForRequirement(
              req,
              matchedDocs,
              session.projectId,
              config.TOP_K_RESULTS,
              0.35
            );

            console.log(`[BRD-RAG] req=${req.requirementId} retrievedChunks=${retrievedChunks.length}`);
            retrievedChunks.slice(0, 5).forEach((chunk, i) => {
              const contentPreview = typeof chunk.content === 'string'
                ? chunk.content.slice(0, 100) + (chunk.content.length > 100 ? '...' : '')
                : String(chunk.content).slice(0, 100);
              console.log(`[BRD-RAG]   retrieved[${i}] sourceFile=${chunk.metadata?.sourceFile ?? 'n/a'} contentPreview=${JSON.stringify(contentPreview)}`);
            });

            if (debug && retrievedChunks.length > 0) {
              retrievedChunks.forEach((chunk) => {
                const sf = chunk.metadata?.sourceFile;
                if (sf) sourceFilesUsedInSummary.add(sf);
              });
            }

            const chunkSummary = await this.synthesizer.synthesize(req, retrievedChunks);

            return {
              requirementId: req.requirementId,
              requirementDescription: req.description,
              finalSummary: chunkSummary,
              totalChunksFound: retrievedChunks.length,
              coverage: Math.min(100.0, (retrievedChunks.length / 3) * 100)
            } as RAGResult;
          })
        );

        session.ragResults = ragResults;
        if (debug) {
          console.log('[BRD-RAG-DEBUG] Files that contributed to RAG summary:', Array.from(sourceFilesUsedInSummary));
        }

        // --- Phase 5: Merge PageIndex (breadth) + RAG synthesis (depth) ---
        console.log('[OptimizedRAG] [RAG+PageIndex] Phase 5: Building PageIndex + merging with RAG...');
        const hybridStartTime = Date.now();

        // PageIndex layer: ensures 100% document coverage
        const pageIndexParts: string[] = [];
        const guidelineEntries = Object.entries(guidelineDocuments);

        await Promise.all(guidelineEntries.map(async ([name, content]) => {
          const charLen = (content ?? '').length;
          try {
            if (charLen <= config.PAGEINDEX_TIER1_MAX_CHARS) {
              console.log(`[OptimizedRAG] [RAG+PageIndex] Tier1 PASSTHROUGH: ${name} [${charLen} chars]`);
              pageIndexParts.push(`=== FULL DOCUMENT: ${name} ===\n${content}`);
            } else if (charLen <= config.PAGEINDEX_TIER2_MAX_CHARS) {
              console.log(`[OptimizedRAG] [RAG+PageIndex] Tier2 PAGE-INDEX: ${name} [${charLen} chars]`);
              if (config.DISABLE_PAGEINDEX) {
                const truncated = (content ?? '').slice(0, config.PAGEINDEX_TIER1_MAX_CHARS);
                pageIndexParts.push(`=== DOCUMENT (truncated): ${name} ===\n${truncated}`);
              } else {
                const index = await this.synthesizer.generatePageIndex(name, content);
                pageIndexParts.push(`=== PAGE INDEX: ${name} ===\n${index}`);
              }
            } else {
              console.log(`[OptimizedRAG] [RAG+PageIndex] Tier3 SECTION-INDEX: ${name} [${charLen} chars]`);
              if (config.DISABLE_PAGEINDEX) {
                const truncated = (content ?? '').slice(0, config.PAGEINDEX_TIER1_MAX_CHARS);
                pageIndexParts.push(`=== DOCUMENT (truncated): ${name} ===\n${truncated}`);
              } else {
                const sectionIndex = await this.buildSectionIndex(name, content);
                pageIndexParts.push(`=== PAGE INDEX: ${name} ===\n${sectionIndex}`);
              }
            }
          } catch (pageIndexErr) {
            console.warn(`[OptimizedRAG] [RAG+PageIndex] PageIndex failed for ${name}, truncating:`, pageIndexErr instanceof Error ? pageIndexErr.message : String(pageIndexErr));
            const truncated = (content ?? '').slice(0, config.PAGEINDEX_TIER1_MAX_CHARS);
            pageIndexParts.push(`=== DOCUMENT (truncated): ${name} ===\n${truncated}`);
          }
        }));

        const pageIndexGuidance = pageIndexParts.join('\n\n');
        console.log(`[OptimizedRAG] [RAG+PageIndex] PageIndex: ${pageIndexParts.length} documents, ${pageIndexGuidance.length} chars`);

        // RAG synthesis from Phase 4
        const ragSynthesis = await this.synthesizer.synthesizeAllRequirements(ragResults, userQuery);
        console.log(`[OptimizedRAG] [RAG+PageIndex] RAG synthesis: ${ragSynthesis.length} chars`);

        // Merge
        finalSummary = `${pageIndexGuidance}\n\n========================\nSEMANTIC RAG DEEP-DIVE (requirement-matched details)\n========================\n${ragSynthesis}`;

        const hybridTime = Date.now() - hybridStartTime;
        console.log(`[OptimizedRAG] [RAG+PageIndex] Complete in ${hybridTime}ms — PageIndex: ${pageIndexGuidance.length} chars, RAG: ${ragSynthesis.length} chars, Total: ${finalSummary.length} chars`);
      }

      // --- Log final summary stats ---
      const summaryPreview = finalSummary?.slice(0, 300) ?? '';
      console.log(`[BRD-RAG] Pipeline="${pipelineMode}" finalSummary length=${finalSummary?.length ?? 0}`);
      console.log('[BRD-RAG] RAG finalSummary preview:', summaryPreview + (finalSummary && finalSummary.length > 300 ? '...' : ''));

      // ===========================================
      // COVERAGE CHECK (optional, LLM-based)
      // ===========================================
      if (config.COVERAGE_CHECK_ENABLED) {
        console.log('[OptimizedRAG] [CoverageCheck] Running LLM coverage verification...');
        const coverageStartTime = Date.now();
        try {
          const coverageReport = await this.synthesizer.checkCoverage(finalSummary, guidelineDocuments, pipelineMode);
          const coverageTime = Date.now() - coverageStartTime;

          console.log('='.repeat(60));
          console.log('[CoverageCheck] COVERAGE REPORT');
          console.log('='.repeat(60));
          console.log(`[CoverageCheck] Pipeline mode: ${coverageReport.pipelineMode}`);
          console.log(`[CoverageCheck] Coverage: ${coverageReport.coveragePercent}%`);
          console.log(`[CoverageCheck] Codes found (${coverageReport.codesFound.length}): ${coverageReport.codesFound.join(', ')}`);
          console.log(`[CoverageCheck] Codes missing (${coverageReport.codesMissing.length}): ${coverageReport.codesMissing.length > 0 ? coverageReport.codesMissing.join(', ') : 'NONE'}`);
          console.log(`[CoverageCheck] Summary: ${coverageReport.summary}`);
          console.log(`[CoverageCheck] Check completed in ${coverageTime}ms`);
          console.log('='.repeat(60));
        } catch (coverageErr) {
          console.warn('[CoverageCheck] Coverage check failed (non-blocking):', coverageErr instanceof Error ? coverageErr.message : String(coverageErr));
        }
      } else {
        console.log('[OptimizedRAG] [CoverageCheck] Disabled (set RAG_COVERAGE_CHECK=true to enable)');
      }

      // Complete session
      session.status = 'completed';
      session.completedAt = new Date();

      const totalTime = Date.now() - startTime;
      
      // Update RAG session in database
      await db.update(schema.ragSessions)
        .set({
          status: 'completed',
          cacheHitCount: cacheStats.hits,
          cacheMissCount: cacheStats.misses,
          totalProcessingTime: totalTime,
          ragProcessingTime: totalTime, // For now, same as total
          completedAt: new Date(),
          requirementIds: extractedRequirements.requirements.map(r => r.requirementId),
          guidelineIds: ragFileNames
        })
        .where(eq(schema.ragSessions.id, sessionId));
      const totalChunksRetrieved = ragResults.reduce((sum, result) => sum + result.totalChunksFound, 0);
      const avgCoverage = ragResults.length > 0 
        ? ragResults.reduce((sum, result) => sum + result.coverage, 0) / ragResults.length 
        : 0;

      const summaryInputCharCount = ragResults.reduce((sum, r) => sum + (r.finalSummary?.length ?? 0), 0) + (userQuery?.length ?? 0);
      const finalFilesUsedForSummary = debug ? Array.from(sourceFilesUsedInSummary) : [];
      const parseResultsWithContribution: RagDebugParseResult[] = (debug && debugParseResults?.length)
        ? debugParseResults.map((p) => ({ ...p, contributedToSummary: sourceFilesUsedInSummary.has(p.name) }))
        : [];

      const response: RAGProcessingResponse = {
        success: true,
        message: `${pipelineMode.toUpperCase()} pipeline completed in ${totalTime}ms (${cacheStats.hits}/${cacheStats.hits + cacheStats.misses} from cache)`,
        sessionId: sessionId,
        finalSummary: finalSummary,
        extractedRequirements: extractedRequirements,
        ragResults: ragResults,
        vectorDbInstances: session.vectorDbInstances,
        processingTimestamp: new Date(),
        totalChunksRetrieved: totalChunksRetrieved,
        coveragePercentage: Math.round(avgCoverage * 100) / 100
      };

      if (debug) {
        (response as RAGProcessingResponse & { ragDebug: RagDebugPayload }).ragDebug = {
          enabled: true,
          filesDiscovered: [],
          filesSelected: ragFileNames,
          filesSkipped: [],
          parseResults: parseResultsWithContribution,
          finalFilesUsedForSummary,
          summaryInputCharCount,
        };
        console.log('[BRD-RAG-DEBUG] Orchestrator ragDebug attached', { parseResultsCount: parseResultsWithContribution.length, finalFilesUsedForSummary, summaryInputCharCount });
      }

      console.log(`[OptimizedRAG] ✅ PARALLEL session completed in ${totalTime}ms`);
      console.log(`[OptimizedRAG] Cache performance: ${cacheStats.hits}/${cacheStats.hits + cacheStats.misses} hit rate`);
      console.log(`[OptimizedRAG] Requirements processed: ${ragResults.length} in parallel`);
      
      return response;

    } catch (error) {
      console.error(`[OptimizedRAG] PARALLEL session ${sessionId} failed:`, error);
      const currentSession = this.sessions.get(sessionId);
      if (currentSession) {
        currentSession.status = 'error';
      }
      
      throw new Error(`Parallel RAG processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process guidelines in parallel with vector caching
   * When debug is true, returns debugParseResults for each guideline (parse status, chunk count, etc.)
   */
  private async processGuidelinesInParallel(
    guidelines: Array<{ name: string; content: string }>,
    session: ProcessingSession,
    debug: boolean = false,
    devxCacheKey: string // goldenRepoId or projectId — DevX is the single source of truth
  ): Promise<{
    normalizedDocs: Record<string, NormalizedDocument>;
    flatChunks: Record<string, SemanticChunk>;
    cacheStats: { hits: number; misses: number };
    debugParseResults?: RagDebugParseResult[];
  }> {
    
    // Check DevX cache for all guidelines at once (DevX is the single source of truth)
    console.log(`[OptimizedRAG] Checking DevX cache for ${guidelines.length} guidelines (key=${devxCacheKey})...`);
    const cacheResults = await this.vectorCache.checkMultipleDevxCache(devxCacheKey, guidelines);
    
    const normalizedDocs: Record<string, NormalizedDocument> = {};
    const flatChunks: Record<string, SemanticChunk> = {};
    let cacheHits = 0;
    let cacheMisses = 0;
    const debugParseResults: RagDebugParseResult[] = [];

    // Process all guidelines in parallel
    await Promise.all(guidelines.map(async (guideline, index) => {
      const docId = `doc_${guideline.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const cacheResult: any = cacheResults.get(guideline.name) || { found: false };
      const extractedTextLength = (guideline.content ?? '').length;

      if (cacheResult.found) {
        // Cache hit - reuse existing vectors
        console.log(`[OptimizedRAG] ✅ Cache hit: ${guideline.name}`);
        cacheHits++;
        if (debug) {
          console.log('[BRD-RAG-DEBUG] Parse/chunk: cache hit', { name: guideline.name, chunkCount: cacheResult.chunks!.length, extractedTextLength });
        }

        // Create normalized document from cache (id must be vectorized_guidelines.id for FAISS/chunk lookup)
        normalizedDocs[docId] = {
          id: cacheResult.vectorizedGuideline!.id,
          sourceFile: guideline.name,
          docType: 'guideline',
          title: guideline.name,
          summary: 'Cached guideline content',
          sections: [{ sectionPath: ['cached'], sectionId: 'cached-1', blocks: [] }],
          totalBlocks: cacheResult.chunks!.length,
          extractedStructure: {
            method: 'cached',
            sections: 1,
            timestamp: new Date().toISOString()
          }
        };

        // Convert cached chunks to SemanticChunk format
        const semanticChunks: SemanticChunk[] = cacheResult.chunks!.map((chunk: any) => ({
          chunkId: chunk.qdrantPointId,
          content: chunk.chunkText,
          metadata: {
            chunkId: chunk.qdrantPointId,
            chunkType: 'semantic' as any,
            sectionPath: ['cached'],
            docId: docId,
            sourceFile: guideline.name,
            tokenCount: chunk.chunkSize,
            isAtomic: true
          },
          isComplete: true,
          validationStatus: 'valid'
        }));

        // Add to flat chunks
        semanticChunks.forEach(chunk => {
          flatChunks[chunk.chunkId] = chunk;
        });

        if (debug) {
          debugParseResults.push({
            name: guideline.name,
            path: guideline.name,
            parseStatus: 'cache_hit',
            extractedTextLength,
            chunkCount: semanticChunks.length,
            contributedToSummary: false
          });
        }

        // Create vector DB instance reference
        const dbInstance: VectorDBInstance = {
          instanceId: cacheResult.vectorizedGuideline!.id,
          sourceId: docId,
          sourceName: guideline.name,
          sourceType: 'upload',
          docId,
          documentType: 'guideline',
          vectorDbType: 'qdrant_cached',
          persistPath: cacheResult.qdrantCollection!,
          chunkCount: semanticChunks.length,
          status: 'active',
          createdAt: new Date()
        };

        this.vectorDbInstances.set(dbInstance.instanceId, dbInstance);
        session.vectorDbInstances.push(dbInstance);

      } else {
        // Cache miss - process and cache (auto-chunk on first use for both project and DevX golden repos)
        console.log(`[OptimizedRAG] ❌ Cache miss: ${guideline.name} - processing in parallel...`);
        cacheMisses++;

        // Mark as processing to prevent duplicate work (DevX only)
        await this.vectorCache.markDevxAsProcessing(devxCacheKey, guideline);

        try {
          // Extract structure and chunk
          const structure = this.structureExtractor.extractFromText(
            guideline.content, 
            guideline.name, 
            'guideline'
          );
          normalizedDocs[docId] = structure;

          const chunks = this.chunkingEngine.chunkDocument(structure);
          
          chunks.forEach(chunk => {
            flatChunks[chunk.chunkId] = chunk;
          });

          if (debug) {
            console.log('[BRD-RAG-DEBUG] Parse/chunk: success', { name: guideline.name, chunkCount: chunks.length, extractedTextLength });
            if (extractedTextLength === 0) {
              console.warn('[BRD-RAG-DEBUG] Empty extracted text for guideline (zero chars):', guideline.name);
            }
            if (extractedTextLength > 0 && extractedTextLength < 50) {
              console.warn('[BRD-RAG-DEBUG] Very low extracted text length:', guideline.name, 'chars:', extractedTextLength);
            }
            debugParseResults.push({
              name: guideline.name,
              path: guideline.name,
              parseStatus: 'success',
              extractedTextLength,
              chunkCount: chunks.length,
              contributedToSummary: false
            });
          }

          // Store in cache for future use (project or DevX)
          const chunkData = chunks.map((chunk, index) => ({
            index: index, // Use simple index instead of parsing UUID
            text: chunk.content,
            qdrantPointId: chunk.chunkId,
            size: chunk.metadata.tokenCount || chunk.content.length,
            overlapSize: 0,
            metadata: chunk.metadata
          }));

          const processingTime = 100; // Placeholder; actual time would require measuring
          const guidelineId = await this.vectorCache.storeInDevxCache(devxCacheKey, guideline, chunkData, processingTime);

          // Use guideline id so FAISS and chunk lookup use the same UUID
          if (normalizedDocs[docId]) {
            normalizedDocs[docId].id = guidelineId;
          }

          console.log(`[OptimizedRAG] ✅ Cached in DevX for future use: ${guideline.name}`);

          // Create vector DB instance
          const dbInstance: VectorDBInstance = {
            instanceId: guidelineId,
            sourceId: docId,
            sourceName: guideline.name,
            sourceType: 'upload',
            docId,
            documentType: 'guideline',
            vectorDbType: 'qdrant_cached',
            persistPath: `golden_repo_${devxCacheKey}_guidelines`,
            chunkCount: chunks.length,
            status: 'active',
            createdAt: new Date()
          };

          this.vectorDbInstances.set(dbInstance.instanceId, dbInstance);
          session.vectorDbInstances.push(dbInstance);

        } catch (cacheError) {
          const errMsg = cacheError instanceof Error ? cacheError.message : String(cacheError);
          const errStack = cacheError instanceof Error ? cacheError.stack : undefined;
          console.error(`[OptimizedRAG] Failed to process/cache ${guideline.name}:`, cacheError);
          if (debug) {
            console.error('[BRD-RAG-DEBUG] Parse/chunk failed', { name: guideline.name, error: errMsg, stack: errStack ? String(errStack).slice(0, 500) : undefined });
            debugParseResults.push({
              name: guideline.name,
              path: guideline.name,
              parseStatus: 'failed',
              parseError: errMsg,
              extractedTextLength,
              chunkCount: 0,
              contributedToSummary: false
            });
          }
          // Continue processing even if one guideline fails
        }
      }
    }));

    return {
      normalizedDocs,
      flatChunks,
      cacheStats: { hits: cacheHits, misses: cacheMisses },
      ...(debug ? { debugParseResults } : {})
    };
  }

  /**
   * Batch match all requirements to guidelines in a single LLM call
   */
  private async batchMatchRequirementsToGuidelines(
    requirements: Requirement[],
    docSummaries: Record<string, NormalizedDocument>
  ): Promise<Record<string, string[]>> {
    
    const availableDocs = Object.entries(docSummaries)
      .map(([docId, doc]) => `${docId}: ${doc.title}`)
      .join('\n');

    const requirementsList = requirements
      .map(req => `${req.requirementId}: ${req.description}`)
      .join('\n');

    const prompt = `
      You are a document matching expert. Match each requirement to the most relevant guideline documents.

      REQUIREMENTS:
      ${requirementsList}

      AVAILABLE GUIDELINE DOCUMENTS:
      ${availableDocs}

      For each requirement, return the matching document IDs in this exact format:
      RequirementID: DocumentID1, DocumentID2, ...

      If no documents match, use: RequirementID: NONE

      Example:
      REQ-001: doc_feature_guideline, doc_epic_guideline
      REQ-002: NONE
      REQ-003: doc_bugs_defect_guideline

      Return only the matching results, no explanations.
    `;

    try {
      const response = await llmClient.generateCompletion([
        { role: 'user', content: prompt }
      ]);
      const mappings: Record<string, string[]> = {};
      
      const lines = response.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;
        
        const reqId = line.substring(0, colonIndex).trim();
        const docsText = line.substring(colonIndex + 1).trim();
        
        if (docsText === 'NONE' || docsText === '') {
          mappings[reqId] = [];
        } else {
          mappings[reqId] = docsText.split(',').map(doc => doc.trim()).filter(doc => doc);
        }
      }

      // Ensure all requirements have mappings
      requirements.forEach(req => {
        if (!mappings[req.requirementId]) {
          mappings[req.requirementId] = [];
        }
      });

      console.log(`[OptimizedRAG] Batch matched ${requirements.length} requirements to guidelines`);
      return mappings;

    } catch (error) {
      console.error('[OptimizedRAG] Batch matching failed:', error);
      
      // Fallback: create empty mappings
      const fallbackMappings: Record<string, string[]> = {};
      requirements.forEach(req => {
        fallbackMappings[req.requirementId] = [];
      });
      return fallbackMappings;
    }
  }

  /**
   * Build a section-by-section PageIndex for a large document (Tier 3).
   * Splits by markdown headers, indexes each section in parallel, merges results.
   */
  private async buildSectionIndex(name: string, content: string): Promise<string> {
    if (config.DISABLE_PAGEINDEX) {
      return (content ?? "").slice(0, config.PAGEINDEX_TIER1_MAX_CHARS);
    }
    const sectionSize = config.PAGEINDEX_SECTION_SIZE;
    const sections: { title: string; content: string }[] = [];

    // Split by markdown headers
    const headerSplit = content.split(/(?=^#{1,3}\s+)/m);
    let currentSection = '';
    let currentTitle = 'Section';

    for (const part of headerSplit) {
      const headerMatch = part.match(/^(#{1,3})\s+(.+)/);
      if (headerMatch && currentSection.length > 0) {
        if (currentSection.length >= sectionSize || sections.length === 0) {
          sections.push({ title: currentTitle, content: currentSection });
          currentSection = part;
          currentTitle = headerMatch[2].trim();
        } else {
          currentSection += '\n' + part;
        }
      } else {
        currentSection += (currentSection ? '\n' : '') + part;
        if (headerMatch) currentTitle = headerMatch[2].trim();
      }
    }
    if (currentSection.length > 0) {
      sections.push({ title: currentTitle, content: currentSection });
    }

    // If sections are still too large, split by size
    const finalSections: { title: string; content: string }[] = [];
    for (const sec of sections) {
      if (sec.content.length <= sectionSize) {
        finalSections.push(sec);
      } else {
        for (let i = 0; i < sec.content.length; i += sectionSize) {
          finalSections.push({
            title: `${sec.title} (part ${Math.floor(i / sectionSize) + 1})`,
            content: sec.content.slice(i, i + sectionSize)
          });
        }
      }
    }

    console.log(`[OptimizedRAG] buildSectionIndex: ${name} split into ${finalSections.length} sections`);

    // Index sections with bounded concurrency to avoid Azure 429 (TPM) spikes
    const maxParallel = Math.max(1, Number(config.PAGEINDEX_MAX_PARALLEL_SECTIONS || 4));
    const sectionIndices: string[] = new Array(finalSections.length);
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const idx = nextIndex;
        nextIndex += 1;
        if (idx >= finalSections.length) return;
        const sec = finalSections[idx];
        sectionIndices[idx] = await this.synthesizer.generateSectionIndex(
          name,
          sec.title,
          sec.content
        );
      }
    };

    await Promise.all(Array.from({ length: Math.min(maxParallel, finalSections.length) }, () => worker()));

    return sectionIndices.join('\n\n');
  }

  /**
   * Get cache statistics for a project
   */
  async getCacheStats(projectId: string): Promise<{
    totalGuidelines: number;
    cachedGuidelines: number;
    totalChunks: number;
    cacheHitRate: number;
  }> {
    try {
      const stats = await this.vectorCache.getCacheStats(projectId);
      const totalGuidelines = Number((stats as any)?.totalGuidelines ?? 0) || 0;
      const cachedGuidelines = Number((stats as any)?.vectorizedCount ?? 0) || 0;
      const totalChunks = Number((stats as any)?.totalChunks ?? 0) || 0;
      const cacheHitRate = totalGuidelines > 0 ? cachedGuidelines / totalGuidelines : 0;
      return { totalGuidelines, cachedGuidelines, totalChunks, cacheHitRate };
    } catch (error) {
      console.error('[OptimizedRAG] Failed to get cache stats:', error);
      return {
        totalGuidelines: 0,
        cachedGuidelines: 0,
        totalChunks: 0,
        cacheHitRate: 0
      };
    }
  }

  /**
   * Clear project cache
   */
  async clearProjectCache(projectId: string): Promise<void> {
    try {
      await this.vectorCache.clearProjectCache(projectId);
      console.log(`[OptimizedRAG] Cleared cache for project: ${projectId}`);
    } catch (error) {
      console.error('[OptimizedRAG] Failed to clear project cache:', error);
      throw error;
    }
  }
}