import { v4 as uuidv4 } from "uuid";
import { db, poolConnection } from "../../db";
import { modernizationAnalyses, modernizationPhaseOutputs, modernizationTokenUsage, modernizationVersionChanges } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import type { TokenUsageSummary } from "../types";

export async function ensureTablesExist(): Promise<void> {
  try {
    await poolConnection.query(`
      CREATE TABLE IF NOT EXISTS modernization_analyses (
        id CHAR(36) PRIMARY KEY,
        session_id VARCHAR(36),
        user_id VARCHAR(36),
        tenant_id VARCHAR(36),
        ado_org VARCHAR(255),
        ado_project_id VARCHAR(255),
        ado_project_name VARCHAR(255),
        modernization_type VARCHAR(50) NOT NULL DEFAULT 'tech_upgrade',
        llm_provider VARCHAR(50),
        status VARCHAR(50) NOT NULL DEFAULT 'initiated',
        current_stage VARCHAR(100),
        progress INT NOT NULL DEFAULT 0,
        selected_phases JSON,
        repo_name VARCHAR(255),
        stack_summary VARCHAR(500),
        git_branch VARCHAR(255),
        git_file_count INT DEFAULT 0,
        errors JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        completed_at TIMESTAMP NULL
      )
    `);
    await poolConnection.query(`
      CREATE TABLE IF NOT EXISTS modernization_phase_outputs (
        id CHAR(36) PRIMARY KEY,
        analysis_id CHAR(36) NOT NULL,
        phase VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        metadata JSON,
        report_markdown LONGTEXT,
        activity_log JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await poolConnection.query(`
      CREATE TABLE IF NOT EXISTS modernization_token_usage (
        id CHAR(36) PRIMARY KEY,
        analysis_id CHAR(36) NOT NULL,
        phase VARCHAR(50) NOT NULL,
        agent VARCHAR(100),
        model VARCHAR(50),
        input_tokens INT NOT NULL DEFAULT 0,
        output_tokens INT NOT NULL DEFAULT 0,
        total_tokens INT NOT NULL DEFAULT 0,
        estimated_cost DECIMAL(10, 6) NOT NULL DEFAULT 0,
        duration_ms INT NOT NULL DEFAULT 0,
        llm_calls INT NOT NULL DEFAULT 1,
        codebase_file_count INT DEFAULT 0,
        codebase_total_lines INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_token_analysis (analysis_id),
        INDEX idx_token_phase (analysis_id, phase)
      )
    `);
    await poolConnection.query(`
      CREATE TABLE IF NOT EXISTS modernization_version_changes (
        id CHAR(36) PRIMARY KEY,
        analysis_id CHAR(36) NOT NULL,
        phase_reset VARCHAR(50) NOT NULL,
        previous_selections JSON,
        new_selections JSON,
        previous_plan_summary TEXT,
        downstream_phases_cleared JSON,
        changed_by VARCHAR(36),
        change_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_verchange_analysis (analysis_id)
      )
    `);
    // Add columns that may be missing from older table versions
    const safeAlter = async (sql: string) => {
      try { await poolConnection.query(sql); } catch (e: any) {
        if (e?.code !== "ER_DUP_FIELDNAME" && e?.errno !== 1060) console.warn("[db-persistence] alter:", e?.message);
      }
    };
    await safeAlter("ALTER TABLE modernization_analyses ADD COLUMN repo_name VARCHAR(255) AFTER selected_phases");

    // Indexes — swallow duplicate-key errors
    const safeIndex = async (sql: string) => {
      try { await poolConnection.query(sql); } catch (e: any) {
        if (e?.code !== "ER_DUP_KEYNAME" && e?.errno !== 1061) console.warn("[db-persistence] index:", e?.message);
      }
    };
    await safeIndex("CREATE INDEX idx_mod_analyses_project ON modernization_analyses(ado_org, ado_project_id)");
    await safeIndex("CREATE INDEX idx_mod_analyses_user ON modernization_analyses(user_id)");
    await safeIndex("CREATE INDEX idx_mod_phase_analysis ON modernization_phase_outputs(analysis_id)");
    await safeIndex("CREATE UNIQUE INDEX uq_mod_phase_per_analysis ON modernization_phase_outputs(analysis_id, phase)");
    console.log("✓ modernization persistence tables ready");
  } catch (err: any) {
    console.warn(
      "[db-persistence] Failed to create modernization tables:",
      err?.message || err,
    );
  }
}

export function buildStackSummary(
  userSelections: Array<{
    package: string;
    selectedVersion: string;
    currentVersion: string;
  }>,
): string {
  const changed = userSelections
    .filter((s) => s.selectedVersion !== s.currentVersion)
    .map((s) => `${s.package} ${s.currentVersion} -> ${s.selectedVersion}`);

  const summary = changed.join(", ");
  return summary.length > 500 ? summary.slice(0, 497) + "..." : summary;
}

export async function persistAnalysis(data: {
  id: string;
  sessionId: string;
  userId?: string;
  tenantId?: string;
  adoOrg?: string;
  adoProjectId?: string;
  adoProjectName?: string;
  modernizationType?: string;
  llmProvider?: string;
  status: string;
  currentStage?: string;
  progress: number;
  selectedPhases?: string[];
  repoName?: string;
  stackSummary?: string;
  gitBranch?: string;
  gitFileCount?: number;
  errors?: string[];
  completedAt?: Date;
}): Promise<void> {
  try {
    const sql = `
      INSERT INTO modernization_analyses
        (id, session_id, user_id, tenant_id, ado_org, ado_project_id, ado_project_name,
         modernization_type, llm_provider, status, current_stage, progress,
         selected_phases, repo_name, stack_summary, git_branch, git_file_count, errors,
         created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        current_stage = VALUES(current_stage),
        progress = VALUES(progress),
        selected_phases = VALUES(selected_phases),
        repo_name = COALESCE(VALUES(repo_name), repo_name),
        stack_summary = VALUES(stack_summary),
        git_branch = VALUES(git_branch),
        git_file_count = VALUES(git_file_count),
        errors = VALUES(errors),
        updated_at = NOW(),
        completed_at = VALUES(completed_at)
    `;

    const params = [
      data.id,
      data.sessionId,
      data.userId ?? null,
      data.tenantId ?? null,
      data.adoOrg ?? null,
      data.adoProjectId ?? null,
      data.adoProjectName ?? null,
      data.modernizationType ?? "tech_upgrade",
      data.llmProvider ?? null,
      data.status,
      data.currentStage ?? null,
      data.progress,
      data.selectedPhases ? JSON.stringify(data.selectedPhases) : null,
      data.repoName ?? null,
      data.stackSummary ?? null,
      data.gitBranch ?? null,
      data.gitFileCount ?? 0,
      data.errors ? JSON.stringify(data.errors) : null,
      data.completedAt ?? null,
    ];

    await poolConnection.query(sql, params);
  } catch (err: any) {
    console.warn(
      "[db-persistence] persistAnalysis failed:",
      err?.message || err,
    );
  }
}

export async function persistPhaseOutput(data: {
  analysisId: string;
  phase: string;
  status: string;
  metadata?: Record<string, any>;
  reportMarkdown?: string;
  activityLog?: any[];
}): Promise<void> {
  try {
    const id = uuidv4();

    const sql = `
      INSERT INTO modernization_phase_outputs
        (id, analysis_id, phase, status, metadata, report_markdown, activity_log,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        metadata = VALUES(metadata),
        report_markdown = VALUES(report_markdown),
        activity_log = VALUES(activity_log),
        updated_at = NOW()
    `;

    const params = [
      id,
      data.analysisId,
      data.phase,
      data.status,
      data.metadata ? JSON.stringify(data.metadata) : null,
      data.reportMarkdown ?? null,
      data.activityLog ? JSON.stringify(data.activityLog) : null,
    ];

    await poolConnection.query(sql, params);
  } catch (err: any) {
    console.warn(
      "[db-persistence] persistPhaseOutput failed:",
      err?.message || err,
    );
  }
}

export async function loadAnalysisFromDb(
  analysisId: string,
): Promise<{ analysis: any; phases: any[] } | null> {
  try {
    const [analysis] = await db
      .select()
      .from(modernizationAnalyses)
      .where(eq(modernizationAnalyses.id, analysisId))
      .limit(1);

    if (!analysis) return null;

    const phases = await db
      .select()
      .from(modernizationPhaseOutputs)
      .where(eq(modernizationPhaseOutputs.analysisId, analysisId));

    return { analysis, phases };
  } catch (err: any) {
    console.warn(
      "[db-persistence] loadAnalysisFromDb failed:",
      err?.message || err,
    );
    return null;
  }
}

export async function listAnalyses(
  adoOrg: string,
  adoProjectId: string,
): Promise<any[]> {
  try {
    return await db
      .select()
      .from(modernizationAnalyses)
      .where(
        and(
          eq(modernizationAnalyses.adoOrg, adoOrg),
          eq(modernizationAnalyses.adoProjectId, adoProjectId),
        ),
      )
      .orderBy(desc(modernizationAnalyses.updatedAt));
  } catch (err: any) {
    console.warn(
      "[db-persistence] listAnalyses failed:",
      err?.message || err,
    );
    return [];
  }
}

export async function deleteAnalysis(analysisId: string): Promise<void> {
  try {
    await db
      .delete(modernizationPhaseOutputs)
      .where(eq(modernizationPhaseOutputs.analysisId, analysisId));

    await db
      .delete(modernizationAnalyses)
      .where(eq(modernizationAnalyses.id, analysisId));
  } catch (err: any) {
    console.warn(
      "[db-persistence] deleteAnalysis failed:",
      err?.message || err,
    );
  }
}

export async function persistAnalysisAndPhase(
  analysisData: Parameters<typeof persistAnalysis>[0],
  phaseData: Parameters<typeof persistPhaseOutput>[0],
): Promise<void> {
  try {
    await Promise.all([
      persistAnalysis(analysisData),
      persistPhaseOutput(phaseData),
    ]);
  } catch (err: any) {
    console.warn(
      "[db-persistence] persistAnalysisAndPhase failed:",
      err?.message || err,
    );
  }
}

export async function persistTokenUsage(
  analysisId: string,
  usage: TokenUsageSummary,
  codebaseFileCount?: number,
  codebaseTotalLines?: number,
): Promise<void> {
  try {
    // First, delete any existing rows for this analysis so we always store the latest snapshot
    await db.delete(modernizationTokenUsage)
      .where(eq(modernizationTokenUsage.analysisId, analysisId));

    const rows = Object.values(usage.phases).map((pm) => ({
      id: uuidv4(),
      analysisId,
      phase: pm.phase,
      agent: null as string | null,
      model: null as string | null,
      inputTokens: pm.inputTokens,
      outputTokens: pm.outputTokens,
      totalTokens: pm.totalTokens,
      estimatedCost: String(pm.estimatedCost),
      durationMs: pm.durationMs,
      llmCalls: pm.llmCalls,
      codebaseFileCount: codebaseFileCount ?? 0,
      codebaseTotalLines: codebaseTotalLines ?? 0,
    }));

    rows.push({
      id: uuidv4(),
      analysisId,
      phase: "total",
      agent: null,
      model: null,
      inputTokens: usage.totalInputTokens,
      outputTokens: usage.totalOutputTokens,
      totalTokens: usage.totalTokens,
      estimatedCost: String(usage.totalEstimatedCost),
      durationMs: usage.totalDurationMs,
      llmCalls: usage.totalLLMCalls,
      codebaseFileCount: codebaseFileCount ?? 0,
      codebaseTotalLines: codebaseTotalLines ?? 0,
    });

    // Per-agent rows
    if (usage.agents) {
      for (const am of Object.values(usage.agents)) {
        rows.push({
          id: uuidv4(),
          analysisId,
          phase: am.phase,
          agent: am.agent,
          model: null,
          inputTokens: am.inputTokens,
          outputTokens: am.outputTokens,
          totalTokens: am.totalTokens,
          estimatedCost: String(am.estimatedCost),
          durationMs: am.durationMs,
          llmCalls: am.llmCalls,
          codebaseFileCount: 0,
          codebaseTotalLines: 0,
        });
      }
    }

    for (const row of rows) {
      await db.insert(modernizationTokenUsage).values(row);
    }
  } catch (err: any) {
    console.warn("[db-persistence] persistTokenUsage failed:", err?.message || err);
  }
}

/**
 * Load token usage metrics from the DB for a given analysisId.
 * Reconstructs the TokenUsageSummary from per-phase rows.
 */
export async function loadTokenUsage(analysisId: string): Promise<TokenUsageSummary | null> {
  try {
    const rows = await db
      .select()
      .from(modernizationTokenUsage)
      .where(eq(modernizationTokenUsage.analysisId, analysisId));

    if (!rows || rows.length === 0) return null;

    const phases: Record<string, import("../types").PhaseMetrics> = {};
    const agents: Record<string, import("../types").AgentMetrics> = {};
    let totalRow: typeof rows[0] | null = null;

    for (const row of rows) {
      if (row.phase === "total") {
        totalRow = row;
        continue;
      }
      // Per-agent row (has agent field set)
      if (row.agent) {
        const key = `${row.phase}/${row.agent}`;
        agents[key] = {
          agent: row.agent,
          phase: row.phase,
          llmCalls: row.llmCalls ?? 1,
          inputTokens: row.inputTokens ?? 0,
          outputTokens: row.outputTokens ?? 0,
          totalTokens: row.totalTokens ?? 0,
          durationMs: row.durationMs ?? 0,
          estimatedCost: parseFloat(String(row.estimatedCost ?? "0")),
        };
        continue;
      }
      // Per-phase row (no agent)
      phases[row.phase] = {
        phase: row.phase,
        durationMs: row.durationMs ?? 0,
        llmCalls: row.llmCalls ?? 1,
        inputTokens: row.inputTokens ?? 0,
        outputTokens: row.outputTokens ?? 0,
        totalTokens: row.totalTokens ?? 0,
        estimatedCost: parseFloat(String(row.estimatedCost ?? "0")),
      };
    }

    if (totalRow) {
      return {
        phases,
        agents,
        totalInputTokens: totalRow.inputTokens ?? 0,
        totalOutputTokens: totalRow.outputTokens ?? 0,
        totalTokens: totalRow.totalTokens ?? 0,
        totalLLMCalls: totalRow.llmCalls ?? 0,
        totalEstimatedCost: parseFloat(String(totalRow.estimatedCost ?? "0")),
        totalDurationMs: totalRow.durationMs ?? 0,
      };
    }

    const summary: TokenUsageSummary = {
      phases,
      agents,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalLLMCalls: 0,
      totalEstimatedCost: 0,
      totalDurationMs: 0,
    };
    for (const pm of Object.values(phases)) {
      summary.totalInputTokens += pm.inputTokens;
      summary.totalOutputTokens += pm.outputTokens;
      summary.totalTokens += pm.totalTokens;
      summary.totalLLMCalls += pm.llmCalls;
      summary.totalEstimatedCost += pm.estimatedCost;
      summary.totalDurationMs += pm.durationMs;
    }
    return summary;
  } catch (err: any) {
    console.warn("[db-persistence] loadTokenUsage failed:", err?.message || err);
    return null;
  }
}

/**
 * Load token usage history across all analyses for the registry view.
 * Returns the "total" row per analysis plus analysis metadata.
 */
export async function loadTokenUsageHistory(limit: number = 50): Promise<any[]> {
  try {
    const rows = await db
      .select({
        analysisId: modernizationTokenUsage.analysisId,
        phase: modernizationTokenUsage.phase,
        inputTokens: modernizationTokenUsage.inputTokens,
        outputTokens: modernizationTokenUsage.outputTokens,
        totalTokens: modernizationTokenUsage.totalTokens,
        estimatedCost: modernizationTokenUsage.estimatedCost,
        durationMs: modernizationTokenUsage.durationMs,
        llmCalls: modernizationTokenUsage.llmCalls,
        codebaseFileCount: modernizationTokenUsage.codebaseFileCount,
        codebaseTotalLines: modernizationTokenUsage.codebaseTotalLines,
        createdAt: modernizationTokenUsage.createdAt,
      })
      .from(modernizationTokenUsage)
      .where(eq(modernizationTokenUsage.phase, "total"))
      .orderBy(desc(modernizationTokenUsage.createdAt))
      .limit(limit);

    // Enrich with analysis metadata if available
    const results = [];
    for (const row of rows) {
      let analysisMeta: any = {};
      try {
        const [analysis] = await db
          .select({
            status: modernizationAnalyses.status,
            repoName: modernizationAnalyses.repoName,
            stackSummary: modernizationAnalyses.stackSummary,
            adoOrg: modernizationAnalyses.adoOrg,
            adoProjectName: modernizationAnalyses.adoProjectName,
            createdAt: modernizationAnalyses.createdAt,
            completedAt: modernizationAnalyses.completedAt,
          })
          .from(modernizationAnalyses)
          .where(eq(modernizationAnalyses.id, row.analysisId))
          .limit(1);
        if (analysis) analysisMeta = analysis;
      } catch {
        // analysis table may not have this record
      }

      results.push({
        analysisId: row.analysisId,
        totalTokens: row.totalTokens,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        estimatedCost: parseFloat(String(row.estimatedCost ?? "0")),
        durationMs: row.durationMs,
        llmCalls: row.llmCalls,
        codebaseFileCount: row.codebaseFileCount,
        codebaseTotalLines: row.codebaseTotalLines,
        createdAt: row.createdAt,
        status: analysisMeta.status,
        repoName: analysisMeta.repoName,
        stackSummary: analysisMeta.stackSummary,
        adoOrg: analysisMeta.adoOrg,
        adoProjectName: analysisMeta.adoProjectName,
        analysisCreatedAt: analysisMeta.createdAt,
        completedAt: analysisMeta.completedAt,
      });
    }

    return results;
  } catch (err: any) {
    console.warn("[db-persistence] loadTokenUsageHistory failed:", err?.message || err);
    return [];
  }
}

/**
 * Record a version-change audit entry when a user resets a phase.
 */
export async function recordVersionChange(opts: {
  analysisId: string;
  phaseReset: string;
  previousSelections?: Array<{ package: string; currentVersion: string; selectedVersion: string }>;
  newSelections?: Array<{ package: string; currentVersion: string; selectedVersion: string }>;
  previousPlanSummary?: string;
  downstreamPhasesCleared: string[];
  changedBy?: string;
  changeReason?: string;
}): Promise<void> {
  try {
    await db.insert(modernizationVersionChanges).values({
      id: uuidv4(),
      analysisId: opts.analysisId,
      phaseReset: opts.phaseReset,
      previousSelections: opts.previousSelections ?? null,
      newSelections: opts.newSelections ?? null,
      previousPlanSummary: opts.previousPlanSummary ?? null,
      downstreamPhasesCleared: opts.downstreamPhasesCleared,
      changedBy: opts.changedBy ?? null,
      changeReason: opts.changeReason ?? null,
    });
  } catch (err: any) {
    console.warn("[db-persistence] recordVersionChange failed:", err?.message || err);
  }
}

/**
 * Load version-change audit history for an analysis.
 */
export async function loadVersionChangeHistory(analysisId: string) {
  try {
    return await db
      .select()
      .from(modernizationVersionChanges)
      .where(eq(modernizationVersionChanges.analysisId, analysisId))
      .orderBy(desc(modernizationVersionChanges.createdAt));
  } catch (err: any) {
    console.warn("[db-persistence] loadVersionChangeHistory failed:", err?.message || err);
    return [];
  }
}
