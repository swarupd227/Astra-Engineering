/**
 * Code Upgrade Prompts
 * All prompts for the code generation / upgrade pipeline:
 *   - Upgrade plan generation
 *   - File triage (classify MUST_CHANGE / MAYBE_CHANGE / NO_CHANGE)
 *   - Single-file upgrade
 *   - Multi-file upgrade
 *
 * getMigrationReference() returns DYNAMIC guidance for ANY tech stack:
 *   - Few-shot examples (before/after) illustrating the PATTERN of changes
 *   - Generic instructions the LLM must follow for the specific version jump
 *   - NO hardcoded rules — the LLM uses its own knowledge to apply changes exhaustively
 *
 * buildFileSummaryInstruction() adds deep-analysis context so the LLM
 * understands each file's purpose, exports, dependencies, and functions
 * BEFORE generating tasks or code.
 */

import type { VersionSelection } from "../types";
import { DEFAULT_MODEL_ID, MODEL_FILE_CONTENT_BUDGET_MAP } from "../../llm-config-constants";
import type { UpgradeImpactReport } from "../services/pre-upgrade-impact-analyzer";

// ─── Impact report & preservation rules (P5) ───────────────────────

/**
 * Build the RULE #1 block for import/export preservation.
 * Injected at the very top of every upgrade prompt.
 */
export function buildImportPreservationRule(): string {
  return `## Import and export preservation
Preserve all import/using/require statements and public type names from the original file.

Example:
  Original: using OrderFlowService;
  Correct:  using OrderFlowService;  (keep the same name)

This applies to all languages:
- C# using statements, @using Razor directives, @model directives, @inject directives
- Java import statements, package declarations
- JavaScript/TypeScript import, require(), export statements
- Python import, from X import Y statements
- Go import blocks
- HTML script src, link href references
- Razor Html.Partial(), Html.RenderPartialAsync(), Component.InvokeAsync() references

Guidelines:
- Every import/using/require statement in the original must appear in your output with the same source path/module name.
- Every public class, interface, function, or type name must keep its exact name.
- @model and @inject directives must keep the exact same type/interface name.
- Do not rename functions, classes, or interfaces from Models/ or shared folders.
- Exception: migration-required renames from official guides (e.g., javax.* to jakarta.* for Spring Boot 3).
- When in doubt about a rename, keep the original name.
`;
}

/**
 * Build the functional preservation rules block.
 * Ensures event handlers, navigation, and interactive behavior are preserved.
 */
export function buildFunctionalPreservationRules(): string {
  return `## Functional preservation
Preserve all interactive behavior during the upgrade:
- Keep onclick handlers, addEventListener calls, and jQuery event bindings (.on(), .click(), .submit()) intact.
- Keep window.location, form.submit(), AJAX calls, and fetch() URLs unchanged.
- Keep routing logic, page redirections, and navigation behavior unchanged.
- Keep interactive UI elements (tabs, modals, accordions, carousels, datepickers) intact.
- Keep form validation logic unchanged.
- If upgrading Bootstrap: data-toggle becomes data-bs-toggle, but the behavior must remain identical.
- If upgrading jQuery: .bind() becomes .on(), but event types and handlers must be preserved.
- Dynamic content loading logic must be preserved.
- Calculators, converters, and interactive widgets must produce identical results after upgrade.
`;
}

/**
 * Format impact report for injection into a specific file's upgrade prompt.
 * Note: callers should use formatImpactReportForFile from pre-upgrade-impact-analyzer directly.
 */
export function buildImpactReportSection(
  impactReport: UpgradeImpactReport | undefined,
  filePath: string,
  formatFn?: (report: UpgradeImpactReport, path: string) => string,
): string {
  if (!impactReport || !formatFn) return "";

  const fileReport = formatFn(impactReport, filePath);

  if (!fileReport) return "";
  return `\n${fileReport}\n`;
}

// ─── Stack detection helpers ────────────────────────────────────────

function isDotNetStack(selections: VersionSelection[]): boolean {
  return selections.some(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg.includes(".net") || pkg.includes("dotnet") || pkg.includes("aspnet") ||
           pkg.includes("asp.net") || pkg.includes("netcore") || pkg.includes("microsoft.") ||
           pkg.includes("entityframework") || pkg.includes("system.");
  });
}

function isJavaStack(selections: VersionSelection[]): boolean {
  return selections.some(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg.includes("java") || pkg.includes("jdk") || pkg.includes("spring") ||
           pkg.includes("maven") || pkg.includes("gradle") || pkg.includes("javax") ||
           pkg.includes("jakarta") || pkg.includes("hibernate") || pkg.includes("quarkus") ||
           pkg.includes("micronaut");
  });
}

function isPythonStack(selections: VersionSelection[]): boolean {
  return selections.some(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg.includes("python") || pkg.includes("django") || pkg.includes("flask") ||
           pkg.includes("fastapi") || pkg.includes("celery") || pkg.includes("sqlalchemy");
  });
}

function isGoStack(selections: VersionSelection[]): boolean {
  return selections.some(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg === "go" || pkg.includes("golang");
  });
}

function isRubyStack(selections: VersionSelection[]): boolean {
  return selections.some(s => {
    const pkg = (s.package || "").toLowerCase();
    return pkg.includes("ruby") || pkg.includes("rails") || pkg.includes("sinatra") ||
           pkg.includes("rack");
  });
}

function hasFrontendPackages(selections: VersionSelection[]): boolean {
  const keywords = [
    "bootstrap", "twitter-bootstrap", "jquery", "react", "vue", "angular",
    "svelte", "tailwind", "bulma", "foundation", "material",
    "fontawesome", "font-awesome", "popper", "datepicker", "select2",
    "datatables", "chart", "d3", "slick", "swiper", "fullcalendar",
    "summernote", "tinymce", "toastr", "moment", "dayjs", "lodash",
    "libman", "bower", "jspm",
  ];
  return selections.some(s => {
    const pkg = (s.package || "").toLowerCase();
    const cat = (s.category || "").toLowerCase();
    return cat.includes("frontend") || cat.includes("ui") || cat.includes("css") ||
           cat.includes("client") || cat.includes("style") ||
           keywords.some(k => pkg.includes(k));
  });
}

function hasDbPackages(selections: VersionSelection[]): boolean {
  const keywords = [
    "entityframework", "entity-framework", "efcore", "dapper", "nhibernate",
    "sequelize", "typeorm", "prisma", "knex",
    "sqlalchemy", "alembic", "peewee",
    "hibernate", "jpa", "mybatis", "flyway", "liquibase",
    "activerecord", "sequel", "mongoid",
    "gorm", "ent", "sqlx",
  ];
  return selections.some(s => {
    const pkg = (s.package || "").toLowerCase();
    return keywords.some(k => pkg.includes(k));
  });
}

// ─── Migration guidance builder ─────────────────────────────────────
// Fully generic — no tech-stack-specific functions or if/else dispatch.
// Generates dynamic guidance for ANY package being upgraded.

/**
 * Build migration guidance for ALL user-selected packages.
 * Every package gets the SAME generic template — no special-casing.
 * The LLM applies its own expert knowledge of the specific library/framework.
 */
