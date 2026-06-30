/**
 * Stack Modernization - Code Analyzer Service
 * Deep code analysis - parse imports, detect frameworks, analyze patterns
 * 
 * This service performs ACTUAL code analysis, not just metadata scanning
 */

import type { ExtractedFile, CdnReference, InferredLibrary } from "../types";

export interface ImportStatement {
  package: string;
  version?: string;
  isLocal: boolean;
  importType: "esm" | "cjs" | "python" | "java" | "other";
  line: number;
  statement: string;
}

export interface CodeAnalysisResult {
  file: string;
  language: string;
  imports: ImportStatement[];
  frameworks: string[];
  patterns: string[];
  linesOfCode: number;
}

/**
 * Parse JavaScript/TypeScript imports and requires
 */
export function parseJavaScriptImports(content: string, filePath: string): ImportStatement[] {
  const imports: ImportStatement[] = [];
  const lines = content.split('\n');
  
  lines.forEach((line, index) => {
    // ES6 imports: import React from 'react'
    const esImportMatch = line.match(/import\s+(?:{[^}]*}|[\w*]+(?:\s*,\s*{[^}]*})?)\s+from\s+['"]([^'"]+)['"]/);
    if (esImportMatch) {
      const packageName = esImportMatch[1];
      imports.push({
        package: packageName,
        isLocal: packageName.startsWith('./') || packageName.startsWith('../') || packageName.startsWith('/'),
        importType: 'esm',
        line: index + 1,
        statement: line.trim()
      });
    }
    
    // Dynamic imports: import('react')
    const dynamicImportMatch = line.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (dynamicImportMatch) {
      const packageName = dynamicImportMatch[1];
      imports.push({
        package: packageName,
        isLocal: packageName.startsWith('./') || packageName.startsWith('../'),
        importType: 'esm',
        line: index + 1,
        statement: line.trim()
      });
    }
    
    // CommonJS: const express = require('express')
    const requireMatch = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch) {
      const packageName = requireMatch[1];
      imports.push({
        package: packageName,
        isLocal: packageName.startsWith('./') || packageName.startsWith('../'),
        importType: 'cjs',
        line: index + 1,
        statement: line.trim()
      });
    }
  });
  
  return imports;
}

/**
 * Parse Python imports
 */
export function parsePythonImports(content: string, filePath: string): ImportStatement[] {
  const imports: ImportStatement[] = [];
  const lines = content.split('\n');
  
  lines.forEach((line, index) => {
    // import package
    const importMatch = line.match(/^import\s+([\w.]+)/);
    if (importMatch) {
      const packageName = importMatch[1].split('.')[0]; // Get root package
      imports.push({
        package: packageName,
        isLocal: false, // Python local imports are relative
        importType: 'python',
        line: index + 1,
        statement: line.trim()
      });
    }
    
    // from package import something
    const fromImportMatch = line.match(/^from\s+([\w.]+)\s+import/);
    if (fromImportMatch) {
      const packageName = fromImportMatch[1].split('.')[0];
      // Skip relative imports (from .module import)
      if (!packageName.startsWith('.')) {
        imports.push({
          package: packageName,
          isLocal: false,
          importType: 'python',
          line: index + 1,
          statement: line.trim()
        });
      }
    }
  });
  
  return imports;
}

/**
 * Parse Java imports — extracts Maven-style groupId:artifactId where possible
 */
