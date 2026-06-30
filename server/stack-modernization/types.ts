/**
 * Stack Modernization - Type Definitions
 * Comprehensive types for upgrade analysis system
 */

import { GPT_MODEL_ID, CLAUDE_MODEL_ID } from "../llm-config-constants";

export type ModernizationType = "upgrade" | "modernization" | "replatform";

/**
 * Supported LLM providers
 * Values come from llm-config-constants.ts — do not hardcode here.
 */
export type LLMProvider = typeof GPT_MODEL_ID | typeof CLAUDE_MODEL_ID;

export type SelectablePhase = "assessment" | "planning" | "packages" | "tasks" | "execution" | "tests" | "validation";

export type FileType = 
  | "zip"
  | "javascript"
  | "typescript"
  | "python"
  | "java"
  | "csharp"
  | "go"
  | "ruby"
  | "php"
  | "json"
  | "xml"
  | "yaml"
  | "markdown"
  | "text"
  | "unknown";

export type ProjectType =
  | "nodejs"
  | "python"
  | "java-maven"
  | "java-gradle"
  | "dotnet"
  | "go"
  | "ruby"
  | "php"
  | "react"
  | "angular"
  | "vue"
  | "nextjs"
  | "unknown";

export interface UploadedFile {
  id: string;
  originalName: string;
  storedName: string;
  path: string;
  size: number;
  mimeType: string;
  extension: string;
  fileType: FileType;
  uploadedAt: Date;
}

export interface ExtractedFile {
  relativePath: string;
  fullPath: string;
  content: string;
  size: number;
  extension: string;
  fileType: FileType;
}

export interface PackageManifest {
  type: "package.json" | "requirements.txt" | "pom.xml" | "build.gradle" | "go.mod" | "Gemfile" | "composer.json" | "Cargo.toml" | "csproj" | "libman.json" | "bower.json";
  path: string;
  content: string;
  raw?: string;
  parsed: any; // Parsed JSON/object
}

export interface RuntimeInfo {
  language: string;
  version?: string;
  source: string; // Where we detected it from
}

export interface FrameworkInfo {
  name: string;
  version?: string;
  type: "web" | "api" | "orm" | "testing" | "build" | "other";
}

export interface CIConfig {
  platform: "github-actions" | "gitlab-ci" | "jenkins" | "azure-devops" | "circleci" | "travis" | "unknown";
  config: any;
  path: string;
}

export interface DockerInfo {
  baseImage?: string;
  nodeVersion?: string;
  pythonVersion?: string;
  javaVersion?: string;
  hasDockerfile: boolean;
  hasDockerCompose: boolean;
}

export interface ModifiedFile {
  path: string;
  content: string;
  originalContent?: string;
  changes?: Array<{ package: string; oldVersion: string; newVersion: string }>;
  /** True when this file was created by the upgrade (not present in the original repo). */
  isNew?: boolean;
}

/** A library reference found via CDN <script>/<link> tags in HTML/Razor files. */
export interface CdnReference {
  /** Relative file path where the CDN reference was found */
  file: string;
  /** Line number (1-based) */
  line: number;
  /** Full URL from the src/href attribute */
  url: string;
  /** Human-readable library name (e.g. "jQuery Validate") */
  library: string;
  /** npm package name (e.g. "jquery-validation") */
  npmPackage: string;
  /** Detected version from the URL, or null */
  version: string | null;
  /** Whether this was a <script> or <link> tag */
  tagType: "script" | "link";
}

/** A library inferred from CSS class patterns (e.g. Font Awesome from `fa fa-*` classes). */
export interface InferredLibrary {
  /** Human-readable library name */
  library: string;
  /** npm package name */
  npmPackage: string;
  /** Detection confidence */
  confidence: "high" | "medium" | "low";
  /** CSS class patterns or code patterns that triggered detection */
  evidence: string[];
  /** Files where the patterns were found */
  detectedIn: string[];
}

export interface VendorLibrary {
  name: string;
  detectedVersion: string | null;
  vendorBasePath: string;
  existingFiles: string[];
  detectionMethod: "manifest" | "directory" | "version-comment" | "inferred";
}

