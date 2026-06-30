/**
 * Stack Modernization - Version Registry Service
 * Fetches actual package versions from real registries (npm, PyPI, Maven Central, .NET)
 */

import https from 'https';
import http from 'http';
import {
  getAvailableDotNetVersions,
  getRecommendedUpgradeTarget,
  parseDotNetVersion,
} from "./dotnet-version-registry";

// Shared HTTPS agent that tolerates self-signed certs (corporate proxies)
const tlsTolerantAgent = new https.Agent({ rejectUnauthorized: false });

export interface PackageVersionInfo {
  package: string;
  currentVersion: string | null;
  latestVersion: string | null;
  latestLTS: string | null;
  allVersions: string[];
  registry: 'npm' | 'pypi' | 'maven' | 'dotnet-official' | 'nuget' | 'unknown';
  error?: string;
}

/**
 * Fetch package versions from npm registry
 */
export async function fetchNpmVersions(packageName: string): Promise<PackageVersionInfo> {
  return new Promise((resolve) => {
    const url = `https://registry.npmjs.org/${packageName}`;
    
    https.get(url, { agent: tlsTolerantAgent }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          
          // Get all versions
          const allVersions = Object.keys(parsed.versions || {}).sort((a, b) => {
            // Simple version sort (not perfect but good enough)
            return b.localeCompare(a, undefined, { numeric: true });
          });
          
          // Get latest version
          const latestVersion = parsed['dist-tags']?.latest || allVersions[0] || null;
          
          // Try to find LTS version (look for tags or versions without pre-release)
          let latestLTS = null;
          if (parsed['dist-tags']?.lts) {
            latestLTS = parsed['dist-tags'].lts;
          } else {
            // Find latest stable version (no alpha/beta/rc)
            latestLTS = allVersions.find(v => !/alpha|beta|rc|pre/i.test(v)) || null;
          }
          
          resolve({
            package: packageName,
            currentVersion: null, // Will be detected from code
            latestVersion,
            latestLTS,
            allVersions: allVersions.slice(0, 20), // Top 20 versions
            registry: 'npm'
          });
        } catch (error) {
          resolve({
            package: packageName,
            currentVersion: null,
            latestVersion: null,
            latestLTS: null,
            allVersions: [],
            registry: 'npm',
            error: 'Failed to parse npm registry response'
          });
        }
      });
    }).on('error', (error) => {
      resolve({
        package: packageName,
        currentVersion: null,
        latestVersion: null,
        latestLTS: null,
        allVersions: [],
        registry: 'npm',
        error: error.message
      });
    });
  });
}

/**
 * Fetch package versions from PyPI registry
 */
export async function fetchPyPIVersions(packageName: string): Promise<PackageVersionInfo> {
  return new Promise((resolve) => {
    const url = `https://pypi.org/pypi/${packageName}/json`;
    
    https.get(url, { agent: tlsTolerantAgent }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          
          // Get all versions
          const allVersions = Object.keys(parsed.releases || {}).sort((a, b) => {
            return b.localeCompare(a, undefined, { numeric: true });
          });
          
          // Get latest version
          const latestVersion = parsed.info?.version || allVersions[0] || null;
          
          // Find LTS/stable version (no pre-release)
          const latestLTS = allVersions.find(v => !/a|b|rc|dev|pre/i.test(v)) || null;
          
          resolve({
            package: packageName,
            currentVersion: null,
            latestVersion,
            latestLTS,
            allVersions: allVersions.slice(0, 20),
            registry: 'pypi'
          });
        } catch (error) {
          resolve({
            package: packageName,
            currentVersion: null,
            latestVersion: null,
            latestLTS: null,
            allVersions: [],
            registry: 'pypi',
            error: 'Failed to parse PyPI response'
          });
        }
      });
    }).on('error', (error) => {
      resolve({
        package: packageName,
        currentVersion: null,
        latestVersion: null,
        latestLTS: null,
        allVersions: [],
        registry: 'pypi',
        error: error.message
      });
    });
  });
}

/**
 * Fetch latest release from Maven Central via maven-metadata.xml (official, reliable).
 * Uses <release> or <latest> for stable version.
 */
