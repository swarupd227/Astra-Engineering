/**
 * Target Library Resolver
 *
 * GAP 2 fix — Compares user's target version manifest against discovered
 * packages to identify libraries that need to be ADDED (not just upgraded).
 *
 * GAP 6 fix — Generates HTML reference tags for new libraries and determines
 * the correct load order and insertion point in layout files.
 */

import type { VersionSelection, ExtractedFile, VendorLibrary, ModifiedFile } from "../types";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface NewLibraryToAdd {
  library: string;
  targetVersion: string;
  npmPackage: string;
  /** Where to place the downloaded files */
  suggestedPath: string;
  /** js, css, or both */
  fileTypes: ("js" | "css")[];
  /** Priority for load ordering (lower = earlier) */
  loadOrder: number;
  /** Known CDN URL template */
  cdnUrl?: string;
}

// ═══════════════════════════════════════════════════════════════
// Library metadata — for all commonly requested libraries
// ═══════════════════════════════════════════════════════════════

interface LibraryMeta {
  npmPackage: string;
  fileTypes: ("js" | "css")[];
  loadOrder: number;
  /** jsDelivr dist path for the main JS file */
  mainJs?: string;
  /** jsDelivr dist path for the main CSS file */
  mainCss?: string;
  /** Depends on these libraries being loaded first */
  dependsOn?: string[];
}

