/**
 * Autonomous testing service: single entry point for routes.
 * Crawl → discover pages → extract DOM → generate test cases → generate Playwright → run tests.
 */

export type { StartCrawlBody, CrawlerModeConfig, AuthenticationConfig } from "./config";
export { CRAWLER_MODE_CONFIG } from "./config";
export { runCrawl, getCrawlProgress, getLiveView } from "./orchestrator";
export type { CrawlProgress, LiveViewResult } from "./orchestrator";
export { generateTestCasesForCrawlRun } from "./test-case-generator";
export type { GeneratedTestCase } from "./test-case-generator";
export { generatePlaywrightScriptForCrawlRun } from "./playwright-from-dom";
export { runTestsForCrawlRun } from "./test-runner";
