/**
 * Stack Modernization - Runtime Version Detector
 * Detects current versions of languages, frameworks, and runtimes from code
 */

import type { ExtractedFile } from "../types";

export interface DetectedRuntime {
  name: string;
  type: 'language' | 'runtime' | 'framework' | 'library';
  currentVersion: string | null;
  detectionMethod: string;
  confidence: 'high' | 'medium' | 'low';
  source: string; // Where it was detected from
}

/**
 * Detect Node.js version from package.json engines field
 */
export function detectNodeVersionFromPackageJson(content: string, filePath: string): DetectedRuntime | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed.engines?.node) {
      const versionStr = parsed.engines.node.replace(/[\^~>=<]/g, '').trim();
      return {
        name: 'Node.js',
        type: 'runtime',
        currentVersion: versionStr,
        detectionMethod: 'package.json engines field',
        confidence: 'high',
        source: filePath
      };
    }
  } catch (e) {
    // Ignore parse errors
  }
  return null;
}

/**
 * Detect Node.js version from .nvmrc
 */
export function detectNodeVersionFromNvmrc(content: string, filePath: string): DetectedRuntime | null {
  const version = content.trim();
  if (version && /^\d/.test(version)) {
    return {
      name: 'Node.js',
      type: 'runtime',
      currentVersion: version.replace(/^v/, ''),
      detectionMethod: '.nvmrc file',
      confidence: 'high',
      source: filePath
    };
  }
  return null;
}

/**
 * Detect Python version from runtime.txt or Dockerfile
 */
export function detectPythonVersion(content: string, filePath: string): DetectedRuntime | null {
  // From runtime.txt (Heroku style)
  const runtimeMatch = content.match(/python-(\d+\.\d+\.?\d*)/i);
  if (runtimeMatch) {
    return {
      name: 'Python',
      type: 'language',
      currentVersion: runtimeMatch[1],
      detectionMethod: 'runtime.txt',
      confidence: 'high',
      source: filePath
    };
  }
  
  // From Dockerfile
  const dockerMatch = content.match(/FROM\s+python:(\d+\.\d+\.?\d*)/i);
  if (dockerMatch) {
    return {
      name: 'Python',
      type: 'language',
      currentVersion: dockerMatch[1],
      detectionMethod: 'Dockerfile',
      confidence: 'high',
      source: filePath
    };
  }
  
  return null;
}

/**
 * Detect React version from package.json
 */
export function detectReactVersion(content: string, filePath: string): DetectedRuntime | null {
  try {
    const parsed = JSON.parse(content);
    const deps = { ...parsed.dependencies, ...parsed.devDependencies };
    
    if (deps.react) {
      const versionStr = deps.react.replace(/[\^~>=<]/g, '').trim();
      return {
        name: 'React',
        type: 'framework',
        currentVersion: versionStr,
        detectionMethod: 'package.json dependencies',
        confidence: 'high',
        source: filePath
      };
    }
  } catch (e) {
    // Ignore parse errors
  }
  return null;
}

/**
 * Detect framework versions from package.json
 */
export function detectFrameworkVersions(content: string, filePath: string): DetectedRuntime[] {
  const detected: DetectedRuntime[] = [];
  
  try {
    const parsed = JSON.parse(content);
    const deps = { ...parsed.dependencies, ...parsed.devDependencies };
    
    const frameworks: Record<string, string> = {
      'react': 'React',
      'vue': 'Vue.js',
      '@angular/core': 'Angular',
      'next': 'Next.js',
      'express': 'Express',
      '@nestjs/core': 'NestJS',
      'fastify': 'Fastify',
      'koa': 'Koa',
      'jquery': 'jQuery',
      'handlebars': 'Handlebars',
      'bootstrap': 'Bootstrap',
      'jquery-validation': 'jQuery Validation',
      '@fortawesome/fontawesome-free': 'Font Awesome',
      'fontawesome': 'Font Awesome',
    };

    Object.entries(frameworks).forEach(([pkg, name]) => {
      if (deps[pkg]) {
        const versionStr = deps[pkg].replace(/[\^~>=<]/g, '').trim();
        detected.push({
          name,
          type: 'framework',
          currentVersion: versionStr,
          detectionMethod: 'package.json dependencies',
          confidence: 'high',
          source: filePath
        });
      }
    });
  } catch (e) {
    // Ignore parse errors
  }
  
  return detected;
}

/**
 * Detect Python frameworks from requirements.txt
 */
export function detectPythonFrameworks(content: string, filePath: string): DetectedRuntime[] {
  const detected: DetectedRuntime[] = [];
  const lines = content.split('\n');
  
  const frameworks: Record<string, string> = {
    'django': 'Django',
    'flask': 'Flask',
    'fastapi': 'FastAPI',
    'tornado': 'Tornado',
    'pyramid': 'Pyramid'
  };
  
  lines.forEach(line => {
    const match = line.match(/^([a-zA-Z0-9-_.]+)[>=<~!]+([\d.]+)/);
    if (match) {
      const pkg = match[1].toLowerCase();
      const version = match[2];
      
      if (frameworks[pkg]) {
        detected.push({
          name: frameworks[pkg],
          type: 'framework',
          currentVersion: version,
          detectionMethod: 'requirements.txt',
          confidence: 'high',
          source: filePath
        });
      }
    }
  });
  
  return detected;
}

/**
 * Detect TypeScript version from package.json
 */
