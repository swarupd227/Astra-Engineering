import { db } from "../db";
import { goldenRepositories, type InsertGoldenRepository, type GoldenRepository } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import AdmZip from "adm-zip";
import path from "path";
import fs from "fs/promises";

/**
 * Golden repo ZIP configuration.
 *
 * - GOLDEN_REPO_ZIP_PATH (legacy): single zip containing guidelines. Kept for backward compatibility.
 * - GOLDEN_REPO_ZIP_DIR (recommended): directory containing one zip per golden repo.
 *
 * When GOLDEN_REPO_ZIP_DIR is set and we know the repo id/name, we will look for a matching zip inside
 * that directory using several name variants (repoId.zip, repoName.zip, repo-name.zip, repo_name.zip, etc.).
 * If nothing matches, we fall back to GOLDEN_REPO_ZIP_PATH.
 */
const GOLDEN_REPO_ZIP_PATH =
  process.env.GOLDEN_REPO_ZIP_PATH ??
  path.join(process.cwd(), "attached_assets", "Golden_Insurance_Repo_1761897344922.zip");

const GOLDEN_REPO_ZIP_DIR =
  process.env.GOLDEN_REPO_ZIP_DIR ?? path.join(process.cwd(), "attached_assets");

/** Normalize path for adm-zip: use forward slashes and resolve to absolute (avoids "Invalid filename" on Windows). */
function normalizedZipPath(rawPath: string): string {
  const resolved = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  return resolved.replace(/\\/g, "/");
}

export class GoldenRepositoryService {
  /**
   * Resolve the ZIP file path for a given golden repo.
   *
   * Resolution strategy (in order):
   * 1. If GOLDEN_REPO_ZIP_DIR is set, look for:
   *    - <repoId>.zip
   *    - <repoName>.zip
   *    - repoName with spaces→'_' or '-' plus ".zip"
   *    - lowercased variants of the above
   * 2. If nothing is found, fall back to legacy GOLDEN_REPO_ZIP_PATH.
   */
  private async resolveZipPathForRepo(repoId: string): Promise<string> {
    // If directory-based config is not set, just use the legacy single-zip path.
    if (!GOLDEN_REPO_ZIP_DIR) {
      return normalizedZipPath(GOLDEN_REPO_ZIP_PATH);
    }

    const candidates: string[] = [];

    // Try by repoId first (most robust; independent of name changes)
    if (repoId) {
      candidates.push(path.join(GOLDEN_REPO_ZIP_DIR, `${repoId}.zip`));
    }

    // Try by repo.name from goldenRepositories table
    try {
      const repo = await this.getRepositoryById(repoId);
      const rawName = repo?.name?.toString().trim();
      if (rawName) {
        const baseNames = new Set<string>();
        baseNames.add(rawName);
        baseNames.add(rawName.replace(/\s+/g, "_"));
        baseNames.add(rawName.replace(/\s+/g, "-"));
        baseNames.add(rawName.replace(/[_-]+/g, " "));

        for (const name of baseNames) {
          const trimmed = name.trim();
          if (!trimmed) continue;
          candidates.push(path.join(GOLDEN_REPO_ZIP_DIR, `${trimmed}.zip`));
          candidates.push(path.join(GOLDEN_REPO_ZIP_DIR, `${trimmed.toLowerCase()}.zip`));
        }
      }
    } catch {
      // If repo lookup fails, just fall back to candidates we already have
    }

    // Add legacy single-zip path as last resort
    candidates.push(GOLDEN_REPO_ZIP_PATH);

    for (const candidate of candidates) {
      try {
        const resolved = normalizedZipPath(candidate);
        await fs.access(resolved);
        return resolved;
      } catch {
        continue;
      }
    }

    // If nothing exists, throw a clear error with all attempted paths
    throw new Error(
      `[GoldenRepo] No matching ZIP found for repoId=${repoId}. Tried: ${candidates
        .map((c) => normalizedZipPath(c))
        .join(", ")}`
    );
  }
  async getAllRepositories(): Promise<GoldenRepository[]> {
    return await db.select().from(goldenRepositories);
  }

  async getRepositoriesByDomain(domain: string): Promise<GoldenRepository[]> {
    return await db.select().from(goldenRepositories).where(eq(goldenRepositories.domain, domain));
  }

  async getRepositoryById(id: string): Promise<GoldenRepository | undefined> {
    const result = await db.select().from(goldenRepositories).where(eq(goldenRepositories.id, id));
    return result[0];
  }

