import { playwrightService } from "./playwright-service";
import SwaggerParser from "swagger-parser";
import yaml from "js-yaml";
import type { OpenAPI } from "openapi-types";

export interface HarEntry {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody?: string;
  duration: number;
  capturedAt: string;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  summary?: string;
  parameters?: any[];
  requestBody?: any;
  responses?: Record<string, any>;
  tags?: string[];
}

export interface ApiDiscoveryResult {
  type: "har_capture" | "swagger_import";
  sourceUrl: string;
  endpoints: ApiEndpoint[];
  harEntries?: HarEntry[];
  rawSpec?: any;
}

export async function captureHarFromUrl(
  targetUrl: string,
  durationMs: number = 10000,
  contextId: string,
  onProgress?: (msg: string) => void
): Promise<ApiDiscoveryResult> {
  const context = await playwrightService.getOrCreateContext(contextId);
  const page = await context.newPage();
  const harEntries: HarEntry[] = [];

  page.on("request", (req) => {
    const resourceType = req.resourceType();
    if (["fetch", "xhr", "document"].includes(resourceType)) {
      // will be matched with response below
    }
  });

  const requestMap = new Map<string, { startTime: number; request: any }>();

  page.on("request", (req) => {
    const resourceType = req.resourceType();
    if (["fetch", "xhr"].includes(resourceType)) {
      requestMap.set(req.url(), {
        startTime: Date.now(),
        request: req,
      });
    }
  });

  page.on("response", async (res) => {
    const req = res.request();
    const resourceType = req.resourceType();
    if (!["fetch", "xhr"].includes(resourceType)) return;

    const entry = requestMap.get(req.url());
    const duration = entry ? Date.now() - entry.startTime : 0;

    let responseBody: string | undefined;
    try {
      const contentType = res.headers()["content-type"] || "";
      if (contentType.includes("json")) {
        responseBody = await res.text();
      }
    } catch {
      // ignore
    }

    let requestBody: string | undefined;
    try {
      const postData = req.postData();
      if (postData) requestBody = postData;
    } catch {
      // ignore
    }

    const url = req.url();
    try {
      const parsed = new URL(url);
      harEntries.push({
        url,
        method: req.method(),
        requestHeaders: req.headers(),
        requestBody,
        statusCode: res.status(),
        responseHeaders: res.headers(),
        responseBody,
        duration,
        capturedAt: new Date().toISOString(),
      });
    } catch {
      // invalid URL, skip
    }
  });

  onProgress?.(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  onProgress?.(`Capturing API traffic for ${durationMs / 1000}s...`);
  await page.waitForTimeout(durationMs);
  await page.close();

  // Convert HAR entries to endpoints
  const endpointMap = new Map<string, ApiEndpoint>();
  for (const entry of harEntries) {
    try {
      const parsed = new URL(entry.url);
      const key = `${entry.method}:${parsed.pathname}`;
      if (!endpointMap.has(key)) {
        endpointMap.set(key, {
          method: entry.method,
          path: parsed.pathname,
          parameters: parsed.searchParams.size > 0
            ? Array.from(parsed.searchParams.keys()).map(k => ({ name: k, in: "query" }))
            : undefined,
        });
      }
    } catch {
      // skip
    }
  }

  return {
    type: "har_capture",
    sourceUrl: targetUrl,
    endpoints: Array.from(endpointMap.values()),
    harEntries,
  };
}

export async function importSwaggerSpec(
  specUrlOrContent: string,
  isUrl: boolean = true
): Promise<ApiDiscoveryResult> {
  let api: OpenAPI.Document;

  if (isUrl) {
    api = await SwaggerParser.parse(specUrlOrContent) as OpenAPI.Document;
  } else {
    const content = specUrlOrContent.trim();
    const parsed =
      content.startsWith("{") || content.startsWith("[")
        ? JSON.parse(content)
        : yaml.load(content);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid OpenAPI specification: could not parse content");
    }
    api = (await SwaggerParser.parse(parsed as object)) as OpenAPI.Document;
  }

  const endpoints: ApiEndpoint[] = [];

  // Handle OpenAPI 3.x and Swagger 2.x
  const paths = (api as any).paths || {};
  for (const [path, pathItem] of Object.entries(paths)) {
    const methods = ["get", "post", "put", "patch", "delete", "options", "head"];
    for (const method of methods) {
      const operation = (pathItem as any)?.[method];
      if (!operation) continue;
      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: operation.summary || operation.operationId,
        parameters: operation.parameters,
        requestBody: operation.requestBody,
        responses: operation.responses,
        tags: operation.tags,
      });
    }
  }

  return {
    type: "swagger_import",
    sourceUrl: isUrl ? specUrlOrContent : "inline",
    endpoints,
    rawSpec: api,
  };
}