export function parseJavaImports(content: string, filePath: string): ImportStatement[] {
  const imports: ImportStatement[] = [];
  const lines = content.split('\n');

  // Detect the project's own package from the first `package` declaration
  let projectBasePackage: string | undefined;
  for (const l of lines) {
    const pkgMatch = l.match(/^\s*package\s+([\w.]+)\s*;/);
    if (pkgMatch) {
      projectBasePackage = pkgMatch[1];
      break;
    }
  }

  // Java standard library prefixes — these are NOT external dependencies
  const javaStdPrefixes = [
    "java.", "javax.", "sun.", "com.sun.", "jdk.", "org.xml.sax",
    "org.w3c.dom", "org.ietf.jgss",
  ];

  // Map well-known import prefixes → Maven groupId:artifactId
  const knownPrefixToMaven: Record<string, string> = {
    "org.springframework.boot": "org.springframework.boot:spring-boot-starter",
    "org.springframework.web": "org.springframework:spring-web",
    "org.springframework.data": "org.springframework.data:spring-data-commons",
    "org.springframework.security": "org.springframework.security:spring-security-core",
    "org.springframework.cloud": "org.springframework.cloud:spring-cloud-starter",
    "org.springframework.kafka": "org.springframework.kafka:spring-kafka",
    "org.springframework": "org.springframework:spring-core",
    "org.hibernate": "org.hibernate:hibernate-core",
    "org.apache.commons.lang": "org.apache.commons:commons-lang3",
    "org.apache.commons.io": "commons-io:commons-io",
    "org.apache.commons.collections": "org.apache.commons:commons-collections4",
    "org.apache.kafka": "org.apache.kafka:kafka-clients",
    "org.apache.http": "org.apache.httpcomponents:httpclient",
    "org.apache.logging.log4j": "org.apache.logging.log4j:log4j-core",
    "org.slf4j": "org.slf4j:slf4j-api",
    "ch.qos.logback": "ch.qos.logback:logback-classic",
    "com.fasterxml.jackson": "com.fasterxml.jackson.core:jackson-databind",
    "com.google.gson": "com.google.code.gson:gson",
    "com.google.guava": "com.google.guava:guava",
    "org.junit.jupiter": "org.junit.jupiter:junit-jupiter",
    "org.junit": "junit:junit",
    "org.mockito": "org.mockito:mockito-core",
    "org.assertj": "org.assertj:assertj-core",
    "io.swagger": "io.swagger.core.v3:swagger-core",
    "jakarta.persistence": "jakarta.persistence:jakarta.persistence-api",
    "jakarta.servlet": "jakarta.servlet:jakarta.servlet-api",
    "javax.persistence": "javax.persistence:javax.persistence-api",
    "javax.servlet": "javax.servlet:javax.servlet-api",
    "lombok": "org.projectlombok:lombok",
    "org.projectlombok": "org.projectlombok:lombok",
    "com.zaxxer.hikari": "com.zaxxer:HikariCP",
    "org.flywaydb": "org.flywaydb:flyway-core",
    "org.liquibase": "org.liquibase:liquibase-core",
    "io.micrometer": "io.micrometer:micrometer-core",
    "org.mapstruct": "org.mapstruct:mapstruct",
    "org.thymeleaf": "org.thymeleaf:thymeleaf",
  };

  lines.forEach((line, index) => {
    // import org.springframework.boot.SpringApplication;
    // import static org.junit.Assert.assertEquals;
    const importMatch = line.match(/^\s*import\s+(?:static\s+)?([\w.]+);/);
    if (!importMatch) return;

    const fullPackage = importMatch[1];

    // Skip Java standard library
    if (javaStdPrefixes.some((p) => fullPackage.startsWith(p))) return;

    // Skip project-local imports (same base package as the file's own package)
    if (projectBasePackage && fullPackage.startsWith(projectBasePackage)) {
      return;
    }

    // Resolve to Maven coordinate using longest prefix match
    let mavenCoord: string | undefined;
    let bestLen = 0;
    for (const [prefix, coord] of Object.entries(knownPrefixToMaven)) {
      if (fullPackage.startsWith(prefix) && prefix.length > bestLen) {
        mavenCoord = coord;
        bestLen = prefix.length;
      }
    }

    // Fallback: derive groupId from first 2-3 segments (org.example.lib → org.example)
    if (!mavenCoord) {
      const parts = fullPackage.split(".");
      // Use first 2 segments as groupId, next as artifactId (heuristic)
      if (parts.length >= 3) {
        const groupId = parts.slice(0, 2).join(".");
        const artifactId = parts[2];
        mavenCoord = `${groupId}:${artifactId}`;
      } else {
        mavenCoord = fullPackage;
      }
    }

    imports.push({
      package: mavenCoord,
      isLocal: false,
      importType: "java",
      line: index + 1,
      statement: line.trim(),
    });
  });

  return imports;
}