export interface DownloadedVendorFile {
  projectPath: string;
  content: string;
  originalContent: string;
  library: string;
  oldVersion: string | null;
  newVersion: string;
  /** The CDN file path used to download (e.g., "dist/css/bootstrap-datepicker.min.css") */
  cdnPath?: string;
}

// ===== Agent Outputs =====

export interface RepoProfileResult {
  projectType: ProjectType;
  languages: string[];
  runtimeInfo: RuntimeInfo[];
  frameworks: FrameworkInfo[];
  packageManifests: PackageManifest[];
  ciConfig?: CIConfig;
  dockerInfo?: DockerInfo;
  fileStructure: {
    totalFiles: number;
    codeFiles: number;
    configFiles: number;
    testFiles: number;
  };
  detectedPatterns: {
    isMonorepo: boolean;
    hasTests: boolean;
    hasDocker: boolean;
    hasCI: boolean;
    hasLinting: boolean;
  };
  detectedRuntimes?: Array<{
    name: string;
    type: 'language' | 'runtime' | 'framework' | 'library';
    currentVersion: string | null;
    detectionMethod: string;
    confidence: 'high' | 'medium' | 'low';
    source: string;
  }>;
}

export interface DependencyNode {
  name: string;
  version: string;
  isDirect: boolean;
  isDevDependency: boolean;
  dependencies?: DependencyNode[];
}

export interface DependencyGraphResult {
  directDependencies: DependencyNode[];
  transitiveDependencies: DependencyNode[];
  peerConflicts: Array<{
    package: string;
    required: string;
    actual: string;
    conflictingWith: string;
  }>;
  duplicateVersions: Array<{
    package: string;
    versions: string[];
  }>;
  totalPackages: number;
  depthAnalysis: {
    maxDepth: number;
    averageDepth: number;
  };
}

export interface VersionRecommendation {
  package: string;
  currentVersion: string;
  latestStable: string;
  latestLTS?: string;
  recommended: string;
  reasoning: string;
  riskLevel: "low" | "medium" | "high";
  allVersions?: string[]; // NEW: All available versions from registry
  registry?: string; // NEW: Which registry (npm, pypi, maven)
  category?: "runtime" | "framework" | "library"; // Package category
}

// NEW: User's version selections
export interface VersionSelection {
  package: string;
  selectedVersion: string;
  currentVersion: string;
  category: "runtime" | "framework" | "library";
}

// NEW: Compatibility check result
export interface CompatibilityCheckResult {
  compatible: boolean;
  confidence: number; // 0-100 (realistic assessment)
  conflicts: DependencyConflict[];
  warnings: CompatibilityWarning[];
  requiredChanges: RequiredChange[];
  riskAssessment: RiskAssessment;
  recommendation: "proceed" | "proceed_with_caution" | "review_required" | "do_not_proceed";
}

export interface DependencyConflict {
  package: string;
  selectedVersion: string;
  conflictsWith: {
    package: string;
    requiredVersion: string;
    constraint: string;
  };
  severity: "error" | "warning";
  solution: string;
  autoFixable: boolean;
}

export interface CompatibilityWarning {
  package: string;
  message: string;
  severity: "low" | "medium" | "high";
  impact: string;
}

export interface RequiredChange {
  type: "dependency_update" | "code_modification" | "config_change" | "breaking_api";
  package: string;
  description: string;
  automaticFix: boolean;
  estimatedEffort: "trivial" | "low" | "medium" | "high";
  files?: string[];
}

export interface FailureScenario {
  scenario: string;
  likelihood: "low" | "medium" | "high";
  impact: string;
  mitigation: string;
}

export interface RiskAssessment {
  successLikelihood: number; // 0-100%
  riskLevel: "safe" | "low" | "medium" | "high" | "critical";
  failureScenarios: FailureScenario[];
  mitigationStrategies: string[];
  criticalWarnings: string[];
  confidence: number; // 0-100 (realistic assessment)
}

export interface BreakingChange {
  package: string;
  fromVersion: string;
  toVersion: string;
  type: "mechanical" | "behavioral" | "architectural";
  severity: "minor" | "major" | "critical";
  description: string;
  affectedAPIs?: string[];
  migrationSteps?: string[];
}

