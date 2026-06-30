import ExcelJS from "exceljs";

export interface ApiTestExportCase {
  id: string;
  title: string;
  type: string;
  priority: string;
  description: string;
  preconditions: string[];
  steps: { action: string; expected: string }[];
  testData: Record<string, unknown>;
  assertions: string[];
  postmanScript?: string;
  readyApiGroovy?: string;
  playwrightScript?: string;
}

export interface ApiTestExportHeader {
  key: string;
  value: string;
  enabled: boolean;
}

export interface ApiTestExportQueryParam {
  key: string;
  value: string;
  enabled: boolean;
}

export interface ApiTestExportConfig {
  method: string;
  endpoint: string;
  baseUrl?: string;
  authType: string;
  authToken?: string;
  apiKey?: string;
  apiKeyHeader?: string;
  username?: string;
  password?: string;
  requestBody?: string;
}

const EXCEL_COLORS = {
  headerBg: "FF1F3864",
  headerFg: "FFFFFFFF",
  titleFg: "FF1F3864",
  functional: "FFE2EFDA",
  negative: "FFFCE4D6",
  security: "FFE4DFEC",
  performance: "FFFFF2CC",
  boundary: "FFDAEEF3",
  p0Bg: "FFC00000",
  p0Fg: "FFFFFFFF",
  p1Bg: "FFFFC000",
  p1Fg: "FF000000",
} as const;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadText(content: string, filename: string, mimeType: string) {
  downloadBlob(new Blob([content], { type: mimeType }), filename);
}

function downloadJson(data: unknown, filename: string) {
  downloadText(JSON.stringify(data, null, 2), filename, "application/json");
}

export function buildEffectiveUrl(
  endpoint: string,
  queryParams: ApiTestExportQueryParam[],
): string {
  let url = endpoint;
  const qs = queryParams
    .filter((p) => p.enabled && p.key && p.value)
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join("&");
  if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  return url;
}

function buildAuthHeaders(config: ApiTestExportConfig): Array<{ key: string; value: string }> {
  const headers: Array<{ key: string; value: string }> = [];
  if (config.authType === "bearer" && config.authToken) {
    headers.push({ key: "Authorization", value: `Bearer ${config.authToken}` });
  } else if (config.authType === "api-key" && config.apiKey) {
    headers.push({ key: config.apiKeyHeader || "X-API-Key", value: config.apiKey });
  } else if (config.authType === "basic" && config.username) {
    const creds = btoa(`${config.username}:${config.password ?? ""}`);
    headers.push({ key: "Authorization", value: `Basic ${creds}` });
  }
  return headers;
}

function formatTestSteps(steps: ApiTestExportCase["steps"]): string {
  return steps
    .map((step, index) => {
      const action = step.action.replace(/\s*Expected:\s*.*$/i, "").trim();
      const expected = step.expected.trim();
      return `${index + 1}. ${action}\nExpected: ${expected}`;
    })
    .join("\n\n");
}

function countTextLines(...parts: string[]): number {
  return parts.reduce((total, text) => total + text.split("\n").length, 0);
}

function estimateDataRowHeight(tc: ApiTestExportCase): number {
  const testStepsText = formatTestSteps(tc.steps);
  const preconditionsText = formatPreconditions(tc.preconditions);
  const assertionsText = formatAssertions(tc.assertions);
  const descriptionLines = Math.ceil(tc.description.length / 55);

  const lineCount = Math.max(
    countTextLines(testStepsText),
    countTextLines(preconditionsText),
    countTextLines(assertionsText),
    descriptionLines,
    4,
  );

  // ~15pt per line; cap Excel's max row height (409pt)
  return Math.min(409, lineCount * 15 + 12);
}

function formatPreconditions(preconditions: string[]): string {
  return preconditions.map((item) => `• ${item}`).join("\n");
}

function formatAssertions(assertions: string[]): string {
  return assertions.join("\n");
}

