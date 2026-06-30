/**
 * Test if the golden repo getFileContent logic can resolve the given paths.
 * Run: node server/test-golden-repo-paths.cjs
 */
const AdmZip = require("adm-zip");
const path = require("path");

const testPaths = [
  "Compliance/ai-audit-logs.md",
  "Compliance/iso27001-mapping.md",
  "Compliance/naic-guidance.md",
  "Process/requirements/insurance-usecases.md",
  "Process/requirements/risk-assessment.md",
  "Design/guideline.txt",
  "Design/guidline.txt", // Common typo - check both
  "General/ADO_User_Story_Standards.txt",
  "General/EXT_Account_Client.txt",
  "General/EXT_Binder.txt",
];

const zipPath =
  process.env.GOLDEN_REPO_ZIP_PATH ||
  path.join(
    process.cwd(),
    "attached_assets",
    "Golden_Insurance_Repo_1761897344922.zip"
  );

function findEntry(zip, filePath) {
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const normalizedPathLower = normalizedPath.toLowerCase();
  const basenameLower = path.basename(normalizedPath).toLowerCase();

  let entry = zip.getEntry(filePath) ?? zip.getEntry(normalizedPath);
  if (!entry) {
    const allEntries = zip.getEntries();
    entry =
      allEntries.find((e) => {
        const name = (e.entryName || "")
          .replace(/\\/g, "/")
          .replace(/^\/+/, "");
        const nameLower = name.toLowerCase();
        return (
          name === normalizedPath ||
          nameLower === normalizedPathLower ||
          name.endsWith("/" + normalizedPath) ||
          nameLower.endsWith("/" + normalizedPathLower) ||
          nameLower.endsWith("/" + basenameLower)
        );
      }) || null;
  }
  return entry;
}

function run() {
  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch (err) {
    console.error("Zip load failed:", err.message);
    process.exit(1);
  }

  const allNames = zip.getEntries().map((e) => e.entryName);
  console.log(
    "Zip has",
    allNames.length,
    "entries. Sample:",
    allNames.slice(0, 5).join(", ")
  );
  console.log("");

  let ok = 0;
  let fail = 0;
  testPaths.forEach((filePath) => {
    const entry = findEntry(zip, filePath);
    if (entry) {
      const content = entry.getData().toString("utf8");
      console.log(
        "OK  ",
        filePath,
        "-> matched",
        entry.entryName,
        "(" + content.length + " chars)"
      );
      ok++;
    } else {
      console.log("FAIL", filePath, "-> no match in zip");
      fail++;
    }
  });

  console.log("");
  console.log("Result:", ok, "readable,", fail, "not found");
  process.exit(fail > 0 ? 1 : 0);
}

run();