export interface CouplingMetric {
  file: string;
  couplingScore: number; // 0-1, higher = more coupled
  issues: Array<{
    type: "deep-import" | "monkey-patch" | "framework-internal" | "version-specific-hack";
    description: string;
    location: string;
  }>;
}

export interface UpgradeStep {
  order: number;
  title: string;
  description: string;
  commands?: string[];
  estimatedTime: string;
  riskLevel: "low" | "medium" | "high";
  validationChecks: string[];
}

export interface Risk {
  id: string;
  category: "data" | "runtime" | "compatibility" | "performance" | "security";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  impact: string;
  mitigation: string;
  rollbackPlan?: string;
}

/** Risk report from RiskReportAgent for selected version combination */
export interface RiskReportResult {
  executiveSummary: string;
  overallRisk: "low" | "medium" | "high" | "critical";
  recommendation: "proceed" | "proceed_with_caution" | "review_required" | "do_not_proceed";
  confidenceScore: number;
  breakingChanges: Array<{
    package: string;
    fromVersion: string;
    toVersion: string;
    impact: string;
    migrationGuide: string;
    severity: "low" | "medium" | "high";
  }>;
  upgradeOrder: string[];
  failureScenarios: Array<{
    scenario: string;
    likelihood: string;
    impact: string;
    mitigation: string;
  }>;
  requiredChanges: Array<{
    type: string;
    description: string;
    affectedFiles: string[];
    effort: string;
  }>;
  rollbackReadiness: string;
  keyInsights: string[];
  nextSteps: string[];
}

// ===== Assessment Sub-Agent Outputs =====

export interface SecurityAssessmentResult {
  totalVulnerabilities: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  cves: Array<{
    id: string;
    package: string;
    severity: "critical" | "high" | "medium" | "low";
    title: string;
    fixedIn?: string;
  }>;
  advisories: string[];
  score: number; // 0-100 security health score
}

export interface CodeQualityResult {
  qualityScore: number; // 0-100
  maintainabilityIndex: number; // 0-100
  complexityMetrics: {
    averageCyclomaticComplexity: number;
    maxCyclomaticComplexity: number;
    linesOfCode: number;
    codeToCommentRatio: number;
    duplicateCodePercentage: number;
  };
  debtItems: Array<{
    type: "code-smell" | "anti-pattern" | "deprecated-usage" | "tech-debt";
    description: string;
    file: string;
    severity: "low" | "medium" | "high";
  }>;
  patterns: {
    designPatterns: string[];
    antiPatterns: string[];
    testCoverage: "none" | "low" | "moderate" | "high";
  };
}

export interface BreakingChangesPreview {
  totalBreakingChanges: number;
  byPackage: Array<{
    package: string;
    currentVersion: string;
    latestVersion: string;
    breakingChangesCount: number;
    severity: "minor" | "major" | "critical";
    highlights: string[];
  }>;
  severityDistribution: {
    minor: number;
    major: number;
    critical: number;
  };
}

export interface DatabaseDependencyResult {
  databases: Array<{
    type: "sql-server" | "postgresql" | "mysql" | "mongodb" | "sqlite" | "redis" | "cosmosdb" | "other";
    detectedFrom: string;
    version?: string;
  }>;
  orms: Array<{
    name: string;
    version?: string;
    detectedFrom: string;
  }>;
  migrationFiles: string[];
  connectionStrings: number;
  versionConstraints: string[];
  hasDbMigrations: boolean;
}

export interface RequirementsAnalysisResult {
  osRequirements: string[];
  runtimePrereqs: Array<{
    runtime: string;
    minVersion: string;
    currentVersion?: string;
  }>;
  envConstraints: Array<{
    name: string;
    description: string;
    type: "required" | "optional";
  }>;
  sdks: string[];
  buildTools: string[];
  containerized: boolean;
  cicdPlatform?: string;
}

