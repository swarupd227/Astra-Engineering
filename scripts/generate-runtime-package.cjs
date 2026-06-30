const fs = require("fs");
const path = require("path");

const rootDir = process.cwd();
const outputDir = process.argv[2];

if (!outputDir) {
  console.error("Usage: node scripts/generate-runtime-package.cjs <output-dir>");
  process.exit(1);
}

const rootPackage = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
);

const runtimeDependencyNames = [
  "@aws-sdk/client-bedrock-runtime",
  "@aws-sdk/client-s3",
  "@aws-sdk/client-secrets-manager",
  "@aws-sdk/s3-request-presigner",
  "@azure/arm-appservice",
  "@azure/arm-mysql-flexible",
  "@azure/arm-postgresql-flexible",
  "@azure/arm-resources",
  "@azure/arm-sql",
  "@azure/arm-subscriptions",
  "@azure/identity",
  "@langchain/langgraph",
  "@sparticuz/chromium",
  "dotenv",
  "express",
  "express-session",
  "faiss-node",
  "memorystore",
  "mysql2",
  "openid-client",
  "passport",
  "passport-local",
  "playwright",
  "puppeteer",
  "puppeteer-core",
];

const missingDependencies = runtimeDependencyNames.filter(
  (name) => !rootPackage.dependencies?.[name],
);

if (missingDependencies.length > 0) {
  console.error(
    `Missing runtime dependencies in root package.json: ${missingDependencies.join(", ")}`,
  );
  process.exit(1);
}

const runtimePackage = {
  name: rootPackage.name,
  version: rootPackage.version,
  type: rootPackage.type,
  license: rootPackage.license,
  private: true,
  scripts: {
    start: "node dist/index.cjs",
  },
  dependencies: Object.fromEntries(
    runtimeDependencyNames.map((name) => [name, rootPackage.dependencies[name]]),
  ),
  optionalDependencies: rootPackage.optionalDependencies ?? {},
  engines: rootPackage.engines ?? {},
  overrides: rootPackage.overrides ?? {},
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, "package.json"),
  `${JSON.stringify(runtimePackage, null, 2)}\n`,
);

console.log(
  `[runtime-package] Wrote minimal runtime package.json with ${runtimeDependencyNames.length} dependencies to ${outputDir}`,
);