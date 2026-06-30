import { storage } from "../storage";
import { decryptPAT } from "../crypto-utils";

export async function getGoldenRepoPAT(): Promise<string | null> {
  try {
    const settings = await storage.getAdoSettings();
    if (!settings) {
      return null;
    }
    if (!settings.patToken) {
      return null;
    }
    const decryptedPat = decryptPAT(settings.patToken);
    if (!decryptedPat) {
      return null;
    }

    // Clean and validate PAT
    const cleanedPat = decryptedPat.trim();

    return cleanedPat;
  } catch (error) {
    console.error("[Golden Repo] Error fetching PAT from ado_settings:", error);
    return null;
  }
}

export async function findRepositoryOrganization(repositoryId: string) {
  const settings = await storage.getAdoSettings();
  if (!settings) {
    return null;
  }

  // Get PAT from ado_settings table
  const decryptedPat = await getGoldenRepoPAT();
  if (!decryptedPat) {
    return null;
  }

  try {
    const authHeader = `Basic ${Buffer.from(`:${decryptedPat}`).toString("base64")}`;
    const repoUrl = `${settings.organizationUrl}/_apis/git/repositories/${repositoryId}?api-version=${settings.apiVersion}`;

    const repoResponse = await fetch(repoUrl, {
      headers: { "Authorization": authHeader },
    });

    if (repoResponse.ok) {
      const repoData = await repoResponse.json();
      // Check if this repository belongs to the configured project
      if (repoData.project?.name === settings.projectName) {
        // Return in format compatible with existing code
        return {
          organization: {
            id: settings.id,
            name: settings.projectName || "Organization",
            organizationUrl: settings.organizationUrl,
            projectName: settings.projectName,
            repositoryName: settings.repository,
            apiVersion: settings.apiVersion,
          },
          repository: repoData,
          authHeader,
          decryptedPat,
        };
      }
    }
  } catch (error) {
    console.error("[findRepositoryOrganization] Error:", error);
  }

  return null;
}