  async createRepository(data: InsertGoldenRepository): Promise<GoldenRepository> {
    const id = randomUUID();
    await db.insert(goldenRepositories).values({ ...data, id } as any);
    const inserted = await db.select().from(goldenRepositories).where(eq(goldenRepositories.id, id)).limit(1);
    if (!inserted[0]) {
      throw new Error("Failed to create repository");
    }
    return inserted[0];
  }

  async updateRepository(id: string, data: Partial<InsertGoldenRepository>): Promise<GoldenRepository> {
    await db
      .update(goldenRepositories)
      .set({ ...data, updatedAt: new Date() } as any)
      .where(eq(goldenRepositories.id, id));
    const updated = await db.select().from(goldenRepositories).where(eq(goldenRepositories.id, id)).limit(1);
    if (!updated[0]) {
      throw new Error("Repository not found");
    }
    return updated[0];
  }

  async deleteRepository(id: string): Promise<void> {
    await db.delete(goldenRepositories).where(eq(goldenRepositories.id, id));
  }

  async seedInitialData(): Promise<void> {
    const existing = await this.getAllRepositories();
    if (existing.length > 0) {
      return; // Already seeded
    }

    const seedData: InsertGoldenRepository[] = [
      // Insurance Domain
      {
        name: "insurance-claims-management",
        description: "Complete claims processing system with automation, fraud detection, and customer portal",
        technologies: ["React", "Node.js", "PostgreSQL", "ML"],
        stars: 421,
        cloudProvider: "azure",
        category: "fullstack",
        domain: "insurance",
        repositoryUrl: "https://dev.azure.com/insurance/claims-management",
      },
      {
        name: "policy-admin-system",
        description: "Comprehensive policy administration with underwriting, billing, and compliance features",
        technologies: ["Next.js", "TypeScript", "MongoDB"],
        stars: 365,
        cloudProvider: "github",
        category: "fullstack",
        domain: "insurance",
        repositoryUrl: "https://github.com/insurance/policy-admin",
      },
      {
        name: "insurance-customer-portal",
        description: "Self-service portal for policy holders with quotes, claims tracking, and document management",
        technologies: ["React", "Express", "PostgreSQL"],
        stars: 289,
        cloudProvider: "azure",
        category: "frontend",
        domain: "insurance",
        repositoryUrl: "https://dev.azure.com/insurance/customer-portal",
      },
      {
        name: "underwriting-engine",
        description: "AI-powered risk assessment and underwriting decision engine with integration APIs",
        technologies: ["Python", "FastAPI", "TensorFlow"],
        stars: 512,
        cloudProvider: "aws",
        category: "backend",
        domain: "insurance",
        repositoryUrl: "https://github.com/insurance/underwriting-engine",
      },

      // Retail Domain
      {
        name: "ecommerce-platform",
        description: "Full-featured ecommerce platform with shopping cart, payments, and inventory management",
        technologies: ["Next.js", "Stripe", "PostgreSQL"],
        stars: 678,
        cloudProvider: "github",
        category: "fullstack",
        domain: "retail",
        repositoryUrl: "https://github.com/retail/ecommerce-platform",
      },
      {
        name: "pos-system",
        description: "Modern point-of-sale system with inventory tracking, analytics, and multi-location support",
        technologies: ["React", "Node.js", "MongoDB"],
        stars: 445,
        cloudProvider: "azure",
        category: "fullstack",
        domain: "retail",
        repositoryUrl: "https://dev.azure.com/retail/pos-system",
      },
      {
        name: "retail-analytics-dashboard",
        description: "Real-time sales analytics with customer insights, inventory forecasting, and reporting",
        technologies: ["React", "Python", "BigQuery"],
        stars: 332,
        cloudProvider: "github",
        category: "frontend",
        domain: "retail",
        repositoryUrl: "https://github.com/retail/analytics-dashboard",
      },
      {
        name: "inventory-management-api",
        description: "RESTful API for inventory control, warehouse management, and supplier integration",
        technologies: ["Node.js", "Express", "PostgreSQL"],
        stars: 298,
        cloudProvider: "aws",
        category: "backend",
        domain: "retail",
        repositoryUrl: "https://github.com/retail/inventory-api",
      },

      // Healthcare Domain
      {
        name: "ehr-system",
        description: "Electronic health records system with patient management, appointments, and HIPAA compliance",
        technologies: ["React", "Node.js", "PostgreSQL"],
        stars: 589,
        cloudProvider: "azure",
        category: "fullstack",
        domain: "healthcare",
        repositoryUrl: "https://dev.azure.com/healthcare/ehr-system",
      },
      {
        name: "telemedicine-platform",
        description: "Video consultation platform with scheduling, prescriptions, and medical record integration",
        technologies: ["Next.js", "WebRTC", "MongoDB"],
        stars: 467,
        cloudProvider: "github",
        category: "fullstack",
        domain: "healthcare",
        repositoryUrl: "https://github.com/healthcare/telemedicine",
      },
      {
        name: "patient-portal",
        description: "Patient-facing portal for appointments, lab results, billing, and messaging with providers",
        technologies: ["React", "TypeScript", "GraphQL"],
        stars: 398,
        cloudProvider: "azure",
        category: "frontend",
        domain: "healthcare",
        repositoryUrl: "https://dev.azure.com/healthcare/patient-portal",
      },
      {
        name: "medical-imaging-api",
        description: "DICOM image processing and storage API with AI-powered diagnostic assistance",
        technologies: ["Python", "FastAPI", "PyTorch"],
        stars: 521,
        cloudProvider: "aws",
        category: "backend",
        domain: "healthcare",
        repositoryUrl: "https://github.com/healthcare/imaging-api",
      },

      // Manufacturing Domain
      {
        name: "mes-platform",
        description: "Manufacturing execution system with production tracking, quality control, and equipment monitoring",
        technologies: ["React", "Node.js", "TimescaleDB"],
        stars: 445,
        cloudProvider: "azure",
        category: "fullstack",
        domain: "manufacturing",
        repositoryUrl: "https://dev.azure.com/manufacturing/mes-platform",
      },
      {
        name: "iot-device-management",
        description: "IoT platform for industrial equipment monitoring, predictive maintenance, and data collection",
        technologies: ["Next.js", "MQTT", "InfluxDB"],
        stars: 512,
        cloudProvider: "aws",
        category: "fullstack",
        domain: "manufacturing",
        repositoryUrl: "https://github.com/manufacturing/iot-platform",
      },
      {
        name: "production-dashboard",
        description: "Real-time production monitoring with KPIs, downtime tracking, and efficiency metrics",
        technologies: ["React", "TypeScript", "Grafana"],
        stars: 367,
        cloudProvider: "github",
        category: "frontend",
        domain: "manufacturing",
        repositoryUrl: "https://github.com/manufacturing/dashboard",
      },
      {
        name: "quality-control-api",
        description: "Quality assurance API with inspection workflows, defect tracking, and statistical analysis",
        technologies: ["Python", "FastAPI", "PostgreSQL"],
        stars: 289,
        cloudProvider: "azure",
        category: "backend",
        domain: "manufacturing",
        repositoryUrl: "https://dev.azure.com/manufacturing/quality-api",
      },

      // Finance Domain
      {
        name: "banking-platform",
        description: "Digital banking platform with accounts, transactions, and compliance features",
        technologies: ["Next.js", "Node.js", "PostgreSQL"],
        stars: 623,
        cloudProvider: "azure",
        category: "fullstack",
        domain: "finance",
        repositoryUrl: "https://dev.azure.com/finance/banking-platform",
      },
      {
        name: "trading-system",
        description: "Stock trading platform with real-time quotes, portfolio management, and order execution",
        technologies: ["React", "WebSocket", "MongoDB"],
        stars: 578,
        cloudProvider: "github",
        category: "fullstack",
        domain: "finance",
        repositoryUrl: "https://github.com/finance/trading-system",
      },
      {
        name: "fintech-dashboard",
        description: "Financial analytics dashboard with investments, budgeting, and wealth management tools",
        technologies: ["React", "TypeScript", "D3.js"],
        stars: 445,
        cloudProvider: "github",
        category: "frontend",
        domain: "finance",
        repositoryUrl: "https://github.com/finance/dashboard",
      },
      {
        name: "payment-gateway-api",
        description: "Payment processing API with multi-currency support, fraud prevention, and PCI compliance",
        technologies: ["Node.js", "Express", "Redis"],
        stars: 512,
        cloudProvider: "aws",
        category: "backend",
        domain: "finance",
        repositoryUrl: "https://github.com/finance/payment-gateway",
      },
    ];

    for (const repo of seedData) {
      await this.createRepository(repo);
    }
  }