export function getMigrationReference(
  selections: VersionSelection[],
  migrationDocs?: Record<string, { found: boolean; source: string; removedAPIs: string[]; deprecatedAPIs: string[]; behaviorChanges: string[] }>,
): string {
  if (!selections.length) return "";

  const blocks: string[] = selections.map(s => {
    const pkg = s.package || "unknown";
    const from = s.currentVersion || "unknown";
    const to = s.selectedVersion || "unknown";

    // If we have fetched official docs for this package, inject them directly
    const doc = migrationDocs?.[pkg];
    let officialDocsSection = "";
    if (doc?.found) {
      const parts: string[] = [];
      if (doc.removedAPIs.length > 0) {
        parts.push(`**REMOVED APIs (from official docs — MUST be replaced):**\n${doc.removedAPIs.map(a => `- ${a}`).join("\n")}`);
      }
      if (doc.deprecatedAPIs.length > 0) {
        parts.push(`**DEPRECATED APIs (from official docs — should be updated):**\n${doc.deprecatedAPIs.map(a => `- ${a}`).join("\n")}`);
      }
      if (doc.behaviorChanges.length > 0) {
        parts.push(`**BEHAVIOR CHANGES (from official docs — verify and adapt):**\n${doc.behaviorChanges.map(c => `- ${c}`).join("\n")}`);
      }
      if (parts.length > 0) {
        officialDocsSection = `\n\n**OFFICIAL MIGRATION DOCUMENTATION (source: ${doc.source}) — use as PRIMARY reference:**\n${parts.join("\n\n")}`;
      }
    }

    return `### ${pkg}: ${from} → ${to}

You are upgrading **${pkg}** from **${from}** to **${to}**.
Use your deep expertise in ${pkg}'s official changelog, release notes, and migration guide for this version jump.${officialDocsSection}

**IMPORTANT:** Version ${to} of ${pkg} is a REAL, released version. Do NOT claim it does not exist. Use it EXACTLY as specified.

**WHAT YOU MUST DO — apply your knowledge EXHAUSTIVELY:**
1. **Version references**: Update ALL version numbers for ${pkg} in every manifest, config, lock file, CDN link, and asset reference from ${from} to ${to}.
2. **Deprecated/removed APIs**: Identify and replace ALL APIs, methods, classes, functions, directives, or patterns that were deprecated or removed between ${from} and ${to} with their modern equivalents.
3. **Breaking changes**: Fix ALL breaking changes introduced in ${to} — changed signatures, renamed modules, new required config, restructured APIs, etc.
4. **Configuration & initialization**: Update all configuration patterns, initialization code, and plugin/middleware registration that changed between versions.
5. **Template/markup changes**: If ${pkg} affects HTML, CSS, or template files (classes, data attributes, component markup, CDN refs), scan EVERY line of EVERY affected file and replace ALL deprecated patterns.
6. **Import/module path changes**: Update all import, require, using, or include statements if module paths or package names changed.
7. **Client-side asset distribution**: If ${pkg} is managed by a client-side package manager (LibMan, Bower, jspm, etc.), the manifest MUST restore COMPILED dist assets (.min.css, .min.js, .bundle.min.js), NOT source files (SCSS, uncompiled JS/TS, raw source). You MUST specify explicit file paths in the files/resources array. See the CLIENT-SIDE MANIFEST RULES section below.

Scan EVERY file line-by-line — do NOT leave any deprecated pattern from ${from} behind.`;
  });

  // ─── Universal rules (always injected) ─────────────────────────────
  blocks.push(`### Universal rules for all upgrades

Minimal-touch principle:
Touch only lines that must change for the upgrade. Keep everything else as-is.

- Do not rename, move, or repath file imports, script references, or asset paths unless the upgrade requires it.
- Do not change script src, link href, require(), import, using, or include paths that already work.
- Do not refactor or reorganize code that is not broken by the upgrade.
- Do not change variable, function, class, or file names unless the migration guide requires it.
- Do not remove or replace working library references (e.g., do not swap jQuery for vanilla JS).
- Do not change connection strings, configuration values, hostnames, ports, or credentials.
- Do not rewrite HTML structure, CSS class usage, or JS patterns that are not deprecated in the target version.
- When in doubt, keep the original code.

Path and reference preservation:
- If a manifest specifies a destination or install path that layout/view files reference, the paths must match after upgrade.
- When upgrading a library version, check if dist filenames changed. If unchanged, keep the same references.
- If filenames changed in the new version, update both the manifest entry and every script/link/import reference in sync.
- For LibMan/Bower: resolved path = destination + file path from files array. Layout must reference that path.
  Example: destination="wwwroot/lib/jquery/", files=["dist/jquery.min.js"] -> layout uses ~/lib/jquery/dist/jquery.min.js

Library substitution rules:
- Do not replace a library with a different library that has an incompatible API unless you are upgrading all consuming files.
  - Example: Do not replace bootstrap-datepicker with vanillajs-datepicker unless you also rewrite every .datepicker() call.
  - Example: Do not replace moment with dayjs unless all moment() calls are rewritten.
- When upgrading a library's major version, keep the same library and update its version.
- If installing a replacement (original truly discontinued), note it in a comment at the top of the file.

No duplicates:
- Produce only one startup/initialization call per entry point.
- Register each service/module exactly once.
- Do not load the same library from both a package manager and a CDN.

Completeness:
- Replace every deprecated pattern, not just the first few occurrences.
- Scan the entire file line-by-line.
- A leftover deprecated class, attribute, or API call means the upgrade is incomplete.`);

  // ─── Client-side library manifest rules (frontend upgrades only) ──
  if (hasFrontendPackages(selections)) {
    blocks.push(`### Client-side library manifest rules

Client-side package managers (LibMan, Bower, jspm, etc.) can restore either the full source tree or specific compiled files. Omitting the files list pulls source code (SCSS, raw JS) the browser cannot load, resulting in a broken UI.

Rules:
1. Always specify a "files" array listing only compiled dist assets:
   - CSS: the .min.css file (e.g., "dist/css/LIBRARY.min.css")
   - JS: the .min.js and/or .bundle.min.js (e.g., "dist/js/LIBRARY.bundle.min.js")
   - Fonts/Icons: the webfont files or CSS (e.g., "css/all.min.css", "webfonts/*")
2. Do not omit the files array; it would restore the entire package including source files and raw SCSS.
3. Use a provider/package that ships compiled dist (cdnjs, jsdelivr, or "dist" package variants).
4. Verify file paths match the target version; dist directory structure may change between major versions.
5. Ensure layout/view files reference paths that match what the manifest restores locally.
6. Source each library from exactly one location (package manager or CDN, not both).
- Specify both destination and files explicitly. Example:
  \`\`\`json
  { "library": "jquery@3.7.1", "destination": "wwwroot/lib/jquery/", "files": ["dist/jquery.min.js"] }
  \`\`\`

Example (correct vs incorrect):

Incorrect (restores SCSS source):
\`\`\`json
{
  "library": "twitter-bootstrap@5.3.2",
  "provider": "unpkg",
  "destination": "wwwroot/lib/bootstrap/"
}
\`\`\`
(No files array downloads the entire package including /scss/, /src/, package.json.)

Correct (only compiled dist):
\`\`\`json
{
  "library": "twitter-bootstrap@5.3.2",
  "provider": "cdnjs",
  "destination": "wwwroot/lib/bootstrap/",
  "files": [
    "css/bootstrap.min.css",
    "js/bootstrap.bundle.min.js"
  ]
}
\`\`\``);
  }

  // ─── Database & data access rules (DB packages only) ──────────────
  if (hasDbPackages(selections)) {
    blocks.push(`### Database and data access rules

- Connection strings: update syntax if it changed between versions, but do not alter host/database/credentials.
- ORM/migration files: update API patterns but preserve the migration history and schema definitions.
- DbContext/Repository files: update base class patterns and fluent API calls per the target migration guide, but preserve entity configurations and relationships.
- Seed data files: preserve all data, only update framework patterns.`);
  }

  // ─── Structural migration rules (major version jumps) ─────────────
  // Instruct the LLM to handle file-level structural changes when merging
  // or refactoring entry points, config files, etc. during major version jumps.
  blocks.push(`### STRUCTURAL MIGRATION — MAJOR VERSION JUMPS

When upgrading across MULTIPLE major versions, the project structure itself often changes. Apply these structural transformations where applicable:

**Entry point consolidation:**
- If the target framework uses a unified entry point (e.g., .NET 6+ uses top-level Program.cs instead of Startup.cs + Program.cs), MERGE the configuration from the old entry point into the new one. Do NOT leave two separate entry points.
- For Spring Boot 3+: ensure the main application class uses the current @SpringBootApplication annotation pattern.
- For Django 4+: ensure settings.py has DEFAULT_AUTO_FIELD, MIDDLEWARE (not MIDDLEWARE_CLASSES), and modern URL routing (path() not url()).
- For Rails 6+: ensure Zeitwerk autoloader mode, credentials.yml.enc instead of secrets.yml.

**Configuration format migration:**
- If the framework moved from one config format to another (e.g., XML-based .config → JSON-based appsettings.json, or properties → YAML), migrate the configuration values.
- Preserve ALL existing config values (connection strings, app settings, feature flags) — only change the FORMAT and any keys that were renamed.

**Namespace and import migrations:**
- javax.* → jakarta.* for Java EE → Jakarta EE / Spring Boot 3+
- Python 2 → 3 style imports and syntax changes
- Old-style Go imports (e.g., io/ioutil) → modern equivalents

**Project file format upgrades:**
- Old-style verbose .csproj → SDK-style .csproj for .NET Core/.NET 5+
- Maven → Gradle migration hints if the project is moving between build tools
- setup.py → pyproject.toml for modern Python

**When merging files (e.g., Startup.cs into Program.cs):**
1. Extract ALL service registrations (AddScoped, AddTransient, AddSingleton, etc.) from the old file
2. Extract ALL middleware pipeline configuration (UseRouting, UseAuthentication, etc.)
3. Extract ALL configuration setup (AddSession, AddDistributedMemoryCache, etc.)
4. Place them in the correct order in the new unified entry point
5. Do NOT duplicate any registration or middleware call
6. Remove the old file reference from the project (it will be flagged as obsolete)`);

  // ─── .NET-specific rules ──────────────────────────────────────────
  if (isDotNetStack(selections)) {
    blocks.push(`### .NET UPGRADE RULES

- For .NET 6+ projects, many Microsoft.AspNetCore.* NuGet packages (Session, Http, Mvc, Routing, StaticFiles, etc.) are absorbed into the shared framework. REMOVE their PackageReference lines — do NOT try to upgrade them to a non-existent version.
- Startup.cs → Program.cs minimal hosting (for .NET 6+): merge Configure/ConfigureServices into top-level statements if applicable. This is a STRUCTURAL change — ALL service registrations, middleware pipeline, and configuration from Startup.cs must be consolidated into Program.cs.
- For .NET 6+: Create/update appsettings.json and appsettings.Development.json if they don't exist
- For .NET 6+: Add GlobalUsings.cs with implicit usings if not present
- For .NET 6+: Add _ViewImports.cshtml and _ViewStart.cshtml if they don't exist in a Razor/MVC project
- Old-style .csproj (verbose XML with explicit file includes) should be converted to SDK-style .csproj
- BundleConfig.cs (System.Web.Optimization) is obsolete in .NET Core — flag for removal, use LibMan/npm instead
- Global.asax is obsolete in .NET Core/.NET 5+ — all startup logic moves to Program.cs
- Entity Framework Core: OnModelCreating signature and fluent API may change between major versions
- Nullable reference types: enable if the target version encourages it
- Global usings and file-scoped namespaces are available in C# 10+ (.NET 6+)

**SERVICE REGISTRATION (Program.cs / Startup.cs) — MANDATORY DISCOVERY FIRST:**
Before adding or changing any service registrations (AddScoped, AddTransient, AddSingleton, etc.):

1. **DISCOVERY**: Scan the project for ALL existing service interfaces and implementations (e.g. Services/, BLL/, Application/, or equivalent folders). List every interface and its implementation class. Map constructor parameters of each implementation to their dependencies. Do NOT assume naming conventions (e.g. do not assume ICurrencyService/CurrencyService or IOrderService/OrderService exist). The project may use a single combined service, different names, or a different structure — you MUST discover what actually exists in the codebase.

2. **VERIFICATION**: Before editing Program.cs/Startup.cs, verify that every type you plan to register actually exists in the project. For each implementation, check its constructor: every constructor parameter must be a type that is also registered (or a framework type). Trace the full dependency chain. If a service depends on IAccountRepository, ICurrencyRepository, etc., those must be registered too. Confirm exact type names (namespaces and class names) by scanning the codebase — do not guess.

3. **REGISTRATION**: Register ONLY types that exist in the codebase. Include ALL transitive dependencies. Follow the existing architectural pattern (e.g. one combined service vs multiple separate services). Do not introduce registrations for types that do not exist or use names you assumed.

4. **AFTER CHANGES**: The project must build successfully. If you get "type not found", "cannot resolve service for type", or similar errors, re-scan the codebase for the actual interface and implementation names and fix the registrations. Do not leave broken DI.`);
  }

  // ─── Java / Spring rules ──────────────────────────────────────────
  if (isJavaStack(selections)) {
    blocks.push(`### JAVA / SPRING UPGRADE RULES

- **Service/Bean registration**: Before changing @Configuration or component scanning, DISCOVER existing services — scan the codebase for actual @Service/@Component interfaces and implementations and their constructor dependencies. Do NOT assume naming conventions; only reference types that exist. Ensure all transitive dependencies are present.
- **javax.* → jakarta.* namespace migration** (Java EE → Jakarta EE, required for Spring Boot 3.x / Jakarta EE 9+): update ALL import statements, annotations, and XML namespace references. This is a STRUCTURAL change affecting every Java file in the project.
- **Spring Security**: deprecated \`WebSecurityConfigurerAdapter\` → use \`SecurityFilterChain\` @Bean configuration
- **Spring Boot 3.x**: requires Java 17+, update \`java.version\` property in pom.xml / build.gradle
- **application.properties / application.yml**: check for renamed keys between Spring Boot versions
- **@ConstructorBinding** is implicit in Spring Boot 3.x — remove if present
- **Actuator endpoints**: paths are prefixed with /actuator/ by default in newer versions
- **HttpSecurity** DSL: lambda-style configuration preferred in Spring Security 6+
- **module-info.java**: may need to be created or updated for Java 9+ module system
- **pom.xml / build.gradle**: update compiler source/target, plugin versions, and dependency management`);
  }

  // ─── Python / Django rules ────────────────────────────────────────
  if (isPythonStack(selections)) {
    blocks.push(`### PYTHON / DJANGO UPGRADE RULES

- **URL routing**: \`url()\` removed in Django 4.0 → use \`path()\` or \`re_path()\`
- **Middleware**: \`MIDDLEWARE_CLASSES\` replaced by \`MIDDLEWARE\` setting (Django 2.0+)
- **DEFAULT_AUTO_FIELD**: must be set explicitly in settings.py (Django 3.2+)
- **Text utils**: \`force_text\` / \`smart_text\` → \`force_str\` / \`smart_str\`
- **i18n**: \`ugettext\` / \`ugettext_lazy\` → \`gettext\` / \`gettext_lazy\`
- **Type hints**: prefer modern type annotations if upgrading to Python 3.10+
- **asyncio**: Django 4.1+ has async view support — update if converting sync views`);
  }

  // ─── Go rules ─────────────────────────────────────────────────────
  if (isGoStack(selections)) {
    blocks.push(`### GO UPGRADE RULES

- **go.mod**: update the \`go\` directive to the target Go version
- **Deprecated ioutil**: \`io/ioutil\` removed in Go 1.16 → use \`io\` and \`os\` equivalents (\`os.ReadFile\`, \`io.ReadAll\`, etc.)
- **Module paths**: if a major version bump, module path may need /v2, /v3, etc.
- **Error wrapping**: use \`fmt.Errorf("...: %w", err)\` for wrapped errors
- **Generics**: available in Go 1.18+ — adopt where it simplifies code
- **log/slog**: structured logging available in Go 1.21+`);
  }

  // ─── Ruby / Rails rules ───────────────────────────────────────────
  if (isRubyStack(selections)) {
    blocks.push(`### RUBY / RAILS UPGRADE RULES

- **Callbacks**: \`before_filter\` → \`before_action\` (Rails 5+)
- **ActiveRecord**: \`update_attributes\` → \`update\` (Rails 6+)
- **Autoloader**: classic autoloader → Zeitwerk mode (Rails 6+)
- **config.hosts**: host allowlisting required in Rails 6+
- **Rendering**: \`render :text\` removed → use \`render :plain\` or \`render :html\`
- **Credentials**: \`secrets.yml\` → \`credentials.yml.enc\` (Rails 5.2+). This is a STRUCTURAL change — create credentials file and remove secrets.yml.
- **ActiveStorage / ActionMailbox / ActionText**: new defaults in Rails 6+
- **Gemfile**: update Ruby version constraint and all gem versions
- **config/application.rb**: update Rails version and framework defaults`);
  }

  return `\n\n## MIGRATION GUIDANCE (dynamic — use your expertise to apply ALL equivalent changes)

The sections below describe each package being upgraded. For each one, use your deep knowledge of that package's changelog and migration guide to apply ALL necessary changes EXHAUSTIVELY. Do NOT limit yourself to only the patterns described below — these are reminders of WHAT to look for, but you must apply your FULL knowledge of the ${selections.length > 1 ? "libraries/frameworks" : "library/framework"} being upgraded.

${blocks.join("\n\n")}`;
}

