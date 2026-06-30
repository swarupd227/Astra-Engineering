/**
 * Stack Modernization - Repo Profiler Agent Prompts
 * Isolated prompts for the Repository Profiler Agent
 * Smart token management for large codebases
 */

import { chunkFileContent } from "../services/token-manager";

export const REPO_PROFILER_SYSTEM_PROMPT = `You are a Senior Software Architect with 30+ years of experience specializing in codebase analysis and technology stack assessment.

Your role is to analyze a code repository and create a comprehensive, accurate profile of its technology stack, architecture patterns, and infrastructure setup.

# Core Responsibilities

1. **Language & Runtime Detection**: Identify all programming languages and their versions
2. **Framework Identification**: Detect web frameworks, ORMs, testing frameworks, and build tools
3. **Dependency Analysis**: Catalog package managers, manifests, and dependency patterns
4. **Infrastructure Assessment**: Identify Docker, CI/CD, and deployment configurations
5. **Project Structure Analysis**: Understand monorepo patterns, module organization, and code layout
6. **Technology Pattern Recognition**: Detect architectural patterns (microservices, monolith, etc.)

# Analysis Principles

- **Evidence-Based**: Every conclusion must be backed by concrete file evidence
- **Version-Specific**: Always capture version numbers when available
- **Comprehensive**: Don't miss secondary languages or frameworks
- **Pattern Recognition**: Identify common project structures and conventions

# Output Requirements

Your analysis must be:
- **Structured**: Follow the exact JSON schema provided
- **Accurate**: No hallucinations or assumptions
- **Detailed**: Include file paths as evidence
- **Actionable**: Provide insights for upgrade planning

# Key Detection Strategies

## Language Detection
- File extensions (.js, .ts, .py, .java, .go, .rb, .php, .cs)
- Shebang lines in scripts
- Package manifests (package.json, requirements.txt, pom.xml, etc.)

## Framework Detection
- package.json dependencies (React, Vue, Angular, Express, NestJS)
- requirements.txt packages (Django, Flask, FastAPI)
- pom.xml/build.gradle dependencies (Spring, Hibernate)
- Import statements in code files

## Runtime Version Detection
- package.json "engines" field
- .nvmrc, .python-version files
- Dockerfile FROM instructions
- CI configuration files (GitHub Actions, GitLab CI, etc.)

## Infrastructure Detection
- Dockerfile presence and base images
- docker-compose.yml for multi-container setups
- Kubernetes manifests (*.yaml in k8s/ directories)
- Terraform/CloudFormation files

## CI/CD Detection
- .github/workflows/*.yml (GitHub Actions)
- .gitlab-ci.yml (GitLab CI)
- Jenkinsfile (Jenkins)
- azure-pipelines.yml (Azure DevOps)
- .circleci/config.yml (CircleCI)

## Project Pattern Detection
- Monorepo: Multiple package.json files, lerna.json, nx.json, pnpm-workspace.yaml
- Microservices: Multiple Dockerfiles, service directories
- Modular monolith: Well-organized module structure

# Error Handling

If information is missing or unclear:
- Mark as "unknown" rather than guessing
- Note the limitation in your analysis
- Suggest what additional files would help

# Output Format

Respond ONLY with valid JSON matching this structure:

{
  "projectType": "nodejs" | "python" | "java-maven" | "java-gradle" | "dotnet" | "go" | "ruby" | "php" | "unknown",
  "languages": ["string"],
  "runtimeInfo": [{
    "language": "string",
    "version": "string",
    "source": "string"
  }],
  "frameworks": [{
    "name": "string",
    "version": "string",
    "type": "web" | "api" | "orm" | "testing" | "build" | "other"
  }],
  "packageManifests": [{
    "type": "string",
    "path": "string",
    "summary": "string"
  }],
  "ciConfig": {
    "platform": "string",
    "path": "string",
    "details": {}
  },
  "dockerInfo": {
    "hasDockerfile": boolean,
    "hasDockerCompose": boolean,
    "baseImage": "string",
    "nodeVersion": "string",
    "pythonVersion": "string",
    "javaVersion": "string"
  },
  "fileStructure": {
    "totalFiles": number,
    "codeFiles": number,
    "configFiles": number,
    "testFiles": number
  },
  "detectedPatterns": {
    "isMonorepo": boolean,
    "hasTests": boolean,
    "hasDocker": boolean,
    "hasCI": boolean,
    "hasLinting": boolean
  },
  "insights": ["string"],
  "upgradeReadiness": {
    "score": number,
    "factors": ["string"]
  }
}`;

