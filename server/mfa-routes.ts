import { Express, Request, Response } from "express";
import { createHmac, randomBytes } from "crypto";
import QRCode from "qrcode";
import { db } from "./db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";

// Base32 alphabet used by TOTP (RFC 4648)
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let result = "";
  let bits = 0;
  let value = 0;
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32_CHARS[(value << (5 - bits)) & 31];
  return result;
}

function base32Decode(encoded: string): Buffer {
  const str = encoded.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of str) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function generateTotp(secret: string, timeStep = 30): string {
  const counter = Math.floor(Date.now() / 1000 / timeStep);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const key = base32Decode(secret);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

function verifyTotp(token: string, secret: string, windowSize = 1): boolean {
  // Check current window and ±windowSize steps to allow for clock skew
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -windowSize; i <= windowSize; i++) {
    const buf = Buffer.alloc(8);
    const step = counter + i;
    buf.writeUInt32BE(Math.floor(step / 0x100000000), 0);
    buf.writeUInt32BE(step >>> 0, 4);
    const key = base32Decode(secret);
    const hmac = createHmac("sha1", key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    const expected = String(code % 1_000_000).padStart(6, "0");
    if (expected === token) return true;
  }
  return false;
}


export function registerMfaRoutes(app: Express) {
  // Setup MFA
  app.post("/api/auth/mfa/setup", async (req: Request, res: Response) => {
    try {
      // Allow overriding userId for testing, otherwise safely extract from user obj
      const authUser = (req as any).user;
      const userId = authUser?.id || req.body.userId;

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized or missing userId" });
      }

      const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const user = userRows[0];
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const secret = generateTotpSecret();
      await db.update(users).set({ mfaSecret: secret }).where(eq(users.id, userId));

      const otpauth = `otpauth://totp/DevX_2.0:${encodeURIComponent(user.email)}?secret=${secret}&issuer=DevX_2.0`;
      const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

      res.json({
        secret: secret,
        qrCode: qrCodeDataUrl,
      });
    } catch (error) {
      console.error("MFA Setup Error:", error);
      res.status(500).json({ message: "Failed to setup MFA" });
    }
  });

  // Verify MFA
  app.post("/api/auth/mfa/verify", async (req: Request, res: Response) => {
    try {
      const { token, userId } = req.body;
      const actualUserId = (req as any).user?.id || userId;

      if (!actualUserId || !token) {
        return res.status(400).json({ message: "User ID and token are required" });
      }

      const userRows = await db.select().from(users).where(eq(users.id, actualUserId)).limit(1);
      const user = userRows[0];

      if (!user || !user.mfaSecret) {
        return res.status(400).json({ message: "MFA setup not initiated or user not found" });
      }

      const isValid = verifyTotp(token, user.mfaSecret);

      if (isValid) {
        await db.update(users).set({ isMfaEnabled: true }).where(eq(users.id, actualUserId));
        return res.json({ success: true, message: "MFA verified and enabled successfully" });
      } else {
        return res.status(401).json({ success: false, message: "Invalid MFA code" });
      }
    } catch (error) {
      console.error("MFA Verify Error:", error);
      return res.status(400).json({ message: "Failed to verify MFA code due to invalid format" });
    }
  });

  // DISABLING MFA Endpoint – keeps mfaSecret so user can re-enable without scanning QR again
  app.post("/api/auth/mfa/disable", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id || req.body?.userId;
      
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized or missing user ID" });
      }

      // Only flip the enabled flag; keep the secret so re-enable can skip QR scan
      await db.update(users).set({ isMfaEnabled: false }).where(eq(users.id, userId));
      return res.json({ success: true, message: "MFA disabled successfully" });
    } catch (error) {
      console.error("MFA Disable Error:", error);
      return res.status(500).json({ message: "Failed to disable MFA" });
    }
  });

  // RE-ENABLE MFA Endpoint – verifies OTP against existing secret (no QR scan needed)
  app.post("/api/auth/mfa/enable", async (req: Request, res: Response) => {
    try {
      const { token, userId } = req.body;
      const actualUserId = (req as any).user?.id || userId;

      if (!actualUserId || !token) {
        return res.status(400).json({ message: "User ID and token are required" });
      }

      const userRows = await db.select().from(users).where(eq(users.id, actualUserId)).limit(1);
      const user = userRows[0];

      if (!user || !user.mfaSecret) {
        return res.status(400).json({ message: "No MFA secret found. Please set up MFA first by scanning a QR code." });
      }

      if (user.isMfaEnabled) {
        return res.status(400).json({ message: "MFA is already enabled" });
      }

      const isValid = verifyTotp(token, user.mfaSecret);

      if (isValid) {
        await db.update(users).set({ isMfaEnabled: true }).where(eq(users.id, actualUserId));
        return res.json({ success: true, message: "MFA re-enabled successfully" });
      } else {
        return res.status(401).json({ success: false, message: "Invalid MFA code" });
      }
    } catch (error) {
      console.error("MFA Enable Error:", error);
      return res.status(400).json({ message: "Failed to re-enable MFA" });
    }
  });

  // MFA STATUS Endpoint – returns whether user has a stored secret and MFA enabled state
  app.get("/api/auth/mfa/status", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id || (req.query.userId as string);

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized or missing user ID" });
      }

      const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const user = userRows[0];

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      return res.json({
        isMfaEnabled: user.isMfaEnabled,
        hasMfaSecret: !!user.mfaSecret,
      });
    } catch (error) {
      console.error("MFA Status Error:", error);
      return res.status(500).json({ message: "Failed to get MFA status" });
    }
  });
}
