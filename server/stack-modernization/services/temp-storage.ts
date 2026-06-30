/**
 * Stack Modernization - Temporary Storage Service
 * PRODUCTION-READY file handling with proper cleanup and ZIP extraction
 * 
 * Key Features:
 * - Safe temp directory management
 * - ZIP file extraction with validation
 * - Automatic cleanup (immediate + scheduled)
 * - Memory-efficient processing
 * - Security: Path traversal prevention
 */

import * as fs from "fs/promises";
import * as path from "path";
import { stackModConfig } from "../config";
import type { FileType, ExtractedFile } from "../types";

// Track active sessions for cleanup
const activeSessions = new Map<string, { tempDir: string; createdAt: Date; timeoutId?: NodeJS.Timeout }>();

/**
 * Resolve the base directory for temporary session files.
 * Uses stack-modernization config (CODE_EXECUTION_BASE_DIR); fallback: .stack-mod-temp or cwd.
 */
function resolveBaseDir(): string {
  const base = stackModConfig.codeExecutionBaseDir;
  if (base) return path.join(base, "stack-modernization");
  return path.join(process.cwd(), ".stack-mod-temp");
}

/**
 * Create a temporary directory for a session
 * PRODUCTION: Creates isolated workspace for each user session
 */
export async function createTempDirectory(sessionId: string): Promise<string> {
  const baseDir = resolveBaseDir();
  const sessionDir = path.join(baseDir, sessionId);
  
  // Create directory structure
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.mkdir(path.join(sessionDir, "uploads"), { recursive: true });
  await fs.mkdir(path.join(sessionDir, "extracted"), { recursive: true });
  await fs.mkdir(path.join(sessionDir, "reports"), { recursive: true });
  
  
  // Track session for cleanup
  activeSessions.set(sessionId, {
    tempDir: sessionDir,
    createdAt: new Date()
  });
  
  return sessionDir;
}

/**
 * Clean up temporary directory
 * PRODUCTION: Always call this when processing is complete
 */
export async function cleanupTempDirectory(tempDir: string): Promise<void> {
  try {
    const allowedBase = resolveBaseDir();
    if (!tempDir.startsWith(allowedBase)) {
      console.error(`[TempStorage] ❌ Security: Attempted to delete dir outside allowed base: ${tempDir}`);
      return;
    }
    
    await fs.rm(tempDir, { recursive: true, force: true });
    
    // Remove from active sessions
    for (const [sessionId, session] of activeSessions.entries()) {
      if (session.tempDir === tempDir) {
        // Clear any scheduled timeout
        if (session.timeoutId) {
          clearTimeout(session.timeoutId);
        }
        activeSessions.delete(sessionId);
        break;
      }
    }
  } catch (error) {
    console.error(`[TempStorage] ❌ Error cleaning up temp directory:`, error);
  }
}

/**
 * Clean up by session ID
 */
export async function cleanupBySessionId(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (session) {
    await cleanupTempDirectory(session.tempDir);
  }
}

/**
 * Schedule cleanup after specified hours (default: 2 hours for production)
 * PRODUCTION: Aggressive cleanup to avoid disk space issues
 */
export function scheduleCleanup(sessionId: string, hours: number = 2): void {
  const session = activeSessions.get(sessionId);
  if (!session) {
    console.warn(`[TempStorage] ⚠️  Session ${sessionId} not found for cleanup scheduling`);
    return;
  }
  
  const milliseconds = hours * 60 * 60 * 1000;
  
  // Clear any existing timeout
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
  }
  
  const timeoutId = setTimeout(async () => {
    await cleanupTempDirectory(session.tempDir);
  }, milliseconds);
  
  session.timeoutId = timeoutId;
  activeSessions.set(sessionId, session);
  
}

/**
 * Get upload directory for session
 */
export function getUploadDir(tempDir: string): string {
  return path.join(tempDir, "uploads");
}

/**
 * Get extracted files directory for session
 */
export function getExtractedDir(tempDir: string): string {
  return path.join(tempDir, "extracted");
}

/** Directories to skip entirely when reading extracted/git repo */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "__pycache__", "venv", "dist", "build", "bin", "obj", ".vs",
  "bower_components", "jspm_packages",
  ".nuget", "packages",
  "target", ".gradle",
]);