// ─── Resolve target framework version from selections ───────────────
// Generic: extracts the primary runtime/framework target version string
// from user selections. Used to populate config templates (e.g., TFM in
// project config files like build manifests, runtime config, etc.).

export function resolveTargetFrameworkVersion(selections: VersionSelection[]): string {
  // Look for the "main" framework/runtime selection (the one with the highest category weight)
  const runtimeKeywords = [
    "runtime", "sdk", "framework", "target", "platform", "engine",
    ".net", "dotnet", "netcore", "asp.net", "aspnet", "node", "python",
    "java", "jdk", "ruby", "go", "rust", "php",
  ];
  for (const s of selections) {
    const pkg = (s.package || "").toLowerCase();
    if (!runtimeKeywords.some(k => pkg.includes(k))) continue;
    const ver = (s.selectedVersion || "").replace(/^v/i, "").trim();
    if (ver) return ver;
  }
  // Fallback: return the first selection's target version
  if (selections.length > 0) {
    return (selections[0].selectedVersion || "").replace(/^v/i, "").trim();
  }
  return "";
}

/** @deprecated Use resolveTargetFrameworkVersion instead */
export const resolveTargetDotnetTfm = resolveTargetFrameworkVersion;

// ─── Deep file analysis instruction ─────────────────────────────────
/**
 * Returns an instruction block that tells the LLM to deeply analyze each code
 * file BEFORE generating tasks or code. The analysis covers purpose, exports,
 * functions, dependencies, input/output types, and inter-file relationships.
 * 
 * This should be prepended to task planner prompts and code upgrade plan prompts
 * so the LLM doesn't generate superficial or incomplete output.
 */
