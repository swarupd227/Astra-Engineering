/**
 * Stack Modernization - File Handler Service
 * Handles file upload, classification, and initial processing
 */

import * as fs from "fs/promises";
import * as path from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import type { 
  UploadedFile, 
  ExtractedFile, 
  FileType,
  StackModernizationState 
} from "../types";

/**
 * Classify file type based on extension and MIME type
 */
export function classifyFileType(filename: string, mimeType: string): FileType {
  const ext = path.extname(filename).toLowerCase();
  
  // Mapping table
  const extensionMap: Record<string, FileType> = {
    ".zip": "zip",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".py": "python",
    ".java": "java",
    ".cs": "csharp",
    ".go": "go",
    ".rb": "ruby",
    ".php": "php",
    ".rs": "text",
    ".c": "text",
    ".cpp": "text",
    ".h": "text",
    ".hpp": "text",
    ".kt": "text",
    ".kts": "text",
    ".swift": "text",
    ".dart": "text",
    ".scala": "text",
    ".ex": "text",
    ".exs": "text",
    ".vue": "text",
    ".svelte": "text",
    ".json": "json",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "text",
    ".gradle": "text",
    ".sbt": "text",
    ".md": "markdown",
    ".txt": "text",
    ".css": "text",
    ".scss": "text",
    ".less": "text",
    ".html": "text",
    ".htm": "text",
  };
  
  return extensionMap[ext] || "unknown";
}

/**
 * Calculate file hash for deduplication
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  const fileBuffer = await fs.readFile(filePath);
  const hash = createHash("sha256");
  hash.update(fileBuffer);
  return hash.digest("hex");
}

/**
 * Process uploaded files - store and classify
 */
export async function processUploadedFiles(
  files: any[],
  tempDir: string
): Promise<UploadedFile[]> {
  const uploadedFiles: UploadedFile[] = [];
  
  for (const file of files) {
    try {
      // Generate unique filename
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      const storedName = `upload-${uniqueSuffix}${ext}`;
      const storedPath = path.join(tempDir, storedName);
      
      // Move file to temp directory
      await fs.rename(file.path, storedPath);
      
      // Calculate hash
      const fileHash = await calculateFileHash(storedPath);
      
      // Classify file type
      const fileType = classifyFileType(file.originalname, file.mimetype);
      
      uploadedFiles.push({
        id: fileHash.substring(0, 16),
        originalName: file.originalname,
        storedName,
        path: storedPath,
        size: file.size,
        mimeType: file.mimetype,
        extension: path.extname(file.originalname).toLowerCase(),
        fileType,
        uploadedAt: new Date(),
      });
      
    } catch (error) {
      console.error(`[FileHandler] Error processing file ${file.originalname}:`, error);
      throw new Error(`Failed to process file: ${file.originalname}`);
    }
  }
  
  return uploadedFiles;
}

/**
 * Extract files from ZIP archive
 */