/** Paths matching these patterns are third-party vendor/dist files (not user-authored code). */
// Centralized vendor path patterns — used by ALL tech stacks
// .NET, Java, Python, Node.js, PHP, Ruby, Go, Rust
export const VENDOR_PATH_PATTERNS = [
  // .NET
  /[/\\]wwwroot[/\\]lib[/\\]/i,
  /[/\\]\.nuget[/\\]/i,
  /[/\\]packages[/\\]/i,
  // Legacy web
  /[/\\]bower_components[/\\]/i,
  /[/\\]vendor[/\\](assets|bundle|plugins)[/\\]/i,
  // Java / Spring
  /[/\\]webapp[/\\](static|resources)[/\\]/i,
  /[/\\]resources[/\\]static[/\\](lib|vendor|js|css)[/\\]/i,
  // Python / Django / Flask
  /[/\\]static[/\\](vendor|lib)[/\\]/i,
  /[/\\]staticfiles[/\\](vendor|lib)[/\\]/i,
  // Node.js / Express
  /[/\\]public[/\\](lib|vendor|assets[/\\]vendor)[/\\]/i,
  // PHP / Laravel / Symfony
  /[/\\]public[/\\](assets[/\\]vendor|vendor|js[/\\]vendor)[/\\]/i,
  /[/\\]resources[/\\]js[/\\]vendor[/\\]/i,
  // Ruby / Rails
  /[/\\]app[/\\]assets[/\\](vendor|javascripts[/\\]vendor)[/\\]/i,
];

const MANIFEST_BASENAMES = new Set([
  "package.json", "libman.json", "bower.json", "bundleconfig.json",
  "pom.xml", "build.gradle", "build.gradle.kts",
  "composer.json", "gemfile", "go.mod", "cargo.toml",
]);

export function isVendorPath(relativePath: string): boolean {
  return VENDOR_PATH_PATTERNS.some(p => p.test(relativePath));
}

function isManifestFile(relativePath: string): boolean {
  const baseName = relativePath.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  return MANIFEST_BASENAMES.has(baseName) || baseName.endsWith(".csproj");
}

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp", ".avif",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib", ".pdb",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".webm",
  ".map",
  ".snk", ".pfx", ".cer", ".p12", ".pem", ".key",
  ".resx",
  ".nupkg", ".vsix",
]);

function isBinaryFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;
  const lower = fileName.toLowerCase();
  return lower.endsWith(".min.js") || lower.endsWith(".min.css") || lower.endsWith(".bundle.js");
}

/**
 * Read extracted directory recursively into a file list (shared by ZIP upload and git clone).
 * Skips SKIP_DIRS, vendor paths (except manifests), and binary files.
 */
function extensionToFileType(ext: string): FileType {
  const map: Record<string, FileType> = {
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript",
    ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
    ".py": "python", ".pyw": "python",
    ".java": "java", ".kt": "java", ".scala": "java",
    ".cs": "csharp", ".vb": "csharp", ".fs": "csharp", ".csproj": "xml", ".sln": "text",
    ".go": "go",
    ".rb": "ruby", ".erb": "ruby",
    ".php": "php",
    ".json": "json",
    ".xml": "xml", ".xaml": "xml", ".xsl": "xml", ".xslt": "xml", ".svg": "xml",
    ".yaml": "yaml", ".yml": "yaml",
    ".md": "markdown", ".mdx": "markdown",
    ".txt": "text", ".csv": "text", ".log": "text", ".ini": "text", ".cfg": "text",
    ".html": "text", ".htm": "text", ".css": "text", ".scss": "text", ".less": "text", ".sass": "text",
  };
  return map[ext] || "unknown";
}

