/**
 * Deployment QA Agent
 * 
 * This agent validates deployed applications by performing comprehensive quality checks:
 * - Health endpoint validation
 * - Pipeline status monitoring
 * - Build artifact verification
 * - Performance testing
 * - Security vulnerability scanning
 * - Compliance verification
 */

export interface QAValidationResult {
  status: "PASS" | "FAIL" | "WARNING" | "PENDING";
  score: number; // 0-100 quality score
  checks: QACheck[];
  summary: string;
  recommendations: string[];
  deployment: {
    url?: string;
    buildId?: string;
    repositoryName: string;
    organization: string;
    project: string;
    validatedAt: string;
  };
}

export interface QACheck {
  name: string;
  category: "HEALTH" | "PERFORMANCE" | "SECURITY" | "COMPLIANCE" | "FUNCTIONALITY";
  status: "PASS" | "FAIL" | "WARNING" | "SKIP" | "PENDING";
  score: number; // 0-100
  duration: number; // in milliseconds
  details: string;
  evidence?: any; // Supporting data
  criticalityLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface QAConfig {
  organization: string;
  project: string;
  pat: string;
  healthCheckTimeout?: number; // milliseconds
  performanceThreshold?: number; // milliseconds
  securityScanEnabled?: boolean;
  complianceChecksEnabled?: boolean;
}

export class DeploymentQAAgent {
  private baseUrl: string;
  private headers: Record<string, string>;
  private organization: string;
  private project: string;
  private config: QAConfig;

