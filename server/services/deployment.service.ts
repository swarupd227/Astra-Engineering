export interface DeploymentResult {
  status: "SUCCESS" | "FAILED";
  logs?: string;
  healthUrl?: string;
  deploymentId?: string;
  buildId?: string;
}

export interface DeploymentConfig {
  organization: string;
  project: string;
  pat: string;
  pipelineId?: number;
  branch?: string;
}

export class DeploymentService {
  private baseUrl: string;
  private headers: Record<string, string>;
  private organization: string;
  private project: string;
  private pipelineId: number;
  private branch: string;

  constructor(config: DeploymentConfig) {
    this.organization = config.organization;
    this.project = config.project;
    this.baseUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis`;
    this.pipelineId = config.pipelineId || 0; // Will be resolved dynamically
    this.branch = config.branch || 'main'; // Default to main branch
    
    // Create base64 encoded auth header for Azure DevOps PAT
    const auth = Buffer.from(`:${config.pat}`).toString('base64');
    this.headers = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  /**
   * Deploy a repository by triggering an Azure Pipeline
   */
  async deployRepo(repoId: string): Promise<DeploymentResult> {
    try {
      console.log(`[DeploymentService] ===== STARTING DEPLOYMENT =====`);
      console.log(`[DeploymentService] Repository ID: ${repoId}`);
      console.log(`[DeploymentService] Organization: ${this.organization}`);
      console.log(`[DeploymentService] Project: ${this.project}`);
      console.log(`[DeploymentService] Branch: ${this.branch}`);
      console.log(`[DeploymentService] Base URL: ${this.baseUrl}`);
      
      // Add a small delay to ensure repository is fully created
      console.log(`[DeploymentService] Waiting for repository to be fully initialized...`);
      await this.sleep(3000); // 3 second delay
      
      // Trigger the Azure Pipeline (this will create pipeline if needed)
      console.log(`[DeploymentService] Calling triggerPipeline...`);
      const buildResult = await this.triggerPipeline(repoId);
      
      console.log(`[DeploymentService] triggerPipeline result:`, JSON.stringify(buildResult, null, 2));
      
      if (!buildResult.success) {
        console.error(`[DeploymentService] ❌ Pipeline trigger failed: ${buildResult.error}`);
        return {
          status: "FAILED",
          logs: `Pipeline trigger failed: ${buildResult.error || "Unknown error"}`
        };
      }

      console.log(`[DeploymentService] Pipeline triggered successfully, build ID: ${buildResult.buildId}`);
      
      // Don't wait for completion in real-time, just return success
      // The build will continue in background
      const healthUrl = this.generateHealthUrl();
      
      return {
        status: "SUCCESS",
        logs: `Pipeline triggered successfully. Build ID: ${buildResult.buildId}`,
        healthUrl,
        buildId: buildResult.buildId?.toString(),
        deploymentId: buildResult.buildId?.toString()
      };

    } catch (error) {
      console.error('[DeploymentService] Deployment failed:', error);
      return {
        status: "FAILED",
        logs: `Deployment error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Create pipeline definition if it doesn't exist
   */
  private async createPipelineIfNeeded(repositoryId: string, repositoryName: string): Promise<{ success: boolean; pipelineId?: number; error?: string }> {
    try {
      // First check if pipeline already exists for this repository
      console.log(`[DeploymentService] Checking for existing pipeline for repository: ${repositoryName}`);
      
      const listUrl = `${this.baseUrl}/pipelines?api-version=7.1`;
      const listResponse = await fetch(listUrl, {
        headers: this.headers
      });
      
      if (listResponse.ok) {
        const pipelinesData = await listResponse.json();
        const existingPipeline = pipelinesData.value?.find((p: any) => 
          p.configuration?.repository?.name === repositoryName ||
          p.name?.toLowerCase().includes(repositoryName.toLowerCase())
        );
        
        if (existingPipeline) {
          console.log(`[DeploymentService] Found existing pipeline: ${existingPipeline.id} - ${existingPipeline.name}`);
          return {
            success: true,
            pipelineId: existingPipeline.id
          };
        }
      }
      
      // Create new pipeline if none exists
      console.log(`[DeploymentService] Creating new pipeline for repository: ${repositoryName}`);
      
      const createUrl = `${this.baseUrl}/pipelines?api-version=7.1`;
      const pipelineDefinition = {
        name: `${repositoryName}-Pipeline`,
        folder: null,
        configuration: {
          type: "yaml",
          path: "/azure-pipelines.yml",
          repository: {
            id: repositoryId,
            name: repositoryName,
            type: "azureReposGit"
          }
        }
      };
      
      console.log(`[DeploymentService] Pipeline definition:`, JSON.stringify(pipelineDefinition, null, 2));
      
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(pipelineDefinition)
      });
      
      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error(`[DeploymentService] Failed to create pipeline: ${createResponse.status} - ${errorText}`);
        return {
          success: false,
          error: `Failed to create pipeline: ${createResponse.status} - ${errorText}`
        };
      }
      
