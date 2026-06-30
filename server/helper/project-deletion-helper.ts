import { Request, Response } from "express";
import { SDLCService } from "../sdlc/service";
import { storage } from "../storage";
import { decryptPAT } from "../crypto-utils";
import { AzureDevOpsService } from "../azure-devops-service";

export async function handleProjectDelete(req: Request, res: Response, projectId: string) {
  const deleteFromAdo = req.body.deleteFromAdo === true;
  const { sdlcService } = await import("../sdlc/service");
  const svc = new SDLCService();
  
  const sdlcProject = await svc.getProjectByAdoProjectId(projectId);
  const integrationType = sdlcProject?.integrationType || "ado";

  if (integrationType === "jira") {
    try {
      const success = await svc.handleJiraProjectDelete(projectId, deleteFromAdo, (req.user as any)?.id);
      if (success) {
        return res.json({
          success: true,
          message: deleteFromAdo
            ? "Project deleted from Jira and marked as deleted in DevX database"
            : "Project marked as deleted in DevX database (Jira project was not deleted)"
        });
      }
    } catch (error) {
      console.error("[ProjectDeleteHelper] Error deleting Jira project:", error);
      return res.status(500).json({
        error: "Failed to delete Jira project",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Fallback to ADO logic (the existing logic from routes.ts)
  try {
    const organization = req.body.organization || req.query.organization as string;
    const organizationUrl = req.body.organizationUrl || req.query.organizationUrl as string;

    if (!organization || !organizationUrl) {
      return res.status(400).json({ error: "Missing organization or organizationUrl" });
    }

    const allOrgs = await storage.getArtifactOrganizations();
    const orgName = organization.toLowerCase();
    const orgUrlName = organizationUrl.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "").toLowerCase();

    let targetOrg = allOrgs.find((org) => {
      const name = org.organizationUrl.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "").toLowerCase();
      const orgProjectName = org.projectName?.toLowerCase();
      return (name === orgName || name === orgUrlName || orgProjectName === orgName) && org.patToken;
    });

    if (!targetOrg) {
      targetOrg = allOrgs.find((org) => {
        const name = org.name?.toLowerCase();
        return name === orgName && org.patToken;
      });
    }

    if (!targetOrg || !targetOrg.patToken) {
      return res.status(400).json({
        error: "No artifact organization found with PAT configured for this project"
      });
    }

    // ALWAYS mark project as deleted in DevX database (soft delete)
    let dbUpdateSuccess = false;
    try {
      if (sdlcProject) {
        await svc.updateProject(sdlcProject.id, {
          deletedFromAdo: true,
          status: "deleted"
        } as any);
        dbUpdateSuccess = true;
      }
    } catch (dbError) {
      console.error("[ProjectDeleteHelper] Error marking project as deleted in database:", dbError);
      return res.status(500).json({
        error: "Failed to mark project as deleted in database",
        details: dbError instanceof Error ? dbError.message : String(dbError)
      });
    }

    if (deleteFromAdo) {
      const decryptedPAT = decryptPAT(targetOrg.patToken);
      if (!decryptedPAT) {
        return res.status(500).json({
          error: "Failed to decrypt PAT token",
          note: dbUpdateSuccess ? "Project was marked as deleted in DevX database." : ""
        });
      }

      const adoOrgName = targetOrg.organizationUrl.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "");
      const adoService = new AzureDevOpsService({
        organization: adoOrgName,
        project: targetOrg.projectName || "temp",
        pat: decryptedPAT,
      });

      try {
        await adoService.deleteProject(projectId);
      } catch (adoError) {
        console.error(`[ProjectDeleteHelper] Error deleting project from Azure DevOps:`, adoError);
        return res.status(500).json({
          error: "Failed to delete project from Azure DevOps",
          details: adoError instanceof Error ? adoError.message : String(adoError),
          note: dbUpdateSuccess
            ? "The project was marked as deleted in DevX database, but Azure DevOps deletion failed. Please check your ADO permissions."
            : "Please try again."
        });
      }
    }

    res.json({
      success: true,
      message: deleteFromAdo
        ? "Project deleted from Azure DevOps and marked as deleted in DevX database"
        : "Project marked as deleted in DevX database (Azure DevOps project was not deleted)"
    });
  } catch (error) {
    console.error("[ProjectDeleteHelper] Error deleting ADO project:", error);
    res.status(500).json({
      error: "Failed to delete project",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