export function buildFileAnalysisInstruction(): string {
  return `
## MANDATORY PRE-ANALYSIS — DO THIS BEFORE GENERATING ANY OUTPUT

Before generating tasks, plans, or upgraded code, you MUST deeply analyze every code file provided. For EACH file, mentally build a summary covering:

1. **File Purpose**: What is this file for? (entry point, controller, model, view, config, manifest, utility, middleware, service, data access layer, etc.)
2. **Exports / Public API**: What classes, functions, interfaces, types, or variables does this file export or expose?
3. **Dependencies / Imports**: What other files, packages, or modules does this file import or depend on? Which of those are being upgraded?
4. **Functions & Methods**: What functions/methods exist? What do they do? What are their input parameter types and return types?
5. **Framework Usage**: What framework-specific patterns does this file use? (e.g., middleware registration, dependency injection, route definitions, template engine directives, CSS framework classes, JS plugin calls)
6. **Inter-file Relationships**: How does this file interact with other files in the project? Does it import from or export to other project files?
7. **Upgrade Impact**: Which parts of this file will be affected by the version upgrades? What specific patterns, APIs, classes, or attributes need to change?

This analysis is CRITICAL because:
- Without understanding what each file does, you will miss upgrade-relevant code paths
- Without knowing inter-file dependencies, you will break cross-file references
- Without understanding function signatures, you will produce code that doesn't compile
- Without understanding framework usage patterns, you will leave deprecated patterns behind

DO NOT skip this analysis. Use it to inform EVERY task and EVERY line of code you generate.
`;
}

// ─── Upgrade Plan prompts ──────────────────────────────────────────

export function buildUpgradePlanSystemPrompt(): string {
  const fileAnalysis = buildFileAnalysisInstruction();
  return `You are a Principal Software Engineer who creates military-grade upgrade plans.

Your expertise:
- 30+ years upgrading Fortune 500 production systems across every major tech stack
- Master of breaking change detection and resolution for any framework or language
- Expert in task-driven development

Your standards:
- Task-aware: If tasks are provided, your plan MUST address every single one
- File-specific: Name exact files and exact changes
- Framework-aware: Understand framework-specific migration patterns
- Priority-driven: Critical compilation fixes first, then optimizations
- Validation-focused: Specify how to verify each change
- Frontend + Backend: You MUST plan for BOTH backend code AND frontend/template/view files
- Library manifests: You MUST plan upgrades for ALL dependency and library manifest files in the project
${fileAnalysis}

Important:
- All user-specified target versions are valid and must be used exactly.
- The user-specified versions are your source of truth.
- This system handles upgrades for any tech stack to any version. Your plan should cover all aspects of the upgrade.

Your output:
- Detailed markdown plan
- Maps tasks to file changes
- Includes exact API changes, class/attribute renames, configuration changes, and reasoning
- Production-ready and actionable`;
}

export function buildUpgradePlanUserPrompt(
  state: any,
  selections: VersionSelection[],
  tasks: any[],
  codeFilesContext: string,
  codeFilesCount: number
): string {
  const tasksContext = tasks.length > 0
    ? `\n**SCHEDULED TASKS (${tasks.length} tasks):**\n${tasks.map((t: any, i: number) => `${i + 1}. [${t.id}] ${t.title}: ${t.description}`).join('\n')}`
    : '';

  const migRef = getMigrationReference(selections);

  return `**VERSION UPGRADES REQUIRED:**
${selections.map(s => `- ${s.package}: ${s.currentVersion || 'unknown'} → ${s.selectedVersion}`).join('\n')}
${tasksContext}
${migRef}

**PROJECT CONTEXT:**
- Project Type: ${state.repoProfile?.projectType || 'Unknown'}
- Languages: ${state.repoProfile?.languages?.join(', ') || 'Unknown'}
- Frameworks: ${state.repoProfile?.frameworks?.join(', ') || 'Unknown'}
- Total Files: ${state.extractedFiles?.length || 0}
- Code Files to Upgrade: ${codeFilesCount}

**FULL CODE FILES (COMPLETE CONTEXT):**
${codeFilesContext || 'No code files found'}

**YOUR CRITICAL TASK:**

${tasks.length > 0 ? `
YOU HAVE BEEN PROVIDED WITH ${tasks.length} SPECIFIC TASKS ABOVE.
**YOU MUST CREATE A PLAN THAT ADDRESSES EVERY SINGLE TASK.**

For each task:
1. Identify which files it affects
2. Specify the exact changes needed
3. Explain how the change addresses the task
4. Note any dependencies or prerequisites
` : ''}

Create a comprehensive upgrade plan that:

1. **Deeply Analyzes Every Code File**: You have the COMPLETE content of each file — analyze each file's purpose, exports, dependencies, functions, and framework usage BEFORE planning changes
2. **Maps Tasks to Files**: If tasks are provided, show exactly which files each task affects
3. **Identifies All Changes Needed**:
   - Import/package/module changes
   - API method signature changes
   - Annotation/decorator changes
   - Configuration and manifest changes
   - Breaking changes that MUST be fixed for compilation
   - Frontend/template changes (CSS classes, data attributes, CDN/asset versions, library manifest versions)
   - Client-side library asset distribution (ensure manifests restore compiled dist, not source)
4. **Prioritizes Execution**: Critical fixes first, then optimizations
5. **Considers Framework Specifics**: Apply your deep knowledge of the specific frameworks/libraries being upgraded

**OUTPUT FORMAT (MARKDOWN):**

# Comprehensive Upgrade Plan

## Executive Summary
[Brief overview of what's being upgraded and why]

${tasks.length > 0 ? `
## Task Execution Map
[For EACH task, list the files it affects and the specific changes]

### Task 1: [Task Title]
**Affected Files:**
- \`path/to/file1.ext\`: [Specific change]
- \`path/to/file2.ext\`: [Specific change]

**Changes Required:**
[Detailed breakdown of changes]
` : ''}

## File-by-File Modification Plan

### Critical Files (MUST modify for compilation)
[List with exact changes]

### Frontend / Template Files (MUST modify for UI framework migration)
[List every template/view/stylesheet and library manifest file with exact class/attribute/version changes. Verify dist vs source asset restoration for client-side package managers.]

### Supporting Files (Manifest, Config)
[List with exact changes]

### Optional Improvements (Deprecations)
[List with recommendations]

## Breaking Changes & Fixes
[Framework-specific breaking changes and how to fix them]

## Dependency Order
[What must be done before what]

## Validation Strategy
[How to verify each change works]

**BE EXTREMELY SPECIFIC**: Include file paths, line numbers if possible, exact API changes, exact CSS class renames, and complete reasoning.`;
}

// ─── Triage prompts ────────────────────────────────────────────────

export function buildTriageSystemPrompt(): string {
  return "You are a file triage expert for code upgrades. Respond with ONLY a JSON array. No markdown fences, no explanations.";
}

export function buildTriageUserPrompt(
  files: any[],
  selections: VersionSelection[],
  plan: string,
  manifest: string,
  importScopeBlock: string
): string {
  const planSummary = plan.length > 5000 ? plan.slice(0, 5000) + '\n...(truncated)' : plan;

  // Detect if any selection is a frontend/UI library. Matches the actual package
  // names developers use, not just generic category labels.
  const frontendPackagePatterns = [
    // CSS frameworks
    "bootstrap", "twitter-bootstrap", "tailwind", "bulma", "foundation",
    "material", "ant-design", "semantic-ui", "uikit", "primer",
    // JS frameworks / DOM libraries
    "jquery", "react", "vue", "angular", "svelte", "alpinejs", "htmx",
    "stimulus", "turbo", "hotwire",
    // UI component libraries
    "popper", "popperjs", "floating-ui",
    "datepicker", "timepicker", "flatpickr", "pikaday",
    "select2", "chosen", "tom-select",
    "datatables", "tabulator",
    "chart", "chartjs", "d3", "highcharts", "echarts",
    "leaflet", "mapbox",
    "slick", "swiper", "owl", "splide", "glide", "flickity",
    "lightbox", "fancybox", "magnific",
    "animate", "aos", "gsap",
    "sortable", "dragula", "muuri",
    "summernote", "tinymce", "ckeditor", "quill", "codemirror",
    "fullcalendar", "moment", "dayjs", "luxon", "date-fns",
    "lodash", "underscore",
    "toastr", "sweetalert", "noty", "notyf",
    "masonry", "isotope", "packery",
    "waypoint", "scrollmagic", "locomotive",
    // Icon libraries
    "fontawesome", "font-awesome", "feather", "heroicons", "lucide",
    "bootstrap-icons", "material-icons", "ionicons",
    // Validation
    "jquery-validate", "jquery-validation", "parsley", "yup", "zod",
  ];
  const hasFrontendUpgrade = selections.some(s => {
    const cat = (s.category || "").toLowerCase();
    const pkg = (s.package || "").toLowerCase();
    return cat.includes("frontend") || cat.includes("ui") || cat.includes("css") ||
           cat.includes("client") || cat.includes("style") ||
           frontendPackagePatterns.some(pattern => pkg.includes(pattern));
  });

  const frontendRules = hasFrontendUpgrade
    ? `
