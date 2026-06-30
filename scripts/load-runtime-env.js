import dotenv from "dotenv";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const HOSTING_OVERRIDE_PREFIXES = [
  "MYSQL_",
  "AZURE_AD_",
  "DEVX_AUTH_MODE",
  "ADO_",
  "AZURE_OPENAI_",
  "AZURE_EMBEDDING_",
  "AZURE_API_KEY",
  "AZURE_ENDPOINT",
  "GITHUB_",
  "JIRA_",
  "CONFLUENCE_",
  "BEDROCK_",
  "S3_",
  "SESSION_SECRET",
  "PAT_ENCRYPTION_KEY",
  "ANTHROPIC_",
  "DEPLOYMENT_NAME",
];

function isEnabled(value) {
  return ["true", "1", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function isAwsSecretsMode() {
  return String(process.env.DEVX_HOSTING || "azure").trim().toLowerCase() === "aws" &&
    !isEnabled(process.env.DEVX_USE_LOCAL_DB);
}

function isHostingSpecificKey(key) {
  return HOSTING_OVERRIDE_PREFIXES.some((prefix) => key.startsWith(prefix) || key === prefix);
}

function isLocalDevMode() {
  const hostingKeysAlreadySet = HOSTING_OVERRIDE_PREFIXES.filter((prefix) =>
    Object.keys(process.env).some((key) => key.startsWith(prefix) || key === prefix),
  ).length;
  return hostingKeysAlreadySet >= 5;
}

function shouldLoadDotenv(dotenvOptions) {
  return dotenvOptions !== false;
}

/**
 * Loads local bootstrap env first, then overlays AWS Secrets Manager values
 * for hosting-specific keys when DEVX_HOSTING=aws and DEVX_USE_LOCAL_DB=false.
 *
 * MySQL settings should not need to live in .env in that mode.
 */
export async function loadRuntimeEnv(dotenvOptions = {}) {
  if (shouldLoadDotenv(dotenvOptions)) {
    dotenv.config(dotenvOptions);
  }

  if (!isAwsSecretsMode()) return;

  const secretName = process.env.AWS_SECRET_NAME || "devx/platform/qa";
  const region = process.env.AWS_REGION || "ap-south-1";
  const client = new SecretsManagerClient({ region });
  const localDev = isLocalDevMode();

  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretName }),
    );

    if (!response.SecretString) {
      console.warn(`[runtime-env] Secret "${secretName}" has no string value; keeping current env.`);
      return;
    }

    const secrets = JSON.parse(response.SecretString.replace(/^\uFEFF/, ""));

    for (const [key, value] of Object.entries(secrets)) {
      if (!process.env[key] || !localDev || isHostingSpecificKey(key)) {
        process.env[key] = String(value);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : "Unknown";
    console.warn(
      `[runtime-env] Could not load AWS Secrets Manager secret "${secretName}" in ${region}: [${name}] ${message}`,
    );
  }
}
