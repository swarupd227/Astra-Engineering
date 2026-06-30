/**
 * AI Configuration Logger
 * Logs which AI model and provider is configured at server startup (structured JSON).
 */
import { isAwsHosting, getHosting } from "./platform/hosting";
import { createLogger } from "./logger";

const aiConfigLogger = createLogger("ai-config");

export function logAIConfiguration(): void {
  const hosting = getHosting().toUpperCase();

  if (isAwsHosting()) {
    const modelId = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-opus-4-6-v1";
    const region = process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-1";
    const embeddingModelId =
      process.env.BEDROCK_EMBEDDING_MODEL_ID || "amazon.titan-embed-text-v2:0";
    const src = (key: string) => (process.env[key] ? "secrets" : "default");

    const dbHost = process.env.MYSQL_HOST || "(NOT SET)";
    const isRds = dbHost.includes(".rds.amazonaws.com");

    aiConfigLogger.info("ai_configuration", {
      hosting,
      provider: "aws_bedrock",
      chatModelId: modelId,
      chatModelSource: src("BEDROCK_MODEL_ID"),
      embeddingModelId,
      embeddingModelSource: src("BEDROCK_EMBEDDING_MODEL_ID"),
      bedrockRegion: region,
      bedrockRegionSource: src("BEDROCK_REGION"),
      databaseHost: dbHost,
      databaseIsRds: isRds,
      databaseName: process.env.MYSQL_DATABASE || "(NOT SET)",
      workItems: "jira_only",
      azureEmbeddingDeploymentIgnored: process.env.AZURE_EMBEDDING_DEPLOYMENT || null,
    });
    return;
  }

  if (process.env.ANTHROPIC_AZURE_ENDPOINT && process.env.ANTHROPIC_API_KEY) {
    aiConfigLogger.info("ai_configuration", {
      hosting,
      provider: "anthropic_azure",
      modelName: process.env.ANTHROPIC_MODEL_NAME || "claude-sonnet-4-5",
      modelVersion: process.env.ANTHROPIC_MODEL_VERSION || "unknown",
      endpoint: process.env.ANTHROPIC_AZURE_ENDPOINT,
    });
    return;
  }

  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
    aiConfigLogger.info("ai_configuration", {
      hosting,
      provider: "azure_openai",
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "unknown",
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-02-01",
    });
    return;
  }

  if (process.env.OPENAI_API_KEY) {
    aiConfigLogger.info("ai_configuration", {
      hosting,
      provider: "openai",
      modelName: "gpt-4o",
    });
    return;
  }

  if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    aiConfigLogger.info("ai_configuration", {
      hosting,
      provider: "replit_ai_integrations",
      baseUrl: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "not configured",
    });
    return;
  }

  aiConfigLogger.warn("ai_configuration_missing", {
    hosting,
    hint: "Set ANTHROPIC_AZURE_ENDPOINT+ANTHROPIC_API_KEY, AZURE_OPENAI_*, or OPENAI_API_KEY in .env",
  });
}