function resolveBaseUrl(config: ApiTestExportConfig): string {
  if (config.baseUrl?.trim()) return config.baseUrl.trim();
  try {
    const url = new URL(config.endpoint);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length >= 3) {
      return `${url.protocol}//${url.host}/${segments.slice(0, -2).join("/")}`;
    }
    if (segments.length >= 1) {
      return `${url.protocol}//${url.host}/${segments[0]}`;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return config.endpoint;
  }
}

function getTypeFill(type: string): string {
  const map: Record<string, string> = {
    functional: EXCEL_COLORS.functional,
    negative: EXCEL_COLORS.negative,
    security: EXCEL_COLORS.security,
    performance: EXCEL_COLORS.performance,
    boundary: EXCEL_COLORS.boundary,
  };
  return map[type.toLowerCase()] ?? "FFFFFFFF";
}

function applyHeaderStyle(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: EXCEL_COLORS.headerFg } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: EXCEL_COLORS.headerBg },
    };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  });
  row.height = 22;
}

function applyDataRowStyle(row: ExcelJS.Row, type: string) {
  const fillArgb = getTypeFill(type);
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: fillArgb },
    };
    cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
  });
}

function applyPriorityStyle(cell: ExcelJS.Cell, priority: string) {
  const normalized = priority.toUpperCase();
  if (normalized === "P0") {
    cell.font = { bold: true, color: { argb: EXCEL_COLORS.p0Fg } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: EXCEL_COLORS.p0Bg },
    };
    cell.alignment = { vertical: "top", horizontal: "center", wrapText: true };
    return;
  }
  if (normalized === "P1") {
    cell.font = { bold: true, color: { argb: EXCEL_COLORS.p1Fg } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: EXCEL_COLORS.p1Bg },
    };
    cell.alignment = { vertical: "top", horizontal: "center", wrapText: true };
  }
}

function defaultPostmanScript(testCase: ApiTestExportCase): string {
  return `pm.test("${testCase.id}: ${testCase.title}", function () {
    pm.response.to.have.status(200);
    pm.expect(pm.response.responseTime).to.be.below(5000);
});`;
}

function defaultReadyApiScript(testCase: ApiTestExportCase): string {
  return `import groovy.json.JsonSlurper

def response = context.response
assert response.statusCode == 200 : "${testCase.id} expected HTTP 200"
def json = new JsonSlurper().parseText(response.contentAsString)
log.info "${testCase.id}: ${testCase.title} — response received"`;
}