async function fetchMavenVersionsViaMetadata(groupId: string, artifactId: string): Promise<PackageVersionInfo | null> {
  const groupPath = groupId.replace(/\./g, '/');
  const url = `https://repo1.maven.org/maven2/${groupPath}/${artifactId}/maven-metadata.xml`;
  return new Promise((resolve) => {
    https.get(url, { agent: tlsTolerantAgent }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const releaseMatch = data.match(/<release>\s*([^<]+)\s*<\/release>/);
          const latestMatch = data.match(/<latest>\s*([^<]+)\s*<\/latest>/);
          const versionsMatch = data.match(/<versions>([\s\S]*?)<\/versions>/);
          const stable = (releaseMatch?.[1] || latestMatch?.[1] || '').trim();
          let allVersions: string[] = [];
          if (versionsMatch) {
            allVersions = (versionsMatch[1].match(/<version>([^<]+)<\/version>/g) || [])
              .map((m: string) => m.replace(/<\/?version>/g, ''))
              .filter((v: string) => !/SNAPSHOT|-RC|-M\d|alpha|beta/i.test(v))
              .sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true }));
          }
          if (!stable && allVersions.length > 0) {
            const fallback = allVersions[0];
            resolve({
              package: `${groupId}:${artifactId}`,
              currentVersion: null,
              latestVersion: fallback,
              latestLTS: fallback,
              allVersions: allVersions.slice(0, 20),
              registry: 'maven'
            });
            return;
          }
          if (stable) {
            if (allVersions.length === 0) allVersions = [stable];
            resolve({
              package: `${groupId}:${artifactId}`,
              currentVersion: null,
              latestVersion: stable,
              latestLTS: stable,
              allVersions: allVersions.slice(0, 20),
              registry: 'maven'
            });
            return;
          }
          resolve(null);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

/**
 * Fetch package versions from Maven Central.
 * Prefers maven-metadata.xml (<release>) for stable latest; falls back to Search API.
 */
export async function fetchMavenVersions(groupId: string, artifactId: string): Promise<PackageVersionInfo> {
  const pkg = `${groupId}:${artifactId}`;

  const fromMetadata = await fetchMavenVersionsViaMetadata(groupId, artifactId);
  if (fromMetadata) {
    return fromMetadata;
  }

  return new Promise((resolve) => {
    const url = `https://search.maven.org/solrsearch/select?q=g:"${encodeURIComponent(groupId)}"+AND+a:"${encodeURIComponent(artifactId)}"&rows=20&core=gav&wt=json`;

    https.get(url, { agent: tlsTolerantAgent }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const docs = parsed.response?.docs || [];

          if (docs.length === 0) {
            console.warn(`[VersionRegistry] Maven Central returned 0 results for ${pkg}`);
            resolve({
              package: pkg,
              currentVersion: null,
              latestVersion: null,
              latestLTS: null,
              allVersions: [],
              registry: 'maven',
              error: `No versions found on Maven Central for ${pkg}`
            });
            return;
          }

          const allVersions = docs
            .map((doc: any) => doc.v)
            .filter(Boolean)
            .sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true }));

          const latestVersion = allVersions[0] || null;
          const latestLTS = allVersions.find((v: string) => !/alpha|beta|rc|SNAPSHOT|M\d/i.test(v)) || latestVersion;


          resolve({
            package: pkg,
            currentVersion: null,
            latestVersion,
            latestLTS,
            allVersions: allVersions.slice(0, 20),
            registry: 'maven'
          });
        } catch (error) {
          console.error(`[VersionRegistry] Maven parse error for ${pkg}:`, error);
          resolve({
            package: pkg,
            currentVersion: null,
            latestVersion: null,
            latestLTS: null,
            allVersions: [],
            registry: 'maven',
            error: 'Failed to parse Maven response'
          });
        }
      });
    }).on('error', (error) => {
      console.error(`[VersionRegistry] Maven network error for ${pkg}:`, error.message);
      resolve({
        package: pkg,
        currentVersion: null,
        latestVersion: null,
        latestLTS: null,
        allVersions: [],
        registry: 'maven',
        error: error.message
      });
    });
  });
}

/**
 * Fetch package versions from NuGet v3 API (for .NET NuGet packages)
 */