  constructor(config: QAConfig) {
    this.organization = config.organization;
    this.project = config.project;
    this.baseUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis`;
    this.config = {
      healthCheckTimeout: 30000, // 30 seconds default
      performanceThreshold: 5000, // 5 seconds default
      securityScanEnabled: true,
      complianceChecksEnabled: true,
      ...config
    };
    
    // Create base64 encoded auth header for Azure DevOps PAT
    const auth = Buffer.from(`:${config.pat}`).toString('base64');
    this.headers = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  /**
   * Perform comprehensive QA validation on a deployed application
   */
  async validateDeployment(repositoryName: string, buildId?: string, deploymentUrl?: string): Promise<QAValidationResult> {
    console.log(`[QA-Agent] ===== STARTING QA VALIDATION =====`);
    console.log(`[QA-Agent] Repository: ${repositoryName}`);
    console.log(`[QA-Agent] Build ID: ${buildId || 'Not specified'}`);
    console.log(`[QA-Agent] Deployment URL: ${deploymentUrl || 'Auto-detecting...'}`);

    const startTime = Date.now();
    const checks: QACheck[] = [];

    try {
      // 1. Pipeline & Build Status Validation
      const buildChecks = await this.validateBuildStatus(repositoryName, buildId);
      checks.push(...buildChecks);

      // 2. Health Endpoint Validation
      const healthUrl = deploymentUrl || this.generateHealthUrl(repositoryName);
      const healthChecks = await this.validateHealthEndpoint(healthUrl);
      checks.push(...healthChecks);

      // 3. Performance Testing
      const performanceChecks = await this.performanceTest(healthUrl);
      checks.push(...performanceChecks);

      // 4. Security Validation
      if (this.config.securityScanEnabled) {
        const securityChecks = await this.securityScan(healthUrl, repositoryName);
        checks.push(...securityChecks);
      }

      // 5. Compliance Verification
      if (this.config.complianceChecksEnabled) {
        const complianceChecks = await this.complianceVerification(repositoryName);
        checks.push(...complianceChecks);
      }

      // 6. Functional Testing (Basic)
      const functionalChecks = await this.functionalTesting(healthUrl);
      checks.push(...functionalChecks);

      // Calculate overall score and status
      const result = this.calculateQAResult(checks, repositoryName, buildId, deploymentUrl);
      
      const duration = Date.now() - startTime;
      console.log(`[QA-Agent] QA validation completed in ${duration}ms`);
      console.log(`[QA-Agent] Overall Score: ${result.score}/100`);
      console.log(`[QA-Agent] Status: ${result.status}`);
      
      return result;

    } catch (error) {
      console.error('[QA-Agent] QA validation failed:', error);
      
      return {
        status: "FAIL",
        score: 0,
        checks: [{
          name: "QA Agent Execution",
          category: "FUNCTIONALITY",
          status: "FAIL",
          score: 0,
          duration: Date.now() - startTime,
          details: `QA validation failed: ${error instanceof Error ? error.message : String(error)}`,
          criticalityLevel: "CRITICAL"
        }],
        summary: "QA validation could not be completed due to an error",
        recommendations: [
          "Check QA agent configuration",
          "Verify Azure DevOps PAT token permissions",
          "Ensure deployment is accessible",
          "Review logs for specific error details"
        ],
        deployment: {
          repositoryName,
          organization: this.organization,
          project: this.project,
          validatedAt: new Date().toISOString(),
          buildId,
          url: deploymentUrl
        }
      };
    }
  }

  /**
   * Validate build status and pipeline execution
   */
  private async validateBuildStatus(repositoryName: string, buildId?: string): Promise<QACheck[]> {
    const checks: QACheck[] = [];
    const startTime = Date.now();

    try {
      console.log('[QA-Agent] Validating build status...');

      // Get recent builds for this repository
      const buildsUrl = `${this.baseUrl}/build/builds?repositoryId=${repositoryName}&$top=5&api-version=7.0`;
      const buildsResponse = await fetch(buildsUrl, { headers: this.headers });
      
      if (!buildsResponse.ok) {
        checks.push({
          name: "Build Status Check",
          category: "FUNCTIONALITY",
          status: "FAIL",
          score: 0,
          duration: Date.now() - startTime,
          details: `Failed to fetch builds: ${buildsResponse.status} ${buildsResponse.statusText}`,
          criticalityLevel: "HIGH"
        });
        return checks;
      }

      const buildsData = await buildsResponse.json();
      const builds = buildsData.value || [];

      if (builds.length === 0) {
        checks.push({
          name: "Build History Check",
          category: "FUNCTIONALITY",
          status: "WARNING",
          score: 50,
          duration: Date.now() - startTime,
          details: "No builds found for this repository",
          criticalityLevel: "MEDIUM"
        });
        return checks;
      }

      // Find the target build (specific buildId or latest)
      const targetBuild = buildId 
        ? builds.find((b: any) => b.id.toString() === buildId)
        : builds[0]; // Most recent build

      if (!targetBuild) {
        checks.push({
          name: "Target Build Check",
          category: "FUNCTIONALITY",
          status: "FAIL",
          score: 0,
          duration: Date.now() - startTime,
          details: buildId ? `Build ${buildId} not found` : "No builds available",
          criticalityLevel: "CRITICAL"
        });
        return checks;
      }

      // Validate build result
      const buildResult = targetBuild.result;
      const buildStatus = targetBuild.status;

      if (buildResult === 'succeeded') {
        checks.push({
          name: "Build Success Check",
          category: "FUNCTIONALITY",
          status: "PASS",
          score: 100,
          duration: Date.now() - startTime,
          details: `Build ${targetBuild.id} completed successfully`,
          evidence: { buildId: targetBuild.id, result: buildResult, status: buildStatus },
          criticalityLevel: "LOW"
        });
      } else if (buildResult === 'failed') {
        checks.push({
          name: "Build Success Check",
          category: "FUNCTIONALITY",
          status: "FAIL",
          score: 0,
          duration: Date.now() - startTime,
          details: `Build ${targetBuild.id} failed`,
          evidence: { buildId: targetBuild.id, result: buildResult, status: buildStatus },
          criticalityLevel: "CRITICAL"
        });
      } else if (buildStatus === 'inProgress') {
        checks.push({
          name: "Build Status Check",
          category: "FUNCTIONALITY",
          status: "PENDING",
          score: 50,
          duration: Date.now() - startTime,
          details: `Build ${targetBuild.id} is still in progress`,
          evidence: { buildId: targetBuild.id, result: buildResult, status: buildStatus },
          criticalityLevel: "LOW"
        });
      } else {
        checks.push({
          name: "Build Status Check",
          category: "FUNCTIONALITY",
          status: "WARNING",
          score: 30,
          duration: Date.now() - startTime,
          details: `Build ${targetBuild.id} has unexpected status: ${buildResult || buildStatus}`,
          evidence: { buildId: targetBuild.id, result: buildResult, status: buildStatus },
          criticalityLevel: "MEDIUM"
        });
      }

    } catch (error) {
      checks.push({
        name: "Build Status Check",
        category: "FUNCTIONALITY",
        status: "FAIL",
        score: 0,
        duration: Date.now() - startTime,
        details: `Build validation error: ${error instanceof Error ? error.message : String(error)}`,
        criticalityLevel: "HIGH"
      });
    }

    return checks;
  }

  /**
   * Validate health endpoint accessibility and response
   */
  private async validateHealthEndpoint(healthUrl: string): Promise<QACheck[]> {
    const checks: QACheck[] = [];
    const startTime = Date.now();

    try {
      console.log(`[QA-Agent] Testing health endpoint: ${healthUrl}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.healthCheckTimeout || 30000);

      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'DevX-QA-Agent/1.0',
          'Accept': 'application/json'
        }
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (response.ok) {
        const responseData = await response.text();
        let parsedData;
        
        try {
          parsedData = JSON.parse(responseData);
        } catch {
          parsedData = responseData;
        }

        checks.push({
          name: "Health Endpoint Accessibility",
          category: "HEALTH",
          status: "PASS",
          score: 100,
          duration,
          details: `Health endpoint responded successfully (${response.status})`,
          evidence: { 
            status: response.status, 
            headers: Object.fromEntries(response.headers.entries()),
            response: parsedData
          },
          criticalityLevel: "LOW"
        });

        // Validate response structure if JSON
        if (typeof parsedData === 'object' && parsedData !== null) {
          const hasStatus = 'status' in parsedData;
          const hasTimestamp = 'timestamp' in parsedData;
          
          checks.push({
            name: "Health Response Structure",
            category: "HEALTH",
            status: hasStatus ? "PASS" : "WARNING",
            score: hasStatus ? 100 : 70,
            duration: 0,
            details: hasStatus 
              ? "Health response includes required status field"
              : "Health response missing recommended status field",
            evidence: { hasStatus, hasTimestamp, keys: Object.keys(parsedData) },
            criticalityLevel: hasStatus ? "LOW" : "MEDIUM"
          });
        }

      } else {
        checks.push({
          name: "Health Endpoint Accessibility",
          category: "HEALTH",
          status: "FAIL",
          score: 0,
          duration,
          details: `Health endpoint returned error: ${response.status} ${response.statusText}`,
          evidence: { status: response.status, statusText: response.statusText },
          criticalityLevel: "CRITICAL"
        });
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      let details = `Health check failed: ${error instanceof Error ? error.message : String(error)}`;
      let criticalityLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "CRITICAL";

      if (error instanceof Error && error.name === 'AbortError') {
        details = `Health check timed out after ${this.config.healthCheckTimeout}ms`;
        criticalityLevel = "HIGH";
      }

      checks.push({
        name: "Health Endpoint Accessibility",
        category: "HEALTH",
        status: "FAIL",
        score: 0,
        duration,
        details,
        criticalityLevel
      });
    }

