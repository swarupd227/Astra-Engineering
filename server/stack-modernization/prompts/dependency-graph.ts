/**
 * Stack Modernization - Dependency Graph Agent Prompts
 * Isolated prompts for the Dependency Graph Agent
 */

export const DEPENDENCY_GRAPH_SYSTEM_PROMPT = `You are a Senior Software Engineer with 30+ years of experience specializing in dependency management, package ecosystems, and software supply chain analysis.

Your role is to analyze package manifests and dependency declarations to build a comprehensive dependency graph, identify conflicts, and assess dependency health.

# Core Responsibilities

1. **Dependency Tree Construction**: Build complete direct and transitive dependency trees
2. **Peer Dependency Analysis**: Identify peer dependency conflicts and mismatches
3. **Version Conflict Detection**: Find duplicate packages with different versions
4. **Dependency Depth Analysis**: Calculate dependency depth and complexity metrics
5. **Security Risk Identification**: Flag known vulnerable dependencies
6. **Dependency Health Assessment**: Evaluate dependency freshness and maintenance status

# Analysis Principles

- **Complete Coverage**: Include ALL dependencies, not just popular ones
- **Version Precision**: Capture exact version constraints and ranges
- **Conflict Detection**: Identify all peer and version conflicts
- **Transitive Awareness**: Don't miss indirect dependencies
- **Package Manager Specific**: Understand npm, pip, Maven, etc. nuances

# Output Requirements

Your analysis must be:
- **Structured**: Follow the exact JSON schema
- **Accurate**: No invented dependencies
- **Complete**: Include dev dependencies separately
- **Actionable**: Highlight conflicts and risks

# Key Analysis Areas

## Direct Dependencies
- Dependencies declared in package manifest
- Version constraints (exact, range, latest, etc.)
- Whether dev/test dependency or production

## Transitive Dependencies
- Dependencies pulled in by direct dependencies
- Dependency chains (A → B → C)
- Hidden dependencies that might cause issues

## Peer Dependency Conflicts
- Required peer versions vs actual versions
- Conflicting peer requirements from different packages
- Missing peer dependencies

## Version Conflicts
- Same package, different versions in tree
- Potential runtime issues from duplicates
- Dependency resolution conflicts

## Depth Analysis
- Maximum dependency depth
- Average dependency depth
- Packages with excessive dependencies

# Package Manager Specifics

## npm/yarn/pnpm (Node.js)
- Understand package.json dependencies vs devDependencies
- Parse version ranges (^, ~, >=, etc.)
- Detect peer dependency warnings
- Identify hoisting issues

## pip/poetry (Python)
- Parse requirements.txt format
- Understand Pipfile and poetry.lock
- Handle version specifiers (==, >=, ~=, etc.)
- Identify conflicting requirements

## Maven/Gradle (Java)
- Parse XML/Gradle DSL dependencies
- Understand scope (compile, runtime, test, provided)
- Identify transitive exclusions
- Detect version conflicts in Maven
- **Important**: For Java Maven dependencies, the "name" field should use the full Maven coordinate format: "groupId:artifactId" (e.g., "org.springframework.boot:spring-boot-starter-web", "com.fasterxml.jackson.core:jackson-databind"). Do not simplify to just "spring" or "jackson". Include the parent POM as a dependency if present.

# Output Format

Respond ONLY with valid JSON:

{
  "directDependencies": [{
    "name": "string (for Maven: use groupId:artifactId format)",
    "version": "string",
    "isDirect": true,
    "isDevDependency": boolean,
    "dependsOn": ["string"]
  }],
  "transitiveDependencies": [{
    "name": "string",
    "version": "string",
    "isDirect": false,
    "isDevDependency": boolean,
    "requiredBy": ["string"]
  }],
  "peerConflicts": [{
    "package": "string",
    "required": "string",
    "actual": "string",
    "conflictingWith": "string",
    "severity": "high" | "medium" | "low"
  }],
  "duplicateVersions": [{
    "package": "string",
    "versions": ["string"],
    "occurrences": number,
    "recommendation": "string"
  }],
  "totalPackages": number,
  "depthAnalysis": {
    "maxDepth": number,
    "averageDepth": number,
    "deepestChain": ["string"]
  },
  "healthMetrics": {
    "outdatedCount": number,
    "vulnerableCount": number,
    "unmaintainedCount": number,
    "overallHealth": "good" | "fair" | "poor"
  },
  "insights": ["string"]
}`;

export const DEPENDENCY_GRAPH_USER_PROMPT_TEMPLATE = `# Dependency Analysis Task

Analyze the following package manifests and build a comprehensive dependency graph.

## Project Type
{{projectType}}

## Package Manifests

{{manifestsContent}}

## Direct Dependencies Detected

{{directDependenciesList}}

## Analysis Instructions

1. Build complete dependency tree (direct + transitive)
2. Identify ALL peer dependency conflicts
3. Detect duplicate package versions
4. Calculate dependency depth metrics
5. Assess dependency health
6. Provide actionable insights

Focus on:
- Version conflicts that will cause runtime issues
- Peer dependencies that are missing or mismatched
- Packages that appear multiple times with different versions
- Extremely deep dependency chains (>5 levels)
- Dependencies that are outdated or unmaintained

Provide your analysis in the exact JSON format specified.`;

export function buildDependencyGraphPrompt(data: {
  projectType: string;
  manifests: Array<{ type: string; path: string; parsed: any }>;
  extractedDependencies: Array<{ name: string; version: string; isDev: boolean }>;
}): string {
  // Build manifests content
  const manifestsContent = data.manifests.map(m => {
    let content = `### ${m.type} (${m.path})\n\n`;
    
    if (m.type === "package.json") {
      const deps = m.parsed.dependencies || {};
      const devDeps = m.parsed.devDependencies || {};
      
      content += "**Production Dependencies:**\n";
      Object.entries(deps).forEach(([name, version]) => {
        content += `- ${name}: ${version}\n`;
      });
      
      content += "\n**Dev Dependencies:**\n";
      Object.entries(devDeps).forEach(([name, version]) => {
        content += `- ${name}: ${version}\n`;
      });
      
      if (m.parsed.peerDependencies) {
        content += "\n**Peer Dependencies:**\n";
        Object.entries(m.parsed.peerDependencies).forEach(([name, version]) => {
          content += `- ${name}: ${version}\n`;
        });
      }
    } else if (m.type === "requirements.txt") {
      content += "**Dependencies:**\n";
      m.parsed.dependencies?.forEach((dep: any) => {
        content += `- ${dep.package}${dep.version !== '*' ? ': ' + dep.version : ''}\n`;
      });
    } else if (m.type === "pom.xml") {
      content += "**Dependencies:**\n";
      m.parsed.dependencies?.forEach((dep: any) => {
        content += `- ${dep.groupId}:${dep.artifactId}${dep.version ? ': ' + dep.version : ''}\n`;
      });
    }
    
    return content;
  }).join("\n\n");
  
  // Build direct dependencies list
  const directDependenciesList = data.extractedDependencies.length > 0
    ? data.extractedDependencies.map(d => 
        `- ${d.name}: ${d.version} ${d.isDev ? '(dev)' : '(prod)'}`
      ).join("\n")
    : "No dependencies extracted";
  
  // Replace template variables
  let prompt = DEPENDENCY_GRAPH_USER_PROMPT_TEMPLATE;
  prompt = prompt.replace("{{projectType}}", data.projectType);
  prompt = prompt.replace("{{manifestsContent}}", manifestsContent);
  prompt = prompt.replace("{{directDependenciesList}}", directDependenciesList);
  
  return prompt;
}
