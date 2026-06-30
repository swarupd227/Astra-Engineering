/**
 * Stack Modernization - File Parser Service
 * Parse package manifests and extract dependency information
 */

import type { ExtractedFile, PackageManifest, RuntimeInfo } from "../types";

/**
 * Parse package.json (Node.js/JavaScript)
 */
export function parsePackageJson(content: string, path: string): PackageManifest | null {
  try {
    const parsed = JSON.parse(content);
    return {
      type: "package.json",
      path,
      content,
      parsed,
    };
  } catch (error) {
    console.error("[FileParser] Error parsing package.json:", error);
    return null;
  }
}

/**
 * Parse requirements.txt (Python)
 */
export function parseRequirementsTxt(content: string, path: string): PackageManifest | null {
  try {
    const lines = content.split("\n").filter(line => line.trim() && !line.startsWith("#"));
    const dependencies = lines.map(line => {
      const match = line.match(/^([a-zA-Z0-9-_.]+)([>=<~!]+.*)?$/);
      if (match) {
        return {
          package: match[1],
          version: match[2]?.trim() || "*",
        };
      }
      return null;
    }).filter(Boolean);
    
    return {
      type: "requirements.txt",
      path,
      content,
      parsed: { dependencies },
    };
  } catch (error) {
    console.error("[FileParser] Error parsing requirements.txt:", error);
    return null;
  }
}

/**
 * Parse pom.xml (Java Maven)
 */
export function parsePomXml(content: string, pomPath: string): PackageManifest | null {
  try {
    // Also extract parent POM info (provides inherited versions for Spring Boot, etc.)
    let parent: { groupId: string; artifactId: string; version?: string } | undefined;
    const parentBlock = content.match(/<parent>([\s\S]*?)<\/parent>/);
    if (parentBlock) {
      const pGroupId = parentBlock[1].match(/<groupId>\s*(.*?)\s*<\/groupId>/)?.[1];
      const pArtifactId = parentBlock[1].match(/<artifactId>\s*(.*?)\s*<\/artifactId>/)?.[1];
      const pVersion = parentBlock[1].match(/<version>\s*(.*?)\s*<\/version>/)?.[1];
      if (pGroupId && pArtifactId) {
        parent = { groupId: pGroupId, artifactId: pArtifactId, version: pVersion };
      }
    }

    // Extract project properties (for ${property} version resolution)
    const properties: Record<string, string> = {};
    const propsBlock = content.match(/<properties>([\s\S]*?)<\/properties>/);
    if (propsBlock) {
      const propRegex = /<([\w.-]+)>\s*(.*?)\s*<\/\1>/g;
      let propMatch;
      while ((propMatch = propRegex.exec(propsBlock[1])) !== null) {
        properties[propMatch[1]] = propMatch[2];
      }
    }

    // Helper to resolve ${property} references
    const resolveVersion = (v: string | undefined): string | undefined => {
      if (!v) return undefined;
      if (v.startsWith("${") && v.endsWith("}")) {
        const propName = v.slice(2, -1);
        if (propName === "project.version") return parent?.version;
        return properties[propName] || undefined;
      }
      return v;
    };

    // Parse dependencyManagement for BOM-managed versions
    const managedVersions: Record<string, string> = {};
    const depMgmtBlock = content.match(/<dependencyManagement>([\s\S]*?)<\/dependencyManagement>/);
    if (depMgmtBlock) {
      const mgmtDepRegex = /<dependency>([\s\S]*?)<\/dependency>/g;
      let mgmtMatch;
      while ((mgmtMatch = mgmtDepRegex.exec(depMgmtBlock[1])) !== null) {
        const block = mgmtMatch[1];
        const gId = block.match(/<groupId>\s*(.*?)\s*<\/groupId>/)?.[1];
        const aId = block.match(/<artifactId>\s*(.*?)\s*<\/artifactId>/)?.[1];
        const ver = block.match(/<version>\s*(.*?)\s*<\/version>/)?.[1];
        if (gId && aId && ver) {
          managedVersions[`${gId}:${aId}`] = resolveVersion(ver) || ver;
        }
      }
    }

    // Extract direct dependencies (excluding dependencyManagement block)
    const dependencies: Array<{ groupId: string; artifactId: string; version?: string; scope?: string }> = [];
    const contentWithoutMgmt = content.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/, '');
    const depBlockRegex = /<dependency>([\s\S]*?)<\/dependency>/g;
    let blockMatch;
    while ((blockMatch = depBlockRegex.exec(contentWithoutMgmt)) !== null) {
      const block = blockMatch[1];
      const groupId = block.match(/<groupId>\s*(.*?)\s*<\/groupId>/)?.[1];
      const artifactId = block.match(/<artifactId>\s*(.*?)\s*<\/artifactId>/)?.[1];
      const version = block.match(/<version>\s*(.*?)\s*<\/version>/)?.[1];
      const scope = block.match(/<scope>\s*(.*?)\s*<\/scope>/)?.[1];

      if (groupId && artifactId) {
        dependencies.push({ groupId, artifactId, version: version || undefined, scope: scope || undefined });
      }
    }

    // Resolve all dependency versions
    for (const dep of dependencies) {
      // Resolve ${property} references
      if (dep.version) {
        dep.version = resolveVersion(dep.version);
      }
      // Fall back to dependencyManagement version
      if (!dep.version) {
        const coord = `${dep.groupId}:${dep.artifactId}`;
        dep.version = managedVersions[coord] || undefined;
      }
      // Fall back to parent version
      if (!dep.version && parent?.version) {
        dep.version = parent.version;
      }
    }

    // Extract Java version from multiple possible locations
    const javaVersion =
      properties["maven.compiler.source"] ||
      properties["java.version"] ||
      properties["maven.compiler.release"] ||
      content.match(/<maven\.compiler\.source>\s*(.*?)\s*<\/maven\.compiler\.source>/)?.[1];

    // Extract Spring Boot version from parent or properties
    const springBootVersion = parent?.artifactId?.includes("spring-boot") ? parent.version : properties["spring-boot.version"];


    return {
      type: "pom.xml",
      path: pomPath,
      content,
      parsed: {
        dependencies,
        parent,
        properties,
        managedVersions,
        javaVersion,
        springBootVersion,
      },
    };
  } catch (error) {
    console.error("[FileParser] Error parsing pom.xml:", error);
    return null;
  }
}