const LIBRARY_METADATA: Record<string, LibraryMeta> = {
  // Core libraries
  jquery: { npmPackage: "jquery", fileTypes: ["js"], loadOrder: 0, mainJs: "dist/jquery.min.js" },
  "jquery-slim": { npmPackage: "jquery", fileTypes: ["js"], loadOrder: 0, mainJs: "dist/jquery.slim.min.js" },

  // jQuery plugins
  "jquery-ui": { npmPackage: "jquery-ui-dist", fileTypes: ["js", "css"], loadOrder: 10, mainJs: "jquery-ui.min.js", mainCss: "jquery-ui.min.css", dependsOn: ["jquery"] },
  "jquery-ui-dist": { npmPackage: "jquery-ui-dist", fileTypes: ["js", "css"], loadOrder: 10, mainJs: "jquery-ui.min.js", mainCss: "jquery-ui.min.css", dependsOn: ["jquery"] },
  "jquery-validation": { npmPackage: "jquery-validation", fileTypes: ["js"], loadOrder: 15, mainJs: "dist/jquery.validate.min.js", dependsOn: ["jquery"] },
  "jquery-validate": { npmPackage: "jquery-validation", fileTypes: ["js"], loadOrder: 15, mainJs: "dist/jquery.validate.min.js", dependsOn: ["jquery"] },
  "jquery.are-you-sure": { npmPackage: "jquery.are-you-sure", fileTypes: ["js"], loadOrder: 16, mainJs: "jquery.are-you-sure.js", dependsOn: ["jquery"] },
  "jquery.areyousure": { npmPackage: "jquery.are-you-sure", fileTypes: ["js"], loadOrder: 16, mainJs: "jquery.are-you-sure.js", dependsOn: ["jquery"] },

  // Bootstrap & plugins
  bootstrap: { npmPackage: "bootstrap", fileTypes: ["js", "css"], loadOrder: 20, mainJs: "dist/js/bootstrap.bundle.min.js", mainCss: "dist/css/bootstrap.min.css", dependsOn: ["jquery"] },
  "bootstrap-datepicker": { npmPackage: "bootstrap-datepicker", fileTypes: ["js", "css"], loadOrder: 25, mainJs: "dist/js/bootstrap-datepicker.min.js", mainCss: "dist/css/bootstrap-datepicker.min.css", dependsOn: ["bootstrap", "jquery"] },
  bootbox: { npmPackage: "bootbox", fileTypes: ["js"], loadOrder: 26, mainJs: "dist/bootbox.min.js", dependsOn: ["bootstrap"] },

  // Templating
  handlebars: { npmPackage: "handlebars", fileTypes: ["js"], loadOrder: 30, mainJs: "dist/handlebars.min.js" },
  "handlebars.js": { npmPackage: "handlebars", fileTypes: ["js"], loadOrder: 30, mainJs: "dist/handlebars.min.js" },

  // Routing
  sammy: { npmPackage: "sammy", fileTypes: ["js"], loadOrder: 35, mainJs: "lib/min/sammy-latest.min.js", dependsOn: ["jquery"] },
  "sammy.js": { npmPackage: "sammy", fileTypes: ["js"], loadOrder: 35, mainJs: "lib/min/sammy-latest.min.js", dependsOn: ["jquery"] },

  // UI frameworks
  "kendo-ui": { npmPackage: "@progress/kendo-ui", fileTypes: ["js", "css"], loadOrder: 40, mainJs: "js/kendo.all.min.js", mainCss: "styles/kendo.common.min.css", dependsOn: ["jquery"] },
  "@progress/kendo-ui": { npmPackage: "@progress/kendo-ui", fileTypes: ["js", "css"], loadOrder: 40, mainJs: "js/kendo.all.min.js", mainCss: "styles/kendo.common.min.css", dependsOn: ["jquery"] },

  // APM
  "elastic-apm-rum": { npmPackage: "@elastic/apm-rum", fileTypes: ["js"], loadOrder: 50, mainJs: "dist/bundles/elastic-apm-rum.umd.min.js" },
  "@elastic/apm-rum": { npmPackage: "@elastic/apm-rum", fileTypes: ["js"], loadOrder: 50, mainJs: "dist/bundles/elastic-apm-rum.umd.min.js" },

  // Icons
  "font-awesome": { npmPackage: "@fortawesome/fontawesome-free", fileTypes: ["css"], loadOrder: 5, mainCss: "css/all.min.css" },
  "@fortawesome/fontawesome-free": { npmPackage: "@fortawesome/fontawesome-free", fileTypes: ["css"], loadOrder: 5, mainCss: "css/all.min.css" },

  // Other common libraries
  "popper.js": { npmPackage: "@popperjs/core", fileTypes: ["js"], loadOrder: 19, mainJs: "dist/umd/popper.min.js" },
  "@popperjs/core": { npmPackage: "@popperjs/core", fileTypes: ["js"], loadOrder: 19, mainJs: "dist/umd/popper.min.js" },
  select2: { npmPackage: "select2", fileTypes: ["js", "css"], loadOrder: 30, mainJs: "dist/js/select2.min.js", mainCss: "dist/css/select2.min.css", dependsOn: ["jquery"] },
  toastr: { npmPackage: "toastr", fileTypes: ["js", "css"], loadOrder: 30, mainJs: "build/toastr.min.js", mainCss: "build/toastr.min.css", dependsOn: ["jquery"] },
  moment: { npmPackage: "moment", fileTypes: ["js"], loadOrder: 5, mainJs: "min/moment.min.js" },
  lodash: { npmPackage: "lodash", fileTypes: ["js"], loadOrder: 5, mainJs: "lodash.min.js" },
  axios: { npmPackage: "axios", fileTypes: ["js"], loadOrder: 5, mainJs: "dist/axios.min.js" },
  "chart.js": { npmPackage: "chart.js", fileTypes: ["js"], loadOrder: 30, mainJs: "dist/chart.min.js" },
  "datatables.net": { npmPackage: "datatables.net", fileTypes: ["js", "css"], loadOrder: 30, mainJs: "js/dataTables.min.js", mainCss: "css/dataTables.dataTables.min.css", dependsOn: ["jquery"] },
  d3: { npmPackage: "d3", fileTypes: ["js"], loadOrder: 5, mainJs: "dist/d3.min.js" },
  "animate.css": { npmPackage: "animate.css", fileTypes: ["css"], loadOrder: 5, mainCss: "animate.min.css" },
  knockout: { npmPackage: "knockout", fileTypes: ["js"], loadOrder: 30, mainJs: "build/output/knockout-latest.js" },
  backbone: { npmPackage: "backbone", fileTypes: ["js"], loadOrder: 30, mainJs: "backbone-min.js", dependsOn: ["jquery"] },
  underscore: { npmPackage: "underscore", fileTypes: ["js"], loadOrder: 5, mainJs: "underscore-min.js" },
  sweetalert2: { npmPackage: "sweetalert2", fileTypes: ["js", "css"], loadOrder: 30, mainJs: "dist/sweetalert2.min.js", mainCss: "dist/sweetalert2.min.css" },
  signalr: { npmPackage: "@microsoft/signalr", fileTypes: ["js"], loadOrder: 30, mainJs: "dist/browser/signalr.min.js" },
};

// ═══════════════════════════════════════════════════════════════
// Name normalization
// ═══════════════════════════════════════════════════════════════

