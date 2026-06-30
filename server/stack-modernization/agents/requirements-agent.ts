/**
 * Requirements Analysis Agent
 * Determines OS requirements, runtime prerequisites, SDK needs,
 * build tools, and environment constraints.
 */

import type { StackModernizationState, RequirementsAnalysisResult } from "../types";

export async function executeRequirementsAgent(
  state: StackModernizationState
): Promise<RequirementsAnalysisResult> {
  const files = state.extractedFiles || [];
  const profile = state.repoProfile;

  const osRequirements: string[] = [];
  const runtimePrereqs: RequirementsAnalysisResult["runtimePrereqs"] = [];
  const envConstraints: RequirementsAnalysisResult["envConstraints"] = [];
  const sdks: string[] = [];
  const buildTools: string[] = [];
  let containerized = false;
  let cicdPlatform: string | undefined;

  // Runtime prerequisites from repoProfile
  for (const rt of profile?.runtimeInfo || []) {
    runtimePrereqs.push({
      runtime: rt.language,
      minVersion: rt.version || "unknown",
      currentVersion: rt.version || undefined,
    });
  }

  // Detect containerization
  const dockerFiles = files.filter((f) => {
    const name = f.relativePath.toLowerCase();
    return name.includes("dockerfile") || name.includes("docker-compose");
  });
  containerized = dockerFiles.length > 0;
  if (containerized) {
    buildTools.push("Docker");
    for (const df of dockerFiles) {
      const fromMatch = df.content.match(/^FROM\s+(.+)/im);
      if (fromMatch) {
        const baseImage = fromMatch[1].trim();
        osRequirements.push(`Base image: ${baseImage}`);
      }
    }
  }

  // CI/CD detection
  if (profile?.ciConfig?.platform) {
    cicdPlatform = profile.ciConfig.platform;
  } else {
    for (const f of files) {
      const p = f.relativePath.toLowerCase();
      if (p.includes(".github/workflows")) { cicdPlatform = "github-actions"; break; }
      if (p.includes(".gitlab-ci")) { cicdPlatform = "gitlab-ci"; break; }
      if (p.includes("azure-pipelines") || p.includes("azure-pipeline")) { cicdPlatform = "azure-devops"; break; }
      if (p.includes("jenkinsfile")) { cicdPlatform = "jenkins"; break; }
    }
  }

  // Build tools from manifests and project structure
  for (const m of profile?.packageManifests || []) {
    switch (m.type) {
      case "package.json":
        buildTools.push("npm/Node.js");
        if (m.parsed?.scripts?.build) {
          const buildScript = String(m.parsed.scripts.build);
          if (buildScript.includes("webpack")) buildTools.push("Webpack");
          if (buildScript.includes("vite")) buildTools.push("Vite");
          if (buildScript.includes("tsc")) buildTools.push("TypeScript Compiler");
          if (buildScript.includes("rollup")) buildTools.push("Rollup");
        }
        break;
      case "pom.xml": buildTools.push("Maven"); sdks.push("Java JDK"); break;
      case "build.gradle": buildTools.push("Gradle"); sdks.push("Java JDK"); break;
      case "csproj": buildTools.push(".NET SDK"); sdks.push(".NET SDK"); break;
      case "requirements.txt": buildTools.push("pip"); sdks.push("Python"); break;
      case "go.mod": buildTools.push("Go"); sdks.push("Go SDK"); break;
      case "Cargo.toml": buildTools.push("Cargo"); sdks.push("Rust"); break;
    }
  }

  // Environment variables from .env files and code
  const envVarPattern = /process\.env\.(\w+)|os\.environ\[['"](\w+)['"]\]|Environment\.GetEnvironmentVariable\(["'](\w+)["']\)/g;
  const envVarNames = new Set<string>();
  for (const f of files) {
    if (!f.content) continue;
    let match;
    while ((match = envVarPattern.exec(f.content)) !== null) {
      const name = match[1] || match[2] || match[3];
      if (name && name.length > 2 && name.length < 50) envVarNames.add(name);
    }
    envVarPattern.lastIndex = 0;
  }

  // Classify env vars
  const knownRequired = ["DATABASE_URL", "DB_HOST", "REDIS_URL", "API_KEY", "SECRET_KEY", "JWT_SECRET"];
  for (const name of envVarNames) {
    envConstraints.push({
      name,
      description: `Environment variable used in code`,
      type: knownRequired.some((k) => name.toUpperCase().includes(k)) ? "required" : "optional",
    });
  }

  // OS-specific requirements
  for (const f of files) {
    if (f.content.includes("Windows") && f.content.includes("Registry")) {
      osRequirements.push("Windows (Registry access detected)");
    }
    if (/System\.ServiceProcess|windows-service/i.test(f.content)) {
      osRequirements.push("Windows (Windows Service detected)");
    }
  }

  if (osRequirements.length === 0) {
    osRequirements.push("Cross-platform compatible");
  }

  // Deduplicate
  const uniqueBuildTools = [...new Set(buildTools)];
  const uniqueSdks = [...new Set(sdks)];

  return {
    osRequirements: [...new Set(osRequirements)],
    runtimePrereqs,
    envConstraints: envConstraints.slice(0, 30),
    sdks: uniqueSdks,
    buildTools: uniqueBuildTools,
    containerized,
    cicdPlatform,
  };
}
