import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import os from "os";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { execSync } from "child_process";

/** ⬇️ NEW: import the copy plugin */
import copy from "rollup-plugin-copy";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require(path.resolve(__dirname, "package.json"));

function getLatestTagInfo() {
  try {
    const tag = execSync("git describe --tags --abbrev=0", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();

    if (!tag) return null;

    const rawDate = execSync(`git log -1 --format=%cs ${tag}`, {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();

    // rawDate is YYYY-MM-DD -> convert to DDMMYYYY
    const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const tagDate = match ? `${match[3]}${match[2]}${match[1]}` : rawDate;

    return { tag, tagDate };
  } catch {
    return null;
  }
}

const latestTagInfo = getLatestTagInfo();

// Version for display: prefer env or latest git tag name, fallback to package.json
const appVersion =
  process.env.VITE_APP_VERSION ||
  latestTagInfo?.tag ||
  pkg.version ||
  "1.0.0";

// Date for display: prefer env or latest git tag date (DDMMYYYY), fallback to today's date
const buildDate =
  process.env.VITE_BUILD_DATE ||
  latestTagInfo?.tagDate ||
  (() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}`;
  })();

// Use OS temp directory for Vite cache to avoid OneDrive file locking issues
// This prevents EPERM errors when OneDrive is syncing the project folder
const cacheDir = path.join(os.tmpdir(), "vite-cache", path.basename(__dirname));

export default defineConfig({
  cacheDir,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
      ? [
        await import("@replit/vite-plugin-cartographer").then((m) =>
          m.cartographer(),
        ),
        await import("@replit/vite-plugin-dev-banner").then((m) =>
          m.devBanner(),
        ),
      ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
      // Use Mermaid's own pre-built, pre-minified ESM bundle instead of letting
      // Rollup re-bundle/minify Mermaid's source. Re-minifying Mermaid breaks its
      // internal class/prototype setup, which is why diagrams render fine with
      // `npm run dev` but throw "Failed to render diagram" in the production build.
      // See: https://github.com/mermaid-js/mermaid/issues/5362
      mermaid: path.resolve(
        __dirname,
        "node_modules/mermaid/dist/mermaid.esm.min.mjs",
      ),
    },
    dedupe: [
      "mermaid",
      "langium",
      "@chevrotain/regexp-to-ast",
      "@chevrotain/gast",
      "@chevrotain/utils",
      "@chevrotain/cst-dts-gen",
      "@chevrotain/types",
    ],
  },
  root: path.resolve(__dirname, "client"),
  envDir: __dirname,
  build: {
    // Your client assets go to dist/public, as before
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      /** ⬇️ NEW: copy pdfkit AFM data into dist/data (sibling to dist/public) */
      plugins: [
        copy({
          targets: [
            {
              // Source: pdfkit AFM data folder
              src: path.resolve(__dirname, "node_modules/pdfkit/js/data/*"),
              // Destination: dist/data (NOT dist/public), to match error path
              dest: path.resolve(__dirname, "dist/data"),
            },
          ],
          // Run after the bundle is written so the folder is present
          hook: "writeBundle",
          // Optional: verbose logging during build
          verbose: true,
        }),
      ],
      // Explicitly define external modules (your original)
      external: [],
      onwarn(warning, warn) {
        const message = String(warning.message || "").toLowerCase();
        const code = String(warning.code || "").toLowerCase();

        if (
          (message.includes("externalize") || message.includes("external")) &&
          (message.includes("build.rollupoptions.external") ||
            message.includes("rollupoptions.external") ||
            message.includes("explicitly add it to") ||
            message.includes("most likely unintended") ||
            message.includes("break your application"))
        ) {
          return;
        }

        if (
          code === "unresolved_import" &&
          (message.includes("externalize") ||
            message.includes("external") ||
            message.includes("most likely unintended") ||
            message.includes("build.rollupoptions.external"))
        ) {
          return;
        }

        warn(warning);
      },
    },
  },
  optimizeDeps: {
    include: ["mermaid", "langium", "monaco-editor", "@monaco-editor/react"],
    exclude: ["pdfkit", "canvas", "sharp", "node-gyp"],
    force: false,
    esbuildOptions: {
      mainFields: ["module", "main"],
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});