const NAME_ALIASES: Record<string, string> = {
  "twitter-bootstrap": "bootstrap",
  "jquery.validation": "jquery-validation",
  "jquery-validate-unobtrusive": "jquery-validation-unobtrusive",
  "jquery.ui": "jquery-ui",
  fontawesome: "font-awesome",
  "fontawesome-free": "font-awesome",
  "@fortawesome": "font-awesome",
  "bootstrapjs": "bootstrap",
  "bootboxjs": "bootbox",
  "handlebars.js": "handlebars",
  "sammy.js": "sammy",
  "@progress/kendo-ui": "kendo-ui",
  "elastic-apm-rum.umd": "elastic-apm-rum",
  "@elastic/apm-rum": "elastic-apm-rum",
  "are-you-sure": "jquery.are-you-sure",
  "jquery.areyousure": "jquery.are-you-sure",
};

function normalizeName(name: string): string {
  const lower = name.toLowerCase().trim();
  return NAME_ALIASES[lower] ?? lower;
}

// ═══════════════════════════════════════════════════════════════
// Core functions
// ═══════════════════════════════════════════════════════════════

/**
 * Compare user selections against discovered packages to find libraries
 * that need to be ADDED to the project (not just upgraded).
 */
export function identifyNewLibraries(
  userSelections: VersionSelection[],
  discoveredPackages: Array<{ name: string; version?: string | null }>,
  vendorLibraries: VendorLibrary[],
): NewLibraryToAdd[] {
  // Build a set of all known packages (normalized names)
  const known = new Set<string>();
  for (const pkg of discoveredPackages) {
    known.add(normalizeName(pkg.name));
  }
  for (const vendor of vendorLibraries) {
    known.add(normalizeName(vendor.name));
  }

  const newLibs: NewLibraryToAdd[] = [];

  for (const sel of userSelections) {
    const normalized = normalizeName(sel.package);

    // Check if this library already exists in the project
    if (known.has(normalized)) continue;

    // Also check with original name
    if (known.has(sel.package.toLowerCase())) continue;

    // This library is NOT in the project — it needs to be ADDED
    const meta = LIBRARY_METADATA[normalized] ?? LIBRARY_METADATA[sel.package.toLowerCase()];

    newLibs.push({
      library: sel.package,
      targetVersion: sel.selectedVersion,
      npmPackage: meta?.npmPackage ?? sel.package.toLowerCase(),
      suggestedPath: `wwwroot/lib/${normalized}/`,
      fileTypes: meta?.fileTypes ?? ["js"],
      loadOrder: meta?.loadOrder ?? 50,
      cdnUrl: meta?.mainJs
        ? `https://cdn.jsdelivr.net/npm/${meta.npmPackage}@${sel.selectedVersion}/${meta.mainJs}`
        : undefined,
    });
  }

  // Sort by load order
  newLibs.sort((a, b) => a.loadOrder - b.loadOrder);

  return newLibs;
}

/**
 * Find the project's layout/template file(s) from extracted files.
 */
export function findLayoutFiles(files: ExtractedFile[]): ExtractedFile[] {
  const layoutPatterns = [
    /_layout\.cshtml$/i,
    /_layout\.razor$/i,
    /layout\.html$/i,
    /base\.html$/i,
    /index\.html$/i,
    /app\.component\.html$/i,
    /main\.html$/i,
    /master\.html$/i,
    /default\.aspx$/i,
    /site\.master$/i,
    /base\.html\.twig$/i,
    /layout\.pug$/i,
    /application\.html\.erb$/i,
    /layout\.hbs$/i,
  ];

  const candidates = files.filter(f => {
    const path = f.relativePath.toLowerCase();
    return layoutPatterns.some(p => p.test(path));
  });

  // Prefer _Layout.cshtml > index.html > others
  candidates.sort((a, b) => {
    const aScore = a.relativePath.toLowerCase().includes("_layout") ? 0
      : a.relativePath.toLowerCase().includes("layout") ? 1
      : a.relativePath.toLowerCase().includes("index.html") ? 2
      : 3;
    const bScore = b.relativePath.toLowerCase().includes("_layout") ? 0
      : b.relativePath.toLowerCase().includes("layout") ? 1
      : b.relativePath.toLowerCase().includes("index.html") ? 2
      : 3;
    return aScore - bScore;
  });

  return candidates;
}

/**
 * Generate <script> and <link> tags for new libraries and insert them
 * into the layout file at the correct position.
 *
 * Returns the modified layout file content, or null if no changes needed.
 */
