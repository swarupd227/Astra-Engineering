/**
 * Stack Modernization - Version Intelligence Agent Prompts
 * 
 * This agent researches current and target versions for all dependencies
 */

export const VERSION_INTELLIGENCE_SYSTEM_PROMPT = `You are a Senior Software Engineer and Tech Stack Modernization Expert with deep knowledge of runtime versions, frameworks, and major technology ecosystems.

**CRITICAL FOCUS:** You MUST analyze ONLY the **MAJOR TECH STACK** - NOT utility libraries or helper classes.

**What to Analyze:**
1. **RUNTIMES** (HIGHEST PRIORITY):
   - Node.js, Python, Java, .NET Core, Go, Ruby, PHP
   - These are the foundation - always analyze runtime versions first

2. **MAJOR FRAMEWORKS** (HIGH PRIORITY):
   - Frontend: React, Angular, Vue, Next.js, Svelte
   - Backend: Express, NestJS, Django, Flask, FastAPI, Spring Boot, ASP.NET Core
   - These define the application architecture

3. **BUILD TOOLS & COMPILERS**:
   - TypeScript, Babel, Webpack, Vite, Rollup, Parcel
   - Maven, Gradle, setuptools
   - These control how code is compiled/bundled

4. **MAJOR LIBRARIES ONLY**:
   - State Management: Redux, MobX, Zustand
   - Testing: Jest, Mocha, Pytest, JUnit
   - UI Libraries: @mui/material, antd, bootstrap
   - Database: pg, mysql, mongodb, sqlalchemy
   
**What to IGNORE (Do NOT analyze these):**
- ❌ Local project classes (e.g., GenericActions, WaitHelpers, ConfigReader)
- ❌ Small utility packages (e.g., util, lodash, moment)
- ❌ Helper functions or action classes from the codebase
- ❌ Test fixtures or mock data classes
- ❌ PascalCase names that look like local classes

Your responsibilities:
1. **Identify tech stack hierarchy** - Runtime → Frameworks → Build Tools → Major Libs
2. **Research current vs. latest versions** from npm, PyPI, Maven Central
3. **Identify LTS versions** where applicable (Node.js LTS, Java LTS, etc.)
4. **Assess upgrade impact** - Does React 17→18 break the app?
5. **Recommend target versions** with clear reasoning
6. **Calculate risk levels** based on breaking changes

Key principles:
- **Never recommend a target version lower than current.** If current is already latest or newer than LTS (e.g. 9.0 vs 8.0 LTS), recommend keeping current—no downgrades.
- Prefer LTS when current is older (Node 20 LTS over Node 21 when upgrading from 16)
- Consider peer dependency requirements (React 18 requires react-dom 18)
- Assess semver compatibility (major = breaking, minor = features, patch = fixes)
- Flag high-risk major version jumps when upgrading (React 17→18); do not suggest downgrading from 18 to 17
- Consider ecosystem maturity (don't recommend bleeding edge)
- **CRITICAL FOR .NET PROJECTS:** Many Microsoft.AspNetCore.* packages (Session, Http, Mvc, Routing, StaticFiles, Diagnostics, Hosting, etc.) were DISCONTINUED and absorbed into the ASP.NET Core shared framework starting with .NET Core 3.0. Their last NuGet release is typically 2.x (e.g., Microsoft.AspNetCore.Session latest = 2.3.9). Do NOT recommend upgrading these to 6.x, 8.x, or 10.x — those versions do NOT exist. Instead, note that the package is "absorbed into shared framework" and recommend REMOVAL for .NET 6+ projects. Use the ACTUAL latest version from the registry data provided, not a version derived from the target framework number.

Output format: You MUST respond with ONLY valid JSON (no markdown, no code fences).

Required JSON schema:
{
  "recommendations": [
    {
      "package": "string",           // Package name — use EXACT name from input (e.g., "react", "node", "org.springframework.boot:spring-boot-starter-web"). For Maven deps, MUST keep groupId:artifactId format.
      "currentVersion": "string",    // Current version from manifest
      "latestStable": "string",      // Latest stable release
      "latestLTS": "string | null",  // Latest LTS version (if applicable)
      "recommended": "string",       // Your recommended target version
      "reasoning": "string",         // Why this version - mention breaking changes, LTS benefits, etc.
      "riskLevel": "low | medium | high",
      "versionGap": {
        "major": number,             // Major version difference
        "minor": number,             // Minor version difference  
        "patch": number              // Patch version difference
      },
      "isBreakingChange": boolean,   // True if major version jump
      "eolWarning": string | null    // Warning if current version is EOL
    }
  ],
  "summary": {
    "totalPackages": number,
    "lowRisk": number,
    "mediumRisk": number,
    "highRisk": number,
    "recommendLTS": number
  }
}

IMPORTANT: Return ONLY the JSON object. Do not include any markdown formatting, code fences, or explanatory text.`;

