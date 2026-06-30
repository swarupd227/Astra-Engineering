/**
 * Task Planner Agent Prompts
 * Comprehensive prompts for breaking down upgrades into executable tasks
 * Now with smart token management for large codebases
 */

import type { StackModernizationState } from "../types";
import {
  prepareFilesWithinBudget,
  formatFilesForPrompt,
  calculateCodeBudget,
  estimatePromptSize,
  safeMaxTokens,
} from "../services/token-manager";
import { buildFileAnalysisInstruction } from "./code-upgrade-prompts";

export const TASK_PLANNER_SYSTEM_PROMPT = `You are a **Senior Project Manager & Tech Lead** with 25+ years of experience in:
- Breaking down complex technical projects into executable tasks
- Sprint planning and agile methodology
- Task estimation and effort sizing
- Dependency ordering and critical path analysis
- Team coordination and resource allocation
- Risk-based task prioritization

**Your Planning Methodology:**
1. **Dependency-First**: Order tasks by what blocks what (manifests first, then code; execution will follow this order)
2. **Risk-Based Prioritization**: High-risk tasks early (fail fast)
3. **Verification at Every Step**: Each task has clear pass/fail criteria
4. **Atomic Changes**: Tasks are small enough to complete and test independently

**Version guidance:**
- The "Selected Upgrades" section below contains the exact target versions the user chose. Use these as your source of truth.
- All tasks you generate must reference the exact target versions from the user's selections. Do not substitute your own version suggestions.
- All user-specified target versions are real and released. Do not claim a version does not exist.
- Tasks must cover BOTH backend AND frontend upgrades. If frontend libraries are in the selections, generate tasks for upgrading template/view files and library manifests.

**Your Philosophy:**
- "**If you can't verify it, it's not done**"
- "**Make it work, make it right, make it fast - in that order**"
- "**A task that takes more than 4 hours is actually 3 tasks**"
- "**Always assume the person executing knows less than you think**"

**MANDATORY JSON OUTPUT FORMAT — VIOLATION CAUSES SYSTEM FAILURE:**
You MUST return a valid JSON array. Every task object in the array MUST contain ALL of these fields with NON-EMPTY values:
- "id": string (e.g., "TASK-001") — REQUIRED, must be unique
- "title": string — REQUIRED, must be a clear 5-20 word summary. NEVER empty. NEVER null.
- "description": string — REQUIRED, must be detailed (5-12 sentences). NEVER empty.
- "phase": string — REQUIRED
- "riskLevel": "low" | "medium" | "high" — REQUIRED
- "estimatedTime": string — REQUIRED
- "steps": string[] — REQUIRED, at least 2 steps
- "verificationCriteria": string[] — REQUIRED, at least 1 criterion
- "affectedFiles": string[] — REQUIRED
- "status": "pending" — REQUIRED

If ANY task has an empty "title" or empty "description", the entire output is INVALID and will be rejected. The system will show blank rows to the user, causing a critical UX failure. Double-check every task has a non-empty title before returning.

${buildFileAnalysisInstruction()}`;

export function buildTaskPlannerPrompt(state: StackModernizationState, model: string = "gpt-4o-mini"): string {
  const selections = state.userSelections || [];
  const compat = state.compatibilityCheck;
  const risk = state.riskReport;
  const repoProfile = state.repoProfile;
  const codeFiles = state.extractedFiles || [];
  
  // Build static portion of prompt
  const staticPart = `# Task Breakdown for Stack Modernization

## Your Mission
Take the upgrade plan and break it down into **concrete, executable tasks** that a mid-level engineer can follow step-by-step. Each task must be specific enough that there's no guesswork, with clear verification criteria and realistic time estimates.

---

## 📊 Project Context

### Repository Info
- **Project Type**: ${repoProfile?.projectType || "Unknown"}
- **Total Files**: ${repoProfile?.fileStructure?.totalFiles || 0}
- **Code Files**: ${repoProfile?.fileStructure?.codeFiles || 0}
- **Has Tests**: ${repoProfile?.detectedPatterns?.hasTests ? "Yes" : "No"}
${state.repositoryTree ? `
### Repository Structure
- **Entry points**: ${state.repositoryTree.entryPoints?.length ? state.repositoryTree.entryPoints.join(", ") : "None"}
- **Test roots**: ${state.repositoryTree.testRoots?.length ? state.repositoryTree.testRoots.join(", ") : "None"}
- **Project roots**: ${state.repositoryTree.projectRoots?.length ? state.repositoryTree.projectRoots.join(", ") : "None"}
- **Framework**: ${state.repositoryTree.framework ?? "Unknown"}` : ""}
${state.importGraph && selections.length ? `
### Import Scope (packages being upgraded → files that use them)
${selections.map((s: { package: string }) => {
  const pkg = s.package;
  const files = state.importGraph!.packageToFiles[pkg] ?? state.importGraph!.packageToFiles[pkg.toLowerCase()] ?? [];
  return `- **${pkg}**: ${files.length ? files.slice(0, 30).join(", ") + (files.length > 30 ? ` (+${files.length - 30} more)` : "") : "No direct imports"}`;
}).join("\n")}` : ""}

${(state.cdnReferences?.length ?? 0) > 0 ? `
### CDN Library References (require URL version updates)
These \`<script>\` and \`<link>\` tags in HTML/Razor files reference CDN-hosted libraries that MUST have their version numbers updated:
${state.cdnReferences!.map(r => `- \`${r.file}\`:${r.line} — **${r.library}** ${r.version ?? "(version unknown)"} via \`<${r.tagType}>\` → ${r.url}`).join("\n")}