export function wireUpLibraryReferences(
  layoutContent: string,
  layoutPath: string,
  newLibraries: NewLibraryToAdd[],
  existingModifiedFiles: ModifiedFile[],
  projectType: string,
): { content: string; addedTags: string[] } | null {
  if (newLibraries.length === 0) return null;

  // Determine path prefix based on project type
  const pathPrefix = projectType === "dotnet" ? "~/" : "/";

  // Check which libraries already have references in the layout
  const contentLower = layoutContent.toLowerCase();
  const toAdd = newLibraries.filter(lib => {
    const normalized = normalizeName(lib.library);
    // Check if there's already a script/link tag referencing this library
    return !contentLower.includes(normalized) &&
           !contentLower.includes(lib.npmPackage.toLowerCase());
  });

  if (toAdd.length === 0) return null;

  const addedTags: string[] = [];
  let result = layoutContent;

  // Separate JS and CSS additions
  const cssLibs = toAdd.filter(l => l.fileTypes.includes("css"));
  const jsLibs = toAdd.filter(l => l.fileTypes.includes("js"));

  // Insert CSS links before </head> or after last existing <link>
  if (cssLibs.length > 0) {
    const cssLines = cssLibs.map(lib => {
      const meta = LIBRARY_METADATA[normalizeName(lib.library)];
      const cssFile = meta?.mainCss ?? `${normalizeName(lib.library)}.min.css`;
      const fullPath = `${pathPrefix}lib/${normalizeName(lib.library)}/${cssFile.split("/").pop()}`;
      const tag = `    <link href="${fullPath}" rel="stylesheet" />`;
      addedTags.push(tag.trim());
      return tag;
    });

    const cssBlock = "\n" + cssLines.join("\n");

    // Find insertion point — before </head> or after last <link>
    const headCloseIdx = result.indexOf("</head>");
    if (headCloseIdx !== -1) {
      result = result.slice(0, headCloseIdx) + cssBlock + "\n" + result.slice(headCloseIdx);
    }
  }

  // Insert JS scripts before </body> or before the app's own script tag
  if (jsLibs.length > 0) {
    const jsLines = jsLibs.map(lib => {
      const meta = LIBRARY_METADATA[normalizeName(lib.library)];
      const jsFile = meta?.mainJs ?? `${normalizeName(lib.library)}.min.js`;
      const fullPath = `${pathPrefix}lib/${normalizeName(lib.library)}/${jsFile.split("/").pop()}`;
      const tag = `    <script src="${fullPath}"></script>`;
      addedTags.push(tag.trim());
      return tag;
    });

    const jsBlock = "\n" + jsLines.join("\n");

    // Find insertion point — before the app's site.js/site.min.js or before </body>
    const siteJsMatch = result.match(/<script[^>]*src="[^"]*site(\.min)?\.js"[^>]*>/);
    if (siteJsMatch && siteJsMatch.index != null) {
      result = result.slice(0, siteJsMatch.index) + jsBlock + "\n" + result.slice(siteJsMatch.index);
    } else {
      const bodyCloseIdx = result.indexOf("</body>");
      if (bodyCloseIdx !== -1) {
        result = result.slice(0, bodyCloseIdx) + jsBlock + "\n" + result.slice(bodyCloseIdx);
      }
    }
  }

  return { content: result, addedTags };
}

/**
 * Build the task dependency ordering for library upgrades.
 * Returns a map of library → libraries it depends on.
 *
 * GAP 4 partial fix — provides dependency information for task ordering.
 */
export function getLibraryDependencies(libraryNames: string[]): Map<string, string[]> {
  const deps = new Map<string, string[]>();

  for (const name of libraryNames) {
    const normalized = normalizeName(name);
    const meta = LIBRARY_METADATA[normalized];
    if (meta?.dependsOn) {
      deps.set(normalized, meta.dependsOn);
    } else {
      deps.set(normalized, []);
    }
  }

  return deps;
}

/**
 * Topological sort of library names based on their dependencies.
 * Libraries with no dependencies come first.
 */
export function topologicalSortLibraries(libraryNames: string[]): string[] {
  const deps = getLibraryDependencies(libraryNames);
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) return; // cycle
    visiting.add(name);

    const libDeps = deps.get(normalizeName(name)) ?? [];
    for (const dep of libDeps) {
      if (libraryNames.some(l => normalizeName(l) === dep)) {
        visit(dep);
      }
    }

    visiting.delete(name);
    visited.add(name);
    sorted.push(name);
  }

  for (const name of libraryNames) {
    visit(normalizeName(name));
  }

  return sorted;
}