export function detectTypeScriptVersion(content: string, filePath: string): DetectedRuntime | null {
  try {
    const parsed = JSON.parse(content);
    const deps = { ...parsed.dependencies, ...parsed.devDependencies };
    
    if (deps.typescript) {
      const versionStr = deps.typescript.replace(/[\^~>=<]/g, '').trim();
      return {
        name: 'TypeScript',
        type: 'language',
        currentVersion: versionStr,
        detectionMethod: 'package.json dependencies',
        confidence: 'high',
        source: filePath
      };
    }
  } catch (e) {
    // Ignore parse errors
  }
  return null;
}

/**
 * Detect Java version from pom.xml or build.gradle
 */
export function detectJavaVersion(content: string, filePath: string): DetectedRuntime | null {
  // pom.xml: maven.compiler.source (direct tag or in <properties>)
  const pomMatch = content.match(/<maven\.compiler\.source>([\d.]+)<\/maven\.compiler\.source>/);
  if (pomMatch) {
    return {
      name: 'Java',
      type: 'language',
      currentVersion: pomMatch[1],
      detectionMethod: 'pom.xml maven.compiler.source',
      confidence: 'high',
      source: filePath
    };
  }

  // pom.xml: <java.version> in <properties> (very common in Spring Boot projects)
  const javaVersionMatch = content.match(/<java\.version>\s*([\d.]+)\s*<\/java\.version>/);
  if (javaVersionMatch) {
    return {
      name: 'Java',
      type: 'language',
      currentVersion: javaVersionMatch[1],
      detectionMethod: 'pom.xml java.version property',
      confidence: 'high',
      source: filePath
    };
  }

  // pom.xml: maven.compiler.target (fallback if source is not set)
  const targetMatch = content.match(/<maven\.compiler\.target>([\d.]+)<\/maven\.compiler\.target>/);
  if (targetMatch) {
    return {
      name: 'Java',
      type: 'language',
      currentVersion: targetMatch[1],
      detectionMethod: 'pom.xml maven.compiler.target',
      confidence: 'medium',
      source: filePath
    };
  }

  // pom.xml: maven.compiler.release (Java 9+ style)
  const releaseMatch = content.match(/<maven\.compiler\.release>\s*([\d.]+)\s*<\/maven\.compiler\.release>/);
  if (releaseMatch) {
    return {
      name: 'Java',
      type: 'language',
      currentVersion: releaseMatch[1],
      detectionMethod: 'pom.xml maven.compiler.release',
      confidence: 'high',
      source: filePath
    };
  }

  // build.gradle: sourceCompatibility
  const gradleMatch = content.match(/sourceCompatibility\s*=\s*['"]?(\d+)['"]?/);
  if (gradleMatch) {
    return {
      name: 'Java',
      type: 'language',
      currentVersion: gradleMatch[1],
      detectionMethod: 'build.gradle sourceCompatibility',
      confidence: 'high',
      source: filePath
    };
  }

  // build.gradle.kts: jvmToolchain or java.toolchain.languageVersion
  const toolchainMatch = content.match(/jvmToolchain\s*\(\s*(\d+)\s*\)/);
  if (toolchainMatch) {
    return {
      name: 'Java',
      type: 'language',
      currentVersion: toolchainMatch[1],
      detectionMethod: 'build.gradle jvmToolchain',
      confidence: 'high',
      source: filePath
    };
  }

  return null;
}

/**
 * Detect all runtime versions from extracted files
 */
/**
 * Detect client-side libraries from libman.json (ASP.NET Core client-side library manager).
 * LibMan entries use the format "library": "name@version" with a provider and destination.
 */
export function detectLibManPackages(content: string, filePath: string): DetectedRuntime[] {
  const detected: DetectedRuntime[] = [];

  // Display-name mapping for common LibMan package identifiers
  const displayNames: Record<string, string> = {
    'twitter-bootstrap': 'Bootstrap',
    'bootstrap': 'Bootstrap',
    'jquery': 'jQuery',
    'jquery.validation': 'jQuery Validation',
    'jquery-validation': 'jQuery Validation',
    'jquery-validation-unobtrusive': 'jQuery Unobtrusive Validation',
    'handlebars': 'Handlebars',
    'handlebars.js': 'Handlebars',
    'font-awesome': 'Font Awesome',
    '@fortawesome/fontawesome-free': 'Font Awesome',
    'bootstrap-datepicker': 'Bootstrap Datepicker',
    'd3': 'D3.js',
    'popper.js': 'Popper.js',
    '@popperjs/core': 'Popper.js',
    'lodash': 'Lodash',
    'moment': 'Moment.js',
    'datatables': 'DataTables',
    'select2': 'Select2',
    'toastr': 'Toastr',
    'sweetalert2': 'SweetAlert2',
  };

  try {
    const parsed = JSON.parse(content);
    const libraries = parsed.libraries || [];
    for (const lib of libraries) {
      const raw: string = lib.library || lib.name || "";
      if (!raw) continue;

      // Format is typically "name@version" (e.g., "twitter-bootstrap@4.6.2")
      const atIdx = raw.lastIndexOf("@");
      let pkgName: string;
      let version: string | null = null;
      if (atIdx > 0) {
        pkgName = raw.slice(0, atIdx).trim();
        version = raw.slice(atIdx + 1).trim() || null;
      } else {
        pkgName = raw.trim();
      }

      const lowerPkg = pkgName.toLowerCase();
      const name = displayNames[lowerPkg] || pkgName;

      detected.push({
        name,
        type: 'library',
        currentVersion: version,
        detectionMethod: 'libman.json',
        confidence: 'high',
        source: filePath,
      });
    }
  } catch {
    // Ignore JSON parse errors
  }

  return detected;
}

// ═══════════════════════════════════════════════════════════════
// CLIENT-SIDE LIBRARY DETECTION (script/link tags + vendor dirs)
// ═══════════════════════════════════════════════════════════════

const VIEW_EXTENSIONS = new Set([
  '.html', '.htm', '.cshtml', '.razor', '.aspx', '.master',
  '.jsp', '.erb', '.ejs', '.hbs', '.pug', '.njk', '.twig',
  '.vue', '.svelte', '.astro', '.php', '.blade.php',
]);

const SCRIPT_SRC_RE = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
const LINK_HREF_RE  = /<link[^>]+href\s*=\s*["']([^"']+)["']/gi;

// Razor/ASPX helper expressions that wrap URLs inside server-side code blocks.
// These break the standard attribute regex because of nested quotes.
const RAZOR_HELPER_PATTERNS = [
  /@Url\.Content\s*\(\s*"([^"]+)"\s*\)/gi,
  /@Url\.Content\s*\(\s*'([^']+)'\s*\)/gi,
  /@Html\.Raw\s*\(\s*"([^"]+)"\s*\)/gi,
  /Url\.Content\s*\(\s*"([^"]+)"\s*\)/gi,
  /ResolveUrl\s*\(\s*"([^"]+)"\s*\)/gi,
  /ResolveClientUrl\s*\(\s*"([^"]+)"\s*\)/gi,
];

