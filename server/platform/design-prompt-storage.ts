import { BlobServiceClient } from "@azure/storage-blob";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { eq, desc, or } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { isAwsHosting } from "./hosting";

export type DesignPromptRecord = {
  id: string;
  prompt: string;
  status: string;
  createdAt: string;
  createdBy: string;
  projectId?: string;
  epic_ids?: string;
};

function getDesignStorageConnectionString(): string {
  return (
    process.env.AZURE_DESIGN_STORAGE_CONNECTION_STRING ||
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    ""
  );
}

function getDesignPromptsContainer(): string {
  return process.env.AZURE_DESIGN_CONTAINER_NAME || "project-design-prompts";
}

function getDesignPromptsS3Bucket(): string {
  return (
    process.env.DESIGN_PROMPTS_S3_BUCKET ||
    process.env.AWS_DESIGN_PROMPTS_BUCKET ||
    process.env.S3_DESIGN_BUCKET ||
    ""
  );
}

let _s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!_s3Client) {
    const region = process.env.AWS_REGION || process.env.BEDROCK_REGION || "us-east-1";
    _s3Client = new S3Client({ region });
  }
  return _s3Client;
}

async function buildPayload(record: DesignPromptRecord): Promise<Record<string, unknown>> {
  const { projectId, ...payloadBase } = record;
  const payload: Record<string, unknown> = { ...payloadBase };
  payload.guidelinesContent = null;

  if (projectId) {
    try {
      let latestGuidelines = await db
        .select({
          guidelinesContent: schema.designGuidelines.guidelinesContent,
          updatedAt: schema.designGuidelines.updatedAt,
        })
        .from(schema.designGuidelines)
        .where(eq(schema.designGuidelines.projectId, projectId))
        .orderBy(desc(schema.designGuidelines.updatedAt))
        .limit(1);

      if (latestGuidelines.length === 0) {
        const [sdlcProject] = await db
          .select({
            id: schema.sdlcProjects.id,
            externalProjectId: schema.sdlcProjects.projectId,
          })
          .from(schema.sdlcProjects)
          .where(
            or(
              eq(schema.sdlcProjects.id, projectId),
              eq(schema.sdlcProjects.projectId, projectId)
            )
          )
          .limit(1);

        if (sdlcProject) {
          const candidateIds = [sdlcProject.id, sdlcProject.externalProjectId].filter(
            Boolean
          ) as string[];

          for (const candidateId of candidateIds) {
            const rows = await db
              .select({
                guidelinesContent: schema.designGuidelines.guidelinesContent,
                updatedAt: schema.designGuidelines.updatedAt,
              })
              .from(schema.designGuidelines)
              .where(eq(schema.designGuidelines.projectId, candidateId))
              .orderBy(desc(schema.designGuidelines.updatedAt))
              .limit(1);

            if (rows.length > 0) {
              latestGuidelines = rows;
              console.log(
                "[Design Prompt] Fallback matched design_guidelines using candidate projectId",
                candidateId,
                "for original projectId",
                projectId
              );
              break;
            }
          }
        }
      }

      if (latestGuidelines.length > 0) {
        payload.guidelinesContent = latestGuidelines[0].guidelinesContent ?? null;
        console.log(
          "[Design Prompt] Attached guidelinesContent for projectId",
          projectId,
          "updatedAt",
          latestGuidelines[0].updatedAt
        );
      } else {
        console.log(
          "[Design Prompt] No design_guidelines rows found for projectId (after fallback attempts)",
          projectId
        );
      }
    } catch (guidelineError) {
      console.warn("[Design Prompt] Failed to attach design guidelines:", guidelineError);
    }
  }

  return payload;
}

/**
 * Persist design prompt JSON to Azure Blob or S3 based on DEVX_HOSTING.
 */
export async function enqueueDesignPrompt(record: DesignPromptRecord): Promise<void> {
  const objectName = `Arrived/${record.id}_${Date.now()}.json`;

  try {
    const payload = await buildPayload(record);
    const body = JSON.stringify(payload, null, 2);
    const buffer = Buffer.from(body, "utf8");

    if (isAwsHosting()) {
      const bucket = getDesignPromptsS3Bucket();
      if (!bucket) {
        console.warn(
          "[Design Prompt] No S3 bucket configured (checked DESIGN_PROMPTS_S3_BUCKET, AWS_DESIGN_PROMPTS_BUCKET, S3_DESIGN_BUCKET). Skipping S3 enqueue."
        );
        return;
      }
      console.log(`[Design Prompt] Using S3 bucket: ${bucket}`);

      const client = getS3Client();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectName,
          Body: buffer,
          ContentType: "application/json",
        })
      );
      console.log("[Design Prompt] Enqueued to S3:", objectName);
      return;
    }

    const connectionString = getDesignStorageConnectionString();
    if (!connectionString) {
      console.warn(
        "[Design Prompt] Azure storage connection string not configured; skipping enqueue."
      );
      return;
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(getDesignPromptsContainer());
    await containerClient.createIfNotExists();
    const blockBlobClient = containerClient.getBlockBlobClient(objectName);
    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: { blobContentType: "application/json" },
    });
    console.log("[Design Prompt] Enqueued to Azure Blob:", objectName);
  } catch (error) {
    console.error("[Design Prompt] Failed to enqueue:", error);
  }
}