/**
 * Detect frameworks from code content
 */
export function detectFrameworksFromCode(content: string, language: string): string[] {
  const frameworks: string[] = [];
  const contentLower = content.toLowerCase();
  
  // JavaScript/TypeScript frameworks
  if (language === 'javascript' || language === 'typescript') {
    if (content.includes('from \'react\'') || content.includes('from "react"') || content.includes('require(\'react\')')) {
      frameworks.push('React');
    }
    if (content.includes('from \'vue\'') || content.includes('from "vue"')) {
      frameworks.push('Vue');
    }
    if (content.includes('from \'@angular') || content.includes('from "@angular')) {
      frameworks.push('Angular');
    }
    if (content.includes('from \'express\'') || content.includes('require(\'express\')')) {
      frameworks.push('Express');
    }
    if (content.includes('from \'next') || content.includes('from "next')) {
      frameworks.push('Next.js');
    }
    if (content.includes('from \'@nestjs') || content.includes('from "@nestjs')) {
      frameworks.push('NestJS');
    }
  }
  
  // Python frameworks
  if (language === 'python') {
    if (content.includes('from flask import') || content.includes('import flask')) {
      frameworks.push('Flask');
    }
    if (content.includes('from django') || content.includes('import django')) {
      frameworks.push('Django');
    }
    if (content.includes('from fastapi import') || content.includes('import fastapi')) {
      frameworks.push('FastAPI');
    }
  }
  
  // Java frameworks
  if (language === 'java') {
    if (content.includes('org.springframework')) {
      frameworks.push('Spring');
    }
    if (content.includes('org.springframework.boot')) {
      frameworks.push('Spring Boot');
    }
  }
  
  return frameworks;
}

/**
 * Detect code patterns (async/await, hooks, decorators, etc.)
 */
export function detectCodePatterns(content: string, language: string): string[] {
  const patterns: string[] = [];
  
  if (language === 'javascript' || language === 'typescript') {
    if (content.includes('async ') && content.includes('await ')) {
      patterns.push('async/await');
    }
    if (content.includes('useState') || content.includes('useEffect')) {
      patterns.push('React Hooks');
    }
    if (content.includes('class ') && content.includes('extends')) {
      patterns.push('ES6 Classes');
    }
    if (content.includes('=>')) {
      patterns.push('Arrow Functions');
    }
    if (content.includes('@')) {
      patterns.push('Decorators');
    }
  }
  
  if (language === 'python') {
    if (content.includes('async def')) {
      patterns.push('async/await');
    }
    if (content.includes('@')) {
      patterns.push('Decorators');
    }
    if (content.includes('class ') && content.includes('(')) {
      patterns.push('OOP/Classes');
    }
  }
  
  return patterns;
}

/**
 * Count lines of actual code (excluding comments and blank lines)
 */
export function countLinesOfCode(content: string): number {
  const lines = content.split('\n');
  let count = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
      count++;
    }
  }
  
  return count;
}

/**
 * Analyze a single code file deeply
 */