function stripPlaywrightImport(script: string): string {
  return script
    .replace(
      /^import\s+\{\s*test\s*,\s*expect\s*\}\s+from\s+['"]@playwright\/test['"];\s*\n?/gm,
      "",
    )
    .trim();
}

function defaultPlaywrightScript(
  testCase: ApiTestExportCase,
  config: ApiTestExportConfig,
  url: string,
): string {
  const body =
    ["POST", "PUT", "PATCH"].includes(config.method) && config.requestBody
      ? `, {\n    data: ${config.requestBody},\n  }`
      : "";
  return `test('${testCase.id}: ${testCase.title}', async ({ request }) => {
  const response = await request.${config.method.toLowerCase()}('${url}'${body});
  expect(response.status()).toBeLessThan(500);
});`;
}

function formatPlaywrightSection(
  testCase: ApiTestExportCase,
  config: ApiTestExportConfig,
  url: string,
): string {
  const script = stripPlaywrightImport(
    testCase.playwrightScript ?? defaultPlaywrightScript(testCase, config, url),
  );
  return [
    `// ── ${testCase.id}: ${testCase.title} ──`,
    "import { test, expect } from '@playwright/test';",
    "",
    script,
  ].join("\n");
}

export function exportApiTestsToJson(
  apiConfig: ApiTestExportConfig,
  testCases: ApiTestExportCase[],
) {
  downloadJson(
    {
      apiConfig,
      testCases,
      generatedAt: new Date().toISOString(),
    },
    `api-test-cases-${Date.now()}.json`,
  );
}

export async function exportApiTestsToExcel(
  apiConfig: ApiTestExportConfig,
  testCases: ApiTestExportCase[],
  queryParams: ApiTestExportQueryParam[] = [],
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Astra API Testing";
  workbook.created = new Date();

  // ── Sheet 1: Manual Test Cases ──────────────────────────────────────────
  const manualSheet = workbook.addWorksheet("Manual Test Cases");
  manualSheet.columns = [
    { header: "TC ID", key: "tcId", width: 18 },
    { header: "Title", key: "title", width: 42 },
    { header: "Type", key: "type", width: 14 },
    { header: "Priority", key: "priority", width: 10 },
    { header: "Description", key: "description", width: 48 },
    { header: "Preconditions", key: "preconditions", width: 28 },
    { header: "Test Steps", key: "testSteps", width: 52 },
    { header: "Assertions", key: "assertions", width: 44 },
  ];

  applyHeaderStyle(manualSheet.getRow(1));
  manualSheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const tc of testCases) {
    const row = manualSheet.addRow({
      tcId: tc.id,
      title: tc.title,
      type: tc.type.toUpperCase(),
      priority: tc.priority.toUpperCase(),
      description: tc.description,
      preconditions: formatPreconditions(tc.preconditions),
      testSteps: formatTestSteps(tc.steps),
      assertions: formatAssertions(tc.assertions),
    });
    applyDataRowStyle(row, tc.type);
    applyPriorityStyle(row.getCell(4), tc.priority);

    // Ensure multiline cells render with explicit wrap on content-heavy columns
    const multilineCols = [5, 6, 7, 8];
    for (const col of multilineCols) {
      const cell = row.getCell(col);
      cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    }

    row.height = estimateDataRowHeight(tc);
  }

  if (testCases.length > 0) {
    manualSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: testCases.length + 1, column: 8 },
    };
  }

  // ── Sheet 2: Summary ────────────────────────────────────────────────────
  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.getColumn(1).width = 22;
  summarySheet.getColumn(2).width = 58;

  const titleCell = summarySheet.getCell("A1");
  titleCell.value = "API Testing Report — NAT 2.0";
  titleCell.font = { bold: true, size: 14, color: { argb: EXCEL_COLORS.titleFg } };

  const generatedAt = new Date().toLocaleString();
  const metadata: Array<[string, string]> = [
    ["Endpoint", buildEffectiveUrl(apiConfig.endpoint, queryParams)],
    ["Method", apiConfig.method.toUpperCase()],
    ["Base URL", resolveBaseUrl(apiConfig)],
    ["Generated", generatedAt],
  ];

  metadata.forEach(([label, value], index) => {
    const rowNum = index + 3;
    const labelCell = summarySheet.getCell(`A${rowNum}`);
    const valueCell = summarySheet.getCell(`B${rowNum}`);
    labelCell.value = label;
    labelCell.font = { bold: true };
    valueCell.value = value;
    labelCell.alignment = { vertical: "middle", horizontal: "left" };
    valueCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  });

  const categoryHeaderRow = summarySheet.getRow(8);
  categoryHeaderRow.getCell(1).value = "Category";
  categoryHeaderRow.getCell(2).value = "Count";
  applyHeaderStyle(categoryHeaderRow);

  const categories = ["functional", "negative", "security", "performance", "boundary"] as const;
  const counts = categories.map((cat) => ({
    label: cat.charAt(0).toUpperCase() + cat.slice(1),
    count: testCases.filter((tc) => tc.type.toLowerCase() === cat).length,
  }));

  counts.forEach(({ label, count }, index) => {
    const row = summarySheet.getRow(9 + index);
    row.getCell(1).value = label;
    row.getCell(2).value = count;
    row.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    row.getCell(2).alignment = { vertical: "middle", horizontal: "right" };
  });

  const totalRow = summarySheet.getRow(15);
  totalRow.getCell(1).value = "Total Test Cases";
  totalRow.getCell(2).value = testCases.length;
  totalRow.getCell(1).font = { bold: true };
  totalRow.getCell(2).font = { bold: true };
  totalRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
  totalRow.getCell(2).alignment = { vertical: "middle", horizontal: "right" };

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `api-testing-report-${new Date().toISOString().split("T")[0]}.xlsx`,
  );
}