/** Tracks completion of each assessment sub-agent for real-time UI cards */
export interface AssessmentSubAgentStatus {
  stackDetection: "pending" | "running" | "completed" | "failed";
  dependencyAnalysis: "pending" | "running" | "completed" | "failed";
  versionIntelligence: "pending" | "running" | "completed" | "failed";
  securityAssessment: "pending" | "running" | "completed" | "failed";
  codeQuality: "pending" | "running" | "completed" | "failed";
  breakingChangesPreview: "pending" | "running" | "completed" | "failed";
  databaseDependencies: "pending" | "running" | "completed" | "failed";
  requirementsAnalysis: "pending" | "running" | "completed" | "failed";
}

// ===== Planning Phase Structured Data =====

export interface PerStackScore {
  name: string;
  category: "runtime" | "framework" | "database" | "library" | "build-tool";
  currentVersion: string;
  targetVersion: string;
  compatibilityScore: number; // 0-100
  riskScore: number; // 0-100 (higher = more risky)
  breakingChangesCount: number;
  effort: "trivial" | "low" | "medium" | "high" | "very-high";
  effortNumeric: number; // 1-5 for charts
}

export interface RiskMatrixEntry {
  scenario: string;
  likelihood: number; // 1-5
  impact: number; // 1-5
  category: string;
}

export interface PlanningVisualizationData {
  perStackScores: PerStackScore[];
  riskMatrix: RiskMatrixEntry[];
  overallHealth: {
    security: number;
    compatibility: number;
    effort: number;
    risk: number;
    testCoverage: number;
  };
  // Extended fields for richer dashboard
  effortDistribution?: { label: string; count: number }[];
  severityDistribution?: { label: string; count: number; color: string }[];
  upgradeOrder?: string[];
  recommendation?: string;
  totalBreakingChanges?: number;
  requiredChanges?: { type: string; count: number }[];
  keyInsights?: string[];
}

// ===== Task Execution Result (per-task) =====

export interface TaskExecutionResult {
  taskId: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  summary: string;
  alteredFiles: Array<{
    path: string;
    changeDescription: string;
    linesChanged: number;
  }>;
  fixedIssues: string[];
  verificationFiles: string[];
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

// ===== Structural models (for scope-limited upgrade) =====

export interface RepositoryTree {
  entryPoints: string[];
  testRoots: string[];
  projectRoots: string[];
  framework?: "dotnet" | "python" | "node" | "java";
}

export interface ImportGraph {
  fileToPackages: Record<string, string[]>;
  packageToFiles: Record<string, string[]>;
  /** file A → list of files that A depends on (asset refs, project refs, manifest consumers) */
  fileToFiles: Record<string, string[]>;
}

// ===== Coupling Registry (files that must upgrade together) =====

export interface CouplingGroup {
  name: string;
  library: string;
  files: string[];
  criticalFiles: string[];
  rule: string;
}

// ===== Consistency Validation (post-upgrade cross-file checks) =====

export interface ConsistencyViolation {
  file: string;
  issue: string;
  severity: "critical" | "warning";
  pattern?: string;
  autoFixable: boolean;
}

export interface ConsistencyReport {
  totalChecked: number;
  passed: number;
  autoFixed: number;
  llmFixPassFiles: number;
  violations: ConsistencyViolation[];
}

// ===== Code Review Report (pre-test validation of upgraded code) =====

export interface CodeReviewIssue {
  file: string;
  issue: string;
  severity: "critical" | "warning" | "info";
  category: "import-mismatch" | "api-misuse" | "type-error" | "missing-config" | "logic-error" | "incomplete-upgrade";
  fixed: boolean;
  fixDescription?: string;
}

export interface CodeReviewReport {
  filesReviewed: number;
  issuesFound: number;
  issuesFixed: number;
  issuesRemaining: number;
  issues: CodeReviewIssue[];
}

// ===== Migration Doc Index (per-file relevance lookup) =====

export interface MigrationDocIndex {
  fileRelevance: Record<string, string[]>;
  packageSections: Record<string, string[]>;
}

// ===== Token Usage Tracking =====

export interface LLMCallMetrics {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  estimatedCost: number;
}

export interface PhaseMetrics {
  phase: string;
  startedAt?: number;
  completedAt?: number;
  durationMs: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface AgentMetrics {
  agent: string;
  phase: string;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  estimatedCost: number;
}

export interface TokenUsageSummary {
  phases: Record<string, PhaseMetrics>;
  agents: Record<string, AgentMetrics>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalLLMCalls: number;
  totalEstimatedCost: number;
  totalDurationMs: number;
}

// ===== LangGraph State =====

export interface StackModernizationState {
  // Session Info
  sessionId: string;
  analysisId: string;
  modernizationType: ModernizationType;
  llmProvider: LLMProvider; // User-selected LLM
  userId: string;
  tenantId: string;