/**
 * Parse build.gradle (Java Gradle)
 */
export function parseBuildGradle(content: string, path: string): PackageManifest | null {
  try {
    // Extract dependencies from dependencies block
    const dependenciesBlock = content.match(/dependencies\s*\{([\s\S]*?)\}/);
    const dependencies: Array<{ configuration: string; notation: string }> = [];
    
    if (dependenciesBlock) {
      const depLines = dependenciesBlock[1].split("\n");
      for (const line of depLines) {
        const match = line.match(/(implementation|api|compileOnly|runtimeOnly|testImplementation)\s+['"]([^'"]+)['"]/);
        if (match) {
          dependencies.push({
            configuration: match[1],
            notation: match[2],
          });
        }
      }
    }
    
    // Extract Java version
    const javaVersionMatch = content.match(/sourceCompatibility\s*=\s*['"]?(\d+)['"]?/);
    const javaVersion = javaVersionMatch ? javaVersionMatch[1] : undefined;
    
    return {
      type: "build.gradle",
      path,
      content,
      parsed: {
        dependencies,
        javaVersion,
      },
    };
  } catch (error) {
    console.error("[FileParser] Error parsing build.gradle:", error);
    return null;
  }
}

/**
 * Parse go.mod (Go)
 */
export function parseGoMod(content: string, path: string): PackageManifest | null {
  try {
    // Extract Go version
    const goVersionMatch = content.match(/^go\s+(\d+\.\d+)/m);
    const goVersion = goVersionMatch ? goVersionMatch[1] : undefined;
    
    // Extract dependencies
    const requireBlock = content.match(/require\s+\(([\s\S]*?)\)/);
    const dependencies: Array<{ module: string; version: string }> = [];
    
    if (requireBlock) {
      const depLines = requireBlock[1].split("\n");
      for (const line of depLines) {
        const match = line.trim().match(/^([^\s]+)\s+v?([^\s]+)/);
        if (match) {
          dependencies.push({
            module: match[1],
            version: match[2],
          });
        }
      }
    }
    
    return {
      type: "go.mod",
      path,
      content,
      parsed: {
        goVersion,
        dependencies,
      },
    };
  } catch (error) {
    console.error("[FileParser] Error parsing go.mod:", error);
    return null;
  }
}

/**
 * Parse Gemfile (Ruby)
 */
export function parseGemfile(content: string, path: string): PackageManifest | null {
  try {
    const gemLines = content.split("\n").filter(line => line.trim().startsWith("gem"));
    const dependencies: Array<{ name: string; version?: string }> = [];
    
    for (const line of gemLines) {
      const match = line.match(/gem\s+['"]([^'"]+)['"](?:,\s*['"]([^'"]+)['"])?/);
      if (match) {
        dependencies.push({
          name: match[1],
          version: match[2],
        });
      }
    }
    
    // Extract Ruby version
    const rubyVersionMatch = content.match(/ruby\s+['"]([^'"]+)['"]/);
    const rubyVersion = rubyVersionMatch ? rubyVersionMatch[1] : undefined;
    
    return {
      type: "Gemfile",
      path,
      content,
      parsed: {
        dependencies,
        rubyVersion,
      },
    };
  } catch (error) {
    console.error("[FileParser] Error parsing Gemfile:", error);
    return null;
  }
}

/**
 * Parse composer.json (PHP)
 */
export function parseComposerJson(content: string, path: string): PackageManifest | null {
  try {
    const parsed = JSON.parse(content);
    return {
      type: "composer.json",
      path,
      content,
      parsed,
    };
  } catch (error) {
    console.error("[FileParser] Error parsing composer.json:", error);
    return null;
  }
}

/**
 * Parse .csproj (.NET)
 * Extracts TargetFramework/TargetFrameworks, TargetFrameworkVersion, and PackageReference entries.
 */
export function parseCsproj(content: string, path: string): PackageManifest | null {
  try {
    let targetFramework: string | undefined;
    let targetFrameworks: string[] | undefined;
    let targetFrameworkVersion: string | undefined;

    // <TargetFramework>net8.0</TargetFramework> or <TargetFrameworks>net7.0;net6.0</TargetFrameworks>
    const tfMatch = content.match(/<TargetFrameworks?>\s*([^<]+)\s*<\/TargetFrameworks?>/i);
    if (tfMatch) {
      const value = tfMatch[1].trim();
      if (value.includes(";")) {
        targetFrameworks = value.split(";").map((s) => s.trim());
        targetFramework = targetFrameworks[0];
      } else {
        targetFramework = value;
      }
    }

    // Legacy: <TargetFrameworkVersion>v4.7.2</TargetFrameworkVersion>
    if (!targetFramework) {
      const versionMatch = content.match(/<TargetFrameworkVersion>\s*v?([^<]+)\s*<\/TargetFrameworkVersion>/i);
      if (versionMatch) {
        targetFrameworkVersion = versionMatch[1].replace(/^v/, "").trim();
      }
    }

    // <PackageReference Include="PackageName" Version="1.0.0" />
    const dependencies: Array<{ name: string; version: string }> = [];
    const packageRefRegex = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"\s*\/?>/gi;
    let refMatch;
    while ((refMatch = packageRefRegex.exec(content)) !== null) {
      dependencies.push({
        name: refMatch[1].trim(),
        version: refMatch[2].trim(),
      });
    }

    return {
      type: "csproj",
      path,
      content,
      parsed: {
        targetFramework,
        targetFrameworks,
        targetFrameworkVersion,
        dependencies,
      },
    };
  } catch (error) {
    console.error("[FileParser] Error parsing .csproj:", error);
    return null;
  }
}

/**
 * Parse Cargo.toml (Rust)
 */
export function parseCargoToml(content: string, path: string): PackageManifest | null {
  try {
    // Simple TOML parsing for dependencies
    const dependenciesBlock = content.match(/\[dependencies\]([\s\S]*?)(?=\n\[|$)/);
    const dependencies: Array<{ name: string; version: string }> = [];
    
    if (dependenciesBlock) {
      const depLines = dependenciesBlock[1].split("\n");
      for (const line of depLines) {
        const match = line.match(/^([^\s=]+)\s*=\s*["']([^"']+)["']/);
        if (match) {
          dependencies.push({
            name: match[1].trim(),
            version: match[2],
          });
        }
      }
    }
    
    return {
      type: "Cargo.toml",
      path,
      content,
      parsed: { dependencies },
    };
  } catch (error) {
    console.error("[FileParser] Error parsing Cargo.toml:", error);
    return null;
  }
}

/**
 * Parse libman.json (ASP.NET Core client-side library manager)
 */
export function parseLibManJson(content: string, path: string): PackageManifest | null {
  try {
    const parsed = JSON.parse(content);
    const libraries = parsed.libraries || [];
    const dependencies: Array<{ name: string; version?: string }> = [];
    for (const lib of libraries) {
      const raw: string = lib.library || lib.name || "";
      if (!raw) continue;
      const atIdx = raw.lastIndexOf("@");
      const pkgName = atIdx > 0 ? raw.slice(0, atIdx).trim() : raw.trim();
      const version = atIdx > 0 ? raw.slice(atIdx + 1).trim() : undefined;
      dependencies.push({ name: pkgName, version });
    }
    return {
      type: "libman.json",
      path,
      content,
      raw: content,
      parsed: { dependencies, provider: parsed.defaultProvider || "cdnjs" },
    } as PackageManifest;
  } catch {
    return null;
  }
}

/**
 * Parse bower.json (Bower package manager)
 */
export function parseBowerJson(content: string, path: string): PackageManifest | null {
  try {
    const parsed = JSON.parse(content);
    const deps: Record<string, string> = { ...parsed.dependencies, ...parsed.devDependencies };
    const dependencies = Object.entries(deps).map(([name, version]) => ({
      name,
      version: String(version || "*").replace(/[\^~>=<]/g, "").trim() || "*",
    }));
    return {
      type: "bower.json",
      path,
      content,
      raw: content,
      parsed: { name: parsed.name, dependencies },
    } as PackageManifest;
  } catch {
    return null;
  }
}

/**
 * Parse all manifest files
 */
export function parseManifestFiles(manifestFiles: ExtractedFile[]): PackageManifest[] {
  const parsedManifests: PackageManifest[] = [];
  
  for (const file of manifestFiles) {
    const filename = file.relativePath.toLowerCase();
    let parsed: PackageManifest | null = null;
    
    if (filename.endsWith("package.json")) {
      parsed = parsePackageJson(file.content, file.relativePath);
    } else if (filename.endsWith("requirements.txt")) {
      parsed = parseRequirementsTxt(file.content, file.relativePath);
    } else if (filename.endsWith("pom.xml")) {
      parsed = parsePomXml(file.content, file.relativePath);
    } else if (filename.endsWith("build.gradle") || filename.endsWith("build.gradle.kts")) {
      parsed = parseBuildGradle(file.content, file.relativePath);
    } else if (filename.endsWith("go.mod")) {
      parsed = parseGoMod(file.content, file.relativePath);
    } else if (filename.endsWith("gemfile")) {
      parsed = parseGemfile(file.content, file.relativePath);
    } else if (filename.endsWith("composer.json")) {
      parsed = parseComposerJson(file.content, file.relativePath);
    } else if (filename.endsWith("cargo.toml")) {
      parsed = parseCargoToml(file.content, file.relativePath);
    } else if (filename.endsWith(".csproj")) {
      parsed = parseCsproj(file.content, file.relativePath);
    } else if (filename.endsWith("libman.json")) {
      parsed = parseLibManJson(file.content, file.relativePath);
    } else if (filename.endsWith("bower.json")) {
      parsed = parseBowerJson(file.content, file.relativePath);
    }

    if (parsed) {
      parsedManifests.push(parsed);
    }
  }
  
  return parsedManifests;
}

/**
 * Extract runtime information from manifests
 */
export function extractRuntimeInfo(manifests: PackageManifest[]): RuntimeInfo[] {
  const runtimeInfo: RuntimeInfo[] = [];
  
  for (const manifest of manifests) {
    switch (manifest.type) {
      case "package.json":
        if (manifest.parsed.engines?.node) {
          runtimeInfo.push({
            language: "Node.js",
            version: manifest.parsed.engines.node,
            source: "package.json engines field",
          });
        }
        break;
        
      case "pom.xml":
        if (manifest.parsed.javaVersion) {
          runtimeInfo.push({
            language: "Java",
            version: manifest.parsed.javaVersion,
            source: "pom.xml maven.compiler.source",
          });
        }
        break;
        
      case "build.gradle":
        if (manifest.parsed.javaVersion) {
          runtimeInfo.push({
            language: "Java",
            version: manifest.parsed.javaVersion,
            source: "build.gradle sourceCompatibility",
          });
        }
        break;
        
      case "go.mod":
        if (manifest.parsed.goVersion) {
          runtimeInfo.push({
            language: "Go",
            version: manifest.parsed.goVersion,
            source: "go.mod go directive",
          });
        }
        break;
        
      case "Gemfile":
        if (manifest.parsed.rubyVersion) {
          runtimeInfo.push({
            language: "Ruby",
            version: manifest.parsed.rubyVersion,
            source: "Gemfile ruby directive",
          });
        }
        break;

      case "csproj": {
        const p = manifest.parsed as { targetFramework?: string; targetFrameworkVersion?: string };
        if (p.targetFramework) {
          // net8.0, net472, netcoreapp3.1 -> normalize to version string
          let version: string | undefined;
          const coreMatch = p.targetFramework.match(/^net(\d+)\.(\d+)$/);
          const frameworkMatch = p.targetFramework.match(/^net(\d)(\d)(\d?)$/);
          const netCoreMatch = p.targetFramework.match(/^netcoreapp(\d+)\.(\d+)$/);
          if (coreMatch) {
            version = `${coreMatch[1]}.${coreMatch[2]}`;
          } else if (frameworkMatch && !coreMatch) {
            version = frameworkMatch[3]
              ? `${frameworkMatch[1]}.${frameworkMatch[2]}.${frameworkMatch[3]}`
              : `${frameworkMatch[1]}.${frameworkMatch[2]}`;
          } else if (netCoreMatch) {
            version = `${netCoreMatch[1]}.${netCoreMatch[2]}`;
          } else {
            version = p.targetFramework.replace(/^net/i, "").replace(/\./g, ".");
          }
          if (version) {
            runtimeInfo.push({
              language: ".NET",
              version,
              source: ".csproj TargetFramework",
            });
          }
        } else if (p.targetFrameworkVersion) {
          runtimeInfo.push({
            language: ".NET Framework",
            version: p.targetFrameworkVersion,
            source: ".csproj TargetFrameworkVersion",
          });
        }
        break;
      }
    }
  }

  return runtimeInfo;
}

/**
 * Parse Dockerfile for runtime information
 */
export function parseDockerfile(content: string): {
  baseImage?: string;
  nodeVersion?: string;
  pythonVersion?: string;
  javaVersion?: string;
} {
  const result: {
    baseImage?: string;
    nodeVersion?: string;
    pythonVersion?: string;
    javaVersion?: string;
  } = {};
  
  // Extract FROM instruction
  const fromMatch = content.match(/^FROM\s+([^\s]+)/m);
  if (fromMatch) {
    result.baseImage = fromMatch[1];
    
    // Extract versions from base image
    if (result.baseImage.includes("node:")) {
      const nodeMatch = result.baseImage.match(/node:(\d+)/);
      if (nodeMatch) result.nodeVersion = nodeMatch[1];
    } else if (result.baseImage.includes("python:")) {
      const pythonMatch = result.baseImage.match(/python:(\d+\.\d+)/);
      if (pythonMatch) result.pythonVersion = pythonMatch[1];
    } else if (result.baseImage.includes("openjdk:") || result.baseImage.includes("java:")) {
      const javaMatch = result.baseImage.match(/(?:openjdk|java):(\d+)/);
      if (javaMatch) result.javaVersion = javaMatch[1];
    }
  }
  
  return result;
}
