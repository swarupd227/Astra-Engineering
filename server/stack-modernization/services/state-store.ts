/**
 * Stack Modernization - State Store Service
 * In-memory state storage with optional DB + Git persistence.
 */

import type { StackModernizationState, SelectablePhase } from "../types";
import { computeProgressFromSelectedPhases } from "../utils/progress-from-phases";
import {
  persistAnalysis,
  persistPhaseOutput,
  loadAnalysisFromDb,
  buildStackSummary,
} from "./db-persistence";
import { DEFAULT_MODEL_ID } from "../../llm-config-constants";
import {
  resolveGitStorageForAnalysis,
  pushModifiedFilesToGit,
  pushTestFilesToGit,
  pushReportsToGit,
  pushExtractedFilesToGit,
  loadFilesFromGit,
} from "./git-file-persistence";

class StateStore {
  private states: Map<string, StackModernizationState> = new Map();

  save(state: StackModernizationState): void {
    this.states.set(state.analysisId, state);
  }

  get(analysisId: string): StackModernizationState | undefined {
    return this.states.get(analysisId);
  }

  getBySessionId(sessionId: string): StackModernizationState | undefined {
    for (const state of this.states.values()) {
      if (state.sessionId === sessionId) {
        return state;
      }
    }
    return undefined;
  }

  update(analysisId: string, updates: Partial<StackModernizationState>): void {
    const existing = this.states.get(analysisId);
    if (existing) {
      const updated = { ...existing, ...updates };
      this.states.set(analysisId, updated);
    }
  }

  delete(analysisId: string): void {
    this.states.delete(analysisId);
  }

  getAll(): StackModernizationState[] {
    return Array.from(this.states.values());
  }

  clear(): void {
    this.states.clear();
  }

  // ───── DB Persistence ─────

  async saveToDb(analysisId: string): Promise<void> {
    const state = this.states.get(analysisId);
    if (!state) return;
    const stackSummary = state.userSelections?.length
      ? buildStackSummary(state.userSelections)
      : state.repoProfile
        ? `${state.repoProfile.projectType} project`
        : undefined;

    const progress = computeProgressFromSelectedPhases(state);
    try {
      await persistAnalysis({
        id: state.analysisId,
        sessionId: state.sessionId,
        userId: state.userId,
        tenantId: state.tenantId,
        adoOrg: state.adoOrg,
        adoProjectId: state.adoProjectId,
        adoProjectName: state.adoProjectName,
        modernizationType: state.modernizationType,
        llmProvider: state.llmProvider,
        status: state.status,
        currentStage: state.currentStage,
        progress,
        selectedPhases: state.selectedPhases,
        repoName: state.repoName,
        stackSummary,
        gitBranch: state.gitBranch,
        gitFileCount: state.gitFileCount,
        errors: state.errors?.length ? state.errors : undefined,
        completedAt: state.completedAt,
      });
      (state as any).lastPersistedAt = new Date().toISOString();
    } catch (err) {
      console.warn(`[StateStore] DB persistence failed for ${analysisId}:`, err instanceof Error ? err.message : err);
    }
  }

  /**
   * Await-able checkpoint persistence for critical phase completions.
   * Unlike fire-and-forget saveToDb().catch(), this awaits and throws on failure.
   */
  async saveCheckpoint(analysisId: string): Promise<void> {
    await this.saveToDb(analysisId);
    const state = this.states.get(analysisId);
    if (state) {
      console.log(`[StateStore] Checkpoint persisted for ${analysisId} at ${(state as any).lastPersistedAt}`);
    }
  }

  async savePhaseToDb(
    analysisId: string,
    phase: string,
    status: string,
    metadata?: Record<string, any>,
    reportMarkdown?: string,
  ): Promise<void> {
    const state = this.states.get(analysisId);
    const activityLog = state?.activityLog?.filter(
      (l) => l.agent.toLowerCase().includes(phase) || l.action.toLowerCase().includes(phase),
    );
    await persistPhaseOutput({
      analysisId,
      phase,
      status,
      metadata,
      reportMarkdown,
      activityLog: activityLog?.length ? activityLog : undefined,
    });
  }