  // ADO project context (for persistence scoping)
  adoOrg?: string;
  adoProjectId?: string;
  adoProjectName?: string;
  repoName?: string;
  gitBranch?: string;
  gitFileCount?: number;
  
  // User-selected workflow phases (default: all selected)
  selectedPhases?: SelectablePhase[];
  
  // File Info
  uploadedFiles: UploadedFile[];
  extractedFiles: ExtractedFile[];
  tempDir: string;
  
  // Structural models (built in assessment for scope-limited upgrade)
  repositoryTree?: RepositoryTree;
  importGraph?: ImportGraph;
  fileIntelligence?: Record<string, import("./services/file-intelligence").FileIntelligence>;
  astAnalysis?: Record<string, import("./services/ast-parser").ASTAnalysis>;
  impactReport?: import("./services/pre-upgrade-impact-analyzer").UpgradeImpactReport;
  migrationAllowedRenames?: Record<string, string>;

  // Migration docs fetched once early, consumed by all downstream agents.
  // Full structured docs — source of truth, never truncated.
  migrationDocs?: Record<string, import("./services/migration-doc-fetcher").MigrationDocResult>;
  // Complete formatted text (untruncated) for debug / full retrieval.
  migrationDocsFullText?: string;
  // Legacy field — kept for backward compat; now generated per-consumer at call site.
  migrationDocsPromptText?: string;
  migrationDocsIndex?: MigrationDocIndex;
  deterministicRules?: import("./services/deterministic-transforms").TransformRule[];
  migrationDocsWarnings?: string[];

  // Vendor library detection and replacement
  vendorLibraries?: VendorLibrary[];

  // Vendor download results (populated by vendorDownloadNode / download-packages endpoint)
  vendorDownloadResults?: {
    downloaded: Array<{
      library: string;       // "jQuery"
      version: string;       // "4.0.0"
      source: string;        // "https://cdn.jsdelivr.net/npm/jquery@4.0.0/dist/jquery.min.js"
      destination: string;   // "wwwroot/lib/uiframework/base-library.js"
      sizeBytes: number;     // 89452
      durationMs: number;    // 1250
      type: "individual" | "bundle" | "created";
    }>;
    failed: Array<{
      library: string;
      version: string;
      source: string;
      reason: string;        // "HTTP 404" or "Network error" etc.
    }>;
    skipped: Array<{
      library: string;
      reason: string;        // "Inferred vendor (app CSS files, not library)" or "No matching selection"
    }>;
  };

  // CSS migration rules generated dynamically from downloaded package diffs
  // e.g., comparing Bootstrap 4.6.2 CSS vs 5.3.2 CSS → generates "pr-2 → pe-2" rules
  cssMigrationRules?: Array<{
    oldClass: string;
    newClass: string;
    library: string;
    confidence: "high" | "medium" | "low";
  }>;

  // Coupling registry (files that must upgrade together)
  couplingRegistry?: CouplingGroup[];

  // Post-upgrade consistency validation
  consistencyReport?: ConsistencyReport;

  // Code review pass (pre-test validation of upgraded code)
  codeReviewReport?: CodeReviewReport;

  // GAP 10: Completeness verification report
  completenessReport?: import("./services/completeness-verifier").CompletenessReport;
  completenessReportMarkdown?: string;
  /** Number of times completeness verification has looped back to code_upgrade */
  completenessRetryCount?: number;
  /** Failed checks from last completeness run (used to guide targeted retry) */
  completenessFailedChecks?: Array<{ id: string; category: string; description: string; details?: string }>;