export async function fetchNuGetVersions(packageName: string): Promise<PackageVersionInfo> {
  return new Promise((resolve) => {
    const normalizedName = packageName.toLowerCase().trim();
    const url = `https://api.nuget.org/v3-flatcontainer/${normalizedName}/index.json`;

    https.get(url, { agent: tlsTolerantAgent }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const allVersions: string[] = (parsed.versions || [])
            .filter((v: string) => !/alpha|beta|rc|preview/i.test(v))
            .sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true }));

          const latestVersion = allVersions[0] || null;
          const latestLTS = allVersions.find((v: string) => !/alpha|beta|rc|pre/i.test(v)) || null;

          resolve({
            package: packageName,
            currentVersion: null,
            latestVersion,
            latestLTS,
            allVersions: allVersions.slice(0, 20),
            registry: 'nuget',
          });
        } catch {
          resolve({
            package: packageName,
            currentVersion: null,
            latestVersion: null,
            latestLTS: null,
            allVersions: [],
            registry: 'nuget',
            error: 'Failed to parse NuGet response',
          });
        }
      });
    }).on('error', (error) => {
      resolve({
        package: packageName,
        currentVersion: null,
        latestVersion: null,
        latestLTS: null,
        allVersions: [],
        registry: 'nuget',
        error: error.message,
      });
    });
  });
}

/**
 * Whether the package name is .NET runtime/framework (use dotnet registry, not npm)
 */
function isDotNetRuntimePackage(packageName: string): boolean {
  const n = packageName.toLowerCase().trim();
  return n === '.net' || n === '.net framework' || n === 'dotnet';
}

/**
 * Map human-readable .NET framework/library names back to actual NuGet package IDs.
 * The runtime detector produces friendly names (e.g. "ASP.NET Core") but NuGet needs
 * the real package ID (e.g. "Microsoft.AspNetCore.App").
 */
const DOTNET_DISPLAY_TO_NUGET: Record<string, string> = {
  'asp.net core': 'Microsoft.AspNetCore.App',
  'asp.net core mvc': 'Microsoft.AspNetCore.Mvc',
  'entity framework core': 'Microsoft.EntityFrameworkCore',
  'entity framework': 'EntityFramework',
  'asp.net mvc': 'Microsoft.AspNet.Mvc',
  'asp.net web api': 'Microsoft.AspNet.WebApi',
  'asp.net': 'Microsoft.AspNet.Mvc',
  'blazor': 'Microsoft.AspNetCore.Components',
  'signalr': 'Microsoft.AspNetCore.SignalR',
  'maui': 'Microsoft.Maui.Controls',
  'wpf': 'Microsoft.WindowsDesktop.App',
  'winforms': 'Microsoft.WindowsDesktop.App',
  'ef core': 'Microsoft.EntityFrameworkCore',
  'identity': 'Microsoft.AspNetCore.Identity.EntityFrameworkCore',
  'mediatr': 'MediatR',
  'automapper': 'AutoMapper',
  'serilog': 'Serilog',
  'nlog': 'NLog',
  'dapper': 'Dapper',
  'polly': 'Polly',
  'fluentvalidation': 'FluentValidation',
  'hangfire': 'Hangfire.Core',
  'swashbuckle': 'Swashbuckle.AspNetCore',
  'newtonsoft.json': 'Newtonsoft.Json',
  'json.net': 'Newtonsoft.Json',
  'jquery unobtrusive validation': 'Microsoft.jQuery.Unobtrusive.Validation',
  'elastic.apm.netcoreall': 'Elastic.Apm.NetCoreAll',
  'nlog.extensions.logging': 'NLog.Extensions.Logging',
  'nlog.web.aspnetcore': 'NLog.Web.AspNetCore',
  'microsoft.csharp': 'Microsoft.CSharp',
  'system.data.datasetextensions': 'System.Data.DataSetExtensions',
};

function resolveNuGetPackageName(name: string): string {
  const resolved = DOTNET_DISPLAY_TO_NUGET[name.toLowerCase().trim()];
  if (resolved) {
  }
  return resolved || name;
}

/**
 * Map human-readable display names of client-side/JS libraries to their npm package names.
 * The runtime detector produces friendly names but npm needs the actual package ID.
 */