      const createdPipeline = await createResponse.json();
      console.log(`[DeploymentService] Created pipeline successfully: ${createdPipeline.id} - ${createdPipeline.name}`);
      
      return {
        success: true,
        pipelineId: createdPipeline.id
      };
      
    } catch (error) {
      console.error('[DeploymentService] Error creating pipeline:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Trigger Azure Pipeline for deployment
   */
  private async triggerPipeline(repositoryId: string): Promise<{ success: boolean; buildId?: number; error?: string }> {
    try {
      console.log(`[DeploymentService] ===== TRIGGER PIPELINE START =====`);
      console.log(`[DeploymentService] Repository ID: ${repositoryId}`);
      
      // Get repository name from repository ID
      const repoUrl = `${this.baseUrl}/git/repositories/${repositoryId}?api-version=7.1`;
      console.log(`[DeploymentService] Getting repository details: ${repoUrl}`);
      
      const repoResponse = await fetch(repoUrl, {
        headers: this.headers
      });
      
      console.log(`[DeploymentService] Repository API response: ${repoResponse.status} ${repoResponse.statusText}`);
      
      if (!repoResponse.ok) {
        const errorText = await repoResponse.text();
        console.error(`[DeploymentService] ❌ Failed to get repository details: ${repoResponse.status} - ${errorText}`);
        return {
          success: false,
          error: `Failed to get repository details: ${repoResponse.status} - ${errorText}`
        };
      }
      
      const repoData = await repoResponse.json();
      const repositoryName = repoData.name;
      
      console.log(`[DeploymentService] ✅ Repository name: ${repositoryName}`);
      console.log(`[DeploymentService] Repository data:`, JSON.stringify(repoData, null, 2));
      
      // Create pipeline if needed
      console.log(`[DeploymentService] Calling createPipelineIfNeeded...`);
      const pipelineResult = await this.createPipelineIfNeeded(repositoryId, repositoryName);
      
      console.log(`[DeploymentService] createPipelineIfNeeded result:`, JSON.stringify(pipelineResult, null, 2));
      
      if (!pipelineResult.success) {
        console.error(`[DeploymentService] ❌ Pipeline creation/lookup failed: ${pipelineResult.error}`);
        return {
          success: false,
          error: pipelineResult.error
        };
      }
      
      const activePipelineId = pipelineResult.pipelineId!;
      console.log(`[DeploymentService] ✅ Using pipeline ID: ${activePipelineId}`);
      
      // Trigger the pipeline
      const triggerUrl = `${this.baseUrl}/pipelines/${activePipelineId}/runs?api-version=7.1`;
      
      const requestBody = {
        resources: {
          repositories: {
            self: {
              refName: `refs/heads/${this.branch}`
            }
          }
        }
      };

      console.log(`[DeploymentService] Triggering pipeline at: ${triggerUrl}`);
      console.log(`[DeploymentService] Request body:`, JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(triggerUrl, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(requestBody)
      });
      
      console.log(`[DeploymentService] Pipeline trigger response: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[DeploymentService] ❌ Pipeline trigger failed: ${response.status} - ${errorText}`);
        return {
          success: false,
          error: `Pipeline trigger failed: ${response.status} - ${errorText}`
        };
      }
      
      const responseData = await response.json();
      console.log(`[DeploymentService] ✅ Pipeline triggered successfully!`);
      console.log(`[DeploymentService] Response data:`, JSON.stringify(responseData, null, 2));
      console.log(`[DeploymentService] Build ID: ${responseData.id}`);
      
      return {
        success: true,
        buildId: responseData.id
      };

    } catch (error) {
      console.error('[DeploymentService] ❌ Exception in triggerPipeline:', error);
      console.error('[DeploymentService] Error stack:', (error as Error)?.stack);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Wait for build completion and return status
   */
  private async waitForBuildCompletion(buildId: number, timeoutMs: number = 1800000): Promise<{ status: "SUCCESS" | "FAILED"; logs?: string }> {
    const startTime = Date.now();
    const pollIntervalMs = 30000; // Check every 30 seconds
    
    console.log(`[DeploymentService] Waiting for build ${buildId} to complete...`);

    while (Date.now() - startTime < timeoutMs) {
      try {
        const buildStatus = await this.getBuildStatusById(buildId);
        
        console.log(`[DeploymentService] Build ${buildId} status: ${buildStatus.status}`);
        
        if (buildStatus.status === 'completed') {
          if (buildStatus.result === 'succeeded') {
            return {
              status: "SUCCESS",
              logs: await this.getBuildLogs(buildId)
            };
          } else {
            return {
              status: "FAILED",
              logs: await this.getBuildLogs(buildId)
            };
          }
        }
        
        if (buildStatus.status === 'cancelled') {
          return {
            status: "FAILED",
            logs: "Build was cancelled"
          };
        }

        // Wait before polling again
        await this.sleep(pollIntervalMs);
        
      } catch (error) {
        console.error('[DeploymentService] Error checking build status:', error);
        await this.sleep(pollIntervalMs);
      }
    }

    return {
      status: "FAILED",
      logs: `Build ${buildId} timed out after ${timeoutMs / 1000} seconds`
    };
  }

  /**
   * Get current build status from Azure DevOps (private method)
   */
  private async getBuildStatusById(buildId: number): Promise<{ status: string; result?: string }> {
    const url = `${this.baseUrl}/build/builds/${buildId}?api-version=7.1`;
    
    const response = await fetch(url, { headers: this.headers });
    
    if (!response.ok) {
      throw new Error(`Failed to get build status: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
      status: data.status,
      result: data.result
    };
  }

  /**
   * Get build logs from Azure DevOps
   */
  private async getBuildLogs(buildId: number): Promise<string> {
    try {
      const url = `${this.baseUrl}/build/builds/${buildId}/logs?api-version=7.1`;
      
      const response = await fetch(url, { headers: this.headers });
      
      if (!response.ok) {
        return `Error fetching logs: ${response.status}`;
      }
      
      const data = await response.json();
      
      if (data.value && data.value.length > 0) {
        // Get the last few log entries as a summary
        const logEntries = data.value.slice(-5); // Last 5 log entries
        const logSummary = logEntries
          .map((log: any) => `Log ${log.id}: ${log.type}`)
          .join('\n');
        
        return logSummary;
      }
      
      return "No detailed logs available";
      
    } catch (error) {
      console.error('[DeploymentService] Error fetching build logs:', error);
      return `Error fetching logs: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Generate health URL for the deployed application
   */
  public generateHealthUrl(): string {
    // For develop branch, use QA environment
    if (this.branch === 'develop') {
      return 'https://qadevxapi2o.azurewebsites.net/health';
    }
    
    // For release branches, use UAT environment  
    if (this.branch.startsWith('release/')) {
      return 'https://uatdevxapi2o.azurewebsites.net/health';
    }
    
    // For main branch, use PROD environment
    if (this.branch === 'main') {
      return 'https://proddevxapi2o.azurewebsites.net/health';
    }
    
    // Default to QA for any other branch
    return 'https://qadevxapi2o.azurewebsites.net/health';
  }

  /**
   * Get deployment status for an existing deployment
   */
  async getDeploymentStatus(buildId: string): Promise<{ isComplete: boolean; isSuccess: boolean; logs?: string }> {
    try {
      const buildIdNum = parseInt(buildId, 10);
      const buildStatus = await this.getBuildStatusById(buildIdNum);
      
      if (buildStatus.status === 'completed') {
        return {
          isComplete: true,
          isSuccess: buildStatus.result === 'succeeded',
          logs: await this.getBuildLogs(buildIdNum)
        };
      }
      
      return {
        isComplete: false,
        isSuccess: false
      };
      
    } catch (error) {
      console.error('[DeploymentService] Error getting deployment status:', error);
      return {
        isComplete: true,
        isSuccess: false,
        logs: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get builds for a specific repository (public method)
   */
  async getBuildsForRepository(repositoryName: string): Promise<any[]> {
    try {
      console.log(`[DeploymentService] Getting builds for repository: ${repositoryName}`);
      
      // Get builds filtered by repository name
      const url = `${this.baseUrl}/build/builds?repositoryId=${repositoryName}&repositoryType=TfsGit&api-version=7.0&$top=10&queryOrder=queueTimeDescending`;
      
      const response = await fetch(url, {
        headers: this.headers
      });
      
      if (!response.ok) {
        // If filtering by repositoryId fails, try getting all builds and filter manually
        console.log(`[DeploymentService] Repository-specific query failed, trying all builds...`);
        
        const allBuildsUrl = `${this.baseUrl}/build/builds?api-version=7.0&$top=50&queryOrder=queueTimeDescending`;
        const allBuildsResponse = await fetch(allBuildsUrl, {
          headers: this.headers
        });
        
        if (!allBuildsResponse.ok) {
          console.error(`[DeploymentService] Failed to get builds: ${allBuildsResponse.status} ${allBuildsResponse.statusText}`);
          return [];
        }
        
        const allBuildsData = await allBuildsResponse.json();
        const filteredBuilds = allBuildsData.value?.filter((build: any) => 
          build.repository?.name?.toLowerCase().includes(repositoryName.toLowerCase())
        ) || [];
        
        console.log(`[DeploymentService] Found ${filteredBuilds.length} matching builds from ${allBuildsData.value?.length || 0} total builds`);
        
        return filteredBuilds.map((build: any) => ({
          id: build.id,
          buildNumber: build.buildNumber,
          status: build.status,
          result: build.result,
          queueTime: build.queueTime,
          startTime: build.startTime,
          finishTime: build.finishTime,
          repository: build.repository?.name,
          branch: build.sourceBranch,
          url: build._links?.web?.href
        }));
      }
      
      const data = await response.json();
      console.log(`[DeploymentService] Found ${data.value?.length || 0} builds for ${repositoryName}`);
      
      return data.value?.map((build: any) => ({
        id: build.id,
        buildNumber: build.buildNumber,
        status: build.status,
        result: build.result,
        queueTime: build.queueTime,
        startTime: build.startTime,
        finishTime: build.finishTime,
        repository: build.repository?.name,
        branch: build.sourceBranch,
        url: build._links?.web?.href
      })) || [];
      
    } catch (error) {
      console.error('[DeploymentService] Error getting builds for repository:', error);
      return [];
    }
  }

  /**
   * Utility method for sleeping
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}