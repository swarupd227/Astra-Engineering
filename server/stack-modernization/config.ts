/**
 * Stack Modernization configuration.
 * Centralizes flags and env-based settings. When validation is disabled,
 * the validation phase is not run and is hidden from the UI.
 *
 * Env vars (can be set in .env):
 * - STACK_MODERNIZATION_VALIDATION_ENABLED: "true" | "false" — show/run validation phase (default: false)
 * - STACK_MODERNIZATION_SKIP_AUTH: "true" | "false" — bypass auth for dev
 * - USE_LANGGRAPH_STACK_MODERNIZATION: "true" | "false" — use LangGraph workflow (default: true)
 * - CODE_EXECUTION_BASE_DIR: base path for run/validate and temp files
 * - USE_LOCAL_CODE_EXECUTION: "true" | "false" — run in host instead of Docker
 * - ENABLE_RUN_AND_VALIDATE: "true" | "false" — when validation is enabled, allow run-and-validate (default: true)
 */

function envBool(key: string, defaultValue: boolean): boolean {
  const v = process.env[key];
  if (v === "false" || v === "0") return false;
  if (v === "true" || v === "1") return true;
  return defaultValue;
}

function envString(key: string, defaultValue: string | undefined): string | undefined {
  const v = process.env[key];
  if (v == null || v === "") return defaultValue;
  return v;
}

export const stackModConfig = {
  /** When false, validation phase is not run and is hidden from the UI (no container   required). */
  get validationEnabled(): boolean {
    return envBool("STACK_MODERNIZATION_VALIDATION_ENABLED", false);
  },

  /** Bypass authentication for development. */
  get skipAuth(): boolean {
    return envBool("STACK_MODERNIZATION_SKIP_AUTH", false);
  },

  /** Use LangGraph for stack modernization workflow (default: true). */
  get useLangGraph(): boolean {
    return envBool("USE_LANGGRAPH_STACK_MODERNIZATION", true);
  },

  /** Base directory for code execution and temp files (fallback: cwd or os.tmpdir). */
  get codeExecutionBaseDir(): string | undefined {
    return envString("CODE_EXECUTION_BASE_DIR", undefined);
  },

  /** Run project on host instead of Docker when validation/code execution is used. */
  get useLocalCodeExecution(): boolean {
    return envBool("USE_LOCAL_CODE_EXECUTION", true);
  },

  /** When validation is enabled, allow run-and-validate (container/local execution). */
  get enableRunAndValidate(): boolean {
    return envBool("ENABLE_RUN_AND_VALIDATE", true);
  },

  /** Build verification commands per detected stack. Used in post-upgrade verification. */
  get buildVerificationCommands(): Record<string, string[]> {
    return {
      "dotnet": ["dotnet restore", "dotnet build --no-restore"],
      "node": ["npm install", "npm run build"],
      "java-maven": ["mvn compile -q"],
      "java-gradle": ["./gradlew build -x test"],
      "python": ["pip install -r requirements.txt"],
    };
  },

  /** Whether build verification should be auto-enabled for known stacks. */
  get autoEnableBuildVerification(): boolean {
    return envBool("STACK_MOD_AUTO_BUILD_VERIFY", true);
  },

  // ── Code Upgrade Pipeline Tuning ──

  /** Max files sent to the LLM per upgrade task (default: 50). */
  get upgradeMaxFilesPerTask(): number {
    return parseInt(process.env.UPGRADE_MAX_FILES_PER_TASK || "50", 10);
  },

  /** LLM call timeout in ms (default: 120000 = 2 min). */
  get upgradeLlmTimeoutMs(): number {
    return parseInt(process.env.UPGRADE_LLM_TIMEOUT_MS || "120000", 10);
  },

  /** Max files included in the upgrade plan generation (default: 30). */
  get planMaxFiles(): number {
    return parseInt(process.env.UPGRADE_PLAN_MAX_FILES || "30", 10);
  },

  /** File size in chars above which non-manifest files are skipped (default: 300000). */
  get fileSizeSkipThreshold(): number {
    return parseInt(process.env.UPGRADE_FILE_SKIP_THRESHOLD || "300000", 10);
  },

  /** File size in chars above which files are chunked (default: 150000). */
  get fileSizeChunkThreshold(): number {
    return parseInt(process.env.UPGRADE_FILE_CHUNK_THRESHOLD || "150000", 10);
  },

  /** Max chars for triage manifest (Claude models) (default: 150000). */
  get triageManifestCapClaude(): number {
    return parseInt(process.env.UPGRADE_TRIAGE_CAP_CLAUDE || "150000", 10);
  },

  /** Max chars for triage manifest (GPT-5.3 models) (default: 150000). */
  get triageManifestCapGpt(): number {
    return parseInt(process.env.UPGRADE_TRIAGE_CAP_GPT || "150000", 10);
  },

  /** Use JSON mode / structured output for models that support it (reduces parsing failures). */
  get useStructuredOutput(): boolean {
    return envBool("UPGRADE_USE_STRUCTURED_OUTPUT", true);
  },

  /** When true, run npm install / dotnet restore after package upgrades to populate dependencies on disk. */
  get RUN_PACKAGE_MANAGER_INSTALL(): boolean {
    return envBool("STACK_MOD_RUN_PACKAGE_MANAGER_INSTALL", true);
  },
};

/** Use LangGraph for stack modernization (re-export for existing graph/config consumers). */
export function useLangGraphStackModernization(): boolean {
  return stackModConfig.useLangGraph;
}