- Client-side library manifest files → MUST_CHANGE when ANY frontend library is being upgraded
- ALL template/view files → MUST_CHANGE (may contain CSS classes, data attributes, CDN refs)
- ALL stylesheet files (.css, .scss, .less) → MUST_CHANGE if any CSS framework is being upgraded
- Layout/master files → MUST_CHANGE (reference CDN links, scripts, classes)
- wwwroot or static asset config files → MUST_CHANGE
`
    : "";

  return `You are a senior software architect performing a tech stack upgrade triage.
${importScopeBlock}
**UPGRADE TARGETS:**
${selections.map(s => `- ${s.package}: ${s.currentVersion} → ${s.selectedVersion}`).join('\n')}

**UPGRADE PLAN SUMMARY:**
${planSummary}

**FILE MANIFEST (${files.length} files):**

${manifest}

**YOUR TASK:**
Classify EVERY file into exactly one category:
- **MUST_CHANGE**: File WILL break or has version references that MUST be updated (manifests, configs with version numbers, files using deprecated APIs, entry points with framework init code)
- **MAYBE_CHANGE**: File MIGHT need changes (uses upgraded packages but may work as-is)
- **NO_CHANGE**: File does NOT need any changes (pure business logic, static assets, tests that will be regenerated, files unrelated to upgraded packages)