  // ───── Git Persistence ─────

  async saveModifiedFilesToGit(
    analysisId: string,
    adoConfig: { organization: string; project: string; pat: string; repositoryId?: string; repositoryName?: string },
  ): Promise<void> {
    const state = this.states.get(analysisId);
    if (!state?.modifiedFiles?.length || !state.adoOrg || !state.adoProjectName) return;

    const { storage, branch } = await resolveGitStorageForAnalysis(
      state.adoOrg,
      state.adoProjectName,
      analysisId,
      adoConfig,
    );
    const count = await pushModifiedFilesToGit(
      storage,
      state.modifiedFiles,
      `[DevX] Code upgrade – ${state.modifiedFiles.length} files`,
    );
    state.gitBranch = branch;
    state.gitFileCount = (state.gitFileCount ?? 0) + count;
    this.save(state);
    this.saveToDb(analysisId).catch(() => {});
  }

  async saveTestFilesToGit(
    analysisId: string,
    adoConfig: { organization: string; project: string; pat: string; repositoryId?: string; repositoryName?: string },
  ): Promise<void> {
    const state = this.states.get(analysisId);
    if (!state?.generatedTests?.length || !state.adoOrg || !state.adoProjectName) return;

    const { storage, branch } = await resolveGitStorageForAnalysis(
      state.adoOrg,
      state.adoProjectName,
      analysisId,
      adoConfig,
    );
    const count = await pushTestFilesToGit(
      storage,
      state.generatedTests,
      `[DevX] Generated tests – ${state.generatedTests.length} files`,
    );
    state.gitBranch = branch;
    state.gitFileCount = (state.gitFileCount ?? 0) + count;
    this.save(state);
    this.saveToDb(analysisId).catch(() => {});
  }

  async saveReportsToGit(
    analysisId: string,
    adoConfig: { organization: string; project: string; pat: string; repositoryId?: string; repositoryName?: string },
  ): Promise<void> {
    const state = this.states.get(analysisId);
    if (!state?.adoOrg || !state.adoProjectName) return;

    const reports: Record<string, string> = {};
    if (state.assessmentMarkdown) reports["assessment.md"] = state.assessmentMarkdown;
    if (state.planMarkdown) reports["plan.md"] = state.planMarkdown;
    if (state.tasksMarkdown) reports["tasks.md"] = state.tasksMarkdown;
    if (state.testResultsMarkdown) reports["test-results.md"] = state.testResultsMarkdown;
    if (state.confidenceReportMarkdown) reports["confidence-report.md"] = state.confidenceReportMarkdown;
    if (state.migrationReportMarkdown) reports["migration-report.md"] = state.migrationReportMarkdown;
    if (state.vendorUpdateReportMarkdown) reports["vendor-update-report.md"] = state.vendorUpdateReportMarkdown;
    if (state.completenessReportMarkdown) reports["completeness-report.md"] = state.completenessReportMarkdown;
    if (state.apiUsageImpactMarkdown) reports["api-impact-report.md"] = state.apiUsageImpactMarkdown;
    if (state.structuralChangesMarkdown) reports["structural-changes-report.md"] = state.structuralChangesMarkdown;

    if (Object.keys(reports).length === 0) return;

    const { storage, branch } = await resolveGitStorageForAnalysis(
      state.adoOrg,
      state.adoProjectName,
      analysisId,
      adoConfig,
    );
    const count = await pushReportsToGit(
      storage,
      reports,
      `[DevX] Reports – ${Object.keys(reports).length} files`,
    );
    state.gitBranch = branch;
    state.gitFileCount = (state.gitFileCount ?? 0) + count;
    this.save(state);
    this.saveToDb(analysisId).catch(() => {});
  }

