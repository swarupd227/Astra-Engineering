import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const SECRET_NAME = process.env.AWS_SECRET_NAME || "devx/platform/qa";
const REGION = process.env.AWS_REGION || "ap-south-1";

/**
 * Keys that are hosting-specific: when running locally with a .env file,
 * Secrets Manager values for these keys MUST overwrite any .env values so
 * the adapter switch between Azure and AWS is clean.
 *
 * Keys NOT in this list are only injected when they don't already exist
 * in process.env, allowing local .env overrides for dev-only settings
 * (e.g. USE_LOCAL_CODE_EXECUTION, CODE_EXECUTION_BASE_DIR).
 *
 * In production (no .env loaded), this distinction is moot — process.env
 * is nearly empty, so every SM key is effectively injected.
 */
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

function isHostingSpecificKey(key: string): boolean {
  return HOSTING_OVERRIDE_PREFIXES.some(
    (prefix) => key.startsWith(prefix) || key === prefix,
  );
}

function shouldPreserveLocalDbKey(key: string): boolean {
  const useLocalDb = ["true", "1", "yes", "on"].includes(
    String(process.env.DEVX_USE_LOCAL_DB || "").trim().toLowerCase(),
  );
  return useLocalDb && key.startsWith("MYSQL_");
}

/**
 * Detect whether a .env file was loaded by checking for a key that only
 * exists when dotenv has parsed a local file. NODE_ENV is set by the
 * npm script for local dev; in production systemd, it's also set.
 * A better heuristic: check for a key that is ONLY in .env and never
 * in SM or systemd, like CODE_EXECUTION_BASE_DIR, or simply count how
 * many HOSTING_OVERRIDE_PREFIXES keys are already set.
 */
function isLocalDevMode(): boolean {
  const hostingKeysAlreadySet = HOSTING_OVERRIDE_PREFIXES.filter((prefix) =>
    Object.keys(process.env).some((k) => k.startsWith(prefix) || k === prefix),
  ).length;
  // If 5+ hosting-prefix groups already have values, a .env was likely loaded
  return hostingKeysAlreadySet >= 5;
}

/**
 * Fetches secrets from AWS Secrets Manager and injects them into process.env.
 *
 * Two modes:
 *
 * 1. **Local dev** (.env loaded first by dotenv) — hosting-specific keys are
 *    overwritten so the adapter switch is clean; other keys are only injected
 *    if they don't already exist, preserving local-only dev overrides.
 *
 * 2. **Production EC2** (no .env, systemd provides only DEVX_HOSTING,
 *    AWS_REGION, AWS_SECRET_NAME) — process.env is nearly empty, so all
 *    SM values are injected. Auth is via IAM Instance Profile (no explicit
 *    AWS_ACCESS_KEY_ID needed).
 *
 * If Secrets Manager is unreachable the function logs a warning and returns
 * gracefully so the app can still boot from .env values alone (local dev).
 */
export async function loadSecrets(): Promise<void> {
  const client = new SecretsManagerClient({ region: REGION });
  const localDev = isLocalDevMode();

  console.log(
    `[SecretsLoader] Mode: ${localDev ? "local-dev (.env detected)" : "production (no .env)"}, ` +
    `secret: "${SECRET_NAME}", region: ${REGION}`,
  );

  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: SECRET_NAME }),
    );

    if (!response.SecretString) {
      console.warn(
        `[SecretsLoader] Secret "${SECRET_NAME}" exists but has no string value — skipping.`,
      );
      return;
    }

    const rawSecret = response.SecretString.replace(/^\uFEFF/, "");
    const secrets: Record<string, string> = JSON.parse(rawSecret);
    let injected = 0;
    let overwritten = 0;
    let skipped = 0;

    for (const [key, value] of Object.entries(secrets)) {
      if (shouldPreserveLocalDbKey(key)) {
        skipped++;
      } else if (!process.env[key]) {
        // Key doesn't exist yet — always inject
        process.env[key] = value;
        injected++;
      } else if (!localDev) {
        // Production: overwrite everything (the few systemd bootstrap vars
        // like DEVX_HOSTING and AWS_REGION won't be in SM anyway)
        process.env[key] = value;
        overwritten++;
      } else if (isHostingSpecificKey(key)) {
        // Local dev: overwrite hosting-specific keys so the adapter switch
        // picks up SM values instead of stale .env Azure values
        process.env[key] = value;
        overwritten++;
      } else {
        skipped++;
      }
    }

    console.log(
      `[SecretsLoader] Loaded ${Object.keys(secrets).length} keys from "${SECRET_NAME}" ` +
      `(${injected} injected, ${overwritten} overwritten, ${skipped} kept from .env).`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : "Unknown";
    console.warn(
      `[SecretsLoader] Could not fetch secrets from AWS Secrets Manager: [${errName}] ${message || "(empty error)"}`,
    );
    console.warn(
      `[SecretsLoader] The AWS SDK resolves credentials in this order: ` +
      `env vars (AWS_ACCESS_KEY_ID) → shared credentials file → EC2 Instance Profile (IMDS). ` +
      `Ensure at least one source is available.`,
    );
    if (localDev) {
      console.warn(
        `[SecretsLoader] Running in local-dev mode — the app will continue using .env values.`,
      );
    } else {
      console.error(
        `[SecretsLoader] FATAL: Running in production mode without .env — ` +
        `the app cannot start without Secrets Manager. Check IAM role, network, and secret name.`,
      );
    }
  }
}