const DISPLAY_TO_NPM: Record<string, string> = {
  'bootstrap': 'bootstrap',
  'bootstrap datepicker': 'bootstrap-datepicker',
  'jquery': 'jquery',
  'jquery validation': 'jquery-validation',
  'jquery validate': 'jquery-validation',
  'jquery.validation': 'jquery-validation',
  'jquery unobtrusive validation': 'jquery-validation-unobtrusive',
  'jquery ui': 'jquery-ui',
  'jquery.ui': 'jquery-ui',
  'vanillajs datepicker': 'vanillajs-datepicker',
  'typescript': 'typescript',
  'font awesome': '@fortawesome/fontawesome-free',
  'fontawesome': '@fortawesome/fontawesome-free',
  'select2': 'select2',
  'lodash': 'lodash',
  'moment': 'moment',
  'moment.js': 'moment',
  'axios': 'axios',
  'handlebars': 'handlebars',
  'handlebars.js': 'handlebars',
  'popper.js': '@popperjs/core',
  'popper': '@popperjs/core',
  'bootbox': 'bootbox',
  'bootboxjs': 'bootbox',
  'bootbox.js': 'bootbox',
  'kendo ui': '@progress/kendo-ui',
  'kendo': '@progress/kendo-ui',
  'sammy': 'sammy',
  'sammy.js': 'sammy',
  'sammy js': 'sammy',
  'sammyjs': 'sammy',
  'elastic-apm-rum': '@elastic/apm-rum',
  'elastic apm rum': '@elastic/apm-rum',
  'elastic-apm-rum.umd': '@elastic/apm-rum',
  'chart.js': 'chart.js',
  'chartjs': 'chart.js',
  'd3': 'd3',
  'd3.js': 'd3',
  'datatables': 'datatables.net',
  'datatables.net': 'datatables.net',
  'toastr': 'toastr',
  'sweetalert2': 'sweetalert2',
  'knockout': 'knockout',
  'knockout.js': 'knockout',
  'underscore': 'underscore',
  'underscore.js': 'underscore',
  'backbone': 'backbone',
  'backbone.js': 'backbone',
  'signalr': '@microsoft/signalr',
  'animate.css': 'animate.css',
  'are-you-sure': 'jquery.are-you-sure',
  'jquery.areyousure': 'jquery.are-you-sure',
  'jquery areyousure': 'jquery.are-you-sure',
  'twitter-bootstrap': 'bootstrap',
};

function resolveToNpmIfClientLib(name: string): string | null {
  const lower = name.toLowerCase().trim();
  if (DISPLAY_TO_NPM[lower]) return DISPLAY_TO_NPM[lower];
  const noSpaces = lower.replace(/\s+/g, '-');
  if (DISPLAY_TO_NPM[noSpaces]) return DISPLAY_TO_NPM[noSpaces];
  const noDots = lower.replace(/\./g, '');
  if (DISPLAY_TO_NPM[noDots]) return DISPLAY_TO_NPM[noDots];
  return null;
}

/**
 * Whether the package looks like an npm package rather than NuGet.
 * npm packages: all-lowercase, may have hyphens, no dots, or scoped (@scope/name).
 * NuGet packages: PascalCase with dots (Microsoft.Extensions.Logging).
 */
function isLikelyNpmPackage(packageName: string): boolean {
  const n = packageName.trim();
  // Scoped npm packages
  if (n.startsWith('@')) return true;
  // Has a dot → likely NuGet (e.g. Microsoft.EntityFrameworkCore)
  if (n.includes('.')) return false;
  // Has spaces → display name, not npm
  if (n.includes(' ')) return false;
  // Contains uppercase in the middle → likely NuGet PascalCase
  if (/[A-Z]/.test(n.slice(1))) return false;
  // All lowercase with optional hyphens → npm pattern
  return /^[a-z][a-z0-9-]*$/.test(n);
}

/**
 * Whether the package is a NuGet package (Microsoft.*, System.*, etc.)
 */
