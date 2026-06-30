# Automated Test (Autonomous Testing) Routes

The API is registered via `registerAutomatedTestRoutes(app)` exported from `server/routes/automated-test.ts`, which is invoked from `server/index.ts` (so `routes.ts` is unchanged). No extra setup is needed for the connection.

## Migrations

Run in order:

```bash
npx tsx scripts/run-automated-test-migration.ts
npx tsx scripts/run-automated-test-cases-migration.ts
```

Or run the SQL manually: `migrations/manual/add-automated-test-tables.sql`, then `migrations/manual/add-automated-test-cases-scripts-runs.sql`.

Tables: `crawl_runs`, `automated_test_pages`, `page_dom_versions`, `page_forms`, `page_dom_elements`, `automated_test_cases`, `automated_test_scripts`, `automated_test_runs`, `automated_test_results`.

## Flow

1. **Start crawl** – `POST /api/automated-test/start-crawl` (discovers pages, extracts DOM).
2. **Generate test cases** – `POST /api/automated-test/generate-test-cases` (uses **LLM** when configured, else rule-based; creates DOM-TC-0001, …). Optional body: `{ crawlRunId, useLLM?: boolean }`.
3. **Generate scripts** – `POST /api/automated-test/generate-scripts` (uses **LLM** when configured, else template; builds Playwright spec from test cases + DOM locators). Optional body: `{ crawlRunId, useLLM?: boolean }`.
4. **Run tests** – `POST /api/automated-test/run-tests` (runs Playwright, stores results).
5. **Get results** – `GET /api/automated-test/test-results/:testRunId`.

## Troubleshooting: crawl not discovering pages

- **Check the server terminal** (where you run `npm run dev`). You should see logs like `[automated-test] Crawl started: ...`, `[automated-test] Browser launched...`, `[automated-test] Navigating to first page: <url>`. If the crawl fails, the error is logged and stored; the UI shows it in the Crawl Progress card and in a red "Crawl failed" card.
- **Puppeteer/Chromium:** The crawler uses Puppeteer. If the browser fails to launch (e.g. "Failed to launch the browser process"), set `PUPPETEER_EXECUTABLE_PATH` to your Chrome/Chromium executable (e.g. on Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe`).
- **First page fails:** If you see "First page failed to load", the server could not load the base URL (timeout, DNS, or the target blocking headless browsers). Try a simple public URL like `https://example.com`; if that also fails, the issue is likely Chromium or network from the server machine.

**LLM:** Test case and script generation use the repo’s configured LLM (`SELECTED_LLM` / Anthropic or Azure OpenAI). If no LLM is configured or the call fails, the flow falls back to rule-based test cases and template-based Playwright generation.