**IMPORTANT:** Generate a task that updates these CDN URLs to the target versions listed below.
` : ""}${(state.inferredLibraries?.length ?? 0) > 0 ? `
### Libraries Inferred from CSS Class Usage
${state.inferredLibraries!.filter(l => l.confidence === "high").map(l => `- **${l.library}** (\`${l.npmPackage}\`) — detected in ${l.detectedIn.length} file(s) via CSS classes: \`${l.evidence.slice(0, 3).join("`, `")}\``).join("\n")}
` : ""}
### Selected Upgrades (USER-SPECIFIED — use these EXACT versions in ALL tasks)
${selections.map(s => `- **${s.package}**: ${s.currentVersion} → ${s.selectedVersion} (${s.category})`).join("\n")}

**CRITICAL — USE THESE EXACT VERSION NUMBERS. DO NOT INVENT OR HALLUCINATE VERSION NUMBERS.**
For example, if the user selected ".NET: 7.0 → 10.0", write "net7.0" and "net10.0" EXACTLY — do NOT write "net0.7.6.1.8" or any other fabricated version. Copy-paste from the list above.

${(state.vendorLibraries?.length ?? 0) > 0 ? `
### Detected Client-Side/Vendor Libraries (REQUIRE download + file replacement)
The following libraries were detected in the project's vendor directories (e.g., wwwroot/lib/, bower_components/, static/vendor/). These are physical library files that must be DOWNLOADED at the target version and REPLACED on disk:
${state.vendorLibraries!.map((v: any) => `- **${v.name}** — detected version: ${v.detectedVersion ?? "unknown"}, location: \`${v.vendorBasePath}\`, files: ${(v.existingFiles || []).length}, method: ${v.detectionMethod}`).join("\n")}

**MANDATORY: Generate at least ONE dedicated task for downloading and replacing these vendor library files.** This task should:
1. List each vendor library and its target version
2. Specify that the dist files (e.g., jquery.min.js, bootstrap.min.css) must be downloaded from CDN/npm and replaced in the vendor directory
3. If libraries are bundled in concatenated files (like base-library.js), specify that the bundle must be rebuilt with new versions
4. Title it clearly, e.g., "Download and replace vendor library files (jQuery 4.0.0, Bootstrap 5.3.2, ...)"
` : ""}
${state.vendorDownloadResults ? `
### ✅ Vendor Library Download Results (ALREADY COMPLETED — do NOT generate download tasks)
The platform has ALREADY downloaded and replaced the following vendor library files BEFORE task generation. Do NOT generate any tasks for downloading or replacing these files.

**Successfully downloaded:**
${(state.vendorDownloadResults.downloaded ?? []).map((d: any) => `- ✅ **${d.library}** @${d.version} → \`${d.destination}\` (${d.type || "file"}, ${((d.sizeBytes || 0) / 1024).toFixed(1)}KB)`).join("\n") || "- (none)"}

**Failed to download (generate a MANUAL FIX task for these):**
${(state.vendorDownloadResults.failed ?? []).map((f: any) => `- ❌ **${f.library}** @${f.version} — ${f.reason || "unknown error"}`).join("\n") || "- (none — all downloads succeeded)"}

**IMPORTANT:** Do NOT generate tasks for downloading or replacing vendor/library files — the platform handles this automatically. Only generate tasks for files that FAILED to download (listed above).
` : ""}${(state.cssMigrationRules?.length ?? 0) > 0 ? `
### CSS Class Migration Rules (auto-generated from downloaded packages)
The platform compared the OLD and NEW CSS files and found these class renames. **Generate tasks to apply these changes to ALL .cshtml/.html/.razor template files:**

${state.cssMigrationRules!.slice(0, 50).map(r => `- \`${r.oldClass}\` → \`${r.newClass}\` (${r.library}, ${r.confidence} confidence)`).join("\n")}
${state.cssMigrationRules!.length > 50 ? `\n... and ${state.cssMigrationRules!.length - 50} more rules` : ""}

