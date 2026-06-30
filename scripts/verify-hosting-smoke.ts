/**
 * Quick sanity check for hosting resolution (run: npx tsx scripts/verify-hosting-smoke.ts)
 */
const { getHosting, getAllowedWorkItemPlatforms } = await import("../server/platform/hosting.ts");

const scenarios: { env: string | undefined; expectHosting: "azure" | "aws" }[] = [
  { env: undefined, expectHosting: "azure" },
  { env: "azure", expectHosting: "azure" },
  { env: "AWS", expectHosting: "aws" },
];

for (const { env, expectHosting } of scenarios) {
  if (env === undefined) {
    delete process.env.DEVX_HOSTING;
  } else {
    process.env.DEVX_HOSTING = env;
  }
  const h = getHosting();
  const p = getAllowedWorkItemPlatforms();
  if (h !== expectHosting) {
    console.error(`FAIL DEVX_HOSTING=${env}: got ${h}, expected ${expectHosting}`);
    process.exit(1);
  }
  if (h === "aws" && p.join(",") !== "jira") {
    console.error(`FAIL AWS platforms:`, p);
    process.exit(1);
  }
  if (h === "azure" && !(p.includes("ado") && p.includes("jira"))) {
    console.error(`FAIL Azure platforms:`, p);
    process.exit(1);
  }
}

console.log("verify-hosting-smoke: OK");