    return checks;
  }

  /**
   * Perform performance testing
   */
  private async performanceTest(url: string): Promise<QACheck[]> {
    const checks: QACheck[] = [];
    const startTime = Date.now();

    try {
      console.log(`[QA-Agent] Running performance test...`);

      // Simple performance test - measure response time
      const testStart = Date.now();
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': 'DevX-QA-Agent-Perf/1.0' }
      });
      const responseTime = Date.now() - testStart;

      const threshold = this.config.performanceThreshold || 5000;
      
      if (response.ok) {
        const score = Math.max(0, 100 - Math.floor((responseTime / threshold) * 100));
        const status = responseTime <= threshold ? "PASS" : "WARNING";

        checks.push({
          name: "Response Time Test",
          category: "PERFORMANCE",
          status,
          score,
          duration: Date.now() - startTime,
          details: `Response time: ${responseTime}ms (threshold: ${threshold}ms)`,
          evidence: { responseTime, threshold, url },
          criticalityLevel: responseTime <= threshold ? "LOW" : "MEDIUM"
        });
      } else {
        checks.push({
          name: "Response Time Test",
          category: "PERFORMANCE",
          status: "FAIL",
          score: 0,
          duration: Date.now() - startTime,
          details: `Performance test failed: ${response.status} ${response.statusText}`,
          criticalityLevel: "HIGH"
        });
      }

    } catch (error) {
      checks.push({
        name: "Performance Test",
        category: "PERFORMANCE",
        status: "FAIL",
        score: 0,
        duration: Date.now() - startTime,
        details: `Performance test error: ${error instanceof Error ? error.message : String(error)}`,
        criticalityLevel: "MEDIUM"
      });
    }

    return checks;
  }

  /**
   * Security vulnerability scanning
   */
  private async securityScan(url: string, repositoryName: string): Promise<QACheck[]> {
    const checks: QACheck[] = [];
    const startTime = Date.now();

    console.log(`[QA-Agent] Running security scan...`);

    try {
      // Basic security checks
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': 'DevX-QA-Agent-Security/1.0' }
      });

      if (response.ok) {
        // Check security headers
        const securityHeaders = {
          'X-Frame-Options': response.headers.get('X-Frame-Options'),
          'X-Content-Type-Options': response.headers.get('X-Content-Type-Options'),
          'X-XSS-Protection': response.headers.get('X-XSS-Protection'),
          'Strict-Transport-Security': response.headers.get('Strict-Transport-Security'),
          'Content-Security-Policy': response.headers.get('Content-Security-Policy')
        };

        const securityHeadersPresent = Object.values(securityHeaders).filter(v => v !== null).length;
        const maxHeaders = Object.keys(securityHeaders).length;
        
        checks.push({
          name: "Security Headers Check",
          category: "SECURITY",
          status: securityHeadersPresent >= 3 ? "PASS" : "WARNING",
          score: Math.floor((securityHeadersPresent / maxHeaders) * 100),
          duration: Date.now() - startTime,
          details: `${securityHeadersPresent}/${maxHeaders} security headers present`,
          evidence: securityHeaders,
          criticalityLevel: securityHeadersPresent >= 3 ? "LOW" : "MEDIUM"
        });

        // Check if HTTPS is used
        const isHttps = url.toLowerCase().startsWith('https://');
        checks.push({
          name: "HTTPS Check",
          category: "SECURITY",
          status: isHttps ? "PASS" : "WARNING",
          score: isHttps ? 100 : 30,
          duration: 0,
          details: isHttps ? "HTTPS is properly configured" : "Application not using HTTPS",
          evidence: { url, isHttps },
          criticalityLevel: isHttps ? "LOW" : "HIGH"
        });

      } else {
        checks.push({
          name: "Security Scan",
          category: "SECURITY",
          status: "FAIL",
          score: 0,
          duration: Date.now() - startTime,
          details: `Security scan failed: ${response.status} ${response.statusText}`,
          criticalityLevel: "HIGH"
        });
      }

    } catch (error) {
      checks.push({
        name: "Security Scan",
        category: "SECURITY",
        status: "FAIL",
        score: 0,
        duration: Date.now() - startTime,
        details: `Security scan error: ${error instanceof Error ? error.message : String(error)}`,
        criticalityLevel: "MEDIUM"
      });
    }

    return checks;
  }

  /**
   * Compliance verification
   */
  private async complianceVerification(repositoryName: string): Promise<QACheck[]> {
    const checks: QACheck[] = [];
    const startTime = Date.now();

    console.log(`[QA-Agent] Running compliance verification...`);

    try {
      // Check for required files in repository
      const requiredFiles = [
        'README.md',
        'azure-pipelines.yml',
        'package.json'
      ];

      let filesFound = 0;
      for (const file of requiredFiles) {
        try {
          const fileUrl = `${this.baseUrl}/git/repositories/${repositoryName}/items?path=/${file}&api-version=7.0`;
          const fileResponse = await fetch(fileUrl, { headers: this.headers });
          
          if (fileResponse.ok) {
            filesFound++;
          }
        } catch (error) {
          // File not found or access error - continue checking other files
          console.log(`[QA-Agent] Could not check file ${file}:`, error);
        }
      }

      const complianceScore = Math.floor((filesFound / requiredFiles.length) * 100);
      
      checks.push({
        name: "Repository Compliance",
        category: "COMPLIANCE",
        status: filesFound >= requiredFiles.length ? "PASS" : "WARNING",
        score: complianceScore,
        duration: Date.now() - startTime,
        details: `${filesFound}/${requiredFiles.length} required files present`,
        evidence: { requiredFiles, filesFound },
        criticalityLevel: filesFound >= requiredFiles.length ? "LOW" : "MEDIUM"
      });

    } catch (error) {
      checks.push({
        name: "Compliance Verification",
        category: "COMPLIANCE",
        status: "WARNING",
        score: 50,
        duration: Date.now() - startTime,
        details: `Compliance check partially failed: ${error instanceof Error ? error.message : String(error)}`,
        criticalityLevel: "MEDIUM"
      });
    }

    return checks;
  }

  /**
   * Basic functional testing
   */
  private async functionalTesting(url: string): Promise<QACheck[]> {
    const checks: QACheck[] = [];
    const startTime = Date.now();

    console.log(`[QA-Agent] Running functional tests...`);

    try {
      // Test different HTTP methods if applicable
      const methods = ['GET', 'POST', 'OPTIONS'];
      let passedTests = 0;

      for (const method of methods) {
        try {
          const response = await fetch(url, {
            method,
            headers: { 
              'User-Agent': 'DevX-QA-Agent-Functional/1.0',
              'Content-Type': 'application/json'
            },
            body: method === 'POST' ? '{}' : undefined
          });

          // Accept 2xx, 4xx for POST/OPTIONS as valid responses
          // (4xx indicates endpoint exists but may not accept these methods)
          if (response.ok || (method !== 'GET' && response.status >= 400 && response.status < 500)) {
            passedTests++;
          }
        } catch (error) {
          // Method might not be supported - continue testing
          console.log(`[QA-Agent] Method ${method} test failed:`, error);
        }
      }

      const functionalScore = Math.floor((passedTests / methods.length) * 100);
      
      checks.push({
        name: "Basic Functional Test",
        category: "FUNCTIONALITY",
        status: passedTests > 0 ? "PASS" : "FAIL",
        score: functionalScore,
        duration: Date.now() - startTime,
        details: `${passedTests}/${methods.length} HTTP methods responded appropriately`,
        evidence: { testedMethods: methods, passedTests },
        criticalityLevel: passedTests > 0 ? "LOW" : "HIGH"
      });

    } catch (error) {
      checks.push({
        name: "Functional Testing",
        category: "FUNCTIONALITY",
        status: "FAIL",
        score: 0,
        duration: Date.now() - startTime,
        details: `Functional test error: ${error instanceof Error ? error.message : String(error)}`,
        criticalityLevel: "HIGH"
      });
    }

    return checks;
  }

  /**
   * Calculate overall QA result from individual checks
   */
  private calculateQAResult(checks: QACheck[], repositoryName: string, buildId?: string, deploymentUrl?: string): QAValidationResult {
    if (checks.length === 0) {
      return {
        status: "FAIL",
        score: 0,
        checks: [],
        summary: "No QA checks were performed",
        recommendations: ["Verify QA agent configuration", "Check deployment accessibility"],
        deployment: {
          repositoryName,
          organization: this.organization,
          project: this.project,
          validatedAt: new Date().toISOString(),
          buildId,
          url: deploymentUrl
        }
      };
    }

    // Calculate weighted score based on criticality
    const weights = {
      'CRITICAL': 4,
      'HIGH': 3,
      'MEDIUM': 2,
      'LOW': 1
    };

    let totalWeightedScore = 0;
    let totalWeight = 0;

    checks.forEach(check => {
      const weight = weights[check.criticalityLevel];
      totalWeightedScore += check.score * weight;
      totalWeight += weight;
    });

    const overallScore = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;

    // Determine overall status
    const criticalFailures = checks.filter(c => c.status === "FAIL" && c.criticalityLevel === "CRITICAL").length;
    const highFailures = checks.filter(c => c.status === "FAIL" && c.criticalityLevel === "HIGH").length;
    const pendingChecks = checks.filter(c => c.status === "PENDING").length;

    let status: "PASS" | "FAIL" | "WARNING" | "PENDING";
    if (criticalFailures > 0) {
      status = "FAIL";
    } else if (pendingChecks > 0) {
      status = "PENDING";
    } else if (highFailures > 0 || overallScore < 70) {
      status = "WARNING";
    } else {
      status = "PASS";
    }

    // Generate summary and recommendations
    const passedChecks = checks.filter(c => c.status === "PASS").length;
    const failedChecks = checks.filter(c => c.status === "FAIL").length;
    const warningChecks = checks.filter(c => c.status === "WARNING").length;

    const summary = `QA validation completed: ${passedChecks} passed, ${failedChecks} failed, ${warningChecks} warnings. Overall score: ${overallScore}/100`;

    const recommendations: string[] = [];
    if (criticalFailures > 0) {
      recommendations.push("Address critical failures immediately before proceeding to production");
    }
    if (highFailures > 0) {
      recommendations.push("Resolve high-priority issues to improve deployment quality");
    }
    if (overallScore < 80) {
      recommendations.push("Consider implementing additional quality measures");
    }
    if (checks.some(c => c.category === "SECURITY" && c.status !== "PASS")) {
      recommendations.push("Review and improve security configurations");
    }
    if (checks.some(c => c.category === "PERFORMANCE" && c.score < 80)) {
      recommendations.push("Optimize application performance");
    }
    if (recommendations.length === 0) {
      recommendations.push("Deployment meets quality standards");
    }

    return {
      status,
      score: overallScore,
      checks,
      summary,
      recommendations,
      deployment: {
        repositoryName,
        organization: this.organization,
        project: this.project,
        validatedAt: new Date().toISOString(),
        buildId,
        url: deploymentUrl
      }
    };
  }

  /**
   * Generate health URL for deployment validation
   */
  private generateHealthUrl(repositoryName?: string): string {
    // For now, use a default health URL
    // In the future, this could be more sophisticated based on deployment patterns
    const baseUrl = process.env.QA_BASE_URL || 'https://qadevxapi2o.azurewebsites.net';
    return `${baseUrl}/health`;
  }

  /**
   * Get deployment validation summary for reporting
   */
  async getValidationSummary(repositoryName: string, buildId?: string): Promise<any> {
    try {
      console.log(`[QA-Agent] Generating validation summary for ${repositoryName}`);
      
      const result = await this.validateDeployment(repositoryName, buildId);
      
      return {
        repository: repositoryName,
        buildId: buildId,
        overallScore: result.score,
        status: result.status,
        validatedAt: result.deployment.validatedAt,
        categories: {
          health: result.checks.filter(c => c.category === "HEALTH"),
          performance: result.checks.filter(c => c.category === "PERFORMANCE"),
          security: result.checks.filter(c => c.category === "SECURITY"),
          compliance: result.checks.filter(c => c.category === "COMPLIANCE"),
          functionality: result.checks.filter(c => c.category === "FUNCTIONALITY")
        },
        summary: result.summary,
        recommendations: result.recommendations
      };
    } catch (error) {
      console.error('[QA-Agent] Error generating validation summary:', error);
      throw error;
    }
  }
}

export default DeploymentQAAgent;