**These are CONFIRMED class renames from the actual CSS files — not guesses.** The old classes no longer exist in the new CSS. Every occurrence MUST be replaced or the UI will be broken/unstyled.
` : ""}
**CRITICAL — MANDATORY COVERAGE REQUIREMENT:**
Every single package listed above MUST be addressed by at least one task. If a package has CDN references, manifest entries, or config references in the codebase, there MUST be a task that updates them. After generating all tasks, mentally verify: "Is every package from the Selected Upgrades list covered by at least one task?" If any package is missing, ADD a task for it before returning.

**IMPORTANT: The target versions above are the user's explicit choices. Every task you generate should use these exact target versions. Do not substitute different versions.**

### Compatibility Summary
- **Warnings**: ${compat?.warnings?.length || 0}
- **Conflicts**: ${compat?.conflicts?.length || 0}
- **Recommendation**: ${compat?.recommendation || "unknown"}

### Risk Summary
- **Overall Risk**: ${risk?.overallRisk || "unknown"}
- **Breaking Changes**: ${risk?.breakingChanges?.length || 0}
- **Confidence Score**: ${risk?.confidenceScore || 0}/100`;

  // Request the model's actual output limit. The deployed model hard-caps at ~16K tokens.
  // The prompt tells the LLM its budget so it can manage output length.
  // The parser uses truncation-recovery to handle max_tokens gracefully.
  const outputTokenBudget = safeMaxTokens(16384, model);
  const outputCharBudget = Math.floor(outputTokenBudget * 3.5);

  // Calculate code budget
  const instructionsPart = buildTaskInstructions(outputTokenBudget, outputCharBudget, selections.length, selections);
  const codeBudget = calculateCodeBudget(
    TASK_PLANNER_SYSTEM_PROMPT,
    staticPart + instructionsPart,
    model
  );
  
  
  // Get relevant files (include frontend/template/manifest files)
  const relevantFiles = codeFiles.filter(f => {
    const ext = f.relativePath?.split('.').pop()?.toLowerCase();
    return ['js', 'ts', 'tsx', 'jsx', 'java', 'cs', 'py', 'json', 'xml', 'csproj',
            'cshtml', 'html', 'razor', 'htm', 'css', 'scss', 'less', 'yaml', 'yml',
            'sln', 'props', 'targets', 'config', 'vue', 'php', 'rb', 'go'].includes(ext || '');
  });
  
  // Prepare files within budget
  const preparedFiles = prepareFilesWithinBudget(relevantFiles, {
    totalCharBudget: Math.max(codeBudget, 5000),
    maxCharsPerFile: Math.min(3000, Math.floor(codeBudget / 6)),
    maxFiles: 20,
    priorityExtensions: ['cs', 'csproj', 'java', 'ts', 'tsx', 'js', 'jsx', 'py', 'cshtml', 'html', 'json'],
  });
  
  const codeSection = formatFilesForPrompt(preparedFiles, "Key Files in Project");
  
  const fileAnalysisReminder = `
**IMPORTANT: Before generating tasks, deeply analyze each file above.**
For EACH file, identify: its purpose, what it exports, what it imports, what functions/classes it has, what framework patterns it uses, and how it will be affected by the upgrades. This analysis is CRITICAL for generating accurate, file-specific tasks.
`;

  // Log final prompt size
  const fullPrompt = `${staticPart}\n\n---\n\n${codeSection}\n\n${fileAnalysisReminder}\n\n${instructionsPart}`;
  const estimate = estimatePromptSize(TASK_PLANNER_SYSTEM_PROMPT, fullPrompt);
  
  return fullPrompt;
}