  // Helper method to build file tree from entries
  private buildTreeFromEntries(entries: any[], basePath: string = ""): any {
    const tree: any = {
      name: "root",
      type: "folder",
      path: "",
      children: [],
    };

    entries.forEach((entry: any) => {
      if (entry.isDirectory) return; // Skip directories, we'll infer them from files

      const parts = entry.entryName.split("/").filter((p: string) => p);
      let current = tree;

      parts.forEach((part: string, index: number) => {
        const isFile = index === parts.length - 1;
        const currentPath = parts.slice(0, index + 1).join("/");

        let existing = current.children.find((c: any) => c.name === part);

        if (!existing) {
          existing = {
            name: part,
            type: isFile ? "file" : "folder",
            path: currentPath,
            children: isFile ? undefined : [],
            size: isFile ? entry.header.size : undefined,
          };
          current.children.push(existing);
        }

        if (!isFile) {
          current = existing;
        }
      });
    });

    // Sort: folders first, then files, both alphabetically
    const sortTree = (node: any) => {
      if (node.children) {
        node.children.sort((a: any, b: any) => {
          if (a.type === b.type) {
            return a.name.localeCompare(b.name);
          }
          return a.type === "folder" ? -1 : 1;
        });
        node.children.forEach(sortTree);
      }
    };

    sortTree(tree);
    return tree;
  }

