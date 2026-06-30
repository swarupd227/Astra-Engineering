#!/usr/bin/env node
/**
 * Fail fast when package-lock.json is out of sync with package.json.
 * Docker builds use `npm ci`, which hard-fails on lockfile drift — catch it in CI
 * and pre-commit instead of after a 15+ minute image build.
 */

import { execSync } from "child_process";

try {
  execSync("npm ci --include=optional --ignore-scripts --dry-run", {
    stdio: "pipe",
    env: {
      ...process.env,
      HUSKY: "0",
      CI: "true",
    },
  });
  console.log("package-lock.json is in sync with package.json");
} catch (error) {
  const output = [error.stdout, error.stderr]
    .filter(Boolean)
    .map((chunk) => chunk.toString())
    .join("\n")
    .trim();

  console.error("\npackage-lock.json is out of sync with package.json");
  console.error("Docker `npm ci` will fail until the lockfile is regenerated.");
  console.error("\nFix:");
  console.error("  npm install --package-lock-only --ignore-scripts");
  console.error("  git add package-lock.json");
  if (output) {
    console.error("\nnpm output:\n", output);
  }
  process.exit(1);
}
