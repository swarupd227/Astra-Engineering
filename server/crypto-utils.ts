import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// Get encryption key from environment - REQUIRED for security
const getEncryptionKey = (): Buffer => {
  const keyString = process.env.PAT_ENCRYPTION_KEY;
  
  if (!keyString) {
    throw new Error(
      "PAT_ENCRYPTION_KEY environment variable is required for PAT encryption. " +
      "Please set a secure encryption key (minimum 32 characters recommended)."
    );
  }
  
  // Derive a 32-byte key from the environment variable
  return scryptSync(keyString, 'salt', 32);
};

/**
 * Validates that encryption configuration is properly set up
 * Should be called at application startup
 * @returns true if encryption is properly configured, false otherwise
 */
export function validateEncryptionSetup(): boolean {
  try {
    getEncryptionKey();
    console.log("[Crypto] PAT encryption key validated successfully");
    return true;
  } catch (error) {
    console.warn("[Crypto] WARNING: PAT encryption not configured. Artifact organizations will be disabled.");
    console.warn("[Crypto] Set PAT_ENCRYPTION_KEY environment variable to enable this feature.");
    return false;
  }
}

/**
 * Checks if encryption is available
 */
export function isEncryptionAvailable(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypts a PAT token using AES-256-GCM
 * @param plaintext The PAT token to encrypt
 * @returns Encrypted token in format: iv:encryptedData:authTag (base64 encoded)
 */
export function encryptPAT(plaintext: string | null): string | null {
  if (!plaintext) return null;
  
  try {
    const key = getEncryptionKey();
    const iv = randomBytes(16); // Initialization vector
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    const authTag = cipher.getAuthTag();
    
    // Return as iv:encryptedData:authTag (all base64 encoded)
    return `${iv.toString('base64')}:${encrypted}:${authTag.toString('base64')}`;
  } catch (error) {
    console.error("[Crypto] Error encrypting PAT:", error);
    throw new Error("Failed to encrypt PAT token");
  }
}

/**
 * Decrypts a PAT token that was encrypted with encryptPAT
 * @param ciphertext Encrypted token in format: iv:encryptedData:authTag
 * @returns Decrypted PAT token
 */
export function decryptPAT(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  
  try {
    const key = getEncryptionKey();
    const parts = ciphertext.split(':');
    
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted PAT format");
    }
    
    const iv = Buffer.from(parts[0], 'base64');
    const encryptedData = parts[1];
    const authTag = Buffer.from(parts[2], 'base64');
    
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error("[Crypto] Error decrypting PAT:", error);
    throw new Error("Failed to decrypt PAT token");
  }
}

/**
 * Safely decrypts a PAT token or returns it as-is if it's plain text
 * This is useful for handling both encrypted and plain text PAT tokens
 */
export function safeDecryptPAT(patToken: string | null): string | null {
  if (!patToken) return null;
  
  // Check if the PAT token looks encrypted (has the format iv:encryptedData:authTag)
  const parts = patToken.split(':');
  
  // If it doesn't have 3 parts, it's likely plain text
  if (parts.length !== 3) {
    // console.log("[Crypto] PAT appears to be in plain text format");
    return patToken;
  }
  
  // Try to decrypt - if it fails, return as plain text
  try {
    return decryptPAT(patToken);
  } catch (error) {
    console.warn("[Crypto] Failed to decrypt PAT, treating as plain text:", error);
    return patToken;
  }
}