export function analyzeCodeFile(file: ExtractedFile): CodeAnalysisResult | null {
  // Only analyze actual code files
  const codeTypes = ['javascript', 'typescript', 'python', 'java', 'go', 'ruby', 'php', 'csharp'];
  if (!codeTypes.includes(file.fileType)) {
    return null;
  }
  
  let imports: ImportStatement[] = [];
  
  // Parse imports based on file type
  if (file.fileType === 'javascript' || file.fileType === 'typescript') {
    imports = parseJavaScriptImports(file.content, file.relativePath);
  } else if (file.fileType === 'python') {
    imports = parsePythonImports(file.content, file.relativePath);
  } else if (file.fileType === 'java') {
    imports = parseJavaImports(file.content, file.relativePath);
  }
  
  // Detect frameworks
  const frameworks = detectFrameworksFromCode(file.content, file.fileType);
  
  // Detect patterns
  const patterns = detectCodePatterns(file.content, file.fileType);
  
  // Count LOC
  const linesOfCode = countLinesOfCode(file.content);
  
  return {
    file: file.relativePath,
    language: file.fileType,
    imports,
    frameworks,
    patterns,
    linesOfCode
  };
}

/**
 * Analyze all code files in the repository
 */
export function analyzeAllCodeFiles(files: ExtractedFile[]): CodeAnalysisResult[] {
  const results: CodeAnalysisResult[] = [];
  
  
  for (const file of files) {
    const analysis = analyzeCodeFile(file);
    if (analysis) {
      results.push(analysis);
    }
  }
  
  
  return results;
}

/**
 * Extract unique external packages from code analysis
 */
export function extractExternalPackages(analyses: CodeAnalysisResult[]): Array<{
  package: string;
  usedIn: string[];
  importCount: number;
}> {
  const packageMap = new Map<string, { usedIn: Set<string>; count: number }>();
  
  for (const analysis of analyses) {
    for (const imp of analysis.imports) {
      // Skip local imports
      if (imp.isLocal) continue;
      
      // Normalize package name (remove sub-paths)
      let packageName = imp.package;
      if (packageName.startsWith('@')) {
        // Scoped package: @org/package/sub -> @org/package
        const parts = packageName.split('/');
        packageName = parts.slice(0, 2).join('/');
      } else {
        // Regular package: package/sub -> package
        packageName = packageName.split('/')[0];
      }
      
      if (!packageMap.has(packageName)) {
        packageMap.set(packageName, { usedIn: new Set(), count: 0 });
      }
      
      const entry = packageMap.get(packageName)!;
      entry.usedIn.add(analysis.file);
      entry.count++;
    }
  }
  
  // Convert to array
  const packages = Array.from(packageMap.entries()).map(([pkg, data]) => ({
    package: pkg,
    usedIn: Array.from(data.usedIn),
    importCount: data.count
  }));
  
  // Sort by import count (most used first)
  packages.sort((a, b) => b.importCount - a.importCount);
  
  
  return packages;
}

/**
 * Extract unique frameworks from all analyses
 */
export function extractFrameworks(analyses: CodeAnalysisResult[]): Array<{
  name: string;
  usedIn: string[];
}> {
  const frameworkMap = new Map<string, Set<string>>();
  
  for (const analysis of analyses) {
    for (const framework of analysis.frameworks) {
      if (!frameworkMap.has(framework)) {
        frameworkMap.set(framework, new Set());
      }
      frameworkMap.get(framework)!.add(analysis.file);
    }
  }
  
  const frameworks = Array.from(frameworkMap.entries()).map(([name, files]) => ({
    name,
    usedIn: Array.from(files)
  }));
  
  
  return frameworks;
}

/**
 * Get code samples for AI analysis
 * Returns representative samples of actual code
 */
