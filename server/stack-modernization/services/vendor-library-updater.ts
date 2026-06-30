/**
 * Vendor Library Updater Service
 *
 * Three-phase approach:
 *  1. Detect – Identify vendor libraries from directory names, version comment headers, and manifests
 *  2. Download – Fetch replacement dist files from jsDelivr for libraries that need upgrading
 *  3. Inject – Produce ModifiedFile entries and optionally generate a libman.json manifest
 */

import * as https from "https";
import type { VendorLibrary, DownloadedVendorFile, VersionSelection, ExtractedFile, CdnReference, InferredLibrary } from "../types";
import type { VendorDirEntry } from "./temp-storage";

// ═══════════════════════════════════════════════════════════════
// Directory name → npm package name mapping
// ═══════════════════════════════════════════════════════════════

const DIR_TO_NPM: Record<string, string> = {
  "bootstrap": "bootstrap",
  "twitter-bootstrap": "bootstrap",
  "jquery": "jquery",
  "jquery-validation": "jquery-validation",
  "jquery.validation": "jquery-validation",
  "jquery-validation-unobtrusive": "jquery-validation-unobtrusive",
  "jquery-validate-unobtrusive": "jquery-validation-unobtrusive",
  "jquery-ui": "jquery-ui-dist",
  "jquery.ui": "jquery-ui-dist",
  "font-awesome": "@fortawesome/fontawesome-free",
  "fontawesome": "@fortawesome/fontawesome-free",
  "@fortawesome": "@fortawesome/fontawesome-free",
  "popper.js": "@popperjs/core",
  "popper": "@popperjs/core",
  "@popperjs": "@popperjs/core",
  "signalr": "@microsoft/signalr",
  "@aspnet/signalr": "@microsoft/signalr",
  "@microsoft/signalr": "@microsoft/signalr",
  "moment": "moment",
  "lodash": "lodash",
  "axios": "axios",
  "select2": "select2",
  "datatables": "datatables.net",
  "datatables.net": "datatables.net",
  "chart.js": "chart.js",
  "chartjs": "chart.js",
  "toastr": "toastr",
  "sweetalert2": "sweetalert2",
  "bootbox": "bootbox",
  "bootboxjs": "bootbox",
  "handlebars": "handlebars",
  "handlebars.js": "handlebars",
  "kendo": "@progress/kendo-ui",
  "kendo-ui": "@progress/kendo-ui",
  "sammy": "sammy",
  "sammy.js": "sammy",
  "knockout": "knockout",
  "underscore": "underscore",
  "backbone": "backbone",
  "animate.css": "animate.css",
  "bootstrap-datepicker": "bootstrap-datepicker",
  "d3": "d3",
  "are-you-sure": "jquery.are-you-sure",
};

export function resolveNpmName(dirName: string): string {
  return DIR_TO_NPM[dirName.toLowerCase()] ?? dirName.toLowerCase();
}

// ── Universal version header scanner ──
// Works for ANY tech stack, ANY library, ANY comment format:
// - Block comments: /*! jQuery v3.6.3 */
// - Multiline CSS:  /*!\n * Bootstrap v4.6.2\n */
// - @license:       /** @license React v18.2.0 */
// - version: key:   /*! @preserve\n * bootbox.js\n * version: 6.0.0\n */
// - Single-line:    // Vue.js v2.7.14
// - Indented:       //     Underscore.js 1.13.6

// Pattern A: Block comments — covers 90% of libraries
const VERSION_PATTERN_A = /\/[*][*!]?[\s\S]{0,300}?([a-zA-Z][\w._ -]+?)\s+v?(\d+\.\d+(?:\.\d+)?)/g;
// Pattern B: "version:" key after a filename — bootbox, datepicker style
const VERSION_PATTERN_B = /\*\s+([a-zA-Z][\w._-]+(?:\.js|\.css)?)\s*\n[\s\S]{0,100}?version[:\s=]+v?(\d+\.\d+(?:\.\d+)?)/gi;
// Pattern C: Single-line // comments
const VERSION_PATTERN_C = /\/\/\s*([a-zA-Z][\w._ -]+?)\s+v(\d+\.\d+(?:\.\d+)?)/g;
// Pattern D: Indented // comments (Underscore.js style)
const VERSION_PATTERN_D = /\/\/\s{2,}([a-zA-Z][\w._-]+(?:\.js)?)\s+(\d+\.\d+(?:\.\d+)?)/g;
// Pattern E: "Version X.Y.Z" on separate line after library name (jQuery blockUI style)
const VERSION_PATTERN_E = /\*\s+([a-zA-Z][\w._ -]+?)(?:\s+plugin)?\s*\n\s*\*\s*Version\s+v?(\d+\.\d+(?:\.\d+)?)/gi;

const VERSION_PATTERNS = [VERSION_PATTERN_A, VERSION_PATTERN_B, VERSION_PATTERN_C, VERSION_PATTERN_D, VERSION_PATTERN_E];

// Stopwords — these are NOT library names
const VERSION_HEADER_STOPWORDS = new Set([
  "the", "this", "a", "an", "if", "for", "var", "let", "const",
  "function", "return", "type", "http", "https", "www", "version",
  "copyright", "license", "licensed", "author", "module", "exports",
]);

/**
 * Scan a string for ALL library version headers. Works for any tech stack.
 * Returns array of { name, version } where name is the library name from the header.
 */
export function scanVersionHeaders(content: string): Array<{ name: string; version: string; offset: number }> {
  const results: Array<{ name: string; version: string; offset: number }> = [];
  const seen = new Set<string>();

  for (const pattern of VERSION_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      let name = m[1].trim();
      // Clean common prefixes from captures
      name = name.replace(/^[@!*\s]+/g, "").replace(/^(license|preserve|version)\s+/i, "").trim();
      if (name.length < 2 || name.length > 50) continue;
      if (VERSION_HEADER_STOPWORDS.has(name.toLowerCase())) continue;
      const version = m[2];
      const key = name.toLowerCase().replace(/[.\s_-]/g, "") + "@" + version;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ name, version, offset: m.index });
      }
    }
  }

  return results;
}

// Legacy single-match regex (still used by detectVendorLibraries for first-header extraction)
const VERSION_COMMENT_RE = /\/[*][*!]?[\s\S]{0,300}?([a-zA-Z][\w._ -]+?)\s+v?(\d+\.\d+(?:\.\d+)?)/;
const VERSION_COMMENT_GLOBAL_RE = /\/[*][*!]?[\s\S]{0,300}?([a-zA-Z][\w._ -]+?)\s+v?(\d+\.\d+(?:\.\d+)?)/g;

const DOWNLOADABLE_EXTENSIONS = new Set([".js", ".css", ".scss", ".less", ".ts"]);

// ═══════════════════════════════════════════════════════════════
// Phase 1 – Detection
// ═══════════════════════════════════════════════════════════════

/**
 * Detect vendor libraries from scanned vendor directory entries.
 * Also cross-references with libman.json if present in extractedFiles.
 */
