import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

let _derivedKey: Buffer | undefined;

/**
 * Lazily derive the AES key from SESSION_SECRET on first use.
 *
 * Reading SESSION_SECRET at module-load time was breaking AWS hosting
 * mode: server/index.ts statically imports the QE module chain, so this
 * file evaluates BEFORE loadSecrets() injects SESSION_SECRET from
 * AWS Secrets Manager. The eager throw aborted the whole process before
 * any secret-fetching code could run. Deferring the check until first
 * encrypt/decrypt call lets the value arrive via .env (azure mode) or
 * Secrets Manager (aws mode) before it's needed.
 *
 * Caches the derived key so repeated PAT operations don't pay the
 * scrypt cost on every call.
 */
function getKey(): Buffer {
  if (_derivedKey) return _derivedKey;
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required for PAT encryption");
  }
  _derivedKey = crypto.scryptSync(secret, "salt", 32);
  return _derivedKey;
}

export function encryptPAT(pat: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(pat, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted;
}

export function decryptPAT(encryptedData: string): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