**CLASSIFICATION GUIDELINES:**
- Manifest/config files (any file that declares dependencies or framework versions) → MUST_CHANGE
- Entry point files (the main file that boots the application) → MUST_CHANGE
- Files importing deprecated/renamed packages → MUST_CHANGE
- Files with version-specific API calls → MUST_CHANGE
- Template/view files → MUST_CHANGE if upgrading any frontend/UI/CSS framework
- Layout/master template files → MUST_CHANGE for any web framework upgrade
- View/template files containing CSS class names, data- attributes, or JS plugin references from upgraded frameworks → MUST_CHANGE
- Files with <link> or <script> tags referencing CDN URLs or asset paths for upgraded libraries → MUST_CHANGE
${frontendRules}
- Generic utility files with no framework dependency → NO_CHANGE  
- Test files → NO_CHANGE (they'll be regenerated)
- Pure static images, binary assets → NO_CHANGE
- Lock files, generated files → NO_CHANGE

**RESPOND WITH PURE JSON ARRAY** (no markdown, no explanation):
[
  {"path": "path/to/file.ext", "action": "MUST_CHANGE", "reason": "Contains target framework version"},
  {"path": "path/to/other.ext", "action": "NO_CHANGE", "reason": "Pure business logic, no framework deps"}
]`;
}

// ─── Single-file upgrade prompts ───────────────────────────────────

export function buildSingleFileUpgradeSystemPrompt(selections: VersionSelection[]): string {
  const migRef = getMigrationReference(selections);
  const importRule = buildImportPreservationRule();
  const functionalRules = buildFunctionalPreservationRules();
  return `You are a Principal Software Engineer performing production code upgrades.
You specialize in precise, complete framework migrations for ANY tech stack.

⛔ ABSOLUTE RULE — NEVER REMOVE BUSINESS LOGIC (READ THIS FIRST):
- Do NOT delete ANY function, method, event handler, callback, or code block
- Do NOT remove jQuery event bindings (.on, .click, .submit, .ajax, .ready, .change, .keyup, .each)
- Do NOT remove try/catch blocks, error handlers, or validation logic
- Do NOT remove console.log, console.error, or any logging statements
- Do NOT remove comments
- Do NOT simplify code by removing what you think is "redundant"
- Do NOT remove any variable declarations, assignments, or return statements
- If you are unsure whether a line is framework code or business code — KEEP IT
- The ONLY changes allowed: version numbers, API method names, import paths, deprecated patterns
- Your output file MUST have the SAME number of functions and methods as the input
- Removing business logic causes the application to BREAK — this is the #1 escalation from clients

${importRule}
${functionalRules}
Core rules:
- Return only the complete upgraded file code. No explanations, no markdown fences.
- Use the exact target versions the user specified. All user-specified versions are valid and released.
  Example: If the user selected ".NET 10.0", write TargetFramework as net10.0.
  Example: If the user selected "Bootstrap 5.3.2", pin that exact version.
- Upgrade every occurrence of deprecated patterns, not just the first few.
- For template/view files: update CSS classes, data attributes, and CDN/asset references per the migration guide.
- For library/dependency manifests: update all version numbers. For client-side package managers (LibMan, Bower, jspm): specify explicit "files" arrays with only compiled dist assets (.min.css, .min.js).
- For database/data-access files: preserve migration history, entity configs, seed data, and connection credentials. Only update framework API patterns.
- Apply your full knowledge of the framework/library being upgraded.

Minimal-touch principle:
Touch only lines that must change for the upgrade. Keep everything else as-is.
- Do not rename, move, or repath file references that already work, unless the migration guide requires it.
- Do not swap libraries (e.g., jQuery to vanilla, moment to dayjs) unless all consuming code is also rewritten.
- Do not refactor or reorganize code that is not affected by the upgrade.
- Do not change variable/function/class names, folder structures, config values, or connection strings.
- Do not remove working library references or asset paths the upgrade does not require removing.
- When in doubt, keep the original code.

Path and reference consistency:
- If a manifest specifies destination + files, layout/view references must match the resolved path.
- When upgrading a library version, check if dist filenames changed. If not, keep the same references. If they changed, update both the manifest and all references.

Syntax verification (before returning code):
1. Every opening delimiter has a matching closing delimiter.
2. Every statement ends with the appropriate terminator.
3. No orphaned error-handling blocks.
4. Use one consistent file structure pattern per file.
5. All string literals are properly closed.
6. All generic type parameters have matching angle brackets.
7. Do not introduce syntax errors.
8. Preserve all original business logic; only upgrade framework/library usage.
${migRef}`;
}

export function buildSingleFileUpgradeUserPrompt(
  file: any,
  selections: VersionSelection[],
  plan: string,
  previousErrors: string[],
  targetTfm: string,
  model: string = DEFAULT_MODEL_ID,
  previousChangeSummary: string = ""
): string {
  const fileExt = (file.relativePath || "").split(".").pop()?.toLowerCase() || "";
  const fileName = (file.relativePath || "").split(/[\\/]/).pop()?.toLowerCase() || "";
  const isStructuredConfig = ["csproj", "xml", "pom", "props", "targets", "nuspec", "fsproj", "vbproj"].includes(fileExt);
  const isClientSideManifest = ["libman.json", "bower.json", ".bowerrc", "jspm.json"].includes(fileName) ||
    (fileName === "package.json" && (file.content || "").includes('"dependencies"'));
  const isDbRelatedFile = /dbcontext|migration|\.sql$|seed|repository/i.test(file.relativePath || "") ||
    (file.content || "").toLowerCase().includes("connectionstring") ||
    (file.content || "").toLowerCase().includes("dbcontext");

  const fileContentBudgets: Record<string, number> = MODEL_FILE_CONTENT_BUDGET_MAP;
  const maxFileChars = fileContentBudgets[model] || 50000;
  const fileContent = file.content || "";

  const maxPlanChars = Math.min(15000, Math.floor(maxFileChars * 0.2));
  const planContent = plan.length > maxPlanChars
    ? plan.slice(0, maxPlanChars) + `\n\n... (plan truncated from ${plan.length} chars)`
    : plan;

  const changeSummaryBlock = previousChangeSummary
    ? `\n${previousChangeSummary}\n`
    : "";

  let prompt = `**FILE TO UPGRADE:** ${file.relativePath}

**BEFORE WRITING ANY CODE — ANALYZE THIS FILE:**
Read the entire file below carefully. Identify:
- What is this file's purpose? (entry point, view/template, config, manifest, controller, model, service, etc.)
- What functions/classes does it contain? What are their signatures?
- What frameworks/libraries does it reference? Which are being upgraded?
- What inter-file dependencies exist (imports, using statements, partial views, layout references)?
- What specific patterns, classes, data attributes, and API calls must change for the upgrade?
Use this analysis to ensure you upgrade EVERY relevant line — not just the obvious ones.

**UPGRADE REQUIREMENTS (MANDATORY — use EXACT versions, ZERO tolerance for wrong versions):**
${selections.map(s => `- ★ ${s.package}: ${s.currentVersion} → ${s.selectedVersion} [MUST BE EXACTLY ${s.selectedVersion}]`).join('\n')}
CRITICAL: Every version reference in output MUST match EXACTLY the target versions above. Do NOT hallucinate or substitute different version numbers.
${changeSummaryBlock}
**UPGRADE PLAN:**
${planContent}

**CURRENT CODE:**
\`\`\`
${fileContent.length > maxFileChars ? fileContent.slice(0, maxFileChars) + "\n... (truncated)" : fileContent}
\`\`\``;

  if (previousErrors.length > 0) {
    prompt += `\n\n**PREVIOUS ERRORS (Fix these):**
${previousErrors.map((e, i) => `${i + 1}. ${e}`).join('\n')}`;
  }

  if (targetTfm) {
    if (isDotNetStack(selections)) {
      const tfmMajor = parseInt(targetTfm.replace("net", ""), 10) || 0;
      prompt += `\n\n**Version consistency:**
This project is being upgraded to target framework "${targetTfm}". This applies to every project file in the solution.
- If this file is a project config (.csproj, .fsproj, .vbproj, etc.): set TargetFramework to exactly "${targetTfm}".
- Do not downgrade to an older framework version. The user chose "${targetTfm}" and it is valid.
- All projects in the solution should target "${targetTfm}" uniformly.

**NuGet PACKAGE VERSION RULES (CRITICAL — wrong versions cause NU1102 build failures):**
- For ACTIVE packages that release new versions matching each .NET release (e.g., Microsoft.EntityFrameworkCore.*, Microsoft.Extensions.Identity.*, Microsoft.NET.Test.Sdk), use the matching major version (e.g., ${tfmMajor}.x for ${targetTfm}).
- **DISCONTINUED/ABSORBED PACKAGES — MUST BE REMOVED, NOT UPGRADED:**
  Starting with .NET Core 3.0, many ASP.NET Core packages were absorbed into the shared framework and are NO LONGER published as separate NuGet packages. If the target is net6.0 or later, you MUST **REMOVE** (delete the entire PackageReference line) for these packages — do NOT try to upgrade them to version ${tfmMajor}.x because those versions DO NOT EXIST on NuGet:
  Microsoft.AspNetCore.Session, Microsoft.AspNetCore.Http, Microsoft.AspNetCore.Http.Abstractions, Microsoft.AspNetCore.Diagnostics, Microsoft.AspNetCore.Hosting, Microsoft.AspNetCore.Hosting.Abstractions, Microsoft.AspNetCore.Server.Kestrel, Microsoft.AspNetCore.StaticFiles, Microsoft.AspNetCore.Routing, Microsoft.AspNetCore.Mvc, Microsoft.AspNetCore.Mvc.Core, Microsoft.AspNetCore.Identity, Microsoft.AspNetCore.Authentication, Microsoft.AspNetCore.Authorization, Microsoft.AspNetCore.Cors, Microsoft.AspNetCore.Cryptography.KeyDerivation, Microsoft.Extensions.Logging, Microsoft.Extensions.Configuration, Microsoft.Extensions.DependencyInjection, Microsoft.Extensions.Options, Microsoft.Extensions.Caching.Memory, Microsoft.AspNetCore.Http.Extensions, Microsoft.AspNetCore.Mvc.ViewFeatures, Microsoft.AspNetCore.Mvc.TagHelpers, Microsoft.AspNetCore.Mvc.Razor, Microsoft.AspNetCore.Razor, Microsoft.AspNetCore.Razor.Runtime, Microsoft.AspNetCore.Server.IIS, Microsoft.AspNetCore.Server.IISIntegration, Microsoft.AspNetCore.ResponseCaching, Microsoft.AspNetCore.ResponseCompression, Microsoft.AspNetCore.WebSockets, Microsoft.AspNetCore.CookiePolicy, Microsoft.AspNetCore.Diagnostics.EntityFrameworkCore.
  These are automatically available through the \`<FrameworkReference Include="Microsoft.AspNetCore.App" />\` or the SDK.
- For ALL other packages, use the ACTUAL latest version available on the package registry. Do NOT guess versions — only use versions you know exist.`;
    } else {
      prompt += `\n\n**Version consistency:**
This project is being upgraded to version "${targetTfm}". Use this version in all relevant configuration and manifest files.
- Do not downgrade to an older version. The user chose "${targetTfm}" and it is valid.
- Update all project config / build files (pom.xml, build.gradle, go.mod, pyproject.toml, Gemfile, etc.) to reference this version.
- For packages, use the actual latest compatible version available on the package registry.`;
    }
  }

  prompt += `\n\n**Your task: Code upgrade**

You are upgrading this code from older versions to newer versions.
Based on your analysis of this file above, apply all necessary changes:
- For template/view files: update ALL CSS classes, data attributes, CDN/asset references, and JS plugin patterns to match the target version based on your knowledge of the framework's migration guide.
- For library manifests: update ALL version numbers. For client-side manifests: ensure compiled dist assets (.min.css, .min.js) are specified, not source files.
- For configuration/entry point files: update framework initialization, dependencies, and settings.
- For code files: replace all deprecated APIs, update imports, and fix breaking changes.`;

  if (isStructuredConfig) {
    prompt += `\n\n**Structured config/manifest file (XML/POM/etc.):**

This file uses a strict markup format. Syntax must be correct or the build will fail.

Rules:
1. Every opening tag must have exactly one matching closing tag or be self-closing.
2. Self-closing tags must use proper format (e.g., <Tag attribute="value" />).
3. No unmatched, extra, or missing tags.
4. Update all version numbers, framework targets, and dependency references to the target versions.
5. Related packages from the same ecosystem should use compatible versions; do not mix major versions.
6. Packages absorbed into the runtime shared framework should be removed entirely (delete the PackageReference line). For .NET 6+, this includes most Microsoft.AspNetCore.* packages — they are part of the shared framework.
7. Only upgrade packages to versions that actually exist on the package registry.

**TAG VERIFICATION (DO THIS BEFORE RETURNING):**
1. Count all opening tags, closing tags, and self-closing tags
2. VERIFY: (opening tags - self-closing tags) = closing tags
3. If they don't match, FIX IT before returning

**DOUBLE-CHECK YOUR OUTPUT:**
- [ ] Every opening tag has a matching closing tag or is self-closing
- [ ] No orphan tags
- [ ] All dependency versions are updated to the target and are mutually compatible
`;
  }

  if (isClientSideManifest) {
    prompt += `\n\n**CRITICAL — THIS IS A CLIENT-SIDE LIBRARY MANIFEST FILE:**

This file controls which client-side libraries (CSS, JS, fonts) are restored/installed into the project.
Getting this wrong means the application will have NO STYLES, NO SCRIPTS, and a COMPLETELY BROKEN UI.

**MANDATORY RULES FOR CLIENT-SIDE MANIFESTS:**

1. **EVERY library entry MUST have an explicit files/resources array** listing ONLY compiled dist assets:
   - CSS files: .min.css (e.g., "dist/css/bootstrap.min.css" or "css/bootstrap.min.css")
   - JS files: .min.js or .bundle.min.js (e.g., "dist/js/bootstrap.bundle.min.js" or "js/bootstrap.bundle.min.js")
   - Font/icon files: webfont files + CSS (e.g., "css/all.min.css", "webfonts/*")
   - Do not include: .scss, .sass, .less, .ts, .coffee, src/, package.json, Gruntfile, gulpfile

2. **Use providers that ship compiled dist assets:**
   - "cdnjs" provider: files are typically at the CDN root (e.g., "css/bootstrap.min.css")
   - "jsdelivr" provider: files often start with "dist/" (e.g., "dist/css/bootstrap.min.css")
   - "unpkg" provider: files are at package root (e.g., "dist/js/bootstrap.bundle.min.js")
   - If the default provider/package only ships source, SWITCH to a provider that ships compiled dist

3. **Update ALL version numbers** to the exact target versions from the upgrade requirements
   - Do NOT leave ANY library at its old version

4. **Verify file paths are valid for the TARGET version:**
   - Between major versions, the file structure in dist/ may change
   - e.g., bootstrap.min.js vs bootstrap.bundle.min.js — check which exists in the target version
   - Use your knowledge of the library's dist structure at the target version

5. **Match destination paths with what layout/view files expect:**
   - If layout references "~/lib/bootstrap/dist/css/bootstrap.min.css", the destination + files must produce that path
   - After upgrading, the restored file tree must match ALL <link> and <script> src paths in views

**EXAMPLE — CORRECT libman.json entry pattern:**
\`\`\`json
{
  "provider": "cdnjs",
  "library": "library-name@VERSION",
  "destination": "wwwroot/lib/library-name/",
  "files": [
    "css/library-name.min.css",
    "js/library-name.min.js"
  ]
}
\`\`\`

6. **Do not substitute a library with a different one that has an incompatible API:**
   - e.g., do not replace bootstrap-datepicker with vanillajs-datepicker, moment with dayjs, jQuery Validation with another validator
   - Keep the same library and upgrade to its latest compatible version.
   - Only if a library is truly discontinued with no new version may you substitute, noting: "// MIGRATION NOTE: replaced X with Y"

7. **Always specify explicit "destination" per library** for deterministic file paths:
   - e.g., "destination": "wwwroot/lib/jquery/" ensures files land under /lib/jquery/
   - Without explicit destination, the restore path is non-deterministic and may not match view file references

**VALIDATION BEFORE RETURNING:**
- [ ] Every library entry has a "files" array (no entry without it)
- [ ] No "files" array contains .scss, .sass, .less, .ts, or other source files
- [ ] Every "files" entry ends in .min.css, .min.js, .bundle.min.js, .woff2, .ttf, or similar compiled/binary format
- [ ] All version numbers match the target upgrade versions
- [ ] The provider for each entry is known to ship compiled dist assets
- [ ] No library was REPLACED with a different library — only version upgrades of the SAME library
- [ ] Every entry has an explicit "destination" field
`;
  }

  if (isDbRelatedFile) {
    prompt += `\n\n**CRITICAL — THIS FILE IS DATABASE/DATA-ACCESS RELATED:**

Handle with extreme care — incorrect changes can cause data loss, broken migrations, or runtime crashes.

Rules:
1. Preserve all migration history; do not alter existing migration files' Up/Down methods.
2. Preserve all entity configurations (relationships, indexes, keys, constraints).
3. Preserve all seed data; only update framework patterns, not data values.
4. Connection strings: update syntax if needed for the target version, but do not change host/database/credentials.
5. ORM base classes: update to the target version's base class patterns (e.g., OnModelCreating signature changes).
6. Fluent API: update deprecated methods to their new equivalents.
7. Query patterns: update LINQ/query API calls if they changed between versions.
`;
  }

  prompt += `\n\n**COMPREHENSIVE UPGRADE CHECKLIST:**

**1. PROJECT/CONFIGURATION FILES:**
- Update target framework/runtime version in all project config files
- Modify build configurations (SDK version, language version, compiler settings)
- Update ALL dependency declarations in every manifest/config file in the project
- Convert deprecated configuration formats to modern equivalents
- Update compiler/transpiler and tooling configurations

**2. DEPENDENCIES & IMPORTS:**
- Update import/require/using/include statements ONLY for packages whose module paths actually changed in the new version
- Handle package namespace changes ONLY when required by the upgrade (e.g., javax→jakarta for Spring Boot 3.x)
- If a package is removed/discontinued, note it — do NOT silently swap it for a different library with a different API
- Update submodule/nested package imports ONLY if the new version moved them
- Fix transitive dependency conflicts
- DO NOT rename or repath imports that still resolve correctly on the target version

**3. API & METHOD CHANGES:**
- Replace deprecated methods with current equivalents
- Update method signatures (parameter order, types, names)
- Handle renamed classes, interfaces, functions
- Adapt to API behavior changes (synchronous → asynchronous)
- Update callback patterns to Promises/async-await
- Replace removed APIs with modern alternatives

**4. BREAKING CHANGES:**
- Fix syntax changes in language/framework
- Handle type system updates (strict typing, nullability)
- Update data serialization/deserialization logic
- Fix changed default behaviors
- Handle removed features (provide alternatives)
- Update error handling patterns

**5. CONFIGURATION & SETTINGS:**
- Migrate configuration files to new formats (XML → JSON, .ini → YAML, etc.)
- Update environment variable handling
- Modernize database connection strings
- Update authentication/security configurations
- Migrate logging configurations
- Update middleware/plugin registrations

**6. AUTHENTICATION & SECURITY:**
- Update authentication libraries and patterns
- Migrate security configurations
- Update encryption/hashing algorithms
- Fix token handling (JWT, OAuth changes)
- Update CORS, CSP, security headers
- Modernize password/credential handling

**7. DEPENDENCY INJECTION & SERVICES:**
- Before adding or changing any service/bean/module registrations: DISCOVER the existing architecture — scan the codebase for all existing service interfaces and implementations, map interface→implementation and constructor dependencies. Do NOT assume naming conventions or standard patterns; only register types that actually exist in the project. Verify every dependency in the chain is registered.
- Add/update service registration only for types that exist; include ALL transitive dependencies
- Implement modern dependency injection patterns
- Remove static dependencies where appropriate
- Update service lifetime management
- Implement constructor injection patterns

**8. TESTING COMPATIBILITY:**
- Ensure test frameworks are compatible
- Update test syntax for new versions
- Fix assertion library changes
- Update mocking library usage
- Ensure integration test compatibility

**9. RUNTIME & PLATFORM:**
- Ensure code runs on target runtime version
- Handle platform-specific changes
- Update async/concurrency patterns
- Fix threading/event loop changes
- Handle memory management updates

**10. BUILD & COMPILATION:**
- Ensure code compiles/transpiles successfully
- Fix build tool compatibility
- Update build scripts if needed
- Resolve compilation warnings
- Handle module system changes (CommonJS ↔ ES Modules)

**11. FRONTEND/UI FRAMEWORK UPGRADES (any CSS/JS framework being upgraded):**
- Replace ALL removed/deprecated CSS classes with the target version's equivalents — scan EVERY line of EVERY template, view, and stylesheet file
- Update ALL data attributes that changed between versions in EVERY template/HTML file
- Replace deprecated JavaScript plugin initialization patterns with the target version's API
- Update grid system, form, navbar, and component classes to the target version's patterns
- Remove deprecated components and replace with the target version's alternatives
- Update CDN/asset <link> and <script> references to target version URLs
- Handle template engine syntax changes for the specific templating engine used in the project
- Ensure ALL template/view files are upgraded — not just backend code

**CRITICAL RULES:**
- Return ONLY the upgraded code - NO markdown fences, NO explanations, NO comments about changes
- Code must be syntactically correct and production-ready
- Code must compile/run successfully on the target version
- Preserve ALL business logic and functionality — do NOT remove, alter, or simplify any business logic
- Handle errors gracefully with proper error handling
- Follow best practices for the target version
- Version consistency: When a target framework version is specified, all project config files in the solution should use the same version. Do not use different versions for different projects.
- If unsure about a change, prefer conservative safe approach — keep the original structure
- Maintain backwards compatibility where possible
- Add proper type annotations if target supports them
- Fix ALL deprecated API usage

Minimal-touch principle:
Touch only lines that must change for the version upgrade. Keep everything else as-is.
- Do not rename or repath file references that already work unless the migration guide requires it.
- Do not swap libraries (e.g., jQuery to vanilla, moment to dayjs); keep the same library at the newer version.
- Do not refactor or reorganize code that compiles fine on the target version.
- Do not change variable, function, class, or file names unless the upgrade requires it.
- Do not alter config values, connection strings, hostnames, ports, or credentials.
- When in doubt, keep the original code.

Path and reference consistency:
- When upgrading a library version, check if dist filenames changed. If unchanged, keep the same references. If changed, update both the manifest and all references.

No duplicate statements:
- Produce only one startup/initialization call per entry point.
- Register each service/module exactly once.

No duplicate library sources:
- If a package manager provides a library, remove matching CDN tags for the same library.
- Source each library from exactly one location.

Complete frontend migration:
- Replace every deprecated CSS class, data attribute, and JS pattern in the file.
- Scan the entire file. A leftover deprecated class/attribute means the upgrade is incomplete.

Icon library adoption:
- If an icon library is being added/upgraded, replace Unicode emoji entities with proper icon markup.

Client-side library manifest upgrades:
- Update all library entries to target versions.
- For client-side package managers: specify explicit files arrays with only compiled dist assets. Do not include source files.
- After upgrading, verify layout/view file paths match the files restored by the manifest.

Syntax verification (before returning):
1. Every opening delimiter has a matching closing delimiter.
2. Every statement ends with the appropriate terminator.
3. No orphaned error-handling blocks.
4. Use one consistent pattern per file.
5. For XML/markup: every tag properly opened and closed or self-closing.
6. All string literals have matching quotes, generics have matching angle brackets.
7. Do not introduce syntax errors.

What not to do:
- Do not add explanatory comments about changes.
- Do not wrap code in markdown code blocks.
- Do not add TODO or FIXME comments.
- Do not leave deprecated code paths.
- Do not remove or alter business logic; only upgrade framework/library patterns.
- Do not rename or repath imports/references that already work.
- Do not swap libraries; keep the same library at the newer version.

Output format:
Return only the complete, upgraded file content. Start immediately with the code.`;

  return prompt;
}