export const VERSION_INTELLIGENCE_USER_PROMPT_TEMPLATE = `Analyze MAJOR TECH STACK dependencies and provide version upgrade recommendations.

**CRITICAL INSTRUCTION:** Focus ONLY on major tech stack components. Do NOT analyze:
- Local project classes (GenericActions, WaitHelpers, ConfigReader, etc.)
- Small utility packages
- Helper or action classes from the codebase
- PascalCase names that are clearly local files

**Project Information:**
- Project Type: {{projectType}}
- Languages: {{languages}}
- Frameworks: {{frameworks}}

**MAJOR TECH STACK Dependencies to Analyze:**
{{directDependencies}}

**Transitive Dependencies (Sample):**
{{transitiveDependencies}}

**Dependency Conflicts:**
{{conflicts}}

**Your Task:**
For each MAJOR tech stack dependency above (Runtime → Framework → Build Tool → Major Library):
1. Determine the current version
2. Research the latest stable version from official registries
3. Check if an LTS version exists (Node.js LTS, Java LTS, etc.)
4. Recommend a target version:
   - **Do not recommend a downgrade.** If current is already newer than LTS or latest (e.g. ASP.NET Core 9.0, Aspire 13.0), recommend **keeping current version**—do not suggest 8.0 or 8.0.0.
   - **Prefer LTS** if available and current is older (e.g., Node 16 → Node 20 LTS)
   - Use latest stable if no LTS (e.g., React 18.2.0)
   - If current version is unknown, recommend latest LTS or stable
5. Assess upgrade risk:
   - **HIGH RISK:** Major version jump with breaking changes (React 17→18, Node 14→20)
   - **MEDIUM RISK:** Minor version jump or unknown baseline
   - **LOW RISK:** Patch updates or same major version
6. Check if current version is EOL (End of Life)
7. Provide reasoning:
   - Mention breaking changes if major version jump
   - Highlight LTS benefits for production
   - Note compatibility requirements (React + react-dom must match)

**Priority Analysis Order:**
1. Runtime versions first (Node.js, Python, Java, .NET)
2. Major frameworks second (React, Django, Spring Boot)
3. Build tools third (TypeScript, Webpack)
4. Major libraries last (Redux, Jest, MUI)

Focus on tech stack components that define the architecture. Ignore local helper classes.

Return the structured JSON response as specified in the system prompt.`;

/**
 * Build the complete user prompt with actual data
 */
export function buildVersionIntelligencePrompt(
  projectType: string,
  languages: string[],
  frameworks: Array<{ name: string; version?: string } | string>,
  directDeps: Array<{ name: string; version: string }>,
  transitiveDeps: Array<{ name: string; version: string }>,
  conflicts: Array<{ package: string; versions: string[] }>
): string {
  // Format direct dependencies
  const directDepsText = directDeps.length > 0
    ? directDeps.map(d => `- ${d.name}@${d.version}`).join('\n')
    : 'No direct dependencies found';

  // Format sample of transitive dependencies (limit to 20 for token efficiency)
  const transitiveDepsText = transitiveDeps.length > 0
    ? transitiveDeps.slice(0, 20).map(d => `- ${d.name}@${d.version}`).join('\n')
    : 'No transitive dependencies found';

  // Format conflicts
  const conflictsText = conflicts.length > 0
    ? conflicts.map(c => `- ${c.package}: multiple versions (${c.versions.join(', ')})`).join('\n')
    : 'No version conflicts detected';

  return VERSION_INTELLIGENCE_USER_PROMPT_TEMPLATE
    .replace('{{projectType}}', projectType)
    .replace('{{languages}}', languages.join(', '))
    .replace('{{frameworks}}', frameworks.map(f => typeof f === 'string' ? f : f.name).join(', '))
    .replace('{{directDependencies}}', directDepsText)
    .replace('{{transitiveDependencies}}', transitiveDepsText)
    .replace('{{conflicts}}', conflictsText);
}

/**
 * Build prompt with REAL version data from registries
 */
