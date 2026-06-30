import express, { type Express } from "express";
import fs from "fs";
import path from "path";

// Static asset requests (hashed JS/CSS chunks, fonts, images, source maps, …)
// must NEVER fall back to index.html. If they did, a missing/stale chunk would
// be answered with index.html (HTTP 200, text/html); the browser then tries to
// execute HTML as a JS module, the dynamic import() rejects, and libraries that
// lazy-load chunks at runtime (e.g. Mermaid: /assets/flowDiagram-*.js) break for
// every diagram. Returning a real 404 keeps the failure loud and recoverable
// (the client can surface a chunk-load error / prompt a reload) instead of
// silently serving HTML where JavaScript is expected.
const ASSET_FILE_PATTERN =
  /\.(js|mjs|css|map|json|wasm|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|ico|avif)$/i;

function isStaticAssetRequest(reqPath: string): boolean {
  return reqPath.startsWith("/assets/") || ASSET_FILE_PATTERN.test(reqPath);
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html only for SPA navigation requests.
  // BUT exclude API routes - they should be handled by the API routes registered earlier
  app.use("*", (req, res, next) => {
    // Don't serve index.html for API routes - let them fall through to 404 if not handled
    if (req.path.startsWith("/api/")) {
      return next();
    }

    // Missing static asset (e.g. a stale hashed chunk) → real 404, not index.html.
    // express.static already served any file that exists, so reaching here means
    // the file is genuinely absent.
    if (isStaticAssetRequest(req.path)) {
      res
        .status(404)
        .type("text/plain")
        .send(`Not found: ${req.path}`);
      return;
    }

    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