  // GAP 3: API usage impact scanning (breaking API patterns per file)
  apiUsageImpactReport?: any;
  apiUsageImpactMarkdown?: string;

  // GAP 9: Obsolete packages removed during upgrade
  removedObsoletePackages?: string[];

  // GAP 1/15: Bundle detection — libraries found inside concatenated vendor files
  bundleDetections?: any[];
  discoveredBundledLibraries?: string[];

  // CDN library references found in HTML/Razor <script>/<link> tags
  cdnReferences?: CdnReference[];
  // Libraries inferred from CSS class patterns (e.g. Font Awesome from fa fa-* classes)
  inferredLibraries?: InferredLibrary[];
  // Comprehensive migration report generated after completeness verification
  migrationReportMarkdown?: string;
  // Files that were too large to process automatically
  skippedFiles?: Array<{ path: string; reason: string; size: number }>;

  // GAP 2/6: New libraries wired into layout files
  newLibrariesAdded?: string[];

  // Asset references in view/template files that couldn't be auto-resolved to vendor downloads
  unresolvedAssetRefs?: Array<{ file: string; ref: string; fileName: string }>;

  // Per-file change summaries from code upgrade agent
  changeSummaries?: Record<string, string>;

  // Structural scaffold: new files created, obsolete files flagged, warnings
  scaffoldResult?: import("./services/scaffold-generator").ScaffoldResult;
  structuralChangesMarkdown?: string;

  // Agent Outputs (populated as agents execute)
  repoProfile?: RepoProfileResult;
  dependencyGraph?: DependencyGraphResult;
  versionRecommendations?: VersionRecommendation[];
  versionIntelligence?: VersionRecommendation[]; // Alias for versionRecommendations
  
  // Assessment sub-agent outputs
  securityAssessment?: SecurityAssessmentResult;
  codeQuality?: CodeQualityResult;
  breakingChangesPreview?: BreakingChangesPreview;
  databaseDependencies?: DatabaseDependencyResult;
  requirementsAnalysis?: RequirementsAnalysisResult;
  assessmentSubAgentStatus?: AssessmentSubAgentStatus;

  // Assessment phase outputs
  assessmentMarkdown?: string; // Generated assessment.md content
  versionRecommendationsText?: string; // Pre-filled editable text for user
  
  // NEW: User selections, compatibility check, and risk report
  userSelections?: VersionSelection[];
  compatibilityCheck?: CompatibilityCheckResult;
  riskReport?: RiskReportResult;
  planMarkdown?: string; // Generated plan.md content
  
  // Planning visualization data
  planningVisualizationData?: PlanningVisualizationData;

  // Task execution
  upgradeTasks?: any[]; // UpgradeTask[] from task-planner-agent
  taskExecutionResults?: TaskExecutionResult[];
  tasksMarkdown?: string; // Generated tasks.md content
  generatedTests?: any[]; // GeneratedTest[] from test-generation-agent
  testResultsMarkdown?: string; // Generated test-results.md content
  confidenceReportMarkdown?: string; // Generated confidence-report.md content
  vendorUpdateReportMarkdown?: string; // Vendor library file replacement summary
  modifiedFiles?: ModifiedFile[];
  codeUpgrade?: {
    modifiedFiles: ModifiedFile[];
    summary: { totalFilesModified: number; totalPackagesUpgraded: number; success: boolean };
    errors: string[];
  };
  /** Path to the prepared project directory (set when getProjectPath first runs). Reused for run-again and file edit/delete. */
  currentRunDirectory?: string;
  /** Paths deleted by user in validation panel; prepareProjectDir removes these from project root after overlay. */
  deletedPaths?: string[];

  // Run-and-validate (Docker run + fix loop)
  validationRun?: { runId: string; status: string; lastLogs?: string; exitCode?: number; testSummary?: string; testsRun?: number; testsPassed?: number; testsFailed?: number; testsSkipped?: number };
  validationAttempts?: number;
  validationFixedFiles?: Array<{ path: string; patchOrContent: string }>;
  validationPassed?: boolean;
  