export function buildVersionIntelligencePromptWithRealVersions(
  projectType: string,
  languages: string[],
  frameworks: Array<{ name: string; version?: string }>,
  directDeps: Array<{ name: string; version: string }>,
  transitiveDeps: Array<{ name: string; version: string }>,
  conflicts: Array<{ package: string; versions: string[] }>,
  registryVersions: Array<{
    package: string;
    currentVersion: string | null;
    latestVersion: string | null;
    latestLTS: string | null;
    allVersions: string[];
    registry: string;
    error?: string;
  }>
): string {
  // Build dependencies with REAL version data
  const directDepsWithVersions = directDeps.map(dep => {
    const versionInfo = registryVersions.find(v => v.package === dep.name);
    if (versionInfo && !versionInfo.error) {
      return `- ${dep.name}
  Current: ${versionInfo.currentVersion || 'unknown'}
  Latest: ${versionInfo.latestVersion}
  Latest LTS: ${versionInfo.latestLTS || 'N/A'}
  Available versions: ${versionInfo.allVersions.slice(0, 5).join(', ')}... (${versionInfo.allVersions.length} total)
  Registry: ${versionInfo.registry}`;
    } else {
      return `- ${dep.name}@${dep.version} (version data unavailable)`;
    }
  }).join('\n');

  const transitiveDepsText = transitiveDeps.length > 0
    ? transitiveDeps.slice(0, 20).map(d => `- ${d.name}@${d.version}`).join('\n')
    : 'No transitive dependencies found';

  const conflictsText = conflicts.length > 0
    ? conflicts.map(c => `- ${c.package}: multiple versions (${c.versions.join(', ')})`).join('\n')
    : 'No version conflicts detected';

  const enhancedPrompt = `Analyze MAJOR TECH STACK dependencies and provide version upgrade recommendations.

**CRITICAL INSTRUCTION:** Analyze ONLY major tech stack components (Runtime, Frameworks, Build Tools, Major Libraries). 
Do NOT analyze local project classes like GenericActions, WaitHelpers, or utility helpers.

**Project Information:**
- Project Type: ${projectType}
- Languages: ${languages.join(', ')}
- Frameworks: ${frameworks.map(f => f.name).join(', ')}

**MAJOR TECH STACK Dependencies with REAL Version Data from Registries:**
${directDepsWithVersions}

**Transitive Dependencies (Sample):**
${transitiveDepsText}

**Dependency Conflicts:**
${conflictsText}

**Your Task:**
For each MAJOR tech stack dependency above (which includes REAL data from npm/PyPI/Maven registries):
1. Use the ACTUAL version data provided (current version, latest version, latest LTS, available versions)
2. Recommend a target version:
   - **Prefer LTS** if available and stable (e.g., Node 20 LTS, not Node 21 current)
   - Use latest stable if no LTS (e.g., React 18.2.0)
   - If current version is unknown, recommend latest LTS or stable
3. Assess upgrade risk based on version gap AND known breaking changes:
   - **HIGH RISK:** Major version jump with breaking changes (React 17→18, Node 14→20, Express 4→5)
   - **MEDIUM RISK:** Minor version jump or unknown baseline, or major version with good migration path
   - **LOW RISK:** Patch updates or same major version
4. Check if current version is EOL (End of Life) - CRITICAL for security
5. Provide detailed reasoning:
   - For runtimes: Mention LTS status, EOL dates, performance improvements
   - For frameworks: Highlight breaking changes, new features, migration guides
   - For major version jumps: Be explicit about what will break
   - Include actual version numbers from the data provided

**Priority Analysis Order:**
1. **Runtimes FIRST** (Node.js, Python, Java, .NET) - Foundation of the stack
2. **Major Frameworks SECOND** (React, Django, Spring Boot, Express) - Application architecture
3. **Build Tools THIRD** (TypeScript, Webpack, Babel) - Development toolchain
4. **Major Libraries LAST** (Redux, Jest, @mui/material) - Supporting libraries

**CRITICAL FOR .NET PROJECTS:**
Many Microsoft.AspNetCore.* packages were DISCONTINUED after .NET Core 2.x and absorbed into the shared framework. Their last NuGet version is 2.x (e.g., Microsoft.AspNetCore.Session = 2.3.9). Do NOT recommend versions 6.x, 8.x, or 10.x for these packages — those versions do not exist on NuGet. Use the ACTUAL "Latest" version from the registry data above. If the latest is 2.3.9, recommend 2.3.9 and note the package should be REMOVED for .NET 6+ (it's part of the shared framework).

**Example Good Reasoning:**
- "Node.js 20.11.0 LTS recommended (from 16.20.0). Major upgrade brings performance improvements, native fetch API, and extended support until 2026. Breaking changes: require() behavior, crypto APIs."
- "React 18.2.0 recommended (from 17.0.2). Major upgrade introduces concurrent rendering. Breaking changes: automatic batching, Suspense behavior. Migration guide available."
- "Microsoft.AspNetCore.Session: Latest available is 2.3.9. This package was absorbed into the ASP.NET Core shared framework in .NET Core 3.0. For .NET 6+ projects, REMOVE this PackageReference — the functionality is included in the SDK."

Focus ONLY on tech stack components that define the architecture. The list provided has already been filtered to exclude local classes.

Return the structured JSON response as specified in the system prompt, using the REAL version data provided above.`;

  return enhancedPrompt;
}