export function detectVendorLibraries(
  vendorEntries: VendorDirEntry[],
  extractedFiles: ExtractedFile[],
): VendorLibrary[] {
  const libmanLibs = parseLibmanFromExtracted(extractedFiles);

  const grouped = new Map<string, VendorDirEntry[]>();
  for (const entry of vendorEntries) {
    const key = entry.vendorBasePath.replace(/\\/g, "/");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(entry);
  }

  const results: VendorLibrary[] = [];

  for (const [basePath, files] of grouped) {
    const dirName = files[0].libraryDirName;
    const npmName = resolveNpmName(dirName);

    let version: string | null = null;
    let method: VendorLibrary["detectionMethod"] = "directory";

    const libmanEntry = libmanLibs.get(npmName) ?? libmanLibs.get(dirName.toLowerCase());
    if (libmanEntry) {
      version = libmanEntry.version;
      method = "manifest";
    }

    if (!version) {
      for (const f of files) {
        if (f.header) {
          const m = f.header.match(VERSION_COMMENT_RE);
          if (m) {
            version = m[2];
            if (method === "directory") method = "version-comment";
            break;
          }
        }
      }
    }

    results.push({
      name: npmName,
      detectedVersion: version,
      vendorBasePath: basePath.replace(/\\/g, "/"),
      existingFiles: files.map(f => f.relativePath.replace(/\\/g, "/")),
      detectionMethod: method,
    });
  }

  return results;
}