// Raw path patterns for scanning file content directly — catches tilde paths,
// local /lib/ paths, and inline references that aren't in proper HTML attributes.
const RAW_PATH_RE = /(?:~?\/?(?:lib|vendor|Scripts|assets|static|wwwroot\/lib|Content|bundles))\/([a-zA-Z][\w.-]+?)(?:\/[^\s"'<>]+\.(?:js|css))/gi;

const CDN_VERSION_PATTERNS: Array<{ pattern: RegExp; nameGroup: number; versionGroup: number }> = [
  { pattern: /cdn\.jsdelivr\.net\/npm\/(@?[^@/]+)@([^/'"]+)/i, nameGroup: 1, versionGroup: 2 },
  { pattern: /cdnjs\.cloudflare\.com\/ajax\/libs\/([^/]+)\/([^/'"]+)/i, nameGroup: 1, versionGroup: 2 },
  { pattern: /unpkg\.com\/(@?[^@/]+)@([^/'"]+)/i, nameGroup: 1, versionGroup: 2 },
  { pattern: /ajax\.googleapis\.com\/ajax\/libs\/([^/]+)\/([^/'"]+)/i, nameGroup: 1, versionGroup: 2 },
  { pattern: /code\.jquery\.com\/jquery-([0-9][^/'"]*?)(?:\.min)?\.js/i, nameGroup: 0, versionGroup: 1 },
  { pattern: /stackpath\.bootstrapcdn\.com\/bootstrap\/([^/'"]+)/i, nameGroup: 0, versionGroup: 1 },
  { pattern: /code\.jquery\.com\/ui\/([0-9][^/'"]*?)\//i, nameGroup: 0, versionGroup: 1 },
  { pattern: /maxcdn\.bootstrapcdn\.com\/(?:font-awesome|bootstrap)\/([^/'"]+)/i, nameGroup: 0, versionGroup: 1 },
  { pattern: /kendo\.cdn\.telerik\.com\/([0-9][^/'"]*?)\//i, nameGroup: 0, versionGroup: 1 },
];

const LOCAL_LIB_PATH_RE = /(?:~?\/(?:lib|vendor|Scripts|assets|static|wwwroot\/lib|Content|bundles)\/)([a-zA-Z][\w.-]+?)(?:\/|@)/i;

const VERSION_COMMENT_RE = /\/[*!]\s*(?:!?\s*)([a-zA-Z][\w. -]+?)\s+v?(\d+\.\d+(?:\.\d+)?)/;

const DISPLAY_NAME_TO_NPM: Record<string, string> = {
  'twitter-bootstrap': 'bootstrap',
  'bootstrap': 'bootstrap',
  'jquery': 'jquery',
  'jquery-validation': 'jquery-validation',
  'jquery.validation': 'jquery-validation',
  'jquery-validation-unobtrusive': 'jquery-validation-unobtrusive',
  'jquery.ui': 'jquery-ui',
  'jquery-ui': 'jquery-ui',
  'handlebars': 'handlebars',
  'handlebars.js': 'handlebars',
  'font-awesome': '@fortawesome/fontawesome-free',
  'fontawesome': '@fortawesome/fontawesome-free',
  '@fortawesome/fontawesome-free': '@fortawesome/fontawesome-free',
  'bootstrap-datepicker': 'bootstrap-datepicker',
  'popper.js': '@popperjs/core',
  '@popperjs/core': '@popperjs/core',
  'lodash': 'lodash',
  'moment': 'moment',
  'd3': 'd3',
  'datatables': 'datatables.net',
  'datatables.net': 'datatables.net',
  'select2': 'select2',
  'toastr': 'toastr',
  'sweetalert2': 'sweetalert2',
  'bootbox': 'bootbox',
  'bootboxjs': 'bootbox',
  'bootbox.js': 'bootbox',
  'kendo': '@progress/kendo-ui',
  'kendo-ui': '@progress/kendo-ui',
  'sammy': 'sammy',
  'sammy.js': 'sammy',
  'sammyjs': 'sammy',
  'elastic-apm-rum': '@elastic/apm-rum',
  'elastic-apm-rum.umd': '@elastic/apm-rum',
  'chart.js': 'chart.js',
  'chartjs': 'chart.js',
  'axios': 'axios',
  'signalr': '@microsoft/signalr',
  'knockout': 'knockout',
  'knockout.js': 'knockout',
  'underscore': 'underscore',
  'backbone': 'backbone',
  'backbone.js': 'backbone',
  'vue': 'vue',
  'vue.js': 'vue',
  'react': 'react',
  'angular': '@angular/core',
  'materialize': 'materialize-css',
  'semantic-ui': 'semantic-ui',
  'foundation': 'foundation-sites',
  'animate.css': 'animate.css',
  'datatables': 'datatables.net',
  'are-you-sure': 'jquery.are-you-sure',
  'jquery.areyousure': 'jquery.are-you-sure',
  'jquery.validate': 'jquery-validation',
  'jquery.validate.unobtrusive': 'jquery-validation-unobtrusive',
  'jquery-validate': 'jquery-validation',
  'jquery-validate-unobtrusive': 'jquery-validation-unobtrusive',
  'bootstrap.bundle': 'bootstrap',
  'all': '@fortawesome/fontawesome-free',
  'font-awesome.min': '@fortawesome/fontawesome-free',
  'fontawesome.min': '@fortawesome/fontawesome-free',
  'kendo.all': '@progress/kendo-ui',
  'kendo.all.min': '@progress/kendo-ui',
  'kendo.web': '@progress/kendo-ui',
  'kendo.web.min': '@progress/kendo-ui',
  'kendo.ui.core': '@progress/kendo-ui',
  'kendo.ui.core.min': '@progress/kendo-ui',
};

const APP_SPECIFIC_NAMES = new Set([
  'site', 'app', 'main', 'index', 'bundle', 'vendor', 'polyfills',
  'runtime', 'scripts', 'styles', 'custom', 'common',
]);

function normalizeLibraryName(raw: string): string {
  const lower = raw.toLowerCase().replace(/\.min$/, '').replace(/\.umd$/, '').replace(/\.bundle$/, '').trim();
  return DISPLAY_NAME_TO_NPM[lower] || lower;
}

function extractLibNameFromUrl(url: string): { name: string; version: string | null } | null {
  // Strip leading tilde (ASP.NET virtual root marker) so path-based patterns match
  const cleanUrl = url.replace(/^~/, '');

  for (const { pattern, nameGroup, versionGroup } of CDN_VERSION_PATTERNS) {
    const m = cleanUrl.match(pattern);
    if (m) {
      const rawName = nameGroup === 0
        ? (pattern.source.includes('jquery') ? 'jquery'
          : pattern.source.includes('kendo') ? 'kendo-ui'
          : 'bootstrap')
        : m[nameGroup];
      return { name: normalizeLibraryName(rawName), version: m[versionGroup] || null };
    }
  }

  const localMatch = cleanUrl.match(LOCAL_LIB_PATH_RE);
  if (localMatch) {
    return { name: normalizeLibraryName(localMatch[1]), version: null };
  }

  // Try to extract library name from the filename (e.g., /jquery.validate.min.js)
  const filenameMatch = cleanUrl.match(/\/([a-zA-Z][\w.-]+?)(?:\.min)?\.(?:js|css)(?:\?|$|#)/);
  if (filenameMatch) {
    const candidate = filenameMatch[1].toLowerCase();
    if (DISPLAY_NAME_TO_NPM[candidate]) {
      return { name: DISPLAY_NAME_TO_NPM[candidate], version: null };
    }
  }

  // Last resort: check if the URL basename matches a known library name directly
  const basename = cleanUrl.split('/').pop()?.replace(/\.min\.(js|css)$/, '').replace(/\.(js|css)$/, '').toLowerCase();
  if (basename && APP_SPECIFIC_NAMES.has(basename)) return null;
  if (basename && DISPLAY_NAME_TO_NPM[basename]) {
    return { name: DISPLAY_NAME_TO_NPM[basename], version: null };
  }

  return null;
}

/**
 * Merge a detected library into the shared map, upgrading confidence/version
 * when a better match is found in a later file.
 */
function mergeLib(
  libMap: Map<string, { version: string | null; sources: string[]; confidence: 'high' | 'medium' | 'low' }>,
  info: { name: string; version: string | null },
  filePath: string,
) {
  const existing = libMap.get(info.name);
  if (!existing) {
    libMap.set(info.name, {
      version: info.version,
      sources: [filePath],
      confidence: info.version ? 'high' : 'medium',
    });
  } else {
    if (!existing.version && info.version) {
      existing.version = info.version;
      existing.confidence = 'high';
    }
    if (!existing.sources.includes(filePath)) {
      existing.sources.push(filePath);
    }
  }
}

/**
 * Pre-process content from Razor/ASPX view files to extract URLs hidden inside
 * server-side helper expressions like @Url.Content("~/lib/bootstrap/...").
 * Returns an array of extracted URL strings that can be fed to extractLibNameFromUrl.
 */
function extractUrlsFromRazorHelpers(content: string): string[] {
  const urls: string[] = [];
  for (const re of RAZOR_HELPER_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      let url = m[1]?.trim();
      if (!url) continue;
      url = url.replace(/^~/, '');
      if (url.match(/\.(?:js|css|woff2?|ttf|eot|svg)(?:\?|$|#)/i)) {
        urls.push(url);
      }
    }
  }
  return urls;
}

/**
 * Scan raw file content for library path patterns (~/lib/..., /vendor/..., etc.)
 * that may not appear inside proper HTML attributes. Especially useful for .cshtml
 * files where Razor concatenation or inline code references libraries.
 */
function extractLibsFromRawPaths(content: string): Array<{ name: string; version: string | null }> {
  const results: Array<{ name: string; version: string | null }> = [];
  const seen = new Set<string>();

  RAW_PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RAW_PATH_RE.exec(content)) !== null) {
    const rawName = m[1];
    if (!rawName) continue;
    const normalized = normalizeLibraryName(rawName);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    results.push({ name: normalized, version: null });
  }

  return results;
}

/**
 * Scan HTML/cshtml/razor/etc view files for <script src> and <link href> tags
 * and extract client-side library names + versions.
 *
 * For .cshtml/.razor files, also handles Razor helper expressions like
 * @Url.Content("~/lib/...") and scans raw path references as a fallback.
 */
export function detectClientSideLibraries(files: ExtractedFile[]): DetectedRuntime[] {
  const libMap = new Map<string, { version: string | null; sources: string[]; confidence: 'high' | 'medium' | 'low' }>();
  const RAZOR_EXTENSIONS = new Set(['.cshtml', '.razor', '.aspx', '.master']);

  for (const file of files) {
    const ext = file.relativePath.substring(file.relativePath.lastIndexOf('.')).toLowerCase();
    if (!VIEW_EXTENSIONS.has(ext)) continue;

    const isRazor = RAZOR_EXTENSIONS.has(ext);

    // PASS 1: Standard HTML attribute regex (works for plain HTML and non-Razor files)
    for (const re of [SCRIPT_SRC_RE, LINK_HREF_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(file.content)) !== null) {
        let url = m[1];
        if (!url || url.startsWith('data:') || url.startsWith('#') || url.startsWith('{')) continue;

        // If the captured URL starts with @ (Razor expression leaked in), skip —
        // the Razor-specific pass below will handle it properly.
        if (url.startsWith('@')) continue;

        url = url.replace(/^~/, '');
        const info = extractLibNameFromUrl(url);
        if (info) mergeLib(libMap, info, file.relativePath);
      }
    }

    // PASS 2: Razor-specific — extract URLs from server-side helper expressions
    if (isRazor) {
      const razorUrls = extractUrlsFromRazorHelpers(file.content);
      for (const url of razorUrls) {
        const info = extractLibNameFromUrl(url);
        if (info) mergeLib(libMap, info, file.relativePath);
      }
    }

    // PASS 3: Raw path scanning fallback — catches references in Razor code blocks,
    // inline JS, comments, and concatenated strings that neither pass above catches.
    if (isRazor) {
      const rawLibs = extractLibsFromRawPaths(file.content);
      for (const info of rawLibs) {
        mergeLib(libMap, info, file.relativePath);
      }
    }

    // PASS 4: CDN pattern scan across the entire file content — catches CDN URLs
    // embedded in Razor blocks, JS variables, or data attributes.
    for (const { pattern, nameGroup, versionGroup } of CDN_VERSION_PATTERNS) {
      const cdnRe = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      cdnRe.lastIndex = 0;
      let cdnMatch: RegExpExecArray | null;
      while ((cdnMatch = cdnRe.exec(file.content)) !== null) {
        const rawName = nameGroup === 0
          ? (pattern.source.includes('jquery') ? 'jquery'
            : pattern.source.includes('kendo') ? 'kendo-ui'
            : 'bootstrap')
          : cdnMatch[nameGroup];
        if (!rawName) continue;
        mergeLib(libMap, { name: normalizeLibraryName(rawName), version: cdnMatch[versionGroup] || null }, file.relativePath);
      }
    }
  }

  const detected: DetectedRuntime[] = [];
  for (const [npmName, info] of libMap) {
    const displayName = Object.entries(DISPLAY_NAME_TO_NPM).find(([, npm]) => npm === npmName)?.[0] || npmName;
    const prettyName = displayName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    detected.push({
      name: prettyName,
      type: 'library',
      currentVersion: info.version,
      detectionMethod: 'script-tag',
      confidence: info.confidence,
      source: info.sources[0],
    });
  }

  return detected;
}

/**
 * Scan all file paths for vendor directory patterns to identify libraries.
 * Works even when vendor file content is excluded from extractedFiles — only
 * the path structure is needed to identify library names.
 * Version extraction from file headers is done opportunistically when content is available.
 */
export function detectVendorDirectoryLibraries(files: ExtractedFile[]): DetectedRuntime[] {
  const VENDOR_DIR_PATTERNS = [
    /[/\\]wwwroot[/\\]lib[/\\]([^/\\]+)/i,
    /[/\\]lib[/\\]([^/\\]+)[/\\]dist[/\\]/i,
    /[/\\]vendor[/\\](?:assets[/\\])?([^/\\]+)/i,
    /[/\\]Scripts[/\\]([^/\\]+)/i,
    /[/\\]bower_components[/\\]([^/\\]+)/i,
  ];

  const libMap = new Map<string, { version: string | null; source: string }>();

  for (const file of files) {
    for (const re of VENDOR_DIR_PATTERNS) {
      const dirMatch = file.relativePath.match(re);
      if (!dirMatch) continue;

      const rawDirName = dirMatch[1].toLowerCase();
      const npmName = normalizeLibraryName(rawDirName);

      if (!libMap.has(npmName)) {
        let version: string | null = null;
        const fileExt = file.relativePath.substring(file.relativePath.lastIndexOf('.')).toLowerCase();
        if ((fileExt === '.js' || fileExt === '.css') && file.content) {
          const header = file.content.substring(0, 500);
          const vMatch = header.match(VERSION_COMMENT_RE);
          if (vMatch) version = vMatch[2];
        }
        libMap.set(npmName, { version, source: file.relativePath });
      } else if (!libMap.get(npmName)!.version && file.content) {
        const fileExt = file.relativePath.substring(file.relativePath.lastIndexOf('.')).toLowerCase();
        if (fileExt === '.js' || fileExt === '.css') {
          const header = file.content.substring(0, 500);
          const vMatch = header.match(VERSION_COMMENT_RE);
          if (vMatch) libMap.get(npmName)!.version = vMatch[2];
        }
      }
      break;
    }
  }

  const detected: DetectedRuntime[] = [];
  for (const [npmName, info] of libMap) {
    const displayName = Object.entries(DISPLAY_NAME_TO_NPM).find(([, npm]) => npm === npmName)?.[0] || npmName;
    const prettyName = displayName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    detected.push({
      name: prettyName,
      type: 'library',
      currentVersion: info.version,
      detectionMethod: 'vendor-directory',
      confidence: info.version ? 'high' : 'medium',
      source: info.source,
    });
  }

  return detected;
}

export function detectAllRuntimeVersions(files: ExtractedFile[]): DetectedRuntime[] {
  const detected: DetectedRuntime[] = [];
  const seen = new Set<string>(); // Prevent duplicates
  
  for (const file of files) {
    const filename = file.relativePath.toLowerCase();
    
    // .csproj - CRITICAL for .NET detection
    if (filename.endsWith('.csproj')) {
      const dotnet = detectDotNetVersionFromCsproj(file.content, file.relativePath);
      if (dotnet && !seen.has('.NET')) {
        detected.push(dotnet);
        seen.add('.NET');
      }
      
      const dotnetPackages = detectDotNetPackagesFromCsproj(file.content, file.relativePath);
      dotnetPackages.forEach(pkg => {
        if (!seen.has(pkg.name)) {
          detected.push(pkg);
          seen.add(pkg.name);
        }
      });
    }
    
    // packages.config - Legacy .NET package format
    if (filename.endsWith('packages.config')) {
      const dotnetPackages = detectDotNetPackagesFromPackagesConfig(file.content, file.relativePath);
      dotnetPackages.forEach(pkg => {
        if (!seen.has(pkg.name)) {
          detected.push(pkg);
          seen.add(pkg.name);
        }
      });
    }
    
    // libman.json - ASP.NET Core client-side libraries (Bootstrap, jQuery, etc.)
    if (filename.endsWith('libman.json')) {
      const libmanPackages = detectLibManPackages(file.content, file.relativePath);
      libmanPackages.forEach(pkg => {
        if (!seen.has(pkg.name)) {
          detected.push(pkg);
          seen.add(pkg.name);
        }
      });
    }
    
    // Web.config - ASP.NET detection
    if (filename.endsWith('web.config')) {
      const aspnet = detectAspNetVersionFromWebConfig(file.content, file.relativePath);
      if (aspnet && !seen.has('ASP.NET')) {
        detected.push(aspnet);
        seen.add('ASP.NET');
      }
    }
    
    // Package.json
    if (filename.endsWith('package.json')) {
      const node = detectNodeVersionFromPackageJson(file.content, file.relativePath);
      if (node && !seen.has('Node.js')) {
        detected.push(node);
        seen.add('Node.js');
      }
      
      const typescript = detectTypeScriptVersion(file.content, file.relativePath);
      if (typescript && !seen.has('TypeScript')) {
        detected.push(typescript);
        seen.add('TypeScript');
      }
      
      const frameworks = detectFrameworkVersions(file.content, file.relativePath);
      frameworks.forEach(fw => {
        if (!seen.has(fw.name)) {
          detected.push(fw);
          seen.add(fw.name);
        }
      });
    }
    
    // .nvmrc
    if (filename.endsWith('.nvmrc')) {
      const node = detectNodeVersionFromNvmrc(file.content, file.relativePath);
      if (node && !seen.has('Node.js-nvmrc')) {
        detected.push(node);
        seen.add('Node.js-nvmrc');
      }
    }
    
    // runtime.txt
    if (filename.endsWith('runtime.txt')) {
      const python = detectPythonVersion(file.content, file.relativePath);
      if (python && !seen.has('Python-runtime')) {
        detected.push(python);
        seen.add('Python-runtime');
      }
    }
    
    // Dockerfile
    if (filename.includes('dockerfile')) {
      const python = detectPythonVersion(file.content, file.relativePath);
      if (python && !seen.has('Python-docker')) {
        detected.push(python);
        seen.add('Python-docker');
      }
    }
    
    // requirements.txt
    if (filename.endsWith('requirements.txt')) {
      const pyFrameworks = detectPythonFrameworks(file.content, file.relativePath);
      pyFrameworks.forEach(fw => {
        if (!seen.has(fw.name)) {
          detected.push(fw);
          seen.add(fw.name);
        }
      });
    }
    
    // pom.xml or build.gradle
    if (filename.endsWith('pom.xml') || filename.endsWith('build.gradle')) {
      const java = detectJavaVersion(file.content, file.relativePath);
      if (java && !seen.has('Java')) {
        detected.push(java);
        seen.add('Java');
      }
    }
  }
  
  // Client-side libraries from script/link tags in view files
  const clientSideLibs = detectClientSideLibraries(files);
  clientSideLibs.forEach(lib => {
    if (!seen.has(lib.name)) {
      detected.push(lib);
      seen.add(lib.name);
    }
  });

  // Libraries from vendor directory scanning (wwwroot/lib/, etc.)
  const vendorLibs = detectVendorDirectoryLibraries(files);
  vendorLibs.forEach(lib => {
    if (!seen.has(lib.name)) {
      detected.push(lib);
      seen.add(lib.name);
    }
  });

  return detected;
}

/**
 * Detect .NET version from .csproj file
 * CRITICAL: This is the PRIMARY method for detecting .NET versions
 */
export function detectDotNetVersionFromCsproj(content: string, filePath: string): DetectedRuntime | null {
  // Match <TargetFramework>net8.0</TargetFramework> or <TargetFrameworks>net7.0;net6.0</TargetFrameworks>
  const targetFrameworkMatch = content.match(/<TargetFrameworks?>\s*([^<]+)\s*<\/TargetFrameworks?>/i);
  
  if (targetFrameworkMatch) {
    const frameworkValue = targetFrameworkMatch[1].trim();
    
    // Parse framework moniker: "net8.0", "net472", "netcoreapp3.1", etc.
    const frameworks = frameworkValue.split(';').map(f => f.trim());
    const primaryFramework = frameworks[0]; // Use first target if multiple
    
    // Parse version from framework moniker
    let version: string | null = null;
    
    // .NET 5+ format: net8.0, net7.0, net6.0
    const dotnetCoreMatch = primaryFramework.match(/^net(\d+)\.(\d+)$/);
    if (dotnetCoreMatch) {
      version = `${dotnetCoreMatch[1]}.${dotnetCoreMatch[2]}`;
    }
    
    // .NET Framework format: net472, net48, net481
    const dotnetFrameworkMatch = primaryFramework.match(/^net(\d)(\d)(\d?)$/);
    if (dotnetFrameworkMatch && !dotnetCoreMatch) {
      const major = dotnetFrameworkMatch[1];
      const minor = dotnetFrameworkMatch[2];
      const patch = dotnetFrameworkMatch[3] || '';
      version = patch ? `${major}.${minor}.${patch}` : `${major}.${minor}`;
    }
    
    // netcoreapp3.1, netcoreapp2.1 format
    const netCoreAppMatch = primaryFramework.match(/^netcoreapp(\d+)\.(\d+)$/);
    if (netCoreAppMatch) {
      version = `${netCoreAppMatch[1]}.${netCoreAppMatch[2]}`;
    }
    
    if (version) {
      return {
        name: '.NET',
        type: 'runtime',
        currentVersion: version,
        detectionMethod: '.csproj TargetFramework',
        confidence: 'high',
        source: filePath
      };
    }
  }
  
  // Fallback: Look for <PropertyGroup><TargetFrameworkVersion>v4.7.2</TargetFrameworkVersion>
  const versionMatch = content.match(/<TargetFrameworkVersion>\s*v?([^<]+)\s*<\/TargetFrameworkVersion>/i);
  if (versionMatch) {
    const version = versionMatch[1].replace(/^v/, '').trim();
    return {
      name: '.NET Framework',
      type: 'runtime',
      currentVersion: version,
      detectionMethod: '.csproj TargetFrameworkVersion',
      confidence: 'high',
      source: filePath
    };
  }
  
  return null;
}

/**
 * Detect .NET NuGet packages from .csproj PackageReference
 */
export function detectDotNetPackagesFromCsproj(content: string, filePath: string): DetectedRuntime[] {
  const detected: DetectedRuntime[] = [];
  
  // Match <PackageReference Include="PackageName" Version="1.0.0" />
  const packageReferenceRegex = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"\s*\/?>/gi;
  let match;
  
  const dotnetFrameworks: Record<string, string> = {
    'Microsoft.AspNetCore': 'ASP.NET Core',
    'Microsoft.AspNetCore.App': 'ASP.NET Core',
    'Microsoft.AspNetCore.Mvc': 'ASP.NET Core MVC',
    'Microsoft.EntityFrameworkCore': 'Entity Framework Core',
    'Microsoft.EntityFrameworkCore.SqlServer': 'Entity Framework Core',
    'EntityFramework': 'Entity Framework',
    'System.Web.Mvc': 'ASP.NET MVC',
    'Microsoft.AspNet.Mvc': 'ASP.NET MVC',
    'Microsoft.AspNet.WebApi': 'ASP.NET Web API',
    'Newtonsoft.Json': 'Json.NET',
    'AutoMapper': 'AutoMapper',
    'Dapper': 'Dapper',
    'NUnit': 'NUnit',
    'xUnit': 'xUnit',
    'Moq': 'Moq',
    'jQuery': 'jQuery',
    'Bootstrap': 'Bootstrap',
    'Handlebars': 'Handlebars',
    'FontAwesome': 'Font Awesome',
    'Font Awesome': 'Font Awesome',
    'Swashbuckle': 'Swashbuckle',
    'Microsoft.jQuery.Unobtrusive.Validation': 'jQuery Unobtrusive Validation',
    'jquery.validation': 'jQuery Validation',
  };

  while ((match = packageReferenceRegex.exec(content)) !== null) {
    const packageName = match[1];
    const version = match[2];
    const lower = packageName.toLowerCase();
    let added = false;
    for (const [pkgPattern, displayName] of Object.entries(dotnetFrameworks)) {
      if (packageName.includes(pkgPattern) || packageName === pkgPattern || lower.includes(pkgPattern.toLowerCase())) {
        detected.push({
          name: displayName,
          type: lower.includes('jquery') || lower.includes('bootstrap') || lower.includes('handlebars') || lower.includes('fontawesome') ? 'library' : 'framework',
          currentVersion: version,
          detectionMethod: '.csproj PackageReference',
          confidence: 'high',
          source: filePath
        });
        added = true;
        break;
      }
    }
    if (!added) {
      detected.push({
        name: packageName,
        type: 'library',
        currentVersion: version,
        detectionMethod: '.csproj PackageReference',
        confidence: 'high',
        source: filePath
      });
    }
  }

  return detected;
}

/**
 * Detect .NET packages from packages.config (legacy format)
 */
export function detectDotNetPackagesFromPackagesConfig(content: string, filePath: string): DetectedRuntime[] {
  const detected: DetectedRuntime[] = [];
  
  // Match <package id="PackageName" version="1.0.0" />
  const packageRegex = /<package\s+id="([^"]+)"\s+version="([^"]+)"/gi;
  let match;
  
  const dotnetFrameworks: Record<string, string> = {
    'Microsoft.AspNet.Mvc': 'ASP.NET MVC',
    'Microsoft.AspNet.WebApi': 'ASP.NET Web API',
    'EntityFramework': 'Entity Framework',
    'Newtonsoft.Json': 'Json.NET',
    'AutoMapper': 'AutoMapper',
    'Dapper': 'Dapper',
    'NUnit': 'NUnit',
    'xUnit': 'xUnit',
    'Moq': 'Moq',
    'Microsoft.jQuery.Unobtrusive.Validation': 'jQuery Unobtrusive Validation',
    'jquery.validation': 'jQuery Validation',
    'bootstrap': 'Bootstrap',
    'jQuery': 'jQuery',
    'Handlebars': 'Handlebars',
    'FontAwesome': 'Font Awesome',
    'Font Awesome': 'Font Awesome',
  };

  while ((match = packageRegex.exec(content)) !== null) {
    const packageName = match[1];
    const version = match[2];
    const lower = packageName.toLowerCase();
    let added = false;
    for (const [pkgPattern, displayName] of Object.entries(dotnetFrameworks)) {
      if (packageName.includes(pkgPattern) || packageName === pkgPattern || lower.includes(pkgPattern.toLowerCase())) {
        detected.push({
          name: displayName,
          type: lower.includes('jquery') || lower.includes('bootstrap') || lower.includes('handlebars') || lower.includes('fontawesome') ? 'library' : 'framework',
          currentVersion: version,
          detectionMethod: 'packages.config',
          confidence: 'high',
          source: filePath
        });
        added = true;
        break;
      }
    }
    if (!added) {
      detected.push({
        name: packageName,
        type: 'library',
        currentVersion: version,
        detectionMethod: 'packages.config',
        confidence: 'high',
        source: filePath
      });
    }
  }
  
  return detected;
}

/**
 * Detect ASP.NET version from Web.config
 */
export function detectAspNetVersionFromWebConfig(content: string, filePath: string): DetectedRuntime | null {
  // Match <httpRuntime targetFramework="4.7.2" />
  const targetFrameworkMatch = content.match(/<httpRuntime\s+targetFramework="([^"]+)"/i);
  
  if (targetFrameworkMatch) {
    const version = targetFrameworkMatch[1];
    return {
      name: 'ASP.NET',
      type: 'framework',
      currentVersion: version,
      detectionMethod: 'Web.config httpRuntime',
      confidence: 'high',
      source: filePath
    };
  }
  
  // Match <compilation debug="true" targetFramework="4.7.2">
  const compilationMatch = content.match(/<compilation[^>]+targetFramework="([^"]+)"/i);
  if (compilationMatch) {
    const version = compilationMatch[1];
    return {
      name: 'ASP.NET',
      type: 'framework',
      currentVersion: version,
      detectionMethod: 'Web.config compilation',
      confidence: 'high',
      source: filePath
    };
  }
  
  return null;
}

/**
 * Get available versions for runtimes (Node.js, Python, etc.)
 */
export async function fetchRuntimeVersions(runtimeName: string): Promise<string[]> {
  // This would ideally call official APIs
  // For now, return common LTS versions
  
  const knownVersions: Record<string, string[]> = {
    'Node.js': ['20.11.0', '20.10.0', '18.19.0', '18.18.0', '16.20.0', '16.19.0', '14.21.3'],
    'Python': ['3.12.0', '3.11.7', '3.11.0', '3.10.13', '3.10.0', '3.9.18', '3.8.18'],
    'Java': ['21', '17', '11', '8'],
    'TypeScript': ['5.3.0', '5.2.0', '5.1.0', '5.0.0', '4.9.0', '4.8.0', '4.7.0'],
    'React': ['18.2.0', '18.1.0', '18.0.0', '17.0.2', '17.0.1', '16.14.0'],
    'Vue.js': ['3.4.0', '3.3.0', '3.2.0', '2.7.14', '2.6.14'],
    'Angular': ['17.0.0', '16.0.0', '15.0.0', '14.0.0', '13.0.0'],
    'Django': ['5.0', '4.2', '4.1', '3.2', '3.1'],
    'Flask': ['3.0.0', '2.3.0', '2.2.0', '2.1.0', '2.0.0'],
    'Express': ['4.18.2', '4.18.0', '4.17.3', '4.17.1'],
    '.NET': ['10.0', '9.0', '8.0', '7.0', '6.0'],
    '.NET Framework': ['4.8.1', '4.8', '4.7.2', '4.7.1', '4.7', '4.6.2', '4.6.1', '4.6', '4.5.2', '4.5.1', '4.5'],
    'ASP.NET Core': ['8.0', '7.0', '6.0', '5.0', '3.1'],
    'Entity Framework Core': ['8.0', '7.0', '6.0', '5.0', '3.1'],
    'Entity Framework': ['6.4.4', '6.4.0', '6.3.0', '6.2.0', '6.1.3']
  };
  
  return knownVersions[runtimeName] || [];
}