function isNuGetPackage(packageName: string): boolean {
  const n = packageName.toLowerCase().trim();
  return (
    n.startsWith('microsoft.') ||
    n.startsWith('system.') ||
    n.startsWith('aspnetcore') ||
    n.startsWith('newtonsoft.') ||
    n.startsWith('serilog') ||
    n.startsWith('automapper') ||
    n.startsWith('dapper') ||
    n.startsWith('entityframework') ||
    n.startsWith('npgsql') ||
    n.startsWith('swashbuckle') ||
    n.startsWith('xunit') ||
    n.startsWith('nunit') ||
    n.startsWith('moq') ||
    n.startsWith('fluentassertions') ||
    n.startsWith('polly') ||
    n.startsWith('mediatr') ||
    n.startsWith('hangfire') ||
    n.startsWith('azure.') ||
    n.startsWith('stackexchange.') ||
    n.startsWith('identitymodel') ||
    n.startsWith('bogus') ||
    n.startsWith('fluentvalidation') ||
    n.startsWith('restsharp') ||
    n.startsWith('nlog') ||
    n.startsWith('castle.') ||
    n.startsWith('coverlet.') ||
    n.startsWith('benchmarkdotnet') ||
    n.startsWith('humanizer') ||
    n.startsWith('mapster') ||
    n.startsWith('scrutor') ||
    n.startsWith('seq.') ||
    n.startsWith('shouldly') ||
    n.startsWith('ef') ||
    // Dotted PascalCase namespace pattern (e.g., "SomeCompany.Library") — NuGet convention
    // Only when no @scope (npm), no colon (Maven), no slash (npm scoped),
    // and has at least two segments where the first looks like a proper namespace
    (n.includes('.') && !n.startsWith('@') && !n.includes(':') && !n.includes('/')
      && /^[a-z][a-z0-9]*\.[a-z][a-z0-9.]*$/.test(n)
      && n.split('.').length >= 2 && n.split('.')[0].length >= 3)
  );
}

/**
 * Fetch .NET runtime/framework versions from official data (no LLM, no npm)
 */
export function fetchDotNetVersions(packageName: string, currentVersion?: string | null): PackageVersionInfo {
  const available = getAvailableDotNetVersions();
  const allVersions = available.map((v) => v.version);
  const currentParsed = currentVersion ? parseDotNetVersion(currentVersion) : null;
  const recommended = currentParsed ? getRecommendedUpgradeTarget(currentParsed) : (available[0] ?? null);
  const latestVersion = recommended?.version ?? (allVersions[0] ?? null);
  const latestLTS = available.filter((v) => v.isLTS && v.status === "active").sort((a, b) => parseFloat(b.version) - parseFloat(a.version))[0]?.version ?? latestVersion;

  return {
    package: packageName,
    currentVersion: currentVersion ?? null,
    latestVersion,
    latestLTS,
    allVersions,
    registry: "dotnet-official",
  };
}

/**
 * Well-known simplified Java package names → Maven coordinates.
 * Catches cases where the LLM or code analysis outputs a short name.
 */
const KNOWN_JAVA_PACKAGES: Record<string, string> = {
  "spring": "org.springframework:spring-core",
  "spring-core": "org.springframework:spring-core",
  "spring-boot": "org.springframework.boot:spring-boot",
  "spring-boot-starter": "org.springframework.boot:spring-boot-starter",
  "spring-boot-starter-web": "org.springframework.boot:spring-boot-starter-web",
  "spring-framework": "org.springframework:spring-core",
  "spring-web": "org.springframework:spring-web",
  "spring-webmvc": "org.springframework:spring-webmvc",
  "spring-data": "org.springframework.data:spring-data-commons",
  "spring-data-jpa": "org.springframework.data:spring-data-jpa",
  "spring-security": "org.springframework.security:spring-security-core",
  "spring-cloud": "org.springframework.cloud:spring-cloud-starter",
  "hibernate": "org.hibernate:hibernate-core",
  "hibernate-core": "org.hibernate:hibernate-core",
  "jackson": "com.fasterxml.jackson.core:jackson-databind",
  "jackson-databind": "com.fasterxml.jackson.core:jackson-databind",
  "lombok": "org.projectlombok:lombok",
  "slf4j": "org.slf4j:slf4j-api",
  "logback": "ch.qos.logback:logback-classic",
  "log4j": "org.apache.logging.log4j:log4j-core",
  "guava": "com.google.guava:guava",
  "gson": "com.google.code.gson:gson",
  "junit": "junit:junit",
  "junit-jupiter": "org.junit.jupiter:junit-jupiter",
  "mockito": "org.mockito:mockito-core",
  "assertj": "org.assertj:assertj-core",
  "commons-lang3": "org.apache.commons:commons-lang3",
  "commons-io": "commons-io:commons-io",
  "httpclient": "org.apache.httpcomponents:httpclient",
  "kafka": "org.apache.kafka:kafka-clients",
  "flyway": "org.flywaydb:flyway-core",
  "liquibase": "org.liquibase:liquibase-core",
  "thymeleaf": "org.thymeleaf:thymeleaf",
  "mapstruct": "org.mapstruct:mapstruct",
  "hikaricp": "com.zaxxer:HikariCP",
  "micrometer": "io.micrometer:micrometer-core",
  "swagger": "io.swagger.core.v3:swagger-core",
  "jakarta.ee": "jakarta.platform:jakarta.jakartaee-api",
  "javax.servlet": "javax.servlet:javax.servlet-api",
};