function parseLibmanFromExtracted(files: ExtractedFile[]): Map<string, { version: string | null }> {
  const map = new Map<string, { version: string | null }>();
  for (const f of files) {
    if (!f.relativePath.toLowerCase().endsWith("libman.json")) continue;
    try {
      const parsed = JSON.parse(f.content);
      for (const lib of parsed.libraries ?? []) {
        const raw: string = lib.library || lib.name || "";
        if (!raw) continue;
        const atIdx = raw.lastIndexOf("@");
        const pkgName = atIdx > 0 ? raw.slice(0, atIdx).trim() : raw.trim();
        const ver = atIdx > 0 ? raw.slice(atIdx + 1).trim() || null : null;
        const npm = resolveNpmName(pkgName);
        map.set(npm, { version: ver });
        map.set(pkgName.toLowerCase(), { version: ver });
      }
    } catch { /* ignore */ }
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════
// Phase 1b – Bundled/Concatenated file scanning (GAP 1 + GAP 7)
// ═══════════════════════════════════════════════════════════════

/** Library name normalization for matching version comment headers to npm packages */
const HEADER_NAME_TO_NPM: Record<string, string> = {
  "jquery": "jquery",
  "jquery javascript library": "jquery",
  "jquery slim": "jquery",
  "bootstrap": "bootstrap",
  "twitter bootstrap": "bootstrap",
  "bootstrap datepicker": "bootstrap-datepicker",
  "font awesome": "@fortawesome/fontawesome-free",
  "font awesome free": "@fortawesome/fontawesome-free",
  "fontawesome free": "@fortawesome/fontawesome-free",
  "popper": "@popperjs/core",
  "popper.js": "@popperjs/core",
  "select2": "select2",
  "datatables": "datatables.net",
  "toastr": "toastr",
  "handlebars": "handlebars",
  "moment.js": "moment",
  "moment": "moment",
  "lodash": "lodash",
  "underscore.js": "underscore",
  "backbone.js": "backbone",
  "knockout": "knockout",
  "animate.css": "animate.css",
  "chart.js": "chart.js",
  "d3.js": "d3",
  "sweetalert2": "sweetalert2",
  "bootbox.js": "bootbox",
  "bootbox": "bootbox",
  "sammy.js": "sammy",
  "sammy": "sammy",
  "kendo ui": "@progress/kendo-ui",
  "signalr": "@microsoft/signalr",
  "jquery ui": "jquery-ui-dist",
  "jquery validation": "jquery-validation",
  "jquery.validate": "jquery-validation",
  "normalize.css": "normalize.css",
  "axios": "axios",
  // Additional libraries detected by the universal scanner
  "react": "react",
  "react dom": "react-dom",
  "vue.js": "vue",
  "vue": "vue",
  "angular": "@angular/core",
  "leaflet": "leaflet",
  "modernizr": "modernizr",
  "socket.io": "socket.io-client",
  "jquery validation plugin": "jquery-validation",
  "jquery blockui": "jquery-blockui",
  "jquery.blockui": "jquery-blockui",
  "idle timeout": "idle-timeout",
  "sweetalert": "sweetalert",
  "d3": "d3",
  "three.js": "three",
  "fullcalendar": "fullcalendar",
  "tinymce": "tinymce",
  "ckeditor": "ckeditor4",
  "summernote": "summernote",
  "slick": "slick-carousel",
  "owl carousel": "owl.carousel",
  "swiper": "swiper",
};

function resolveHeaderName(headerName: string): string | null {
  const lower = headerName.toLowerCase().replace(/[_\-\.]+/g, " ").trim();
  // Try exact match first
  if (HEADER_NAME_TO_NPM[lower]) return HEADER_NAME_TO_NPM[lower];
  // Try with .js/.css suffix stripped
  const noExt = lower.replace(/\s*(\.js|\.css)$/i, "").trim();
  if (HEADER_NAME_TO_NPM[noExt]) return HEADER_NAME_TO_NPM[noExt];
  // Try original casing lowered with dots preserved
  const withDots = headerName.toLowerCase().trim();
  if (HEADER_NAME_TO_NPM[withDots]) return HEADER_NAME_TO_NPM[withDots];
  return null;
}

export interface BundleLibraryDetection {
  filePath: string;
  libraries: Array<{
    name: string;
    npmPackage: string;
    version: string;
    /** Approximate byte offset where the header was found */
    offset: number;
  }>;
  isConcatenated: boolean;
}

/**
 * Scan a single file for ALL version comment headers (not just the first).
 * This detects concatenated bundle files like base-library.js = jQuery + Bootstrap.
 *
 * GAP 1 fix — the old detectVendorLibraries only read the first header per file.
 */
/**
 * Scan a file for ALL library version headers using the universal 4-pattern scanner.
 * Works for any tech stack: .NET, Java, Python, Node.js, PHP, Ruby, etc.
 * Detects libraries in block comments, multiline CSS, version: keys, and single-line comments.
 */
export function scanFileForBundledLibraries(
  filePath: string,
  content: string,
): BundleLibraryDetection {
  const libraries: BundleLibraryDetection["libraries"] = [];
  const seen = new Set<string>();

  // Use the universal scanner that handles ALL comment formats
  const headers = scanVersionHeaders(content);

  for (const header of headers) {
    // Try to resolve to an npm package
    const npmPackage = resolveHeaderName(header.name) ?? resolveNpmName(header.name.toLowerCase().replace(/[\s.]+/g, "-").replace(/\.js$|\.css$/i, ""));
    const key = `${npmPackage}@${header.version}`;

    if (!seen.has(key)) {
      seen.add(key);
      libraries.push({
        name: header.name,
        npmPackage,
        version: header.version,
        offset: header.offset,
      });
    }
  }

  return {
    filePath: filePath.replace(/\\/g, "/"),
    libraries,
    // Mark as concatenated if ANY library detected — single-lib bundles in custom-named dirs
    // (e.g. uiframework/base-library.js with just jQuery) also need download+replace
    // since their filenames don't match standard npm dist paths
    isConcatenated: libraries.length >= 1,
  };
}

/**
 * Scan all extracted files for bundled/concatenated vendor libraries.
 * Returns detections for files that contain 1+ identifiable library headers.
 *
 * This is the primary entry point for GAP 1 — multi-library detection.
 */
export function scanAllFilesForBundles(
  files: Array<{ relativePath: string; content: string }>,
): BundleLibraryDetection[] {
  const vendorDirs = [
    // .NET
    "wwwroot/", "Scripts/", "Content/",
    // Java / Spring
    "webapp/", "resources/static/",
    // Python / Django / Flask
    "static/", "staticfiles/",
    // Ruby / Rails
    "app/assets/",
    // PHP / Laravel
    "resources/js/",
    // Generic
    "public/", "assets/", "lib/", "vendor/",
  ];
  const results: BundleLibraryDetection[] = [];

  for (const file of files) {
    const norm = file.relativePath.replace(/\\/g, "/");
    const ext = norm.substring(norm.lastIndexOf(".")).toLowerCase();
    if (!DOWNLOADABLE_EXTENSIONS.has(ext)) continue;

    // Only scan files in vendor-like directories
    const isVendorDir = vendorDirs.some(d => norm.toLowerCase().includes(d.toLowerCase()));
    if (!isVendorDir) continue;

    // Skip tiny files
    if (file.content.length < 100) continue;

    const detection = scanFileForBundledLibraries(norm, file.content);
    if (detection.libraries.length > 0) {
      results.push(detection);
    }
  }

  return results;
}

/**
 * Merge bundle detections into the existing VendorLibrary[] results.
 * If a bundle file contains a library not yet in the vendor list, add it.
 * If a library is already detected but with wrong version, update it.
 */
export function mergeBundleDetections(
  existingVendors: VendorLibrary[],
  bundles: BundleLibraryDetection[],
): { vendors: VendorLibrary[]; bundledFiles: Map<string, BundleLibraryDetection> } {
  const vendorMap = new Map<string, VendorLibrary>();
  for (const v of existingVendors) {
    vendorMap.set(v.name.toLowerCase(), v);
  }

  const bundledFiles = new Map<string, BundleLibraryDetection>();

  for (const bundle of bundles) {
    if (bundle.isConcatenated) {
      bundledFiles.set(bundle.filePath, bundle);
    }

    for (const lib of bundle.libraries) {
      const key = lib.npmPackage.toLowerCase();
      if (!vendorMap.has(key)) {
        // New library found only inside a bundle — add it
        vendorMap.set(key, {
          name: lib.npmPackage,
          detectedVersion: lib.version,
          vendorBasePath: bundle.filePath.substring(0, bundle.filePath.lastIndexOf("/")),
          existingFiles: [bundle.filePath],
          detectionMethod: "version-comment",
        });
      } else {
        // Library already known — update version if detected from a bundle
        const existing = vendorMap.get(key)!;
        if (!existing.detectedVersion && lib.version) {
          existing.detectedVersion = lib.version;
        }
        // Track that this file also contains the library
        if (!existing.existingFiles.includes(bundle.filePath)) {
          existing.existingFiles.push(bundle.filePath);
        }
      }
    }
  }

  return {
    vendors: Array.from(vendorMap.values()),
    bundledFiles,
  };
}

// ═══════════════════════════════════════════════════════════════
// Phase 1c – Merge CDN references and CSS-class-inferred detections
// ═══════════════════════════════════════════════════════════════

/**
 * Merge CDN-detected and CSS-class-inferred libraries into the existing VendorLibrary[] list.
 * Avoids duplicates — only adds a library if it's not already present.
 */
export function mergeCdnAndInferredDetections(
  existingVendors: VendorLibrary[],
  cdnRefs: CdnReference[],
  inferred: InferredLibrary[],
): VendorLibrary[] {
  const vendorMap = new Map<string, VendorLibrary>();
  for (const v of existingVendors) {
    vendorMap.set(v.name.toLowerCase(), v);
  }

  // Merge CDN references — each unique (npmPackage, version) pair
  const cdnByPackage = new Map<string, CdnReference[]>();
  for (const ref of cdnRefs) {
    const key = ref.npmPackage.toLowerCase();
    if (!cdnByPackage.has(key)) cdnByPackage.set(key, []);
    cdnByPackage.get(key)!.push(ref);
  }

  for (const [pkgKey, refs] of cdnByPackage) {
    if (vendorMap.has(pkgKey)) {
      // Library already detected — update version if we have a CDN version and vendor doesn't
      const existing = vendorMap.get(pkgKey)!;
      if (!existing.detectedVersion) {
        const versionedRef = refs.find(r => r.version);
        if (versionedRef) existing.detectedVersion = versionedRef.version;
      }
      // Track CDN files as existing files
      for (const ref of refs) {
        if (!existing.existingFiles.includes(ref.file)) {
          existing.existingFiles.push(ref.file);
        }
      }
    } else {
      // New library — only known from CDN
      const firstRef = refs[0];
      const version = refs.find(r => r.version)?.version ?? null;
      vendorMap.set(pkgKey, {
        name: firstRef.npmPackage,
        detectedVersion: version,
        vendorBasePath: "",
        existingFiles: [...new Set(refs.map(r => r.file))],
        detectionMethod: "inferred",
      });
    }
  }

  // Merge CSS-class-inferred libraries — only high confidence
  for (const lib of inferred) {
    if (lib.confidence !== "high") continue;
    const key = lib.npmPackage.toLowerCase();
    if (vendorMap.has(key)) continue; // already detected via vendor dir, bundle, or CDN
    vendorMap.set(key, {
      name: lib.npmPackage,
      detectedVersion: null, // version unknown from CSS classes alone
      vendorBasePath: "",
      existingFiles: lib.detectedIn,
      detectionMethod: "inferred",
    });
  }

  const result = Array.from(vendorMap.values());
  const addedCount = result.length - existingVendors.length;
  if (addedCount > 0) {
    console.log(`[VendorLibraryUpdater] Merged ${addedCount} additional libraries from CDN/CSS-class detection`);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// Phase 2 – Download from jsDelivr
// ═══════════════════════════════════════════════════════════════

interface JsDelivrFile {
  name: string;
  hash: string;
  size: number;
}

interface DownloadOptions {
  perFileTimeoutMs?: number;
  totalTimeoutMs?: number;
}

/**
 * Download updated vendor dist files from jsDelivr for each library that has a
 * matching user selection. Only fetches files that already exist in the project.
 */
/**
 * Build a multi-key selection lookup that handles:
 * - Exact npm name match (e.g., "jquery" → "jquery")
 * - Display name variants (e.g., "jQuery" → "jquery", "Bootstrap" → "bootstrap")
 * - DIR_TO_NPM reverse mappings (e.g., "font-awesome" → "@fortawesome/fontawesome-free")
 * - Scoped package short names (e.g., "@fortawesome/fontawesome-free" → "fontawesome-free")
 */
export function buildSelectionLookup(selections: VersionSelection[]): (name: string) => VersionSelection | undefined {
  const map = new Map<string, VersionSelection>();
  for (const s of selections) {
    const pkg = s.package.toLowerCase().trim();
    map.set(pkg, s);
    // Also register without scope prefix
    if (pkg.startsWith("@") && pkg.includes("/")) {
      map.set(pkg.split("/").pop()!, s);
    }
    // Also register the display name without special chars
    map.set(pkg.replace(/[^a-z0-9]/g, ""), s);
  }
  // Register reverse DIR_TO_NPM entries — when vendor.name is an npm name,
  // check if any selection used the directory-style name
  for (const [dirName, npmName] of Object.entries(DIR_TO_NPM)) {
    const sel = map.get(npmName.toLowerCase());
    if (sel) map.set(dirName.toLowerCase(), sel);
    const sel2 = map.get(dirName.toLowerCase());
    if (sel2) map.set(npmName.toLowerCase(), sel2);
  }

  // Common display-name → npm-name aliases that users might type
  // These handle cases like "jQuery Validate" → "jquery-validation"
  const DISPLAY_ALIASES: Record<string, string[]> = {
    "jquery-validation":           ["jquery validate", "jqueryvalidate", "jquery validation", "jqueryvalidation"],
    "jquery-validation-unobtrusive": ["jquery validation unobtrusive", "jqueryvalidationunobtrusive"],
    "@fortawesome/fontawesome-free": ["font awesome", "fontawesome", "font-awesome"],
    "bootstrap-datepicker":        ["bootstrap datepicker", "bootstrapdatepicker"],
    "@progress/kendo-ui":          ["kendo ui", "kendoui", "kendo"],
    "jquery-ui-dist":              ["jquery ui", "jqueryui", "jquery.ui"],
    "bootbox":                     ["bootbox"],
    "sammy":                       ["sammy js", "sammyjs", "sammy.js"],
  };
  for (const [npmName, aliases] of Object.entries(DISPLAY_ALIASES)) {
    for (const alias of aliases) {
      // If any selection has this alias, register the npm name
      const sel = map.get(alias);
      if (sel) {
        map.set(npmName, sel);
        // Also register without special chars
        map.set(npmName.replace(/[^a-z0-9]/g, ""), sel);
      }
      // If any selection has the npm name, register the alias
      const sel2 = map.get(npmName) ?? map.get(npmName.replace(/[^a-z0-9]/g, ""));
      if (sel2) {
        map.set(alias, sel2);
        map.set(alias.replace(/[^a-z0-9]/g, ""), sel2);
      }
    }
  }

  return (name: string): VersionSelection | undefined => {
    const lower = name.toLowerCase().trim();
    return map.get(lower) ?? map.get(lower.replace(/[^a-z0-9]/g, "")) ?? undefined;
  };
}

export async function downloadVendorDistFiles(
  vendors: VendorLibrary[],
  selections: VersionSelection[],
  extractDir: string,
  opts: DownloadOptions = {},
): Promise<DownloadedVendorFile[]> {
  // No artificial timeouts — let each download complete naturally.
  // Large library files (Bootstrap 200KB, Font Awesome 300KB) need time.
  const perFileTimeout = 0; // 0 = no timeout
  const totalStart = Date.now();

  const findSelection = buildSelectionLookup(selections);

  const downloaded: DownloadedVendorFile[] = [];

  console.log(`[VendorUpdater] Attempting to download files for ${vendors.length} vendors (no timeout). Selection packages: ${selections.map(s => s.package).join(", ")}`);

  for (const vendor of vendors) {
    // CRITICAL: Skip "inferred" vendors — their existingFiles are VIEW/APP files
    // where CSS classes were found (e.g., _Layout.cshtml, site.css), NOT library files.
    // Downloading library content into these paths would DESTROY the application's CSS.
    // Inferred vendors are handled by bundle rebuild (Phase 2) instead.
    if (vendor.detectionMethod === "inferred") {
      console.log(`[VendorUpdater] Skipping inferred vendor "${vendor.name}" — existingFiles are app files, not library files`);
      continue;
    }

    // Skip vendors with no vendorBasePath (another sign of non-library detection)
    if (!vendor.vendorBasePath) {
      console.log(`[VendorUpdater] Skipping vendor "${vendor.name}" — no vendorBasePath (not a real library directory)`);
      continue;
    }

    const sel = findSelection(vendor.name);
    if (!sel) {
      console.warn(`[VendorUpdater] No matching selection for vendor "${vendor.name}" — available selections: [${selections.map(s => s.package).join(", ")}]`);
      continue;
    }
    if (sel.selectedVersion === sel.currentVersion) continue;

    const targetVersion = sel.selectedVersion;

    try {
      const packageFiles = await listJsDelivrFiles(vendor.name, targetVersion, perFileTimeout);
      if (!packageFiles.length) {
        console.warn(`[VendorUpdater] No files listed for ${vendor.name}@${targetVersion}`);
        continue;
      }

      const fileNameSet = new Set(packageFiles.map(f => f.name.replace(/^\//, "")));

      let anyDownloaded = false;
      for (const existingPath of vendor.existingFiles) {
        // No timeout — let each download complete

        const ext = existingPath.substring(existingPath.lastIndexOf(".")).toLowerCase();
        if (!DOWNLOADABLE_EXTENSIONS.has(ext)) continue;

        const matchedDistPath = findMatchingDistPath(existingPath, vendor.vendorBasePath, fileNameSet);
        if (!matchedDistPath) {
          console.log(`[VendorUpdater] No jsDelivr match for "${existingPath}" in ${vendor.name}@${targetVersion} — will try PACKAGE_PRIMARY_DIST fallback`);
          continue;
        }

        try {
          const content = await fetchFileFromCdn(vendor.name, targetVersion, matchedDistPath, perFileTimeout);
          let originalContent = "";
          try {
            const { readVendorFileContent } = await import("./temp-storage");
            originalContent = await readVendorFileContent(extractDir, existingPath);
          } catch { /* old content unavailable */ }

          downloaded.push({
            projectPath: existingPath,
            content,
            originalContent,
            library: vendor.name,
            oldVersion: vendor.detectedVersion,
            newVersion: targetVersion,
            cdnPath: matchedDistPath,
          });
          anyDownloaded = true;
        } catch (err) {
          console.warn(`[VendorUpdater] Failed to download ${vendor.name}/${matchedDistPath}:`, err instanceof Error ? err.message : err);
        }
      }

      // FALLBACK: If no files matched via path matching, use PACKAGE_PRIMARY_DIST to download
      // the standard dist file and place it at the vendor's existing file path.
      // This handles cases like bootstrap-datepicker/bootstrap-datepicker.js where the
      // project uses a non-standard filename that doesn't match jsDelivr's dist structure.
      if (!anyDownloaded) {
        const primaryDist = PACKAGE_PRIMARY_DIST[vendor.name.toLowerCase()];
        if (primaryDist) {
          for (const existingPath of vendor.existingFiles) {
            const ext = existingPath.substring(existingPath.lastIndexOf(".")).toLowerCase();
            const distFile = (ext === ".js" || ext === ".mjs") ? primaryDist.js : (ext === ".css" || ext === ".scss") ? primaryDist.css : undefined;
            if (!distFile) continue;

            try {
              console.log(`[VendorUpdater] FALLBACK: Downloading ${vendor.name}@${targetVersion}/${distFile} → ${existingPath}`);
              const content = await fetchFileFromCdn(vendor.name, targetVersion, distFile, perFileTimeout);
              let originalContent = "";
              try {
                const { readVendorFileContent } = await import("./temp-storage");
                originalContent = await readVendorFileContent(extractDir, existingPath);
              } catch { /* old content unavailable */ }

              downloaded.push({
                projectPath: existingPath,
                content,
                originalContent,
                library: vendor.name,
                oldVersion: vendor.detectedVersion,
                newVersion: targetVersion,
                cdnPath: distFile,
              });
            } catch (err) {
              console.warn(`[VendorUpdater] FALLBACK download failed for ${vendor.name}/${distFile}:`, err instanceof Error ? err.message : err);
            }
          }
        } else {
          console.warn(`[VendorUpdater] No PACKAGE_PRIMARY_DIST mapping for "${vendor.name}" — cannot download`);
        }
      }
    } catch (err) {
      console.warn(`[VendorUpdater] Failed to list files for ${vendor.name}@${targetVersion}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[VendorUpdater] Downloaded ${downloaded.length} vendor files in ${Date.now() - totalStart}ms`);
  return downloaded;
}

/** Default dist file to download from each npm package for concatenated bundle replacement */
export { PACKAGE_PRIMARY_DIST as PACKAGE_PRIMARY_DIST_PUBLIC };
const PACKAGE_PRIMARY_DIST: Record<string, { js?: string; css?: string }> = {
  "jquery": { js: "dist/jquery.min.js" },
  "bootstrap": { js: "dist/js/bootstrap.bundle.min.js", css: "dist/css/bootstrap.min.css" },
  "@popperjs/core": { js: "dist/umd/popper.min.js" },
  "@fortawesome/fontawesome-free": { css: "css/all.min.css" },
  "bootstrap-datepicker": { js: "dist/js/bootstrap-datepicker.min.js", css: "dist/css/bootstrap-datepicker.min.css" },
  "select2": { js: "dist/js/select2.min.js", css: "dist/css/select2.min.css" },
  "datatables.net": { js: "js/dataTables.min.js", css: "css/dataTables.dataTables.min.css" },
  "toastr": { js: "build/toastr.min.js", css: "build/toastr.min.css" },
  "moment": { js: "min/moment.min.js" },
  "lodash": { js: "lodash.min.js" },
  "jquery-validation": { js: "dist/jquery.validate.min.js" },
  "jquery-validation-unobtrusive": { js: "dist/jquery.validate.unobtrusive.min.js" },
  "jquery-ui-dist": { js: "jquery-ui.min.js", css: "jquery-ui.min.css" },
  "handlebars": { js: "dist/handlebars.min.js" },
  "chart.js": { js: "dist/chart.umd.js" },
  "animate.css": { css: "animate.min.css" },
  "bootbox": { js: "dist/bootbox.min.js" },
  "sammy": { js: "lib/sammy.js" },
  "knockout": { js: "build/output/knockout-latest.js" },
  "underscore": { js: "underscore-min.js" },
  "backbone": { js: "backbone-min.js" },
  "signalr": { js: "dist/browser/signalr.min.js" },
  "@microsoft/signalr": { js: "dist/browser/signalr.min.js" },
};

/**
 * Rebuild concatenated bundle files (like base-library.js = jQuery + Bootstrap)
 * by downloading the primary dist file for each detected library and concatenating them.
 *
 * This handles the case where vendor libraries are bundled into a custom-named file
 * (e.g. `uiframework/base-library.js`) that can't be matched to standard dist paths.
 */
export async function rebuildConcatenatedBundles(
  bundleDetections: BundleLibraryDetection[],
  selections: VersionSelection[],
  extractDir: string,
  opts: DownloadOptions = {},
): Promise<DownloadedVendorFile[]> {
  const perFileTimeout = 0; // No timeout — let downloads complete naturally
  const totalStart = Date.now();

  const findSelection = buildSelectionLookup(selections);

  const results: DownloadedVendorFile[] = [];

  for (const bundle of bundleDetections) {
    // Process concatenated bundles (2+ libraries) AND single-library bundles
    // in custom-named directories (e.g. uiframework/base-library.css = just Bootstrap)
    // where downloadVendorDistFiles can't match the custom filename to a dist path
    if (bundle.libraries.length < 1) continue;

    const ext = bundle.filePath.substring(bundle.filePath.lastIndexOf(".")).toLowerCase();
    const isJs = ext === ".js";
    const isCss = ext === ".css";
    if (!isJs && !isCss) continue;

    // For each library in the bundle, download the upgraded version's primary dist file
    const parts: string[] = [];
    let anyUpgraded = false;

    for (const lib of bundle.libraries) {
      // No timeout — let each download complete

      const sel = findSelection(lib.npmPackage);
      const targetVersion = sel?.selectedVersion ?? lib.version;
      const primaryDist = PACKAGE_PRIMARY_DIST[lib.npmPackage.toLowerCase()];
      const distFile = isJs ? primaryDist?.js : primaryDist?.css;

      if (!distFile) {
        console.warn(`[VendorUpdater] No primary dist mapping for ${lib.npmPackage} (${ext}), skipping in bundle`);
        continue;
      }

      try {
        const content = await fetchFileFromCdn(lib.npmPackage, targetVersion, distFile, perFileTimeout);
        parts.push(content);
        if (sel && sel.selectedVersion !== sel.currentVersion) {
          anyUpgraded = true;
        }
      } catch (err) {
        console.warn(`[VendorUpdater] Failed to download ${lib.npmPackage}@${targetVersion}/${distFile}:`, err instanceof Error ? err.message : err);
      }
    }

    if (parts.length > 0 && anyUpgraded) {
      const newContent = parts.join("\n\n");

      // Read original content from disk
      let originalContent = "";
      try {
        const fsP = await import("fs/promises");
        const pathM = await import("path");
        originalContent = await fsP.readFile(pathM.join(extractDir, bundle.filePath), "utf-8");
      } catch { /* original unavailable */ }

      const libraryNames = bundle.libraries.map(l => l.npmPackage).join(" + ");
      const firstLib = bundle.libraries[0];
      const firstSel = firstLib ? findSelection(firstLib.npmPackage) : undefined;
      const firstDistPath = firstLib ? (PACKAGE_PRIMARY_DIST[firstLib.npmPackage.toLowerCase()]?.js || PACKAGE_PRIMARY_DIST[firstLib.npmPackage.toLowerCase()]?.css || "dist") : "dist";
      results.push({
        projectPath: bundle.filePath,
        content: newContent,
        originalContent,
        library: libraryNames,
        oldVersion: bundle.libraries.map(l => `${l.name}@${l.version}`).join(", "),
        newVersion: bundle.libraries.map(l => {
          const s = findSelection(l.npmPackage);
          return `${l.npmPackage}@${s?.selectedVersion ?? l.version}`;
        }).join(", "),
        cdnPath: firstDistPath,
      });

      console.log(`[VendorUpdater] Rebuilt concatenated bundle: ${bundle.filePath} (${bundle.libraries.length} libraries)`);
    }
  }

  console.log(`[VendorUpdater] Rebuilt ${results.length} concatenated bundles in ${Date.now() - totalStart}ms`);
  return results;
}

/**
 * Match an existing project file path against the jsDelivr file set.
 * e.g. project has "wwwroot/lib/bootstrap/dist/css/bootstrap.min.css"
 * vendorBasePath is "wwwroot/lib/bootstrap"
 * → suffix = "dist/css/bootstrap.min.css"
 * → check if that exists in the package file set
 */
function findMatchingDistPath(
  existingPath: string,
  vendorBasePath: string,
  availableFiles: Set<string>,
): string | null {
  const normalized = existingPath.replace(/\\/g, "/");
  const base = vendorBasePath.replace(/\\/g, "/");

  let suffix = "";
  const idx = normalized.indexOf(base);
  if (idx >= 0) {
    suffix = normalized.slice(idx + base.length).replace(/^\//, "");
  }
  if (!suffix) return null;

  if (availableFiles.has(suffix)) return suffix;

  if (availableFiles.has("dist/" + suffix)) return "dist/" + suffix;

  const fileName = suffix.split("/").pop()!;
  for (const af of availableFiles) {
    if (af.endsWith("/" + fileName) || af === fileName) return af;
  }

  return null;
}

/**
 * Recursively flatten the nested jsDelivr directory tree into a flat file list.
 * jsDelivr returns: { files: [{ type: "directory", name: "dist", files: [...] }, { type: "file", name: "x.js" }] }
 * We need: [{ name: "/dist/x.js" }, { name: "/y.js" }]
 */
function flattenJsDelivrTree(items: any[], prefix = ""): JsDelivrFile[] {
  const result: JsDelivrFile[] = [];
  for (const item of items) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.type === "directory" && Array.isArray(item.files)) {
      result.push(...flattenJsDelivrTree(item.files, path));
    } else if (item.type === "file") {
      result.push({ name: path, hash: item.hash ?? "", size: item.size ?? 0 });
    }
  }
  return result;
}

function listJsDelivrFiles(packageName: string, version: string, timeoutMs: number = 0): Promise<JsDelivrFile[]> {
  const encodedPkg = encodeURIComponent(packageName);
  // Use the tree endpoint (NOT /flat which returns 400)
  const url = `https://data.jsdelivr.com/v1/packages/npm/${encodedPkg}@${version}`;

  return new Promise((resolve) => {
    // No timeout by default — let the request complete
    const timer = timeoutMs > 0 ? setTimeout(() => {
      console.warn(`[VendorUpdater] Timeout listing files for ${packageName}@${version}`);
      resolve([]);
    }, timeoutMs) : null;

    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        https.get(res.headers.location, (res2) => {
          let data = "";
          res2.on("data", (chunk) => { data += chunk; });
          res2.on("end", () => {
            if (timer) clearTimeout(timer);
            try {
              const parsed = JSON.parse(data);
              const files = flattenJsDelivrTree(parsed.files ?? []);
              console.log(`[VendorUpdater] Listed ${files.length} files for ${packageName}@${version}`);
              resolve(files);
            } catch {
              resolve([]);
            }
          });
        }).on("error", () => { if (timer) clearTimeout(timer); resolve([]); });
        return;
      }

      if (res.statusCode !== 200) {
        if (timer) clearTimeout(timer);
        console.warn(`[VendorUpdater] jsDelivr returned ${res.statusCode} for ${packageName}@${version}`);
        resolve([]);
        return;
      }

      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (timer) clearTimeout(timer);
        try {
          const parsed = JSON.parse(data);
          const files = flattenJsDelivrTree(parsed.files ?? []);
          console.log(`[VendorUpdater] Listed ${files.length} files for ${packageName}@${version}`);
          resolve(files);
        } catch {
          resolve([]);
        }
      });
    }).on("error", () => {
      if (timer) clearTimeout(timer);
      resolve([]);
    });
  });
}

export function fetchFileFromCdn(packageName: string, version: string, filePath: string, timeoutMs: number = 0): Promise<string> {
  const encodedPkg = encodeURIComponent(packageName);
  const cleanPath = filePath.replace(/^\//, "");
  const url = `https://cdn.jsdelivr.net/npm/${encodedPkg}@${version}/${cleanPath}`;

  return new Promise((resolve, reject) => {
    // timeoutMs=0 means no timeout — let the download complete naturally
    const timer = timeoutMs > 0 ? setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs) : null;

    const makeRequest = (requestUrl: string, redirectCount = 0) => {
      if (redirectCount > 3) {
        if (timer) clearTimeout(timer);
        reject(new Error("Too many redirects"));
        return;
      }

      https.get(requestUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          makeRequest(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          if (timer) clearTimeout(timer);
          reject(new Error(`HTTP ${res.statusCode} from ${requestUrl}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          if (timer) clearTimeout(timer);
          resolve(data);
        });
      }).on("error", (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    };

    makeRequest(url);
  });
}

// ═══════════════════════════════════════════════════════════════
// Phase 3 – Manifest generation
// ═══════════════════════════════════════════════════════════════

/**
 * If no libman.json or package.json exists in the project, generate a libman.json
 * manifest targeting the newly upgraded versions.
 */
export function generateManifestIfMissing(
  vendors: VendorLibrary[],
  selections: VersionSelection[],
  extractedFiles: ExtractedFile[],
): { path: string; content: string } | null {
  const hasManifest = extractedFiles.some(f => {
    const base = f.relativePath.split(/[/\\]/).pop()?.toLowerCase() ?? "";
    return base === "libman.json" || base === "package.json" || base === "bower.json";
  });
  if (hasManifest) return null;
  if (vendors.length === 0) return null;

  const selMap = new Map<string, string>();
  for (const s of selections) {
    selMap.set(s.package.toLowerCase(), s.selectedVersion);
  }

  const libraries: Array<{ library: string; destination: string; provider: string; files: string[] }> = [];

  for (const v of vendors) {
    const targetVersion = selMap.get(v.name.toLowerCase()) ?? v.detectedVersion;
    if (!targetVersion) continue;

    const dest = v.vendorBasePath.replace(/\\/g, "/");

    const distFiles = v.existingFiles
      .map(f => {
        const norm = f.replace(/\\/g, "/");
        const idx = norm.indexOf(dest);
        if (idx >= 0) return norm.slice(idx + dest.length).replace(/^\//, "");
        return norm.split("/").pop() || "";
      })
      .filter(Boolean);

    libraries.push({
      library: `${v.name}@${targetVersion}`,
      destination: dest,
      provider: "cdnjs",
      files: distFiles.length > 0 ? distFiles : ["dist/**"],
    });
  }

  if (libraries.length === 0) return null;

  const manifest = {
    version: "1.0",
    defaultProvider: "cdnjs",
    libraries,
  };

  return {
    path: "libman.json",
    content: JSON.stringify(manifest, null, 2),
  };
}

// ═══════════════════════════════════════════════════════════════
// Phase 3b – Always-generate/update manifest (replaces generateManifestIfMissing for output)
// ═══════════════════════════════════════════════════════════════

/**
 * Always generate or update a client-side library manifest for the output ZIP.
 * For .NET projects: produces/updates libman.json
 * For Node projects: produces/updates package.json with vendor deps
 * Falls back to libman.json for unknown stacks.
 *
 * Unlike generateManifestIfMissing(), this always produces a manifest even if
 * one already exists — it merges the upgraded versions in.
 */
export function generateOrUpdateManifest(
  vendors: VendorLibrary[],
  selections: VersionSelection[],
  extractedFiles: ExtractedFile[],
  bundleDetections?: BundleLibraryDetection[],
  detectedStack?: string,
): { path: string; content: string } | null {
  if (vendors.length === 0 && (!bundleDetections || bundleDetections.length === 0)) return null;

  const selMap = new Map<string, string>();
  for (const s of selections) {
    selMap.set(s.package.toLowerCase(), s.selectedVersion);
  }

  const existingLibman = extractedFiles.find(f =>
    f.relativePath.replace(/\\/g, "/").toLowerCase().endsWith("libman.json")
  );
  const existingPackageJson = extractedFiles.find(f => {
    const norm = f.relativePath.replace(/\\/g, "/").toLowerCase();
    return norm.endsWith("package.json") && !norm.includes("node_modules");
  });

  const stackLower = (detectedStack || "").toLowerCase();
  const isNodeProject = stackLower.includes("node") || stackLower.includes("react") ||
    stackLower.includes("angular") || stackLower.includes("vue") || stackLower.includes("next");

  if (isNodeProject && existingPackageJson) {
    return updatePackageJsonManifest(existingPackageJson, vendors, selMap);
  }

  return generateLibmanManifest(existingLibman, vendors, selMap, bundleDetections);
}

function generateLibmanManifest(
  existingLibman: ExtractedFile | undefined,
  vendors: VendorLibrary[],
  selMap: Map<string, string>,
  bundleDetections?: BundleLibraryDetection[],
): { path: string; content: string } | null {
  let parsed: any = { version: "1.0", defaultProvider: "cdnjs", libraries: [] };
  let manifestPath = "libman.json";

  if (existingLibman) {
    try {
      parsed = JSON.parse(existingLibman.content);
      parsed.libraries = parsed.libraries ?? [];
      manifestPath = existingLibman.relativePath.replace(/\\/g, "/");
    } catch { /* start fresh if parse fails */ }
  }

  const existingLibs = new Map<string, any>();
  for (const lib of parsed.libraries) {
    const raw: string = lib.library || "";
    const atIdx = raw.lastIndexOf("@");
    const pkgName = atIdx > 0 ? raw.slice(0, atIdx).toLowerCase() : raw.toLowerCase();
    existingLibs.set(pkgName, lib);
    existingLibs.set(resolveNpmName(pkgName), lib);
  }

  for (const v of vendors) {
    const key = v.name.toLowerCase();
    const targetVersion = selMap.get(key) ?? v.detectedVersion;
    if (!targetVersion) continue;

    const existingEntry = existingLibs.get(key);
    if (existingEntry) {
      existingEntry.library = `${v.name}@${targetVersion}`;
    } else {
      const dest = v.vendorBasePath
        ? v.vendorBasePath.replace(/\\/g, "/")
        : `wwwroot/lib/${v.name.replace("@", "").replace(/\//g, "-")}`;

      parsed.libraries.push({
        library: `${v.name}@${targetVersion}`,
        destination: dest,
        provider: "cdnjs",
      });
    }
  }

  // Add individual entries for libraries found inside concatenated bundles
  if (bundleDetections) {
    for (const bundle of bundleDetections) {
      if (!bundle.isConcatenated) continue;
      for (const lib of bundle.libraries) {
        const key = lib.npmPackage.toLowerCase();
        if (existingLibs.has(key)) continue;
        if (parsed.libraries.some((l: any) => {
          const raw: string = l.library || "";
          const atIdx = raw.lastIndexOf("@");
          return (atIdx > 0 ? raw.slice(0, atIdx) : raw).toLowerCase() === key;
        })) continue;

        const targetVersion = selMap.get(key) ?? lib.version;
        const basePath = bundle.filePath.substring(0, bundle.filePath.lastIndexOf("/"));
        parsed.libraries.push({
          library: `${lib.npmPackage}@${targetVersion}`,
          destination: basePath || `wwwroot/lib/${lib.npmPackage}`,
          provider: "cdnjs",
        });
      }
    }
  }

  if (parsed.libraries.length === 0) return null;

  return {
    path: manifestPath,
    content: JSON.stringify(parsed, null, 2),
  };
}

function updatePackageJsonManifest(
  existingPkg: ExtractedFile,
  vendors: VendorLibrary[],
  selMap: Map<string, string>,
): { path: string; content: string } | null {
  try {
    const parsed = JSON.parse(existingPkg.content);
    parsed.dependencies = parsed.dependencies ?? {};
    let modified = false;

    for (const v of vendors) {
      const key = v.name.toLowerCase();
      const targetVersion = selMap.get(key) ?? v.detectedVersion;
      if (!targetVersion) continue;

      const depKey = Object.keys(parsed.dependencies).find(k => k.toLowerCase() === key) ||
                     Object.keys(parsed.devDependencies ?? {}).find(k => k.toLowerCase() === key);

      if (depKey) {
        const section = parsed.dependencies[depKey] !== undefined ? "dependencies" : "devDependencies";
        const current = String(parsed[section][depKey]);
        const prefix = current.match(/^([\^~>=<]*)/)?.[1] || "^";
        parsed[section][depKey] = `${prefix}${targetVersion}`;
        modified = true;
      } else {
        parsed.dependencies[v.name] = `^${targetVersion}`;
        modified = true;
      }
    }

    if (!modified) return null;
    return {
      path: existingPkg.relativePath.replace(/\\/g, "/"),
      content: JSON.stringify(parsed, null, 2),
    };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Report generation
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a markdown summary of vendor library replacements
 * for inclusion in upgrade reports.
 */
/**
 * @deprecated Prefer generating individual library entries in libman.json via
 * generateOrUpdateManifest() instead of rebuilding concatenated bundles.
 * This function is kept for backward compatibility but should not be called
 * from the main upgrade flow. Use the libman split approach instead.
 *
 * Rebuild concatenated bundle files (GAP 7).
 * When a project has files like `base-library.js` = jQuery + Bootstrap concatenated,
 * this downloads each new version and re-concatenates them.
 */
export async function rebuildConcatenatedBundle(
  bundleDetection: BundleLibraryDetection,
  selections: Array<{ package: string; currentVersion: string; selectedVersion: string }>,
  originalContent: string,
  opts: DownloadOptions = {},
): Promise<DownloadedVendorFile | null> {
  const perFileTimeout = opts.perFileTimeoutMs ?? 15_000;

  // Build a selection lookup
  const selMap = new Map<string, string>();
  for (const s of selections) {
    selMap.set(s.package.toLowerCase(), s.selectedVersion);
    // Also add normalized names
    const normalized = resolveNpmName(s.package.toLowerCase().replace(/\s+/g, "-"));
    selMap.set(normalized.toLowerCase(), s.selectedVersion);
  }

  // Sort libraries by their offset in the original bundle (preserve concatenation order)
  const sortedLibs = [...bundleDetection.libraries].sort((a, b) => a.offset - b.offset);

  const parts: string[] = [];
  let anyChanged = false;
  const changedLibs: Array<{ name: string; oldVersion: string; newVersion: string }> = [];

  for (const lib of sortedLibs) {
    const targetVersion = selMap.get(lib.npmPackage.toLowerCase());

    if (!targetVersion || targetVersion === lib.version) {
      // No upgrade for this library — try to extract its portion from the original
      // This is an approximation; for safety, we include a comment marker
      parts.push(`/* ${lib.name} v${lib.version} (unchanged) */\n`);
      continue;
    }

    // Determine the main dist file for this library
    const mainFile = getMainDistFile(lib.npmPackage, bundleDetection.filePath);
    if (!mainFile) {
      parts.push(`/* ${lib.name} v${lib.version} (no dist file known — manual update needed) */\n`);
      continue;
    }

    try {
      const content = await fetchFileFromCdn(lib.npmPackage, targetVersion, mainFile, perFileTimeout);
      parts.push(content);
      anyChanged = true;
      changedLibs.push({ name: lib.npmPackage, oldVersion: lib.version, newVersion: targetVersion });
    } catch (err) {
      console.warn(`[VendorUpdater] Failed to download ${lib.npmPackage}@${targetVersion}/${mainFile} for bundle rebuild:`, err instanceof Error ? err.message : err);
      parts.push(`/* ${lib.name} v${lib.version} (download failed — manual update needed) */\n`);
    }
  }

  if (!anyChanged) return null;

  return {
    projectPath: bundleDetection.filePath,
    content: parts.join("\n\n"),
    originalContent,
    library: changedLibs.map(l => l.name).join(" + "),
    oldVersion: sortedLibs.map(l => `${l.npmPackage}@${l.version}`).join(", "),
    newVersion: changedLibs.map(l => `${l.name}@${l.newVersion}`).join(", "),
  };
}

/** Get the main dist file path for a known npm package */
function getMainDistFile(npmPackage: string, bundleFilePath: string): string | null {
  const isJs = bundleFilePath.endsWith(".js");
  const isCss = bundleFilePath.endsWith(".css");

  const JS_MAIN_FILES: Record<string, string> = {
    "jquery": "dist/jquery.min.js",
    "bootstrap": "dist/js/bootstrap.bundle.min.js",
    "@popperjs/core": "dist/umd/popper.min.js",
    "select2": "dist/js/select2.min.js",
    "moment": "min/moment.min.js",
    "lodash": "lodash.min.js",
    "handlebars": "dist/handlebars.min.js",
    "knockout": "build/output/knockout-latest.js",
    "backbone": "backbone-min.js",
    "underscore": "underscore-min.js",
    "toastr": "build/toastr.min.js",
    "bootbox": "dist/bootbox.min.js",
    "jquery-ui-dist": "jquery-ui.min.js",
    "jquery-validation": "dist/jquery.validate.min.js",
    "jquery.are-you-sure": "jquery.are-you-sure.js",
    "sammy": "lib/min/sammy-latest.min.js",
    "bootstrap-datepicker": "dist/js/bootstrap-datepicker.min.js",
    "@microsoft/signalr": "dist/browser/signalr.min.js",
    "@fortawesome/fontawesome-free": "js/all.min.js",
  };

  const CSS_MAIN_FILES: Record<string, string> = {
    "bootstrap": "dist/css/bootstrap.min.css",
    "@fortawesome/fontawesome-free": "css/all.min.css",
    "select2": "dist/css/select2.min.css",
    "toastr": "build/toastr.min.css",
    "bootstrap-datepicker": "dist/css/bootstrap-datepicker.min.css",
    "animate.css": "animate.min.css",
    "jquery-ui-dist": "jquery-ui.min.css",
  };

  if (isJs && JS_MAIN_FILES[npmPackage]) return JS_MAIN_FILES[npmPackage];
  if (isCss && CSS_MAIN_FILES[npmPackage]) return CSS_MAIN_FILES[npmPackage];
  return null;
}

export function generateVendorUpdateReport(
  downloaded: DownloadedVendorFile[],
  vendors: VendorLibrary[],
): string {
  if (downloaded.length === 0) return "";

  const byLib = new Map<string, DownloadedVendorFile[]>();
  for (const d of downloaded) {
    if (!byLib.has(d.library)) byLib.set(d.library, []);
    byLib.get(d.library)!.push(d);
  }

  const lines: string[] = [
    "## Vendor Library File Replacements",
    "",
    "The following client-side library files were downloaded from jsDelivr and replaced in the project:",
    "",
  ];

  for (const [lib, files] of byLib) {
    const first = files[0];
    lines.push(`### ${lib}`);
    lines.push(`- **Version change**: ${first.oldVersion ?? "unknown"} → ${first.newVersion}`);
    lines.push(`- **Files replaced**: ${files.length}`);
    for (const f of files) {
      lines.push(`  - \`${f.projectPath}\``);
    }
    lines.push("");
  }

  const vendorsWithoutDownloads = vendors.filter(
    v => !byLib.has(v.name) && v.existingFiles.length > 0
  );
  if (vendorsWithoutDownloads.length > 0) {
    lines.push("### Libraries detected but not replaced");
    lines.push("");
    for (const v of vendorsWithoutDownloads) {
      lines.push(`- **${v.name}** (${v.detectedVersion ?? "unknown version"}) — no matching user selection or download failed`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("> **Note**: These are source-level file replacements. You may still need to run your build pipeline (`npm install`, `dotnet restore`, etc.) to ensure all transitive dependencies are resolved.");
  lines.push("");

  return lines.join("\n");
}
