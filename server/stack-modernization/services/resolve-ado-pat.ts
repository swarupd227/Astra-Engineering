/**
 * Resolve the decrypted ADO PAT for a given organization short name (e.g. "QS001").
 * Searches artifact_organizations in the DB, matches by org URL, and decrypts.
 * Falls back to process.env.ADO_PAT if no DB entry is found.
 */
export async function resolveAdoPat(orgName: string): Promise<string | null> {
  try {
    const { storage } = await import("../../storage");
    const allOrgs = await storage.getArtifactOrganizations();
    const matchedOrg = allOrgs.find((org: any) => {
      let extracted = org.organizationUrl || "";
      if (extracted.includes("dev.azure.com")) {
        extracted = extracted
          .replace(/https?:\/\/dev\.azure\.com\//, "")
          .replace(/\/$/, "")
          .split("/")[0];
      } else if (extracted.includes("visualstudio.com")) {
        const m = extracted.match(/([^.]+)\.visualstudio\.com/);
        if (m) extracted = m[1];
      }
      return extracted.toLowerCase() === orgName.toLowerCase() && !!org.patToken;
    });

    if (matchedOrg?.patToken) {
      const { decryptPAT } = await import("../../crypto-utils");
      const decrypted = decryptPAT(matchedOrg.patToken);
      if (decrypted) return decrypted;
    }
  } catch (e) {
    console.warn("[resolveAdoPat] Failed to look up PAT from DB:", e);
  }

  return process.env.ADO_PAT || null;
}