  // Helper method to build tree from directory structure
  private async buildTreeFromDirectory(dirPath: string, rootName: string = "root"): Promise<any> {
    const tree: any = {
      name: rootName,
      type: "folder",
      path: "",
      children: [],
    };

    const buildNode = async (currentPath: string, relativePath: string = ""): Promise<any> => {
      const stats = await fs.stat(currentPath);
      const name = path.basename(currentPath);

      if (stats.isDirectory()) {
        const children: any[] = [];
        const entries = await fs.readdir(currentPath);

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry);
          const newRelativePath = relativePath ? `${relativePath}/${entry}` : entry;
          const child = await buildNode(fullPath, newRelativePath);
          children.push(child);
        }

        // Sort: folders first, then files, both alphabetically
        children.sort((a: any, b: any) => {
          if (a.type === b.type) {
            return a.name.localeCompare(b.name);
          }
          return a.type === "folder" ? -1 : 1;
        });

        return {
          name,
          type: "folder",
          path: relativePath,
          children,
        };
      } else {
        return {
          name,
          type: "file",
          path: relativePath,
          size: stats.size,
        };
      }
    };

    const entries = await fs.readdir(dirPath);
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const child = await buildNode(fullPath, entry);
      tree.children.push(child);
    }

    // Sort root children
    tree.children.sort((a: any, b: any) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }
      return a.type === "folder" ? -1 : 1;
    });

    return tree;
  }

  // Extract file tree from zip file (repository only, starter code is now client-side)
  async extractFileTree(repoId: string): Promise<any> {
    const zipPath = normalizedZipPath(GOLDEN_REPO_ZIP_PATH);

    try {
      // Extract repository files
      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();
      const repositoryTree = this.buildTreeFromEntries(zipEntries);

      return {
        repository: repositoryTree,
        starterCode: null, // Client-side now handles starter code
      };
    } catch (error) {
      console.error("Error extracting file tree:", error);
      throw new Error("Failed to extract file tree");
    }
  }

  // Get file content from zip or starter code directory
  async getFileContent(repoId: string, filePath: string, source: string = "repository"): Promise<any> {
    const brdRagDebug = process.env.BRD_RAG_DEBUG === "true";
    if (brdRagDebug) {
      console.log("[BRD-RAG-DEBUG] getFileContent called", { repoId, filePath, source });
    }
    // Resolve the correct zip for this repo (per-repo when possible, fallback to legacy path)
    const zipPath = await this.resolveZipPathForRepo(repoId);
    const starterCodePath = path.join(process.cwd(), "attached_assets", "Starter_code");

    try {
      let content: string;
      let size: number;

      if (source === "starterCode") {
        // Read from starter code directory
        const fullPath = path.join(starterCodePath, filePath);
        const stats = await fs.stat(fullPath);
        content = await fs.readFile(fullPath, "utf8");
        size = stats.size;
      } else {
        // Read from repository zip
        let zip: InstanceType<typeof AdmZip>;
        try {
          zip = new AdmZip(zipPath);
        } catch (zipErr: any) {
          const msg = zipErr?.code === "ENOENT"
            ? `Zip file not found at ${zipPath}`
            : (zipErr instanceof Error ? zipErr.message : String(zipErr));
          console.error("[GoldenRepo] getFileContent zip load failed:", msg, "zipPath:", zipPath);
          throw new Error(`Zip not available: ${msg}`);
        }
        const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
        const normalizedPathLower = normalizedPath.toLowerCase();
        const basenameLower = path.basename(normalizedPath).toLowerCase();
        let entry = zip.getEntry(filePath) ?? zip.getEntry(normalizedPath);
        if (!entry) {
          const allEntries = zip.getEntries();
          entry = allEntries.find((e: any) => {
            const name = (e.entryName || "").replace(/\\/g, "/").replace(/^\/+/, "");
            const nameLower = name.toLowerCase();
            return name === normalizedPath
              || nameLower === normalizedPathLower
              || name.endsWith("/" + normalizedPath)
              || nameLower.endsWith("/" + normalizedPathLower)
              || nameLower.endsWith("/" + basenameLower);
          }) || null;
        }
        if (!entry) {
          const sampleNames = zip.getEntries().slice(0, 3).map((e: any) => e.entryName);
          console.warn("[GoldenRepo] getFileContent no match for path:", normalizedPath, "sample entry names:", sampleNames);
          if (brdRagDebug) {
            console.error("[BRD-RAG-DEBUG] File not found in zip", { filePath: normalizedPath, sampleEntryNames: sampleNames });
          }
          throw new Error(`File not found: ${filePath}`);
        }

        content = entry.getData().toString("utf8");
        size = entry.header.size;
        if (brdRagDebug) {
          console.log("[BRD-RAG-DEBUG] File read from zip", { path: normalizedPath, size, contentLength: content.length });
        }
      }

      const ext = path.extname(filePath).toLowerCase();

      // Determine language for syntax highlighting
      const languageMap: Record<string, string> = {
        ".js": "javascript",
        ".jsx": "javascript",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".py": "python",
        ".java": "java",
        ".c": "c",
        ".cpp": "cpp",
        ".cs": "csharp",
        ".go": "go",
        ".rs": "rust",
        ".rb": "ruby",
        ".php": "php",
        ".swift": "swift",
        ".kt": "kotlin",
        ".html": "html",
        ".css": "css",
        ".scss": "scss",
        ".json": "json",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".xml": "xml",
        ".md": "markdown",
        ".sh": "bash",
        ".sql": "sql",
        ".graphql": "graphql",
        ".dockerfile": "dockerfile",
        ".txt": "text",
      };

      return {
        path: filePath,
        name: path.basename(filePath),
        content,
        language: languageMap[ext] || "text",
        size,
      };
    } catch (error) {
      if (brdRagDebug) {
        console.error("[BRD-RAG-DEBUG] getFileContent failed", {
          repoId,
          filePath,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? (error.stack ?? "").slice(0, 400) : undefined,
        });
      }
      console.error("Error getting file content:", error);
      throw new Error(`Failed to get file content: ${filePath}`);
    }
  }

  // Download repository as ZIP
  async downloadRepository(repoId: string): Promise<Buffer> {
    // Get repo info
    const repo = await this.getRepositoryById(repoId);
    if (!repo) {
      throw new Error("Repository not found");
    }

    const zipPath = await this.resolveZipPathForRepo(repoId);

    const AdmZipLib = (await import("adm-zip")).default;

    // Build sanitized repo root name (remove trailing -main, _main, -main-*, etc.)
    let repoRootName = String(repo.name || 'repository')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[-_]main([-_].*)?$/i, ''); // Remove -main or _main and anything after

    console.log(`[downloadRepository] Original repo.name: "${repo.name}", Sanitized: "${repoRootName}"`);

    try {
      const originalZip = new AdmZipLib(zipPath);
      const entries = originalZip.getEntries();

      const newZip = new AdmZipLib();

      for (const entry of entries) {
        const entryName = entry.entryName.replace(/^\/+/, '');

        // Skip empty entries
        if (!entryName) continue;

        const parts = entryName.split('/').filter(p => p.length > 0);
        const rest = parts.join('/');
        const newName = rest ? `${repoRootName}/${rest}` : `${repoRootName}/`;

        if (entry.isDirectory) {
          const dirName = newName.endsWith('/') ? newName : `${newName}/`;
          newZip.addFile(dirName, Buffer.alloc(0));
        } else {
          const data = entry.getData();
          newZip.addFile(newName, data);
        }
      }

      const buffer = newZip.toBuffer();
      console.log(`[downloadRepository] Successfully created new zip with root: "${repoRootName}", size: ${buffer.length}`);
      return buffer;
    } catch (error) {
      console.error("Error repackaging repository zip:", error);
      console.log(`[downloadRepository] Falling back to original zip - ERROR: ${error instanceof Error ? error.message : String(error)}`);
      const data = await fs.readFile(zipPath);
      return data;
    }
  }
}

export const goldenRepoService = new GoldenRepositoryService();
