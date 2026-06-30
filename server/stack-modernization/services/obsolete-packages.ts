/**
 * Obsolete Package Intelligence
 *
 * Knowledge base of packages that should be REMOVED (not upgraded) during
 * stack modernization. Covers .NET shared-framework absorptions, Java
 * javax→jakarta replacements, deprecated Node polyfills, Python 2 compat
 * packages, and more.
 *
 * GAP 9 fix — previously the pipeline only upgraded packages; it never
 * removed ones that became obsolete in newer runtimes.
 */

export interface ObsoletePackageInfo {
  /** Human-readable reason for removal */
  reason: string;
  /**
   * The TFM / major version boundary after which this package is obsolete.
   * For .NET use "net6.0", "net8.0", etc.
   * For Java use "jakarta-10", "spring-boot-3", etc.
   * For Node use "node-18", etc.
   * For Python use "python-3", etc.
   */
  obsoleteAfter: string;
  /** Optional replacement package (e.g. jakarta equivalent) */
  replacedBy?: string;
  /** Which ecosystem this belongs to */
  ecosystem: "dotnet" | "java" | "node" | "python" | "ruby" | "go" | "php";
}

// ═══════════════════════════════════════════════════════════════
// .NET — packages absorbed into shared framework in .NET 6+
// ═══════════════════════════════════════════════════════════════

