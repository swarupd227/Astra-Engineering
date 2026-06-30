import rateLimit, { type Options } from "express-rate-limit";
import type { Request } from "express";

interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

/**
 * Key generator: use authenticated user ID for per-user rate limiting,
 * fall back to the default IP-based key generator for unauthenticated requests.
 */
function userOrIpKey(req: AuthenticatedRequest, _res: any): string {
  return (req as AuthenticatedRequest).user?.id || rateLimit.defaultKeyGenerator(req as any, _res);
}

/**
 * Standard rate limiter for all authenticated API routes.
 * 200 requests per minute per user.
 */
export const standardApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  keyGenerator: userOrIpKey as Options["keyGenerator"],
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too Many Requests",
    message: "Rate limit exceeded. Please try again shortly.",
  },
});

/**
 * Stricter rate limiter for AI generation endpoints.
 * These are expensive (LLM API calls) and should be throttled.
 * 10 requests per minute per user.
 */
export const generationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: userOrIpKey as Options["keyGenerator"],
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too Many Requests",
    message: "Generation rate limit exceeded. Please wait before generating more content.",
  },
});

/**
 * Auth endpoint rate limiter (login/bootstrap).
 * Prevents brute-force and abuse.
 * 30 requests per minute per IP.
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too Many Requests",
    message: "Too many authentication attempts. Please try again later.",
  },
});