export function exportApiTestsToPostman(
  apiConfig: ApiTestExportConfig,
  testCases: ApiTestExportCase[],
  headers: ApiTestExportHeader[],
  queryParams: ApiTestExportQueryParam[],
) {
  const requestUrl = buildEffectiveUrl(apiConfig.endpoint, queryParams);
  const requestHeaders = [
    ...headers.filter((h) => h.enabled && h.key && h.value).map((h) => ({ key: h.key, value: h.value })),
    ...buildAuthHeaders(apiConfig),
    { key: "Accept", value: "application/json" },
  ];

  const uniqueHeaders = Array.from(
    new Map(requestHeaders.map((h) => [h.key.toLowerCase(), h])).values(),
  );

  const collection = {
    info: {
      name: `API Tests — ${apiConfig.method} ${apiConfig.endpoint}`,
      description: `Generated by Astra API Testing (${testCases.length} test cases)`,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: testCases.map((tc) => ({
      name: `${tc.id}: ${tc.title}`,
      request: {
        method: apiConfig.method,
        header: uniqueHeaders.map((h) => ({ key: h.key, value: h.value, type: "text" })),
        body:
          ["POST", "PUT", "PATCH"].includes(apiConfig.method) && apiConfig.requestBody
            ? { mode: "raw", raw: apiConfig.requestBody, options: { raw: { language: "json" } } }
            : undefined,
        url: requestUrl,
        description: `${tc.description}\n\nAssertions:\n${tc.assertions.map((a) => `• ${a}`).join("\n")}`,
      },
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: (tc.postmanScript ?? defaultPostmanScript(tc))
              .split("\n")
              .map((line) => line.trimEnd()),
          },
        },
      ],
    })),
  };

  downloadJson(collection, `api-tests-postman-${Date.now()}.json`);
}

export function exportApiTestsToReadyApi(
  apiConfig: ApiTestExportConfig,
  testCases: ApiTestExportCase[],
  queryParams: ApiTestExportQueryParam[],
) {
  const requestUrl = buildEffectiveUrl(apiConfig.endpoint, queryParams);
  const generatedAt = new Date().toLocaleString();

  const header = [
    "// NAT 2.0 — ReadyAPI Groovy Test Scripts",
    `// Generated: ${generatedAt}`,
    `// Endpoint: ${requestUrl}`,
    "",
    "",
  ].join("\n");

  const scripts = testCases
    .map((tc) => {
      const script = (tc.readyApiGroovy ?? defaultReadyApiScript(tc)).trim();
      return `// ── ${tc.id}: ${tc.title} ──\n${script}`;
    })
    .join("\n\n\n");

  const content = `${header}${scripts}\n`;
  downloadText(content, `api-tests-readyapi-${Date.now()}.groovy`, "text/x-groovy");
}

export function exportApiTestsToPlaywright(
  apiConfig: ApiTestExportConfig,
  testCases: ApiTestExportCase[],
  queryParams: ApiTestExportQueryParam[],
) {
  const requestUrl = buildEffectiveUrl(apiConfig.endpoint, queryParams);
  const generatedAt = new Date().toLocaleString();

  const header = [
    "// NAT 2.0 — Playwright API Test Scripts",
    `// Generated: ${generatedAt}`,
    `// Endpoint: ${requestUrl}`,
    "import { test, expect } from '@playwright/test';",
    "",
    "",
  ].join("\n");

  const sections = testCases
    .map((tc) => formatPlaywrightSection(tc, apiConfig, requestUrl))
    .join("\n\n\n");

  downloadText(`${header}${sections}\n`, `api-tests-playwright-${Date.now()}.spec.ts`, "text/typescript");
}