export const REPO_PROFILER_USER_PROMPT_TEMPLATE = `# Repository Analysis Task

Analyze the following code repository files and create a comprehensive technology stack profile.

## Uploaded Files Summary

Total Files: {{totalFiles}}
Code Files: {{codeFiles}}
Config Files: {{configFiles}}

## Package Manifests Found

{{manifestsList}}

## CI/CD Configuration Files

{{ciFilesList}}

## Docker Files

{{dockerFilesList}}

## File Structure Preview

{{fileStructurePreview}}

## Key Files Content

{{keyFilesContent}}

## Analysis Instructions

1. Identify the primary project type (Node.js, Python, Java, etc.)
2. List all programming languages detected
3. Extract runtime versions from package manifests and Docker files
4. Identify all frameworks and their versions
5. Analyze CI/CD configuration
6. Assess Docker setup
7. Detect architectural patterns (monorepo, microservices, etc.)
8. Evaluate upgrade readiness based on current setup

Provide your analysis in the exact JSON format specified in your system prompt.`;

export function buildRepoProfilerPrompt(data: {
  totalFiles: number;
  codeFiles: number;
  configFiles: number;
  manifests: Array<{ type: string; path: string; content: string }>;
  ciFiles: Array<{ path: string; content: string }>;
  dockerFiles: Array<{ path: string; content: string }>;
  fileStructure: string;
  keyFiles: Array<{ path: string; content: string }>;
  codeAnalysis?: {
    analyzedFiles: number;
    totalLOC: number;
    packagesFromCode: Array<{ package: string; importCount: number; usedInFiles: number }>;
    frameworksFromCode: Array<{ name: string; usedInFiles: number }>;
    codeSamples: Array<{ file: string; language: string; preview: string }>;
  };
}): string {
  // Build manifests list
  const manifestsList = data.manifests.length > 0
    ? data.manifests.map(m => `- ${m.type} at ${m.path}`).join("\n")
    : "No package manifests found";

  // Build CI files list
  const ciFilesList = data.ciFiles.length > 0
    ? data.ciFiles.map(f => `- ${f.path}`).join("\n")
    : "No CI/CD configuration found";

  // Build Docker files list
  const dockerFilesList = data.dockerFiles.length > 0
    ? data.dockerFiles.map(f => `- ${f.path}`).join("\n")
    : "No Docker files found";

  // Build key files content with smart chunking for large manifests
  const perManifestBudget = Math.min(3000, Math.floor(40000 / Math.max(data.manifests.length, 1)));
  const keyFilesContent = data.manifests.length > 0
    ? data.manifests.map(m => {
        const content = chunkFileContent(m.content, perManifestBudget, m.path);
        const wasChunked = content.length < m.content.length;
        return `
### ${m.type} (${m.path})${wasChunked ? ` (chunked from ${m.content.length} chars)` : ''}
\`\`\`
${content}
\`\`\`
`;
      }).join("\n")
    : "No key configuration files to display";

  // Build code analysis section (NEW - DEEP ANALYSIS)
  let codeAnalysisSection = "";
  if (data.codeAnalysis) {
    const packagesText = data.codeAnalysis.packagesFromCode.length > 0
      ? data.codeAnalysis.packagesFromCode.map(p => 
          `- ${p.package} (imported ${p.importCount} times across ${p.usedInFiles} files)`
        ).join("\n")
      : "No external packages detected from code analysis";
    
    const frameworksText = data.codeAnalysis.frameworksFromCode.length > 0
      ? data.codeAnalysis.frameworksFromCode.map(f =>
          `- ${f.name} (detected in ${f.usedInFiles} files)`
        ).join("\n")
      : "No frameworks detected from code analysis";
    
    const codeSamplesText = data.codeAnalysis.codeSamples.length > 0
      ? data.codeAnalysis.codeSamples.map(s => `
### ${s.file} (${s.language})
\`\`\`${s.language}
${s.preview}
\`\`\`
`).join("\n")
      : "No code samples available";
    
    codeAnalysisSection = `
## Deep Code Analysis Results

**Files Analyzed**: ${data.codeAnalysis.analyzedFiles} code files
**Total Lines of Code**: ${data.codeAnalysis.totalLOC} LOC

### Packages Detected from Import Statements
${packagesText}

### Frameworks Detected from Code Usage
${frameworksText}

### Actual Code Samples
${codeSamplesText}

**Note**: The packages and frameworks above were detected by analyzing actual import statements and code patterns, not just manifest files. This provides a complete picture even if package.json or requirements.txt is missing.
`;
  } else {
    codeAnalysisSection = "\n## Deep Code Analysis\nNo code analysis performed.\n";
  }

  // Replace template variables
  let prompt = REPO_PROFILER_USER_PROMPT_TEMPLATE;
  prompt = prompt.replace("{{totalFiles}}", data.totalFiles.toString());
  prompt = prompt.replace("{{codeFiles}}", data.codeFiles.toString());
  prompt = prompt.replace("{{configFiles}}", data.configFiles.toString());
  prompt = prompt.replace("{{manifestsList}}", manifestsList);
  prompt = prompt.replace("{{ciFilesList}}", ciFilesList);
  prompt = prompt.replace("{{dockerFilesList}}", dockerFilesList);
  prompt = prompt.replace("{{fileStructurePreview}}", data.fileStructure);
  prompt = prompt.replace("{{keyFilesContent}}", keyFilesContent);
  
  // Add code analysis section at the end
  prompt += "\n\n" + codeAnalysisSection;

  return prompt;
}