  breakingChanges?: BreakingChange[];
  couplingAnalysis?: {
    overallScore: number;
    metrics: CouplingMetric[];
  };
  upgradeStrategy?: {
    approach: "big-bang" | "incremental" | "strangler";
    order: string[];
    reasoning: string;
  };
  executionPlan?: {
    steps: UpgradeStep[];
    estimatedDuration: string;
  };
  risks?: Risk[];
  validationChecklist?: {
    preMerge: string[];
    postDeploy: string[];
    rollbackReady: boolean;
  };
  
  // Token Usage Tracking
  tokenUsage?: TokenUsageSummary;

  // Progress Tracking
  currentStage: string;
  progress: number; // 0-100
  status: "initiated" | "in_progress" | "awaiting_user_selection" | "risk_analysis" | "risk_report_ready" | "downloading_packages" | "packages_complete" | "code_upgrade" | "completed" | "failed" | "paused" | "cancelled";
  errors: string[];
  
  // Detailed Activity Log (real-time visibility)
  activityLog: Array<{
    timestamp: Date;
    agent: string;
    action: string;
    details?: string;
    status: "info" | "success" | "warning" | "error";
  }>;
  
  /** Incremented on every phase reset — forces legacy agent path instead of LangGraph resume. */
  graphRunVersion?: number;

  // Timestamps
  startedAt: Date;
  completedAt?: Date;
}

// ===== Database Models =====

export interface StackModernizationSession {
  id: string;
  projectId?: string;
  modernizationType: ModernizationType;
  status: "uploading" | "analyzing" | "completed" | "failed";
  createdBy: string;
  tenantId: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface ModernizationFile {
  id: string;
  sessionId: string;
  fileName: string;
  fileSize: number;
  filePath: string;
  fileHash: string;
  uploadedAt: Date;
}

export interface ModernizationAnalysis {
  id: string;
  sessionId: string;
  agentName: string;
  agentOutput: any; // JSON
  executionTime: number; // milliseconds
  status: "pending" | "running" | "completed" | "failed";
  errorMessage?: string;
  createdAt: Date;
}

export interface ModernizationRecommendation {
  id: string;
  sessionId: string;
  recommendationType: string;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  impactAnalysis: any; // JSON
  implementationSteps: any; // JSON
  createdAt: Date;
}

// ===== API Request/Response Types =====

export interface UploadRequest {
  modernizationType: ModernizationType;
  projectId?: string;
  files: any[];
}

export interface UploadResponse {
  sessionId: string;
  uploadedFiles: Array<{
    name: string;
    size: number;
    path: string;
    hash: string;
  }>;
  status: string;
}

export interface AnalyzeRequest {
  sessionId: string;
  modernizationType: ModernizationType;
  options?: {
    targetVersions?: Record<string, string>;
    cloudProvider?: string;
    analysisDepth?: "quick" | "standard" | "comprehensive";
  };
}

export interface AnalyzeResponse {
  analysisId: string;
  status: string;
  estimatedDuration: number;
  agentsDeployed: string[];
}

export interface ProgressResponse {
  analysisId: string;
  status: "in_progress" | "completed" | "failed";
  progress: number;
  currentStage: string;
  stages: Array<{
    name: string;
    status: "pending" | "in_progress" | "completed" | "failed";
    duration?: number;
  }>;
  results?: any;
}

export interface ResultsResponse {
  analysisId: string;
  modernizationType: string;
  summary: {
    currentState: {
      languages: string[];
      frameworks: Array<{ name: string; version: string }>;
      dependencies: number;
      linesOfCode?: number;
    };
    recommendations: {
      priority: "high" | "medium" | "low";
      breakingChanges: number;
      estimatedEffort: string;
      riskLevel: "low" | "medium" | "high";
    };
  };
  agentReports: {
    repoProfiler?: RepoProfileResult;
    dependencyGraph?: DependencyGraphResult;
    versionIntelligence?: VersionRecommendation[];
    breakingChangeAnalyzer?: BreakingChange[];
    codeCouplingAnalyzer?: any;
    upgradeStrategy?: any;
    executionPlanner?: any;
    riskAssessment?: Risk[];
    validationChecklist?: any;
  };
  downloadUrls: {
    fullReport: string;
    executionPlan: string;
    migrationScripts?: string;
  };
}