export async function extractZipFile(
  zipPath: string,
  extractDir: string
): Promise<ExtractedFile[]> {
  const extractedFiles: ExtractedFile[] = [];
  
  try {
    // Read ZIP file
    const zipData = await fs.readFile(zipPath);
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(zipData);
    
    // Extract all files
    const promises: Promise<void>[] = [];
    
    zipContent.forEach((relativePath, zipEntry) => {
      // Skip directories and hidden files
      if (zipEntry.dir || relativePath.startsWith(".") || relativePath.includes("/.")) {
        return;
      }
      
      // Skip excluded directories (build artifacts, package manager caches, IDE folders)
      const excludedDirs = [
        "node_modules", ".git", "__pycache__", "venv", ".venv", "target", "dist", "build",
        "bin", "obj", ".vs", ".idea", ".vscode", "packages", "Debug", "Release",
        ".gradle", ".nuget", "__MACOSX", "bower_components",
      ];
      const normalizedPath = relativePath.replace(/\\/g, "/");
      if (excludedDirs.some(dir => {
        const lower = dir.toLowerCase();
        return normalizedPath.toLowerCase().includes(`/${lower}/`) || normalizedPath.toLowerCase().startsWith(`${lower}/`);
      })) {
        return;
      }

      // Skip binary files that cannot be meaningfully upgraded
      const binaryExtensions = new Set([
        ".dll", ".exe", ".so", ".dylib", ".bin", ".o", ".obj", ".lib", ".a",
        ".woff", ".woff2", ".ttf", ".eot", ".otf",
        ".png", ".jpg", ".jpeg", ".gif", ".ico", ".bmp", ".svg", ".webp", ".tiff",
        ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z", ".jar", ".war", ".ear",
        ".mp3", ".mp4", ".avi", ".mov", ".wav", ".ogg", ".webm",
        ".pyc", ".pyo", ".class", ".dex",
        ".map",
        ".db", ".sqlite", ".sqlite3", ".mdb",
        ".snk", ".pfx", ".cer", ".p12", ".pem", ".key",
        ".resx",
        ".nupkg", ".vsix",
      ]);
      const fileExt = path.extname(relativePath).toLowerCase();
      if (binaryExtensions.has(fileExt)) {
        return;
      }
      // .min.js / .min.css — path.extname() returns .js/.css, so check filename
      const fileName = relativePath.split(/[/\\]/).pop()?.toLowerCase() || "";
      if (fileName.endsWith(".min.js") || fileName.endsWith(".min.css") || fileName.endsWith(".bundle.js")) {
        return;
      }
      
      const promise = (async () => {
        try {
          const content = await zipEntry.async("string");
          const fullPath = path.join(extractDir, relativePath);
          const ext = path.extname(relativePath).toLowerCase();
          
          // Create directory if needed
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          
          // Write file
          await fs.writeFile(fullPath, content, "utf-8");
          
          extractedFiles.push({
            relativePath,
            fullPath,
            content,
            size: content.length,
            extension: ext,
            fileType: classifyFileType(relativePath, ""),
          });
        } catch (err) {
          console.warn(`[FileHandler] Could not extract ${relativePath}:`, err);
        }
      })();
      
      promises.push(promise);
    });
    
    await Promise.all(promises);
    
    
    // Log folder structure
    const folders = new Set<string>();
    extractedFiles.forEach(file => {
      const dir = path.dirname(file.relativePath);
      if (dir !== '.') {
        folders.add(dir);
      }
    });
    
    Array.from(folders).sort().forEach(folder => {
      const fileCount = extractedFiles.filter(f => path.dirname(f.relativePath) === folder).length;
    });
    
    // Log file types
    const fileTypes = extractedFiles.reduce((acc, file) => {
      acc[file.fileType] = (acc[file.fileType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    Object.entries(fileTypes).forEach(([type, count]) => {
    });
    
    return extractedFiles;
  } catch (error) {
    console.error("[FileHandler] Error extracting ZIP file:", error);
    throw new Error("Failed to extract ZIP archive");
  }
}

/**
 * Extract all files from uploaded files (handle ZIPs and individual files)
 */
export async function extractAllFiles(
  uploadedFiles: UploadedFile[],
  extractDir: string
): Promise<ExtractedFile[]> {
  let allExtractedFiles: ExtractedFile[] = [];
  
  for (const file of uploadedFiles) {
    if (file.fileType === "zip") {
      // Extract ZIP
      const extracted = await extractZipFile(file.path, extractDir);
      allExtractedFiles = allExtractedFiles.concat(extracted);
    } else {
      // Individual file - read and add
      try {
        const content = await fs.readFile(file.path, "utf-8");
        allExtractedFiles.push({
          relativePath: file.originalName,
          fullPath: file.path,
          content,
          size: file.size,
          extension: file.extension,
          fileType: file.fileType,
        });
      } catch (error) {
        console.warn(`[FileHandler] Could not read file ${file.originalName}:`, error);
      }
    }
  }
  
  return allExtractedFiles;
}

/**
 * Identify package manifest files
 */
export function identifyManifestFiles(extractedFiles: ExtractedFile[]): ExtractedFile[] {
  const manifestFilenames = [
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "requirements.txt",
    "Pipfile",
    "Pipfile.lock",
    "poetry.lock",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "gradle.properties",
    "go.mod",
    "go.sum",
    "Gemfile",
    "Gemfile.lock",
    "composer.json",
    "composer.lock",
    "Cargo.toml",
    "Cargo.lock",
    ".csproj",
    "packages.config",
    "libman.json",
    "bower.json",
    "global.json",
    "nuget.config",
    "Directory.Build.props",
    "Directory.Build.targets",
    "tsconfig.json",
  ];
  
  return extractedFiles.filter(file => {
    const filename = path.basename(file.relativePath).toLowerCase();
    return manifestFilenames.some(manifest => 
      filename === manifest.toLowerCase() || filename.endsWith(".csproj")
    );
  });
}

/**
 * Identify CI configuration files
 */
export function identifyCIFiles(extractedFiles: ExtractedFile[]): ExtractedFile[] {
  const ciPatterns = [
    ".github/workflows/",
    ".gitlab-ci.yml",
    "Jenkinsfile",
    "azure-pipelines.yml",
    ".circleci/config.yml",
    ".travis.yml",
  ];
  
  return extractedFiles.filter(file => {
    return ciPatterns.some(pattern => file.relativePath.includes(pattern));
  });
}

/**
 * Identify Docker files
 */
export function identifyDockerFiles(extractedFiles: ExtractedFile[]): ExtractedFile[] {
  return extractedFiles.filter(file => {
    const filename = path.basename(file.relativePath).toLowerCase();
    return filename === "dockerfile" || 
           filename.startsWith("dockerfile.") ||
           filename === "docker-compose.yml" ||
           filename === "docker-compose.yaml";
  });
}

/**
 * Get basic file structure statistics
 */
export function getFileStructureStats(extractedFiles: ExtractedFile[]) {
  const codeExtensions = [".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".cs", ".go", ".rb", ".php"];
  const configExtensions = [".json", ".xml", ".yaml", ".yml", ".toml", ".ini", ".conf"];
  const testPatterns = ["/test/", "/tests/", "/__tests__/", ".test.", ".spec.", "_test.", "_spec."];
  
  return {
    totalFiles: extractedFiles.length,
    codeFiles: extractedFiles.filter(f => 
      codeExtensions.includes(f.extension)
    ).length,
    configFiles: extractedFiles.filter(f => 
      configExtensions.includes(f.extension)
    ).length,
    testFiles: extractedFiles.filter(f => 
      testPatterns.some(pattern => f.relativePath.includes(pattern))
    ).length,
  };
}

/**
 * Update state with extracted files
 */
export function updateStateWithFiles(
  state: StackModernizationState,
  uploadedFiles: UploadedFile[],
  extractedFiles: ExtractedFile[]
): StackModernizationState {
  return {
    ...state,
    uploadedFiles,
    extractedFiles,
  };
}