function buildTaskInstructions(outputTokenBudget: number, outputCharBudget: number, selectionCount: number, selections: Array<{ package: string; currentVersion?: string; selectedVersion: string; category?: string }>): string {
  // Don't hardcode task count — let the LLM decide based on the actual project.
  // Just tell it the budget and the principle: one task per concern, cover everything.
  const taskRange = "as many as needed to cover every file and every upgrade fully";

  return `

---

## ⚡ OUTPUT BUDGET & TASK PLANNING — READ THIS FIRST

**Your HARD output limit is ${outputTokenBudget} tokens (~${outputCharBudget} characters).** This is a physical limit of the model — you CANNOT exceed it. If you try, your JSON will be cut off mid-sentence, producing BLANK TASK ROWS in the UI. This is the #1 bug we must prevent.

**TASK COUNT — MAXIMIZE COVERAGE (15-25 tasks expected):**
Generate **15 to 25 tasks** to cover EVERY file, EVERY upgrade, EVERY breaking change. Each task should be concise but specific:
- Title: 5-15 words (clear summary)
- Description: 3-6 sentences (file paths, patterns, before/after)
- Steps: 3-6 steps (actionable, specific)
- Verification: 2-3 criteria (exact commands, patterns)

**Minimum tasks you MUST include:**
- 1 per manifest/package upgrade (${selectionCount} packages = ${selectionCount} tasks minimum)
- 1-3 structural tasks (entry point migration, config format, obsolete file removal)
- 1-3 frontend tasks (CSS classes, data attributes, JS APIs in views)
- 1 CDN URL update task (if CDN refs found above)
- 2-3 verification tasks (build, UI rendering, functionality)
- 1 documentation task

**NOTE:** Do NOT generate a task for downloading vendor libraries — already handled by the platform.

**BUDGET: ${outputTokenBudget} tokens (~${outputCharBudget} chars). Write concise descriptions to fit 20+ tasks. ALWAYS close JSON with ].**

---

## 🎯 Your Task Breakdown Requirements

### Task Properties
Each task MUST have:

1. **Unique ID**: TASK-001, TASK-002, etc.
2. **Clear Title**: What is being done (not how)
3. **Description**: A COMPREHENSIVE description (5-12 sentences) that explains:
   - **WHY** this task exists — which upgrade/migration requires it and what breaks without it
   - **WHAT EXACTLY** must change — specific APIs, classes, attributes, imports, namespaces, or configuration keys
   - **WHICH FILES** are affected and what to look for in each file (e.g., "In Views/Shared/_Layout.cshtml, find all data-toggle attributes and replace with data-bs-toggle")
   - **PATTERNS TO SEARCH** — exact regex or string patterns the executor should search for in the codebase (e.g., "Search for @using Microsoft.AspNetCore.Http.Abstractions and replace with @using Microsoft.AspNetCore.Http")
   - **EXPECTED STATE BEFORE** — what the code looks like now (e.g., "Currently uses Bootstrap 4 data-toggle='modal' attributes")
   - **EXPECTED STATE AFTER** — what it should look like when done (e.g., "Should use Bootstrap 5 data-bs-toggle='modal' attributes")
   - **EDGE CASES / GOTCHAS** — common mistakes to avoid (e.g., "Do NOT change data-toggle in Kendo UI widgets — only in Bootstrap components")
   - **CROSS-FILE IMPACT** — if changing this file requires changes in other files, say which ones and why
4. **Phase**: Which phase it belongs to (see below)
5. **Risk Level**: low/medium/high
6. **Estimated Time**: Realistic (15min, 30min, 1hr, 2hr, 4hr max)
7. **Auto-Fixable**: Can AI/tooling do this automatically?
8. **Detailed Steps**: 5-15 step-by-step instructions, each with EXACT file paths and EXACT patterns to find/replace. Steps should be specific enough that someone unfamiliar with the codebase can execute them mechanically without guessing.
9. **Verification Criteria**: Specific, measurable checks — NOT vague ("ensure it works"). Include: exact build commands to run, specific strings/patterns that should or should not exist in files, URLs to check in browser, expected HTTP status codes, etc.
10. **Affected Files**: Exact file paths (use the provided code analysis, not guesses)
11. **Code Examples** (required for medium/high risk tasks): Before/after code snippets showing the EXACT transformation needed

### Phase Organization

#### Phase 1: Backup & Preparation (15-30 minutes)
- Backup current project state (git branch, snapshot, etc.)
- Document current working state / baseline metrics
- Create rollback branch or tag
- Verify current build passes before starting

#### Phase 2: Project File & Manifest Updates (15-30 minutes)
- Update ALL dependency/library manifest files in the project to the target versions
- Update target framework/runtime version identifiers in project config files
- Run the appropriate package manager to restore/install dependencies
- Verify no dependency conflicts
- Commit manifest changes

#### Phase 2.5: Structural Migration (for major version jumps)
When upgrading across MULTIPLE major versions (e.g., .NET Framework → .NET 6+, Spring Boot 2 → 3, Django 2 → 4, Rails 5 → 7), the project structure itself changes. Generate tasks for:
- **Entry point consolidation**: e.g., merge Startup.cs into Program.cs (.NET 6+), modernize application entry point
- **Config format migration**: e.g., web.config → appsettings.json, create appsettings.Development.json
- **New required files**: e.g., GlobalUsings.cs, _ViewImports.cshtml, _ViewStart.cshtml, Properties/launchSettings.json (.NET), module-info.java (Java 9+), pyproject.toml (Python)
- **Obsolete file removal**: e.g., Global.asax, BundleConfig.cs (.NET), secrets.yml (Rails 5.2+)
- **Namespace migrations**: e.g., javax.* → jakarta.* (Spring Boot 3 / Jakarta EE 9+)
- **Project file format**: e.g., old-style verbose .csproj → SDK-style .csproj, setup.py → pyproject.toml
- **Bundle/package management changes**: e.g., BundleConfig → LibMan/npm, Bower → npm/yarn

#### Phase 3: Breaking Change Fixes (50-60% of effort)
Each breaking change should be a separate task with:
- File and line numbers
- Before/after code
- Why the change is needed
- How to test it

#### Phase 4: Frontend / UI Framework Migration (if applicable)
- Update ALL client-side library manifests to target versions — every library entry must reflect the target version

**CLIENT-SIDE LIBRARY MANIFEST HANDLING (CRITICAL — incorrect handling = broken/unstyled UI):**
Client-side package managers (LibMan, Bower, jspm, etc.) can restore either the FULL SOURCE TREE or only SPECIFIC COMPILED FILES. If the manifest omits the files list or points to the wrong provider/package, the browser will receive SCSS source code instead of compiled CSS — rendering the UI completely unstyled.

Generate DEDICATED tasks for:
1. **Verifying each library entry has an explicit "files" array** listing ONLY compiled dist assets:
   - CSS: .min.css (e.g., "dist/css/bootstrap.min.css" or "css/bootstrap.min.css")
   - JS: .min.js or .bundle.min.js (e.g., "dist/js/bootstrap.bundle.min.js")
   - Fonts/icons: webfont files + CSS (e.g., "css/all.min.css", "webfonts/*")
   - Avoid: .scss, .sass, .less, .ts, .coffee, src/, package.json, Gruntfile
2. **Verifying the provider ships compiled dist** — if the default provider ships source, SWITCH to a CDN-based provider (cdnjs, jsdelivr) that ships compiled dist
3. **Verifying paths in layout/view files match** what the manifest restores — after upgrading versions, the dist directory structure may change between major versions
4. **Removing duplicate library sources** — if a library is provided by a package manager, REMOVE CDN <script>/<link> tags for the same library from layout/view files

- Replace deprecated CSS classes in ALL template/view/stylesheet files — scan EVERY line, not just the first occurrence. Use the migration guide for the specific CSS framework being upgraded.
- Update ALL data attributes in ALL template files according to the target version's conventions
- Replace deprecated JavaScript plugin initialization patterns with the target version's API
- Update layout files — remove duplicate CDN/package-manager loads for the same library
- Replace Unicode emoji/entities with proper icon markup if an icon library is being added
- Verify visual rendering matches expected design
- Ensure NO library is loaded from both a package manager and CDN — use exactly one source
- Verify all restored client-side library files actually exist at the paths referenced by views/layouts

#### Phase 4.5: Database & Data Access Safety (if applicable)
If the project has database-related files (ORM context, migrations, repositories, connection strings, seed data):
- Generate a task to verify connection strings are updated for the target version syntax without altering host/database/credentials
- Generate a task to verify ORM base class patterns are updated (e.g., OnModelCreating, OnConfiguring signatures)
- Generate a task to verify migration history is PRESERVED — no existing migrations are altered
- Generate a task to verify entity configurations (relationships, indexes, keys) are intact
- Generate a task to verify fluent API calls use target version's patterns
- Generate a task to verify seed data is UNCHANGED — only framework patterns updated

#### Phase 5: Configuration & Infrastructure Updates (15-30 minutes)
- Update build configs (SDK version, language version, tooling)
- Update CI/CD pipeline files (.yml, Dockerfile, etc.)
- Update environment variables and app settings
- Update middleware/plugin registrations — ensure NO duplicate registrations (no duplicate app.Run(), app.Build(), builder.Build())
- Update database connection strings if needed

#### Phase 6: Functionality Verification (1-2 hours)
Generate dedicated tasks to verify the upgraded code preserves all original functionality:
- Task to verify the application builds and starts without errors
- Task to verify all forms render with correct styling and layout (no broken UI elements)
- Task to verify all interactive elements work correctly (modals, tooltips, dropdowns, date-pickers, etc.)
- Task to verify all navigation links and routing work as before
- Task to verify API endpoints return correct responses and match the original behavior
- Task to verify no duplicate library loads (package manager + CDN for same lib)
- Task to verify no duplicate startup/initialization calls
- Task to verify no console errors or JavaScript exceptions in the browser
- Task to verify CSS styling matches the original UI appearance (colors, fonts, spacing, layout)
- Task to verify database operations work correctly (CRUD, migrations, connection)
- Task to verify client-side library assets (CSS, JS) are properly loaded (not returning 404)

#### Phase 7: Testing & Validation (2-4 hours)
- Run unit tests — fix any failures caused by upgrade
- Run integration tests
- Manual smoke testing (app starts, pages load, APIs respond)
- Performance benchmarking / regression check
- Verify no console errors in browser (for web apps)

#### Phase 8: Documentation (one task only — crisp and to the point)
- **Exactly one documentation task**: a short upgrade summary (what was upgraded, any env/SDK/runtime prerequisites). Do NOT generate separate tasks for README, CHANGELOG, API docs, or rollback docs. One concise document or section is enough.
- Remove deprecated code, dead imports, unused packages (can be part of code tasks or one cleanup task)

### Task Granularity Rules

✅ **Good Task Size:**
- Touches 1-3 files
- Takes 15min-2hr
- Has clear pass/fail
- Can be tested independently
- Can be committed separately

❌ **Too Large:**
- "Fix all framework issues" (break into separate tasks per component/file)
- "Update all tests" (break by test suite)
- "Refactor codebase" (break by module)

❌ **Too Small:**
- "Add import statement" (combine with related changes)
- "Fix typo" (combine with parent task)

### Verification Criteria Examples

**Good:**
- "Run \`npm test\` - all tests pass"
- "Run \`npm run build\` - no errors"
- "Open app in browser - homepage loads without console errors"
- "Run \`npm run lint\` - no new linting errors"

**Bad:**
- "Make sure it works" (too vague)
- "Test the app" (not specific)
- "Check for errors" (what errors? where?)

---

## 📝 Output Format

Return an array of tasks in **strict JSON format**. The examples below illustrate the STRUCTURE and DETAIL LEVEL expected — your actual task content must be based on the user's project, code files, and selected upgrades:

\`\`\`json
[
  {
    "id": "TASK-001",
    "title": "Update .csproj target framework from net7.0 to net8.0",
    "description": "The user selected .NET 7.0 → 8.0 upgrade. The project file MyApp/MyApp.csproj currently contains <TargetFramework>net7.0</TargetFramework> on line 5. This must be changed to <TargetFramework>net8.0</TargetFramework>. Additionally, global.json (if present) must have its SDK version updated. After this change, run 'dotnet restore' to verify all NuGet packages resolve correctly against .NET 8.0. WARNING: Do NOT change <LangVersion> unless it is set to a value incompatible with .NET 8 (e.g., '10.0' should become '12.0' or 'latest'). Do NOT modify any PackageReference versions in this task — those are handled by later tasks.",
    "phase": "Phase 2: Project File & Manifest Updates",
    "riskLevel": "low",
    "estimatedTime": "10 min",
    "autoFixable": true,
    "steps": [
      "Open MyApp/MyApp.csproj and locate the <TargetFramework> element (currently net7.0)",
      "Change <TargetFramework>net7.0</TargetFramework> to <TargetFramework>net8.0</TargetFramework>",
      "If <LangVersion> is present and set to a specific version < 12.0, update it to 'latest' or '12.0'",
      "If global.json exists in the repo root, update the SDK version to 8.0.x",
      "Run 'dotnet restore' and verify it completes without errors",
      "Run 'dotnet build' and capture any new warnings (these indicate APIs deprecated in .NET 8)"
    ],
    "verificationCriteria": [
      "grep -c 'net8.0' MyApp/MyApp.csproj returns 1",
      "grep -c 'net7.0' MyApp/MyApp.csproj returns 0",
      "'dotnet restore' exits with code 0 and no error output",
      "'dotnet build' exits with code 0 (warnings are acceptable at this stage)"
    ],
    "affectedFiles": [
      "MyApp/MyApp.csproj",
      "global.json"
    ],
    "codeExample": {
      "before": "<TargetFramework>net7.0</TargetFramework>",
      "after": "<TargetFramework>net8.0</TargetFramework>"
    },
    "status": "pending"
  },
  {
    "id": "TASK-002",
    "title": "Replace Bootstrap 4 data attributes with Bootstrap 5 equivalents in all view files",
    "description": "Bootstrap 4 → 5 migration requires renaming ALL data attributes. Bootstrap 5 namespaces its data attributes with a 'bs-' prefix to avoid conflicts with other frameworks. EVERY occurrence of these attributes must be changed across ALL .cshtml, .html, and .razor files: data-toggle→data-bs-toggle, data-dismiss→data-bs-dismiss, data-target→data-bs-target, data-parent→data-bs-parent, data-ride→data-bs-ride, data-slide→data-bs-slide, data-slide-to→data-bs-slide-to, data-spy→data-bs-spy, data-offset→data-bs-offset. In Views/Shared/_Layout.cshtml there are 5 occurrences (lines 45, 67, 89, 112, 134). In Views/Home/Index.cshtml there are 3 occurrences (lines 23, 45, 78). IMPORTANT: Do NOT change data-val, data-val-*, data-valmsg-* attributes — those belong to jQuery Validation Unobtrusive and are NOT Bootstrap attributes. Do NOT change data-bind attributes (Knockout.js). Do NOT change data-role attributes (Kendo UI).",
    "phase": "Phase 4: Frontend / UI Framework Migration",
    "riskLevel": "medium",
    "estimatedTime": "30 min",
    "autoFixable": true,
    "steps": [
      "Search ALL .cshtml/.html/.razor files for 'data-toggle=' and replace with 'data-bs-toggle='",
      "Search ALL .cshtml/.html/.razor files for 'data-dismiss=' and replace with 'data-bs-dismiss='",
      "Search ALL .cshtml/.html/.razor files for 'data-target=' (NOT data-val-target) and replace with 'data-bs-target='",
      "Search for 'data-parent=', 'data-ride=', 'data-slide=', 'data-slide-to=', 'data-spy=', 'data-offset=' and add 'bs-' prefix",
      "Verify that data-val, data-val-*, data-valmsg-*, data-bind, data-role attributes are UNTOUCHED",
      "Verify that Bootstrap components (modals, tooltips, dropdowns, carousels) still render correctly"
    ],
    "verificationCriteria": [
      "grep -r 'data-toggle=' Views/ returns 0 matches",
      "grep -r 'data-dismiss=' Views/ returns 0 matches",
      "grep -r 'data-bs-toggle=' Views/ returns the expected number of matches",
      "grep -r 'data-val=' Views/ returns the same count as before (unchanged)",
      "Build succeeds and pages render without JavaScript errors"
    ],
    "affectedFiles": [
      "Views/Shared/_Layout.cshtml",
      "Views/Home/Index.cshtml"
    ],
    "codeExample": {
      "before": "<button class=\\"btn btn-primary\\" data-toggle=\\"modal\\" data-target=\\"#myModal\\">Open</button>",
      "after": "<button class=\\"btn btn-primary\\" data-bs-toggle=\\"modal\\" data-bs-target=\\"#myModal\\">Open</button>"
    },
    "status": "pending"
  }
]
\`\`\`

---

## 🎯 Task Generation Strategy

### 1. **Do NOT generate tasks for**
- Backup branch creation, rollback branch creation, or deploy branch creation. We are not doing those.
- **Downloading or replacing vendor/library files** — this is handled AUTOMATICALLY by the platform's deterministic pipeline BEFORE task generation. The download results are shown above. Do NOT generate tasks like "Download jQuery 4.0.0" or "Replace vendor library files".
- Multiple documentation tasks (see Phase 8: one only, crisp and to the point).

### 2. **Generate Structural Migration Tasks (for major version jumps)**
If the upgrade spans MULTIPLE major versions, generate tasks for structural changes:
- **Entry point merging**: e.g., "Merge Startup.cs service registrations and middleware pipeline into Program.cs (top-level minimal hosting)" for .NET 6+
- **New file creation**: e.g., "Create appsettings.json with configuration migrated from web.config" or "Create GlobalUsings.cs with implicit usings"
- **Obsolete file cleanup**: e.g., "Remove Global.asax and BundleConfig.cs (replaced by Program.cs and LibMan)"
- **Namespace migration**: e.g., "Replace all javax.* imports with jakarta.* across all Java files"
- **Config format conversion**: e.g., "Migrate web.config AppSettings to appsettings.json format"
- **Project file modernization**: e.g., "Convert old-style .csproj to SDK-style format"
These tasks should come AFTER manifest updates but BEFORE code-level breaking change fixes.

### 2.5. **Analyze Breaking Changes**
For each breaking change from the plan:
- Create a dedicated task
- Include exact file/line references from provided code
- Show before/after code
- Estimate based on complexity

### 3. **Generate Frontend Migration Tasks**
If frontend libraries are being upgraded:
- Create tasks for updating ALL client-side library manifests — every entry must be updated to the target version
- **CRITICAL: Create a dedicated task for verifying client-side manifest dist vs source:**
  - Verify EVERY library entry has an explicit "files" array with ONLY compiled dist assets (.min.css, .min.js)
  - Verify the provider ships compiled dist (not source/SCSS) — switch to cdnjs/jsdelivr if needed
  - Verify the "files" array paths are valid for the TARGET version (dist paths change between major versions)
  - Verify layout/view file paths match what the manifest restores
  - This single task is CRITICAL — getting it wrong means the entire UI will be unstyled/broken
- Create tasks for each template/view file needing CSS class / data attribute changes — be explicit about which classes change to what, based on the specific framework's migration guide
- Create tasks for updating CDN links and asset references — and removing duplicate loads when a package manager already provides the library
- Create tasks for updating JavaScript plugin initialization patterns
- Create tasks for replacing Unicode emoji with proper icon markup if an icon library is being added
- Create tasks for verifying no duplicate library sources exist (package manager + CDN for same lib)
- Create tasks for verifying that all library assets load correctly (no 404s for .min.css or .min.js files)

### 3.5. **Generate Functionality Verification Tasks**
Always generate tasks to verify upgraded code preserves original behavior:
- Task: verify all forms render correctly (styling, labels, inputs, buttons)
- Task: verify interactive UI elements work (modals, tooltips, date-pickers, dropdowns, etc.)
- Task: verify no duplicate startup/initialization calls in entry point code
- Task: verify no duplicate library loads in layout files
- Task: verify API endpoints return correct responses
- Task: verify database operations work correctly
- Task: verify CSS styling matches original appearance
- Task: verify client-side assets load properly (no unstyled pages due to missing CSS/JS files)

### 4. **Order by Dependency**
Tasks should be ordered so:
- Manifest updates before code changes
- Core framework changes before app code
- Backend before frontend (or in parallel where safe)
- Infrastructure before application
- Testing after all code changes
- One documentation task last (crisp upgrade summary only)

### 5. **Risk-Based Prioritization**
Within each phase:
- High-risk tasks first (fail fast)
- Then medium-risk
- Then low-risk

### 6. **Realistic Effort Estimation**

**Time Estimates:**
- **15 min**: Trivial changes (manifest updates, simple text replacements)
- **30 min**: Simple code changes (single method replacement, config update)
- **1 hr**: Moderate changes (refactor small component, update several imports)
- **2 hr**: Complex changes (refactor large component, handle edge cases)
- **4 hr**: Very complex (architectural changes, extensive testing)

**If >4 hours**, break into multiple tasks!

### 7. **Include Context**
Each task should reference:
- Why this change is needed (which upgrade caused it)
- What breaks if not done
- Related tasks (dependencies)

### 8. **Exactly one documentation task**
- Generate exactly ONE documentation task: a short, crisp upgrade summary (what was upgraded; any env/SDK/runtime prerequisites). Do NOT generate separate tasks for README, CHANGELOG, API docs, rollback docs, or developer onboarding. One concise document or section only.
- Include cleanup in code tasks or one cleanup task (deprecated code, dead imports, unused packages).

---

## ⚠️ Critical Instructions

1. **REFERENCE ACTUAL CODE**: Use the provided files to find real line numbers and code snippets. EVERY task must cite specific file paths and patterns found in the code.
2. **BE HYPER-SPECIFIC**: "In Views/Shared/_Layout.cshtml, search for data-toggle=\\"modal\\" on line 45 and replace with data-bs-toggle=\\"modal\\"" — NOT "fix framework issue". The executing agent sees only ONE task at a time with its files. It does NOT have the full plan. Give it everything it needs.
3. **Use exact target versions**: Every task must reference the user's selected target versions from "Selected Upgrades" above. Do not substitute your own version numbers.
4. **REALISTIC ESTIMATES**: Add 50% buffer to your initial estimate (developers always underestimate)
5. **CLEAR VERIFICATION**: Specify exact commands to run, exact patterns that should/should not exist, not vague "make sure it works"
6. **ONE TASK, ONE CONCERN**: Don't combine unrelated changes
7. **ASSUME ZERO CONTEXT**: The executing agent will ONLY see the task description, steps, and affected files — it does NOT see this plan or the other tasks. Write descriptions as if they are standalone instructions. Include ALL necessary context in the description itself: which library migration causes this, what the old API was, what the new API is, and exactly what patterns to search for.
8. **COVER ALL FILE TYPES**: Generate tasks for backend code, frontend templates/views, stylesheets, library manifests, and configuration files. If the user's selections include frontend libraries, you MUST generate tasks for upgrading template/view files and library manifests.
9. **EXACTLY ONE DOCUMENTATION TASK**: Generate exactly one task for a short, crisp upgrade summary (what was upgraded; env/SDK/runtime prereqs). Do NOT generate separate README, CHANGELOG, API, or rollback doc tasks.
10. **DO NOT generate tasks for**: Backup branch creation, rollback branch creation, deploy branch creation, or multiple documentation tasks.
11. **INCLUDE CLEANUP TASKS**: Generate tasks for removing deprecated code, dead imports, unused packages, and leftover config from the old version
12. **INCLUDE FUNCTIONALITY VERIFICATION TASKS**: Generate tasks to verify forms, UI elements, navigation, API endpoints, database operations, and client-side asset loading all work correctly after the upgrade. Verify no duplicate library loads, no duplicate startup calls, and CSS styling matches the original.
13. **INCLUDE ASSET VERIFICATION**: If the project uses a client-side package manager, generate a task to verify it restores compiled dist assets (not source), and that all asset paths in layout/view files resolve correctly.
14. **RETURN ONLY JSON**: No markdown wrapper, no explanations, no prose — ONLY the raw JSON array starting with [ and ending with ]. Every object MUST have a non-empty "title" field (5-15 words) and a non-empty "description" field (5-12 sentences). An empty title causes a blank row in the UI — this is a CRITICAL BUG that must never happen.

### DESCRIPTION QUALITY STANDARD (CRITICAL — tasks with vague descriptions will fail)

Each task's "description" field is the PRIMARY instruction the executing agent receives. It MUST contain:

**A) MIGRATION CONTEXT**: "Bootstrap 4→5 renamed data attributes. Every data-toggle, data-dismiss, data-target, data-parent, data-ride, data-slide, data-slide-to, data-spy, data-offset must get a bs- prefix."

**B) FILE-SPECIFIC ANALYSIS**: "In Views/Shared/_Layout.cshtml (line 78-95), there are 3 occurrences of data-toggle and 2 of data-dismiss. In Views/Home/Index.cshtml (line 120), there is 1 occurrence of data-target."

**C) EXACT TRANSFORMATION RULES**: "Pattern: data-toggle=\\"{value}\\" → data-bs-toggle=\\"{value}\\". Pattern: data-dismiss=\\"{value}\\" → data-bs-dismiss=\\"{value}\\". Pattern: data-target=\\"{selector}\\" → data-bs-target=\\"{selector}\\"."

**D) WHAT NOT TO CHANGE**: "Do NOT modify data-val, data-valmsg, or data-val-* attributes — those are jQuery Validation Unobtrusive, not Bootstrap. Do NOT modify attributes inside @Html.Raw() blocks that generate Kendo UI markup."

**E) DEPENDENCY ON OTHER TASKS**: "This task depends on TASK-003 (manifest update) completing first, because the new Bootstrap 5 JS bundle must be in place before the data attributes will work."

**SELECTION COMPLETENESS CHECK (DO THIS BEFORE RETURNING):**
Before returning, verify that EVERY package from "Selected Upgrades" above has at least one task that addresses it:
${selections.map(s => `- [ ] ${s.package}: ${s.currentVersion} → ${s.selectedVersion} — Is there a task that updates this package's version in manifests, CDN refs, config files, or code?`).join("\n")}
If ANY checkbox above would be unchecked, ADD a task for it. Missing a user-requested upgrade is a critical failure.

**FINAL CHECKLIST before you start writing:**
1. How many tasks will I generate? (Plan this FIRST)
2. Does my plan cover EVERY package from "Selected Upgrades"?
3. Will all my tasks fit in ${outputTokenBudget} tokens? (Each task ≈ 1500-2000 tokens)
4. If not, which tasks can I combine or make more concise?

**VERSION REFERENCE TABLE — copy-paste these exact strings into your task titles and descriptions:**
| Package | Current Version (use for "from") | Target Version (use for "to") |
|---------|----------------------------------|-------------------------------|
${selections.map(s => `| ${s.package} | ${s.currentVersion ?? "unknown"} | ${s.selectedVersion} |`).join("\n")}

**DO NOT invent version numbers.** If a task title says "Upgrade X from A to B", then A MUST come from the "Current Version" column and B MUST come from the "Target Version" column above. Any other version number is WRONG.

**Now generate your tasks.** Cover: manifests, structural changes, breaking changes, frontend migration, config, functionality verification, testing, and one documentation task. Order: manifests → structural → code → frontend → testing → docs. Do NOT include backup/deploy/rollback tasks.

**REMEMBER: Your JSON MUST start with [ and end with ]. Begin now.**`;
}