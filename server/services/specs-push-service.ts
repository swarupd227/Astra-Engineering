import { eq, inArray, and } from "drizzle-orm";
import { db } from "../db";
import { sdlcSpecsFiles } from "@shared/schema";
import { getGitStorage, type GitStorageOverrides } from "./git-storage-resolver";
import type { IGitStorage } from "./git-storage-interface";

export interface PushSpecsResult {
  success: boolean;
  pushedCount: number;
  failedCount: number;
  results: Array<{ path: string; status: "success" | "error" }>;
  error?: string;
}

function parseLegacyFileId(fileId: string): { featureId: number; fileType: "specs" | "requirements" | "tdd-tests" } | null {
  const match = /^feature-(-?\d+)-(specs|requirements|tdd-tests)$/.exec(fileId.trim());
  if (!match) return null;

  const featureId = Number(match[1]);
  if (!Number.isFinite(featureId)) return null;

  return {
    featureId,
    fileType: match[2] as "specs" | "requirements" | "tdd-tests",
  };
}

export class SpecsPushService {
  /**
   * Pushes specified generated specs files to the configured repository for a project.
   */
  async pushSpecsToRepo(
    projectId: string,
    fileIds: string[],
    options: {
      commitMessage?: string;
      basePath?: string;
      branch?: string;
      tenantId?: string | null;
      userId?: string;
      repoName?: string;
    } = {}
  ): Promise<PushSpecsResult> {
    try {
      if (!fileIds || fileIds.length === 0) {
        return {
          success: false,
          pushedCount: 0,
          failedCount: 0,
          results: [],
          error: "No file IDs provided",
        };
      }

      // 1. Fetch files from database
      let files = await db
        .select()
        .from(sdlcSpecsFiles)
        .where(
          and(
            eq(sdlcSpecsFiles.projectId, projectId),
            inArray(sdlcSpecsFiles.id, fileIds)
          )
        );

      console.log("[DEBUG PUSH SERVICE] projectId:", projectId);
      console.log("[DEBUG PUSH SERVICE] Looking for fileIds:", fileIds);
      console.log("[DEBUG PUSH SERVICE] Found files:", files.length);
      console.log("[DEBUG PUSH SERVICE] Found file IDs:", files.map(f => f.id));

      if (files.length === 0) {
        const legacyTargets = fileIds
          .map(parseLegacyFileId)
          .filter((target): target is NonNullable<typeof target> => Boolean(target));

        if (legacyTargets.length > 0) {
          const projectFiles = await db
            .select()
            .from(sdlcSpecsFiles)
            .where(eq(sdlcSpecsFiles.projectId, projectId));

          files = projectFiles.filter((file) =>
            legacyTargets.some(
              (target) => target.featureId === file.featureId && target.fileType === file.fileType,
            ),
          );

          console.log("[DEBUG PUSH SERVICE] Legacy ID fallback matched files:", files.map((f) => ({
            id: f.id,
            featureId: f.featureId,
            fileType: f.fileType,
          })));
        }
      }

      if (files.length === 0) {
        const pathTargets = fileIds
          .map((fileId) => fileId.trim())
          .filter((fileId) => fileId.includes("/") || fileId.endsWith(".md") || fileId.endsWith(".json") || fileId.endsWith(".sh"));

        if (pathTargets.length > 0) {
          files = await db
            .select()
            .from(sdlcSpecsFiles)
            .where(
              and(
                eq(sdlcSpecsFiles.projectId, projectId),
                inArray(sdlcSpecsFiles.path, pathTargets),
              )
            );

          console.log("[DEBUG PUSH SERVICE] Path fallback matched files:", files.map((f) => ({
            id: f.id,
            path: f.path,
          })));
        }
      }

      if (files.length === 0) {
        return {
          success: false,
          pushedCount: 0,
          failedCount: 0,
          results: [],
          error: "No files found in database for the provided IDs",
        };
      }

      const overrides: GitStorageOverrides = {};
      if (options.repoName?.trim()) overrides.repoName = options.repoName.trim();
      if (options.branch?.trim()) overrides.branch = options.branch.trim();
      if (options.userId) overrides.userId = options.userId;

      const storage: IGitStorage = await getGitStorage(
        projectId,
        undefined,
        undefined,
        undefined,
        options.tenantId,
        Object.keys(overrides).length > 0 ? overrides : undefined,
      );

      // 3. Prepare files for push. Stored file paths already include the base
      //    folder (e.g. "specs/<slug>/specs.md"), so dedupe against basePath to
      //    avoid double-prefixing (e.g. "specs/specs/<slug>/specs.md").
      const normalizedBase = String(options.basePath || "").replace(/^\/+|\/+$/g, "");
      const pushFiles = files.map((f) => {
        const filePath = f.path.replace(/^\/+/, "");
        const alreadyHasBase =
          !!normalizedBase &&
          (filePath === normalizedBase || filePath.startsWith(`${normalizedBase}/`));
        const fullPath =
          !normalizedBase || alreadyHasBase ? filePath : `${normalizedBase}/${filePath}`;
        return { path: fullPath, content: f.content };
      });

      // 4. Perform push. Paths are already fully-qualified above, so pass an
      //    empty basePath to the storage layer.
      const results = await storage.pushMultipleFiles(
        pushFiles,
        "",
        options.commitMessage || `Push generated SDLC specs for project ${projectId}`
      );

      // 5. Update push status in database for successful files
      const successfulPaths = results
        .filter((r) => r.status === "success")
        .map((r) => r.path);

      if (successfulPaths.length > 0) {
        const successfulFileIds = files
          .filter((f) => successfulPaths.includes(f.path))
          .map((f) => f.id);

        if (successfulFileIds.length > 0) {
          await db
            .update(sdlcSpecsFiles)
            .set({
              pushedToAdo: true, // We reuse this field for "pushed to repo" generically
              pushedToAdoAt: new Date(),
              updatedAt: new Date(),
            })
            .where(inArray(sdlcSpecsFiles.id, successfulFileIds));
        }
      }

      const pushedCount = results.filter((r) => r.status === "success").length;
      const failedCount = results.length - pushedCount;

      return {
        success: failedCount === 0,
        pushedCount,
        failedCount,
        results,
      };
    } catch (error: any) {
      console.error("[SpecsPushService] Failed to push specs:", error);
      return {
        success: false,
        pushedCount: 0,
        failedCount: 0,
        results: [],
        error: error.message || "Unknown error occurred during push",
      };
    }
  }
}
