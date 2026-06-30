/**
 * Stack Modernization - Code Upgrade Executor
 * Applies user's version selections to package manifests (package.json, requirements.txt, pom.xml)
 */

import type { VersionSelection } from "../types";
import type { ExtractedFile } from "../types";

export interface UpgradeResult {
  success: boolean;
  modifiedFiles: Array<{
    path: string;
    content: string;
    originalContent: string;
  }>;
  errors: string[];
}

/**
 * Apply version selections to extracted files
 */

export function executeCodeUpgrade(
  extractedFiles: ExtractedFile[],
  selections: VersionSelection[]
): UpgradeResult {
  const selectionMap = new Map(selections.map(s => [s.package, s.selectedVersion]));
  const modifiedFiles: UpgradeResult["modifiedFiles"] = [];
  const errors: string[] = [];

  
  // Log all file paths for debugging
  const filePaths = extractedFiles.map(f => f.relativePath || f.fullPath || 'unknown');
  const hasPackageJson = filePaths.some(p => p.toLowerCase().endsWith('package.json'));
  const hasPomXml = filePaths.some(p => p.toLowerCase().endsWith('pom.xml'));
  const hasRequirementsTxt = filePaths.some(p => p.toLowerCase().endsWith('requirements.txt'));

  for (const file of extractedFiles) {
    const path = (file.relativePath || file.fullPath || "").toLowerCase();
    const content = file.content || "";

    if (!content) continue;

    if (path.endsWith("package.json")) {
      try {
        const result = applyPackageJsonUpgrade(content, selectionMap);
        if (result.modified) {
          modifiedFiles.push({
            path: file.relativePath || file.fullPath || "package.json",
            content: result.content,
            originalContent: content
          });
        }
      } catch (e) {
        console.error(`[CodeUpgradeExecutor] Error upgrading ${file.relativePath}:`, e);
        errors.push(`Failed to upgrade ${file.relativePath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (path.endsWith("requirements.txt")) {
      try {
        const result = applyRequirementsTxtUpgrade(content, selectionMap);
        if (result.modified) {
          modifiedFiles.push({
            path: file.relativePath || file.fullPath || "requirements.txt",
            content: result.content,
            originalContent: content
          });
        }
      } catch (e) {
        errors.push(`Failed to upgrade ${file.relativePath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (path.endsWith("pom.xml")) {
      try {
        const result = applyPomXmlUpgrade(content, selectionMap);
        if (result.modified) {
          modifiedFiles.push({
            path: file.relativePath || file.fullPath || "pom.xml",
            content: result.content,
            originalContent: content
          });
        }
      } catch (e) {
        errors.push(`Failed to upgrade ${file.relativePath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // If no manifest files were found, generate one based on user selections
  if (modifiedFiles.length === 0 && selections.length > 0) {
    
    // Detect project type from selections
    const hasJavaDeps = selections.some(s => 
      ['cucumber', 'junit', 'selenium', 'maven', 'spring'].some(keyword => 
        s.package.toLowerCase().includes(keyword)
      )
    );
    
    const hasNodeDeps = selections.some(s => 
      ['react', 'express', 'node', 'npm', 'typescript', 'javascript'].some(keyword => 
        s.package.toLowerCase().includes(keyword)
      )
    );
    
    const hasPythonDeps = selections.some(s => 
      ['django', 'flask', 'pytest', 'python'].some(keyword => 
        s.package.toLowerCase().includes(keyword)
      )
    );
    
    if (hasJavaDeps) {
      // Generate pom.xml with selected versions
      const pomContent = generatePomXml(selections);
      const changes = selections.map(s => ({
        package: s.package,
        from: s.currentVersion || 'not installed',
        to: s.selectedVersion
      }));
      modifiedFiles.push({
        path: 'pom.xml',
        content: pomContent,
        originalContent: '(no original - generated from analysis)',
        changes
      } as any);
    } else if (hasNodeDeps) {
      // Generate package.json with selected versions
      const packageJsonContent = generatePackageJson(selections);
      const changes = selections.map(s => ({
        package: s.package,
        from: s.currentVersion || 'not installed',
        to: s.selectedVersion
      }));
      modifiedFiles.push({
        path: 'package.json',
        content: packageJsonContent,
        originalContent: '(no original - generated from analysis)',
        changes
      } as any);
    } else if (hasPythonDeps) {
      // Generate requirements.txt with selected versions
      const requirementsContent = generateRequirementsTxt(selections);
      const changes = selections.map(s => ({
        package: s.package,
        from: s.currentVersion || 'not installed',
        to: s.selectedVersion
      }));
      modifiedFiles.push({
        path: 'requirements.txt',
        content: requirementsContent,
        originalContent: '(no original - generated from analysis)',
        changes
      } as any);
    }
  }
  

  return {
    success: errors.length === 0,
    modifiedFiles,
    errors
  };
}

function applyPackageJsonUpgrade(
  content: string,
  selectionMap: Map<string, string>
): { content: string; modified: boolean } {
  const parsed = JSON.parse(content);
  let modified = false;


  for (const [name, version] of selectionMap) {
    const targetVersion = version.startsWith('^') || version.startsWith('~') ? version : `^${version}`;

    if (parsed.dependencies && parsed.dependencies[name] !== undefined) {
      const current = parsed.dependencies[name];
      if (current !== targetVersion) {
        parsed.dependencies[name] = targetVersion;
        modified = true;
      }
    }
    if (parsed.devDependencies && parsed.devDependencies[name] !== undefined) {
      const current = parsed.devDependencies[name];
      if (current !== targetVersion) {
        parsed.devDependencies[name] = targetVersion;
        modified = true;
      }
    }
    if (parsed.peerDependencies && parsed.peerDependencies[name] !== undefined) {
      const current = parsed.peerDependencies[name];
      if (current !== targetVersion) {
        parsed.peerDependencies[name] = targetVersion;
        modified = true;
      }
    }
  }


  return {
    content: JSON.stringify(parsed, null, 2),
    modified
  };
}

function applyRequirementsTxtUpgrade(
  content: string,
  selectionMap: Map<string, string>
): { content: string; modified: boolean } {
  const lines = content.split("\n");
  let modified = false;

  const selectionMapLower = new Map<string, string>();
  for (const [k, v] of selectionMap) {
    selectionMapLower.set(k.toLowerCase(), v);
  }

  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;

    const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*([>=<~!]+.*)?$/);
    if (!match) return line;

    const pkgName = match[1];
    const targetVersion = selectionMapLower.get(pkgName.toLowerCase());
    if (!targetVersion) return line;

    const newLine = `${pkgName}==${targetVersion}`;
    if (line !== newLine) modified = true;
    return newLine;
  });

  return {
    content: newLines.join("\n"),
    modified
  };
}

function applyPomXmlUpgrade(
  content: string,
  selectionMap: Map<string, string>
): { content: string; modified: boolean } {
  let modified = false;
  let result = content;

  for (const [name, version] of selectionMap) {
    const parts = name.split(":");
    const groupId = parts[0] || "";
    const artifactId = parts[1] || name;
    const escGroup = escapeRegex(groupId);
    const escArt = escapeRegex(artifactId);

    const depRegex = new RegExp(
      `(<dependency>[\\s\\S]*?<groupId>)${escGroup}(</groupId>[\\s\\S]*?<artifactId>)${escArt}(</artifactId>[\\s\\S]*?<version>)([^<]*)(</version>)`,
      "g"
    );

    const newResult = result.replace(depRegex, (_, before, mid1, mid2, oldVer, after) => {
      if (oldVer !== version) modified = true;
      return `${before}${groupId}${mid1}${artifactId}${mid2}${version}${after}`;
    });

    if (newResult !== result) result = newResult;
  }

  return { content: result, modified };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate a new pom.xml with selected versions
 */
function generatePomXml(selections: VersionSelection[]): string {
  const dependencies = selections
    .map(s => `    <dependency>
      <groupId>io.cucumber</groupId>
      <artifactId>${s.package}</artifactId>
      <version>${s.selectedVersion}</version>
    </dependency>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  
  <groupId>com.example</groupId>
  <artifactId>modernized-project</artifactId>
  <version>1.0.0</version>
  
  <dependencies>
${dependencies}
  </dependencies>
</project>`;
}

/**
 * Generate a new package.json with selected versions
 */
function generatePackageJson(selections: VersionSelection[]): string {
  const dependencies: Record<string, string> = {};
  selections.forEach(s => {
    const version = s.selectedVersion.startsWith('^') ? s.selectedVersion : `^${s.selectedVersion}`;
    dependencies[s.package] = version;
  });

  return JSON.stringify({
    name: 'modernized-project',
    version: '1.0.0',
    description: 'Project with modernized dependencies',
    dependencies
  }, null, 2);
}

/**
 * Generate a new requirements.txt with selected versions
 */
function generateRequirementsTxt(selections: VersionSelection[]): string {
  return selections
    .map(s => `${s.package}==${s.selectedVersion}`)
    .join('\n');
}