// ─── Multi-file upgrade prompts ────────────────────────────────────

export function buildMultiFileUpgradeSystemPrompt(selections: VersionSelection[]): string {
  const migRef = getMigrationReference(selections);
  const fileAnalysis = buildFileAnalysisInstruction();
  const importRule = buildImportPreservationRule();
  const functionalRules = buildFunctionalPreservationRules();
  return `You are a Principal Software Engineer performing production code upgrades on multiple files simultaneously.
Follow the output format EXACTLY.

⛔ ABSOLUTE RULE — NEVER REMOVE BUSINESS LOGIC (READ THIS FIRST):
- Do NOT delete ANY function, method, event handler, callback, or code block
- Do NOT remove jQuery event bindings (.on, .click, .submit, .ajax, .ready, .change, .keyup, .each)
- Do NOT remove try/catch blocks, error handlers, or validation logic
- Do NOT remove console.log, console.error, or any logging statements
- Do NOT remove comments
- Do NOT simplify code by removing what you think is "redundant"
- Do NOT remove any variable declarations, assignments, or return statements
- If you are unsure whether a line is framework code or business code — KEEP IT
- The ONLY changes allowed: version numbers, API method names, import paths, deprecated patterns
- Your output file MUST have the SAME number of functions and methods as the input
- Removing business logic causes the application to BREAK — this is the #1 escalation from clients

${importRule}
${functionalRules}
${fileAnalysis}

Core rules:
- Use the exact target versions the user specified. All user-specified versions are valid and released.
  Example: If the user selected ".NET 10.0", write TargetFramework as net10.0.
- Upgrade every occurrence of deprecated patterns in every file, not just the first few.
- For template/view files: update CSS classes, data attributes, and CDN/asset references per the migration guide.
- For library manifests: update all version numbers. For client-side package managers, specify explicit files arrays with only compiled dist assets (.min.css, .min.js).
- Preserve all original business logic; only upgrade framework/library usage patterns.
- For database/data-access files: preserve migration history, entity configs, seed data, and connection credentials.
- All project config files in the solution should target the same framework version.

Syntax verification (for every file before returning):
1. Every opening delimiter has a matching closing delimiter.
2. Every statement ends with the appropriate terminator.
3. Use one consistent file structure pattern per file.
4. For XML/markup: every tag is properly opened and closed or self-closing.
5. All string literals have matching quotes, all generics have matching angle brackets.
6. If unsure, keep the original code structure and only change what is necessary.

No duplicate statements:
- Produce only one startup/initialization call per entry point (e.g., app.Run(), app.listen()).
- Register each service/module exactly once.

No duplicate library sources:
- If a package manager provides a library, remove matching CDN script/link tags for the same library.
- Each library should be sourced from exactly one location.

Complete frontend migration:
- Replace every deprecated CSS class, data attribute, and JS pattern in every file.
- A leftover deprecated class/attribute means the upgrade is incomplete.

Icon library adoption:
- If an icon library is being added/upgraded, replace Unicode emoji entities with proper icon markup.

Client-side library manifest upgrades:
- Update all library entries in manifests to target versions.
- For client-side package managers (LibMan, Bower, jspm): specify explicit files arrays with only compiled dist assets. Use a provider that ships compiled dist.
- After upgrading, verify layout/view file paths match the files restored by the manifest.

Database / data-access file safety:
- Preserve migration history, entity configurations, seed data, and connection credentials.
- Only update ORM base class patterns, fluent API, and framework-specific methods per the migration guide.
${migRef}`;
}

