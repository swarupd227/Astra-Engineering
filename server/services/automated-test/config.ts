/**
 * Crawler configuration: modes (quick/complete), safety limits, timeouts, and auth.
 * Quick: fewer pages, shallow depth, for fast exploration / CI.
 * Complete: more pages, deeper, for full coverage.
 */

export type CrawlMode = "quick" | "complete";

export interface CrawlerModeConfig {
  maxPages: number;
  maxDepth: number;
  maxClicksPerPage: number;
  maxCrawlDurationMs: number;
  domWorkerPollIntervalMs: number;
  maxDomWorkerIterations: number;
  pageLoadTimeoutMs: number;
  domExtractionTimeoutMs: number;
}

export const CRAWLER_MODE_CONFIG: Record<CrawlMode, CrawlerModeConfig> = {
  quick: {
    maxPages: 15,
    maxDepth: 2,
    maxClicksPerPage: 50,
    maxCrawlDurationMs: 60 * 60 * 1000, // cap 1 hour
    domWorkerPollIntervalMs: 1000,
    maxDomWorkerIterations: 1000,
    pageLoadTimeoutMs: 2 * 60 * 1000, // 2 min
    domExtractionTimeoutMs: 60 * 1000, // 60s
  },
  complete: {
    maxPages: 500,
    maxDepth: 5,
    maxClicksPerPage: 150,
    maxCrawlDurationMs: 60 * 60 * 1000, // cap 1 hour
    domWorkerPollIntervalMs: 1000,
    maxDomWorkerIterations: 1000,
    pageLoadTimeoutMs: 2 * 60 * 1000,
    domExtractionTimeoutMs: 60 * 1000, // 60s
  },
};

export interface AuthenticationConfig {
  authUrl?: string;
  username?: string;
  password?: string;
}

export interface StartCrawlBody {
  baseUrl: string;
  environment?: string;
  userRole?: string;
  mode?: CrawlMode;
  authentication?: AuthenticationConfig;
  projectId?: string;
  organizationId?: string;
}
