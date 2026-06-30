import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const cacheDir = path.join(os.tmpdir(), "vite-cache", path.basename(__dirname) + "-qe");

export default defineConfig({
  cacheDir,
  base: "/qe/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src", "qe"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
      // Use Mermaid's pre-built ESM bundle so the production build doesn't
      // re-minify Mermaid's source (which breaks diagram rendering in prod
      // while dev works fine). See https://github.com/mermaid-js/mermaid/issues/5362
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
  build: {
    outDir: path.resolve(__dirname, "dist", "qe-public"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "client", "qe-index.html"),
    },
  },
  optimizeDeps: {
    include: ["mermaid", "langium", "monaco-editor", "@monaco-editor/react"],
    exclude: ["pdfkit", "canvas", "sharp", "node-gyp"],
    force: false,
  },
  server: {
    fs: {
      strict: false,
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, "attached_assets"),
      ],
    },
  },
});