export function buildMultiFileUpgradeUserPrompt(
  files: any[],
  selections: VersionSelection[],
  plan: string,
  previousErrors: string[],
  filesSection: string,
  targetTfm: string = "",
  previousChangeSummary: string = ""
): string {
  const maxPlanChars = 5000;
  const planContent = plan.length > maxPlanChars
    ? plan.slice(0, maxPlanChars) + '\n...(truncated)'
    : plan;

  let versionConsistencyBlock = '';
  if (targetTfm && isDotNetStack(selections)) {
    const tfmMajor = parseInt(targetTfm.replace("net", ""), 10) || 0;
    versionConsistencyBlock = `
**Version consistency:**
This solution is being upgraded to target framework "${targetTfm}". All project config files (.csproj, .fsproj, .vbproj, etc.) should use "${targetTfm}" as their TargetFramework.

NuGet package version rules:
- For active packages (Microsoft.EntityFrameworkCore.*, Microsoft.Extensions.Identity.*, etc.): use matching major version ${tfmMajor}.x.
- Discontinued packages (remove, do not upgrade): Many Microsoft.AspNetCore.* packages (Session, Http, Mvc, Routing, StaticFiles, Diagnostics, Hosting, etc.) were absorbed into the shared framework in .NET Core 3.0. For ${targetTfm}, these packages do not exist at version ${tfmMajor}.x on NuGet. Delete the entire PackageReference line; the functionality is available through the SDK.

`;
  } else if (targetTfm) {
    versionConsistencyBlock = `
**Version consistency:**
This project is being upgraded to version "${targetTfm}". Use this version in all relevant configuration and manifest files (pom.xml, build.gradle, go.mod, pyproject.toml, Gemfile, etc.).
- Do not downgrade to an older version. The user chose "${targetTfm}" and it is valid.
- For packages, use the actual latest compatible version available on the package registry.

`;
  }

  const changeSummaryBlock = previousChangeSummary
    ? `\n${previousChangeSummary}\n`
    : "";

  return `**BEFORE WRITING ANY CODE — ANALYZE EVERY FILE:**
For each file below, identify: its purpose, the functions/classes it contains, which frameworks/libraries it references, and which specific patterns/APIs/classes/attributes must change for the upgrade. Use this analysis to ensure you upgrade EVERY relevant line in EVERY file.

**UPGRADE REQUIREMENTS (MANDATORY — use EXACT versions, ZERO tolerance for wrong versions):**
${selections.map(s => `- ★ ${s.package}: ${s.currentVersion} → ${s.selectedVersion} [MUST BE EXACTLY ${s.selectedVersion}]`).join('\n')}
CRITICAL: Every version reference in output MUST match EXACTLY the target versions above. Do NOT hallucinate or substitute different version numbers.
${changeSummaryBlock}${versionConsistencyBlock}
**UPGRADE PLAN (summary):**
${planContent}

${previousErrors.length > 0 ? `**PREVIOUS ERRORS:**\n${previousErrors.slice(-3).join('\n')}\n\n` : ''}

**FILES TO UPGRADE (${files.length} files):**

${filesSection}

**YOUR TASK:**
Upgrade ALL ${files.length} files above according to the upgrade requirements. For each file, apply ALL necessary changes:
- Version numbers, deprecated APIs, imports, configurations
- For template/view files: update ALL CSS classes, data attributes, and JS references to match the target framework versions. Use the MIGRATION GUIDANCE section to identify which patterns must change.
- For library manifests: update ALL version numbers to the target versions — no library left at old version. For client-side manifests, ensure compiled dist assets are specified.
- For CDN/asset references: update to target version URLs — and REMOVE CDN refs for libs already provided by a package manager
- If an icon library is being added/upgraded, replace Unicode emoji entities with proper icon markup
- Do NOT skip any file — every file must be fully upgraded
- PRESERVE ALL business logic — only upgrade framework/library patterns, do NOT remove or alter any business functionality

**CLIENT-SIDE LIBRARY + LAYOUT + VIEW FILE COORDINATION (CRITICAL — mismatched paths/APIs = BROKEN UI):**
When a client-side manifest (libman.json, bower.json, package.json) AND view/template files are in this batch:
1. First, decide what the manifest entries will look like (destination + files). Always specify BOTH explicitly for deterministic paths.
2. Then, ensure EVERY \`<link href="~/...">\` and \`<script src="~/...">\` in ALL view files matches the EXACT paths the manifest will restore.
3. Example: if libman.json has \`"destination": "wwwroot/lib/bootstrap/"\` with file \`"dist/css/bootstrap.min.css"\`, then layout must use \`~/lib/bootstrap/dist/css/bootstrap.min.css\`
4. If the destination or file structure changed between versions, update BOTH the manifest AND ALL view references.
5. Do not substitute a library with a different one unless you also rewrite all consuming API calls in all view/template files in this batch. If consuming files are not in this batch, keep the same library and upgrade its version.
6. If a view file calls a jQuery plugin (e.g., .datepicker(), .validate(), .select2()), the manifest must include the exact library that provides that plugin.

Minimal-touch principle:
Touch only lines that must change for the version upgrade. Keep everything else as-is.
- Do not rename, repath, or alter file references that already work.
- Do not swap libraries; keep the same library at the newer version.
- Do not refactor code that is not broken by the upgrade.
- Do not change variable/function/class names, config values, or credentials.
- When in doubt, keep the original code.

Path and reference consistency:
- If upgrading a library version, check if dist filenames changed. If unchanged, keep the same references. If changed, update both the manifest and all view/layout references in sync.

Syntax correctness:
- Every file must compile/parse without syntax errors.
- Use one consistent pattern per file.
- Produce only one startup/initialization call per entry point.
- Verify all delimiters, terminators, and string literals are properly matched.
- If unsure about a change, keep the original code structure.

Completeness:
- Replace every deprecated CSS class in every template file, not just the first occurrence.
- Replace every deprecated data attribute; scan the entire file.
- A leftover deprecated class, attribute, or API call means the upgrade is incomplete.

**OUTPUT FORMAT - CRITICAL:**
Return ALL files in this EXACT format (one after another). Use the exact delimiters shown:

===FILE: path/to/file1.ext===
[complete upgraded code for file 1]
===END_FILE===

===FILE: path/to/file2.ext===
[complete upgraded code for file 2]
===END_FILE===

Rules:
- Return the COMPLETE upgraded content of each file
- Use the EXACT file paths as given above
- No markdown fences inside the file content
- No explanations - just the upgraded code
- If a file needs NO changes, return it unchanged`;
}