  async saveExtractedFilesToGit(
    analysisId: string,
    adoConfig: { organization: string; project: string; pat: string; repositoryId?: string; repositoryName?: string },
  ): Promise<number> {
    const state = this.states.get(analysisId);
    if (!state?.extractedFiles?.length || !state.adoOrg || !state.adoProjectName) return 0;

    const { storage, branch } = await resolveGitStorageForAnalysis(
      state.adoOrg,
      state.adoProjectName,
      analysisId,
      adoConfig,
    );
    const filesToPush = state.extractedFiles.map(f => ({
      relativePath: f.relativePath,
      content: f.content,
    }));
    const count = await pushExtractedFilesToGit(
      storage,
      filesToPush,
      `[DevX] Source files – ${filesToPush.length} files`,
    );
    state.gitBranch = branch;
    state.gitFileCount = (state.gitFileCount ?? 0) + count;
    this.save(state);
    this.saveToDb(analysisId).catch(() => {});
    return count;
  }

  // ───── Load from DB + Git ─────

  async loadFromDb(analysisId: string): Promise<StackModernizationState | null> {
    const record = await loadAnalysisFromDb(analysisId);
    if (!record) return null;

    const { analysis, phases } = record;

    const state: StackModernizationState = {
      analysisId: analysis.id,
      sessionId: analysis.sessionId ?? "",
      userId: analysis.userId ?? "",
      tenantId: analysis.tenantId ?? "",
      modernizationType: (analysis.modernizationType as any) ?? "upgrade",
      llmProvider: (analysis.llmProvider as any) ?? DEFAULT_MODEL_ID,
      adoOrg: analysis.adoOrg ?? undefined,
      adoProjectId: analysis.adoProjectId ?? undefined,
      adoProjectName: analysis.adoProjectName ?? undefined,
      repoName: analysis.repoName ?? undefined,
      gitBranch: analysis.gitBranch ?? undefined,
      gitFileCount: analysis.gitFileCount ?? 0,
      selectedPhases: (analysis.selectedPhases as SelectablePhase[] | null) ?? undefined,
      status: (analysis.status as any) ?? "initiated",
      currentStage: analysis.currentStage ?? "",
      progress: analysis.progress ?? 0,
      errors: (analysis.errors as string[] | null) ?? [],
      uploadedFiles: [],
      extractedFiles: [],
      tempDir: "",
      activityLog: [],
      startedAt: analysis.createdAt ?? new Date(),
      completedAt: analysis.completedAt ?? undefined,
    };

    for (const phase of phases) {
      // Phase name: support both camelCase (Drizzle) and snake_case (raw driver)
      const phaseName = phase.phase ?? (phase as any).phase;
      if (!phaseName) continue;

      // MySQL/driver may return JSON columns as strings; parse so meta is always an object or null
      const metaRaw = phase.metadata ?? (phase as any).metadata;
      let meta: Record<string, any> | null = null;
      if (metaRaw != null) {
        try {
          meta = typeof metaRaw === "string" ? JSON.parse(metaRaw as string) : (metaRaw as Record<string, any>);
        } catch {
          meta = null;
        }
      }
      const mdRaw = phase.reportMarkdown ?? (phase as any).report_markdown;
      let md: string | null = null;
      if (mdRaw != null) {
        md = typeof mdRaw === "string" ? mdRaw : String(mdRaw);
      }

      switch (String(phaseName)) {
        case "assessment":
          if (meta?.repoProfile) state.repoProfile = meta.repoProfile;
          if (meta?.dependencyGraph) state.dependencyGraph = meta.dependencyGraph;
          if (meta?.versionIntelligence) state.versionIntelligence = meta.versionIntelligence;
          if (meta?.securityAssessment) state.securityAssessment = meta.securityAssessment;
          if (meta?.codeQuality) state.codeQuality = meta.codeQuality;
          if (meta?.breakingChangesPreview) state.breakingChangesPreview = meta.breakingChangesPreview;
          if (meta?.databaseDependencies) state.databaseDependencies = meta.databaseDependencies;
          if (meta?.requirementsAnalysis) state.requirementsAnalysis = meta.requirementsAnalysis;
          if (meta?.assessmentSubAgentStatus) state.assessmentSubAgentStatus = meta.assessmentSubAgentStatus;
          if (meta?.astAnalysis) state.astAnalysis = meta.astAnalysis;
          if (meta?.repoMap) (state as any).repoMap = meta.repoMap;
          if (meta?.extractedFiles?.length) state.extractedFiles = meta.extractedFiles;
          if (meta?.versionRecommendationsText) state.versionRecommendationsText = meta.versionRecommendationsText;
          if (md) state.assessmentMarkdown = md;
          break;

        case "planning":
          if (meta?.userSelections) state.userSelections = meta.userSelections;
          if (meta?.compatibilityCheck) state.compatibilityCheck = meta.compatibilityCheck;
          if (meta?.riskReport) state.riskReport = meta.riskReport;
          if (meta?.planningVisualizationData) state.planningVisualizationData = meta.planningVisualizationData;
          if (meta?.versionRecommendationsText) state.versionRecommendationsText = meta.versionRecommendationsText;
          if (md) state.planMarkdown = md;
          break;

        case "task_generation":
          if (meta?.upgradeTasks) state.upgradeTasks = meta.upgradeTasks;
          if (md) state.tasksMarkdown = md;
          break;

        case "packages":
          if (meta?.vendorDownloadResults) state.vendorDownloadResults = meta.vendorDownloadResults;
          break;

        case "code_upgrade":
          if (meta?.taskExecutionResults) state.taskExecutionResults = meta.taskExecutionResults;
          if (meta?.modifiedFiles?.length) state.modifiedFiles = meta.modifiedFiles;
          if (md) state.migrationReportMarkdown = md;
          if (meta?.codeUpgradeSummary) {
            state.codeUpgrade = {
              modifiedFiles: state.modifiedFiles ?? [],
              summary: meta.codeUpgradeSummary,
              errors: meta.codeUpgradeErrors ?? [],
            };
          }
          if (meta?.impactReport) state.impactReport = meta.impactReport;
          if (meta?.changeSummaries) state.changeSummaries = meta.changeSummaries;
          if (meta?.migrationAllowedRenames) state.migrationAllowedRenames = meta.migrationAllowedRenames;
          // GAP fields
          if (meta?.apiUsageImpactReport) state.apiUsageImpactReport = meta.apiUsageImpactReport;
          if (meta?.removedObsoletePackages) state.removedObsoletePackages = meta.removedObsoletePackages;
          if (meta?.bundleDetections) state.bundleDetections = meta.bundleDetections;
          if (meta?.discoveredBundledLibraries) state.discoveredBundledLibraries = meta.discoveredBundledLibraries;
          if (meta?.newLibrariesAdded) state.newLibrariesAdded = meta.newLibrariesAdded;
          // Structural scaffold data
          if (meta?.scaffoldResult) state.scaffoldResult = meta.scaffoldResult;
          if (meta?.structuralChangesMarkdown) state.structuralChangesMarkdown = meta.structuralChangesMarkdown;
          break;

        case "completeness_verification":
          if (meta?.completenessReport) state.completenessReport = meta.completenessReport;
          if (md) state.completenessReportMarkdown = md;
          break;

        case "test_generation":
          if (meta?.generatedTests) state.generatedTests = meta.generatedTests;
          if (md) {
            const parts = md.split("---CONFIDENCE---");
            state.testResultsMarkdown = parts[0]?.trim();
            if (parts[1]) state.confidenceReportMarkdown = parts[1].trim();
          }
          break;

        case "validation":
          if (meta?.validationRun) state.validationRun = meta.validationRun;
          if (meta?.validationPassed != null) state.validationPassed = meta.validationPassed;
          if (meta?.validationAttempts != null) state.validationAttempts = meta.validationAttempts;
          break;
      }
    }

    this.states.set(analysisId, state);
    return state;
  }