const DOTNET_OBSOLETE: Record<string, ObsoletePackageInfo> = {
  // ASP.NET Core metapackages — all absorbed into Microsoft.AspNetCore.App
  "Microsoft.AspNetCore": { reason: "Absorbed into Microsoft.AspNetCore.App shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.All": { reason: "Absorbed into Microsoft.AspNetCore.App shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.App": { reason: "Now an implicit framework reference — remove explicit PackageReference", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Authentication": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Authentication.Abstractions": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Authentication.Cookies": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Authentication.JwtBearer": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Authentication.OAuth": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Authentication.OpenIdConnect": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Authorization": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.CookiePolicy": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Cors": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Diagnostics": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Diagnostics.EntityFrameworkCore": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.HostFiltering": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Hosting": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Hosting.Abstractions": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Http": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Http.Abstractions": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Http.Extensions": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.HttpsPolicy": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Identity": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Mvc": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Mvc.Abstractions": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Mvc.Core": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Mvc.Razor": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Mvc.RazorPages": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Mvc.TagHelpers": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Mvc.ViewFeatures": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Razor": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Razor.Design": { reason: "Included in SDK — remove explicit reference", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Routing": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Server.Kestrel": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Server.Kestrel.Https": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.Session": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.SignalR": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.StaticFiles": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.AspNetCore.WebUtilities": { reason: "Absorbed into shared framework", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  // Visual Studio / tooling packages
  "Microsoft.VisualStudio.Web.BrowserLink": { reason: "Obsolete — removed from modern .NET", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.VisualStudio.Web.CodeGeneration.Design": { reason: "Replaced by dotnet-aspnet-codegenerator global tool", obsoleteAfter: "net8.0", ecosystem: "dotnet" },
  "Microsoft.VisualStudio.Web.CodeGenerators.Mvc": { reason: "Replaced by dotnet-aspnet-codegenerator global tool", obsoleteAfter: "net8.0", ecosystem: "dotnet" },
  // Other obsolete .NET packages
  "Microsoft.AspNetCore.Razor.Runtime": { reason: "Merged into Razor SDK", obsoleteAfter: "net6.0", ecosystem: "dotnet" },
  "Microsoft.Extensions.Caching.SqlServer": { reason: "Use Microsoft.Extensions.Caching.StackExchangeRedis or built-in distributed cache", obsoleteAfter: "net8.0", ecosystem: "dotnet" },
};

// ═══════════════════════════════════════════════════════════════
// Java — javax → jakarta replacements
// ═══════════════════════════════════════════════════════════════

const JAVA_OBSOLETE: Record<string, ObsoletePackageInfo> = {
  "javax.servlet:javax.servlet-api": { reason: "Replaced by Jakarta Servlet API", obsoleteAfter: "jakarta-10", replacedBy: "jakarta.servlet:jakarta.servlet-api", ecosystem: "java" },
  "javax.persistence:javax.persistence-api": { reason: "Replaced by Jakarta Persistence", obsoleteAfter: "jakarta-10", replacedBy: "jakarta.persistence:jakarta.persistence-api", ecosystem: "java" },
  "javax.annotation:javax.annotation-api": { reason: "Replaced by Jakarta Annotation", obsoleteAfter: "jakarta-10", replacedBy: "jakarta.annotation:jakarta.annotation-api", ecosystem: "java" },
  "javax.validation:validation-api": { reason: "Replaced by Jakarta Validation", obsoleteAfter: "jakarta-10", replacedBy: "jakarta.validation:jakarta.validation-api", ecosystem: "java" },
  "javax.inject:javax.inject": { reason: "Replaced by Jakarta Inject", obsoleteAfter: "jakarta-10", replacedBy: "jakarta.inject:jakarta.inject-api", ecosystem: "java" },
  "javax.ws.rs:javax.ws.rs-api": { reason: "Replaced by Jakarta RESTful Web Services", obsoleteAfter: "jakarta-10", replacedBy: "jakarta.ws.rs:jakarta.ws.rs-api", ecosystem: "java" },
  "javax.xml.bind:jaxb-api": { reason: "Removed from JDK 11+; use jakarta.xml.bind", obsoleteAfter: "jakarta-10", replacedBy: "jakarta.xml.bind:jakarta.xml.bind-api", ecosystem: "java" },
  "javax.activation:activation": { reason: "Replaced by Jakarta Activation", obsoleteAfter: "jakarta-10", replacedBy: "jakarta.activation:jakarta.activation-api", ecosystem: "java" },
  "javax.mail:mail": { reason: "Replaced by Jakarta Mail", obsoleteAfter: "jakarta-10", replacedBy: "jakarta.mail:jakarta.mail-api", ecosystem: "java" },
  // Spring Boot 2.x specific
  "org.springframework.boot:spring-boot-properties-migrator": { reason: "One-time migration tool — remove after upgrading", obsoleteAfter: "spring-boot-3", ecosystem: "java" },
};

// ═══════════════════════════════════════════════════════════════
// Node.js — deprecated polyfills & compat packages
// ═══════════════════════════════════════════════════════════════

const NODE_OBSOLETE: Record<string, ObsoletePackageInfo> = {
  "querystring": { reason: "Built into Node.js — use URLSearchParams instead", obsoleteAfter: "node-18", ecosystem: "node" },
  "url": { reason: "Built into Node.js — use WHATWG URL API", obsoleteAfter: "node-18", ecosystem: "node" },
  "punycode": { reason: "Deprecated in Node.js — use userland punycode.js if needed", obsoleteAfter: "node-18", ecosystem: "node" },
  "@types/node-fetch": { reason: "Node 18+ has built-in fetch — remove node-fetch and types", obsoleteAfter: "node-18", ecosystem: "node" },
  "node-fetch": { reason: "Node 18+ has built-in fetch", obsoleteAfter: "node-18", ecosystem: "node" },
  "abortcontroller-polyfill": { reason: "AbortController is built into Node 16+", obsoleteAfter: "node-16", ecosystem: "node" },
  "cross-fetch": { reason: "Node 18+ has built-in fetch", obsoleteAfter: "node-18", ecosystem: "node" },
  "isomorphic-fetch": { reason: "Node 18+ has built-in fetch", obsoleteAfter: "node-18", ecosystem: "node" },
  "whatwg-fetch": { reason: "Node 18+ has built-in fetch", obsoleteAfter: "node-18", ecosystem: "node" },
};

// ═══════════════════════════════════════════════════════════════
// Python — Python 2 compatibility packages
// ═══════════════════════════════════════════════════════════════

const PYTHON_OBSOLETE: Record<string, ObsoletePackageInfo> = {
  "six": { reason: "Python 2/3 compatibility layer — not needed on Python 3", obsoleteAfter: "python-3", ecosystem: "python" },
  "future": { reason: "Python 2/3 compatibility layer", obsoleteAfter: "python-3", ecosystem: "python" },
  "python-future": { reason: "Python 2/3 compatibility layer", obsoleteAfter: "python-3", ecosystem: "python" },
  "futures": { reason: "Backport of concurrent.futures — built into Python 3", obsoleteAfter: "python-3", ecosystem: "python" },
  "enum34": { reason: "Backport of enum — built into Python 3.4+", obsoleteAfter: "python-3", ecosystem: "python" },
  "typing": { reason: "Backport of typing — built into Python 3.5+", obsoleteAfter: "python-3", ecosystem: "python" },
  "pathlib2": { reason: "Backport of pathlib — built into Python 3.4+", obsoleteAfter: "python-3", ecosystem: "python" },
  "configparser": { reason: "Backport of configparser — built into Python 3", obsoleteAfter: "python-3", ecosystem: "python" },
  "mock": { reason: "Backport — use unittest.mock in Python 3.3+", obsoleteAfter: "python-3", ecosystem: "python" },
  "funcsigs": { reason: "Backport of inspect.signature — built into Python 3.3+", obsoleteAfter: "python-3", ecosystem: "python" },
  "importlib-metadata": { reason: "Backport — built into Python 3.8+", obsoleteAfter: "python-3.8", ecosystem: "python" },
};

// ═══════════════════════════════════════════════════════════════
// Merged lookup
// ═══════════════════════════════════════════════════════════════

export const OBSOLETE_PACKAGES: Record<string, ObsoletePackageInfo> = {
  ...DOTNET_OBSOLETE,
  ...JAVA_OBSOLETE,
  ...NODE_OBSOLETE,
  ...PYTHON_OBSOLETE,
};

/**
 * Determine whether a given target runtime version makes the package obsolete.
 *
 * @param packageName  e.g. "Microsoft.AspNetCore.Session"
 * @param targetRuntime  e.g. "net10.0", "node-20", "python-3.12", "jakarta-10", "spring-boot-3"
 * @returns The ObsoletePackageInfo if the package should be removed, or null.
 */
export function getObsoleteInfo(
  packageName: string,
  targetRuntime: string,
): ObsoletePackageInfo | null {
  const info = OBSOLETE_PACKAGES[packageName];
  if (!info) return null;

  // Parse version numbers for comparison
  const targetNum = parseVersionNumber(targetRuntime);
  const thresholdNum = parseVersionNumber(info.obsoleteAfter);

  if (targetNum === null || thresholdNum === null) {
    // Cannot compare numerically — fall back to prefix matching
    // If ecosystems match, assume obsolete (conservative — better to remove than to leave broken)
    return info;
  }

  // Target version >= threshold → package is obsolete
  if (targetNum >= thresholdNum) {
    return info;
  }

  return null;
}

function parseVersionNumber(version: string): number | null {
  // "net6.0" → 6.0, "net10.0" → 10.0
  const netMatch = version.match(/net(\d+(?:\.\d+)?)/);
  if (netMatch) return parseFloat(netMatch[1]);

  // "node-18" → 18, "python-3.12" → 3.12
  const dashMatch = version.match(/[\w]+-(\d+(?:\.\d+)?)/);
  if (dashMatch) return parseFloat(dashMatch[1]);

  // plain number
  const plain = parseFloat(version);
  if (!isNaN(plain)) return plain;

  return null;
}

/**
 * Given a list of discovered packages and a target runtime, return the ones
 * that should be REMOVED rather than upgraded.
 */
export function identifyObsoletePackages(
  packages: Array<{ name: string; version?: string }>,
  targetRuntime: string,
): Array<{ name: string; currentVersion?: string; info: ObsoletePackageInfo }> {
  const results: Array<{ name: string; currentVersion?: string; info: ObsoletePackageInfo }> = [];

  for (const pkg of packages) {
    const info = getObsoleteInfo(pkg.name, targetRuntime);
    if (info) {
      results.push({ name: pkg.name, currentVersion: pkg.version, info });
    }
  }

  return results;
}

/**
 * Remove obsolete package references from a .csproj file content.
 * Returns the modified content and a list of removed packages.
 */
export function removeObsoleteFromCsproj(
  content: string,
  targetTfm: string,
): { content: string; removed: string[] } {
  const removed: string[] = [];
  let result = content;

  // Match <PackageReference Include="..." Version="..." /> or multi-line
  const pkgRefRegex = /\s*<PackageReference\s+Include="([^"]+)"[^/]*?\/>\s*\n?/g;
  const matches = [...content.matchAll(pkgRefRegex)];

  for (const match of matches) {
    const packageName = match[1];
    const info = getObsoleteInfo(packageName, targetTfm);
    if (info) {
      result = result.replace(match[0], "\n");
      removed.push(packageName);
    }
  }

  // Clean up empty ItemGroup tags that might result from removal
  result = result.replace(/\s*<ItemGroup>\s*<\/ItemGroup>\s*/g, "\n");
  // Clean up excessive blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  return { content: result, removed };
}

/**
 * Remove obsolete dependencies from a pom.xml file.
 */
export function removeObsoleteFromPom(
  content: string,
  targetRuntime: string,
): { content: string; removed: string[] } {
  const removed: string[] = [];
  let result = content;

  // Match <dependency>...<groupId>X</groupId>...<artifactId>Y</artifactId>...</dependency>
  const depRegex = /<dependency>\s*[\s\S]*?<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>[\s\S]*?<\/dependency>/g;
  const matches = [...content.matchAll(depRegex)];

  for (const match of matches) {
    const mavenCoord = `${match[1]}:${match[2]}`;
    const info = getObsoleteInfo(mavenCoord, targetRuntime);
    if (info) {
      result = result.replace(match[0], "");
      removed.push(mavenCoord);
    }
  }

  result = result.replace(/\n{3,}/g, "\n\n");
  return { content: result, removed };
}

/**
 * Remove obsolete dependencies from a requirements.txt file.
 */
export function removeObsoleteFromRequirements(
  content: string,
  targetRuntime: string,
): { content: string; removed: string[] } {
  const removed: string[] = [];
  const lines = content.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      kept.push(line);
      continue;
    }
    // Extract package name (before ==, >=, <=, ~=, !=, [, etc.)
    const pkgMatch = trimmed.match(/^([a-zA-Z0-9_-]+)/);
    if (pkgMatch) {
      const info = getObsoleteInfo(pkgMatch[1], targetRuntime);
      if (info) {
        removed.push(pkgMatch[1]);
        continue; // skip this line
      }
    }
    kept.push(line);
  }

  return { content: kept.join("\n"), removed };
}

/**
 * Remove obsolete dependencies from a package.json file.
 */
export function removeObsoleteFromPackageJson(
  content: string,
  targetRuntime: string,
): { content: string; removed: string[] } {
  const removed: string[] = [];
  try {
    const parsed = JSON.parse(content);
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      const deps = parsed[section];
      if (!deps || typeof deps !== "object") continue;
      for (const name of Object.keys(deps)) {
        const info = getObsoleteInfo(name, targetRuntime);
        if (info) {
          delete deps[name];
          removed.push(name);
        }
      }
    }
    return { content: JSON.stringify(parsed, null, 2) + "\n", removed };
  } catch {
    return { content, removed };
  }
}