export function getCodeSamples(files: ExtractedFile[], maxSamples: number = 10, maxLinesPerSample: number = 50): Array<{
  file: string;
  language: string;
  preview: string;
  fullContent: string;
}> {
  const codeFiles = files.filter(f => 
    ['javascript', 'typescript', 'python', 'java', 'go', 'ruby', 'php', 'csharp'].includes(f.fileType)
  );
  
  // Prioritize entry points and main files
  const priorityFiles = codeFiles.filter(f => 
    f.relativePath.includes('index.') ||
    f.relativePath.includes('main.') ||
    f.relativePath.includes('app.') ||
    f.relativePath.includes('server.') ||
    f.relativePath === 'index.ts' ||
    f.relativePath === 'index.js' ||
    f.relativePath === 'main.py'
  );
  
  const samplesToUse = priorityFiles.length > 0 ? priorityFiles.slice(0, maxSamples) : codeFiles.slice(0, maxSamples);
  
  return samplesToUse.map(file => {
    const lines = file.content.split('\n');
    const preview = lines.slice(0, maxLinesPerSample).join('\n');
    
    return {
      file: file.relativePath,
      language: file.fileType,
      preview: preview + (lines.length > maxLinesPerSample ? '\n... (truncated)' : ''),
      fullContent: file.content
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// CDN <script>/<link> Reference Scanner
// ═══════════════════════════════════════════════════════════════

/** Recognised CDN hosts — values are human-readable labels for logging. */
const CDN_HOSTS: Record<string, string> = {
  "cdn.jsdelivr.net": "jsDelivr",
  "cdnjs.cloudflare.com": "cdnjs",
  "unpkg.com": "unpkg",
  "ajax.googleapis.com": "Google CDN",
  "code.jquery.com": "jQuery CDN",
  "stackpath.bootstrapcdn.com": "BootstrapCDN",
  "maxcdn.bootstrapcdn.com": "BootstrapCDN",
  "kendo.cdn.telerik.com": "Kendo CDN",
  "cdn.datatables.net": "DataTables CDN",
  "use.fontawesome.com": "Font Awesome CDN",
  "kit.fontawesome.com": "Font Awesome CDN",
};

/** File extensions that may contain HTML-like <script>/<link> tags. */
const HTML_LIKE_EXTENSIONS = new Set([
  ".html", ".htm", ".cshtml", ".razor", ".aspx", ".master",
  ".jsp", ".erb", ".hbs", ".ejs", ".pug", ".php",
  ".vue", ".svelte", ".blade.php", ".twig",
]);

/**
 * Mapping from CDN URL path segments to npm package names.
 * Patterns are tested against the URL pathname.
 */
const CDN_PATH_TO_NPM: Array<{ pattern: RegExp; npm: string; label: string }> = [
  // cdnjs: /ajax/libs/<library>/<version>/...
  { pattern: /\/ajax\/libs\/jquery-validate\//i, npm: "jquery-validation", label: "jQuery Validate" },
  { pattern: /\/ajax\/libs\/jquery-validation-unobtrusive\//i, npm: "jquery-validation-unobtrusive", label: "jQuery Validation Unobtrusive" },
  { pattern: /\/ajax\/libs\/jquery\//i, npm: "jquery", label: "jQuery" },
  { pattern: /\/ajax\/libs\/jqueryui\//i, npm: "jquery-ui-dist", label: "jQuery UI" },
  { pattern: /\/ajax\/libs\/twitter-bootstrap\//i, npm: "bootstrap", label: "Bootstrap" },
  { pattern: /\/ajax\/libs\/bootstrap\//i, npm: "bootstrap", label: "Bootstrap" },
  { pattern: /\/ajax\/libs\/popper\.js\//i, npm: "@popperjs/core", label: "Popper.js" },
  { pattern: /\/ajax\/libs\/font-awesome\//i, npm: "@fortawesome/fontawesome-free", label: "Font Awesome" },
  { pattern: /\/ajax\/libs\/animate\.css\//i, npm: "animate.css", label: "Animate.css" },
  { pattern: /\/ajax\/libs\/select2\//i, npm: "select2", label: "Select2" },
  { pattern: /\/ajax\/libs\/toastr\.js\//i, npm: "toastr", label: "Toastr" },
  { pattern: /\/ajax\/libs\/moment\.js\//i, npm: "moment", label: "Moment.js" },
  { pattern: /\/ajax\/libs\/lodash\.js\//i, npm: "lodash", label: "Lodash" },
  { pattern: /\/ajax\/libs\/Chart\.js\//i, npm: "chart.js", label: "Chart.js" },
  { pattern: /\/ajax\/libs\/handlebars\.js\//i, npm: "handlebars", label: "Handlebars" },
  { pattern: /\/ajax\/libs\/sweetalert2\//i, npm: "sweetalert2", label: "SweetAlert2" },
  { pattern: /\/ajax\/libs\/bootbox\.js\//i, npm: "bootbox", label: "Bootbox" },
  { pattern: /\/ajax\/libs\/datatables\//i, npm: "datatables.net", label: "DataTables" },

  // jsDelivr / unpkg: /npm/<package>@<version>/...
  { pattern: /\/npm\/bootstrap@/i, npm: "bootstrap", label: "Bootstrap" },
  { pattern: /\/npm\/jquery@/i, npm: "jquery", label: "jQuery" },
  { pattern: /\/npm\/@popperjs\/core@/i, npm: "@popperjs/core", label: "Popper.js" },
  { pattern: /\/npm\/@fortawesome\/fontawesome-free@/i, npm: "@fortawesome/fontawesome-free", label: "Font Awesome" },
  { pattern: /\/npm\/select2@/i, npm: "select2", label: "Select2" },
  { pattern: /\/npm\/chart\.js@/i, npm: "chart.js", label: "Chart.js" },
  { pattern: /\/npm\/handlebars@/i, npm: "handlebars", label: "Handlebars" },

  // Kendo CDN: /2025.4.1321/...
  { pattern: /kendo\.cdn\.telerik\.com/i, npm: "@progress/kendo-ui", label: "Kendo UI" },

  // Google CDN: /ajax/libs/jquery/<version>/...
  { pattern: /googleapis\.com\/ajax\/libs\/jquery\//i, npm: "jquery", label: "jQuery" },
  { pattern: /googleapis\.com\/ajax\/libs\/jqueryui\//i, npm: "jquery-ui-dist", label: "jQuery UI" },

  // jQuery CDN: code.jquery.com/jquery-<version>.min.js
  { pattern: /code\.jquery\.com\/jquery-/i, npm: "jquery", label: "jQuery" },
  { pattern: /code\.jquery\.com\/ui\//i, npm: "jquery-ui-dist", label: "jQuery UI" },
];

/** Extract version from a CDN URL. Returns null if not found. */
function extractVersionFromCdnUrl(url: string): string | null {
  // Pattern 1: /ajax/libs/<lib>/<version>/...
  const cdnjsMatch = url.match(/\/ajax\/libs\/[^/]+\/(\d+\.\d+(?:\.\d+)?(?:[^/]*))\//);
  if (cdnjsMatch) return cdnjsMatch[1];

  // Pattern 2: /npm/<pkg>@<version>/...
  const npmMatch = url.match(/@(\d+\.\d+(?:\.\d+)?(?:[^/]*))\//);
  if (npmMatch) return npmMatch[1];

  // Pattern 3: Kendo CDN — /2025.4.1321/...
  const kendoMatch = url.match(/kendo\.cdn\.telerik\.com\/(\d+\.\d+\.\d+)\//);
  if (kendoMatch) return kendoMatch[1];

  // Pattern 4: code.jquery.com/jquery-3.6.3.min.js
  const jqueryMatch = url.match(/jquery-(\d+\.\d+(?:\.\d+)?)/);
  if (jqueryMatch) return jqueryMatch[1];

  // Pattern 5: Generic version in path — /<version>/  (only digits and dots, at least major.minor)
  const genericMatch = url.match(/\/(\d+\.\d+(?:\.\d+)?)\//);
  if (genericMatch) return genericMatch[1];

  return null;
}

/** Resolve a CDN URL to its npm package name + label. */
function resolveCdnToNpm(url: string): { npm: string; label: string } | null {
  for (const mapping of CDN_PATH_TO_NPM) {
    if (mapping.pattern.test(url)) {
      return { npm: mapping.npm, label: mapping.label };
    }
  }
  return null;
}

/**
 * Scan HTML-like files for CDN <script src="..."> and <link href="..."> references.
 * Identifies the library, version, and npm package for each recognised CDN URL.
 */
export function scanHtmlForCdnReferences(files: ExtractedFile[]): CdnReference[] {
  const results: CdnReference[] = [];

  const scriptRe = /<script\s[^>]*src\s*=\s*["']([^"']+)["']/gi;
  const linkRe = /<link\s[^>]*href\s*=\s*["']([^"']+)["']/gi;

  for (const file of files) {
    const ext = "." + (file.relativePath.split(".").pop() ?? "").toLowerCase();
    if (!HTML_LIKE_EXTENSIONS.has(ext)) continue;

    const content = file.content;
    const lines = content.split("\n");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      // Check both <script src> and <link href>
      const patterns: Array<{ re: RegExp; tagType: "script" | "link" }> = [
        { re: new RegExp(scriptRe.source, "gi"), tagType: "script" },
        { re: new RegExp(linkRe.source, "gi"), tagType: "link" },
      ];

      for (const { re, tagType } of patterns) {
        let match: RegExpExecArray | null;
        while ((match = re.exec(line)) !== null) {
          const url = match[1];

          // Only process URLs from known CDN hosts
          const isCdn = Object.keys(CDN_HOSTS).some(host => url.includes(host));
          if (!isCdn) continue;

          const resolved = resolveCdnToNpm(url);
          if (!resolved) continue;

          const version = extractVersionFromCdnUrl(url);

          results.push({
            file: file.relativePath,
            line: lineIdx + 1,
            url,
            library: resolved.label,
            npmPackage: resolved.npm,
            version,
            tagType,
          });
        }
      }
    }
  }

  console.log(`[CodeAnalyzer] CDN scan: found ${results.length} CDN references across ${new Set(results.map(r => r.file)).size} files`);
  return results;
}

// ═══════════════════════════════════════════════════════════════
// CSS-class-inferred Library Detection
// ═══════════════════════════════════════════════════════════════

/** CSS class patterns that indicate a specific library is in use. */
const CSS_CLASS_LIBRARY_PATTERNS: Array<{
  /** Regex to detect the library's CSS classes */
  pattern: RegExp;
  /** npm package name */
  npmPackage: string;
  /** Human-readable library name */
  library: string;
  /** Minimum matches to qualify as "high" confidence */
  highThreshold: number;
}> = [
  // Font Awesome 4.x: fa fa-*
  { pattern: /\bfa\s+fa-[\w-]+/g, npmPackage: "@fortawesome/fontawesome-free", library: "Font Awesome", highThreshold: 2 },
  // Font Awesome 5+: fas/far/fab/fal fa-*
  { pattern: /\b(?:fas|far|fab|fal|fad)\s+fa-[\w-]+/g, npmPackage: "@fortawesome/fontawesome-free", library: "Font Awesome", highThreshold: 2 },
  // Font Awesome 6 solid: fa-solid fa-*
  { pattern: /\bfa-(?:solid|regular|brands|light|duotone)\s+fa-[\w-]+/g, npmPackage: "@fortawesome/fontawesome-free", library: "Font Awesome", highThreshold: 2 },
  // Bootstrap — grid, components, and utility classes
  { pattern: /\bcol-(?:sm|md|lg|xl|xxl)-\d{1,2}\b/g, npmPackage: "bootstrap", library: "Bootstrap", highThreshold: 3 },
  { pattern: /\bbtn\s+btn-(?:primary|secondary|success|danger|warning|info|light|dark|outline-\w+)\b/g, npmPackage: "bootstrap", library: "Bootstrap", highThreshold: 2 },
  { pattern: /\bnavbar-(?:expand|collapse|toggler|brand|nav|text)\b/g, npmPackage: "bootstrap", library: "Bootstrap", highThreshold: 2 },
  { pattern: /\bmodal-(?:dialog|content|header|body|footer|title)\b/g, npmPackage: "bootstrap", library: "Bootstrap", highThreshold: 2 },
  { pattern: /\bcard-(?:body|header|footer|title|text|img-top)\b/g, npmPackage: "bootstrap", library: "Bootstrap", highThreshold: 2 },
  { pattern: /\balert-(?:primary|secondary|success|danger|warning|info)\b/g, npmPackage: "bootstrap", library: "Bootstrap", highThreshold: 2 },
  // Material Icons (Google)
  { pattern: /\bmaterial-icons\b/g, npmPackage: "material-icons", library: "Material Icons", highThreshold: 1 },
  { pattern: /\bmdi\s+mdi-[\w-]+/g, npmPackage: "@mdi/font", library: "Material Design Icons", highThreshold: 2 },
  // Animate.css
  { pattern: /\banimate__[\w-]+/g, npmPackage: "animate.css", library: "Animate.css", highThreshold: 2 },
  // Select2
  { pattern: /\bselect2(?:-[\w-]+)?/g, npmPackage: "select2", library: "Select2", highThreshold: 3 },
  // DataTables
  { pattern: /\bdataTables_[\w-]+/g, npmPackage: "datatables.net", library: "DataTables", highThreshold: 2 },
  // Toastr
  { pattern: /\btoast-(?:success|error|warning|info)\b/g, npmPackage: "toastr", library: "Toastr", highThreshold: 2 },
];

/** File extensions to scan for CSS class patterns. */
const CSS_CLASS_SCAN_EXTENSIONS = new Set([
  ".html", ".htm", ".cshtml", ".razor", ".aspx", ".master",
  ".jsp", ".erb", ".hbs", ".ejs", ".vue", ".svelte",
  ".css", ".scss", ".less", ".js", ".jsx", ".ts", ".tsx",
  ".php", ".blade.php", ".twig",
]);

/**
 * Scan files for CSS class patterns that indicate specific client-side libraries.
 * For example, `fa fa-spinner` indicates Font Awesome is in use even if no FA files exist.
 */
export function scanForCssClassLibraries(files: ExtractedFile[]): InferredLibrary[] {
  /** Accumulator: npmPackage → { library, evidence set, files set, count } */
  const found = new Map<string, {
    library: string;
    npmPackage: string;
    highThreshold: number;
    evidence: Set<string>;
    detectedIn: Set<string>;
    count: number;
  }>();

  for (const file of files) {
    const ext = "." + (file.relativePath.split(".").pop() ?? "").toLowerCase();
    if (!CSS_CLASS_SCAN_EXTENSIONS.has(ext)) continue;

    for (const rule of CSS_CLASS_LIBRARY_PATTERNS) {
      const matches = file.content.match(rule.pattern);
      if (!matches || matches.length === 0) continue;

      let entry = found.get(rule.npmPackage);
      if (!entry) {
        entry = {
          library: rule.library,
          npmPackage: rule.npmPackage,
          highThreshold: rule.highThreshold,
          evidence: new Set(),
          detectedIn: new Set(),
          count: 0,
        };
        found.set(rule.npmPackage, entry);
      }

      entry.count += matches.length;
      entry.detectedIn.add(file.relativePath);
      // Keep first few unique matches as evidence (cap at 5)
      for (const m of matches) {
        if (entry.evidence.size < 5) entry.evidence.add(m.trim());
      }
    }
  }

  const results: InferredLibrary[] = [];
  for (const entry of found.values()) {
    const confidence: InferredLibrary["confidence"] =
      entry.count >= entry.highThreshold ? "high" : entry.count >= 1 ? "medium" : "low";
    results.push({
      library: entry.library,
      npmPackage: entry.npmPackage,
      confidence,
      evidence: [...entry.evidence],
      detectedIn: [...entry.detectedIn],
    });
  }

  console.log(`[CodeAnalyzer] CSS-class inference: found ${results.length} libraries (${results.filter(r => r.confidence === "high").length} high confidence)`);
  return results;
}