/**
 * Search Maven Central by artifactId when no groupId is available
 */
export async function searchMavenByArtifactId(artifactId: string): Promise<PackageVersionInfo> {
  return new Promise((resolve) => {
    const url = `https://search.maven.org/solrsearch/select?q=a:"${artifactId}"&rows=5&wt=json`;

    https.get(url, { agent: tlsTolerantAgent }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const docs = parsed.response?.docs || [];
          if (docs.length === 0) {
            resolve({
              package: artifactId,
              currentVersion: null,
              latestVersion: null,
              latestLTS: null,
              allVersions: [],
              registry: "maven",
              error: `No Maven artifact found for "${artifactId}"`,
            });
            return;
          }
          const best = docs[0];
          const groupId = best.g;
          const latestVersion = best.latestVersion || best.v || null;
          resolve({
            package: `${groupId}:${artifactId}`,
            currentVersion: null,
            latestVersion,
            latestLTS: latestVersion,
            allVersions: latestVersion ? [latestVersion] : [],
            registry: "maven",
          });
        } catch {
          resolve({
            package: artifactId,
            currentVersion: null,
            latestVersion: null,
            latestLTS: null,
            allVersions: [],
            registry: "maven",
            error: "Failed to parse Maven search response",
          });
        }
      });
    }).on("error", (error) => {
      resolve({
        package: artifactId,
        currentVersion: null,
        latestVersion: null,
        latestLTS: null,
        allVersions: [],
        registry: "maven",
        error: error.message,
      });
    });
  });
}

/**
 * Automatically detect registry and fetch versions.
 * For .NET runtime/framework, uses dotnet-version-registry only (never npm).
 */
export async function fetchPackageVersions(
  packageName: string,
  language?: string,
  currentVersion?: string | null
): Promise<PackageVersionInfo> {
  if (isDotNetRuntimePackage(packageName)) {
    return Promise.resolve(fetchDotNetVersions(packageName, currentVersion));
  }
  // Resolve display names of client-side JS libraries to npm (e.g. "Bootstrap Datepicker" → npm:bootstrap-datepicker)
  const npmResolved = resolveToNpmIfClientLib(packageName);
  if (npmResolved) {
    const result = await fetchNpmVersions(npmResolved);
    result.package = packageName;
    return result;
  }
  // Even in .NET projects, route npm-style packages to npm (e.g. minimist, neo-async)
  if (language === "dotnet" && isLikelyNpmPackage(packageName)) {
    return fetchNpmVersions(packageName);
  }
  if (language === "dotnet" || isNuGetPackage(packageName)) {
    // Resolve human-readable names (e.g. "ASP.NET Core") to real NuGet IDs
    const resolvedName = resolveNuGetPackageName(packageName);
    const result = await fetchNuGetVersions(resolvedName);
    if (result.error) {
      // Retry once after a short delay for transient network errors
      await new Promise(r => setTimeout(r, 1000));
      const retry = await fetchNuGetVersions(resolvedName);
      if (!retry.error) {
        retry.package = packageName;
        return retry;
      }
    }
    result.package = packageName;
    return result;
  }
  if (language === "python" || packageName.includes("_")) {
    return fetchPyPIVersions(packageName);
  }
  // Handle both "java" and "maven" (LLM tool calls may pass "maven" as the registry)
  const isJavaLang = language === "java" || language === "maven";
  if (isJavaLang && packageName.includes(":")) {
    const [groupId, artifactId] = packageName.split(":");
    return fetchMavenVersions(groupId, artifactId);
  }
  // Java package without ":" — try known name resolution, then Maven search
  if (isJavaLang) {
    const resolved = KNOWN_JAVA_PACKAGES[packageName.toLowerCase()];
    if (resolved) {
      const [groupId, artifactId] = resolved.split(":");
      return fetchMavenVersions(groupId, artifactId);
    }
    return searchMavenByArtifactId(packageName);
  }
  return fetchNpmVersions(packageName);
}

