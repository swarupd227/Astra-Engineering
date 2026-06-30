import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { type Server } from "http";
import { nanoid } from "nanoid";
import os from "os";
import { getModuleDir } from "./utils/module-paths";
import { createLogger } from "./logger";

// Pass our own import.meta.url so the helper resolves to *this* file's directory
// in dev (ESM/tsx). In the CJS bundle import.meta is rewritten to {} so the
// helper falls back to dirname(process.argv[1]) === /opt/devx/dist.
// @ts-ignore - import.meta is unavailable in CommonJS output, ignored intentionally
const __dirname = getModuleDir(import.meta?.url);

const expressLogger = createLogger("express");

export function log(message: string, source = "express") {
  if (source === "express") {
    expressLogger.info(message);
  } else {
    createLogger(source).info(message);
  }
}

export async function setupVite(app: Express, server: Server) {
  const { createServer: createViteServer, createLogger } = await import("vite");
  let viteConfig: any = {};
  try {
    const viteConfigPath = "../vite.config";
    viteConfig = await import(viteConfigPath + ".js").catch(() =>
      import(viteConfigPath).catch(() => ({}))
    );
  } catch (error) {
    console.warn("Could not load vite.config, using defaults:", error);
    viteConfig = {};
  }
  const viteLogger = createLogger();

  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const projectName = path.basename(path.resolve(__dirname, ".."));
  const cacheDir = path.join(os.tmpdir(), "vite-cache", projectName);

  let resolvedConfig: any = viteConfig.default ?? viteConfig;
  if (typeof resolvedConfig === "function") {
    resolvedConfig = await resolvedConfig();
  }

  const vite = await createViteServer({
    ...resolvedConfig,
    configFile: false,
    cacheDir,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  // ── QE Vite dev server ──────────────────────────────────────────────
  let qeVite: any = null;
  try {
    let qeConfig: any = {};
    try {
      const qeConfigPath = "../vite.config.qe";
      qeConfig = await import(qeConfigPath + ".js").catch(() =>
        import(qeConfigPath).catch(() => ({}))
      );
    } catch {
      qeConfig = {};
    }
    let resolvedQeConfig: any = qeConfig.default ?? qeConfig;
    if (typeof resolvedQeConfig === "function") {
      resolvedQeConfig = await resolvedQeConfig();
    }
    const qeCacheDir = path.join(os.tmpdir(), "vite-cache", projectName + "-qe");
    qeVite = await createViteServer({
      ...resolvedQeConfig,
      configFile: false,
      cacheDir: qeCacheDir,
      server: {
        middlewareMode: true,
        hmr: { server, path: "/qe/__vite_hmr" },
        allowedHosts: true as const,
      },
      appType: "custom",
    });
    log("QE Vite dev server created");
  } catch (err) {
    console.warn("[QE] Failed to create QE Vite dev server:", err);
  }

  // QE Vite middleware — must come before main Vite
  if (qeVite) {
    // Serve QE static assets (JS, CSS, HMR) via Vite middleware
    app.use((req, res, next) => {
      const url = req.originalUrl || req.url || "";
      if (url.startsWith("/qe/api/") || url.startsWith("/api/")) {
        return next();
      }
      if (url.startsWith("/qe/") || url === "/qe") {
        return (qeVite.middlewares as any)(req, res, next);
      }
      return next();
    });

    // SPA fallback: serve qe-index.html for all /qe/* routes
    app.use((req, res, next) => {
      const url = req.originalUrl || req.url || "";
      if (!url.startsWith("/qe/") && url !== "/qe") {
        return next();
      }
      if (url.startsWith("/qe/api/") || url.startsWith("/api/")) {
        return next();
      }
      // Skip asset requests (files with extensions like .js, .css, .ts, .tsx, .map, .svg, etc.)
      if (/\.\w+$/.test(url.split("?")[0])) {
        return next();
      }

      const qeTemplate = path.resolve(__dirname, "..", "client", "qe-index.html");
      fs.promises.readFile(qeTemplate, "utf-8").then((template) => {
        template = template.replace(
          `src="/src/qe/main.tsx"`,
          `src="/src/qe/main.tsx?v=${nanoid()}"`,
        );
        return qeVite.transformIndexHtml(url, template);
      }).then((page: string) => {
        res.status(200).set({ "Content-Type": "text/html" }).end(page);
      }).catch((e: Error) => {
        qeVite.ssrFixStacktrace(e);
        next(e);
      });
    });
  }

  // Main DevX Vite middleware — skip /qe/ and /api/ paths
  app.use((req, res, next) => {
    const url = req.originalUrl || req.url || '';
    const reqPath = req.path || '';

    if (url.startsWith("/api/") || reqPath.startsWith("/api/")) {
      return next();
    }
    if (url.startsWith("/qe/") || url === "/qe") {
      return next();
    }

    (vite.middlewares as any)(req, res, next);
  });

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl || req.url || '';
    const reqPath = req.path || '';

    if (url.startsWith("/api/") || reqPath.startsWith("/api/")) {
      return next();
    }
    if (url.startsWith("/qe/") || url === "/qe") {
      return next();
    }

    try {
      const clientTemplate = path.resolve(
        __dirname,
        "..",
        "client",
        "index.html",
      );

      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "..", "dist", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // ── QE static serving ──────────────────────────────────────────────
  const qeDistPath = path.resolve(__dirname, "..", "dist", "qe-public");
  if (fs.existsSync(qeDistPath)) {
    app.use("/qe", express.static(qeDistPath));
    app.use("/qe/*", (req, res, next) => {
      const url = req.originalUrl || req.url || "";
      if (url.startsWith("/qe/api/") || url.startsWith("/api/")) {
        return next();
      }
      res.sendFile(path.resolve(qeDistPath, "qe-index.html"));
    });
  }

  const staticMiddleware = express.static(distPath);
  app.use((req, res, next) => {
    const url = req.originalUrl || req.url || '';
    const reqPath = req.path || '';

    if (url.startsWith("/api/") || reqPath.startsWith("/api/")) {
      return next();
    }
    if (url.startsWith("/qe/") || url === "/qe") {
      return next();
    }

    staticMiddleware(req, res, next);
  });

  app.use("*", (req, res, next) => {
    const url = req.originalUrl || req.url || '';
    const reqPath = req.path || '';

    if (url.startsWith("/api/") || reqPath.startsWith("/api/")) {
      return next();
    }
    if (url.startsWith("/qe/") || url === "/qe") {
      return next();
    }

    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