export async function readExtractedDirToFileList(extractDir: string): Promise<ExtractedFile[]> {
  const result: ExtractedFile[] = [];
  let skippedVendorCount = 0;
  let skippedBinaryCount = 0;
  let skippedOversizeCount = 0;
  const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB per file — prevent OOM on large repos
  const MAX_TOTAL_FILES = 5000; // safety cap for very large monorepos

  async function readDirRecursive(dir: string, prefix = ""): Promise<void> {
    if (result.length >= MAX_TOTAL_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (result.length >= MAX_TOTAL_FILES) break;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await readDirRecursive(fullPath, relPath);
        }
      } else if (entry.isFile()) {
        if (isBinaryFile(entry.name)) {
          skippedBinaryCount++;
          continue;
        }
        if (isVendorPath(relPath) && !isManifestFile(relPath)) {
          skippedVendorCount++;
          continue;
        }
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > MAX_FILE_BYTES) {
            skippedOversizeCount++;
            console.log(`[TempStorage] Skipped oversize file: ${relPath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
            continue;
          }
          const content = await fs.readFile(fullPath, "utf-8");
          const ext = path.extname(entry.name).toLowerCase();
          result.push({
            relativePath: relPath,
            fullPath,
            content,
            size: Buffer.byteLength(content, "utf8"),
            extension: ext,
            fileType: extensionToFileType(ext),
          });
        } catch (readError) {
          console.error(`[TempStorage] ⚠️ Could not read ${relPath}:`, readError);
        }
      }
    }
  }
  await readDirRecursive(extractDir);
  const skippedTotal = skippedVendorCount + skippedBinaryCount + skippedOversizeCount;
  if (skippedTotal > 0) {
    console.log(`[TempStorage] Read ${result.length} text files. Skipped: ${skippedVendorCount} vendor, ${skippedBinaryCount} binary, ${skippedOversizeCount} oversize (>2MB)`);
  }
  if (result.length >= MAX_TOTAL_FILES) {
    console.warn(`[TempStorage] Hit file cap (${MAX_TOTAL_FILES}). Some files were not read.`);
  }
  return result;
}

/**
 * Collect vendor directory file paths with FULL content for .js/.css files.
 * Reading full content is critical for bundle detection — scanFileForBundledLibraries()
 * needs to scan the ENTIRE file to find ALL version comment headers (e.g., jQuery AND
 * Bootstrap AND Font Awesome concatenated into one base-library.css).
 * Previously only 512 bytes were read, which missed libraries after the first one.
 */
export async function collectVendorFilePaths(extractDir: string): Promise<Array<{ relativePath: string; content: string }>> {
  const vendorFiles: Array<{ relativePath: string; content: string }> = [];

  async function scanDir(dir: string, prefix = ""): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await scanDir(fullPath, relPath);
        }
      } else if (entry.isFile() && isVendorPath(relPath) && !isManifestFile(relPath)) {
        const ext = path.extname(entry.name).toLowerCase();
        let content = "";
        if (ext === ".js" || ext === ".css") {
          try {
            // Read FULL file content so bundle scanner can find ALL version headers
            content = await fs.readFile(fullPath, "utf-8");
            console.log(`[TempStorage] Read vendor file fully: ${relPath} (${Math.round(content.length / 1024)}KB)`);
          } catch { /* skip on read error */ }
        }
        vendorFiles.push({ relativePath: relPath, content });
      }
    }
  }

  await scanDir(extractDir);
  console.log(`[TempStorage] collectVendorFilePaths: ${vendorFiles.length} vendor files collected (full content)`);
  return vendorFiles;
}

export interface VendorDirEntry {
  relativePath: string;
  libraryDirName: string;
  vendorBasePath: string;
  extension: string;
  header: string;
}

/**
 * Scan vendor directories and return structured metadata per file.
 * Groups files under their library directory name for easier detection.
 * Only reads the first 512 bytes of .js/.css files for version header extraction.
 */
export async function scanVendorDirectories(extractDir: string): Promise<VendorDirEntry[]> {
  const entries: VendorDirEntry[] = [];

  const VENDOR_DIR_ROOTS = [
    // ── .NET / ASP.NET ──
    /^(.*[/\\]wwwroot[/\\]lib)[/\\]([^/\\]+)/i,
    /^(.*[/\\]wwwroot[/\\]vendor)[/\\]([^/\\]+)/i,
    /^(.*[/\\]Scripts)[/\\]([^/\\]+)/i,                          // Legacy ASP.NET WebForms
    /^(.*[/\\]Content[/\\]lib)[/\\]([^/\\]+)/i,                  // Legacy ASP.NET MVC
    // ── Bower / Legacy ──
    /^(.*[/\\]bower_components)[/\\]([^/\\]+)/i,
    // ── Java / Spring / JSP ──
    /^(.*[/\\]webapp[/\\]static)[/\\]([^/\\]+)/i,
    /^(.*[/\\]webapp[/\\]js)[/\\]([^/\\]+)/i,
    /^(.*[/\\]webapp[/\\]css)[/\\]([^/\\]+)/i,
    /^(.*[/\\]resources[/\\]static[/\\]lib)[/\\]([^/\\]+)/i,     // Spring Boot: src/main/resources/static/lib/
    /^(.*[/\\]resources[/\\]static[/\\]vendor)[/\\]([^/\\]+)/i,  // Spring Boot: src/main/resources/static/vendor/
    /^(.*[/\\]resources[/\\]static[/\\]js)[/\\]([^/\\]+)/i,      // Spring Boot: resources/static/js/
    // ── Python / Django / Flask ──
    /^(.*[/\\]static[/\\]vendor)[/\\]([^/\\]+)/i,
    /^(.*[/\\]static[/\\]lib)[/\\]([^/\\]+)/i,
    /^(.*[/\\]static[/\\]js[/\\]vendor)[/\\]([^/\\]+)/i,
    /^(.*[/\\]staticfiles[/\\]vendor)[/\\]([^/\\]+)/i,
    /^(.*[/\\]staticfiles[/\\]lib)[/\\]([^/\\]+)/i,
    // ── Ruby / Rails ──
    /^(.*[/\\]app[/\\]assets[/\\]vendor)[/\\]([^/\\]+)/i,
    /^(.*[/\\]app[/\\]assets[/\\]javascripts[/\\]vendor)[/\\]([^/\\]+)/i,
    /^(.*[/\\]vendor[/\\]assets)[/\\]([^/\\]+)/i,
    /^(.*[/\\]vendor[/\\](?:assets|bundle|plugins))[/\\]([^/\\]+)/i,
    // ── PHP / Laravel / Symfony ──
    /^(.*[/\\]public[/\\]assets[/\\]vendor)[/\\]([^/\\]+)/i,
    /^(.*[/\\]public[/\\]vendor)[/\\]([^/\\]+)/i,
    /^(.*[/\\]public[/\\]js[/\\]vendor)[/\\]([^/\\]+)/i,
    /^(.*[/\\]resources[/\\]js[/\\]vendor)[/\\]([^/\\]+)/i,      // Laravel
    // ── Node.js / Express / Generic ──
    /^(.*[/\\]public[/\\]lib)[/\\]([^/\\]+)/i,
    /^(.*[/\\]public[/\\]javascripts[/\\]vendor)[/\\]([^/\\]+)/i,
    /^(.*[/\\]assets[/\\]vendor)[/\\]([^/\\]+)/i,
    /^(.*[/\\]assets[/\\]lib)[/\\]([^/\\]+)/i,
  ];

  function parseVendorRoot(relPath: string): { vendorBasePath: string; libraryDirName: string } | null {
    for (const re of VENDOR_DIR_ROOTS) {
      const m = relPath.match(re);
      if (m) {
        let dirName = m[2];
        // Handle standalone files directly in vendor root (e.g., wwwroot/lib/bootbox.js)
        // The regex captures the filename as dirName — strip .js/.css/.min.js/.min.css extensions
        if (/\.(min\.js|min\.css|bundle\.js|bundle\.min\.js|js|css)$/i.test(dirName)) {
          dirName = dirName.replace(/\.(min\.js|min\.css|bundle\.js|bundle\.min\.js|js|css)$/i, "");
        }
        return { vendorBasePath: `${m[1]}/${m[2]}`, libraryDirName: dirName };
      }
    }
    return null;
  }

  async function walk(dir: string, prefix = ""): Promise<void> {
    let dirEntries;
    try { dirEntries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }

    for (const de of dirEntries) {
      const relPath = prefix ? `${prefix}/${de.name}` : de.name;
      const fullPath = path.join(dir, de.name);
      if (de.isDirectory()) {
        if (!SKIP_DIRS.has(de.name)) await walk(fullPath, relPath);
      } else if (de.isFile()) {
        const ext = path.extname(de.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext) && ext !== ".map") continue;

        const parsed = parseVendorRoot(relPath);
        if (!parsed) continue;

        let header = "";
        if (ext === ".js" || ext === ".css") {
          try {
            const fh = await fs.open(fullPath, "r");
            try {
              const buf = Buffer.alloc(512);
              await fh.read(buf, 0, 512, 0);
              header = buf.toString("utf-8").replace(/\0/g, "");
            } finally { await fh.close(); }
          } catch { /* skip */ }
        }

        entries.push({
          relativePath: relPath,
          libraryDirName: parsed.libraryDirName,
          vendorBasePath: parsed.vendorBasePath,
          extension: ext,
          header,
        });
      }
    }
  }

  await walk(extractDir);
  console.log(`[TempStorage] scanVendorDirectories: found ${entries.length} vendor files`);
  return entries;
}

/**
 * Read the full content of a vendor file by its path relative to extractDir.
 */
export async function readVendorFileContent(extractDir: string, relativePath: string): Promise<string> {
  return fs.readFile(path.join(extractDir, relativePath), "utf-8");
}

/**
 * Get reports directory for session
 */
export function getReportsDir(tempDir: string): string {
  return path.join(tempDir, "reports");
}

/**
 * Extract ZIP file to extracted directory
 * PRODUCTION: Secure extraction with validation
 */
export async function extractZipFile(zipPath: string, extractDir: string): Promise<{ 
  success: boolean; 
  filesExtracted: number; 
  errors: string[] 
}> {
  const errors: string[] = [];
  let filesExtracted = 0;
  
  try {
    // Import zip library dynamically
    const AdmZip = (await import("adm-zip")).default;
    
    
    // Verify ZIP file exists
    try {
      await fs.access(zipPath);
    } catch {
      errors.push(`ZIP file not found: ${zipPath}`);
      return { success: false, filesExtracted: 0, errors };
    }
    
    // Extract ZIP
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    
    
    // Extract each entry with security validation
    for (const entry of zipEntries) {
      try {
        // Skip directories
        if (entry.isDirectory) continue;
        
        // Security: Prevent path traversal attacks
        const entryPath = entry.entryName.replace(/\\/g, '/');
        if (entryPath.includes('../') || entryPath.startsWith('/')) {
          console.warn(`[TempStorage] ⚠️  Skipping potentially malicious path: ${entryPath}`);
          errors.push(`Skipped suspicious path: ${entryPath}`);
          continue;
        }
        
        // Skip hidden files and OS metadata
        const fileName = path.basename(entryPath);
        if (fileName.startsWith('.') || fileName === '__MACOSX' || fileName === 'Thumbs.db') {
          continue;
        }
        
        // Extract file
        const targetPath = path.join(extractDir, entryPath);
        const targetDir = path.dirname(targetPath);
        
        // Ensure target directory exists
        await fs.mkdir(targetDir, { recursive: true });
        
        // Write file content
        const content = entry.getData();
        await fs.writeFile(targetPath, content);
        
        filesExtracted++;
        
        if (filesExtracted % 100 === 0) {
        }
      } catch (entryError) {
        console.error(`[TempStorage] ❌ Error extracting ${entry.entryName}:`, entryError);
        errors.push(`Failed to extract ${entry.entryName}: ${entryError instanceof Error ? entryError.message : String(entryError)}`);
      }
    }
    
    
    return {
      success: filesExtracted > 0,
      filesExtracted,
      errors
    };
    
  } catch (error) {
    console.error(`[TempStorage] ❌ ZIP extraction failed:`, error);
    errors.push(`ZIP extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      success: false,
      filesExtracted,
      errors
    };
  }
}