  async loadFilesFromGitToState(
    analysisId: string,
    adoConfig: { organization: string; project: string; pat: string; repositoryId?: string; repositoryName?: string },
  ): Promise<void> {
    const state = this.states.get(analysisId);
    if (!state?.adoOrg || !state.adoProjectName) return;

    const { storage } = await resolveGitStorageForAnalysis(
      state.adoOrg,
      state.adoProjectName,
      analysisId,
      adoConfig,
    );

    const gitData = await loadFilesFromGit(storage);

    if (gitData.extractedFiles.length && (!state.extractedFiles || state.extractedFiles.length === 0)) {
      state.extractedFiles = gitData.extractedFiles.map(f => ({
        relativePath: f.relativePath,
        fullPath: f.relativePath,
        content: f.content,
        size: f.content.length,
        extension: f.relativePath.includes(".") ? f.relativePath.split(".").pop()! : "",
        fileType: "unknown" as any,
      }));
    }
    if (gitData.modifiedFiles.length) {
      state.modifiedFiles = gitData.modifiedFiles;
    }
    if (gitData.generatedTests.length) {
      state.generatedTests = gitData.generatedTests;
    }
    if (gitData.reports["assessment.md"] && !state.assessmentMarkdown) {
      state.assessmentMarkdown = gitData.reports["assessment.md"];
    }
    if (gitData.reports["plan.md"] && !state.planMarkdown) {
      state.planMarkdown = gitData.reports["plan.md"];
    }
    if (gitData.reports["tasks.md"] && !state.tasksMarkdown) {
      state.tasksMarkdown = gitData.reports["tasks.md"];
    }
    if (gitData.reports["test-results.md"] && !state.testResultsMarkdown) {
      state.testResultsMarkdown = gitData.reports["test-results.md"];
    }
    if (gitData.reports["confidence-report.md"] && !state.confidenceReportMarkdown) {
      state.confidenceReportMarkdown = gitData.reports["confidence-report.md"];
    }
    if (gitData.reports["migration-report.md"] && !state.migrationReportMarkdown) {
      state.migrationReportMarkdown = gitData.reports["migration-report.md"];
    }
    if (gitData.reports["completeness-report.md"] && !state.completenessReportMarkdown) {
      state.completenessReportMarkdown = gitData.reports["completeness-report.md"];
    }
    if (gitData.reports["api-impact-report.md"] && !state.apiUsageImpactMarkdown) {
      state.apiUsageImpactMarkdown = gitData.reports["api-impact-report.md"];
    }
    if (gitData.reports["structural-changes-report.md"] && !state.structuralChangesMarkdown) {
      state.structuralChangesMarkdown = gitData.reports["structural-changes-report.md"];
    }

    this.save(state);
  }

  /**
   * Try to recover an in-progress analysis from the database on server restart.
   * Returns the state if recovery was successful, null if analysis not found or already completed.
   */
  async tryRecoverInProgress(analysisId: string): Promise<StackModernizationState | null> {
    if (this.states.has(analysisId)) {
      return this.states.get(analysisId) ?? null;
    }

    try {
      const state = await this.loadFromDb(analysisId);
      if (!state) return null;

      if (state.status === "completed" || state.status === "failed") {
        console.log(`[StateStore] Analysis ${analysisId} already ${state.status}, no recovery needed`);
        return null;
      }

      console.log(`[StateStore] Recovered in-progress analysis ${analysisId} (stage: ${state.currentStage}, progress: ${state.progress}%)`);
      return state;
    } catch (err) {
      console.warn(`[StateStore] Failed to recover analysis ${analysisId}:`, err instanceof Error ? err.message : err);
      return null;
    }
  }
}

export const stateStore = new StateStore();