/**
 * Fetch versions for multiple packages (with concurrency limit).
 * Supports optional version per package (used for .NET current version).
 */
export async function fetchMultiplePackageVersions(
  packages: Array<{ name: string; language?: string; version?: string }>,
  concurrency: number = 5
): Promise<PackageVersionInfo[]> {
  const results: PackageVersionInfo[] = [];
  const PER_PACKAGE_TIMEOUT = 15_000;
  const TOTAL_TIMEOUT = 120_000;
  const totalStart = Date.now();

  for (let i = 0; i < packages.length; i += concurrency) {
    if (Date.now() - totalStart > TOTAL_TIMEOUT) {
      console.warn(`[VersionRegistry] Global timeout (${TOTAL_TIMEOUT / 1000}s) reached after ${results.length}/${packages.length} packages — returning partial results`);
      break;
    }

    const batch = packages.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((pkg) => {
        const timeoutPromise = new Promise<PackageVersionInfo>((resolve) =>
          setTimeout(() => resolve({
            package: pkg.name, currentVersion: pkg.version ?? null, latestVersion: null,
            latestLTS: null, allVersions: [], registry: "timeout" as any, error: `Timed out after ${PER_PACKAGE_TIMEOUT / 1000}s`,
          }), PER_PACKAGE_TIMEOUT)
        );
        return Promise.race([
          fetchPackageVersions(pkg.name, pkg.language, pkg.version ?? null),
          timeoutPromise,
        ]);
      })
    );
    results.push(...batchResults);
    
    if (i + concurrency < packages.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  console.log(`[VersionRegistry] fetchMultiplePackageVersions: ${results.length}/${packages.length} packages in ${((Date.now() - totalStart) / 1000).toFixed(1)}s`);
  
  const dotnetCount = results.filter((r) => r.registry === "dotnet-official").length;
  const failed = results.filter((r) => r.error);
  const succeeded = results.filter((r) => !r.error);
  if (failed.length > 0) {
    for (const f of failed) {
    }
  }
  const nugetCount = results.filter((r) => r.registry === "nuget" && !r.error).length;

  return results;
}

/**
 * Detect current version from package manifest (package.json, .csproj parsed, pom.xml parsed, etc.).
 * Caller may pass full manifest or manifest.parsed; we accept both shapes.
 */
export function detectCurrentVersion(packageName: string, manifest: any): string | null {
  if (!manifest) return null;

  // .csproj parsed: dependencies is an array of { name, version }
  const arrDeps = manifest.parsed?.dependencies ?? manifest.dependencies;
  if (Array.isArray(arrDeps)) {
    const dep = arrDeps.find(
      (d: any) => d && (d.name === packageName || (d.name && String(d.name).toLowerCase() === packageName.toLowerCase()))
    );
    if (dep && dep.version) return String(dep.version).trim();

    // pom.xml parsed: dependencies is an array of { groupId, artifactId, version }
    if (packageName.includes(":")) {
      const [gId, aId] = packageName.split(":");
      const mavenDep = arrDeps.find(
        (d: any) => d && d.groupId && d.artifactId &&
          d.groupId.toLowerCase() === gId.toLowerCase() &&
          d.artifactId.toLowerCase() === aId.toLowerCase()
      );
      if (mavenDep && mavenDep.version) return String(mavenDep.version).trim();
    }
  }

  // pom.xml parent (manifest.parsed.parent or manifest.parent)
  const parent = manifest.parsed?.parent ?? manifest.parent;
  if (parent && packageName.includes(":")) {
    const [gId, aId] = packageName.split(":");
    if (parent.groupId?.toLowerCase() === gId.toLowerCase() && parent.artifactId?.toLowerCase() === aId.toLowerCase() && parent.version) {
      return String(parent.version).trim();
    }
  }

  // package.json style (object)
  const deps = {
    ...(manifest.parsed?.dependencies ?? manifest.dependencies),
    ...(manifest.parsed?.devDependencies ?? manifest.devDependencies),
    ...(manifest.parsed?.peerDependencies ?? manifest.peerDependencies)
  };
  if (deps[packageName]) {
    return String(deps[packageName]).replace(/[\^~>=<]/g, "").trim();
  }

  return null;
}