/**
 * Get all active sessions (for monitoring)
 */
export function getActiveSessions(): Array<{ sessionId: string; tempDir: string; createdAt: Date; ageHours: number }> {
  const now = Date.now();
  return Array.from(activeSessions.entries()).map(([sessionId, session]) => ({
    sessionId,
    tempDir: session.tempDir,
    createdAt: session.createdAt,
    ageHours: (now - session.createdAt.getTime()) / (1000 * 60 * 60)
  }));
}

/**
 * Cleanup old sessions (call periodically from server startup)
 * PRODUCTION: Run this on server startup to clean up orphaned sessions
 */
export async function cleanupOldSessions(maxAgeHours: number = 24): Promise<number> {
  
  const baseDir = resolveBaseDir();
  let cleanedCount = 0;
  
  try {
    // Check if base directory exists
    try {
      await fs.access(baseDir);
    } catch {
      return 0;
    }
    
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const sessionDir = path.join(baseDir, entry.name);
      
      try {
        const stats = await fs.stat(sessionDir);
        const age = now - stats.birthtimeMs;
        
        if (age > maxAgeMs) {
          await cleanupTempDirectory(sessionDir);
          cleanedCount++;
        }
      } catch (error) {
        console.error(`[TempStorage] ❌ Error checking session ${entry.name}:`, error);
      }
    }
    
  } catch (error) {
    console.error(`[TempStorage] ❌ Error during cleanup:`, error);
  }
  
  return cleanedCount;
}

/**
 * Get disk usage for temp directory
 * PRODUCTION: Monitor disk usage to prevent space issues
 */
export async function getTempDiskUsage(): Promise<{ totalSizeMB: number; sessionCount: number }> {
  const baseDir = resolveBaseDir();
  let totalSize = 0;
  let sessionCount = 0;
  
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      sessionCount++;
      const sessionDir = path.join(baseDir, entry.name);
      totalSize += await getDirectorySize(sessionDir);
    }
  } catch {
    // Directory doesn't exist or is empty
  }
  
  return {
    totalSizeMB: Math.round(totalSize / (1024 * 1024)),
    sessionCount
  };
}

/**
 * Helper: Calculate directory size recursively
 */
async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
      }
    }
  } catch {
    // Ignore errors (permission issues, etc.)
  }
  
  return totalSize;
}
