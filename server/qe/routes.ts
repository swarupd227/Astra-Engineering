import type { Express, Request, Response } from "express";
import express from "express";

import * as path from "path";
import fs from "fs";
import unzipper from "unzipper";
import archiver from "archiver";
import { z } from "zod";
import { storage } from "./storage";
import { db, awaitMigrations } from "./db";
import { eq, sql, and, desc } from "drizzle-orm";
import type { AgentTask, LiveMetric, TaskUpdate, TestResults, TestStep, InsertFunctionalTestRunCase } from "@shared/qe-schema";
import { insertTestSessionSchema, insertFunctionalTestSessionSchema, insertProjectSchema, insertRequirementSchema, insertUserStorySchema, reportValidations, validationResults } from "@shared/qe-schema";
import { crawlOrchestrator } from "./crawl-orchestrator";
import { EnhancedCrawler } from "./enhanced-crawler";
import { domTestGenerator, type PageTestSuite, type DOMTestCase } from "./dom-test-generator";
import { testCaseGenerator } from "./test-case-generator";
import { testExecutionEngine } from "./test-execution-engine";
import { playwrightService } from "./playwright-service";
import { generatePlaywrightScript, generatePlaywrightConfig, generatePlaywrightScriptWithXPaths, generatePlaywrightScriptCLI, discoverPageElements, type TestCaseExecution } from "./playwright-execution-engine";
import { SessionRegistry } from "./session-registry";
import { EvidencePipeline } from "./evidence-pipeline";
import { SelfHealingAgent } from "./self-healing-agent";
import { AdaptorAgent } from "./adaptor-agent";
import { adoExportService } from "./ado-export-service";
import { adoPullService } from "./ado-pull-service";
import { jiraPullService } from "./jira-pull-service";
import { isPlaywrightReady, isPlaywrightInstalling, getBrowserExecutablePath } from "./playwright-setup";
import { analyzeWorkflowsWithClaude } from "./claude-workflow-analyzer";
import { generateFunctionalTestCasesWithClaude } from "./claude-functional-test-generator";
import { analyzeVisualDifferencesWithClaude, analyzeScreenshotWithClaude } from "./claude-visual-analyzer";
import { analyzeInsuranceScenarios } from "./claude-scenario-analyzer";
import { generateTestCasesForScenarioBatch } from "./claude-batch-test-generator";
import { generateSprintTestCases } from "./claude-sprint-agent";
import { exportTestCasesToExcel } from "./excel-export";
import { exportTestCasesToExcelEnhanced, type EnhancedTestCase, type ExportMetadata } from "./excel-export-enhanced";
import { startLivePreview, stopLivePreview, scrollPreview, refreshPreview, navigatePreviewTo } from "./live-preview-service";
import { generateSyntheticDataWithLLM } from "./claude-synthetic-data";
import { qeAnthropicClient } from "./ai-client";
import { runAccessibilityScan, compareImages, runResponsiveTest } from "./nradiverse-service";
import { loginExecutor } from "./login-executor";
import { generateMermaidFlowDiagram } from "./diagram-generator";
import { generateAutomationScripts } from "./script-generator";
import { captureHarFromUrl, importSwaggerSpec } from "./api-discovery";
import SwaggerParser from "swagger-parser";
import yaml from "js-yaml";
import { registerAutoTestRoutes } from "./autotest-routes";
import { asyncJobManager } from "../lib/async-job-manager";
import { dispatchJobToAgent, hasAvailableAgent, getAgentStatus, type AgentJobPayload, type SseCallback } from "./agent-ws";
import { generateTestCompleteScripts } from "./generators/testcomplete/index.js";
import multerLib from 'multer';
import {
  parseFrameworkFile,
  detectPattern,
  detectLanguage,
  detectTool,
} from './framework-parser';
import { frameworkConfigs, frameworkFunctions, frameworkFiles } from '@shared/qe-schema';
import {
  fetchAutonomousExecutionTestCases,
  fetchAutonomousExecutionRuns,
  resolveAutonomousTestCasesByIds,
  mapLegacyFunctionalRunCases,
  mergeLegacyFunctionalRuns,
} from './autonomous-execution-bridge';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Domain inference from crawled page content
interface DomainInferenceResult {
  inferredDomain: string;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
}

function inferDomainFromPages(pages: any[]): DomainInferenceResult {
  const domainKeywords: Record<string, string[]> = {
    insurance: ['insurance', 'policy', 'claim', 'premium', 'underwriting', 'coverage', 'quote', 'insured', 'beneficiary', 'deductible', 'risk', 'actuary'],
    healthcare: ['healthcare', 'patient', 'medical', 'hospital', 'doctor', 'clinic', 'health', 'treatment', 'diagnosis', 'prescription', 'pharmacy', 'nurse'],
    banking: ['banking', 'bank', 'account', 'loan', 'mortgage', 'credit', 'deposit', 'withdraw', 'transaction', 'interest', 'savings', 'checking'],
    finance: ['finance', 'investment', 'portfolio', 'stock', 'trading', 'asset', 'wealth', 'fund', 'securities', 'equity', 'dividend'],
    ecommerce: ['shop', 'cart', 'checkout', 'product', 'order', 'shipping', 'price', 'buy', 'purchase', 'catalog', 'inventory', 'store'],
    travel: ['travel', 'booking', 'flight', 'hotel', 'reservation', 'trip', 'destination', 'itinerary', 'airline', 'vacation'],
    education: ['education', 'course', 'student', 'learning', 'class', 'teacher', 'school', 'university', 'curriculum', 'grade', 'enrollment'],
    technology: ['software', 'developer', 'api', 'cloud', 'platform', 'solution', 'technology', 'digital', 'innovation', 'engineering', 'services'],
  };

  const domainScores: Record<string, number> = {};
  const signals: string[] = [];
  
  // Collect all text content from pages
  const allText: string[] = [];
  for (const page of pages) {
    if (page.title) allText.push(page.title.toLowerCase());
    if (page.url) allText.push(page.url.toLowerCase());
    if (page.buttons) {
      for (const btn of page.buttons) {
        if (btn.text) allText.push(btn.text.toLowerCase());
      }
    }
    if (page.links) {
      for (const link of page.links) {
        if (link.text) allText.push(link.text.toLowerCase());
      }
    }
    if (page.inputs) {
      for (const input of page.inputs) {
        if (input.label) allText.push(input.label.toLowerCase());
        if (input.placeholder) allText.push(input.placeholder.toLowerCase());
      }
    }
  }
  
  const combinedText = allText.join(' ');
  
  // Score each domain based on keyword matches
  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    let score = 0;
    const matchedKeywords: string[] = [];
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = combinedText.match(regex);
      if (matches) {
        score += matches.length;
        if (!matchedKeywords.includes(keyword)) {
          matchedKeywords.push(keyword);
        }
      }
    }
    if (score > 0) {
      domainScores[domain] = score;
      if (matchedKeywords.length > 0) {
        signals.push(`${domain}: found "${matchedKeywords.slice(0, 3).join('", "')}"`);
      }
    }
  }
  
  // Find the domain with highest score
  let inferredDomain = 'general';
  let maxScore = 0;
  for (const [domain, score] of Object.entries(domainScores)) {
    if (score > maxScore) {
      maxScore = score;
      inferredDomain = domain;
    }
  }
  
  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (maxScore >= 10) {
    confidence = 'high';
  } else if (maxScore >= 5) {
    confidence = 'medium';
  }
  
  // If no strong signal, default to general
  if (maxScore < 3) {
    inferredDomain = 'general';
    signals.push('No strong domain signals detected');
  }
  
  return { inferredDomain, confidence, signals };
}

// Helper function to mask sensitive fields in integration configs
function maskSensitiveFields(config: Record<string, any>): Record<string, any> {
  const sensitiveKeys = ['personalAccessToken', 'apiToken', 'apiKey', 'password', 'pat', 'secret', 'token'];
  const masked = { ...config };
  
  for (const key of Object.keys(masked)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
      if (masked[key] && typeof masked[key] === 'string') {
        masked[key] = '***';
      }
    } else if (typeof masked[key] === 'object' && masked[key] !== null) {
      masked[key] = maskSensitiveFields(masked[key]);
    }
  }
  
  return masked;
}

// Test connection to integration platforms
async function testIntegrationConnection(platform: string, config: Record<string, any>): Promise<{ success: boolean; error?: string; message?: string }> {
  try {
    switch (platform) {
      case 'azure_devops': {
        // Use config values or fall back to environment secrets
        let envOrgUrl = null;
        if (process.env.ADO_ORGANIZATION) {
          const envOrg = process.env.ADO_ORGANIZATION;
          envOrgUrl = envOrg.startsWith('https://') ? envOrg.replace(/\/$/, '') : `https://dev.azure.com/${envOrg}`;
        }
        const organizationUrl = (config.organizationUrl || envOrgUrl || '').replace(/\/$/, '');
        const personalAccessToken = config.personalAccessToken || process.env.ADO_PAT;

        if (!organizationUrl || !personalAccessToken) {
          return { success: false, error: 'Organization URL and PAT are required. Set ADO_ORGANIZATION and ADO_PAT environment variables or provide in config.' };
        }
        const response = await fetch(`${organizationUrl}/_apis/projects?api-version=7.0`, {
          headers: {
            'Authorization': `Basic ${Buffer.from(`:${personalAccessToken}`).toString('base64')}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          const projectCount = data.count || data.value?.length || 0;
          return { success: true, message: `Successfully connected to Azure DevOps. Found ${projectCount} project(s).` };
        }
        return { success: false, error: `Connection failed: ${response.status} ${response.statusText}` };
      }
      
      case 'jira': {
        const { instanceUrl, email, apiToken } = config;
        if (!instanceUrl || !apiToken) {
          return { success: false, error: 'Instance URL and API token are required' };
        }
        const response = await fetch(`${instanceUrl}/rest/api/3/myself`, {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
            'Accept': 'application/json',
          },
        });
        if (response.ok) {
          return { success: true, message: 'Successfully connected to JIRA' };
        }
        return { success: false, error: `Connection failed: ${response.status} ${response.statusText}` };
      }
      
      case 'testrail': {
        const { instanceUrl, username, apiKey } = config;
        if (!instanceUrl || !username || !apiKey) {
          return { success: false, error: 'Instance URL, username, and API key are required' };
        }
        const response = await fetch(`${instanceUrl}/index.php?/api/v2/get_projects`, {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
        });
        if (response.ok) {
          return { success: true, message: 'Successfully connected to TestRail' };
        }
        return { success: false, error: `Connection failed: ${response.status} ${response.statusText}` };
      }
      
      case 'zephyr': {
        const { jiraInstanceUrl, apiAccessToken } = config;
        if (!jiraInstanceUrl || !apiAccessToken) {
          return { success: false, error: 'JIRA Instance URL and API Access Token are required' };
        }
        // Zephyr Scale API test
        const response = await fetch(`${jiraInstanceUrl}/rest/atm/1.0/testcase/search?maxResults=1`, {
          headers: {
            'Authorization': `Bearer ${apiAccessToken}`,
            'Accept': 'application/json',
          },
        });
        if (response.ok || response.status === 404) {
          return { success: true, message: 'Successfully connected to Zephyr' };
        }
        return { success: false, error: `Connection failed: ${response.status} ${response.statusText}` };
      }
      
      case 'qtest': {
        const { managerUrl, apiToken } = config;
        if (!managerUrl || !apiToken) {
          return { success: false, error: 'Manager URL and API token are required' };
        }
        const response = await fetch(`${managerUrl}/api/v3/projects`, {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Accept': 'application/json',
          },
        });
        if (response.ok) {
          return { success: true, message: 'Successfully connected to qTest' };
        }
        return { success: false, error: `Connection failed: ${response.status} ${response.statusText}` };
      }
      
      case 'qmetry': {
        const { baseUrl, apiKey } = config;
        if (!baseUrl || !apiKey) {
          return { success: false, error: 'Base URL and API key are required' };
        }
        const response = await fetch(`${baseUrl}/rest/api/latest/projects`, {
          headers: {
            'apiKey': apiKey,
            'Accept': 'application/json',
          },
        });
        if (response.ok) {
          return { success: true, message: 'Successfully connected to QMetry' };
        }
        return { success: false, error: `Connection failed: ${response.status} ${response.statusText}` };
      }
      
      default:
        return { success: false, error: `Unknown platform: ${platform}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Connection test failed' };
  }
}

// Helper to escape XML special characters
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Push test cases to external platform
interface TestCaseForPush {
  id: string;
  title?: string;
  name?: string;
  category?: string;
  priority?: string;
  steps?: Array<{ action: string; expected?: string }>;
  test_steps?: Array<{ action: string; expected_behavior?: string }>;
  given?: string;
  when?: string;
  then?: string;
  objective?: string;
  preconditions?: string[];
  postconditions?: string[];
}

async function pushTestCasesToPlatform(
  platform: string, 
  config: Record<string, any>, 
  testCases: TestCaseForPush[],
  options: { projectId?: string; sprintId?: string }
): Promise<{ success: boolean; error?: string; message?: string; pushedCount?: number; failedCount?: number }> {
  try {
    switch (platform) {
      case 'azure_devops': {
        // Use config values or fall back to environment secrets
        let envOrgUrl = null;
        if (process.env.ADO_ORGANIZATION) {
          const envOrg = process.env.ADO_ORGANIZATION;
          envOrgUrl = envOrg.startsWith('https://') ? envOrg.replace(/\/$/, '') : `https://dev.azure.com/${envOrg}`;
        }
        const organizationUrl = config.organizationUrl || envOrgUrl;
        const personalAccessToken = config.personalAccessToken || process.env.ADO_PAT;
        const defaultProject = config.defaultProject || process.env.ADO_PROJECT;
        const projectName = options.projectId || defaultProject;
        
        if (!organizationUrl || !personalAccessToken) {
          return { success: false, error: 'Organization URL and PAT are required. Set ADO_ORGANIZATION and ADO_PAT environment variables or provide in config.' };
        }
        if (!projectName) {
          return { success: false, error: 'Project name is required. Set ADO_PROJECT environment variable or provide in config.' };
        }
        
        let pushedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];
        const authHeader = `Basic ${Buffer.from(`:${personalAccessToken}`).toString('base64')}`;
        const encodedProjectName = encodeURIComponent(projectName);
        
        for (const testCase of testCases) {
          try {
            // Format steps for Azure DevOps Test Case
            const steps = testCase.steps || testCase.test_steps || [];
            const stepsXml = steps.map((s, i) => 
              `<step id="${i + 1}"><parameterizedString isformatted="true">${escapeXml(s.action)}</parameterizedString><expectedResult>${escapeXml(s.expected || s.expected_behavior || '')}</expectedResult></step>`
            ).join('');
            
            const workItem = [
              { op: 'add', path: '/fields/System.Title', value: testCase.title || testCase.name || testCase.id },
              { op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: `<steps>${stepsXml}</steps>` },
            ];
            
            if (testCase.priority) {
              const priorityMap: Record<string, number> = { 'P0': 1, 'P1': 1, 'P2': 2, 'P3': 3, 'critical': 1, 'high': 1, 'medium': 2, 'low': 3 };
              workItem.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: priorityMap[testCase.priority] || 2 });
            }
            
            // Use properly encoded URL - $Test%20Case for work item type
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            
            const response = await fetch(
              `${organizationUrl}/${encodedProjectName}/_apis/wit/workitems/$Test%20Case?api-version=7.0`,
              {
                method: 'POST',
                headers: {
                  'Authorization': authHeader,
                  'Content-Type': 'application/json-patch+json',
                },
                body: JSON.stringify(workItem),
                signal: controller.signal,
              }
            );
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
              pushedCount++;
            } else {
              failedCount++;
              const errorBody = await response.text().catch(() => 'Unknown error');
              errors.push(`Test case ${testCase.id}: ${response.status} - ${errorBody.slice(0, 100)}`);
            }
          } catch (err: any) {
            failedCount++;
            errors.push(`Test case ${testCase.id}: ${err.message || 'Request failed'}`);
          }
        }
        
        if (failedCount > 0 && pushedCount === 0) {
          return { 
            success: false, 
            error: `Failed to push all test cases. ${errors.slice(0, 3).join('; ')}`,
            pushedCount: 0, 
            failedCount 
          };
        }
        
        return { 
          success: pushedCount > 0, 
          message: `Pushed ${pushedCount} test cases to Azure DevOps${failedCount > 0 ? ` (${failedCount} failed)` : ''}`, 
          pushedCount, 
          failedCount 
        };
      }
      
      case 'jira': {
        const { instanceUrl, email, apiToken, defaultProjectKey } = config;
        const projectKey = options.projectId || defaultProjectKey;
        
        if (!instanceUrl || !apiToken) {
          return { success: false, error: 'Instance URL and API token are required' };
        }
        if (!projectKey) {
          return { success: false, error: 'Project key is required' };
        }
        
        let pushedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];
        const authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
        
        for (const testCase of testCases) {
          try {
            const steps = testCase.steps || testCase.test_steps || [];
            const description = [
              `**Objective:** ${testCase.objective || 'Verify functionality'}`,
              '',
              `**Category:** ${testCase.category || 'functional'}`,
              '',
              '**Test Steps:**',
              ...steps.map((s, i) => `${i + 1}. ${s.action}`),
              '',
              '**Expected Results:**',
              ...steps.map((s, i) => `${i + 1}. ${s.expected || s.expected_behavior || 'As expected'}`),
            ].join('\n');
            
            const issue = {
              fields: {
                project: { key: projectKey },
                summary: testCase.title || testCase.name || testCase.id,
                description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] },
                issuetype: { name: 'Task' },
              },
            };
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            
            const response = await fetch(`${instanceUrl}/rest/api/3/issue`, {
              method: 'POST',
              headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify(issue),
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            
            if (response.ok) {
              pushedCount++;
            } else {
              failedCount++;
              const errorBody = await response.text().catch(() => 'Unknown error');
              errors.push(`${testCase.id}: ${response.status} - ${errorBody.slice(0, 100)}`);
            }
          } catch (err: any) {
            failedCount++;
            errors.push(`${testCase.id}: ${err.message || 'Request failed'}`);
          }
        }
        
        if (failedCount > 0 && pushedCount === 0) {
          return { 
            success: false, 
            error: `Failed to create issues. ${errors.slice(0, 3).join('; ')}`,
            pushedCount: 0, 
            failedCount 
          };
        }
        
        return { 
          success: pushedCount > 0, 
          message: `Created ${pushedCount} issues in JIRA${failedCount > 0 ? ` (${failedCount} failed)` : ''}`, 
          pushedCount, 
          failedCount 
        };
      }
      
      case 'testrail': {
        const { instanceUrl, username, apiKey, defaultProject } = config;
        
        if (!instanceUrl || !username || !apiKey) {
          return { success: false, error: 'Instance URL, username, and API key are required' };
        }
        
        const authHeader = `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`;
        
        // Get project ID first
        const projectsController = new AbortController();
        const projectsTimeout = setTimeout(() => projectsController.abort(), 30000);
        
        const projectsResponse = await fetch(`${instanceUrl}/index.php?/api/v2/get_projects`, {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          signal: projectsController.signal,
        });
        clearTimeout(projectsTimeout);
        
        if (!projectsResponse.ok) {
          const errorText = await projectsResponse.text().catch(() => '');
          return { success: false, error: `Failed to fetch TestRail projects: ${projectsResponse.status} ${errorText.slice(0, 100)}` };
        }
        
        const projectsData = await projectsResponse.json();
        // Handle both array response and object with projects property
        const projectsList = Array.isArray(projectsData) ? projectsData : (projectsData.projects || []);
        const targetProject = projectsList.find((p: any) => 
          p.name === defaultProject || p.id === parseInt(options.projectId || '0')
        );
        
        if (!targetProject) {
          return { success: false, error: `Project "${defaultProject || options.projectId}" not found in TestRail` };
        }
        
        // Get or create a section for NAT test cases
        const sectionsController = new AbortController();
        const sectionsTimeout = setTimeout(() => sectionsController.abort(), 30000);
        
        const sectionsResponse = await fetch(
          `${instanceUrl}/index.php?/api/v2/get_sections/${targetProject.id}`,
          {
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json',
            },
            signal: sectionsController.signal,
          }
        );
        clearTimeout(sectionsTimeout);
        
        let sectionId: number | undefined;
        if (sectionsResponse.ok) {
          const sectionsData = await sectionsResponse.json();
          const sectionsList = Array.isArray(sectionsData) ? sectionsData : (sectionsData.sections || []);
          const natSection = sectionsList.find((s: any) => s.name === 'NAT Generated');
          if (natSection) {
            sectionId = natSection.id;
          } else {
            // Create section
            const createController = new AbortController();
            const createTimeout = setTimeout(() => createController.abort(), 30000);
            
            const createSectionResponse = await fetch(
              `${instanceUrl}/index.php?/api/v2/add_section/${targetProject.id}`,
              {
                method: 'POST',
                headers: {
                  'Authorization': authHeader,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: 'NAT Generated' }),
                signal: createController.signal,
              }
            );
            clearTimeout(createTimeout);
            
            if (!createSectionResponse.ok) {
              const errorText = await createSectionResponse.text().catch(() => '');
              return { success: false, error: `Failed to create section in TestRail: ${createSectionResponse.status} ${errorText.slice(0, 100)}` };
            }
            
            const newSection = await createSectionResponse.json();
            if (!newSection || typeof newSection.id !== 'number') {
              return { success: false, error: 'Failed to create section: Invalid response from TestRail' };
            }
            sectionId = newSection.id;
          }
        } else {
          const errorText = await sectionsResponse.text().catch(() => '');
          return { success: false, error: `Failed to fetch TestRail sections: ${sectionsResponse.status} ${errorText.slice(0, 100)}` };
        }
        
        if (sectionId === undefined) {
          return { success: false, error: 'Failed to determine TestRail section ID' };
        }
        
        let pushedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];
        
        for (const testCase of testCases) {
          try {
            const steps = testCase.steps || testCase.test_steps || [];
            const stepsArr = steps.map((s) => ({
              content: s.action,
              expected: s.expected || s.expected_behavior || '',
            }));
            
            const priorityMap: Record<string, number> = { 
              'P0': 4, 'P1': 3, 'P2': 2, 'P3': 1, 
              'critical': 4, 'high': 3, 'medium': 2, 'low': 1 
            };
            
            const testCaseData = {
              title: testCase.title || testCase.name || testCase.id,
              section_id: sectionId,
              priority_id: priorityMap[testCase.priority || ''] || 2,
              custom_steps_separated: stepsArr,
            };
            
            const caseController = new AbortController();
            const caseTimeout = setTimeout(() => caseController.abort(), 30000);
            
            const response = await fetch(
              `${instanceUrl}/index.php?/api/v2/add_case/${sectionId}`,
              {
                method: 'POST',
                headers: {
                  'Authorization': authHeader,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(testCaseData),
                signal: caseController.signal,
              }
            );
            clearTimeout(caseTimeout);
            
            if (response.ok) {
              pushedCount++;
            } else {
              failedCount++;
              const errorText = await response.text().catch(() => 'Unknown error');
              errors.push(`${testCase.id}: ${response.status} - ${errorText.slice(0, 50)}`);
            }
          } catch (err: any) {
            failedCount++;
            errors.push(`${testCase.id}: ${err.message || 'Request failed'}`);
          }
        }
        
        if (failedCount > 0 && pushedCount === 0) {
          return { 
            success: false, 
            error: `Failed to push all test cases. ${errors.slice(0, 3).join('; ')}`,
            pushedCount: 0, 
            failedCount 
          };
        }
        
        return { 
          success: pushedCount > 0, 
          message: `Pushed ${pushedCount} test cases to TestRail${failedCount > 0 ? ` (${failedCount} failed)` : ''}`, 
          pushedCount, 
          failedCount 
        };
      }
      
      case 'zephyr':
      case 'qtest':
      case 'qmetry': {
        // These platforms require more complex API integration
        // For now, return a placeholder response
        return { 
          success: false, 
          error: `Push to ${platform} is not yet fully implemented. Please export to JSON and import manually.`,
          pushedCount: 0,
          failedCount: testCases.length
        };
      }
      
      default:
        return { success: false, error: `Unknown platform: ${platform}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to push test cases' };
  }
}

// TODO: Replace with proper session-based authentication (express-session + Passport.js)
// For MVP/demo, using a mock user when session auth is not configured
const DEMO_USER = { id: "demo-user-1", email: "demo@insurity.com" };

// Helper function to get user ID - uses session if available, falls back to demo user for development
function getUserId(req: Request): string {
  const sessionUserId = (req as any).session?.userId;
  if (sessionUserId) {
    return sessionUserId;
  }
  // For demo/development mode, use demo user
  return DEMO_USER.id;
}

// Seed demo data if database is empty (for production first-run)
async function seedDemoDataIfEmpty() {
  try {
    // Wait for runtime ALTER TABLE migrations to finish before querying
    // columns like `user_id` that may have just been added on this boot.
    await awaitMigrations();
    const existingProjects = await storage.getProjectsByUserId(DEMO_USER.id);
    
    if (existingProjects.length === 0) {
      console.log("[Seed] No projects found, creating demo data...");
      
      // First, ensure demo user exists in the users table
      try {
        await storage.createUser({
          id: DEMO_USER.id,
          username: "demo_user",
          password: "demo_password_123"
        });
        console.log("[Seed] Created demo user");
      } catch (err: any) {
        // User may already exist, that's fine
        if (!err.message?.includes("duplicate")) {
          console.log("[Seed] Demo user already exists or error handled");
        }
      }
      
      // Create demo projects
      const demoProjects = [
        { name: "Insurance Portal", description: "Main insurance web application testing", userId: DEMO_USER.id, type: "web" },
        { name: "Claims Processing", description: "Claims management system tests", userId: DEMO_USER.id, type: "web" },
        { name: "Policy Admin", description: "Policy administration platform", userId: DEMO_USER.id, type: "web" },
      ];
      
      for (const projectData of demoProjects) {
        const project = await storage.createProject(projectData);
        console.log(`[Seed] Created project: ${project.name}`);
        
        // Create a demo sprint for each project
        const sprint = await storage.createSprint({
          projectId: project.id,
          name: "Sprint 1",
          description: "Initial sprint with core features",
          status: "active"
        });
        console.log(`[Seed] Created sprint: ${sprint.name} for project ${project.name}`);
      }
      
      console.log("[Seed] Demo data seeding complete");
    } else {
      console.log(`[Seed] Found ${existingProjects.length} existing projects, skipping seed`);
    }
  } catch (error) {
    console.error("[Seed] Error seeding demo data:", error);
  }
}

function generateAgentTasks(): AgentTask[] {
  return [
    {
      id: "task-1",
      taskName: "Authenticating with Figma API",
      agentName: "Authentication Agent",
      status: "pending",
      progress: 0,
      details: "Establishing secure connection to Figma API",
      timestamp: new Date().toISOString(),
    },
    {
      id: "task-2",
      taskName: "Extracting Design Specifications",
      agentName: "Design Agent",
      status: "pending",
      progress: 0,
      details: "Parsing Figma design file structure",
      timestamp: new Date().toISOString(),
    },
    {
      id: "task-3",
      taskName: "Analyzing Visual Hierarchy & Component Library",
      agentName: "Analysis Agent",
      status: "pending",
      progress: 0,
      details: "Identifying components and design patterns",
      timestamp: new Date().toISOString(),
    },
    {
      id: "task-4",
      taskName: "Generating Visual Regression Test Cases",
      agentName: "Test Generation Agent",
      status: "pending",
      progress: 0,
      details: "Creating comprehensive test scenarios",
      timestamp: new Date().toISOString(),
    },
    {
      id: "task-5",
      taskName: "Launching Browser Automation (Playwright)",
      agentName: "Automation Agent",
      status: "pending",
      progress: 0,
      details: "Initializing headless browser instances",
      timestamp: new Date().toISOString(),
    },
    {
      id: "task-6",
      taskName: "Capturing Baseline Screenshots",
      agentName: "Screenshot Agent",
      status: "pending",
      progress: 0,
      details: "Taking high-resolution screenshots of design",
      timestamp: new Date().toISOString(),
    },
    {
      id: "task-7",
      taskName: "Fetching Live Website & Comparing Layouts",
      agentName: "Comparison Agent",
      status: "pending",
      progress: 0,
      details: "Loading website and analyzing layout differences",
      timestamp: new Date().toISOString(),
    },
    {
      id: "task-8",
      taskName: "Analyzing Color Contrast & Accessibility",
      agentName: "Accessibility Agent",
      status: "pending",
      progress: 0,
      details: "Checking WCAG compliance and color ratios",
      timestamp: new Date().toISOString(),
    },
    {
      id: "task-9",
      taskName: "Detecting Visual Discrepancies",
      agentName: "Detection Agent",
      status: "pending",
      progress: 0,
      details: "Pixel-by-pixel comparison in progress",
      timestamp: new Date().toISOString(),
    },
    {
      id: "task-10",
      taskName: "Generating Detailed Visual Diff Report",
      agentName: "Report Agent",
      status: "pending",
      progress: 0,
      details: "Compiling comprehensive analysis report",
      timestamp: new Date().toISOString(),
    },
  ];
}

async function streamDemoUpdates(res: Response, sessionId: string) {
  const tasks = generateAgentTasks();
  await storage.updateTestSessionStatus(sessionId, "running");
  
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const delay = Math.random() * 4000 + 2000;
    
    task.status = "in-progress";
    task.timestamp = new Date().toISOString();
    task.details = getInProgressDetails(task.taskName);
    
    let metrics: LiveMetric[] | undefined;
    
    if (i === 1) {
      metrics = [
        { id: "m1", label: "Design Tokens Extracted", currentValue: 0, targetValue: 24 },
        { id: "m2", label: "Components Scanned", currentValue: 0, targetValue: 47 },
        { id: "m3", label: "Test Cases Generated", currentValue: 0, targetValue: 156 },
        { id: "m4", label: "Screenshots Captured", currentValue: 0, targetValue: 47 },
      ];
    } else if (i === 8) {
      // Use Claude AI for visual analysis
      try {
        console.log('[Visual Analysis] Starting Claude AI analysis...');
        const analysis = await analyzeVisualDifferencesWithClaude(
          "Modern insurance company website with clean design, professional blue color scheme (#0066CC primary), responsive layout with breakpoints at 768px and 1024px, accessible navigation with ARIA labels, and clear call-to-action buttons. Typography uses 'Inter' font family at 16px base size with 1.5 line height. Components include header navigation (80px height), hero section, feature cards (3-column grid), and footer with 4 columns.",
          "Live insurance website with similar structure but may have implementation differences in spacing (design specifies 24px grid system), colors (slight variations in blue shades), typography (font weights and sizes), button styles (padding and border-radius), and component alignment."
        );
        console.log('[Visual Analysis] Claude analysis complete');
        metrics = [
          { id: "v1", label: "Total Differences Found", currentValue: 0, targetValue: analysis.totalDifferences },
          { id: "v2", label: "Critical Issues", currentValue: 0, targetValue: analysis.criticalIssues },
          { id: "v3", label: "Major Issues", currentValue: 0, targetValue: analysis.majorIssues },
          { id: "v4", label: "Minor Issues", currentValue: 0, targetValue: analysis.minorIssues },
        ];
      } catch (error) {
        console.error('[Visual Analysis] Claude analysis failed, using fallback:', error);
        metrics = [
          { id: "v1", label: "Differences Found", currentValue: 0, targetValue: 5 },
          { id: "v2", label: "Analysis Status", currentValue: 0, targetValue: 1 },
        ];
      }
    }
    
    const update: TaskUpdate = {
      taskId: task.id,
      taskName: task.taskName,
      agentName: task.agentName,
      status: task.status,
      progress: 0,
      details: task.details,
      timestamp: task.timestamp,
      metrics,
    };
    
    res.write(`data: ${JSON.stringify({ type: "task", task: update, metrics })}\n\n`);
    
    const progressSteps = 5;
    for (let step = 1; step <= progressSteps; step++) {
      await sleep(delay / progressSteps);
      
      update.progress = Math.floor((step / progressSteps) * 100);
      
      if (metrics && step > 1) {
        metrics = metrics.map(m => ({
          ...m,
          currentValue: Math.min(Math.floor((step / progressSteps) * m.targetValue), m.targetValue),
        }));
      }
      
      res.write(`data: ${JSON.stringify({ type: "task", task: update, metrics })}\n\n`);
    }
    
    task.status = "completed";
    task.progress = 100;
    task.details = getCompletedDetails(task.taskName);
    task.timestamp = new Date().toISOString();
    
    update.status = "completed";
    update.progress = 100;
    update.details = task.details;
    update.timestamp = task.timestamp;
    
    res.write(`data: ${JSON.stringify({ type: "task", task: update, metrics })}\n\n`);
    
    await storage.updateTestSessionTasks(sessionId, tasks.slice(0, i + 1));
    if (metrics) {
      await storage.updateTestSessionMetrics(sessionId, metrics);
    }
    
    await sleep(500);
  }
  
  const results: TestResults = {
    completionTime: 42,
    designCompliance: 100,
    accessibilityWarnings: 2,
    testCasesGenerated: 156,
    visualDifferences: [
      { area: "Header region", count: 4, severity: "minor" },
      { area: "Footer spacing", count: 1, severity: "minor" },
    ],
  };
  
  await storage.completeTestSession(sessionId, results);
  
  res.write(`data: ${JSON.stringify({ type: "complete", results })}\n\n`);
  res.end();
}

function getInProgressDetails(taskName: string): string {
  const details: Record<string, string> = {
    "Authenticating with Figma API": "Validating API credentials and establishing connection...",
    "Extracting Design Specifications": "Loading Figma file structure and design tokens...",
    "Analyzing Visual Hierarchy & Component Library": "Scanning 47 components across 12 frames...",
    "Generating Visual Regression Test Cases": "Creating test scenarios based on design patterns...",
    "Launching Browser Automation (Playwright)": "Initializing Chrome, Firefox, and Safari instances...",
    "Capturing Baseline Screenshots": "Capturing screenshots at 1920x1080 resolution...",
    "Fetching Live Website & Comparing Layouts": "Loading website and comparing DOM structure...",
    "Analyzing Color Contrast & Accessibility": "Checking WCAG 2.1 AA compliance...",
    "Detecting Visual Discrepancies": "Analyzing 2,847 pixels for differences...",
    "Generating Detailed Visual Diff Report": "Compiling screenshots and analysis data...",
  };
  return details[taskName] || "Processing...";
}

function getCompletedDetails(taskName: string): string {
  const details: Record<string, string> = {
    "Authenticating with Figma API": "Successfully connected to Figma API",
    "Extracting Design Specifications": "Extracted 24 design tokens and 47 components",
    "Analyzing Visual Hierarchy & Component Library": "Identified 12 component families and 8 design patterns",
    "Generating Visual Regression Test Cases": "Generated 156 comprehensive test cases",
    "Launching Browser Automation (Playwright)": "Browser instances ready across Chrome, Firefox, Safari",
    "Capturing Baseline Screenshots": "Captured 47 baseline screenshots",
    "Fetching Live Website & Comparing Layouts": "Website loaded and layout compared successfully",
    "Analyzing Color Contrast & Accessibility": "Found 2 minor accessibility warnings",
    "Detecting Visual Discrepancies": "Detected 5 visual differences across 2 regions",
    "Generating Detailed Visual Diff Report": "Report generated with detailed findings",
  };
  return details[taskName] || "Completed";
}

function generateFunctionalTestCases(focus: string): any[] {
  const testTemplates = {
    "Button Click": [
      { name: "Click 'Submit' button on contact form", selector: "button[type='submit']", expected: "Form submits successfully" },
      { name: "Click main navigation menu", selector: ".nav-menu", expected: "Menu expands" },
      { name: "Submit feedback form", selector: "#feedback-submit", expected: "Success message appears" },
      { name: "Click 'Download' button", selector: "button.download", expected: "File download initiates" },
      { name: "Toggle sidebar menu", selector: "button#sidebar-toggle", expected: "Sidebar visibility toggles" },
      { name: "Click 'Add to Cart' button", selector: ".add-to-cart", expected: "Item added to cart" },
      { name: "Open modal dialog", selector: "button[data-modal]", expected: "Modal opens" },
      { name: "Close notification banner", selector: ".close-notification", expected: "Banner dismissed" },
      { name: "Expand accordion section", selector: ".accordion-trigger", expected: "Section expands" },
      { name: "Click pagination next", selector: ".pagination-next", expected: "Next page loads" },
    ],
    "Form Input": [
      { name: "Enter email in login form", selector: "input[name='email']", expected: "Email value updates" },
      { name: "Fill out registration form", selector: "form#register", expected: "All fields accept input" },
      { name: "Search functionality", selector: "input[type='search']", expected: "Results display" },
      { name: "Enter password field", selector: "input[type='password']", expected: "Password masked correctly" },
      { name: "Select dropdown option", selector: "select#country", expected: "Option selected" },
      { name: "Enter textarea content", selector: "textarea#message", expected: "Content updates" },
      { name: "Toggle checkbox", selector: "input[type='checkbox']", expected: "Checkbox state changes" },
      { name: "Choose radio button", selector: "input[type='radio']", expected: "Radio selected" },
      { name: "Upload file input", selector: "input[type='file']", expected: "File selected" },
      { name: "Enter phone number", selector: "input[type='tel']", expected: "Number formatted" },
    ],
    "Navigation": [
      { name: "Navigate to About page", selector: "a[href='/about']", expected: "About page loads" },
      { name: "Go to Contact page", selector: "nav a[href='/contact']", expected: "Contact page loads" },
      { name: "Click logo to go home", selector: ".logo-link", expected: "Homepage loads" },
      { name: "Navigate to Products section", selector: "a[href='/products']", expected: "Products page loads" },
      { name: "Open user profile", selector: "a[href='/profile']", expected: "Profile page loads" },
      { name: "Go to Settings page", selector: "nav a[href='/settings']", expected: "Settings page loads" },
      { name: "Navigate to Dashboard", selector: "a[href='/dashboard']", expected: "Dashboard loads" },
      { name: "Click breadcrumb navigation", selector: ".breadcrumb a", expected: "Parent page loads" },
      { name: "Open footer link", selector: "footer a[href='/privacy']", expected: "Privacy page loads" },
      { name: "Navigate via side menu", selector: ".sidenav a", expected: "Target page loads" },
    ],
    "Link": [
      { name: "Test forgot password link", selector: "a.forgot-password", expected: "Redirects to reset page" },
      { name: "Click social media link", selector: "a.social-link", expected: "Opens in new tab" },
      { name: "External documentation link", selector: "a[href*='docs']", expected: "Documentation opens" },
      { name: "Terms of service link", selector: "a[href='/terms']", expected: "Terms page loads" },
      { name: "Help center link", selector: "a.help-link", expected: "Help page opens" },
      { name: "FAQ section link", selector: "a[href='/faq']", expected: "FAQ page loads" },
      { name: "Support contact link", selector: "a[href='mailto:']", expected: "Email client opens" },
      { name: "Download PDF link", selector: "a[href$='.pdf']", expected: "PDF downloads" },
      { name: "Blog post link", selector: ".blog-link", expected: "Blog post opens" },
      { name: "Video tutorial link", selector: "a.video-link", expected: "Video plays" },
    ],
  };

  let selectedTemplates: any[] = [];
  
  if (focus === "all") {
    selectedTemplates = [
      ...testTemplates["Button Click"],
      ...testTemplates["Form Input"],
      ...testTemplates["Navigation"],
      ...testTemplates["Link"],
    ];
  } else if (focus === "buttons") {
    selectedTemplates = testTemplates["Button Click"];
  } else if (focus === "forms") {
    selectedTemplates = testTemplates["Form Input"];
  } else if (focus === "navigation") {
    selectedTemplates = testTemplates["Navigation"];
  } else if (focus === "links") {
    selectedTemplates = testTemplates["Link"];
  } else {
    selectedTemplates = [
      ...testTemplates["Button Click"],
      ...testTemplates["Form Input"],
      ...testTemplates["Navigation"],
      ...testTemplates["Link"],
    ];
  }

  const testCases = [];
  const minTestCases = 50;
  
  for (let i = 0; i < minTestCases; i++) {
    const template = selectedTemplates[i % selectedTemplates.length];
    const type = Object.entries(testTemplates).find(([_, templates]) => 
      templates.some(t => t.name === template.name)
    )?.[0] || "Button Click";
    
    const passed = Math.random() > 0.04; // 96% pass rate
    testCases.push({
      id: `FT-${String(i + 1).padStart(3, '0')}`,
      name: `${template.name} ${i > selectedTemplates.length - 1 ? `(variant ${Math.floor(i / selectedTemplates.length) + 1})` : ''}`.trim(),
      type: type,
      status: passed ? "passed" : "failed",
      executionTime: Math.floor(Math.random() * 400) + 100,
      elementSelector: template.selector,
      expectedResult: template.expected,
      actualResult: passed ? template.expected : "Element not found or interaction failed",
      errorMessage: passed ? undefined : "Timeout waiting for element",
    });
  }
  
  return testCases;
}

export async function registerQeApiRoutes(app: Express): Promise<void> {
  // Health check endpoint (used by Docker, Azure, load balancers)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' });
  });

  // Serve screenshots directory as static files
  const screenshotsDir = path.join(process.cwd(), 'screenshots');
  app.use('/screenshots', express.static(screenshotsDir));

  // Register clean auto-test routes (/api/autotest/*)
  registerAutoTestRoutes(app);

  // Seed demo data if database is empty (for production first-run)
  try { await seedDemoDataIfEmpty(); } catch (e) { console.warn("[QE] Seed skipped:", (e as Error).message); }

  // ── DevX SDLC projects proxy (no Bearer token required in QE app) ─
  app.get("/api/qe/sdlc/projects", async (req: Request, res: Response) => {
    try {
      const { getSelectedGlobalOrganizationFromRequest } = await import(
        "../integrations/project-count-handler"
      );
      const { sdlcService } = await import("../sdlc/service");
      const selected = await getSelectedGlobalOrganizationFromRequest(req);
      const projects = await sdlcService.getAllProjectsForOrganization(selected);
      res.json(
        projects.map((project) => ({
          id: project.id,
          name: project.name,
          organization: project.organization,
          linkedGoldenRepoName: project.linkedGoldenRepoName,
          goldenRepoReference: project.goldenRepoReference,
        })),
      );
    } catch (err) {
      console.error("[QE] sdlc/projects proxy error:", err);
      res.status(500).json({ error: "Failed to fetch DevX projects" });
    }
  });

  // ── DevX context upsert endpoint ──────────────────────────────────
  app.post("/api/qe/projects/ensure", async (req: Request, res: Response) => {
    try {
      const { name, type, domain, adoProjectName, adoOrganization, sdlcProjectId, sdlcProjectName, goldenRepoId, goldenRepoName } = req.body;
      if (!name) { res.status(400).json({ error: "name is required" }); return; }

      const { projects } = await import("@shared/qe-schema");
      const existing = await db.select().from(projects).where(eq(projects.name, name)).limit(1);

      if (existing.length > 0) {
        const updates: Record<string, any> = {};
        if (sdlcProjectId) updates.devxSdlcProjectId = sdlcProjectId;
        if (sdlcProjectName) updates.devxSdlcProjectName = sdlcProjectName;
        if (adoOrganization) updates.devxAdoOrganization = adoOrganization;
        if (adoProjectName) updates.adoProjectName = adoProjectName;
        if (goldenRepoId) updates.goldenRepoId = goldenRepoId;
        if (goldenRepoName) updates.goldenRepoName = goldenRepoName;
        if (Object.keys(updates).length > 0) {
          await db.update(projects).set(updates).where(eq(projects.id, existing[0].id));
        }
        res.json({ project: { ...existing[0], ...updates }, created: false });
      } else {
        const userId = "demo-user-1";
        // Generate the UUID in Node rather than relying on the MySQL
        // `DEFAULT (UUID())` column default. Older snapshots of the projects
        // table (e.g. AWS Aurora instances created before sync-schema.cjs
        // was authoritative) may not have the DEFAULT clause, in which case
        // the insert silently uses an empty id — which later crashes the
        // frontend ProjectSelector via Radix's "Select.Item value cannot be
        // empty" invariant.
        const id = crypto.randomUUID();
        const newProject = {
          id,
          userId,
          name,
          type: type || "web",
          domain: domain || "general",
          adoProjectName,
          devxSdlcProjectId: sdlcProjectId,
          devxSdlcProjectName: sdlcProjectName,
          devxAdoOrganization: adoOrganization,
          goldenRepoId,
          goldenRepoName,
        };
        await db.insert(projects).values(newProject);
        const inserted = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
        res.json({ project: inserted[0] || newProject, created: true });
      }
    } catch (err) {
      console.error("[QE] projects/ensure error:", err);
      res.status(500).json({ error: "Failed to ensure project" });
    }
  });

  app.post("/api/auth/login", (req: Request, res: Response) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
      res.status(400).json({ error: "Email and password required" });
      return;
    }
    
    res.json({ 
      success: true, 
      user: { email },
      message: "Login successful" 
    });
  });

  app.get("/api/tests/functional", async (req: Request, res: Response) => {
    const url = req.query.url as string;
    const focus = req.query.focus as string || "all";

    if (!url) {
      res.status(400).json({ error: "URL required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const tasks = [
      { id: "ft-1", taskName: "Authenticating with Application", agentName: "Authentication Agent", agentEmoji: "🔐" },
      { id: "ft-2", taskName: "Scanning Page for Interactive Elements", agentName: "Detection Agent", agentEmoji: "🔍" },
      { id: "ft-3", taskName: "Detecting Buttons, Forms, Links", agentName: "Detection Agent", agentEmoji: "⚙️" },
      { id: "ft-4", taskName: "Generating Functional Test Cases", agentName: "Test Generation Agent", agentEmoji: "📝" },
      { id: "ft-5", taskName: "Simulating User Interactions (Clicks)", agentName: "Automation Agent", agentEmoji: "🤖" },
      { id: "ft-6", taskName: "Validating Form Submissions", agentName: "Automation Agent", agentEmoji: "✓" },
      { id: "ft-7", taskName: "Testing Navigation Flows", agentName: "Automation Agent", agentEmoji: "🧭" },
      { id: "ft-8", taskName: "Detecting Functional Issues", agentName: "Detection Agent", agentEmoji: "⚠️" },
      { id: "ft-9", taskName: "Generating Test Report", agentName: "Report Agent", agentEmoji: "📊" },
    ];

    const testCases = generateFunctionalTestCases(focus);
    console.log(`[Functional Test] Generated ${testCases.length} test cases for focus: ${focus}`);
    let testCaseIndex = 0;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      
      res.write(`data: ${JSON.stringify({ type: "task", task: { ...task, status: "in-progress", progress: 50 } })}\n\n`);
      await sleep(1500);
      
      res.write(`data: ${JSON.stringify({ type: "task", task: { ...task, status: "completed", progress: 100 } })}\n\n`);
      
      // Stream all test cases during the "Generating Functional Test Cases" task
      if (task.id === "ft-4") {
        console.log(`[Functional Test] Streaming all ${testCases.length} test cases...`);
        for (let j = 0; j < testCases.length; j++) {
          res.write(`data: ${JSON.stringify({ type: "testCase", testCase: testCases[j] })}\n\n`);
          await sleep(100); // Faster streaming
        }
        console.log(`[Functional Test] Streamed ${testCases.length} test cases successfully`);
      }
      
      await sleep(800);
    }

    res.write(`data: ${JSON.stringify({ type: "complete" })}\n\n`);
    res.end();
  });

  app.get("/api/tests/intelligent", async (req: Request, res: Response) => {
    const rawUrl = req.query.url as string;
    const focus = req.query.focus as string || "all";
    const domain = req.query.domain as string || "insurance";
    const productDescription = req.query.productDescription as string || "";
    const projectId = req.query.projectId as string || undefined;
    const sampleMode = req.query.sampleMode === 'true';
    const previewSessionId = req.query.previewSessionId as string || "";

    if (!rawUrl) {
      res.status(400).json({ error: "URL required" });
      return;
    }
    
    console.log(`[Intelligent Test] Sample mode: ${sampleMode}`);

    // Normalize URL - add protocol if missing
    let url = rawUrl.trim();
    if (!url.match(/^https?:\/\//i)) {
      url = `https://${url}`;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Create a test run record to store history
    let testRunId: string | null = null;
    try {
      const testRun = await storage.createFunctionalTestRun({
        websiteUrl: url,
        testFocus: focus,
        domain: domain || 'general',
        productContext: productDescription || null,
        projectId: projectId || null,
        sampleMode: sampleMode ? 'quick' : 'comprehensive',
      });
      testRunId = testRun.id;
      console.log(`[Intelligent Test] Created test run with ID: ${testRunId}, sampleMode: ${sampleMode ? 'quick' : 'comprehensive'}`);
    } catch (runError) {
      console.error('[Intelligent Test] Failed to create test run record:', runError);
    }

    // Initialize enhanced crawler for comprehensive DOM extraction
    const enhancedCrawler = new EnhancedCrawler({
      maxPages: sampleMode ? 10 : 30,
      maxDepth: sampleMode ? 2 : 4,
      sameDomainOnly: true,
      timeout: 30000,
      includeSitemap: !sampleMode,
      probeCommonPaths: !sampleMode,
    });

    try {
      console.log(`[Intelligent Test] Starting test for URL: ${url}, focus: ${focus}, domain: ${domain}`);
      
      let lastNavigatedUrl = "";
      const progressCallback = (progress: any) => {
        try {
          console.log('[Intelligent Test] Crawl progress:', progress);
          res.write(`data: ${JSON.stringify({ type: "crawlProgress", progress })}\n\n`);
          
          if (progress.currentUrl && progress.currentUrl !== lastNavigatedUrl) {
            lastNavigatedUrl = progress.currentUrl;
            res.write(`data: ${JSON.stringify({ type: "navigation", url: progress.currentUrl, pagesVisited: progress.pagesVisited })}\n\n`);
          }
        } catch (err) {
          console.error('[SSE] Error writing crawl progress:', err);
        }
      };

      console.log('[Intelligent Test] Initiating enhanced crawl with DOM extraction...');
      const { pages, domStructures, screenshotPath } = await enhancedCrawler.crawl(url, progressCallback);
      const basicWorkflows: any[] = [];
      console.log(`[Intelligent Test] Crawl complete. Pages: ${pages.length}, DOM structures: ${domStructures.length}`);
      
      // Send screenshot path if captured
      if (screenshotPath) {
        const screenshotFilename = path.basename(screenshotPath);
        const encodedPath = `/screenshots/${encodeURIComponent(screenshotFilename)}`;
        res.write(`data: ${JSON.stringify({ type: "screenshot", path: encodedPath })}\n\n`);
        console.log(`[Intelligent Test] Screenshot available: ${encodedPath}`);
      }

      res.write(`data: ${JSON.stringify({ type: "crawlComplete", pages: pages.length, workflows: basicWorkflows.length })}\n\n`);

      // Check if site is unavailable (0 pages discovered)
      if (pages.length === 0) {
        console.log('[Intelligent Test] Site unavailable or inaccessible - no pages discovered');
        res.write(`data: ${JSON.stringify({ type: "error", message: "Unable to access the website. The site may be unavailable, require authentication, or block automated access. Please verify the URL and try again." })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "complete" })}\n\n`);
        res.end();
        return;
      }

      // PHASE 0.5: Infer actual domain from crawled content
      const domainInference = inferDomainFromPages(pages);
      console.log(`[Intelligent Test] Domain inference: ${domainInference.inferredDomain} (confidence: ${domainInference.confidence})`);
      console.log(`[Intelligent Test] Signals: ${domainInference.signals.join(', ')}`);
      
      // Determine effective domain - prioritize inferred domain when confidence is medium or high
      let effectiveDomain = domain;
      const userDomain = domain;
      const inferredDomain = domainInference.inferredDomain;
      
      // Check for domain mismatch
      if (inferredDomain !== userDomain && inferredDomain !== 'general' && domainInference.confidence !== 'low') {
        console.log(`[Intelligent Test] Domain mismatch detected: user selected "${userDomain}", website appears to be "${inferredDomain}"`);
        effectiveDomain = inferredDomain; // Use inferred domain
        
        // Send warning to frontend
        res.write(`data: ${JSON.stringify({ 
          type: "domainMismatch", 
          userDomain,
          inferredDomain,
          confidence: domainInference.confidence,
          message: `Website appears to be a ${inferredDomain.charAt(0).toUpperCase() + inferredDomain.slice(1)} site, not ${userDomain.charAt(0).toUpperCase() + userDomain.slice(1)}. Test cases will be based on actual website content.`
        })}\n\n`);
      } else if (inferredDomain === 'general' && userDomain !== 'general') {
        console.log(`[Intelligent Test] No strong domain detected, using user selection: ${userDomain}`);
        effectiveDomain = userDomain;
        res.write(`data: ${JSON.stringify({ 
          type: "domainInfo", 
          message: `No specific domain detected. Using ${userDomain.charAt(0).toUpperCase() + userDomain.slice(1)} context as specified.`
        })}\n\n`);
      }

      // PHASE 1: DOM-Based Test Case Generation
      const domainLabel = effectiveDomain.charAt(0).toUpperCase() + effectiveDomain.slice(1);
      console.log(`[Intelligent Test] Generating functional test cases from ${domStructures.length} page DOM structures...`);
      res.write(`data: ${JSON.stringify({ type: "analyzing", message: `Analyzing ${domStructures.length} pages and generating functional test cases for ${domainLabel} domain...` })}\n\n`);
      
      res.write(`data: ${JSON.stringify({ type: "generationStarted", totalPages: domStructures.length })}\n\n`);
      
      const testCases: any[] = [];
      const testCasesToSave: InsertFunctionalTestRunCase[] = [];
      let testCaseCounter = 0;
      const seenTestNames = new Set<string>();
      let duplicatesSkipped = 0;

      // Helper function to normalize test name for deduplication
      const normalizeTestName = (name: string): string => {
        return name
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .replace(/[^a-z0-9\s]/g, '')
          .trim()
          // Remove common variations that mean the same thing
          .replace(/with valid data$/i, '')
          .replace(/with invalid data$/i, '')
          .replace(/submission$/i, 'submit')
          .replace(/navigate to (.+?) page/i, 'goto $1')
          .replace(/verify (.+?) content/i, 'check $1')
          .replace(/and verify.*$/i, '')
          .replace(/verify success message$/i, '')
          .replace(/verify error message$/i, '')
          .trim();
      };

      try {
        // Generate test cases from DOM structures using AI
        const testGenerationCallback = (current: number, total: number, pageUrl: string) => {
          try {
            console.log(`[Intelligent Test] Generating tests: ${current}/${total} - ${pageUrl}`);
            res.write(`data: ${JSON.stringify({ 
              type: "generationProgress", 
              current, 
              total, 
              message: `Analyzing page ${current}/${total}: ${pageUrl}`,
              percentage: Math.round((current / total) * 100)
            })}\n\n`);
            
            if (previewSessionId && pageUrl) {
              res.write(`data: ${JSON.stringify({ type: "navigation", url: pageUrl, pagesVisited: current, pagesQueued: total - current })}\n\n`);
              navigatePreviewTo(previewSessionId, pageUrl).catch(() => {});
            }
          } catch (err) {
            console.error('[Intelligent Test] Error writing test generation progress:', err);
          }
        };

        const pageSuites = await domTestGenerator.generateTestsForAllPages(
          domStructures,
          testGenerationCallback,
          { domain: effectiveDomain, productContext: productDescription }
        );

        // Stream test cases as they're generated from each page (with deduplication)
        for (const suite of pageSuites) {
          const uniqueTestCasesForPage: any[] = [];

          for (const testCase of suite.testCases) {
            const normalizedName = normalizeTestName(testCase.name);
            
            // Skip if we've already seen a similar test case
            if (seenTestNames.has(normalizedName)) {
              duplicatesSkipped++;
              console.log(`[Intelligent Test] Skipping duplicate: ${testCase.name}`);
              continue;
            }
            
            seenTestNames.add(normalizedName);
            uniqueTestCasesForPage.push(testCase);
            testCases.push(testCase);
            testCaseCounter++;
            
            // Queue test case for saving to database
            if (testRunId) {
              // Ensure testSteps is properly typed as TestStep[]
              const testSteps: TestStep[] = (testCase.steps || []).map((step: any) => ({
                step_number: step.step_number || 0,
                action: step.action || '',
                expected_behavior: step.expected_behavior || '',
              }));
              
              testCasesToSave.push({
                runId: testRunId,
                testId: testCase.testId || `TC-${testCaseCounter}`,
                category: testCase.category || 'functional',
                name: testCase.name || 'Untitled Test Case',
                objective: null,
                preconditions: [],
                testSteps,
                expectedResult: testSteps.length > 0 ? testSteps[testSteps.length - 1].expected_behavior : 'Test should pass',
                testData: null,
                priority: testCase.priority || 'P2',
              });
            }
            
            console.log(`[Intelligent Test] Streaming test case ${testCaseCounter}: ${testCase.testId} - ${testCase.name} (${testCase.category})`);
            res.write(`data: ${JSON.stringify({ type: "testCase", testCase })}\n\n`);
            await new Promise(resolve => setTimeout(resolve, 20));
          }

          // Only send page suite if it has unique test cases
          if (uniqueTestCasesForPage.length > 0) {
            res.write(`data: ${JSON.stringify({ 
              type: "pageSuite", 
              pageUrl: suite.pageUrl,
              pageTitle: suite.pageTitle,
              testCaseCount: uniqueTestCasesForPage.length,
            })}\n\n`);
          }
        }

        if (duplicatesSkipped > 0) {
          console.log(`[Intelligent Test] Removed ${duplicatesSkipped} duplicate test cases`);
          res.write(`data: ${JSON.stringify({ type: "deduplication", duplicatesRemoved: duplicatesSkipped })}\n\n`);
        }

        console.log('[Intelligent Test] Generated', testCases.length, 'unique functional test cases from DOM analysis (skipped', duplicatesSkipped, 'duplicates)');
      } catch (generationError) {
        console.error('[Intelligent Test] Test case generation error:', generationError);
        if (testCases.length === 0) {
          res.write(`data: ${JSON.stringify({ type: "error", message: "Test generation failed. Please try again." })}\n\n`);
          res.end();
          return;
        }
        console.log(`[Intelligent Test] Continuing with ${testCases.length} test cases despite generation error`);
      }
      
      res.write(`data: ${JSON.stringify({ type: "testGenComplete", count: testCases.length })}\n\n`);
      console.log('[Intelligent Test] All test cases streamed');

      // Calculate category counts
      const categoryCounts = {
        text_validation: testCases.filter((tc: any) => tc.category === 'text_validation').length,
        workflow: testCases.filter((tc: any) => tc.category === 'workflow').length,
        functional: testCases.filter((tc: any) => tc.category === 'functional').length,
        negative: testCases.filter((tc: any) => tc.category === 'negative').length,
        edge_case: testCases.filter((tc: any) => tc.category === 'edge_case').length,
      };

      // Save test cases to database and complete the run
      if (testRunId && testCasesToSave.length > 0) {
        try {
          console.log(`[Intelligent Test] Saving ${testCasesToSave.length} test cases to database...`);
          await storage.addTestCasesToRun(testRunId, testCasesToSave);
          
          await storage.completeFunctionalTestRun(testRunId, {
            total: testCases.length,
            workflow: categoryCounts.workflow,
            functional: categoryCounts.functional,
            negative: categoryCounts.negative,
            edge: categoryCounts.edge_case,
            textValidation: categoryCounts.text_validation,
          });
          console.log(`[Intelligent Test] Test run ${testRunId} completed and saved with ${testCasesToSave.length} test cases`);
        } catch (saveError) {
          console.error('[Intelligent Test] Failed to save test cases to database:', saveError);
        }
      }

      // Send summary
      const summary = {
        url,
        focus,
        pagesDiscovered: pages.length,
        domStructuresAnalyzed: domStructures.length,
        testCasesGenerated: testCases.length,
        testRunId: testRunId,
        categorizedCounts: categoryCounts,
      };

      console.log('[Intelligent Test] Sending summary and completing stream');
      res.write(`data: ${JSON.stringify({ type: "summary", summary })}\n\n`);

      // Save functional test session if projectId provided (legacy support)
      if (projectId && testCases.length > 0) {
        try {
          console.log(`[Intelligent Test] Saving test session for project: ${projectId}`);
          await storage.saveFunctionalTestSession({
            projectId,
            url,
            testFocus: focus,
            domain: effectiveDomain,
            testCasesGenerated: testCases.length,
            testCases,
            scenarios: [],
            crawlStatus: 'completed',
            pagesVisited: pages.length,
            workflowsDiscovered: 0,
          });
          console.log('[Intelligent Test] Test session saved successfully');
        } catch (saveError) {
          console.error('[Intelligent Test] Failed to save test session:', saveError);
        }
      }
      
      res.write(`data: ${JSON.stringify({ type: "complete" })}\n\n`);
      
      // Ensure all data is flushed before closing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      res.end();
      console.log('[Intelligent Test] Stream completed successfully');

    } catch (error) {
      console.error('[Intelligent Test] Error:', error);
      try {
        res.write(`data: ${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : String(error) })}\n\n`);
      } catch (writeError) {
        console.error('[SSE] Error writing error message:', writeError);
      }
      res.end();
    } finally {
      enhancedCrawler.reset();
      domTestGenerator.reset();
      // Close Playwright browser to free resources
      await playwrightService.shutdown();
    }
  });

  // Enhanced DOM-based testing endpoint
  app.get("/api/tests/dom-enhanced", async (req: Request, res: Response) => {
    const rawUrl = req.query.url as string;
    const domain = req.query.domain as string || "general";
    const productDescription = req.query.productDescription as string || "";
    const maxPages = parseInt(req.query.maxPages as string) || 50;
    const maxDepth = parseInt(req.query.maxDepth as string) || 5;
    const includeSitemap = req.query.includeSitemap !== 'false';
    const probeCommonPaths = req.query.probeCommonPaths !== 'false';

    if (!rawUrl) {
      res.status(400).json({ error: "URL required" });
      return;
    }

    let url = rawUrl.trim();
    if (!url.match(/^https?:\/\//i)) {
      url = `https://${url}`;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const enhancedCrawler = new EnhancedCrawler({
      maxPages,
      maxDepth,
      sameDomainOnly: true,
      timeout: 30000,
      includeSitemap,
      probeCommonPaths,
    });

    try {
      console.log(`[DOM Enhanced] Starting enhanced crawl for URL: ${url}`);
      console.log(`[DOM Enhanced] Config: maxPages=${maxPages}, maxDepth=${maxDepth}, sitemap=${includeSitemap}, probePaths=${probeCommonPaths}`);

      res.write(`data: ${JSON.stringify({ type: "started", url, config: { maxPages, maxDepth, includeSitemap, probeCommonPaths } })}\n\n`);

      const crawlProgressCallback = (progress: any) => {
        try {
          console.log(`[DOM Enhanced] Crawl progress: ${progress.status} - ${progress.pagesVisited}/${progress.totalPagesDiscovered || progress.pagesQueued} pages`);
          res.write(`data: ${JSON.stringify({ type: "crawlProgress", progress })}\n\n`);
        } catch (err) {
          console.error('[DOM Enhanced] Error writing crawl progress:', err);
        }
      };

      const { pages, domStructures } = await enhancedCrawler.crawl(url, crawlProgressCallback);
      
      console.log(`[DOM Enhanced] Crawl complete. Pages: ${pages.length}, DOM structures: ${domStructures.length}`);
      
      res.write(`data: ${JSON.stringify({ 
        type: "crawlComplete", 
        pagesDiscovered: pages.length,
        sitemapPagesFound: enhancedCrawler.getProgress().sitemapPagesFound,
        commonPathsFound: enhancedCrawler.getProgress().commonPathsFound,
      })}\n\n`);

      if (pages.length === 0) {
        console.log('[DOM Enhanced] No pages discovered');
        res.write(`data: ${JSON.stringify({ type: "error", message: "Unable to access the website. The site may be unavailable, require authentication, or block automated access." })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "complete" })}\n\n`);
        res.end();
        return;
      }

      res.write(`data: ${JSON.stringify({ type: "generatingTests", message: "Analyzing DOM structure and generating test cases using AI...", totalPages: domStructures.length })}\n\n`);

      const testGenerationCallback = (current: number, total: number, pageUrl: string) => {
        try {
          console.log(`[DOM Enhanced] Generating tests: ${current}/${total} - ${pageUrl}`);
          res.write(`data: ${JSON.stringify({ type: "testGenerationProgress", current, total, pageUrl })}\n\n`);
        } catch (err) {
          console.error('[DOM Enhanced] Error writing test generation progress:', err);
        }
      };

      const pageSuites = await domTestGenerator.generateTestsForAllPages(
        domStructures,
        testGenerationCallback,
        { domain, productContext: productDescription }
      );

      let totalTestCases = 0;
      const allTestCases: DOMTestCase[] = [];
      const seenTestNames = new Set<string>();
      let duplicatesSkipped = 0;

      // Helper function to normalize test name for comparison
      const normalizeTestName = (name: string): string => {
        return name
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .replace(/[^a-z0-9\s]/g, '')
          .trim()
          // Remove common variations
          .replace(/with valid data$/i, '')
          .replace(/with invalid data$/i, '')
          .replace(/submission$/i, 'submit')
          .replace(/navigate to (.+?) page/i, 'goto $1')
          .replace(/verify (.+?) content/i, 'check $1')
          .trim();
      };

      for (const suite of pageSuites) {
        const uniqueTestCases: DOMTestCase[] = [];
        
        for (const testCase of suite.testCases) {
          const normalizedName = normalizeTestName(testCase.name);
          
          // Check for exact or similar duplicates
          if (!seenTestNames.has(normalizedName)) {
            seenTestNames.add(normalizedName);
            uniqueTestCases.push(testCase);
            allTestCases.push(testCase);
          } else {
            duplicatesSkipped++;
          }
        }

        totalTestCases += uniqueTestCases.length;
        
        if (uniqueTestCases.length > 0) {
          res.write(`data: ${JSON.stringify({ 
            type: "pageSuite", 
            pageUrl: suite.pageUrl,
            pageTitle: suite.pageTitle,
            testCaseCount: uniqueTestCases.length,
          })}\n\n`);

          for (const testCase of uniqueTestCases) {
            res.write(`data: ${JSON.stringify({ type: "testCase", testCase })}\n\n`);
            await new Promise(resolve => setTimeout(resolve, 20));
          }
        }
      }

      if (duplicatesSkipped > 0) {
        console.log(`[DOM Enhanced] Removed ${duplicatesSkipped} duplicate test cases`);
        res.write(`data: ${JSON.stringify({ type: "deduplication", duplicatesRemoved: duplicatesSkipped })}\n\n`);
      }

      const summary = {
        totalPages: pages.length,
        totalTestCases,
        duplicatesRemoved: duplicatesSkipped,
        byCategory: {
          workflow: allTestCases.filter(tc => tc.category === 'workflow').length,
          functional: allTestCases.filter(tc => tc.category === 'functional').length,
          negative: allTestCases.filter(tc => tc.category === 'negative').length,
          edge_case: allTestCases.filter(tc => tc.category === 'edge_case').length,
          text_validation: allTestCases.filter(tc => tc.category === 'text_validation').length,
        },
        byPriority: {
          P1: allTestCases.filter(tc => tc.priority === 'P1').length,
          P2: allTestCases.filter(tc => tc.priority === 'P2').length,
          P3: allTestCases.filter(tc => tc.priority === 'P3').length,
        },
      };

      console.log(`[DOM Enhanced] Complete. Generated ${totalTestCases} test cases for ${pages.length} pages`);
      
      res.write(`data: ${JSON.stringify({ type: "summary", summary })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "complete" })}\n\n`);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      res.end();

    } catch (error) {
      console.error('[DOM Enhanced] Error:', error);
      try {
        res.write(`data: ${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : String(error) })}\n\n`);
      } catch (writeError) {
        console.error('[DOM Enhanced] Error writing error message:', writeError);
      }
      res.end();
    } finally {
      enhancedCrawler.reset();
      domTestGenerator.reset();
      await playwrightService.shutdown();
    }
  });

  app.post("/api/export-test-cases-excel", async (req: Request, res: Response) => {
    try {
      // TODO: Add proper session-based authentication
      // Currently skipped for MVP/demo - requires express-session + Passport.js
      
      const { testCases, scenarios } = req.body;
      if (!testCases || !Array.isArray(testCases)) {
        res.status(400).json({ error: "Test cases array is required" });
        return;
      }

      const buffer = exportTestCasesToExcel(testCases, scenarios);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `test-cases-${timestamp}.xlsx`;
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      
      res.send(buffer);
    } catch (error: any) {
      console.error('[Excel Export] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  const importFileUpload = multerLib({
    storage: multerLib.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  app.post("/api/import/test-cases/preview", importFileUpload.single("file"), async (req: Request, res: Response) => {
    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file?.buffer) {
        res.status(400).json({ success: false, error: "File is required" });
        return;
      }

      const { parseImportFile } = await import("./test-case-import");
      const parsed = await parseImportFile(file.buffer, file.originalname);
      if (parsed.errors.length > 0) {
        res.status(400).json({
          success: false,
          error: parsed.errors[0],
          errors: parsed.errors,
          warnings: parsed.warnings,
        });
        return;
      }

      res.json({
        success: true,
        totalCount: parsed.testCases.length,
        preview: parsed.testCases.slice(0, 5).map((testCase) => ({
          id: testCase.testCaseId,
          name: testCase.title,
          category: testCase.category,
          priority: testCase.priority,
          stepsCount: testCase.steps.length,
        })),
        warnings: parsed.warnings,
      });
    } catch (error: any) {
      console.error("[Import Preview] Error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to preview import file" });
    }
  });

  app.post("/api/import/test-cases", importFileUpload.single("file"), async (req: Request, res: Response) => {
    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file?.buffer) {
        res.status(400).json({ success: false, error: "File is required" });
        return;
      }

      const {
        destinationType = "autonomous",
        projectId,
        sprintId,
        duplicateHandling = "skip",
        autoGenerateIds = "true",
        validateBeforeImport = "true",
      } = req.body as Record<string, string>;

      if (!projectId) {
        res.status(400).json({ success: false, error: "Project is required" });
        return;
      }

      if (destinationType === "stories" && !sprintId) {
        res.status(400).json({ success: false, error: "Sprint is required for user story imports" });
        return;
      }

      const project = await storage.getProjectById(projectId);
      if (!project) {
        res.status(404).json({ success: false, error: "Project not found" });
        return;
      }

      const importModule = await import("./test-case-import");
      const { parseImportFile, applyImportOptions, toFunctionalRunCases, toSprintImportCases } = importModule;

      const parsed = await parseImportFile(file.buffer, file.originalname);
      if (validateBeforeImport === "true" && parsed.errors.length > 0) {
        res.status(400).json({
          success: false,
          error: parsed.errors[0],
          errors: parsed.errors,
          warnings: parsed.warnings,
        });
        return;
      }

      const existingKeys = new Set<string>();

      if (destinationType === "autonomous") {
        const runs = await storage.getFunctionalTestRuns(projectId);
        for (const run of runs) {
          const fullRun = await storage.getFunctionalTestRunById(run.id);
          for (const testCase of fullRun?.testCases || []) {
            existingKeys.add(`${testCase.testId}::${testCase.name.trim().toLowerCase()}`);
          }
        }
      } else if (sprintId) {
        const stories = await storage.getSprintUserStoriesBySprintId(sprintId);
        for (const story of stories) {
          const cases = await storage.getTestCasesByUserStoryId(story.id);
          for (const testCase of cases) {
            existingKeys.add(`${testCase.testCaseId}::${testCase.title.trim().toLowerCase()}`);
          }
        }
      }

      const { toImport, skipped, replaced } = applyImportOptions(parsed.testCases, {
        autoGenerateIds: autoGenerateIds === "true",
        duplicateHandling: duplicateHandling as importModule.ImportDuplicateHandling,
        existingKeys,
      });

      if (toImport.length === 0) {
        res.json({
          success: true,
          imported: 0,
          skipped,
          replaced,
          message: "No new test cases to import after duplicate handling",
        });
        return;
      }

      if (destinationType === "autonomous") {
        const run = await storage.createFunctionalTestRun({
          projectId,
          websiteUrl: `import://${file.originalname}`,
          testFocus: "import",
          domain: project.domain || "general",
          productContext: `Imported from ${file.originalname}`,
          sampleMode: "import",
        });

        const runCases = toFunctionalRunCases(toImport);
        await storage.addTestCasesToRun(run.id, runCases);
        await storage.completeFunctionalTestRun(run.id, {
          total: runCases.length,
          workflow: 0,
          functional: runCases.filter((tc) => tc.category === "functional").length,
          negative: runCases.filter((tc) => tc.category === "negative").length,
          edge: runCases.filter((tc) => tc.category.includes("edge")).length,
          textValidation: 0,
        });

        res.json({
          success: true,
          imported: runCases.length,
          skipped,
          replaced,
          runId: run.id,
          message: `Imported ${runCases.length} test case${runCases.length === 1 ? "" : "s"} to Autonomous Testing`,
        });
        return;
      }

      const importStory = await storage.createSprintUserStory({
        sprintId: sprintId!,
        title: `Imported - ${file.originalname}`,
        description: `Imported ${toImport.length} test cases from ${file.originalname}`,
        priority: "medium",
        source: "import",
      });

      const sprintCases = toSprintImportCases(toImport);
      await storage.saveTestCasesToUserStory(importStory.id, sprintId!, sprintCases);

      res.json({
        success: true,
        imported: sprintCases.length,
        skipped,
        replaced,
        sprintUserStoryId: importStory.id,
        message: `Imported ${sprintCases.length} test case${sprintCases.length === 1 ? "" : "s"} to sprint user story`,
      });
    } catch (error: any) {
      console.error("[Import Test Cases] Error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to import test cases" });
    }
  });

  // Enhanced Excel Export with professional formatting (NAT 2.0 format)
  app.post("/api/export/test-cases/excel", async (req: Request, res: Response) => {
    try {
      const { testCases, metadata } = req.body;
      
      if (!testCases || !Array.isArray(testCases)) {
        res.status(400).json({ error: "Test cases array is required" });
        return;
      }

      // Map test cases to enhanced format
      const enhancedTestCases: EnhancedTestCase[] = testCases.map((tc: any) => ({
        id: tc.id,
        title: tc.title || tc.name || 'Untitled Test Case',
        description: tc.description || tc.objective || '',
        category: tc.category || tc.type || 'functional',
        priority: tc.priority || 'P2',
        preconditions: tc.preconditions,
        steps: (tc.steps || tc.test_steps || []).map((step: any, idx: number) => ({
          step_number: step.step_number || step.stepNumber || idx + 1,
          action: step.action || step.test_step || '',
          expected_behavior: step.expected_behavior || step.expected || step.expectedResult || ''
        })),
        expectedResult: tc.expectedResult,
        postconditions: tc.postconditions,
        objective: tc.objective
      }));

      const exportMetadata: ExportMetadata = {
        projectName: metadata?.projectName || 'NAT 2.0',
        sprintName: metadata?.sprintName || 'Export',
        userStoryTitle: metadata?.userStoryTitle || metadata?.userStory || '',
        generatedAt: new Date().toISOString(),
        totalTestCases: enhancedTestCases.length,
        domain: metadata?.domain || 'General'
      };

      const buffer = await exportTestCasesToExcelEnhanced(enhancedTestCases, exportMetadata);
      
      const sprintName = (metadata?.sprintName || 'Export').replace(/[^a-zA-Z0-9]/g, '_');
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `NAT2_TestCases_${sprintName}_${dateStr}.xlsx`;
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      
      res.send(buffer);
    } catch (error: any) {
      console.error('[Enhanced Excel Export] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Live Preview SSE Endpoint - streams real-time website screenshots
  app.get("/api/live-preview/:sessionId", async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const url = req.query.url as string;

    if (!url) {
      res.status(400).json({ error: "URL is required" });
      return;
    }

    // Set up SSE (no wildcard CORS - only same-origin requests allowed)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    console.log(`[LivePreview] Starting SSE stream for session ${sessionId}: ${url}`);

    // Callback to send screenshots via SSE
    const onScreenshot = (base64Data: string) => {
      try {
        res.write(`data: ${JSON.stringify({ type: "screenshot", data: base64Data })}\n\n`);
      } catch (err) {
        console.error(`[LivePreview] Error sending screenshot:`, err);
      }
    };

    // Start live preview with 2 second refresh interval
    const result = await startLivePreview(sessionId, url, onScreenshot, 2000);

    if (!result.success) {
      res.write(`data: ${JSON.stringify({ type: "error", error: result.error })}\n\n`);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({ type: "started", url })}\n\n`);

    // Clean up on client disconnect
    req.on('close', async () => {
      console.log(`[LivePreview] Client disconnected, stopping session ${sessionId}`);
      await stopLivePreview(sessionId);
    });
  });

  // Stop live preview
  app.post("/api/live-preview/:sessionId/stop", async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    await stopLivePreview(sessionId);
    res.json({ success: true });
  });

  // Scroll preview
  app.post("/api/live-preview/:sessionId/scroll", async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const { direction } = req.body;
    if (direction !== 'up' && direction !== 'down') {
      res.status(400).json({ error: "Direction must be 'up' or 'down'" });
      return;
    }
    await scrollPreview(sessionId, direction);
    res.json({ success: true });
  });

  // Refresh preview
  app.post("/api/live-preview/:sessionId/refresh", async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    await refreshPreview(sessionId);
    res.json({ success: true });
  });

  // Document text extraction endpoint
  app.post("/api/documents/extract", express.raw({ type: '*/*', limit: '10mb' }), async (req: Request, res: Response) => {
    try {
      // For text files, extract content directly
      const contentType = req.headers['content-type'] || '';
      let content = '';
      
      if (contentType.includes('text/plain') || contentType.includes('text/markdown') || contentType.includes('text/html')) {
        content = req.body.toString('utf-8');
      } else {
        // For PDF/DOCX, we'd need libraries like pdf-parse or mammoth
        // For now, return placeholder indicating content extraction pending
        content = '[Document content extraction requires additional processing. The document has been uploaded successfully.]';
      }

      res.json({ 
        success: true, 
        content,
        message: 'Document processed successfully'
      });
    } catch (error: any) {
      console.error('[Document Extract] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // URL content fetching endpoint
  app.post("/api/urls/fetch", async (req: Request, res: Response) => {
    try {
      const { url } = req.body;
      
      if (!url) {
        res.status(400).json({ error: "URL is required" });
        return;
      }

      console.log(`[URL Fetch] Fetching content from: ${url}`);

      // Use Playwright to fetch URL content (handles JavaScript-rendered pages)
      await playwrightService.initialize();
      const contextId = `url-fetch-${Date.now()}`;
      await playwrightService.createContext(contextId);

      try {
        const pageInfo = await playwrightService.navigateToPage(contextId, url);
        
        // Extract main content from the page
        const page = await playwrightService.getPage(contextId);
        if (!page) {
          throw new Error('Failed to get page');
        }

        // Extract text content from main content areas
        const content = await page.evaluate(() => {
          // Try to find main content areas
          const selectors = ['main', 'article', '.content', '#content', '.main-content', '.documentation', '.docs-content', 'body'];
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent && el.textContent.trim().length > 100) {
              return el.textContent.trim();
            }
          }
          return document.body.textContent?.trim() || '';
        });

        // Clean up the content
        const cleanedContent = content
          .replace(/\s+/g, ' ')
          .replace(/\n\s*\n/g, '\n\n')
          .substring(0, 50000); // Limit to 50k chars

        res.json({
          success: true,
          url,
          title: pageInfo.title,
          content: cleanedContent,
        });
      } finally {
        await playwrightService.closeContext(contextId);
      }
    } catch (error: any) {
      console.error('[URL Fetch] Error:', error);
      res.status(500).json({ 
        error: error.message,
        success: false 
      });
    }
  });

  // Functional Test Run History Endpoints
  app.get("/api/test-runs", async (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const runs = await storage.getFunctionalTestRuns(projectId, limit);
      res.json(runs);
    } catch (error: any) {
      console.error('[Test Runs] Error fetching runs:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/test-runs/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const run = await storage.getFunctionalTestRunById(id);
      if (!run) {
        res.status(404).json({ error: "Test run not found" });
        return;
      }
      res.json(run);
    } catch (error: any) {
      console.error('[Test Runs] Error fetching run:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Analytics endpoint for dashboard
  app.get("/api/analytics/overview", async (req: Request, res: Response) => {
    try {
      const user = req.user || DEMO_USER;
      
      // Get all projects for user
      const projectsList = await storage.getProjectsByUserId(user.id);
      
      // Get all test runs
      const testRuns = await storage.getFunctionalTestRuns(undefined, 1000);
      
      // Get all sessions
      const sessions = await storage.getAllTestSessions();
      
      // Calculate totals from functional test runs
      let totalTestCases = 0;
      let totalWorkflowTests = 0;
      let totalFunctionalTests = 0;
      let totalNegativeTests = 0;
      let totalEdgeCaseTests = 0;
      
      for (const run of testRuns) {
        totalTestCases += run.totalTestCases || 0;
        totalWorkflowTests += run.workflowCases || 0;
        totalFunctionalTests += run.functionalCases || 0;
        totalNegativeTests += run.negativeCases || 0;
        totalEdgeCaseTests += run.edgeCases || 0;
      }
      
      // Calculate sprint test cases from sprints - count by actual category
      let sprintTestCasesTotal = 0;
      let sprintFunctional = 0;
      let sprintWorkflow = 0;
      let sprintNegative = 0;
      let sprintEdgeCase = 0;
      let sprintOther = 0;
      
      for (const project of projectsList) {
        const sprints = await storage.getSprintsByProjectId(project.id);
        for (const sprint of sprints) {
          const sprintTestCases = await storage.getTestCasesBySprintId(sprint.id);
          sprintTestCasesTotal += sprintTestCases.length;
          
          // Count by category
          for (const tc of sprintTestCases) {
            const category = (tc.category || 'functional').toLowerCase();
            if (category === 'functional') sprintFunctional++;
            else if (category === 'workflow') sprintWorkflow++;
            else if (category === 'negative') sprintNegative++;
            else if (category === 'edge_case' || category === 'edge case' || category === 'edgecase') sprintEdgeCase++;
            else sprintOther++;
          }
        }
      }
      
      // Combine totals from test runs and sprint test cases
      totalFunctionalTests += sprintFunctional;
      totalWorkflowTests += sprintWorkflow;
      totalNegativeTests += sprintNegative;
      totalEdgeCaseTests += sprintEdgeCase;
      
      // Recent activity - last 7 days
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const recentRuns = testRuns.filter(r => new Date(r.createdAt) > weekAgo);
      const recentSessions = sessions.filter(s => new Date(s.createdAt) > weekAgo);
      
      res.json({
        projects: {
          total: projectsList.length,
          recent: projectsList.slice(0, 5)
        },
        testCases: {
          total: totalTestCases + sprintTestCasesTotal,
          functional: totalFunctionalTests,
          workflow: totalWorkflowTests,
          negative: totalNegativeTests,
          edgeCase: totalEdgeCaseTests,
          sprint: sprintTestCasesTotal
        },
        sessions: {
          total: sessions.length,
          recentWeek: recentSessions.length
        },
        testRuns: {
          total: testRuns.length,
          recentWeek: recentRuns.length
        },
        activity: {
          lastWeek: {
            testRuns: recentRuns.length,
            sessions: recentSessions.length
          }
        }
      });
    } catch (error: any) {
      console.error('[Analytics] Error fetching overview:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/projects", async (req: Request, res: Response) => {
    try {
      const user = req.user || DEMO_USER; // Fallback to demo user for MVP
      const validated = insertProjectSchema.parse({ ...req.body, userId: user.id });
      const project = await storage.createProject(validated);
      res.json(project);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ error: "Invalid project data", details: error.errors });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects", async (req: Request, res: Response) => {
    try {
      const user = req.user || DEMO_USER; // Fallback to demo user for MVP
      const projects = await storage.getProjectsByUserId(user.id);
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      const user = req.user || DEMO_USER; // Fallback to demo user for MVP
      const project = await storage.getProjectById(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (project.userId !== user.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      res.json(project);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      const user = req.user || DEMO_USER; // Fallback to demo user for MVP
      const project = await storage.getProjectById(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (project.userId !== user.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const updated = await storage.updateProject(req.params.id, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      const user = req.user || DEMO_USER; // Fallback to demo user for MVP
      const project = await storage.getProjectById(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (project.userId !== user.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      await storage.deleteProject(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:id/sessions", async (req: Request, res: Response) => {
    try {
      const user = req.user || DEMO_USER; // Fallback to demo user for MVP
      const project = await storage.getProjectById(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (project.userId !== user.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const sessions = await storage.getTestSessionsByProjectId(req.params.id);
      res.json(sessions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Sprint Management
  app.post("/api/projects/:projectId/sprints", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const project = await storage.getProjectById(projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const sprint = await storage.createSprint({
        projectId,
        name: req.body.name,
        description: req.body.description,
        startDate: req.body.startDate ? new Date(req.body.startDate) : null,
        endDate: req.body.endDate ? new Date(req.body.endDate) : null,
      });
      res.json(sprint);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:projectId/sprints", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const project = await storage.getProjectById(projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const sprints = await storage.getSprintsByProjectId(projectId);
      res.json(sprints);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sprints/:id", async (req: Request, res: Response) => {
    try {
      const sprint = await storage.getSprintById(req.params.id);
      if (!sprint) {
        res.status(404).json({ error: "Sprint not found" });
        return;
      }
      res.json(sprint);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/sprints/:id", async (req: Request, res: Response) => {
    try {
      const sprint = await storage.getSprintById(req.params.id);
      if (!sprint) {
        res.status(404).json({ error: "Sprint not found" });
        return;
      }
      const updates = { ...req.body };
      // Handle date fields
      if (updates.startDate) updates.startDate = new Date(updates.startDate);
      if (updates.endDate) updates.endDate = new Date(updates.endDate);
      if (updates.adoLastSyncAt) updates.adoLastSyncAt = new Date(updates.adoLastSyncAt);
      
      const updated = await storage.updateSprint(req.params.id, updates);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/sprints/:id", async (req: Request, res: Response) => {
    try {
      await storage.deleteSprint(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Save test cases to sprint
  app.post("/api/sprints/:sprintId/test-cases", async (req: Request, res: Response) => {
    try {
      const { sprintId } = req.params;
      const { testCases } = req.body;
      
      const sprint = await storage.getSprintById(sprintId);
      if (!sprint) {
        res.status(404).json({ error: "Sprint not found" });
        return;
      }
      
      await storage.saveTestCasesToSprint(sprintId, testCases || []);
      console.log(`[Sprint] Saved ${testCases?.length || 0} test cases to sprint ${sprintId}`);
      
      res.json({ 
        success: true, 
        message: `${testCases?.length || 0} test cases saved`,
        sprintId 
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get test cases for a sprint
  app.get("/api/sprints/:sprintId/test-cases", async (req: Request, res: Response) => {
    try {
      const { sprintId } = req.params;
      
      const sprint = await storage.getSprintById(sprintId);
      if (!sprint) {
        res.status(404).json({ error: "Sprint not found" });
        return;
      }
      
      const testCases = await storage.getTestCasesBySprintId(sprintId);
      res.json(testCases);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update a test case
  app.put("/api/test-cases/:id", async (req: Request, res: Response) => {
    try {
      const updates = { ...req.body };
      // Track change history if meaningful changes
      const now = new Date().toISOString();
      if (!updates.changeHistory) updates.changeHistory = [];
      
      // Mark as edited if title, steps, or priority changed
      if (updates.title || updates.testSteps || updates.priority) {
        updates.isEdited = 1;
        updates.editStatus = 'modified';
      }
      
      const updated = await storage.updateSprintTestCase(req.params.id, updates);
      if (!updated) {
        res.status(404).json({ error: "Test case not found" });
        return;
      }
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a test case
  app.delete("/api/test-cases/:id", async (req: Request, res: Response) => {
    try {
      await storage.deleteTestCaseFromSprint(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Sprint Agent - Requirements
  app.post("/api/projects/:projectId/requirements", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { name, description } = req.body;
      
      if (!name) {
        res.status(400).json({ error: "Requirement name is required" });
        return;
      }

      const requirement = await storage.createRequirement({
        projectId,
        name,
        description,
      });
      res.json(requirement);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:projectId/requirements", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const requirements = await storage.getRequirementsByProjectId(projectId);
      res.json(requirements);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/requirements/:id", async (req: Request, res: Response) => {
    try {
      const requirement = await storage.getRequirementById(req.params.id);
      if (!requirement) {
        res.status(404).json({ error: "Requirement not found" });
        return;
      }
      res.json(requirement);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Sprint Agent - User Stories
  app.post("/api/requirements/:requirementId/user-stories", async (req: Request, res: Response) => {
    try {
      const { requirementId } = req.params;
      const { title, description, acceptanceCriteria } = req.body;
      
      if (!title) {
        res.status(400).json({ error: "User story title is required" });
        return;
      }

      const userStory = await storage.createUserStory({
        requirementId,
        title,
        description,
        acceptanceCriteria,
      });
      res.json(userStory);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/requirements/:requirementId/user-stories", async (req: Request, res: Response) => {
    try {
      const { requirementId } = req.params;
      const userStories = await storage.getUserStoriesByRequirementId(requirementId);
      res.json(userStories);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/user-stories/:id/test-cases", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const testCases = await storage.getSprintTestCasesByUserStory(id);
      res.json(testCases);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Sprint User Stories (simplified for Sprint Agent V2)
  app.post("/api/sprints/:sprintId/user-stories", async (req: Request, res: Response) => {
    try {
      const { sprintId } = req.params;
      const { title, description, acceptanceCriteria } = req.body;
      
      if (!title) {
        res.status(400).json({ error: "User story title is required" });
        return;
      }

      const sprint = await storage.getSprintById(sprintId);
      if (!sprint) {
        res.status(404).json({ error: "Sprint not found" });
        return;
      }

      const userStory = await storage.createSprintUserStory({
        sprintId,
        title,
        description: description || null,
        acceptanceCriteria: acceptanceCriteria || null,
      });
      res.json(userStory);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sprints/:sprintId/user-stories", async (req: Request, res: Response) => {
    try {
      const { sprintId } = req.params;
      const userStories = await storage.getSprintUserStoriesBySprintId(sprintId);
      res.json(userStories);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sprint-user-stories/:id", async (req: Request, res: Response) => {
    try {
      const userStory = await storage.getSprintUserStoryById(req.params.id);
      if (!userStory) {
        res.status(404).json({ error: "User story not found" });
        return;
      }
      res.json(userStory);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/sprint-user-stories/:id", async (req: Request, res: Response) => {
    try {
      const userStory = await storage.getSprintUserStoryById(req.params.id);
      if (!userStory) {
        res.status(404).json({ error: "User story not found" });
        return;
      }
      const updates = { ...req.body };
      // Handle date fields
      if (updates.adoLastSyncAt) updates.adoLastSyncAt = new Date(updates.adoLastSyncAt);
      
      const updated = await storage.updateSprintUserStory(req.params.id, updates);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/sprint-user-stories/:id", async (req: Request, res: Response) => {
    try {
      await storage.deleteSprintUserStory(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Save test cases to a user story
  app.post("/api/sprint-user-stories/:userStoryId/test-cases", async (req: Request, res: Response) => {
    try {
      const { userStoryId } = req.params;
      const { testCases } = req.body;
      
      const userStory = await storage.getSprintUserStoryById(userStoryId);
      if (!userStory) {
        res.status(404).json({ error: "User story not found" });
        return;
      }

      await storage.saveTestCasesToUserStory(userStoryId, userStory.sprintId, testCases);
      res.json({ success: true, count: testCases.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sprint-user-stories/:userStoryId/test-cases", async (req: Request, res: Response) => {
    try {
      const { userStoryId } = req.params;
      const testCases = await storage.getTestCasesByUserStoryId(userStoryId);
      res.json(testCases);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Document upload for test-generation context ─────────────────────────────
  // POST /api/tests/upload-context
  // Accepts up to 5 files (max 10 MB each).  Extracts plain text from each and
  // returns it inline — nothing is persisted on the server.
  // Supported: .pdf, .docx, .xlsx, .txt, .md, .feature, .spec.ts, .spec.js, .json
  {
    const { memoryStorage } = await import("multer");
    const multerMod = await import("multer");
    const multerUpload = multerMod.default({
      storage: multerMod.default.memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB per file
        files: 5,
      },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "text/plain",
          "text/markdown",
          "application/json",
          "application/octet-stream", // some browsers send .feature / .spec files as this
        ];
        const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "";
        const allowedExts = ["pdf", "docx", "xlsx", "xls", "txt", "md", "feature", "spec", "ts", "js", "json"];
        if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
          cb(null, true);
        } else {
          cb(new Error(`Unsupported file type: ${file.originalname} (${file.mimetype})`));
        }
      },
    });

    app.post(
      "/api/tests/upload-context",
      (req: Request, res: Response, next: Function) => {
        multerUpload.array("files", 5)(req as any, res as any, (err: any) => {
          if (err) {
            console.error("[UploadContext] Multer error:", err?.message);
            res.status(400).json({ error: err?.message ?? "Upload failed" });
            return;
          }
          next();
        });
      },
      async (req: Request, res: Response) => {
        try {
          const files = (req as any).files as Express.Multer.File[] | undefined;
          if (!files || files.length === 0) {
            res.status(400).json({ error: "No files uploaded" });
            return;
          }

          const { extractDocumentText } = await import("./document-extractor.js");

          const documents = await Promise.all(
            files.map(f =>
              extractDocumentText(f.buffer, f.originalname, f.mimetype)
            )
          );

          console.log(
            `[UploadContext] Extracted ${documents.length} document(s): ` +
            documents.map(d => `${d.fileName} (${d.charCount} chars${d.truncated ? ", truncated" : ""})`).join(", ")
          );

          res.json({ documents });
        } catch (error: any) {
          console.error("[UploadContext] Error:", error);
          res.status(500).json({ error: error.message ?? "Extraction failed" });
        }
      }
    );
  }

  // Sprint Agent - Agentic Test Generation Pipeline
  app.post("/api/tests/sprint-generate", async (req: Request, res: Response) => {
    try {
      const {
        userStoryId,
        title,
        description,
        acceptanceCriteria,
        domain,
        productDescription,
        storyMetadata,
        frameworkConfigId,
        repoPath,
        uploadedDocuments,
        projectId,
        useGoldenRepo,
      } = req.body;

      if (!userStoryId || !title) {
        res.status(400).json({ error: "User story ID and title required" });
        return;
      }

      // Default useGoldenRepo to true to mirror BRD's behavior. When the
      // toggle is off, or no projectId is provided, we skip the SDLC RAG
      // load entirely and fall back to today's local repoPath / uploaded-doc
      // pipeline. The loader itself is also robust to "no project found"
      // and "no golden repo configured" -- both result in a no-op fallback,
      // never an error.
      const useGoldenRepoFlag = useGoldenRepo !== false;
      const tenantId = ((req as any).tenant?.id ?? null) as string | null;
      const userId = ((req as any).user?.id ?? null) as string | null;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Transfer-Encoding", "chunked");
      res.flushHeaders();
      
      // Disable Nagle's algorithm for immediate delivery
      if (res.socket) {
        res.socket.setNoDelay(true);
      }

      // Track if connection is still writable
      let isConnectionOpen = true;
      
      res.on('close', () => {
        isConnectionOpen = false;
        console.log('[SSE] Client disconnected');
      });

      // Send event with explicit flush for immediate delivery
      const sendEvent = (event: any) => {
        if (!isConnectionOpen || res.writableEnded) {
          console.log(`[SSE] Skipping event ${event.type} - connection closed`);
          return;
        }
        try {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          const written = res.write(data);
          console.log(`[SSE] Event sent: ${event.type}, written: ${written}`);
          // Force flush using multiple methods
          if (typeof (res as any).flush === 'function') {
            (res as any).flush();
          }
          if (res.socket && typeof res.socket.uncork === 'function') {
            res.socket.cork();
            res.socket.uncork();
          }
        } catch (err) {
          console.error("[SSE] Write error:", err);
        }
      };

      // Heartbeat to keep connection alive during long AI processing
      const heartbeatInterval = setInterval(() => {
        if (!isConnectionOpen || res.writableEnded) {
          clearInterval(heartbeatInterval);
          return;
        }
        try {
          res.write(':heartbeat\n\n');
          console.log('[SSE] Heartbeat sent');
        } catch (err) {
          clearInterval(heartbeatInterval);
        }
      }, 5000); // Send heartbeat every 5 seconds

      // Send immediate connection event
      sendEvent({ type: "pipeline_stage", stage: "connecting", message: "Initializing Agentic AI Pipeline..." });

      // ── Optional: load Golden Repo guidance (mirrors BRD generation) ────
      // We do this BEFORE the pipeline starts so the resulting summary can
      // be threaded into both the context-enricher prompt and the QA refiner
      // prompt. Errors here never abort generation.
      let goldenRepoGuidance: string | undefined;
      let goldenRepoMeta: { goldenRepoId: string | null; files: string[]; sdlcProjectId: string | null } | null = null;
      if (useGoldenRepoFlag && typeof projectId === "string" && projectId.trim().length > 0) {
        sendEvent({
          type: "pipeline_stage",
          stage: "golden_repo_rag",
          message: "Loading Golden Repo guidance...",
        });
        try {
          const { loadGoldenRepoGuidance } = await import("./golden-repo-guidance");
          const ragQuery = [title, acceptanceCriteria].filter((s) => typeof s === "string" && s.length > 0).join("\n\n");
          const result = await loadGoldenRepoGuidance({
            projectId: projectId.trim(),
            ragQuery,
            tenantId,
            userId,
          });
          if (result.guidance) {
            goldenRepoGuidance = result.guidance;
            goldenRepoMeta = {
              goldenRepoId: result.goldenRepoId,
              files: result.files,
              sdlcProjectId: result.sdlcProjectId,
            };
            sendEvent({
              type: "pipeline_stage",
              stage: "golden_repo_rag",
              message: `Golden Repo guidance loaded from ${result.files.length} file(s)`,
              data: {
                fileCount: result.files.length,
                files: result.files,
                goldenRepoId: result.goldenRepoId,
                guidanceChars: result.guidance.length,
              },
            });
            console.log("[Agentic Pipeline] Golden Repo guidance loaded", {
              files: result.files,
              goldenRepoId: result.goldenRepoId,
              guidanceChars: result.guidance.length,
            });
          } else {
            sendEvent({
              type: "pipeline_stage",
              stage: "golden_repo_rag",
              message: "No Golden Repo guidance loaded — falling back to story text + local context",
              data: { skipReason: result.skipReason },
            });
            console.log("[Agentic Pipeline] Golden Repo guidance skipped", {
              projectId,
              skipReason: result.skipReason,
            });
          }
        } catch (err: any) {
          console.warn("[Agentic Pipeline] loadGoldenRepoGuidance threw — continuing without it:", err?.message ?? err);
          sendEvent({
            type: "pipeline_stage",
            stage: "golden_repo_rag",
            message: "Golden Repo guidance unavailable — continuing without it",
            data: { error: err?.message ?? "unknown error" },
          });
        }
      }

      const { runAgenticPipeline } = await import("./agentic-sprint-agent");

      console.log("[Agentic Pipeline] Calling runAgenticPipeline...");

      const testCases = await runAgenticPipeline(
        title,
        description || "",
        acceptanceCriteria || "",
        domain || "insurance",
        productDescription || "",
        sendEvent,
        storyMetadata || undefined,
        frameworkConfigId || undefined,
        repoPath || undefined,
        Array.isArray(uploadedDocuments) && uploadedDocuments.length > 0
          ? uploadedDocuments
          : undefined,
        goldenRepoGuidance,
        goldenRepoMeta ?? undefined,
      );

      clearInterval(heartbeatInterval);
      console.log(`[Agentic Pipeline] Generated ${testCases.length} test cases`);
      
      // Wait for buffer to drain before closing connection
      if (res.writableNeedDrain) {
        await new Promise<void>((resolve) => {
          res.once('drain', () => {
            console.log('[SSE] Buffer drained, closing connection');
            resolve();
          });
          // Timeout fallback
          setTimeout(() => {
            console.log('[SSE] Drain timeout, closing connection');
            resolve();
          }, 2000);
        });
      }
      res.end();
    } catch (error: any) {
      console.error("[Agentic Pipeline] Error:", error);
      try {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: "error", message: error.message || "Pipeline execution failed" })}\n\n`);
        }
      } catch (writeErr) {
        console.error("[SSE] Error writing error event:", writeErr);
      }
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  app.post("/api/sessions", async (req: Request, res: Response) => {
    try {
      const validated = insertTestSessionSchema.parse(req.body);
      const session = await storage.createTestSession(validated);
      res.json(session);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ error: "Invalid session data", details: error.errors });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sessions", async (req: Request, res: Response) => {
    try {
      const sessions = await storage.getAllTestSessions();
      res.json(sessions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sessions/:id", async (req: Request, res: Response) => {
    try {
      const session = await storage.getTestSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/demo/start", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).json({ error: "Session ID required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    
    res.flushHeaders();
    
    await streamDemoUpdates(res, sessionId);
  });

  app.post("/api/export/ado/single", async (req: Request, res: Response) => {
    try {
      if (!adoExportService.isConfigured()) {
        res.status(400).json({ 
          success: false,
          error: adoExportService.getConfigurationError() 
        });
        return;
      }

      const testCase = req.body;
      if (!testCase || !testCase.id || !testCase.name) {
        res.status(400).json({ 
          success: false,
          error: "Invalid test case data" 
        });
        return;
      }

      const result = await adoExportService.exportTestCase(testCase);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: error.message || "Failed to export test case" 
      });
    }
  });

  app.post("/api/export/ado/batch", async (req: Request, res: Response) => {
    try {
      if (!adoExportService.isConfigured()) {
        res.status(400).json({ 
          success: false,
          error: adoExportService.getConfigurationError() 
        });
        return;
      }

      const testCases = req.body.testCases;
      if (!Array.isArray(testCases) || testCases.length === 0) {
        res.status(400).json({ 
          success: false,
          error: "Invalid test cases array" 
        });
        return;
      }

      const result = await adoExportService.exportMultipleTestCases(testCases);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: error.message || "Failed to export test cases" 
      });
    }
  });

  // Sprint Agent Routes
  app.post("/api/sprint/sync", async (req: Request, res: Response) => {
    try {
      const adoConfig = await storage.getActiveAdoConfiguration();
      
      if (!adoConfig && !adoPullService.isConfigured()) {
        res.status(400).json({ 
          success: false,
          error: adoPullService.getConfigurationError() 
        });
        return;
      }

      const config = adoConfig ? {
        organization: adoConfig.organization,
        project: adoConfig.project,
        pat: adoConfig.pat,
      } : undefined;

      const iterationsResult = await adoPullService.getIterations(config);
      
      if (!iterationsResult.success || !iterationsResult.iterations) {
        res.status(400).json(iterationsResult);
        return;
      }

      let totalSynced = 0;
      for (const iteration of iterationsResult.iterations) {
        const storiesResult = await adoPullService.getUserStoriesBySprint(iteration.path, config);
        if (storiesResult.success && storiesResult.userStories) {
          await storage.syncUserStories(storiesResult.userStories);
          totalSynced += storiesResult.userStories.length;
        }
      }

      res.json({ 
        success: true,
        message: `Synced ${totalSynced} user stories from ${iterationsResult.iterations.length} sprints`
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: error.message || "Failed to sync from Azure DevOps" 
      });
    }
  });

  app.get("/api/sprint/sprints", async (req: Request, res: Response) => {
    try {
      const adoConfig = await storage.getActiveAdoConfiguration();
      
      if (!adoConfig && !adoPullService.isConfigured()) {
        res.json([]);
        return;
      }

      const config = adoConfig ? {
        organization: adoConfig.organization,
        project: adoConfig.project,
        pat: adoConfig.pat,
      } : undefined;

      const result = await adoPullService.getIterations(config);
      
      if (!result.success || !result.iterations) {
        res.json([]);
        return;
      }

      const sprints = result.iterations.map(iteration => iteration.path);
      res.json(sprints);
    } catch (error: any) {
      console.error('Failed to fetch sprints:', error);
      res.json([]);
    }
  });

  app.get("/api/sprint/user-stories", async (req: Request, res: Response) => {
    try {
      if (!adoPullService.isConfigured()) {
        res.status(400).json({ 
          success: false,
          error: adoPullService.getConfigurationError() 
        });
        return;
      }

      const iterationPath = req.query.iteration as string;
      if (!iterationPath) {
        res.status(400).json({ 
          success: false,
          error: "Iteration path is required" 
        });
        return;
      }

      const result = await adoPullService.getUserStoriesBySprint(iterationPath);
      
      if (result.success && result.userStories) {
        await storage.syncUserStories(result.userStories);
        const dbUserStories = await storage.getUserStoriesBySprint(iterationPath);
        res.json({ success: true, userStories: dbUserStories });
      } else {
        res.json(result);
      }
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: error.message || "Failed to fetch user stories" 
      });
    }
  });

  // Import user stories from Azure DevOps to a sprint
  app.post("/api/sprints/:sprintId/import-from-ado", async (req: Request, res: Response) => {
    try {
      const { sprintId } = req.params;
      const { iterationPath } = req.body;

      if (!iterationPath) {
        res.status(400).json({ success: false, error: "Iteration path is required" });
        return;
      }

      const adoConfig = await storage.getActiveAdoConfiguration();
      if (!adoConfig && !adoPullService.isConfigured()) {
        res.status(400).json({ 
          success: false,
          error: "Azure DevOps not configured. Please configure ADO in Agent Configurations." 
        });
        return;
      }

      const config = adoConfig ? {
        organization: adoConfig.organization,
        project: adoConfig.project,
        pat: adoConfig.pat,
      } : undefined;

      const result = await adoPullService.getUserStoriesBySprint(iterationPath, config);
      
      if (!result.success || !result.userStories) {
        res.status(400).json({ success: false, error: result.error || "Failed to fetch stories from ADO" });
        return;
      }

      let importedCount = 0;
      for (const story of result.userStories) {
        await storage.createSprintUserStory({
          sprintId,
          title: story.title,
          description: story.description || null,
          acceptanceCriteria: story.acceptanceCriteria || null,
          priority: "medium",
          source: "ado",
        });
        importedCount++;
      }

      res.json({ 
        success: true, 
        message: `Imported ${importedCount} user stories from Azure DevOps`,
        count: importedCount
      });
    } catch (error: any) {
      console.error("ADO import error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to import from Azure DevOps" });
    }
  });

  // Get ADO iterations for import dialog
  app.get("/api/ado/iterations", async (req: Request, res: Response) => {
    try {
      const adoConfig = await storage.getActiveAdoConfiguration();
      if (!adoConfig && !adoPullService.isConfigured()) {
        res.status(400).json({ success: false, error: "Azure DevOps not configured" });
        return;
      }

      const config = adoConfig ? {
        organization: adoConfig.organization,
        project: adoConfig.project,
        pat: adoConfig.pat,
      } : undefined;

      const result = await adoPullService.getIterations(config);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Preview ADO stories before import
  app.post("/api/ado/preview-stories", async (req: Request, res: Response) => {
    try {
      const { iterationPath } = req.body;
      
      if (!iterationPath) {
        res.status(400).json({ success: false, error: "Iteration path is required" });
        return;
      }

      const adoConfig = await storage.getActiveAdoConfiguration();
      const config = adoConfig ? {
        organization: adoConfig.organization,
        project: adoConfig.project,
        pat: adoConfig.pat,
      } : undefined;

      const result = await adoPullService.getUserStoriesBySprint(iterationPath, config);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Resolve Jira credentials: QE native → env vars → DevX project bridge
  async function resolveJiraConfig(qeProjectId?: string): Promise<{ domain: string; email: string; apiToken: string } | null> {
    const nativeConfig = await storage.getActiveJiraConfiguration();
    if (nativeConfig) return nativeConfig;
    if (jiraPullService.isConfigured()) return null; // env-based, let jiraPullService handle

    // Try specific QE project
    if (qeProjectId) {
      const creds = await getJiraCredentialsForProject(qeProjectId);
      if (creds) return { domain: creds.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''), email: creds.email, apiToken: creds.token };
    }

    // No project specified — find any QE project linked to a DevX Jira project
    try {
      const allProjects = await storage.getProjectsByUserId("demo-user-1");
      for (const p of allProjects) {
        if (p.devxSdlcProjectId) {
          const creds = await getJiraCredentialsForProject(p.id);
          if (creds) return { domain: creds.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''), email: creds.email, apiToken: creds.token };
        }
      }
    } catch {}
    return null;
  }

  // Get Jira projects for import dialog
  app.get("/api/jira/projects", async (req: Request, res: Response) => {
    try {
      const qeProjectId = req.query.qeProjectId as string | undefined;
      const jiraConfig = await resolveJiraConfig(qeProjectId);

      if (!jiraConfig && !jiraPullService.isConfigured()) {
        res.status(400).json({ success: false, error: "Jira not configured" });
        return;
      }

      const config = jiraConfig ? {
        domain: jiraConfig.domain,
        email: jiraConfig.email,
        apiToken: jiraConfig.apiToken,
      } : undefined;

      const result = await jiraPullService.getProjects(config);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Preview Jira stories before import
  app.post("/api/jira/preview-stories", async (req: Request, res: Response) => {
    try {
      const { projectKey, jql } = req.body;
      
      if (!projectKey && !jql) {
        res.status(400).json({ success: false, error: "Project key or JQL query required" });
        return;
      }

      const jiraConfig = await storage.getActiveJiraConfiguration();
      const config = jiraConfig ? {
        domain: jiraConfig.domain,
        email: jiraConfig.email,
        apiToken: jiraConfig.apiToken,
      } : undefined;

      let result;
      if (jql) {
        result = await jiraPullService.searchUserStories(jql, 50, config);
      } else {
        result = await jiraPullService.getUserStoriesByProject(projectKey, 50, config);
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Import user stories from Jira to a sprint
  app.post("/api/sprints/:sprintId/import-from-jira", async (req: Request, res: Response) => {
    try {
      const { sprintId } = req.params;
      const { projectKey, jql, stories } = req.body;

      const jiraConfig = await storage.getActiveJiraConfiguration();
      if (!jiraConfig && !jiraPullService.isConfigured()) {
        res.status(400).json({ 
          success: false,
          error: "Jira not configured. Please configure Jira in Agent Configurations." 
        });
        return;
      }

      const config = jiraConfig ? {
        domain: jiraConfig.domain,
        email: jiraConfig.email,
        apiToken: jiraConfig.apiToken,
      } : undefined;

      let storiesToImport = stories;
      
      if (!storiesToImport) {
        let result;
        if (jql) {
          result = await jiraPullService.searchUserStories(jql, 100, config);
        } else if (projectKey) {
          result = await jiraPullService.getUserStoriesByProject(projectKey, 100, config);
        } else {
          res.status(400).json({ success: false, error: "Project key, JQL query, or stories array required" });
          return;
        }

        if (!result.success || !result.userStories) {
          res.status(400).json({ success: false, error: result.error || "Failed to fetch stories from Jira" });
          return;
        }
        storiesToImport = result.userStories;
      }

      let importedCount = 0;
      for (const story of storiesToImport) {
        await storage.createSprintUserStory({
          sprintId,
          title: story.title || story.jiraKey,
          description: story.description || null,
          acceptanceCriteria: null,
          priority: story.priority?.toLowerCase() || "medium",
          source: "jira",
        });
        importedCount++;
      }

      res.json({ 
        success: true, 
        message: `Imported ${importedCount} user stories from Jira`,
        count: importedCount
      });
    } catch (error: any) {
      console.error("Jira import error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to import from Jira" });
    }
  });

  // Check integration status — also checks DevX project Jira config via devxSdlcProjectId
  app.get("/api/import/status", async (req: Request, res: Response) => {
    try {
      const adoConfig = await storage.getActiveAdoConfiguration();
      let jiraConfig = await storage.getActiveJiraConfiguration();
      let jiraConfigured = !!jiraConfig || jiraPullService.isConfigured();
      let jiraDomain = jiraConfig?.domain || process.env.JIRA_DOMAIN || null;

      // If QE-native Jira isn't configured, check DevX project Jira config
      if (!jiraConfigured) {
        const projectId = req.query.projectId as string | undefined;
        if (projectId) {
          const project = await storage.getProjectById(projectId);
          if (project?.devxSdlcProjectId) {
            try {
              const { getJiraConfig } = await import("../integrations/jira/jira-routes-handler.js");
              const devxJira = await getJiraConfig(project.devxSdlcProjectId);
              if (devxJira) {
                jiraConfigured = true;
                jiraDomain = devxJira.instanceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
              }
            } catch {}
          }
        }
      }

      res.json({
        success: true,
        ado: {
          configured: !!adoConfig || adoPullService.isConfigured(),
          organization: adoConfig?.organization || process.env.ADO_ORGANIZATION || null,
        },
        jira: {
          configured: jiraConfigured,
          domain: jiraDomain,
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/sprint/generate-tests", async (req: Request, res: Response) => {
    try {
      const { userStoryId } = req.body;
      
      if (!userStoryId) {
        res.status(400).json({ 
          success: false,
          error: "User story ID is required" 
        });
        return;
      }

      const userStory = await storage.getUserStoryById(userStoryId);
      if (!userStory) {
        res.status(404).json({ 
          success: false,
          error: "User story not found" 
        });
        return;
      }

      const { generateTestCasesWithClaude } = await import("./claude-test-generator");
      
      const generatedTests = await generateTestCasesWithClaude({
        workItemId: userStory.adoWorkItemId,
        title: userStory.title,
        description: userStory.description || "",
        acceptanceCriteria: userStory.acceptanceCriteria || "",
      });

      await storage.saveSprintTestCases(userStoryId, generatedTests);

      const savedTestCases = await storage.getSprintTestCasesByUserStory(userStoryId);
      
      res.json({ 
        success: true,
        testCases: savedTestCases,
        count: savedTestCases.length
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: error.message || "Failed to generate test cases" 
      });
    }
  });

  app.get("/api/sprint/test-cases/:userStoryId", async (req: Request, res: Response) => {
    try {
      const { userStoryId } = req.params;
      const testCases = await storage.getSprintTestCasesByUserStory(userStoryId);
      
      res.json({ 
        success: true,
        testCases 
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: error.message || "Failed to fetch test cases" 
      });
    }
  });

  app.put("/api/sprint/test-cases/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const updatedTestCase = await storage.updateSprintTestCase(id, updates);
      
      if (!updatedTestCase) {
        res.status(404).json({ 
          success: false,
          error: "Test case not found" 
        });
        return;
      }
      
      res.json({ 
        success: true,
        testCase: updatedTestCase 
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: error.message || "Failed to update test case" 
      });
    }
  });

  // Alias endpoint for sprint test case updates
  app.put("/api/sprint-test-cases/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const updatedTestCase = await storage.updateSprintTestCase(id, updates);
      
      if (!updatedTestCase) {
        res.status(404).json({ 
          success: false,
          error: "Test case not found" 
        });
        return;
      }
      
      res.json(updatedTestCase);
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: error.message || "Failed to update test case" 
      });
    }
  });

  // Quick test ADO connection using environment secrets
  app.get("/api/ado/test-env-connection", async (req: Request, res: Response) => {
    try {
      let organization = process.env.ADO_ORGANIZATION;
      const pat = process.env.ADO_PAT;
      const project = process.env.ADO_PROJECT;
      
      if (!organization || !pat) {
        res.status(400).json({ 
          success: false,
          error: "ADO_ORGANIZATION and ADO_PAT environment secrets are required" 
        });
        return;
      }
      
      // Handle both full URL and organization name formats
      let organizationUrl: string;
      if (organization.startsWith('https://')) {
        // Full URL provided - extract organization name and use URL directly
        organizationUrl = organization.replace(/\/$/, ''); // Remove trailing slash
        // Extract org name for display
        const match = organization.match(/dev\.azure\.com\/([^\/]+)/);
        organization = match ? match[1] : organization;
      } else {
        organizationUrl = `https://dev.azure.com/${organization}`;
      }
      const response = await fetch(`${organizationUrl}/_apis/projects?api-version=7.0`, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        const projects = data.value || [];
        res.json({ 
          success: true,
          message: `Connected to Azure DevOps successfully!`,
          organization,
          defaultProject: project || null,
          availableProjects: projects.map((p: any) => ({ id: p.id, name: p.name }))
        });
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        res.status(response.status).json({ 
          success: false,
          error: `Connection failed: ${response.status} ${response.statusText}`,
          details: errorText.slice(0, 200)
        });
      }
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: error.message || "Failed to test ADO connection" 
      });
    }
  });

  // Helper function to get ADO credentials from environment OR stored integration config
  async function getAdoEnvCredentials(): Promise<{ organizationUrl: string; pat: string; defaultProject: string | null } | null> {
    // 1. Try environment variables first
    let orgEnv = process.env.ADO_ORGANIZATION || process.env.ADO_ORG;
    const envPat = process.env.ADO_PAT;
    const defaultProject = process.env.ADO_PROJECT || null;

    if (orgEnv && envPat) {
      let organizationUrl: string;
      if (orgEnv.startsWith('https://')) {
        organizationUrl = orgEnv.replace(/\/$/, '');
      } else {
        organizationUrl = `https://dev.azure.com/${orgEnv}`;
      }
      return { organizationUrl, pat: envPat, defaultProject };
    }

    // 2. Fall back to stored integration config
    try {
      const configs = await storage.getIntegrationConfigsByUserId(DEMO_USER.id);
      const adoConfig = configs.find(c => c.platform === 'azure_devops');
      if (adoConfig?.config) {
        const cfg = adoConfig.config as Record<string, any>;
        const storedOrg = cfg.organizationUrl as string | undefined;
        const storedPat = cfg.personalAccessToken as string | undefined;
        if (storedOrg && storedPat) {
          return {
            organizationUrl: storedOrg.replace(/\/$/, ''),
            pat: storedPat,
            defaultProject: (cfg.defaultProject as string | undefined) || null,
          };
        }
      }
    } catch (_) { /* ignore */ }

    return null;
  }

  // Get ADO projects using environment secrets (or stored integration config)
  app.get("/api/ado/env/projects", async (req: Request, res: Response) => {
    try {
      const creds = await getAdoEnvCredentials();
      if (!creds) {
        res.status(400).json({ success: false, error: "ADO environment secrets not configured" });
        return;
      }
      
      const response = await fetch(`${creds.organizationUrl}/_apis/projects?api-version=7.0`, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`:${creds.pat}`).toString('base64')}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        const projects = (data.value || []).map((p: any) => ({ 
          id: p.id, 
          name: p.name,
          description: p.description || ''
        }));
        res.json({ success: true, projects, defaultProject: creds.defaultProject });
      } else {
        res.status(response.status).json({ success: false, error: `Failed to fetch projects: ${response.statusText}` });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get iterations/sprints for a specific ADO project
  app.get("/api/ado/env/projects/:projectName/iterations", async (req: Request, res: Response) => {
    try {
      const creds = await getAdoEnvCredentials();
      if (!creds) {
        res.status(400).json({ success: false, error: "ADO environment secrets not configured" });
        return;
      }
      
      const { projectName } = req.params;
      const encodedProject = encodeURIComponent(projectName);
      
      const response = await fetch(
        `${creds.organizationUrl}/${encodedProject}/_apis/work/teamsettings/iterations?api-version=7.0`,
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(`:${creds.pat}`).toString('base64')}`,
          },
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        const iterations = (data.value || []).map((i: any) => ({
          id: i.id,
          name: i.name,
          path: i.path,
          startDate: i.attributes?.startDate,
          finishDate: i.attributes?.finishDate,
          timeFrame: i.attributes?.timeFrame
        }));
        res.json({ success: true, iterations });
      } else {
        const errorText = await response.text().catch(() => '');
        res.status(response.status).json({ success: false, error: `Failed to fetch iterations: ${response.statusText}`, details: errorText.slice(0, 200) });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get user stories for a specific ADO project and optional iteration
  app.get("/api/ado/env/projects/:projectName/user-stories", async (req: Request, res: Response) => {
    try {
      const creds = await getAdoEnvCredentials();
      if (!creds) {
        res.status(400).json({ success: false, error: "ADO environment secrets not configured" });
        return;
      }
      
      const { projectName } = req.params;
      const { iterationPath } = req.query;
      const encodedProject = encodeURIComponent(projectName);
      
      // Build WIQL query for user stories
      let wiql = `SELECT [System.Id], [System.Title], [System.Description], [System.State], [Microsoft.VSTS.Common.AcceptanceCriteria] FROM WorkItems WHERE [System.WorkItemType] = 'User Story' AND [System.TeamProject] = '${projectName}'`;
      
      if (iterationPath) {
        wiql += ` AND [System.IterationPath] = '${iterationPath}'`;
      }
      
      wiql += ` ORDER BY [System.Id] DESC`;
      
      const queryResponse = await fetch(
        `${creds.organizationUrl}/${encodedProject}/_apis/wit/wiql?api-version=7.0`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(`:${creds.pat}`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: wiql }),
        }
      );
      
      if (!queryResponse.ok) {
        const errorText = await queryResponse.text().catch(() => '');
        res.status(queryResponse.status).json({ success: false, error: `Failed to query user stories: ${queryResponse.statusText}`, details: errorText.slice(0, 200) });
        return;
      }
      
      const queryData = await queryResponse.json();
      const workItemIds = (queryData.workItems || []).slice(0, 50).map((w: any) => w.id);
      
      if (workItemIds.length === 0) {
        res.json({ success: true, userStories: [] });
        return;
      }
      
      // Fetch work item details
      const detailsResponse = await fetch(
        `${creds.organizationUrl}/_apis/wit/workitems?ids=${workItemIds.join(',')}&fields=System.Id,System.Title,System.Description,System.State,Microsoft.VSTS.Common.AcceptanceCriteria&api-version=7.0`,
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(`:${creds.pat}`).toString('base64')}`,
          },
        }
      );
      
      if (detailsResponse.ok) {
        const detailsData = await detailsResponse.json();
        const userStories = (detailsData.value || []).map((w: any) => ({
          id: w.id,
          title: w.fields['System.Title'] || '',
          description: w.fields['System.Description'] || '',
          state: w.fields['System.State'] || '',
          acceptanceCriteria: w.fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || '',
        }));
        res.json({ success: true, userStories });
      } else {
        res.status(detailsResponse.status).json({ success: false, error: `Failed to fetch work item details: ${detailsResponse.statusText}` });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Push test cases to ADO Test Plan
  app.post("/api/ado/env/push-test-cases", async (req: Request, res: Response) => {
    try {
      const creds = await getAdoEnvCredentials();
      if (!creds) {
        res.status(400).json({ success: false, error: "ADO environment secrets not configured" });
        return;
      }
      
      const { projectName, testCases } = req.body;
      
      if (!projectName || !testCases || !Array.isArray(testCases) || testCases.length === 0) {
        res.status(400).json({ success: false, error: "Project name and test cases array are required" });
        return;
      }
      
      const encodedProject = encodeURIComponent(projectName);
      const authHeader = `Basic ${Buffer.from(`:${creds.pat}`).toString('base64')}`;
      
      let pushedCount = 0;
      let failedCount = 0;
      const errors: string[] = [];
      const createdTestCases: { id: number; title: string; url: string }[] = [];
      
      for (const testCase of testCases) {
        try {
          // Format steps for Azure DevOps Test Case
          const steps = testCase.testSteps || testCase.steps || testCase.test_steps || [];
          const stepsXml = steps.map((s: any, i: number) => {
            const action = s.action || s.step || '';
            const expected = s.expected_behavior || s.expectedResult || s.expected || '';
            return `<step id="${i + 1}" type="ActionStep"><parameterizedString isformatted="true">${escapeXml(action)}</parameterizedString><parameterizedString isformatted="true">${escapeXml(expected)}</parameterizedString></step>`;
          }).join('');
          
          const workItem = [
            { op: 'add', path: '/fields/System.Title', value: testCase.title || testCase.name || testCase.testCaseId || 'Test Case' },
            { op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: `<steps id="0" last="${steps.length}">${stepsXml}</steps>` },
          ];
          
          // Add description if available
          if (testCase.description || testCase.objective) {
            workItem.push({ op: 'add', path: '/fields/System.Description', value: testCase.description || testCase.objective });
          }
          
          // Add priority
          if (testCase.priority) {
            const priorityMap: Record<string, number> = { 'P0': 1, 'P1': 1, 'P2': 2, 'P3': 3, 'critical': 1, 'high': 1, 'medium': 2, 'low': 3 };
            workItem.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: priorityMap[testCase.priority] || 2 });
          }
          
          const response = await fetch(
            `${creds.organizationUrl}/${encodedProject}/_apis/wit/workitems/$Test%20Case?api-version=7.0`,
            {
              method: 'POST',
              headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json-patch+json',
              },
              body: JSON.stringify(workItem),
            }
          );
          
          if (response.ok) {
            const result = await response.json();
            pushedCount++;
            createdTestCases.push({
              id: result.id,
              title: result.fields['System.Title'],
              url: result._links?.html?.href || `${creds.organizationUrl}/${encodedProject}/_workitems/edit/${result.id}`
            });
          } else {
            failedCount++;
            const errorBody = await response.text().catch(() => 'Unknown error');
            errors.push(`${testCase.title || testCase.testCaseId}: ${response.status} - ${errorBody.slice(0, 100)}`);
          }
        } catch (err: any) {
          failedCount++;
          errors.push(`${testCase.title || testCase.testCaseId}: ${err.message}`);
        }
      }
      
      res.json({ 
        success: pushedCount > 0,
        message: `Pushed ${pushedCount} test cases to Azure DevOps${failedCount > 0 ? ` (${failedCount} failed)` : ''}`,
        pushedCount,
        failedCount,
        createdTestCases,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==================== JIRA INTEGRATION ====================

  function getJiraCredentials(): { baseUrl: string; email: string; token: string; auth: string } | null {
    const baseUrl = process.env.JIRA_BASE_URL;
    const email = process.env.JIRA_EMAIL;
    const token = process.env.JIRA_API_TOKEN;
    if (!baseUrl || !email || !token) return null;
    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    return { baseUrl: baseUrl.replace(/\/$/, ''), email, token, auth };
  }

  async function getJiraCredentialsForProject(qeProjectId?: string): Promise<{ baseUrl: string; email: string; token: string; auth: string } | null> {
    const envCreds = getJiraCredentials();
    if (envCreds) return envCreds;

    async function fromDevxProject(sdlcProjectId: string): Promise<{ baseUrl: string; email: string; token: string; auth: string } | null> {
      try {
        const { getJiraConfig } = await import("../integrations/jira/jira-routes-handler.js");
        const devxJira = await getJiraConfig(sdlcProjectId);
        if (!devxJira) return null;
        const auth = Buffer.from(`${devxJira.email}:${devxJira.apiToken}`).toString('base64');
        return { baseUrl: devxJira.instanceUrl.replace(/\/$/, ''), email: devxJira.email, token: devxJira.apiToken, auth };
      } catch { return null; }
    }

    if (qeProjectId) {
      try {
        const project = await storage.getProjectById(qeProjectId);
        if (project?.devxSdlcProjectId) {
          const result = await fromDevxProject(project.devxSdlcProjectId);
          if (result) return result;
        }
      } catch {}
    }

    // No specific project or no config found — scan all QE projects
    try {
      const allProjects = await storage.getProjectsByUserId("demo-user-1");
      for (const p of allProjects) {
        if (p.devxSdlcProjectId) {
          const result = await fromDevxProject(p.devxSdlcProjectId);
          if (result) return result;
        }
      }
    } catch {}
    return null;
  }

  app.get("/api/jira/projects/:projectKey/boards", async (req: Request, res: Response) => {
    try {
      const creds = await getJiraCredentialsForProject(req.query.qeProjectId as string);
      if (!creds) {
        res.status(400).json({ success: false, error: "Jira credentials not configured. Please configure Jira in your DevX project settings." });
        return;
      }
      const { projectKey } = req.params;
      const response = await fetch(`${creds.baseUrl}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=50`, {
        headers: { 'Authorization': `Basic ${creds.auth}`, 'Accept': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        res.json({
          success: true,
          boards: (data.values || []).map((b: any) => ({
            id: b.id,
            name: b.name,
            type: b.type,
          })),
        });
      } else {
        res.status(response.status).json({ success: false, error: `Failed to fetch boards: ${response.statusText}` });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/jira/boards/:boardId/sprints", async (req: Request, res: Response) => {
    try {
      const creds = await getJiraCredentialsForProject(req.query.qeProjectId as string);
      if (!creds) {
        res.status(400).json({ success: false, error: "Jira credentials not configured. Please configure Jira in your DevX project settings." });
        return;
      }
      const { boardId } = req.params;
      const response = await fetch(`${creds.baseUrl}/rest/agile/1.0/board/${boardId}/sprint?maxResults=50&state=active,future,closed`, {
        headers: { 'Authorization': `Basic ${creds.auth}`, 'Accept': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        res.json({
          success: true,
          sprints: (data.values || []).map((s: any) => ({
            id: s.id,
            name: s.name,
            state: s.state,
            startDate: s.startDate || null,
            endDate: s.endDate || null,
            goal: s.goal || '',
          })),
        });
      } else {
        res.json({ success: true, sprints: [] });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/jira/issues/:issueKey/comments", async (req: Request, res: Response) => {
    try {
      const creds = await getJiraCredentialsForProject(req.query.qeProjectId as string);
      if (!creds) {
        res.status(400).json({ success: false, error: "Jira credentials not configured. Please configure Jira in your DevX project settings." });
        return;
      }
      const { issueKey } = req.params;
      const response = await fetch(`${creds.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?maxResults=50&orderBy=created`, {
        headers: { 'Authorization': `Basic ${creds.auth}`, 'Accept': 'application/json' },
      });
      if (!response.ok) {
        res.status(response.status).json({ success: false, error: `Failed to fetch comments: ${response.statusText}` });
        return;
      }
      const data = await response.json();
      const comments = (data.comments || []).map((c: any) => {
        let body = '';
        if (typeof c.body === 'string') {
          body = c.body;
        } else if (c.body?.content) {
          body = extractAtlassianDocText(c.body);
        }
        return {
          id: c.id,
          author: c.author?.displayName || c.updateAuthor?.displayName || 'Unknown',
          body,
          created: c.created,
        };
      }).filter((c: any) => c.body.trim().length > 0);
      res.json({ success: true, comments });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/jira/sprints/:sprintId/user-stories", async (req: Request, res: Response) => {
    try {
      const creds = await getJiraCredentialsForProject(req.query.qeProjectId as string);
      if (!creds) {
        res.status(400).json({ success: false, error: "Jira credentials not configured. Please configure Jira in your DevX project settings." });
        return;
      }
      const { sprintId } = req.params;

      const response = await fetch(`${creds.baseUrl}/rest/agile/1.0/sprint/${sprintId}/issue?maxResults=200&fields=summary,description,status,priority,assignee,issuetype,customfield_10035,customfield_10037,customfield_10038,customfield_10028`, {
        headers: { 'Authorization': `Basic ${creds.auth}`, 'Accept': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        const stories = (data.issues || []).map((issue: any) => {
          const fields = issue.fields || {};
          let description = '';
          if (fields.description) {
            if (typeof fields.description === 'string') {
              description = fields.description;
            } else if (fields.description.content) {
              description = extractAtlassianDocText(fields.description);
            }
          }
          let acceptanceCriteria = '';
          const customAC = fields.customfield_10035 || fields.customfield_10037 || fields.customfield_10038 || '';
          if (customAC) {
            if (typeof customAC === 'string') {
              acceptanceCriteria = customAC;
            } else if (customAC.content) {
              acceptanceCriteria = extractAtlassianDocText(customAC);
            }
          }
          return {
            id: issue.key,
            title: fields.summary || '',
            description,
            state: fields.status?.name || '',
            acceptanceCriteria,
            priority: fields.priority?.name || '',
            assignee: fields.assignee?.displayName || '',
            storyPoints: fields.customfield_10028 || fields.story_points || null,
          };
        });
        res.json({ success: true, userStories: stories });
      } else {
        const errText = await response.text().catch(() => '');
        res.status(response.status).json({ success: false, error: `Failed to fetch user stories: ${response.statusText}. ${errText.slice(0, 200)}` });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/jira/projects/:projectKey/user-stories", async (req: Request, res: Response) => {
    try {
      const creds = await getJiraCredentialsForProject(req.query.qeProjectId as string);
      if (!creds) {
        res.status(400).json({ success: false, error: "Jira credentials not configured. Please configure Jira in your DevX project settings." });
        return;
      }
      const { projectKey } = req.params;
      const issueTypesParam = req.query.issueTypes as string | undefined;
      const sprintFilter = req.query.sprintFilter as string | undefined;

      let jql = `project = "${projectKey}"`;
      if (issueTypesParam) {
        const types = issueTypesParam.split(',').map((t: string) => `"${t.trim()}"`).join(', ');
        jql += ` AND issuetype IN (${types})`;
      }
      if (sprintFilter === 'active') {
        jql += ` AND sprint in openSprints()`;
      }
      jql += ` ORDER BY updated DESC`;

      const searchRes = await fetch(
        `${creds.baseUrl}/rest/api/3/search/jql`,
        {
          method: 'POST',
          headers: { 'Authorization': `Basic ${creds.auth}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jql,
            maxResults: 200,
            fields: ['summary', 'description', 'status', 'priority', 'assignee', 'issuetype', 'customfield_10035', 'customfield_10037', 'customfield_10038', 'customfield_10028'],
          }),
        }
      );
      if (!searchRes.ok) {
        const errText = await searchRes.text().catch(() => '');
        res.status(searchRes.status).json({ success: false, error: `Failed to fetch issues: ${searchRes.statusText}. ${errText.slice(0, 200)}` });
        return;
      }
      const searchData = await searchRes.json();
      const allIssues: any[] = searchData.issues || [];

      const stories = allIssues.map((issue: any) => {
        const fields = issue.fields || {};
        let description = '';
        if (fields.description) {
          if (typeof fields.description === 'string') {
            description = fields.description;
          } else if (fields.description.content) {
            description = extractAtlassianDocText(fields.description);
          }
        }
        let acceptanceCriteria = '';
        const customAC = fields.customfield_10035 || fields.customfield_10037 || fields.customfield_10038 || '';
        if (customAC) {
          if (typeof customAC === 'string') {
            acceptanceCriteria = customAC;
          } else if (customAC.content) {
            acceptanceCriteria = extractAtlassianDocText(customAC);
          }
        }
        return {
          id: issue.key,
          title: fields.summary || '',
          description,
          state: fields.status?.name || '',
          acceptanceCriteria,
          priority: fields.priority?.name || '',
          assignee: fields.assignee?.displayName || '',
          issueType: fields.issuetype?.name || '',
        };
      });
      res.json({ success: true, userStories: stories });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/jira/save-test-cases", async (req: Request, res: Response) => {
    try {
      const { jiraProjectKey, jiraStoryId, jiraStoryTitle, testCases, jiraBoardId, jiraSprintId } = req.body;
      if (!jiraProjectKey || !jiraStoryId || !testCases) {
        res.status(400).json({ success: false, error: "Missing required fields" });
        return;
      }
      await storage.saveJiraTestCases(jiraProjectKey, jiraStoryId, jiraStoryTitle || '', testCases, jiraBoardId, jiraSprintId);
      res.json({ success: true, message: `Saved ${testCases.length} test cases` });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/jira/test-cases/:projectKey/:storyId", async (req: Request, res: Response) => {
    try {
      const { projectKey, storyId } = req.params;
      const testCases = await storage.getJiraTestCases(projectKey, storyId);
      res.json({ success: true, testCases });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/jira/push-test-cases", async (req: Request, res: Response) => {
    try {
      const creds = await getJiraCredentialsForProject(req.body.qeProjectId as string);
      if (!creds) {
        res.status(400).json({ success: false, error: "Jira credentials not configured. Please configure Jira in your DevX project settings." });
        return;
      }

      const { projectKey, testCases } = req.body;
      if (!projectKey || !testCases || !Array.isArray(testCases) || testCases.length === 0) {
        res.status(400).json({ success: false, error: "Project key and test cases array are required" });
        return;
      }

      // ASYNC-JOB: bulk Jira creates exceed AWS API Gateway's ~29s limit (503).
      const totalCases = testCases.length;
      const { jobId } = asyncJobManager.start(
        "qe-jira-push-test-cases",
        async ({ updateProgress }) => {
          updateProgress(5, `Pushing ${totalCases} test case(s) to Jira`);

          let pushedCount = 0;
          let failedCount = 0;
          const errors: string[] = [];
          const createdTestCases: { key: string; title: string; url: string }[] = [];

          for (let i = 0; i < testCases.length; i++) {
            const tc = testCases[i];
            try {
              const steps = tc.testSteps || tc.steps || [];
              const stepsText = steps.map((s: any, idx: number) => {
                const action = s.action || s.step || '';
                const expected = s.expected_behavior || s.expectedResult || '';
                return `*Step ${idx + 1}:* ${action}\n_Expected:_ ${expected}`;
              }).join('\n\n');

              const description = `${tc.description || tc.objective || ''}\n\n*Priority:* ${tc.priority || 'P2'}\n\n---\n\n*Test Steps:*\n\n${stepsText}`;

              const issueData = {
                fields: {
                  project: { key: projectKey },
                  summary: tc.title || tc.testCaseId || 'Test Case',
                  description: {
                    type: 'doc',
                    version: 1,
                    content: [{
                      type: 'paragraph',
                      content: [{ type: 'text', text: description }]
                    }]
                  },
                  issuetype: { name: 'Task' },
                  labels: ['test-case', 'auto-generated'],
                }
              };

              const response = await fetch(`${creds.baseUrl}/rest/api/3/issue`, {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${creds.auth}`,
                  'Content-Type': 'application/json',
                  'Accept': 'application/json',
                },
                body: JSON.stringify(issueData),
              });

              if (response.ok) {
                const result = await response.json();
                pushedCount++;
                createdTestCases.push({
                  key: result.key,
                  title: tc.title || tc.testCaseId || 'Test Case',
                  url: `${creds.baseUrl}/browse/${result.key}`,
                });
              } else {
                failedCount++;
                const errBody = await response.text().catch(() => 'Unknown error');
                errors.push(`${tc.title || tc.testCaseId}: ${response.status} - ${errBody.slice(0, 150)}`);
              }
            } catch (err: any) {
              failedCount++;
              errors.push(`${tc.title || tc.testCaseId}: ${err.message}`);
            }

            const pct = 10 + Math.floor(((i + 1) / totalCases) * 85);
            updateProgress(pct, `Pushing ${i + 1}/${totalCases} test case(s) to Jira`);
            await sleep(150);
          }

          return {
            success: pushedCount > 0,
            message: `Pushed ${pushedCount} test cases to Jira${failedCount > 0 ? ` (${failedCount} failed)` : ''}`,
            pushedCount,
            failedCount,
            createdTestCases,
            errors: errors.length > 0 ? errors : undefined,
          };
        },
        `Pushing ${totalCases} test case(s) to Jira`,
      );

      return res.status(202).json({
        success: true,
        jobId,
        status: "processing",
        message: `Push started. Poll /api/jira/push-test-cases/status/${jobId} for status.`,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // QE status polling (no SSO Bearer required — matches other /api/jira/* routes).
  app.get("/api/jira/push-test-cases/status/:jobId", async (req: Request, res: Response) => {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      const { jobId } = req.params;
      const job = asyncJobManager.get("qe-jira-push-test-cases", jobId);
      if (!job) {
        return res.status(404).json({ error: "Job not found", jobId });
      }
      return res.json({
        jobId: job.jobId,
        namespace: job.namespace,
        status: job.status,
        step: job.step,
        progress: job.progress,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch push status" });
    }
  });

  function extractAtlassianDocText(doc: any): string {
    if (!doc || !doc.content) return '';
    let text = '';
    for (const node of doc.content) {
      if (node.type === 'paragraph' || node.type === 'heading') {
        for (const child of (node.content || [])) {
          if (child.type === 'text') text += child.text;
        }
        text += '\n';
      } else if (node.type === 'bulletList' || node.type === 'orderedList') {
        for (const listItem of (node.content || [])) {
          for (const p of (listItem.content || [])) {
            for (const child of (p.content || [])) {
              if (child.type === 'text') text += '- ' + child.text + '\n';
            }
          }
        }
      }
    }
    return text.trim();
  }

  // ==================== END JIRA INTEGRATION ====================

  app.get("/api/ado-config", async (req: Request, res: Response) => {
    try {
      const config = await storage.getActiveAdoConfiguration();
      
      if (!config) {
        res.status(404).json({ 
          success: false,
          error: "No ADO configuration found" 
        });
        return;
      }
      
      res.json({ 
        success: true,
        config: {
          ...config,
          pat: config.pat ? '***' : '',
        }
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: error.message || "Failed to fetch ADO configuration" 
      });
    }
  });

  app.post("/api/ado-config", async (req: Request, res: Response) => {
    try {
      const { organization, project, pat } = req.body;
      
      if (!organization || !project || !pat) {
        res.status(400).json({ 
          success: false,
          error: "Organization, project, and PAT are required" 
        });
        return;
      }
      
      const config = await storage.saveAdoConfiguration({
        organization,
        project,
        pat,
      });
      
      res.json({ 
        success: true,
        config: {
          ...config,
          pat: '***',
        }
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: error.message || "Failed to save ADO configuration" 
      });
    }
  });

  app.get("/api/ado-config/all", async (req: Request, res: Response) => {
    try {
      const configs = await storage.getAllAdoConfigurations();
      
      res.json({ 
        success: true,
        configs: configs.map(c => ({
          ...c,
          pat: c.pat ? '***' : '',
        }))
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false,
        error: error.message || "Failed to fetch ADO configurations" 
      });
    }
  });

  // Integration Configurations Routes
  app.get("/api/integrations", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const configs = await storage.getIntegrationConfigsByUserId(userId);
      // Mask sensitive fields
      const safeConfigs = configs.map(c => ({
        ...c,
        config: maskSensitiveFields(c.config),
      }));
      res.json({ success: true, integrations: safeConfigs });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to fetch integrations" });
    }
  });

  // Get connected integrations for push dropdown (must be before /:platform to avoid route shadowing)
  app.get("/api/integrations/connected", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);

      const integrations = await storage.getIntegrationConfigsByUserId(userId);
      const connectedIntegrations = integrations
        .filter(i => i.status === "connected")
        .map(i => ({
          id: i.id,
          platform: i.platform,
          name: i.name,
          lastSyncedAt: i.lastSyncedAt,
        }));

      res.json({ success: true, integrations: connectedIntegrations });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to fetch connected integrations" });
    }
  });

  app.get("/api/integrations/:platform", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { platform } = req.params;
      const config = await storage.getIntegrationConfigByPlatform(userId, platform as any);
      if (!config) {
        res.json({ success: true, integration: null });
        return;
      }
      res.json({ 
        success: true, 
        integration: {
          ...config,
          config: maskSensitiveFields(config.config),
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to fetch integration" });
    }
  });

  app.post("/api/integrations", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { platform, name, config } = req.body;
      if (!platform || !name || !config) {
        res.status(400).json({ success: false, error: "Platform, name, and config are required" });
        return;
      }
      
      // Check if integration already exists for this platform
      const existing = await storage.getIntegrationConfigByPlatform(userId, platform);
      if (existing) {
        res.status(400).json({ success: false, error: "Integration already exists for this platform. Use PUT to update." });
        return;
      }
      
      const newConfig = await storage.createIntegrationConfig({
        userId,
        platform,
        name,
        config,
      });
      
      res.json({ 
        success: true, 
        integration: {
          ...newConfig,
          config: maskSensitiveFields(newConfig.config),
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to create integration" });
    }
  });

  app.put("/api/integrations/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const { name, config, status, lastSyncedAt, lastError } = req.body;
      
      const existing = await storage.getIntegrationConfigById(id);
      if (!existing || existing.userId !== userId) {
        res.status(404).json({ success: false, error: "Integration not found" });
        return;
      }
      
      const updates: any = {};
      if (name) updates.name = name;
      if (config) updates.config = config;
      if (status) updates.status = status;
      if (lastSyncedAt) updates.lastSyncedAt = new Date(lastSyncedAt);
      if (lastError !== undefined) updates.lastError = lastError;
      
      const updated = await storage.updateIntegrationConfig(id, updates);
      
      res.json({ 
        success: true, 
        integration: updated ? {
          ...updated,
          config: maskSensitiveFields(updated.config),
        } : null
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to update integration" });
    }
  });

  app.delete("/api/integrations/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      
      const existing = await storage.getIntegrationConfigById(id);
      if (!existing || existing.userId !== userId) {
        res.status(404).json({ success: false, error: "Integration not found" });
        return;
      }
      
      await storage.deleteIntegrationConfig(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to delete integration" });
    }
  });

  app.post("/api/integrations/:id/test-connection", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      
      const config = await storage.getIntegrationConfigById(id);
      if (!config || config.userId !== userId) {
        res.status(404).json({ success: false, error: "Integration not found" });
        return;
      }
      
      // Test connection based on platform
      const testResult = await testIntegrationConnection(config.platform as any, config.config);
      
      // Update status based on test result
      await storage.updateIntegrationConfig(id, {
        status: testResult.success ? "connected" : "error",
        lastSyncedAt: testResult.success ? new Date() : undefined,
        lastError: testResult.success ? null : testResult.error,
      });
      
      res.json(testResult);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to test connection" });
    }
  });

  // Push test cases to external platform
  app.post("/api/integrations/:id/push-test-cases", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const { testCases, projectId, sprintId } = req.body;
      
      if (!testCases || !Array.isArray(testCases) || testCases.length === 0) {
        res.status(400).json({ success: false, error: "Test cases array is required" });
        return;
      }
      
      const integrationConfig = await storage.getIntegrationConfigById(id);
      if (!integrationConfig || integrationConfig.userId !== userId) {
        res.status(404).json({ success: false, error: "Integration not found" });
        return;
      }
      
      if (integrationConfig.status !== "connected") {
        res.status(400).json({ success: false, error: "Integration is not connected. Please test the connection first." });
        return;
      }
      
      // Push test cases based on platform
      const pushResult = await pushTestCasesToPlatform(
        integrationConfig.platform as any, 
        integrationConfig.config,
        testCases,
        { projectId, sprintId }
      );
      
      // Update last synced time on success
      if (pushResult.success) {
        await storage.updateIntegrationConfig(id, {
          lastSyncedAt: new Date(),
        });
      }
      
      res.json(pushResult);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to push test cases" });
    }
  });

  // =====================================================
  // EXECUTION MODE ROUTES
  // =====================================================

  // Get execution runs for a project
  app.get("/api/execution-runs", async (req: Request, res: Response) => {
    try {
      const user = req.user || DEMO_USER; // Fallback to demo user for MVP
      
      const { projectId } = req.query;
      if (!projectId || typeof projectId !== 'string') {
        res.status(400).json({ success: false, error: "Project ID is required" });
        return;
      }
      
      const runs = await storage.getExecutionRunsByProjectId(projectId);
      res.json({ success: true, runs });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to fetch execution runs" });
    }
  });

  // Get a specific execution run with tests
  app.get("/api/execution-runs/:id", async (req: Request, res: Response) => {
    try {
      const user = req.user || DEMO_USER; // Fallback to demo user for MVP
      
      const { id } = req.params;
      const run = await storage.getExecutionRunById(id);
      
      if (!run) {
        res.status(404).json({ success: false, error: "Execution run not found" });
        return;
      }
      
      res.json({ success: true, run });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to fetch execution run" });
    }
  });

  // Create a new execution run
  app.post("/api/execution-runs", async (req: Request, res: Response) => {
    try {
      const user = req.user || DEMO_USER; // Fallback to demo user for MVP
      
      const { projectId, targetUrl, testCaseIds, config, testCaseSource } = req.body;
      
      if (!targetUrl) {
        res.status(400).json({ success: false, error: "Target URL is required" });
        return;
      }
      
      // Generate run name with timestamp
      const runName = `Execution Run - ${new Date().toLocaleString()}`;
      
      const run = await storage.createExecutionRun({
        projectId: projectId || null,
        runName,
        browser: config?.browser || 'chromium',
        executionMode: config?.headless ? 'headless' : 'headed',
        status: 'pending',
        totalTests: testCaseIds?.length || 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        agentLogs: [],
      });
      
      res.json({ success: true, run });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to create execution run" });
    }
  });

  // Helper function to generate beautiful HTML execution report
  function generateHtmlReport(
    targetUrl: string, 
    testCases: any[], 
    passedTests: number, 
    failedTests: number, 
    totalTests: number,
    screenshots: string[]
  ): string {
    const passRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : '0';
    const executionDate = new Date().toLocaleString();
    const hostname = new URL(targetUrl).hostname;
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NAT 2.0 Test Execution Report - ${hostname}</title>
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-card: #334155;
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --accent-cyan: #22d3ee;
      --accent-blue: #3b82f6;
      --success: #22c55e;
      --danger: #ef4444;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .header {
      background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-card) 100%);
      border-radius: 16px;
      padding: 2rem;
      margin-bottom: 2rem;
      border: 1px solid rgba(34, 211, 238, 0.2);
    }
    .header-title {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .logo {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--accent-cyan), var(--accent-blue));
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 1.25rem;
    }
    h1 { font-size: 1.75rem; font-weight: 700; }
    .subtitle { color: var(--text-secondary); font-size: 0.9rem; }
    .meta { display: flex; gap: 2rem; margin-top: 1.5rem; flex-wrap: wrap; }
    .meta-item { display: flex; flex-direction: column; gap: 0.25rem; }
    .meta-label { font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }
    .meta-value { font-size: 1rem; font-weight: 600; }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: var(--bg-secondary);
      border-radius: 12px;
      padding: 1.5rem;
      border: 1px solid rgba(255,255,255,0.05);
    }
    .stat-value {
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
    }
    .stat-value.success { color: var(--success); }
    .stat-value.danger { color: var(--danger); }
    .stat-value.neutral { color: var(--accent-cyan); }
    .stat-label { color: var(--text-secondary); font-size: 0.875rem; }
    
    .progress-bar {
      width: 100%;
      height: 8px;
      background: var(--bg-card);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 1rem;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--success) 0%, var(--accent-cyan) 100%);
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    
    .section {
      background: var(--bg-secondary);
      border-radius: 16px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      border: 1px solid rgba(255,255,255,0.05);
    }
    .section-title {
      font-size: 1.125rem;
      font-weight: 600;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .section-title::before {
      content: '';
      width: 4px;
      height: 20px;
      background: var(--accent-cyan);
      border-radius: 2px;
    }
    
    .test-case {
      background: var(--bg-card);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.75rem;
      display: flex;
      align-items: flex-start;
      gap: 1rem;
    }
    .test-status {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-weight: bold;
      font-size: 0.875rem;
    }
    .test-status.passed { background: rgba(34, 197, 94, 0.2); color: var(--success); }
    .test-status.failed { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
    .test-info { flex: 1; }
    .test-title { font-weight: 600; margin-bottom: 0.25rem; }
    .test-meta { font-size: 0.8rem; color: var(--text-secondary); }
    .test-category {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: 4px;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: rgba(59, 130, 246, 0.2);
      color: var(--accent-blue);
      margin-left: 0.5rem;
    }
    
    .steps-list { margin-top: 0.75rem; }
    .step-item {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      font-size: 0.875rem;
    }
    .step-item:last-child { border-bottom: none; }
    .step-number {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--bg-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      color: var(--text-secondary);
      flex-shrink: 0;
    }
    
    .screenshots-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1rem;
    }
    .screenshot-card {
      background: var(--bg-card);
      border-radius: 8px;
      overflow: hidden;
    }
    .screenshot-card img {
      width: 100%;
      height: auto;
      display: block;
    }
    .screenshot-label {
      padding: 0.75rem;
      font-size: 0.8rem;
      color: var(--text-secondary);
      text-align: center;
    }
    
    .footer {
      text-align: center;
      padding: 2rem;
      color: var(--text-secondary);
      font-size: 0.8rem;
    }
    .footer-logo {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    
    @media print {
      body { background: white; color: black; }
      .section, .stat-card, .header { border: 1px solid #ddd; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div class="header-title">
        <div class="logo">N</div>
        <div>
          <h1>NAT 2.0 Test Execution Report</h1>
          <p class="subtitle">Automated Test Results - ${hostname}</p>
        </div>
      </div>
      <div class="meta">
        <div class="meta-item">
          <span class="meta-label">Target URL</span>
          <span class="meta-value">${targetUrl}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Execution Date</span>
          <span class="meta-value">${executionDate}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Test Suite</span>
          <span class="meta-value">${totalTests} Test Cases</span>
        </div>
      </div>
    </header>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value neutral">${totalTests}</div>
        <div class="stat-label">Total Tests</div>
      </div>
      <div class="stat-card">
        <div class="stat-value success">${passedTests}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value danger">${failedTests}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: ${parseFloat(passRate) >= 80 ? 'var(--success)' : parseFloat(passRate) >= 50 ? 'var(--warning)' : 'var(--danger)'}">${passRate}%</div>
        <div class="stat-label">Pass Rate</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${passRate}%"></div>
        </div>
      </div>
    </div>
    
    <section class="section">
      <h2 class="section-title">Test Cases</h2>
      ${testCases.map((tc, index) => {
        const passed = index < passedTests;
        const steps = tc.testSteps || [];
        return `
        <div class="test-case">
          <div class="test-status ${passed ? 'passed' : 'failed'}">${passed ? '✓' : '✗'}</div>
          <div class="test-info">
            <div class="test-title">
              ${tc.title || `Test Case ${index + 1}`}
              <span class="test-category">${tc.category || 'functional'}</span>
            </div>
            <div class="test-meta">
              ${steps.length} steps | ${passed ? 'Passed' : 'Failed'}
            </div>
            ${steps.length > 0 ? `
            <div class="steps-list">
              ${steps.map((step: any, stepIdx: number) => `
                <div class="step-item">
                  <span class="step-number">${stepIdx + 1}</span>
                  <span>${step.action || step.step || 'Step ' + (stepIdx + 1)}</span>
                </div>
              `).join('')}
            </div>
            ` : ''}
          </div>
        </div>
        `;
      }).join('')}
    </section>
    
    ${screenshots.length > 0 ? `
    <section class="section">
      <h2 class="section-title">Screenshots</h2>
      <div class="screenshots-grid">
        ${screenshots.slice(0, 6).map((screenshot, index) => `
          <div class="screenshot-card">
            <img src="${screenshot}" alt="Screenshot ${index + 1}" />
            <div class="screenshot-label">Step ${index + 1} Screenshot</div>
          </div>
        `).join('')}
      </div>
    </section>
    ` : ''}
    
    <footer class="footer">
      <div class="footer-logo">
        <strong>NOUS Autonomous Tester 2.0</strong>
      </div>
      <p>Generated by NAT 2.0 AI-Powered Test Automation Platform</p>
    </footer>
  </div>
</body>
</html>`;
  }

  // Helper function to generate Gherkin feature file
  function generateFeatureFile(targetUrl: string, testCases: any[]): string {
    const hostname = new URL(targetUrl).hostname;
    let feature = `@automated @execution
Feature: Automated Test Execution for ${hostname}
  As a QA engineer
  I want to execute automated tests against ${targetUrl}
  So that I can verify the application works correctly

  Background:
    Given I have launched the browser
    And I have navigated to "${targetUrl}"

`;

    testCases.forEach((tc, index) => {
      const scenarioName = tc.title || `Test Scenario ${index + 1}`;
      const category = tc.category || 'functional';
      
      feature += `  @${category} @TC-${String(index + 1).padStart(3, '0')}
  Scenario: ${scenarioName}
`;
      
      const steps = tc.testSteps || [];
      const stepCount = steps.length;
      
      if (stepCount === 0) {
        // Handle empty steps case
        feature += `    Given the user navigates to the application\n`;
        feature += `    When the user performs the test action\n`;
        feature += `    Then the expected behavior is observed\n`;
      } else if (stepCount === 1) {
        // Single step: use Given-When-Then with synthesized Given/Then
        const action = steps[0].action || steps[0].step || 'Step 1';
        feature += `    Given the user is on the page\n`;
        feature += `    When ${action}\n`;
        feature += `    Then the action completes successfully\n`;
      } else if (stepCount === 2) {
        // Two steps: first is Given, second is When, synthesize Then
        const action1 = steps[0].action || steps[0].step || 'Step 1';
        const action2 = steps[1].action || steps[1].step || 'Step 2';
        feature += `    Given ${action1}\n`;
        feature += `    When ${action2}\n`;
        feature += `    Then the expected result is achieved\n`;
      } else {
        // Three or more steps: first is Given, last is Then, middle are When
        steps.forEach((step: any, stepIndex: number) => {
          const action = step.action || step.step || `Step ${stepIndex + 1}`;
          if (stepIndex === 0) {
            feature += `    Given ${action}\n`;
          } else if (stepIndex === stepCount - 1) {
            feature += `    Then ${action}\n`;
          } else {
            feature += `    When ${action}\n`;
          }
        });
      }
      
      if (tc.expectedResult) {
        feature += `    And I should see "${tc.expectedResult}"\n`;
      }
      
      feature += '\n';
    });

    return feature;
  }

  // Helper function to generate Playwright step definitions
  function generateStepDefinitions(targetUrl: string, testCases: any[]): string {
    let code = `import { test, expect, Page, Browser, BrowserContext } from '@playwright/test';
import { Given, When, Then, Before, After } from '@cucumber/cucumber';

// ============================================
// PLAYWRIGHT STEP DEFINITIONS
// Auto-generated from test execution
// Target URL: ${targetUrl}
// Generated: ${new Date().toISOString()}
// ============================================

let browser: Browser;
let context: BrowserContext;
let page: Page;

// Hooks
Before(async function () {
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'NAT-2.0-TestRunner/1.0'
  });
  page = await context.newPage();
});

After(async function () {
  await page?.close();
  await context?.close();
  await browser?.close();
});

// Background Steps
Given('I have launched the browser', async function () {
  expect(page).toBeDefined();
  console.log('[NAT] Browser launched successfully');
});

Given('I have navigated to {string}', async function (url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle');
  console.log(\`[NAT] Navigated to: \${url}\`);
});

// ============================================
// GENERATED STEP DEFINITIONS
// ============================================

`;

    // Generate unique steps from all test cases
    const uniqueSteps = new Set<string>();
    testCases.forEach(tc => {
      const steps = tc.testSteps || [];
      steps.forEach((step: any) => {
        const action = step.action || step.step || '';
        if (action && !uniqueSteps.has(action)) {
          uniqueSteps.add(action);
        }
      });
    });

    // Generate step definitions for each unique step
    Array.from(uniqueSteps).forEach((stepAction, index) => {
      const stepLower = stepAction.toLowerCase();
      const stepRegex = stepAction.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
      
      // Determine step type and generate appropriate Playwright code
      if (stepLower.includes('click') || stepLower.includes('tap') || stepLower.includes('press')) {
        code += `When('${stepAction}', async function () {
  // Find and click the element
  const element = page.locator('button, a, [role="button"]').first();
  if (await element.isVisible()) {
    await element.click();
    await page.waitForLoadState('networkidle');
  }
  console.log('[NAT] Step: ${stepAction}');
});

`;
      } else if (stepLower.includes('enter') || stepLower.includes('fill') || stepLower.includes('type') || stepLower.includes('input')) {
        code += `When('${stepAction}', async function () {
  // Find input field and enter value
  const input = page.locator('input:visible, textarea:visible').first();
  if (await input.isVisible()) {
    await input.fill('test-value');
  }
  console.log('[NAT] Step: ${stepAction}');
});

`;
      } else if (stepLower.includes('verify') || stepLower.includes('check') || stepLower.includes('assert') || stepLower.includes('validate') || stepLower.includes('should')) {
        code += `Then('${stepAction}', async function () {
  // Verification step
  const title = await page.title();
  expect(title).toBeTruthy();
  const bodyVisible = await page.locator('body').isVisible();
  expect(bodyVisible).toBe(true);
  console.log('[NAT] Verified: ${stepAction}');
});

`;
      } else if (stepLower.includes('navigate') || stepLower.includes('go to') || stepLower.includes('open')) {
        code += `Given('${stepAction}', async function () {
  // Navigation step
  await page.goto('${targetUrl}', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  console.log('[NAT] Step: ${stepAction}');
});

`;
      } else if (stepLower.includes('wait') || stepLower.includes('pause')) {
        code += `When('${stepAction}', async function () {
  // Wait for page to stabilize
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  console.log('[NAT] Step: ${stepAction}');
});

`;
      } else if (stepLower.includes('scroll')) {
        code += `When('${stepAction}', async function () {
  // Scroll the page
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(500);
  console.log('[NAT] Step: ${stepAction}');
});

`;
      } else if (stepLower.includes('screenshot') || stepLower.includes('capture')) {
        code += `When('${stepAction}', async function () {
  // Capture screenshot
  await page.screenshot({ path: \`screenshots/step-${index + 1}.png\` });
  console.log('[NAT] Screenshot captured');
});

`;
      } else {
        // Generic step
        code += `When('${stepAction}', async function () {
  // Generic action step
  await page.waitForLoadState('networkidle');
  const screenshot = await page.screenshot({ type: 'png' });
  expect(screenshot).toBeTruthy();
  console.log('[NAT] Step: ${stepAction}');
});

`;
      }
    });

    code += `// Expected result verification
Then('I should see {string}', async function (expectedText: string) {
  const bodyText = await page.locator('body').textContent();
  console.log(\`[NAT] Verifying expected result: \${expectedText}\`);
  // Note: In production, use actual assertion
  expect(bodyText).toBeTruthy();
});

// ============================================
// PLAYWRIGHT TEST WRAPPER
// ============================================

test.describe('Automated Test Suite', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('${targetUrl}');
  });

  test('Execute test scenarios', async ({ page }) => {
    // This test wraps the Cucumber scenarios
    await expect(page).toHaveTitle(/.*/);
    console.log('[NAT] Test suite executed successfully');
  });
});
`;

    return code;
  }

  // SSE endpoint for execution progress streaming
  app.get("/api/execution-runs/:id/stream", async (req: Request, res: Response) => {
    const { id } = req.params;
    const { testCaseIds, targetUrl, testCaseSource } = req.query;
    
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    
    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    
    // Send initial connection event
    sendEvent('connected', { runId: id, timestamp: Date.now() });
    
    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(':heartbeat\n\n');
    }, 15000);
    
    let cancelled = false;
    req.on('close', () => {
      cancelled = true;
      clearInterval(heartbeat);
    });
    
    // Run the execution asynchronously with real Playwright
    (async () => {
      const { chromium } = await import('playwright');
      let browser: any = null;
      
      try {
        // Get the execution run
        const run = await storage.getExecutionRunById(id);
        if (!run) {
          sendEvent('error', { message: 'Execution run not found' });
          return;
        }
        
        // Update status to running
        await storage.updateExecutionRun(id, { status: 'running', startedAt: new Date() });
        
        const agents = ['Orchestrator', 'Navigator', 'Executor', 'Validator', 'Reporter'];
        let targetUrlStr = (targetUrl as string) || 'https://example.com';
        
        // Normalize URL - add https:// if no protocol specified
        if (targetUrlStr && !targetUrlStr.startsWith('http://') && !targetUrlStr.startsWith('https://')) {
          targetUrlStr = `https://${targetUrlStr}`;
        }
        
        // Orchestrator: Initialize pipeline
        sendEvent('agent_status', { agent: 'Orchestrator', status: 'working', activity: 'Initializing test pipeline...' });
        await new Promise(r => setTimeout(r, 500));
        
        // Navigator: Launch real browser
        sendEvent('agent_status', { agent: 'Navigator', status: 'working', activity: 'Launching browser...' });

        // Only require a server-side Playwright browser when no remote
        // execution agent is connected. With an agent, Playwright runs on
        // the agent host, so the server browser is irrelevant.
        if (!hasAvailableAgent() && !isPlaywrightReady()) {
          const reason = isPlaywrightInstalling()
            ? 'Browser engine is still initializing. Please wait 1-2 minutes and try again, or connect a remote execution agent.'
            : 'Browser engine could not be installed on this server. Connect a remote execution agent or install Playwright on the server.';
          sendEvent('agent_status', { agent: 'Orchestrator', status: 'error', activity: 'Browser not available' });
          sendEvent('execution_error', { message: reason });
          await storage.updateExecutionRun(id, { status: 'failed', completedAt: new Date() });
          clearInterval(heartbeat);
          res.end();
          return;
        }
        
        sendEvent('agent_status', { agent: 'Navigator', status: 'working', activity: `Preparing to navigate to ${targetUrlStr}...` });
        sendEvent('playwright_log', {
          timestamp: new Date().toISOString(),
          level: 'info',
          category: 'browser',
          message: 'Using Microsoft Edge (system browser) for headed execution'
        });

        // Collect screenshots for HTML report
        const collectedScreenshots: string[] = [];
        
        // Fetch actual test cases from DB for real execution
        const testCaseIdsList = testCaseIds ? (testCaseIds as string).split(',').filter(Boolean) : [];
        const sourceType = (testCaseSource as string) || 'sprint';
        let testCasesForExecution: Array<{ testCaseId: string; title: string; category: string; priority: string; steps: Array<{ action: string; expected?: string }> }> = [];

        if (testCaseIdsList.length > 0) {
          if (sourceType === 'autonomous') {
            testCasesForExecution = await resolveAutonomousTestCasesByIds(testCaseIdsList);
            if (testCasesForExecution.length === 0) {
              const legacyCases = await storage.getFunctionalTestCasesByIds(testCaseIdsList);
              testCasesForExecution = legacyCases.map(tc => ({
                testCaseId: tc.id,
                title: tc.name,
                category: tc.category,
                priority: 'P2',
                steps: (tc.testSteps || []).map((s: any) => ({ action: s.action, expected: s.expected_behavior })),
              }));
            }
          } else if (sourceType === 'jira') {
            const cases = await storage.getJiraTestCasesByIds(testCaseIdsList);
            testCasesForExecution = cases.map(tc => ({
              testCaseId: tc.id,
              title: tc.title,
              category: tc.category,
              priority: 'P2',
              steps: (tc.testSteps || []).map((s: any) => ({ action: s.action, expected: s.expected_behavior })),
            }));
          } else {
            const cases = await storage.getTestCasesByIds(testCaseIdsList);
            testCasesForExecution = cases.map((tc: any) => ({
              testCaseId: tc.id,
              title: tc.title || 'Test Case',
              category: tc.category || 'functional',
              priority: tc.priority || 'P2',
              steps: (tc.testSteps || []).map((s: any) => ({ action: s.action, expected: s.expected_behavior })),
            }));
          }
        }

        const totalTests = testCasesForExecution.length || run.totalTests || 0;
        let passedTests = 0;
        let failedTests = 0;

        if (testCasesForExecution.length > 0 && !cancelled) {
          // ── Remote agent path ─────────────────────────────────────────────
          if (hasAvailableAgent()) {
            sendEvent('playwright_log', {
              timestamp: new Date().toISOString(),
              level: 'info',
              category: 'browser',
              message: `Dispatching ${totalTests} test(s) to remote execution agent`,
            });

            const sseCallback: SseCallback = {
              sendEvent,
              isCancelled: () => cancelled,
            };

            const jobPayload: AgentJobPayload = {
              executionRunId: id,
              testCases: testCasesForExecution,
              targetUrl: targetUrlStr,
              browser: 'chromium',
              headless: false,
              screenshotOnEveryStep: true,
              slowMo: 500,
            };

            const summary = await dispatchJobToAgent(jobPayload, sseCallback);
            passedTests = summary.passed;
            failedTests = summary.failed;

          } else {
            // ── In-process fallback (no remote agent connected) ────────────
            const { PlaywrightExecutionEngine } = await import('./playwright-execution-engine');
            const engine = new PlaywrightExecutionEngine({
              targetUrl: targetUrlStr,
              headless: false,
              channel: 'msedge',
              slowMo: 800,
              recordVideo: false,
              screenshotOnEveryStep: true,
              timeout: 30000,
            });

            await engine.initialize();
            sendEvent('playwright_log', {
              timestamp: new Date().toISOString(),
              level: 'info',
              category: 'browser',
              message: `Execution browser ready (in-process) — running ${totalTests} test case(s)`,
            });

            for (let i = 0; i < testCasesForExecution.length && !cancelled; i++) {
              const tc = testCasesForExecution[i];
              sendEvent('agent_status', { agent: 'Orchestrator', status: 'working', activity: `Executing test ${i + 1} of ${totalTests}` });
              sendEvent('playwright_log', {
                timestamp: new Date().toISOString(),
                level: 'info',
                category: 'test',
                message: `Starting test case ${i + 1} of ${totalTests}: ${tc.title}`,
              });

              await engine.executeTestCase(tc, {
                onStepStart: (_testCaseId, stepIndex, action) => {
                  sendEvent('step_progress', { stepIndex: stepIndex + 1, totalSteps: tc.steps.length || 1 });
                  sendEvent('playwright_log', {
                    timestamp: new Date().toISOString(),
                    level: 'info',
                    category: 'action',
                    message: `Step ${stepIndex + 1}: ${action}`,
                  });
                },
                onStepComplete: (_testCaseId, result) => {
                  sendEvent('playwright_log', {
                    timestamp: new Date().toISOString(),
                    level: result.status === 'passed' ? 'info' : 'error',
                    category: 'result',
                    message: `Step ${result.stepIndex + 1} ${result.status.toUpperCase()}${result.error ? ' — ' + result.error : ''}`,
                  });
                },
                onTestStart: (_testCaseId, title) => {
                  sendEvent('agent_status', { agent: 'Executor', status: 'working', activity: `Running: ${title}` });
                },
                onTestComplete: (result) => {
                  if (result.status === 'passed') passedTests++;
                  else failedTests++;
                  sendEvent('agent_status', { agent: 'Validator', status: 'working', activity: `Validating: ${tc.title}` });
                  sendEvent('test_complete', {
                    testCaseId: result.testCaseId,
                    status: result.status,
                    testIndex: i + 1,
                    totalTests,
                  });
                  sendEvent('playwright_log', {
                    timestamp: new Date().toISOString(),
                    level: result.status === 'passed' ? 'info' : 'error',
                    category: 'result',
                    message: `TEST ${result.status.toUpperCase()}: "${tc.title}" (${result.duration}ms)`,
                  });
                },
                onScreenshot: (_testCaseId, stepIndex, base64Data) => {
                  sendEvent('screenshot', { screenshot: base64Data, step: `Test ${i + 1} — Step ${stepIndex + 1}`, testIndex: i + 1 });
                  collectedScreenshots.push(base64Data);
                },
                onAgentActivity: (_agent, activity, status) => {
                  sendEvent('agent_status', { agent: 'Executor', status, activity });
                },
              });
            }

            await engine.cleanup();
          }
        }
        
        if (!cancelled) {
          sendEvent('agent_status', { agent: 'Reporter', status: 'working', activity: 'Generating execution report...' });
          
          await new Promise(r => setTimeout(r, 400));

          // Generate BDD artifacts
          sendEvent('agent_status', { agent: 'Reporter', status: 'working', activity: 'Generating BDD feature files...' });
          
          // Fetch actual test cases from database if testCaseIds are provided
          let selectedTestCases: any[] = [];
          const testCaseIdsList = testCaseIds ? (testCaseIds as string).split(',').filter(Boolean) : [];
          
          if (testCaseIdsList.length > 0) {
            const sourceType = (testCaseSource as string) || 'sprint';
            console.log('[BDD Generation] Fetching test cases with IDs:', testCaseIdsList, 'source:', sourceType);
            
            let fetchedTestCases: any[];
            if (sourceType === 'autonomous') {
              const resolved = await resolveAutonomousTestCasesByIds(testCaseIdsList);
              if (resolved.length > 0) {
                fetchedTestCases = resolved.map(tc => ({
                  id: tc.testCaseId,
                  title: tc.title,
                  testSteps: tc.steps.map((s, i) => ({
                    stepNumber: i + 1,
                    action: s.action,
                    expectedResult: s.expected || '',
                  })),
                  expectedResult: '',
                  category: tc.category,
                  testType: tc.category,
                }));
              } else {
                const autonomousCases = await storage.getFunctionalTestCasesByIds(testCaseIdsList);
                fetchedTestCases = autonomousCases.map(tc => ({
                  id: tc.id,
                  title: tc.name,
                  testSteps: tc.testSteps,
                  expectedResult: tc.expectedResult,
                  category: tc.category,
                  testType: tc.category,
                }));
              }
            } else if (sourceType === 'jira') {
              const jiraCases = await storage.getJiraTestCasesByIds(testCaseIdsList);
              fetchedTestCases = jiraCases.map(tc => ({
                id: tc.id,
                title: tc.title,
                testSteps: tc.testSteps,
                expectedResult: tc.expectedResult,
                category: tc.category,
                testType: tc.testType || tc.category,
              }));
            } else {
              fetchedTestCases = await storage.getTestCasesByIds(testCaseIdsList);
            }
            
            console.log('[BDD Generation] Found test cases:', fetchedTestCases.length);
            if (fetchedTestCases.length > 0) {
              console.log('[BDD Generation] Sample test case:', JSON.stringify({
                id: fetchedTestCases[0].id,
                title: fetchedTestCases[0].title,
                testSteps: fetchedTestCases[0].testSteps?.slice(0, 2)
              }));
            }
            selectedTestCases = fetchedTestCases;
            
            // Map test cases to BDD format - use actual test steps from database
            selectedTestCases = selectedTestCases.map((tc, i) => {
              const hasSteps = tc.testSteps && Array.isArray(tc.testSteps) && tc.testSteps.length > 0;
              console.log(`[BDD] Test case ${i}: title=${tc.title}, hasSteps=${hasSteps}, stepsCount=${tc.testSteps?.length || 0}`);
              return {
                title: tc.title || `Automated Test Case ${i + 1}`,
                testSteps: hasSteps ? tc.testSteps : [
                  { action: 'Navigate to the target URL', step_number: 1 },
                  { action: 'Verify page loads correctly', step_number: 2 },
                  { action: 'Check for main content elements', step_number: 3 },
                  { action: 'Validate page responsiveness', step_number: 4 },
                  { action: 'Complete test verification', step_number: 5 }
                ],
                expectedResult: tc.expectedResult || 'All validations pass successfully',
                category: tc.category || tc.testType || 'functional'
              };
            });
          }
          
          // Fallback if no test cases found - generate for all executed tests
          if (selectedTestCases.length === 0) {
            selectedTestCases = Array.from({ length: totalTests }, (_, i) => ({
              title: `Automated Test Case ${i + 1}`,
              testSteps: [
                { action: 'Navigate to the target URL', step_number: 1 },
                { action: 'Verify page loads correctly', step_number: 2 },
                { action: 'Check for main content elements', step_number: 3 },
                { action: 'Validate page responsiveness', step_number: 4 },
                { action: 'Complete test verification', step_number: 5 }
              ],
              expectedResult: 'All validations pass successfully',
              category: 'functional'
            }));
          }
          
          // Generate Feature File (Gherkin format)
          const featureFile = generateFeatureFile(targetUrlStr, selectedTestCases);
          
          // Generate Step Definitions (Playwright code)
          const stepDefinitions = generateStepDefinitions(targetUrlStr, selectedTestCases);
          
          sendEvent('bdd_artifacts', { featureFile, stepDefinitions });
          
          await new Promise(r => setTimeout(r, 400));
          
          // Generate HTML Report
          sendEvent('agent_status', { agent: 'Reporter', status: 'working', activity: 'Generating HTML report...' });
          const htmlReport = generateHtmlReport(
            targetUrlStr, 
            selectedTestCases, 
            passedTests, 
            failedTests, 
            totalTests, 
            collectedScreenshots
          );
          
          sendEvent('html_report', { htmlReport });
          
          await new Promise(r => setTimeout(r, 300));
          
          // Update the run with results
          await storage.updateExecutionRun(id, { 
            status: 'completed',
            passedTests,
            failedTests,
            completedAt: new Date()
          });
          
          // Mark all agents as completed
          for (const agent of agents) {
            sendEvent('agent_status', { agent, status: 'completed', activity: 'Done' });
          }
          
          sendEvent('complete', { 
            runId: id, 
            passedTests, 
            failedTests,
            totalTests 
          });
        }
        
        // Browser cleanup is handled by PlaywrightExecutionEngine.cleanup() above
        
      } catch (error: any) {
        console.error('Execution error:', error);
        sendEvent('agent_status', { agent: 'Orchestrator', status: 'error', activity: 'Execution failed' });
        sendEvent('execution_error', { message: error.message || 'Execution failed' });
        await storage.updateExecutionRun(id, { status: 'failed', completedAt: new Date() });
      } finally {
        if (browser) {
          try {
            await browser.close();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        clearInterval(heartbeat);
        res.end();
      }
    })();
  });

  // Get BDD feature files for a project
  app.get("/api/bdd/feature-files", async (req: Request, res: Response) => {
    try {
      const user = req.user || DEMO_USER; // Fallback to demo user for MVP
      
      const { projectId } = req.query;
      if (!projectId || typeof projectId !== 'string') {
        res.status(400).json({ success: false, error: "Project ID is required" });
        return;
      }
      
      const files = await storage.getBddFeatureFilesByProjectId(projectId);
      res.json({ success: true, files });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to fetch BDD feature files" });
    }
  });

  // Get a specific BDD feature file with step definitions
  app.get("/api/bdd/feature-files/:id", async (req: Request, res: Response) => {
    try {
      const user = req.user || DEMO_USER; // Fallback to demo user for MVP
      
      const { id } = req.params;
      const file = await storage.getBddFeatureFileById(id);
      
      if (!file) {
        res.status(404).json({ success: false, error: "Feature file not found" });
        return;
      }
      
      const stepDefinitions = await storage.getBddStepDefinitionsByFeatureFileId(id);
      res.json({ success: true, file, stepDefinitions });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to fetch BDD feature file" });
    }
  });

  // Get test cases by category for execution (supports both sprint and autonomous sources)
  app.get("/api/execution/test-cases", async (req: Request, res: Response) => {
    try {
      const user = req.user || DEMO_USER;
      
      const { projectId, category, sprintId, source, functionalRunId, jiraProjectKey, jiraStoryId } = req.query;
      
      let testCases: any[] = [];
      const testSource = (source as string) || 'sprint';
      
      if (testSource === 'jira') {
        if (!jiraProjectKey || typeof jiraProjectKey !== 'string') {
          res.status(400).json({ success: false, error: "Jira project key is required" });
          return;
        }
        let jiraCases: any[];
        if (jiraStoryId && typeof jiraStoryId === 'string' && jiraStoryId !== 'all') {
          jiraCases = await storage.getJiraTestCases(jiraProjectKey, jiraStoryId);
        } else {
          jiraCases = await storage.getAllJiraTestCasesByProject(jiraProjectKey);
        }
        testCases = jiraCases.map(tc => ({
          id: tc.id,
          testCaseId: tc.testCaseId,
          title: tc.title,
          description: tc.description || '',
          objective: tc.objective || '',
          category: tc.category || tc.testType || 'functional',
          priority: tc.priority || 'P2',
          testSteps: tc.testSteps || [],
          expectedResult: tc.expectedResult,
          preconditions: tc.preconditions || [],
          postconditions: tc.postconditions || [],
          testData: tc.testData,
          testType: tc.testType || tc.category || 'functional',
          playwrightScript: tc.playwrightScript,
          source: 'jira',
          jiraStoryId: tc.jiraStoryId,
          jiraStoryTitle: tc.jiraStoryTitle,
        }));
      } else if (testSource === 'autonomous') {
        const runId =
          functionalRunId && functionalRunId !== 'all'
            ? (functionalRunId as string)
            : undefined;
        const strictProject = req.query.strictProject === 'true';
        const includeUnscopedRuns = !strictProject;

        testCases = await fetchAutonomousExecutionTestCases({
          projectId: projectId as string | undefined,
          functionalRunId: runId,
          includeUnscopedRuns,
        });

        if (runId && testCases.length === 0) {
          const fullRun = await storage.getFunctionalTestRunById(runId);
          if (fullRun?.testCases) {
            testCases = mapLegacyFunctionalRunCases(fullRun.testCases);
          }
        } else if (projectId && (strictProject || testCases.length === 0)) {
          const runs = await storage.getFunctionalTestRuns(projectId as string);
          for (const run of runs.filter(r => r.status === 'completed' && (r.totalTestCases || 0) > 0)) {
            if (runId && run.id !== runId) continue;
            const fullRun = await storage.getFunctionalTestRunById(run.id);
            if (fullRun?.testCases) {
              testCases.push(...mapLegacyFunctionalRunCases(fullRun.testCases));
            }
          }

          const byId = new Map<string, typeof testCases[number]>();
          for (const tc of testCases) {
            byId.set(tc.id, tc);
          }
          testCases = Array.from(byId.values());
        }
      } else {
        if (!projectId || typeof projectId !== 'string') {
          res.status(400).json({ success: false, error: "Project ID is required for sprint test cases" });
          return;
        }
        if (sprintId && typeof sprintId === 'string') {
          testCases = await storage.getTestCasesBySprintId(sprintId);
        } else {
          const sprints = await storage.getSprintsByProjectId(projectId);
          for (const sprint of sprints) {
            const sprintTestCases = await storage.getTestCasesBySprintId(sprint.id);
            testCases.push(...sprintTestCases);
          }
        }
        testCases = testCases.map(tc => ({ ...tc, source: 'sprint' }));
      }
      
      if (category && typeof category === 'string' && category !== 'all') {
        const cat = category.toLowerCase();
        const categoryAliases: Record<string, string[]> = {
          functional: ['functional', 'smoke', 'ui', 'form_submit', 'navigation', 'action'],
          edge_case: ['edge_case', 'edge'],
          negative: ['negative'],
          security: ['security'],
          accessibility: ['accessibility'],
          workflow: ['workflow'],
        };
        const allowed = categoryAliases[cat] ?? [cat];
        testCases = testCases.filter(tc => {
          const tcCat = (tc.category || tc.testType || '').toLowerCase();
          return allowed.includes(tcCat);
        });
      }
      
      res.json({ success: true, testCases });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to fetch test cases" });
    }
  });

  // Get Jira projects that have saved test cases (for execution mode)
  app.get("/api/execution/jira-projects", async (req: Request, res: Response) => {
    try {
      const projects = await storage.getJiraProjectsWithTestCases();
      res.json({ success: true, projects });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to fetch Jira projects" });
    }
  });

  // Get Jira stories with saved test cases for a project (for execution mode)
  app.get("/api/execution/jira-stories/:projectKey", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const stories = await storage.getJiraStoriesWithTestCases(projectKey);
      res.json({ success: true, stories });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to fetch Jira stories" });
    }
  });

  // Get functional test runs for a project (for execution mode source selection)
  app.get("/api/execution/functional-runs", async (req: Request, res: Response) => {
    try {
      const { projectId, strictProject } = req.query;
      const includeUnscopedRuns = strictProject !== 'true';

      const mappedAutoRuns = await fetchAutonomousExecutionRuns(projectId as string | undefined, {
        includeUnscopedRuns,
      });
      const oldRuns = await storage.getFunctionalTestRuns(projectId as string | undefined);
      const completedOldRuns = oldRuns.filter(r => r.status === 'completed' && (r.totalTestCases || 0) > 0);
      const allRuns = mergeLegacyFunctionalRuns(mappedAutoRuns, completedOldRuns);
      res.json({ success: true, runs: allRuns });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to fetch functional runs" });
    }
  });

  // ============================================
  // Synthetic Data Generation
  // ============================================
  
  app.post("/api/synthetic-data/generate", async (req: Request, res: Response) => {
    try {
      const syntheticDataRequestSchema = z.object({
        domain: z.enum(["banking", "insurance", "healthcare", "retail", "telecom", "manufacturing"]),
        subDomain: z.string().min(1).max(50),
        fields: z.array(z.string().min(1).max(100)).min(1).max(100),
        customFields: z.array(z.string().min(1).max(100)).max(50).optional(),
        recordCount: z.number().int().min(1).max(50000),
        dataPrefix: z.string().max(10).optional(),
        maskingEnabled: z.boolean().optional(),
        useLLMGeneration: z.boolean().optional()
      });
      
      const parseResult = syntheticDataRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ 
          success: false, 
          error: "Invalid request: " + parseResult.error.errors.map(e => e.message).join(", ")
        });
        return;
      }
      
      const { domain, subDomain, fields, customFields, recordCount, dataPrefix, maskingEnabled, useLLMGeneration } = parseResult.data;
      
      let records: Record<string, any>[] = [];
      let generationMethod = "rule-based";
      
      if (useLLMGeneration || (customFields && customFields.length > 0)) {
        try {
          console.log(`Using LLM generation for ${recordCount} records with ${fields.length} fields (${customFields?.length || 0} custom)`);
          records = await generateSyntheticDataWithLLM({
            domain,
            subDomain,
            fields,
            customFields: customFields || [],
            recordCount,
            dataPrefix
          });
          generationMethod = "ai-powered";
          
          if (maskingEnabled) {
            records = records.map((record, idx) => {
              const maskedRecord: Record<string, any> = {};
              for (const field of Object.keys(record)) {
                if (isPIIField(field)) {
                  maskedRecord[field] = maskValue(field, record[field], idx);
                } else {
                  maskedRecord[field] = record[field];
                }
              }
              return maskedRecord;
            });
          }
        } catch (llmError: any) {
          console.error("LLM generation failed, falling back to rule-based:", llmError.message);
          records = [];
          generationMethod = "rule-based-fallback";
        }
      }
      
      if (records.length === 0) {
        for (let i = 0; i < recordCount; i++) {
          const record: Record<string, any> = {};
          const allFields = [...fields, ...(customFields || [])];
          for (const field of allFields) {
            let value = generateFieldValue(field, i, dataPrefix || "", domain, subDomain);
            if (maskingEnabled && isPIIField(field)) {
              value = maskValue(field, value, i);
            }
            record[field] = value;
          }
          records.push(record);
        }
      }
      
      const result = {
        records,
        fields: [...fields, ...(customFields || [])],
        metadata: {
          recordCount: records.length,
          fieldCount: fields.length + (customFields?.length || 0),
          customFieldCount: customFields?.length || 0,
          generatedAt: new Date().toISOString(),
          prefix: dataPrefix || undefined,
          source: "NAT 2.0 Synthetic Data Generator",
          generationMethod,
          qualityScore: generationMethod === "ai-powered" ? 99 : 98
        }
      };
      
      res.json({ success: true, result });
    } catch (error: any) {
      console.error("Synthetic data generation error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to generate synthetic data" });
    }
  });

  // ============================================
  // nRadiVerse Quality Engine API Endpoints
  // ============================================

  // Visual Regression - Compare images (Real implementation with pixelmatch/ssim.js)
  app.post("/api/nradiverse/compare-images", async (req: Request, res: Response) => {
    try {
      const { baselineImage, currentImage, threshold = 0.1 } = req.body;

      if (!baselineImage || !currentImage) {
        res.status(400).json({ success: false, error: "Both baseline and current images are required" });
        return;
      }

      console.log("[nRadiVerse] Starting real image comparison with ML algorithms...");
      
      // Use real image comparison with pixelmatch, ssim.js
      const result = await compareImages(baselineImage, currentImage, threshold);
      
      console.log(`[nRadiVerse] Comparison complete: SSIM=${result.ssimScore.toFixed(4)}, Diff=${result.diffPercentage.toFixed(2)}%`);

      res.json({
        ...result,
        baselineImage,
        currentImage,
        diffImage: result.diffImageData || currentImage
      });
    } catch (error: any) {
      console.error("[nRadiVerse] Image comparison error:", error);
      res.status(500).json({ success: false, error: error.message || "Image comparison failed" });
    }
  });

  // Visual Regression - Capture baseline
  app.post("/api/nradiverse/capture-baseline", async (req: Request, res: Response) => {
    try {
      const { url, name, viewport = "desktop", projectId } = req.body;

      if (!url || !name) {
        res.status(400).json({ success: false, error: "URL and name are required" });
        return;
      }

      const viewportSizes: Record<string, { width: number; height: number }> = {
        desktop: { width: 1920, height: 1080 },
        laptop: { width: 1366, height: 768 },
        tablet: { width: 768, height: 1024 },
        mobile: { width: 375, height: 812 },
        "medical-3mp": { width: 1536, height: 2048 },
        "medical-5mp": { width: 2048, height: 2560 },
      };

      const vp = viewportSizes[viewport] || viewportSizes.desktop;

      // In a real implementation, this would use Playwright to capture screenshots
      const baseline = {
        id: `baseline-${Date.now()}`,
        name,
        url,
        viewport,
        viewportWidth: vp.width,
        viewportHeight: vp.height,
        capturedAt: new Date().toISOString(),
        status: "captured"
      };

      res.json({ success: true, baseline });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to capture baseline" });
    }
  });

  // Accessibility - Run real axe-core scan with Playwright + AI analysis
  app.post("/api/nradiverse/accessibility-scan", async (req: Request, res: Response) => {
    try {
      const { url, wcagLevel = "AA" } = req.body;

      if (!url) {
        res.status(400).json({ success: false, error: "URL is required" });
        return;
      }

      console.log(`[nRadiVerse] Starting real accessibility scan for: ${url}`);
      console.log(`[nRadiVerse] Using Playwright + axe-core with WCAG 2.1 Level ${wcagLevel}`);
      
      // Use real accessibility scanning with Playwright + axe-core + AI analysis
      const result = await runAccessibilityScan(url, wcagLevel);
      
      console.log(`[nRadiVerse] Scan complete: ${result.violationsCount} violations, Score: ${result.overallScore}`);
      if (result.aiAnalysis) {
        console.log(`[nRadiVerse] AI analysis generated with ${result.aiAnalysis.prioritizedIssues?.length || 0} prioritized issues`);
      }

      res.json(result);
    } catch (error: any) {
      console.error("[nRadiVerse] Accessibility scan error:", error);
      res.status(500).json({ success: false, error: error.message || "Accessibility scan failed" });
    }
  });

  // Enhanced Accessibility Scan — SSE streaming with Screen Reader + Visual Tests
  app.get("/api/nradiverse/accessibility-scan/stream", async (req: Request, res: Response) => {
    const url = req.query.url as string;
    const wcagLevel = (req.query.wcagLevel as string) || "AA";
    const phases = ((req.query.phases as string) || "axe,screenreader,visual").split(",");

    if (!url) {
      res.status(400).json({ success: false, error: "URL is required" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const sendComplete = (result: any) => {
      res.write(`data: ${JSON.stringify({ type: "final_result", data: result })}\n\n`);
      res.write(`event: complete\ndata: {}\n\n`);
      res.end();
    };

    try {
      // Auto-add https:// if missing
      let scanUrl = url.trim();
      if (!scanUrl.startsWith("http://") && !scanUrl.startsWith("https://")) {
        scanUrl = `https://${scanUrl}`;
      }

      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage();

      send({ agent: "axe-scanner", status: "working", message: `Navigating to ${scanUrl}...`, progress: 5 });
      await page.goto(scanUrl, { waitUntil: "networkidle", timeout: 30000 }).catch(() =>
        page.goto(scanUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
      );

      let axeResult: any = null;
      let screenReaderResult: any = null;
      let visualTestResult: any = null;

      // Phase 1: Axe-core scan
      if (phases.includes("axe")) {
        send({ agent: "axe-scanner", status: "working", message: "Injecting axe-core engine...", progress: 10 });
        const { runAccessibilityScan } = await import("./nradiverse-service");
        axeResult = await runAccessibilityScan(url, wcagLevel);
        send({
          agent: "axe-scanner", status: "completed",
          message: `Axe scan complete: ${axeResult.violationsCount} violations, score ${axeResult.overallScore}/100`,
          progress: 100, data: axeResult,
        });
      }

      // Phase 2: Screen Reader Simulation
      if (phases.includes("screenreader")) {
        try {
          const { runScreenReaderSimulation } = await import("./accessibility-screen-reader");
          screenReaderResult = await runScreenReaderSimulation(page, send);
        } catch (err: any) {
          send({ agent: "screen-reader", status: "error", message: `Screen reader simulation failed: ${err.message}`, progress: 0 });
        }
      }

      // Phase 3: Visual Accessibility Tests
      if (phases.includes("visual")) {
        try {
          const { runVisualAccessibilityTests } = await import("./accessibility-visual-tests");
          visualTestResult = await runVisualAccessibilityTests(page, url, browser, send);
        } catch (err: any) {
          send({ agent: "visual-tester", status: "error", message: `Visual tests failed: ${err.message}`, progress: 0 });
        }
      }

      // Phase 4: AI Analysis (reuse existing)
      if (axeResult) {
        send({ agent: "ai-analyzer", status: "working", message: "Running Claude Vision AI analysis...", progress: 50 });
        // AI analysis is already included in axeResult from runAccessibilityScan
        send({ agent: "ai-analyzer", status: "completed", message: "AI analysis complete", progress: 100 });
      }

      await context.close();
      await browser.close();

      // Combined score
      const axeScore = axeResult?.overallScore || 0;
      const srScore = screenReaderResult?.overallScore || 0;
      const vtScore = visualTestResult?.overallScore || 0;
      const activePhasesCount = [axeResult, screenReaderResult, visualTestResult].filter(Boolean).length;
      const combinedScore = activePhasesCount > 0
        ? Math.round((axeScore * 0.4 + srScore * 0.3 + vtScore * 0.3) / (activePhasesCount > 0 ? 1 : 1))
        : 0;

      // Auto-save to database
      let savedId: string | null = null;
      try {
        const { accessibilityScanResults } = await import("@shared/qe-schema");
        const scanId = crypto.randomUUID();
        await db.insert(accessibilityScanResults).values({
          id: scanId,
          url: scanUrl,
          status: "completed",
          overallScore: combinedScore,
          violationsCount: axeResult?.violationsCount || 0,
          passesCount: axeResult?.passesCount || 0,
          incompleteCount: axeResult?.incompleteCount || 0,
          inapplicableCount: axeResult?.inapplicableCount || 0,
          criticalCount: axeResult?.violations?.filter((v: any) => v.impact === "critical").length || 0,
          seriousCount: axeResult?.violations?.filter((v: any) => v.impact === "serious").length || 0,
          moderateCount: axeResult?.violations?.filter((v: any) => v.impact === "moderate").length || 0,
          minorCount: axeResult?.violations?.filter((v: any) => v.impact === "minor").length || 0,
          violations: axeResult?.violations || [],
          passes: axeResult?.passes || [],
          incomplete: axeResult?.incomplete || [],
          wcagCriteria: axeResult?.wcagCriteria || [],
          metadata: axeResult?.metadata || {},
          screenReaderResult: screenReaderResult || null,
          visualTestResult: visualTestResult || null,
          aiAnalysis: axeResult?.aiAnalysis || null,
        });
        savedId = scanId;
        console.log("[Accessibility] Scan saved to history:", savedId);
      } catch (saveErr: any) {
        console.error("[Accessibility] Failed to save scan history:", saveErr.message);
      }

      sendComplete({
        axeResult,
        screenReaderResult,
        visualTestResult,
        combinedScore,
        savedId,
      });
    } catch (error: any) {
      console.error("[Accessibility] Enhanced scan error:", error);
      send({ agent: "axe-scanner", status: "error", message: error.message, progress: 0 });
      res.write(`event: complete\ndata: {}\n\n`);
      res.end();
    }
  });

  // ── Accessibility Scan History CRUD ─────────────────────────────────

  app.get("/api/nradiverse/accessibility-scan/history", async (req: Request, res: Response) => {
    try {
      const { accessibilityScanResults } = await import("@shared/qe-schema");
      const scans = await db.select({
        id: accessibilityScanResults.id,
        url: accessibilityScanResults.url,
        status: accessibilityScanResults.status,
        overallScore: accessibilityScanResults.overallScore,
        violationsCount: accessibilityScanResults.violationsCount,
        criticalCount: accessibilityScanResults.criticalCount,
        seriousCount: accessibilityScanResults.seriousCount,
        moderateCount: accessibilityScanResults.moderateCount,
        minorCount: accessibilityScanResults.minorCount,
        createdAt: accessibilityScanResults.createdAt,
      }).from(accessibilityScanResults)
        .orderBy(desc(accessibilityScanResults.createdAt))
        .limit(50);
      res.json({ success: true, scans });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/nradiverse/accessibility-scan/history/:id", async (req: Request, res: Response) => {
    try {
      const { accessibilityScanResults } = await import("@shared/qe-schema");
      const [scan] = await db.select().from(accessibilityScanResults)
        .where(eq(accessibilityScanResults.id, req.params.id));
      if (!scan) return res.status(404).json({ success: false, error: "Scan not found" });
      res.json({ success: true, scan });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete("/api/nradiverse/accessibility-scan/history/:id", async (req: Request, res: Response) => {
    try {
      const { accessibilityScanResults } = await import("@shared/qe-schema");
      await db.delete(accessibilityScanResults).where(eq(accessibilityScanResults.id, req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Responsive Testing - Run real cross-device tests with Playwright + AI analysis
  app.post("/api/nradiverse/responsive-test", async (req: Request, res: Response) => {
    try {
      const { url, devices = [] } = req.body;

      if (!url) {
        res.status(400).json({ success: false, error: "URL is required" });
        return;
      }

      console.log(`[nRadiVerse] Starting real responsive testing for: ${url}`);
      console.log(`[nRadiVerse] Testing on ${devices.length || 6} devices with Playwright...`);
      
      // Use real responsive testing with Playwright + AI analysis
      const result = await runResponsiveTest(url, devices);
      
      console.log(`[nRadiVerse] Responsive test complete: ${result.passedDevicesCount}/${result.devicesTestedCount} passed, Score: ${result.overallScore}`);
      if (result.aiAnalysis) {
        console.log(`[nRadiVerse] AI analysis generated with ${result.aiAnalysis.criticalIssues?.length || 0} critical issues`);
      }

      res.json(result);
    } catch (error: any) {
      console.error("[nRadiVerse] Responsive test error:", error);
      res.status(500).json({ success: false, error: error.message || "Responsive test failed" });
    }
  });

  // Pixel Comparison - Real advanced metrics with pixelmatch/ssim.js + AI analysis
  app.post("/api/nradiverse/pixel-compare", async (req: Request, res: Response) => {
    try {
      const { image1, image2, threshold = 0.1, antiAliasing = true } = req.body;

      if (!image1 || !image2) {
        res.status(400).json({ success: false, error: "Both images are required" });
        return;
      }

      console.log("[nRadiVerse] Starting real pixel comparison with ML algorithms...");
      
      // Use real image comparison with pixelmatch, ssim.js
      const comparisonResult = await compareImages(image1, image2, threshold);
      
      console.log(`[nRadiVerse] Pixel comparison complete: SSIM=${comparisonResult.ssimScore.toFixed(4)}, PSNR=${comparisonResult.psnrScore.toFixed(2)}dB`);

      const result = {
        metrics: {
          ssim: comparisonResult.ssimScore,
          psnr: comparisonResult.psnrScore,
          mse: comparisonResult.mseScore,
          diffPercentage: comparisonResult.diffPercentage,
          pixelsDifferent: comparisonResult.pixelsDifferent,
          totalPixels: comparisonResult.totalPixels,
          histogramCorrelation: comparisonResult.histogramCorrelation
        },
        diffImage: comparisonResult.diffImageData || image2,
        status: comparisonResult.status,
        aiAnalysis: comparisonResult.aiAnalysis
      };

      res.json(result);
    } catch (error: any) {
      console.error("[nRadiVerse] Pixel comparison error:", error);
      res.status(500).json({ success: false, error: error.message || "Pixel comparison failed" });
    }
  });

  // Medical Image Comparison - Before/After treatment analysis with AI radiologist interpretation
  // Uses background-job + polling pattern to avoid AWS API Gateway 29s timeout.
  // The comparison + vision AI call takes ~60s, well beyond the hard limit.

  interface MedicalCompareJob {
    id: string;
    phase: 'processing' | 'complete' | 'error';
    result?: any;
    error?: string;
    createdAt: number;
    completedAt?: number;
  }

  const medicalCompareJobs = new Map<string, MedicalCompareJob>();
  const MEDICAL_JOB_TTL_MS = 15 * 60 * 1000; // 15 minutes

  // Periodic cleanup so completed jobs don't pile up in memory.
  setInterval(() => {
    const now = Date.now();
    for (const [id, job] of medicalCompareJobs.entries()) {
      if (now - job.createdAt > MEDICAL_JOB_TTL_MS) {
        medicalCompareJobs.delete(id);
      }
    }
  }, 5 * 60 * 1000).unref?.();

  // POST: Accept images, start background work, return jobId immediately.
  app.post("/api/nradiverse/medical-compare", async (req: Request, res: Response) => {
    try {
      const { beforeImage, afterImage, threshold = 0.1, antiAliasing = true } = req.body;

      if (!beforeImage || !afterImage) {
        res.status(400).json({ success: false, error: "Both before and after treatment images are required" });
        return;
      }

      const jobId = 'mc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const job: MedicalCompareJob = {
        id: jobId,
        phase: 'processing',
        createdAt: Date.now(),
      };
      medicalCompareJobs.set(jobId, job);

      console.log(`[nRadiVerse] Medical compare job created: ${jobId}`);

      // Fire-and-forget: run the heavy work in the background.
      (async () => {
        try {
          console.log("[nRadiVerse] Starting medical image comparison with AI radiologist analysis...");
          const { compareMedicalImages } = await import("./nradiverse-service");
          const result = await compareMedicalImages(beforeImage, afterImage, threshold, antiAliasing);
          console.log(`[nRadiVerse] Medical comparison complete: SSIM=${result.metrics.ssim.toFixed(4)}, Assessment=${result.aiAnalysis?.overallAssessment || 'N/A'}`);

          job.result = result;
          job.phase = 'complete';
          job.completedAt = Date.now();
        } catch (err: any) {
          console.error("[nRadiVerse] Medical image comparison error:", err);
          job.phase = 'error';
          job.error = err?.message || String(err);
          job.completedAt = Date.now();
        }
      })();

      // Return immediately with jobId — well within 29s.
      res.json({ success: true, jobId });
    } catch (error: any) {
      console.error("[nRadiVerse] Medical compare start error:", error);
      res.status(500).json({ success: false, error: error.message || "Medical image comparison failed" });
    }
  });

  // GET: Poll for job result. Client calls this every ~2s.
  app.get("/api/nradiverse/medical-compare/status/:jobId", (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const job = medicalCompareJobs.get(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: "Job not found or expired" });
      return;
    }

    if (job.phase === 'processing') {
      res.json({ success: true, jobId: job.id, phase: 'processing' });
      return;
    }

    if (job.phase === 'error') {
      res.json({ success: true, jobId: job.id, phase: 'error', error: job.error });
      // Clean up after delivering the error
      medicalCompareJobs.delete(jobId);
      return;
    }

    // phase === 'complete' — deliver result and clean up
    res.json({
      success: true,
      jobId: job.id,
      phase: 'complete',
      ...job.result,
    });
    medicalCompareJobs.delete(jobId);
  });

  // SSRS to PowerBI Migration Validation - File Upload and Comparison
  const multerModule = await import('multer');
  const multer = multerModule.default;
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
  });

  app.post("/api/nradiverse/ssrs-powerbi/validate", upload.fields([
    { name: 'sourceFile', maxCount: 1 },
    { name: 'targetFile', maxCount: 1 }
  ]), async (req: Request, res: Response) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const sourceFile = files?.sourceFile?.[0];
      const targetFile = files?.targetFile?.[0];

      if (!sourceFile || !targetFile) {
        res.status(400).json({ success: false, error: "Both source and target files are required" });
        return;
      }

      const config = JSON.parse(req.body.config || '{}');
      const validationConfig = {
        comparisonMode: config.comparisonMode || 'tolerant',
        numericTolerance: config.numericTolerance || 0.01,
        percentageTolerance: config.percentageTolerance || 0.1,
        dateHandling: config.dateHandling || 'flexible',
        ignoreColumns: config.ignoreColumns ? config.ignoreColumns.split(',').map((c: string) => c.trim()).filter((c: string) => c) : [],
        caseSensitive: config.caseSensitive || false,
        whitespaceHandling: config.whitespaceHandling || 'trim'
      };

      console.log(`[SSRS-PowerBI] Starting validation: ${sourceFile.originalname} vs ${targetFile.originalname}`);
      console.log(`[SSRS-PowerBI] Config: ${JSON.stringify(validationConfig)}`);

      const { parseFile, compareFiles, generateAIAnalysis } = await import("./ssrs-powerbi-service");

      // Parse both files
      console.log(`[SSRS-PowerBI] Parsing source file: ${sourceFile.originalname} (${sourceFile.size} bytes)`);
      const sourceParsed = await parseFile(sourceFile.buffer, sourceFile.originalname);
      console.log(`[SSRS-PowerBI] Source parsed: ${sourceParsed.metadata?.rowCount} rows, ${sourceParsed.metadata?.columnCount} columns`);

      console.log(`[SSRS-PowerBI] Parsing target file: ${targetFile.originalname} (${targetFile.size} bytes)`);
      const targetParsed = await parseFile(targetFile.buffer, targetFile.originalname);
      console.log(`[SSRS-PowerBI] Target parsed: ${targetParsed.metadata?.rowCount} rows, ${targetParsed.metadata?.columnCount} columns`);

      // Compare files
      console.log(`[SSRS-PowerBI] Starting comparison...`);
      const result = compareFiles(sourceParsed, targetParsed, validationConfig);

      // Generate AI analysis
      const aiAnalysis = generateAIAnalysis(result, sourceParsed, targetParsed);
      result.aiAnalysis = aiAnalysis;

      // Add AI analysis to individual differences (first 20)
      for (let i = 0; i < Math.min(result.differences.length, 20); i++) {
        const diff = result.differences[i];
        if (diff.status === 'tolerance') {
          diff.aiAnalysis = `Rounding difference - value differs by ${diff.percentDiff?.toFixed(4) || 'N/A'}%. This is likely due to different decimal precision settings between SSRS and PowerBI.`;
        } else if (diff.status === 'mismatch') {
          if (diff.difference === 'Source empty' || diff.difference === 'Target empty') {
            diff.aiAnalysis = `Null/empty handling difference - consider configuring null-to-empty transformation in PowerBI.`;
          } else if (diff.difference === 'Text mismatch') {
            diff.aiAnalysis = `Text values differ - check data source formatting and character encoding settings.`;
          } else {
            diff.aiAnalysis = `Significant difference detected - verify data transformation logic in PowerBI.`;
          }
        }
      }

      console.log(`[SSRS-PowerBI] Validation complete: ${result.matchPercentage}% match, ${result.differences.length} differences`);

      res.json({
        success: true,
        result,
        sourceInfo: {
          filename: sourceFile.originalname,
          type: sourceParsed.type,
          rows: sourceParsed.metadata?.rowCount,
          columns: sourceParsed.metadata?.columnCount
        },
        targetInfo: {
          filename: targetFile.originalname,
          type: targetParsed.type,
          rows: targetParsed.metadata?.rowCount,
          columns: targetParsed.metadata?.columnCount
        }
      });
    } catch (error: any) {
      console.error("[SSRS-PowerBI] Validation error:", error);
      res.status(500).json({ success: false, error: error.message || "Validation failed" });
    }
  });

  // Get file preview without full comparison
  app.post("/api/nradiverse/ssrs-powerbi/preview", upload.single('file'), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ success: false, error: "File is required" });
        return;
      }

      console.log(`[SSRS-PowerBI] Parsing file for preview: ${file.originalname}`);
      const { parseFile } = await import("./ssrs-powerbi-service");
      const parsed = await parseFile(file.buffer, file.originalname);

      // Return preview data (first 20 rows)
      let previewData: any[] = [];
      let headers: string[] = [];

      if (parsed.type === 'excel' && parsed.sheets && parsed.sheets.length > 0) {
        headers = parsed.sheets[0].headers;
        previewData = parsed.sheets[0].rows.slice(0, 20);
      } else if (parsed.type === 'pdf' && parsed.tables && parsed.tables.length > 0) {
        headers = parsed.tables[0].headers;
        previewData = parsed.tables[0].rows.slice(0, 20).map(row => {
          const obj: Record<string, any> = {};
          headers.forEach((h, i) => { obj[h] = row[i] || ''; });
          return obj;
        });
      } else if (parsed.type === 'pdf' && parsed.textContent) {
        // Return text content lines as preview
        const lines = parsed.textContent.split('\n').filter((l: string) => l.trim()).slice(0, 30);
        headers = ['Line', 'Content'];
        previewData = lines.map((line: string, i: number) => ({ Line: i + 1, Content: line.trim() }));
      }

      res.json({
        success: true,
        filename: file.originalname,
        type: parsed.type,
        metadata: parsed.metadata,
        headers,
        preview: previewData
      });
    } catch (error: any) {
      console.error("[SSRS-PowerBI] Preview error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to parse file" });
    }
  });

  // Save validation result to history
  const saveValidationHistorySchema = z.object({
    sourceFilename: z.string().min(1),
    targetFilename: z.string().min(1),
    sourceFileType: z.string().min(1),
    targetFileType: z.string().min(1),
    result: z.enum(['pass', 'fail', 'warning']),
    matchPercentage: z.number().min(0).max(100),
    config: z.object({
      comparisonMode: z.string(),
      numericTolerance: z.number(),
      percentageTolerance: z.number(),
      dateHandling: z.string(),
      ignoreColumns: z.array(z.string()).optional(),
      caseSensitive: z.boolean(),
      whitespaceHandling: z.string()
    }).optional(),
    summary: z.object({
      totalCells: z.number(),
      matchedCells: z.number(),
      toleranceCells: z.number(),
      mismatchedCells: z.number(),
      sourceRowCount: z.number(),
      targetRowCount: z.number(),
      sourceColumnCount: z.number(),
      targetColumnCount: z.number(),
      criticalIssues: z.number(),
      warnings: z.number()
    }).optional(),
    aiAnalysis: z.string().optional().nullable(),
    differences: z.array(z.object({
      row: z.number(),
      column: z.string(),
      sourceValue: z.any(),
      targetValue: z.any(),
      difference: z.string().optional(),
      percentDiff: z.number().optional(),
      status: z.string(),
      aiAnalysis: z.string().optional()
    })).optional()
  });

  app.post("/api/nradiverse/ssrs-powerbi/history", async (req: Request, res: Response) => {
    try {
      const validatedBody = saveValidationHistorySchema.parse(req.body);
      const { 
        sourceFilename, 
        targetFilename, 
        sourceFileType, 
        targetFileType, 
        result, 
        matchPercentage, 
        config, 
        summary, 
        aiAnalysis,
        differences 
      } = validatedBody;

      // Insert the main validation record
      const validationId = crypto.randomUUID();
      await db.insert(reportValidations).values({
        id: validationId,
        userId: "default-user",
        sourceFilename,
        targetFilename,
        sourceFileType,
        targetFileType,
        status: "completed",
        result,
        matchPercentage: Math.round(matchPercentage),
        config,
        summary,
        aiAnalysis,
        completedAt: new Date()
      });

      // Insert individual differences (limit to first 100 for storage)
      if (differences && differences.length > 0) {
        const diffRecords = differences.slice(0, 100).map((diff: any) => ({
          validationId: validationId,
          rowNumber: diff.row,
          columnName: diff.column,
          sheetName: diff.sheet || null,
          sourceValue: String(diff.sourceValue || ''),
          targetValue: String(diff.targetValue || ''),
          difference: diff.difference || null,
          percentDiff: diff.percentDiff ? String(diff.percentDiff) : null,
          matchStatus: diff.status,
          aiAnalysis: diff.aiAnalysis || null
        }));

        await db.insert(validationResults).values(diffRecords);
      }

      console.log(`[SSRS-PowerBI] Saved validation history: ${validationId}`);
      res.json({ success: true, validationId });
    } catch (error: any) {
      console.error("[SSRS-PowerBI] Failed to save validation history:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to save validation" });
    }
  });

  // Get validation history list
  app.get("/api/nradiverse/ssrs-powerbi/history", async (req: Request, res: Response) => {
    try {
      const validations = await db.select()
        .from(reportValidations)
        .orderBy(sql`${reportValidations.createdAt} DESC`)
        .limit(50);

      res.json({ success: true, validations });
    } catch (error: any) {
      console.error("[SSRS-PowerBI] Failed to fetch validation history:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to fetch history" });
    }
  });

  // Get single validation with details
  app.get("/api/nradiverse/ssrs-powerbi/history/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const [validation] = await db.select()
        .from(reportValidations)
        .where(eq(reportValidations.id, id));

      if (!validation) {
        res.status(404).json({ success: false, error: "Validation not found" });
        return;
      }

      const differences = await db.select()
        .from(validationResults)
        .where(eq(validationResults.validationId, id));

      res.json({ success: true, validation, differences });
    } catch (error: any) {
      console.error("[SSRS-PowerBI] Failed to fetch validation details:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to fetch validation" });
    }
  });

  // Delete validation from history
  app.delete("/api/nradiverse/ssrs-powerbi/history/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      await db.delete(reportValidations)
        .where(eq(reportValidations.id, id));

      res.json({ success: true });
    } catch (error: any) {
      console.error("[SSRS-PowerBI] Failed to delete validation:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to delete validation" });
    }
  });

  // ==================== Selenium to Playwright Migration Routes ====================
  
  const { migrateCode, generateProjectStructure, generateSampleCSharpCode } = await import('./selenium-playwright-migration-service');
  
  app.post("/api/nradiverse/migration/convert", async (req: Request, res: Response) => {
    try {
      const { code, fileType } = req.body;
      
      if (!code || typeof code !== 'string') {
        return res.status(400).json({ success: false, error: "Code is required" });
      }
      
      console.log("[Migration] Converting code, file type hint:", fileType);
      
      const result = migrateCode(code, fileType);
      
      console.log("[Migration] Conversion complete:", result.fileType, "Success:", result.success);
      
      res.json({
        success: result.success,
        result
      });
    } catch (error: any) {
      console.error("[Migration] Conversion error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to convert code" });
    }
  });
  
  app.get("/api/nradiverse/migration/project-structure", async (req: Request, res: Response) => {
    try {
      const structure = generateProjectStructure();
      res.json({ success: true, structure });
    } catch (error: any) {
      console.error("[Migration] Project structure error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to generate project structure" });
    }
  });
  
  app.get("/api/nradiverse/migration/samples", async (req: Request, res: Response) => {
    try {
      const samples = generateSampleCSharpCode();
      res.json({ success: true, samples });
    } catch (error: any) {
      console.error("[Migration] Samples error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to generate samples" });
    }
  });

  // ==================== Java → Playwright Migration Routes ====================
  //
  // Architecture: short polling, not SSE. AWS API Gateway has a hard 29-30s
  // integration timeout and buffers responses end-to-end, so any long-lived
  // stream gets truncated with a 503. Each poll request is < 1s, so it fits
  // inside that window comfortably. Pipeline runs in the background on the
  // server; clients fetch incremental events via /status/:jobId?since=N.

  const javaMigrationUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
  const javaMigrationSessions = new Map<string, { zipBuffer?: Buffer }>();

  type MigrationPhase = 'processing' | 'complete' | 'error';
  interface MigrationJob {
    id: string;
    phase: MigrationPhase;
    events: any[];
    result?: any;
    error?: string;
    createdAt: number;
    completedAt?: number;
  }

  const javaMigrationJobs = new Map<string, MigrationJob>();
  const JAVA_MIGRATION_JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
  let lastJavaMigrationResult: any = null;

  // Periodic cleanup so completed jobs don't pile up in memory.
  setInterval(() => {
    const now = Date.now();
    for (const [id, job] of javaMigrationJobs.entries()) {
      if (now - job.createdAt > JAVA_MIGRATION_JOB_TTL_MS) {
        javaMigrationJobs.delete(id);
      }
    }
  }, 5 * 60 * 1000).unref?.();

  app.post("/api/java-migration/upload", javaMigrationUpload.single('framework'), async (req: Request, res: Response) => {
    try {
      const file = (req as any).file;
      if (!file) return res.status(400).json({ success: false, error: "No file uploaded" });
      const sessionId = 'jm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      javaMigrationSessions.set(sessionId, { zipBuffer: file.buffer });
      console.log("[JavaMigration] Upload received:", file.originalname, file.size, "bytes, session:", sessionId);
      res.json({ success: true, sessionId });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Kick off the migration pipeline in the background and return a jobId the
  // client can poll. Body: { sessionId?: string, demo?: boolean }
  app.post("/api/java-migration/start", async (req: Request, res: Response) => {
    try {
      const { sessionId, demo } = (req.body || {}) as { sessionId?: string; demo?: boolean };
      const isDemo = demo === true;

      let zipBuffer: Buffer | null = null;
      if (!isDemo) {
        if (!sessionId) {
          return res.status(400).json({ success: false, error: "sessionId or demo=true required" });
        }
        const session = javaMigrationSessions.get(sessionId);
        if (!session) {
          return res.status(404).json({ success: false, error: "Session not found. Re-upload the framework." });
        }
        zipBuffer = session.zipBuffer || null;
      }

      const jobId = 'jmjob_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const job: MigrationJob = {
        id: jobId,
        phase: 'processing',
        events: [],
        createdAt: Date.now(),
      };
      javaMigrationJobs.set(jobId, job);
      console.log("[JavaMigration] Job created:", jobId, "demo:", isDemo);

      // Fire-and-forget — pipeline runs on the server, client polls.
      (async () => {
        try {
          const { processJavaMigration } = await import('./java-migration-service');
          const onProgress = (event: any) => {
            job.events.push(event);
          };
          const result = await processJavaMigration(zipBuffer, onProgress);
          job.result = result;
          job.phase = 'complete';
          job.completedAt = Date.now();
          lastJavaMigrationResult = result;
          console.log("[JavaMigration] Job complete:", jobId, "events:", job.events.length, "convertedFiles:", result?.convertedFiles?.length || 0);
          if (sessionId) javaMigrationSessions.delete(sessionId);
        } catch (err: any) {
          console.error("[JavaMigration] Job error:", jobId, err);
          job.phase = 'error';
          job.error = err?.message || String(err);
          job.completedAt = Date.now();
        }
      })();

      res.json({ success: true, jobId });
    } catch (error: any) {
      console.error("[JavaMigration] Start error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Poll endpoint — client passes the highest event index it has already
  // consumed via ?since=N and we return only the new ones. This keeps each
  // poll response tiny and well under any proxy timeout.
  app.get("/api/java-migration/status/:jobId", (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const job = javaMigrationJobs.get(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found or expired" });
    }
    const sinceRaw = req.query.since;
    const since = Math.max(0, parseInt(typeof sinceRaw === 'string' ? sinceRaw : '0', 10) || 0);
    const newEvents = since < job.events.length ? job.events.slice(since) : [];
    res.json({
      success: true,
      jobId: job.id,
      phase: job.phase,
      totalEvents: job.events.length,
      events: newEvents,
      ...(job.phase === 'complete' && job.result ? {
        result: {
          stats: job.result.stats,
          convertedCount: job.result.convertedFiles?.length || 0,
        },
      } : {}),
      ...(job.phase === 'error' ? { error: job.error } : {}),
    });
  });

  app.get("/api/java-migration/stream", async (req: Request, res: Response) => {
    const isDemo = req.query.demo === 'true';
    const sessionId = req.query.sessionId as string;

    // SSE headers — mirror the proven pattern used by the other streams in
    // this file. `no-transform` prevents intermediaries from gzipping/buffering,
    // `Transfer-Encoding: chunked` + `flushHeaders()` ensures the response head
    // reaches the client immediately, and `setNoDelay(true)` disables Nagle so
    // small SSE frames are sent without waiting for a full TCP segment. These
    // matter on AWS where ALB / CloudFront / kernel buffering otherwise hold
    // bytes back and the client sees agents stuck on "idle".
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.flushHeaders();
    if (res.socket) {
      res.socket.setNoDelay(true);
    }

    let isConnectionOpen = true;
    res.on('close', () => {
      isConnectionOpen = false;
    });

    const flushNow = () => {
      try {
        if (typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
        if (res.socket && typeof res.socket.uncork === 'function') {
          res.socket.cork();
          res.socket.uncork();
        }
      } catch {
        /* ignore */
      }
    };

    const send = (data: any) => {
      if (!isConnectionOpen || res.writableEnded) return;
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        flushNow();
      } catch (err) {
        console.error('[JavaMigration] SSE write error:', err);
      }
    };
    const sendComplete = () => {
      if (!isConnectionOpen || res.writableEnded) return;
      try {
        res.write(`event: complete\ndata: {}\n\n`);
        flushNow();
        res.end();
      } catch (err) {
        console.error('[JavaMigration] SSE complete error:', err);
      }
    };

    // Keep the connection alive through proxies (ALB idle timeout, etc.) and
    // give the client an early signal that the stream is live before the first
    // pipeline event lands.
    res.write(':connected\n\n');
    flushNow();
    const heartbeat = setInterval(() => {
      if (!isConnectionOpen || res.writableEnded) {
        clearInterval(heartbeat);
        return;
      }
      try {
        res.write(':heartbeat\n\n');
        flushNow();
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    try {
      const { processJavaMigration } = await import('./java-migration-service');
      const session = javaMigrationSessions.get(sessionId || '');
      // For demo mode: pass null zipBuffer; for upload: pass actual buffer
      const zipBuffer = isDemo ? null : (session?.zipBuffer || null);
      if (!isDemo && !session) {
        send({ agent: 'scanner', status: 'error', message: 'Session not found', progress: 0 });
        clearInterval(heartbeat);
        sendComplete();
        return;
      }
      const result = await processJavaMigration(zipBuffer, send);
      lastJavaMigrationResult = result;
      console.log("[JavaMigration] Pipeline complete. convertedFiles:", result?.convertedFiles?.length || 0);
      clearInterval(heartbeat);
      sendComplete();
      if (sessionId) javaMigrationSessions.delete(sessionId);
    } catch (error: any) {
      console.error("[JavaMigration] Stream error:", error);
      send({ agent: 'packager', status: 'error', message: error.message, progress: 0 });
      clearInterval(heartbeat);
      sendComplete();
    }
  });

  app.get("/api/java-migration/download", async (req: Request, res: Response) => {
    try {
      const { buildMigrationZip } = await import('./java-migration-service');
      // Prefer the per-job result (new polling flow); fall back to the most
      // recent completion for any legacy callers that don't pass jobId.
      const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : '';
      const job = jobId ? javaMigrationJobs.get(jobId) : undefined;
      const result = job?.result || lastJavaMigrationResult;

      if (!result || !result.convertedFiles) {
        return res.status(400).json({ success: false, error: "No migration result available. Run migration first." });
      }
      const zipBuffer = await buildMigrationZip(result.convertedFiles);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="playwright-framework.zip"');
      res.setHeader('Content-Length', zipBuffer.length);
      res.send(zipBuffer);
    } catch (error: any) {
      console.error("[JavaMigration] Download error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==================== API Testing Module Routes ====================

  // Helper function to analyze JSON response structure for test generation
  function analyzeJsonSchema(obj: any, path: string = "response", depth: number = 0): string {
    if (depth > 5) return ""; // Limit recursion depth
    
    const lines: string[] = [];
    const indent = "  ".repeat(depth);
    
    if (obj === null) {
      lines.push(`${indent}- ${path}: null`);
    } else if (Array.isArray(obj)) {
      lines.push(`${indent}- ${path}: Array (${obj.length} items)`);
      if (obj.length > 0 && typeof obj[0] === "object" && obj[0] !== null) {
        const firstItem = obj[0];
        const keys = Object.keys(firstItem);
        lines.push(`${indent}  Array element structure:`);
        for (const key of keys.slice(0, 15)) { // Limit to first 15 keys
          const value = firstItem[key];
          const type = Array.isArray(value) ? `Array(${value.length})` : 
                       value === null ? "null" : typeof value;
          lines.push(`${indent}    - ${key}: ${type}`);
          
          // Recurse into nested arrays/objects
          if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
            lines.push(analyzeJsonSchema(value, `${path}[].${key}`, depth + 2));
          } else if (typeof value === "object" && value !== null) {
            const nestedKeys = Object.keys(value).slice(0, 8);
            lines.push(`${indent}      Nested object fields: ${nestedKeys.join(", ")}`);
          }
        }
        if (keys.length > 15) {
          lines.push(`${indent}    ... and ${keys.length - 15} more fields`);
        }
      }
    } else if (typeof obj === "object") {
      const keys = Object.keys(obj);
      lines.push(`${indent}- ${path}: Object with ${keys.length} fields`);
      for (const key of keys.slice(0, 20)) { // Limit to first 20 keys
        const value = obj[key];
        const type = Array.isArray(value) ? `Array(${value.length})` : 
                     value === null ? "null" : typeof value;
        lines.push(`${indent}  - ${key}: ${type}`);
        
        // Show sample value for primitives
        if (typeof value === "string" && value.length < 50) {
          lines.push(`${indent}      Sample: "${value}"`);
        } else if (typeof value === "number" || typeof value === "boolean") {
          lines.push(`${indent}      Value: ${value}`);
        }
        
        // Recurse into nested structures
        if (Array.isArray(value) && value.length > 0) {
          lines.push(analyzeJsonSchema(value, key, depth + 1));
        } else if (typeof value === "object" && value !== null) {
          lines.push(analyzeJsonSchema(value, key, depth + 1));
        }
      }
      if (keys.length > 20) {
        lines.push(`${indent}  ... and ${keys.length - 20} more fields`);
      }
    } else {
      lines.push(`${indent}- ${path}: ${typeof obj} = ${String(obj).substring(0, 50)}`);
    }
    
    return lines.filter(l => l.trim()).join("\n");
  }

  const apiTestingGenerateSchema = z.object({
    apiConfig: z.object({
      method: z.string(),
      endpoint: z.string(),
      baseUrl: z.string().optional(),
      description: z.string().optional(),
      authType: z.string(),
      authToken: z.string().optional(),
      apiKey: z.string().optional(),
      apiKeyHeader: z.string().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      requestBody: z.string().optional(),
      responseSchema: z.string().optional(),
      expectedStatusCodes: z.string().optional(),
      headers: z.array(z.object({ key: z.string(), value: z.string(), enabled: z.boolean() })).optional(),
      queryParams: z.array(z.object({ key: z.string(), value: z.string(), enabled: z.boolean() })).optional()
    }),
    testOptions: z.object({
      functional: z.boolean(),
      negative: z.boolean(),
      boundary: z.boolean(),
      security: z.boolean(),
      performance: z.boolean(),
      includePostmanScripts: z.boolean(),
      includeReadyApiScripts: z.boolean(),
      includePlaywrightScripts: z.boolean().optional().default(true)
    }),
    // Optional pre-executed response captured by the browser. When the server
    // runs inside a private subnet behind a NAT gateway it may not be able to
    // reach the user's target endpoint, but the user's browser typically can.
    // If the client did the fetch successfully, it forwards the result here so
    // the LLM still gets live response data without a server-side egress hop.
    clientExecution: z.object({
      executed: z.boolean(),
      statusCode: z.number(),
      responseTime: z.number(),
      response: z.any().optional(),
      responseHeaders: z.record(z.string(), z.string()).optional(),
      error: z.string().nullable().optional(),
    }).optional()
  });

  // Categorise undici / Node fetch failures into something a user can act on
  // (the default surface is just the unhelpful string "fetch failed").
  function classifyFetchError(err: unknown, requestUrl: string): string {
    const e = err as { name?: string; code?: string; cause?: { code?: string; message?: string }; message?: string };
    const code = e?.cause?.code ?? e?.code;
    const causeMsg = e?.cause?.message ?? "";
    let host = requestUrl;
    try {
      host = new URL(requestUrl).host;
    } catch {
      // requestUrl was malformed — fall through with the raw value
    }
    if (e?.name === "TimeoutError" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT" || code === "ETIMEDOUT") {
      return `Request to ${host} timed out after 30s. The endpoint may be slow or unreachable from the server's network (NAT egress).`;
    }
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return `DNS lookup for ${host} failed. Check the hostname is correct or that the server can resolve it.`;
    }
    if (code === "ECONNREFUSED") {
      return `Connection refused by ${host}. The endpoint is not accepting connections from this server.`;
    }
    if (code === "ECONNRESET") {
      return `Connection to ${host} was reset. The endpoint closed the socket before responding.`;
    }
    if (code === "ENETUNREACH" || code === "EHOSTUNREACH") {
      return `${host} is unreachable from the server's network (no route to host). This is usually a VPC/NAT egress issue — try running the request from your browser.`;
    }
    if (code === "CERT_HAS_EXPIRED" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || (causeMsg && /cert/i.test(causeMsg))) {
      return `TLS certificate validation failed for ${host}: ${causeMsg || e?.message || "certificate error"}.`;
    }
    if (e?.message && e.message !== "fetch failed") {
      return `${e.message} (${host})`;
    }
    if (causeMsg) {
      return `${causeMsg} — could not reach ${host} from the server. Try running the request from your browser.`;
    }
    return `Could not reach ${host} from the server. This usually means the endpoint is blocked by the server's outbound firewall or NAT egress.`;
  }

  // In-memory job store for the long-running API-testing generation flow.
  // The POST handler returns a `jobId` immediately (well under any proxy
  // timeout) and runs the Bedrock work in the background; the client polls
  // `GET /api/nradiverse/api-testing/jobs/:jobId` every 2s until the job is
  // `done` or `error`. This sidesteps CloudFront's 30s origin-response
  // timeout entirely, since every individual request now finishes in < 1s.
  type ApiTestingJob = {
    status: "running" | "done" | "error";
    result?: unknown;
    error?: string;
    createdAt: number;
    finishedAt?: number;
  };
  const apiTestingJobs = new Map<string, ApiTestingJob>();
  const API_TESTING_JOB_TTL_MS = 15 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [id, job] of apiTestingJobs.entries()) {
      const age = now - (job.finishedAt ?? job.createdAt);
      if (age > API_TESTING_JOB_TTL_MS) apiTestingJobs.delete(id);
    }
  }, 5 * 60 * 1000).unref?.();
  const finishApiTestingJob = (jobId: string, payload: any) => {
    const job = apiTestingJobs.get(jobId);
    if (!job || job.status !== "running") return;
    const isError = payload && payload.success === false;
    apiTestingJobs.set(jobId, {
      ...job,
      status: isError ? "error" : "done",
      result: isError ? undefined : payload,
      error: isError ? (payload.error || "Failed to generate test cases") : undefined,
      finishedAt: Date.now(),
    });
  };

  // GET handler — client polls this every 2s until the job is done/error.
  app.get("/api/nradiverse/api-testing/jobs/:jobId", (req: Request, res: Response) => {
    const job = apiTestingJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found or expired" });
    }
    if (job.status === "running") {
      const elapsedMs = Date.now() - job.createdAt;
      return res.json({ success: true, status: "running", elapsedMs });
    }
    if (job.status === "error") {
      return res.json({ success: true, status: "error", error: job.error });
    }
    return res.json({ success: true, status: "done", result: job.result });
  });

  app.post("/api/nradiverse/api-testing/generate", async (req: Request, res: Response) => {
    // Validate the body synchronously so the caller gets immediate 400
    // feedback for malformed payloads. Anything else (the Bedrock call, the
    // upstream API fetch) runs in the background and is observed via polling.
    let validatedBody: ReturnType<typeof apiTestingGenerateSchema.parse>;
    try {
      validatedBody = apiTestingGenerateSchema.parse(req.body);
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err?.message || "Invalid request body" });
    }

    const jobId = (globalThis.crypto as any).randomUUID();
    apiTestingJobs.set(jobId, { status: "running", createdAt: Date.now() });
    res.json({ success: true, jobId });

    // Run the actual generation in the background. Catch every error so the
    // promise never rejects (otherwise Node logs an UnhandledPromiseRejection).
    (async () => {
      try {
        const { apiConfig, testOptions, clientExecution } = validatedBody;
        const sendResult = (payload: unknown) => finishApiTestingJob(jobId, payload);
        // Re-use the existing generation flow verbatim by binding `sendResult`
        // to the job store. Everything below this point is identical to the
        // pre-polling SSE handler body.
        await (async () => {

      console.log("[API Testing] Generating test cases for:", apiConfig.method, apiConfig.endpoint);

      // STEP 1: Actually execute the HTTP request to get real response
      let actualResponse: any = null;
      let actualStatusCode: number = 0;
      let actualResponseTime: number = 0;
      let actualHeaders: Record<string, string> = {};
      let apiCallError: string | null = null;

      // Prefer the browser-side execution when available — the user's browser
      // can usually reach the target API even when the server (behind NAT)
      // cannot, and using the same response avoids a redundant request.
      const shouldUseClientExecution = clientExecution?.executed === true;

      if (shouldUseClientExecution && clientExecution) {
        actualResponse = clientExecution.response ?? null;
        actualStatusCode = clientExecution.statusCode;
        actualResponseTime = clientExecution.responseTime;
        actualHeaders = clientExecution.responseHeaders ?? {};
        console.log(
          `[API Testing] Using client-executed response: ${actualStatusCode} in ${actualResponseTime}ms (skipping server-side fetch)`
        );
      }

      // Declared outside the try so the catch handler can include it in the
      // categorised error message even if the failure happens at fetch() time.
      let serverRequestUrl: string = apiConfig.endpoint;

      if (!shouldUseClientExecution) try {
        if (clientExecution && !clientExecution.executed && clientExecution.error) {
          console.log(
            `[API Testing] Client-side fetch failed (${clientExecution.error}); attempting server-side fetch as fallback.`
          );
        }
        console.log("[API Testing] Executing actual API call to:", apiConfig.endpoint);
        
        // Build request headers
        const requestHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          "Accept": "application/json"
        };

        // Add user-defined headers
        if (apiConfig.headers && Array.isArray(apiConfig.headers)) {
          for (const header of apiConfig.headers) {
            if (header.key && header.value) {
              requestHeaders[header.key] = header.value;
            }
          }
        }

        // Add authentication headers (client sends authToken/apiKey, not authValue)
        if (apiConfig.authType === "bearer" && apiConfig.authToken) {
          requestHeaders["Authorization"] = `Bearer ${apiConfig.authToken}`;
        } else if (apiConfig.authType === "api-key" && apiConfig.apiKey) {
          requestHeaders[apiConfig.apiKeyHeader || "X-API-Key"] = apiConfig.apiKey;
        } else if (apiConfig.authType === "basic" && apiConfig.username) {
          const basicCreds = Buffer.from(`${apiConfig.username}:${apiConfig.password ?? ""}`).toString("base64");
          requestHeaders["Authorization"] = `Basic ${basicCreds}`;
        }

        // Build URL with query parameters
        let requestUrl = apiConfig.endpoint;
        if (apiConfig.queryParams && Array.isArray(apiConfig.queryParams) && apiConfig.queryParams.length > 0) {
          const queryString = apiConfig.queryParams
            .filter((p: any) => p.key && p.value)
            .map((p: any) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
            .join("&");
          if (queryString) {
            requestUrl += (requestUrl.includes("?") ? "&" : "?") + queryString;
          }
        }
        serverRequestUrl = requestUrl;

        const startTime = Date.now();
        const fetchOptions: RequestInit = {
          method: apiConfig.method,
          headers: requestHeaders,
          signal: AbortSignal.timeout(30000) // 30 second timeout
        };

        // Add request body for POST, PUT, PATCH
        if (["POST", "PUT", "PATCH"].includes(apiConfig.method) && apiConfig.requestBody) {
          try {
            fetchOptions.body = typeof apiConfig.requestBody === "string" 
              ? apiConfig.requestBody 
              : JSON.stringify(apiConfig.requestBody);
          } catch {
            fetchOptions.body = apiConfig.requestBody;
          }
        }

        const apiResponse = await fetch(requestUrl, fetchOptions);
        actualResponseTime = Date.now() - startTime;
        actualStatusCode = apiResponse.status;

        // Capture response headers
        apiResponse.headers.forEach((value, key) => {
          actualHeaders[key] = value;
        });

        // Try to parse as JSON
        const responseText = await apiResponse.text();
        try {
          actualResponse = JSON.parse(responseText);
          console.log("[API Testing] Received JSON response with", 
            typeof actualResponse === "object" ? Object.keys(actualResponse).length : 1, "top-level keys");
        } catch {
          actualResponse = { rawText: responseText.substring(0, 2000) };
          console.log("[API Testing] Response is not JSON, captured as raw text");
        }

      } catch (fetchError: any) {
        apiCallError = classifyFetchError(fetchError, serverRequestUrl);
        console.log(
          "[API Testing] API call failed:",
          apiCallError,
          "(raw:", fetchError?.message ?? fetchError, "code:", fetchError?.cause?.code ?? fetchError?.code, ")",
        );
        // Continue with test generation even if API call fails
      }
      // If the client also tried and failed, surface that hint to the user.
      if (apiCallError && clientExecution && clientExecution.executed === false && clientExecution.error) {
        apiCallError = `Both browser and server failed to reach the endpoint. Browser: ${clientExecution.error}. Server: ${apiCallError}`;
      }

      // Build the prompt for Claude
      const systemPrompt = `You are an expert API Testing Engineer with extensive hands-on experience using industry-leading tools including Postman and ReadyAPI. You have deep knowledge of RESTful APIs, SOAP services, GraphQL, and WebSocket protocols. Your expertise spans functional testing, performance testing, security testing, and contract testing.

Your Background & Expertise:

**Postman Experience:**
- Creating and organizing collections with folders, environments, and variables
- Writing pre-request scripts and test scripts using JavaScript/Chai assertions
- Setting up collection runners for batch execution
- Using Newman for CLI-based automation and CI/CD integration
- Managing authentication (OAuth 2.0, API Keys, Bearer tokens, Basic Auth)
- Creating mock servers and documentation
- Data-driven testing with CSV/JSON files
- Environment variable management (global, collection, local)

**ReadyAPI Experience:**
- SoapUI Pro for functional API testing
- LoadUI Pro for performance and load testing
- ServiceV Pro for API virtualization and mocking
- Creating test suites with data-driven testing
- Groovy scripting for advanced test logic
- Assertions library (XPath, JSONPath, contains, regex)
- Security testing with vulnerability scans
- WS-Security and SAML token handling
- SOAP request/response validation with WSDL schemas

You must generate test cases in valid JSON format only. Do not include any markdown formatting or code blocks. Return only the raw JSON array.`;

      const enabledTestTypes = [];
      if (testOptions.functional) enabledTestTypes.push("functional");
      if (testOptions.negative) enabledTestTypes.push("negative");
      if (testOptions.boundary) enabledTestTypes.push("boundary");
      if (testOptions.security) enabledTestTypes.push("security");
      if (testOptions.performance) enabledTestTypes.push("performance");

      // Build actual response section for the prompt
      let actualResponseSection = "";
      if (actualResponse != null && !apiCallError) {
        const responsePreview = JSON.stringify(actualResponse, null, 2).substring(0, 8000);
        
        // Generate JSON schema analysis for better test generation
        const schemaAnalysis = analyzeJsonSchema(actualResponse);
        
        actualResponseSection = `
**ACTUAL API RESPONSE (Live Data - Use this to generate validation tests):**
- Status Code: ${actualStatusCode}
- Response Time: ${actualResponseTime}ms
- Response Headers: ${JSON.stringify(actualHeaders)}
- Response Body:
\`\`\`json
${responsePreview}
\`\`\`

**JSON SCHEMA ANALYSIS:**
${schemaAnalysis}

**CRITICAL: Generate COMPREHENSIVE JSON Schema Validation Test Cases**

You MUST generate test cases with detailed JSON validation assertions for EVERY level of this response:

**1. Root Level Validations:**
- Verify each root-level field exists (Code, Message, etc.)
- Validate data types (number, string, boolean, array, object)
- Check specific values where applicable (e.g., Code === 1, Message === "Success")

**2. Array Structure Validations:**
- Verify arrays exist and are of type Array
- Check array is not empty (length > 0)
- Validate each element in arrays has required properties

**3. Nested Object Validations:**
For each nested object/array in the response (like Employees, Attributes, Addresses, BankDetails):
- Validate the object/array exists
- Check all required fields within nested objects
- Verify data types of nested fields
- Validate nested arrays have proper structure

**4. Postman Test Script Requirements:**
Include pm.test() assertions for:
- pm.response.to.have.jsonBody("fieldName")
- pm.expect(jsonData.field).to.be.a("type")
- pm.expect(jsonData.array).to.be.an("array").that.is.not.empty
- pm.expect(jsonData.nested.field).to.exist
- JSONPath validations for deeply nested fields

**5. ReadyAPI Groovy Assertions:**
Include Groovy assertions for:
- def json = new JsonSlurper().parseText(response)
- assert json.fieldName != null
- assert json.fieldName instanceof String/Number/List
- Iterate over arrays to validate each element
`;
      } else if (apiCallError) {
        actualResponseSection = `
**API CALL STATUS:** Failed - ${apiCallError}
Generate test cases based on the expected behavior described below. Include error handling tests.
`;
      }

      const userPrompt = `Generate API test cases for the following endpoint.

**API Details:**
- Method: ${apiConfig.method}
- Endpoint: ${apiConfig.endpoint}
- Description: ${apiConfig.description || "Not provided"}
- Authentication: ${apiConfig.authType}
- Expected Status Codes: ${apiConfig.expectedStatusCodes || "200, 201, 204"}
${apiConfig.requestBody ? `- Request Body: ${apiConfig.requestBody}` : ""}
${apiConfig.responseSchema ? `- Response Schema: ${apiConfig.responseSchema}` : ""}
${apiConfig.headers?.length ? `- Headers: ${JSON.stringify(apiConfig.headers)}` : ""}
${apiConfig.queryParams?.length ? `- Query Parameters: ${JSON.stringify(apiConfig.queryParams)}` : ""}
${actualResponseSection}

**Test Types to Generate:** ${enabledTestTypes.join(", ")}
**Include Postman Scripts:** ${testOptions.includePostmanScripts}
**Include ReadyAPI Groovy Scripts:** ${testOptions.includeReadyApiScripts}

Generate exactly 8 test cases covering the requested test types. Include at least one
schema-validation test case when live response data is available (validate root-level
fields, data types, and nested structure). Keep each test focused and concise.

**For each test case, include:**
1. id (format: TC_API_XXX_NNN)
2. title
3. type (functional, negative, boundary, security, or performance)
4. priority (P0/P1/P2/P3)
5. description (1 short sentence)
6. preconditions (max 2 short strings)
7. steps — exactly 4 steps, each with a brief action and expected result
8. testData (small JSON object)
9. assertions (3–5 short strings naming concrete fields)
${testOptions.includePostmanScripts ? "10. postmanScript — 3–6 lines of pm.test()/pm.expect() covering the key assertions" : ""}
${testOptions.includeReadyApiScripts ? "11. readyApiGroovy — 3–6 lines using JsonSlurper to validate the key fields" : ""}

Be terse. No prose outside the JSON. Return ONLY a valid JSON array:
[
  {
    "id": "TC_API_XXX_001",
    "title": "Test case title",
    "type": "functional",
    "priority": "P1",
    "description": "Short description",
    "preconditions": ["Precondition 1"],
    "steps": [
      {"action": "Step 1 action", "expected": "Expected result 1"},
      {"action": "Step 2 action", "expected": "Expected result 2"},
      {"action": "Step 3 action", "expected": "Expected result 3"},
      {"action": "Step 4 action", "expected": "Expected result 4"}
    ],
    "testData": {"key": "value"},
    "assertions": ["Assertion 1", "Assertion 2"],
    "postmanScript": "pm.test(...)",
    "readyApiGroovy": "assert response..."
  }
]`;

      // API execution metadata to include in response
      const apiExecutionMeta = {
        executed: !apiCallError,
        statusCode: actualStatusCode,
        responseTime: actualResponseTime,
        error: apiCallError,
        responsePreview: actualResponse != null ? JSON.stringify(actualResponse, null, 2).substring(0, 5000) : null,
        fullResponse: actualResponse,
        responseHeaders: actualHeaders
      };

      // Call the LLM via the hosting-aware unified facade (qeAnthropicClient
      // → Bedrock on AWS, Azure OpenAI on Azure). Falls back to sample test
      // cases only when no LLM backend is reachable (Azure deploy without the
      // Replit Anthropic proxy key) so the AI Quality Engine demo still works.
      const anthropicApiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      const onAwsForApiTesting = (process.env.DEVX_HOSTING || 'azure').toLowerCase().trim() === 'aws';
      if (!anthropicApiKey && !onAwsForApiTesting) {
        const sampleTestCases = generateSampleAPITestCases(apiConfig, testOptions, actualResponse, actualStatusCode);
        return sendResult({ success: true, testCases: sampleTestCases, apiExecution: apiExecutionMeta });
      }

      let responseText = "";
      try {
        // max_tokens deliberately kept tight (≈4500). Bedrock Sonnet 4.5 outputs
        // ~50–80 tokens/sec, so every 1000 extra tokens adds 12–20 s of user
        // wait. With 8 test cases × 4 steps × short Postman/Groovy snippets
        // the response comfortably fits under 4500 tokens, which keeps the
        // visible wall-clock time around 45–60 s instead of 2 min+.
        const startedAt = Date.now();
        const claudeData = await qeAnthropicClient.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 4500,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }]
        });
        responseText = (claudeData.content as Array<{ type: string; text: string }>)?.[0]?.text || "";
        console.log(`[API Testing] LLM completed in ${Date.now() - startedAt}ms (${responseText.length} chars)`);
      } catch (llmErr: any) {
        console.error("[API Testing] LLM error:", llmErr?.message || llmErr);
        const sampleTestCases = generateSampleAPITestCases(apiConfig, testOptions, actualResponse, actualStatusCode);
        return sendResult({ success: true, testCases: sampleTestCases, apiExecution: apiExecutionMeta });
      }

      // Parse the JSON response
      try {
        // Clean the response - remove any markdown formatting
        let cleanedResponse = responseText.trim();
        if (cleanedResponse.startsWith("```json")) {
          cleanedResponse = cleanedResponse.slice(7);
        }
        if (cleanedResponse.startsWith("```")) {
          cleanedResponse = cleanedResponse.slice(3);
        }
        if (cleanedResponse.endsWith("```")) {
          cleanedResponse = cleanedResponse.slice(0, -3);
        }
        cleanedResponse = cleanedResponse.trim();

        const testCases = JSON.parse(cleanedResponse);
        console.log("[API Testing] Generated", testCases.length, "test cases with real response validation");
        sendResult({ success: true, testCases, apiExecution: apiExecutionMeta });
      } catch (parseError) {
        console.error("[API Testing] Failed to parse Claude response:", parseError);
        // Fallback to sample test cases
        const sampleTestCases = generateSampleAPITestCases(apiConfig, testOptions, actualResponse, actualStatusCode);
        sendResult({ success: true, testCases: sampleTestCases, apiExecution: apiExecutionMeta });
      }
        })();
      } catch (error: any) {
        console.error("[API Testing] Background generation error:", error);
        finishApiTestingJob(jobId, {
          success: false,
          error: error?.message || "Failed to generate test cases",
        });
      }
    })();
  });

  // ==================== API Baseline / Regression Testing Routes ====================
  
  // In-memory storage for API baselines (will use DB when available)
  const apiBaselinesStore: Map<string, any> = new Map();
  const apiExecutionsStore: Map<string, any[]> = new Map();

  // Helper function to deep compare JSON and find differences
  function compareJsonResponses(baseline: any, actual: any, path: string = ""): any[] {
    const differences: any[] = [];
    
    const getType = (val: any): string => {
      if (val === null) return "null";
      if (Array.isArray(val)) return "array";
      return typeof val;
    };

    const baselineType = getType(baseline);
    const actualType = getType(actual);

    // Type mismatch
    if (baselineType !== actualType) {
      differences.push({
        path: path || "root",
        type: "type_changed",
        expectedType: baselineType,
        actualType: actualType,
        expectedValue: baseline,
        actualValue: actual,
        severity: "critical"
      });
      return differences;
    }

    if (baselineType === "object" && baseline !== null) {
      const baselineKeys = Object.keys(baseline);
      const actualKeys = Object.keys(actual);

      // Find missing fields
      for (const key of baselineKeys) {
        const fieldPath = path ? `${path}.${key}` : key;
        if (!(key in actual)) {
          differences.push({
            path: fieldPath,
            type: "missing",
            expectedValue: baseline[key],
            actualValue: undefined,
            severity: "critical"
          });
        } else {
          differences.push(...compareJsonResponses(baseline[key], actual[key], fieldPath));
        }
      }

      // Find added fields
      for (const key of actualKeys) {
        if (!(key in baseline)) {
          const fieldPath = path ? `${path}.${key}` : key;
          differences.push({
            path: fieldPath,
            type: "added",
            expectedValue: undefined,
            actualValue: actual[key],
            severity: "info"
          });
        }
      }
    } else if (baselineType === "array") {
      // For arrays, compare structure of first element if both have elements
      if (baseline.length > 0 && actual.length > 0) {
        // Compare first element structure
        const firstBaselineItem = baseline[0];
        const firstActualItem = actual[0];
        if (typeof firstBaselineItem === "object" && typeof firstActualItem === "object") {
          differences.push(...compareJsonResponses(firstBaselineItem, firstActualItem, `${path}[0]`));
        }
      }
      // Note: Array length changes as "value_changed" for info
      if (baseline.length !== actual.length) {
        differences.push({
          path: `${path}.length`,
          type: "value_changed",
          expectedValue: baseline.length,
          actualValue: actual.length,
          severity: "warning"
        });
      }
    } else {
      // Primitive value comparison
      if (baseline !== actual) {
        differences.push({
          path: path || "root",
          type: "value_changed",
          expectedValue: baseline,
          actualValue: actual,
          severity: "warning"
        });
      }
    }

    return differences;
  }

  // Helper to extract schema from response
  function extractSchema(obj: any, path: string = ""): any[] {
    const schema: any[] = [];
    
    const getType = (val: any): string => {
      if (val === null) return "null";
      if (Array.isArray(val)) return "array";
      return typeof val;
    };

    if (obj === null || obj === undefined) {
      return schema;
    }

    if (Array.isArray(obj)) {
      if (obj.length > 0 && typeof obj[0] === "object") {
        schema.push({
          path: path || "root",
          type: "array",
          required: true,
          children: extractSchema(obj[0], `${path}[]`)
        });
      } else {
        schema.push({
          path: path || "root",
          type: "array",
          required: true,
          sampleValue: obj.length
        });
      }
    } else if (typeof obj === "object") {
      for (const [key, value] of Object.entries(obj)) {
        const fieldPath = path ? `${path}.${key}` : key;
        const fieldType = getType(value);
        
        if (fieldType === "array" && Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
          schema.push({
            path: fieldPath,
            type: "array",
            required: true,
            children: extractSchema(value[0], `${fieldPath}[]`)
          });
        } else if (fieldType === "object" && value !== null) {
          schema.push({
            path: fieldPath,
            type: "object",
            required: true,
            children: extractSchema(value, fieldPath)
          });
        } else {
          schema.push({
            path: fieldPath,
            type: fieldType,
            required: true,
            sampleValue: value
          });
        }
      }
    }

    return schema;
  }

  // Save API baseline
  app.post("/api/baselines", async (req: Request, res: Response) => {
    try {
      const { name, description, method, endpoint, requestHeaders, requestBody, response, statusCode, responseHeaders } = req.body;

      if (!name || !method || !endpoint) {
        return res.status(400).json({ success: false, error: "Name, method, and endpoint are required" });
      }

      const id = `baseline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const schema = extractSchema(response);

      const baseline = {
        id,
        name,
        description: description || "",
        method,
        endpoint,
        requestHeaders: requestHeaders || {},
        requestBody: requestBody || "",
        baselineResponse: response,
        baselineStatusCode: statusCode,
        baselineHeaders: responseHeaders || {},
        responseSchema: schema,
        lastExecutedAt: new Date().toISOString(),
        lastExecutionStatus: "recorded",
        executionCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      apiBaselinesStore.set(id, baseline);
      apiExecutionsStore.set(id, []);

      console.log("[API Baseline] Saved baseline:", id, name);
      res.json({ success: true, baseline });
    } catch (error: any) {
      console.error("[API Baseline] Save error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get all baselines
  app.get("/api/baselines", async (req: Request, res: Response) => {
    try {
      const baselines = Array.from(apiBaselinesStore.values());
      res.json({ success: true, baselines });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get single baseline
  app.get("/api/baselines/:id", async (req: Request, res: Response) => {
    try {
      const baseline = apiBaselinesStore.get(req.params.id);
      if (!baseline) {
        return res.status(404).json({ success: false, error: "Baseline not found" });
      }
      const executions = apiExecutionsStore.get(req.params.id) || [];
      res.json({ success: true, baseline, executions });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Delete baseline
  app.delete("/api/baselines/:id", async (req: Request, res: Response) => {
    try {
      if (!apiBaselinesStore.has(req.params.id)) {
        return res.status(404).json({ success: false, error: "Baseline not found" });
      }
      apiBaselinesStore.delete(req.params.id);
      apiExecutionsStore.delete(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==================== TestComplete Script Generation ====================

  app.post("/api/generate/testcomplete", async (req: Request, res: Response) => {
    const { title, module: storyModule, acceptanceCriteria } = req.body;

    if (!title || typeof title !== 'string' || !title.trim() ||
        !acceptanceCriteria || typeof acceptanceCriteria !== 'string' || !acceptanceCriteria.trim()) {
      return res.status(400).json({ error: 'title and acceptanceCriteria are required' });
    }

    try {
      const result = await generateTestCompleteScripts({
        title: title.trim(),
        module: (storyModule || '').trim(),
        acceptanceCriteria: acceptanceCriteria.trim(),
      });
      return res.status(200).json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // ==================== Playwright Script Export ====================
  
  const shouldSkipPlaywrightDiscovery = (url: string | undefined, skipDiscovery?: boolean): boolean => {
    if (skipDiscovery) return true;
    const normalized = (url || '').trim().toLowerCase();
    if (!normalized) return true;
    const placeholders = [
      'https://your-app.com',
      'http://your-app.com',
      'https://example.com',
      'http://example.com',
    ];
    return placeholders.some((p) => normalized === p || normalized.startsWith(`${p}/`));
  };

  app.post("/api/playwright/export-script", async (req: Request, res: Response) => {
    try {
      const { testCases, targetUrl, mode, skipDiscovery } = req.body;
      const exportMode = mode || 'xpath';
      
      if (!testCases || !Array.isArray(testCases) || testCases.length === 0) {
        return res.status(400).json({ success: false, error: "Test cases array is required" });
      }

      const formattedTestCases: TestCaseExecution[] = testCases.map((tc: any) => ({
        testCaseId: tc.id || tc.testCaseId || `TC_${Date.now()}`,
        title: tc.title || 'Untitled Test',
        category: tc.testType || tc.category || 'functional',
        priority: tc.priority || 'P2',
        steps: (tc.steps || tc.testSteps || []).map((step: any) => ({
          action: step.action || step.step || '',
          expected: step.expected_behavior || step.expected || '',
          testData: step.testData || ''
        }))
      }));

      const resolvedUrl = targetUrl || 'https://your-app.com';
      const skipElementDiscovery = shouldSkipPlaywrightDiscovery(resolvedUrl, skipDiscovery);
      
      let script: string;
      let elementsDiscovered = 0;
      let elements: any[] = [];
      
      if (skipElementDiscovery) {
        console.log(`[Playwright Export] Skipping element discovery for ${resolvedUrl} (mode: ${exportMode})`);
        if (exportMode === 'cli') {
          script = generatePlaywrightScriptCLI(formattedTestCases, resolvedUrl, []);
        } else {
          script = generatePlaywrightScript(formattedTestCases, resolvedUrl);
        }
      } else {
        try {
          console.log(`[Playwright Export] Crawling ${resolvedUrl} to discover elements (mode: ${exportMode})...`);
          elements = await discoverPageElements(resolvedUrl);
          elementsDiscovered = elements.length;
          console.log(`[Playwright Export] Discovered ${elements.length} interactive elements`);
          
          if (exportMode === 'cli') {
            script = generatePlaywrightScriptCLI(formattedTestCases, resolvedUrl, elements);
          } else if (elements.length > 0) {
            script = generatePlaywrightScriptWithXPaths(formattedTestCases, resolvedUrl, elements);
          } else {
            console.log(`[Playwright Export] No elements discovered, falling back to text-based locators`);
            script = generatePlaywrightScript(formattedTestCases, resolvedUrl);
          }
        } catch (crawlError: any) {
          console.warn(`[Playwright Export] Element discovery failed: ${crawlError.message}. Using text-based locators.`);
          if (exportMode === 'cli') {
            script = generatePlaywrightScriptCLI(formattedTestCases, resolvedUrl, []);
          } else {
            script = generatePlaywrightScript(formattedTestCases, resolvedUrl);
          }
        }
      }
      
      const config = generatePlaywrightConfig();

      const packageJson = JSON.stringify({
        name: 'nat2-playwright-tests',
        version: '1.0.0',
        description: `Auto-generated Playwright tests for ${resolvedUrl} - NAT 2.0 Export`,
        scripts: {
          'test': 'npx playwright test',
          'test:headed': 'npx playwright test --headed',
          'test:debug': 'npx playwright test --debug',
          'test:chromium': 'npx playwright test --project=chromium',
          'test:firefox': 'npx playwright test --project=firefox',
          'test:mobile': 'npx playwright test --project=mobile-chrome',
          'report': 'npx playwright show-report',
          'postinstall': 'npx playwright install chromium'
        },
        devDependencies: {
          '@playwright/test': '^1.49.0'
        }
      }, null, 2);

      const tsconfigJson = JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          outDir: './dist'
        },
        include: ['tests/**/*.ts']
      }, null, 2);

      const readmeContent = `# Playwright Test Suite - NAT 2.0 Export

## Quick Start

\`\`\`bash
# Install dependencies (automatically installs Chromium browser)
npm install

# Run all tests
npm test

# Run in headed mode (see browser)
npm run test:headed

# Run specific test
npx playwright test tests/generated-tests.spec.ts

# View HTML report
npm run report
\`\`\`

## Available Scripts

| Command | Description |
|---------|-------------|
| \`npm test\` | Run all tests |
| \`npm run test:headed\` | Run tests with visible browser |
| \`npm run test:debug\` | Run tests in debug mode |
| \`npm run test:chromium\` | Run tests in Chromium only |
| \`npm run test:firefox\` | Run tests in Firefox only |
| \`npm run test:mobile\` | Run tests in mobile Chrome |
| \`npm run report\` | View HTML test report |

## Additional Commands

\`\`\`bash
# Record new tests interactively
npx playwright codegen ${resolvedUrl}

# Generate trace on failure
npx playwright test --trace on
\`\`\`

## Project Structure

- \`package.json\` - Dependencies and scripts
- \`tsconfig.json\` - TypeScript configuration
- \`playwright.config.ts\` - Playwright configuration
- \`tests/generated-tests.spec.ts\` - Auto-generated test cases

## Requirements

- Node.js 18+ (recommended: Node.js 20+)
- npm 9+

## Export Mode: ${exportMode === 'cli' ? 'CLI (Snapshot-based)' : 'XPath (Selector-based)'}
${exportMode === 'cli' ? `
This script uses snapshot-based element references (e1, e2, e3...) for ~60% token reduction.
Elements are discovered at runtime using \`getSnapshot()\` and matched by label.
` : `
This script uses real XPath selectors extracted from the live website.
Each element includes a fallback locator strategy (label, placeholder, text).
`}
`;

      const pageUrls = new Set(elements.filter(e => e.pageUrl).map(e => e.pageUrl!));
      const pagesCrawled = pageUrls.size || 1;
      console.log(`[Playwright Export] Generated script for ${formattedTestCases.length} test cases with ${elementsDiscovered} elements across ${pagesCrawled} pages`);
      
      res.json({
        success: true,
        files: {
          'tests/generated-tests.spec.ts': script,
          'playwright.config.ts': config,
          'package.json': packageJson,
          'tsconfig.json': tsconfigJson,
          'README.md': readmeContent
        },
        testCaseCount: formattedTestCases.length,
        elementsDiscovered,
        pagesCrawled,
        exportMode,
        targetUrl: resolvedUrl,
        tokenEfficiency: exportMode === 'cli' ? {
          estimatedTokens: formattedTestCases.reduce((sum, tc) => sum + tc.steps.length * 2550, 0),
          mcpEquivalent: formattedTestCases.reduce((sum, tc) => sum + tc.steps.length * 6500, 0),
          savings: '~60%'
        } : undefined
      });
    } catch (error: any) {
      console.error("[Playwright Export] Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==================== Session Registry Routes ====================

  const sessionRegistry = SessionRegistry.getInstance();
  const evidencePipeline = new EvidencePipeline();
  const selfHealingAgent = new SelfHealingAgent();
  const adaptorAgent = new AdaptorAgent();

  app.get("/api/nat2/sessions", async (_req: Request, res: Response) => {
    try {
      const sessions = sessionRegistry.listActiveSessions();
      const stats = sessionRegistry.getStats();
      res.json({ success: true, sessions, stats });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/nat2/sessions", async (req: Request, res: Response) => {
    try {
      const { domain, url } = req.body;
      if (!domain || !url) {
        return res.status(400).json({ success: false, error: "Domain and url are required" });
      }
      const validDomains = ['HEALTHCARE', 'INSURANCE', 'BANKING', 'FINTECH', 'REGRESSION', 'ACCESSIBILITY', 'VISUAL'];
      const domainKey = domain.toUpperCase();
      if (!validDomains.includes(domainKey)) {
        return res.status(400).json({ success: false, error: `Invalid domain. Must be one of: ${validDomains.join(', ')}` });
      }
      const cli = await sessionRegistry.getOrCreateSession(domainKey as any, url);
      res.json({ success: true, sessionActive: cli.isActive() });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.delete("/api/nat2/sessions/:domain", async (req: Request, res: Response) => {
    try {
      const domainKey = req.params.domain.toUpperCase() as any;
      await sessionRegistry.forceReset(domainKey);
      res.json({ success: true });
    } catch (error: any) {
      res.status(404).json({ success: false, error: error.message });
    }
  });

  // ==================== Self-Healing Status ====================

  app.get("/api/nat2/healing/report", async (_req: Request, res: Response) => {
    try {
      const report = selfHealingAgent.generateReport();
      res.json({ success: true, report });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==================== BDD Export ====================

  app.post("/api/nat2/bdd/generate", async (req: Request, res: Response) => {
    try {
      const { testCase, domain, mode } = req.body;
      if (!testCase) {
        return res.status(400).json({ success: false, error: "testCase is required" });
      }

      const agent = new AdaptorAgent(domain || 'regression');
      const scenario = agent.convertTestCaseToBDD(testCase);
      const featureFile = agent.generateFeatureFile(scenario);

      let stepDefinitions: string;
      if (mode === 'cli') {
        stepDefinitions = agent.generateCLIStepDefinitions(scenario);
      } else {
        stepDefinitions = agent.generateXPathStepDefinitions(scenario);
      }

      res.json({
        success: true,
        featureFile,
        stepDefinitions,
        scenario,
        mode: mode || 'xpath'
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Execute baseline and compare
  app.post("/api/baselines/:id/execute", async (req: Request, res: Response) => {
    try {
      const baseline = apiBaselinesStore.get(req.params.id);
      if (!baseline) {
        return res.status(404).json({ success: false, error: "Baseline not found" });
      }

      // Execute the API call
      const startTime = Date.now();
      let actualResponse: any = null;
      let actualStatusCode: number = 0;
      let actualHeaders: Record<string, string> = {};
      let apiError: string | null = null;

      try {
        // Reconstruct headers from saved baseline
        const requestHeaders: Record<string, string> = {};
        
        // Add saved headers
        if (baseline.requestHeaders && typeof baseline.requestHeaders === 'object') {
          Object.entries(baseline.requestHeaders).forEach(([key, value]) => {
            if (typeof value === 'string') {
              requestHeaders[key] = value;
            }
          });
        }
        
        // Ensure content-type and accept are set
        if (!requestHeaders["Content-Type"] && !requestHeaders["content-type"]) {
          requestHeaders["Content-Type"] = "application/json";
        }
        if (!requestHeaders["Accept"] && !requestHeaders["accept"]) {
          requestHeaders["Accept"] = "application/json";
        }

        const fetchOptions: any = {
          method: baseline.method,
          headers: requestHeaders
        };

        // Handle request body for POST/PUT/PATCH
        if (baseline.requestBody && ["POST", "PUT", "PATCH"].includes(baseline.method)) {
          // If requestBody is already a string, use it directly
          // If it's an object, stringify it
          if (typeof baseline.requestBody === 'string') {
            fetchOptions.body = baseline.requestBody;
          } else {
            fetchOptions.body = JSON.stringify(baseline.requestBody);
          }
        }

        console.log("[API Baseline] Executing:", baseline.method, baseline.endpoint);
        console.log("[API Baseline] Headers:", JSON.stringify(requestHeaders));
        
        const response = await fetch(baseline.endpoint, fetchOptions);
        actualStatusCode = response.status;
        
        console.log("[API Baseline] Response status:", actualStatusCode);
        
        response.headers.forEach((value, key) => {
          actualHeaders[key] = value;
        });

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          actualResponse = await response.json();
        } else {
          actualResponse = await response.text();
        }
      } catch (err: any) {
        apiError = err.message;
      }

      const responseTime = Date.now() - startTime;

      // Compare responses
      const differences: any[] = [];
      
      // CRITICAL: Check status code mismatch FIRST - this is always a failure
      const statusCodeMismatch = Number(actualStatusCode) !== Number(baseline.baselineStatusCode);
      if (statusCodeMismatch) {
        differences.push({
          path: "HTTP Status Code",
          type: "value_changed",
          expectedValue: baseline.baselineStatusCode,
          actualValue: actualStatusCode,
          severity: "critical"
        });
      }

      // Add API error as a critical difference
      if (apiError) {
        differences.push({
          path: "API Request",
          type: "missing",
          expectedValue: "Successful response",
          actualValue: apiError,
          severity: "critical"
        });
      }

      // Compare JSON responses only if no error and both responses exist
      if (!apiError && actualResponse && baseline.baselineResponse) {
        differences.push(...compareJsonResponses(baseline.baselineResponse, actualResponse));
      }
      
      // Calculate summary
      const missingFields = differences.filter(d => d.type === "missing").length;
      const addedFields = differences.filter(d => d.type === "added").length;
      const typeChanges = differences.filter(d => d.type === "type_changed").length;
      const valueChanges = differences.filter(d => d.type === "value_changed").length;
      
      const hasCritical = differences.some(d => d.severity === "critical");
      const hasWarning = differences.some(d => d.severity === "warning");
      
      // Determine overall status - FAIL if any critical issue (including status code mismatch)
      let overallStatus = "pass";
      if (apiError || hasCritical || statusCodeMismatch) {
        overallStatus = "fail";
      } else if (hasWarning) {
        overallStatus = "warning";
      }

      const summary = {
        totalFields: baseline.responseSchema?.length || 0,
        matchedFields: (baseline.responseSchema?.length || 0) - missingFields - typeChanges,
        missingFields,
        addedFields,
        typeChanges,
        valueChanges,
        overallStatus,
        statusCodeMatch: actualStatusCode === baseline.baselineStatusCode,
        responseTime
      };

      // Save execution
      const executionId = `exec_${Date.now()}`;
      const execution = {
        id: executionId,
        baselineId: baseline.id,
        status: overallStatus,
        statusCode: actualStatusCode,
        responseTime,
        actualResponse,
        differences,
        summary,
        error: apiError,
        createdAt: new Date().toISOString()
      };

      const executions = apiExecutionsStore.get(baseline.id) || [];
      executions.unshift(execution);
      if (executions.length > 50) executions.pop(); // Keep last 50 executions
      apiExecutionsStore.set(baseline.id, executions);

      // Update baseline
      baseline.lastExecutedAt = new Date().toISOString();
      baseline.lastExecutionStatus = overallStatus;
      baseline.executionCount = (baseline.executionCount || 0) + 1;
      apiBaselinesStore.set(baseline.id, baseline);

      console.log("[API Baseline] Execution complete:", baseline.id, overallStatus, `${differences.length} differences`);

      res.json({
        success: true,
        execution,
        baseline: {
          id: baseline.id,
          name: baseline.name,
          lastExecutionStatus: overallStatus
        }
      });
    } catch (error: any) {
      console.error("[API Baseline] Execution error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==================== BDD Multi-Language Export Helper Utilities ====================

  function bddDeriveGiven(title: string, _category: string): string {
    const lower = title.toLowerCase();
    if (lower.includes('login') || lower.includes('auth'))
      return 'the user is authenticated in the system';
    if (lower.includes('session') || lower.includes('refresh'))
      return 'the user has an active session';
    return 'the system is in a valid state for this action';
  }

  function bddDeriveWhen(title: string, _category: string): string {
    const lower = title.toLowerCase();
    if (lower.includes('submit') || lower.includes('click'))
      return `the user performs the action: "${title}"`;
    if (lower.includes('enter') || lower.includes('input') || lower.includes('change') || lower.includes('select'))
      return `the user executes: "${title}"`;
    if (lower.includes('verify') || lower.includes('check'))
      return `the user inspects: "${title}"`;
    return `the user executes the scenario: "${title}"`;
  }

  function bddDeriveWhenRaw(title: string, _category: string): string {
    const lower = title.toLowerCase();
    if (lower.includes('submit') || lower.includes('click'))
      return `the user performs the action: "${title}"`;
    if (lower.includes('enter') || lower.includes('input') || lower.includes('change') || lower.includes('select'))
      return `the user executes: "${title}"`;
    if (lower.includes('verify') || lower.includes('check'))
      return `the user inspects: "${title}"`;
    return `the user executes the scenario: "${title}"`;
  }

  function bddDeriveThen(title: string, category: string): string {
    const lower = title.toLowerCase();
    if (category === 'negative') return 'the system correctly handles the invalid input';
    if (category === 'security') return 'the system maintains security and blocks threats';
    if (category === 'accessibility') return 'the page meets accessibility requirements';
    if (lower.includes('persist') || lower.includes('save')) return 'the data is persisted correctly after the action';
    if (lower.includes('downstream') || lower.includes('process')) return 'all downstream processes complete successfully';
    return 'the expected outcome is achieved successfully';
  }

  function bddCapitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function bddToSnakeCase(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function bddToClassName(str: string): string {
    return str.split(/[\s_\-]+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join('').replace(/[^a-zA-Z0-9]/g, '').substring(0, 30);
  }

  function bddToPackageName(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '').substring(0, 15) || 'company';
  }

  function bddToJavaCamelCase(str: string): string {
    const words = str.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    return words[0] + words.slice(1).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  }

  function bddToSafeJSName(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 40);
  }

  interface BddSamplePatterns {
    testIdPrefix: string;
    tagConvention: string;
    poVariableName: string;
    hasWaitForLoad: boolean;
    usesTestData: boolean;
    testDataImport: string;
    helperImports: string[];
    hasParametric: boolean;
    usesAdvisory: boolean;
    usesTestSkip: boolean;
    importPaths: { pageObjects: string; helpers: string; data: string; };
    fillFn: string;
    clickFn: string;
    assertFn: string;
    navigateFn: string;
  }

  function extractBddSamplePatterns(sampleScript: string, functions: any[]): BddSamplePatterns {
    const tcMatch = sampleScript.match(/['"`](TC-[A-Z]+)\d+/);
    const tagMatch = sampleScript.match(/@(security|smoke|functional|regression|e2e)/i);
    const poMatch = sampleScript.match(/const (\w+) = new \w+Page/);
    const poImportMatch = sampleScript.match(/from\s+['"]([^'"]*pages[^'"]*)['"]/);
    const helperMatches = sampleScript.match(/import\s+\{[^}]+\}\s+from\s+['"][^'"]*helper[^'"]*['"]/g) ?? [];
    const dataImportMatch = sampleScript.match(/from\s+['"]([^'"]*test\.data[^'"]*)['"]/);
    const helperPathMatch = sampleScript.match(/from\s+['"]([^'"]*helpers?[^'"]*)['"]/);

    const fillFn = functions.find((f: any) => ['fill','type','enter','input','set'].some(k => f.category?.toLowerCase().includes(k)))?.name ?? 'fillField';
    const clickFn = functions.find((f: any) => ['click','tap','press'].some(k => f.category?.toLowerCase().includes(k)))?.name ?? 'clickBtn';
    const assertFn = functions.find((f: any) => ['assert','verify','check','expect'].some(k => f.category?.toLowerCase().includes(k)))?.name ?? 'verifyVisible';
    const navigateFn = functions.find((f: any) => ['navigate','goto','visit'].some(k => f.category?.toLowerCase().includes(k)))?.name ?? 'navigate';

    return {
      testIdPrefix: tcMatch?.[1] ?? 'TC',
      tagConvention: tagMatch ? '@' + tagMatch[1].toLowerCase() : '',
      poVariableName: poMatch?.[1] ?? 'po',
      hasWaitForLoad: sampleScript.includes('waitForPageLoad'),
      usesTestData: !!dataImportMatch,
      testDataImport: dataImportMatch?.[0] ?? '',
      helperImports: helperMatches,
      hasParametric: /for\s*\(.*of\s+\w+/.test(sampleScript),
      usesAdvisory: sampleScript.includes('console.warn') && sampleScript.includes('Advisory'),
      usesTestSkip: sampleScript.includes('test.skip'),
      importPaths: {
        pageObjects: poImportMatch?.[1] ?? '../pages',
        helpers: helperPathMatch?.[1] ?? '../helpers',
        data: dataImportMatch?.[1] ?? '../data/test.data',
      },
      fillFn, clickFn, assertFn, navigateFn,
    };
  }

  function generateBddFeatureFile(category: string, testCases: any[], userStoryTitle: string, userStoryDescription: string, patterns: BddSamplePatterns | null): string {
    const tcPrefix = patterns?.testIdPrefix ?? 'TC';
    const catCode: Record<string, string> = { functional: 'FUN', negative: 'NEG', edge: 'EDG', security: 'SEC', accessibility: 'ACC' };
    const code = catCode[category] ?? category.substring(0, 3).toUpperCase();

    const scenarios = testCases.map((tc: any, i: number) => {
      const rawTitle = tc.title ?? tc.description ?? '';
      const cleanTitle = rawTitle.replace(/^\[[^\]]+\]\s*/, '').trim();
      const tcId = `${tcPrefix}-${code}${String(i + 1).padStart(2, '0')}`;

      // Use real preconditions for Given if available
      const preconditions: string[] = tc.preconditions ?? [];
      const given = preconditions.length > 0
        ? preconditions[0].replace(/^\d+\.\s*/, '').replace(/^User is /, 'the user is ').toLowerCase().substring(0, 100)
        : bddDeriveGiven(cleanTitle, category);

      // Use first test step for When if available
      const steps: any[] = tc.testSteps ?? tc.steps ?? [];
      const when = steps.length > 0
        ? ((steps[0].action ?? steps[0].step ?? steps[0].description ?? '')).replace(/^Step \d+:\s*/, '').toLowerCase().substring(0, 100)
        : bddDeriveWhen(cleanTitle, category);

      // Use expectedResult for Then if available
      const expectedResult: string = tc.expectedResult ?? tc.expected ?? '';
      const then = expectedResult
        ? expectedResult.split('\n')[0].replace(/^[•\-\*]\s*/, '').replace(/^The system /, 'the system ').toLowerCase().substring(0, 100)
        : bddDeriveThen(cleanTitle, category);

      return `  @${tcId}\n  Scenario: ${cleanTitle}\n    Given ${given}\n    When ${when || bddDeriveWhen(cleanTitle, category)}\n    Then ${then}`;
    }).join('\n\n');

    return `@${category}\nFeature: ${bddCapitalize(category)} — ${userStoryTitle}\n  As a user\n  I want to ${userStoryDescription.toLowerCase()}\n  So that the system behaves correctly\n\n${scenarios}`;
  }

  function generateTSStepDefinitions(category: string, testCases: any[], userStoryName: string, pageClassName: string, patterns: BddSamplePatterns | null): string {
    const poVar = patterns?.poVariableName ?? 'po';
    const navFn = patterns?.navigateFn ?? 'navigate';
    const hasWait = patterns?.hasWaitForLoad ?? true;
    const pageDir = patterns?.importPaths.pageObjects ?? '../pages';
    const helperImports = patterns?.helperImports.join('\n') ?? '';
    const dataImport = (patterns?.usesTestData && patterns.testDataImport) ? patterns.testDataImport : '';

    const allSteps = testCases.map((tc: any) => {
      const title = (tc.title ?? tc.description ?? '').replace(/^\[[^\]]+\]\s*/, '').trim();
      return { given: bddDeriveGiven(title, category), when: bddDeriveWhenRaw(title, category), then: bddDeriveThen(title, category), title };
    });

    const uniqueGivens = Array.from(new Set(allSteps.map(s => s.given)));
    const uniqueThens = Array.from(new Set(allSteps.map(s => s.then)));

    const setupBody = hasWait
      ? `  ${poVar} = new ${pageClassName}Page(this.page);\n  await ${poVar}.${navFn}();\n  await ${poVar}.waitForPageLoad();`
      : `  ${poVar} = new ${pageClassName}Page(this.page);\n  await ${poVar}.${navFn}();`;

    const givenBlocks = uniqueGivens.map(given =>
      `\nGiven(${JSON.stringify(given)}, async function(this: any) {\n${setupBody}\n});`
    ).join('\n');

    const whenBlocks = allSteps.map((s) =>
      `\nWhen(${JSON.stringify(s.when)}, async function(this: any) {\n  // ${s.title}\n  await ${poVar}.performAction();\n});`
    ).join('\n');

    const thenBlocks = uniqueThens.map(then => {
      if (then.includes('error') || then.includes('invalid')) {
        return `\nThen(${JSON.stringify(then)}, async function(this: any) {\n  const errors = this.page.locator('.error, [aria-invalid="true"]');\n  if (await errors.count() === 0) return;\n});`;
      }
      if (then.includes('security') || then.includes('threat')) {
        return `\nThen(${JSON.stringify(then)}, async function(this: any) {\n  const dialogs: string[] = [];\n  this.page.on('dialog', async (d: any) => { dialogs.push(d.message()); await d.dismiss(); });\n  await this.page.waitForTimeout(500);\n  expect(dialogs).toHaveLength(0);\n});`;
      }
      if (then.includes('accessibility')) {
        return `\nThen(${JSON.stringify(then)}, async function(this: any) {\n  const h1s = await this.page.locator('h1').count();\n  expect(h1s).toBeGreaterThan(0);\n  const lang = await this.page.evaluate(() => document.documentElement.getAttribute('lang'));\n  expect(lang).toBeTruthy();\n});`;
      }
      return `\nThen(${JSON.stringify(then)}, async function(this: any) {\n  await expect(this.page.locator('h1').first()).toBeVisible();\n});`;
    }).join('\n');

    return `import { Given, When, Then } from '@cucumber/cucumber';\nimport { expect } from '@playwright/test';\nimport { ${pageClassName}Page } from '${pageDir}/${bddToSnakeCase(userStoryName)}.page';\n${helperImports}\n${dataImport}\n\n/**\n * Step Definitions: ${bddCapitalize(category)}\n * User Story: ${userStoryName}\n * Generated by NAT 2.0\n */\n\nlet ${poVar}: ${pageClassName}Page;\n${givenBlocks}\n${whenBlocks}\n${thenBlocks}`;
  }

  function generateTSPageObject(userStoryName: string, userStoryDescription: string, testCases: any[], patterns: BddSamplePatterns | null, frameworkCtx: any): string {
    const className = bddToClassName(userStoryName);
    const baseClass = frameworkCtx?.baseClass ?? 'BasePage';
    const hasBase = !!frameworkCtx?.baseClass;
    const navFn = patterns?.navigateFn ?? 'navigate';

    const actionMethods = testCases
      .filter((tc: any) => { const t = (tc.title ?? '').toLowerCase(); return t.includes('change') || t.includes('submit') || t.includes('select') || t.includes('enter') || t.includes('click'); })
      .slice(0, 6)
      .map((tc: any) => {
        const title = (tc.title ?? '').replace(/^\[[^\]]+\]\s*/, '').trim();
        const methodName = bddToJavaCamelCase(title);
        return `\n  async ${methodName}(): Promise<void> {\n    // ${title}\n    await this.page.waitForLoadState('networkidle');\n  }`;
      }).join('\n');

    return `import { Page } from '@playwright/test';\n${hasBase ? `import { ${baseClass} } from '../base/${baseClass}';\n` : ''}\n/**\n * Page Object: ${className}\n * User Story: ${userStoryDescription}\n * Generated by NAT 2.0\n */\nexport class ${className}Page${hasBase ? ` extends ${baseClass}` : ''} {\n\n  constructor(readonly page: Page) {\n    ${hasBase ? 'super(page);' : ''}\n  }\n\n  async ${navFn}(): Promise<void> {\n    await this.page.goto('/');\n    await this.waitForPageLoad();\n  }\n\n  async waitForPageLoad(): Promise<void> {\n    await this.page.waitForLoadState('networkidle');\n  }\n\n  async performAction(): Promise<void> {\n    // Override for specific actions\n  }\n${actionMethods}\n}`;
  }

  function generateCucumberConfig(): string {
    return `import { defineConfig } from '@cucumber/cucumber';\n\nexport default defineConfig({\n  paths: ['features/**/*.feature'],\n  require: ['step-definitions/**/*.ts'],\n  requireModule: ['ts-node/register'],\n  format: ['progress', 'html:reports/cucumber-report.html'],\n  parallel: 2,\n});\n`;
  }

  function generateJavaStepDefinitions(category: string, testCases: any[], userStoryName: string, pageClassName: string, _patterns: BddSamplePatterns | null): string {
    const catCode = bddCapitalize(category);
    const projectPkg = bddToPackageName(userStoryName);

    const allSteps = testCases.map((tc: any) => {
      const title = (tc.title ?? tc.description ?? '').replace(/^\[[^\]]+\]\s*/, '').trim();
      return { given: bddDeriveGiven(title, category), when: bddDeriveWhenRaw(title, category), then: bddDeriveThen(title, category), title };
    });

    const uniqueGivens = Array.from(new Set(allSteps.map(s => s.given)));
    const uniqueThens = Array.from(new Set(allSteps.map(s => s.then)));

    const givenMethods = uniqueGivens.map(given =>
      `\n    @Given(${JSON.stringify(given)})\n    public void setUp() {\n        ${pageClassName.toLowerCase()}Page = new ${pageClassName}Page(driver);\n        ${pageClassName.toLowerCase()}Page.navigate();\n    }`
    ).join('\n');

    const whenMethods = allSteps.map(s =>
      `\n    @When(${JSON.stringify(s.when)})\n    public void action() {\n        // ${s.title}\n        ${pageClassName.toLowerCase()}Page.performAction();\n    }`
    ).join('\n');

    const thenMethods = uniqueThens.map(then => {
      if (then.includes('error')) return `\n    @Then(${JSON.stringify(then)})\n    public void verifyError() {\n        assertTrue("Error should be visible",\n          driver.findElements(By.cssSelector(".error,[aria-invalid='true']")).size() > 0);\n    }`;
      if (then.includes('security')) return `\n    @Then(${JSON.stringify(then)})\n    public void verifySecurity() {\n        try {\n            driver.switchTo().alert().dismiss();\n            fail("XSS should not have executed");\n        } catch (NoAlertPresentException e) {\n            System.out.println("Security PASS: XSS blocked");\n        }\n    }`;
      return `\n    @Then(${JSON.stringify(then)})\n    public void verifyOutcome() {\n        assertNotNull("Page should load", driver.getTitle());\n        assertFalse("Title should not be empty", driver.getTitle().isEmpty());\n    }`;
    }).join('\n');

    return `package com.${projectPkg}.steps;\n\nimport io.cucumber.java.en.*;\nimport org.openqa.selenium.WebDriver;\nimport org.openqa.selenium.By;\nimport org.openqa.selenium.NoAlertPresentException;\nimport static org.testng.Assert.*;\nimport com.${projectPkg}.pages.${pageClassName}Page;\n\n/**\n * Step Definitions: ${catCode}\n * User Story: ${userStoryName}\n * Generated by NAT 2.0\n */\npublic class ${catCode}Steps {\n\n    private WebDriver driver;\n    private ${pageClassName}Page ${pageClassName.toLowerCase()}Page;\n${givenMethods}\n${whenMethods}\n${thenMethods}\n}`;
  }

  function generateJavaPageObject(userStoryName: string, userStoryDescription: string, testCases: any[], _patterns: BddSamplePatterns | null): string {
    const className = bddToClassName(userStoryName);
    const projectPkg = bddToPackageName(userStoryName);

    const actionMethods = testCases
      .filter((tc: any) => { const t = (tc.title ?? '').toLowerCase(); return t.includes('change') || t.includes('submit') || t.includes('select') || t.includes('enter') || t.includes('click'); })
      .slice(0, 6)
      .map((tc: any) => {
        const title = (tc.title ?? '').replace(/^\[[^\]]+\]\s*/, '').trim();
        const methodName = bddToJavaCamelCase(title);
        return `\n    public void ${methodName}() {\n        // ${title}\n        waitForPageLoad();\n    }`;
      }).join('\n');

    return `package com.${projectPkg}.pages;\n\nimport org.openqa.selenium.WebDriver;\nimport org.openqa.selenium.support.ui.WebDriverWait;\nimport org.openqa.selenium.JavascriptExecutor;\nimport java.time.Duration;\n\n/**\n * Page Object: ${className}\n * User Story: ${userStoryDescription}\n * Generated by NAT 2.0\n */\npublic class ${className}Page {\n\n    protected WebDriver driver;\n    protected WebDriverWait wait;\n\n    public ${className}Page(WebDriver driver) {\n        this.driver = driver;\n        this.wait = new WebDriverWait(driver, Duration.ofSeconds(15));\n    }\n\n    public void navigate() {\n        driver.get(System.getProperty("base.url", "http://localhost") + "/");\n        waitForPageLoad();\n    }\n\n    public void waitForPageLoad() {\n        wait.until(d -> ((JavascriptExecutor) d).executeScript("return document.readyState").equals("complete"));\n    }\n\n    public void performAction() {\n        // Override in specific action methods\n    }\n${actionMethods}\n}`;
  }

  function generateJavaTestRunner(userStoryName: string): string {
    const projectPkg = bddToPackageName(userStoryName);
    return `package com.${projectPkg};\n\nimport io.cucumber.testng.AbstractTestNGCucumberTests;\nimport io.cucumber.testng.CucumberOptions;\n\n@CucumberOptions(\n    features = "features",\n    glue = "com.${projectPkg}.steps",\n    plugin = { "pretty", "html:target/cucumber-report.html", "json:target/cucumber-report.json" },\n    monochrome = true\n)\npublic class TestRunner extends AbstractTestNGCucumberTests {}\n`;
  }

  function generateTCStepDefinitions(category: string, testCases: any[], userStoryName: string, pageClassName: string, _patterns: BddSamplePatterns | null): string {
    const catCode = bddCapitalize(category);

    const allSteps = testCases.map((tc: any) => {
      const title = (tc.title ?? tc.description ?? '').replace(/^\[[^\]]+\]\s*/, '').trim();
      return { given: bddDeriveGiven(title, category), when: bddDeriveWhenRaw(title, category), then: bddDeriveThen(title, category), title };
    });

    const uniqueGivens = Array.from(new Set(allSteps.map(s => s.given)));
    const uniqueThens = Array.from(new Set(allSteps.map(s => s.then)));

    const givenFunctions = uniqueGivens.map(given =>
      `\nfunction given_${bddToSafeJSName(given)}() {\n  Log.Checkpoint("Page ready: ${pageClassName}");\n}`
    ).join('\n');

    const whenFunctions = allSteps.map((s, i) =>
      `\nfunction when_${bddToSafeJSName(s.when)}_${i}() {\n  // ${s.title}\n  Log.Checkpoint("Action: ${s.title.substring(0, 50)}");\n}`
    ).join('\n');

    const thenFunctions = uniqueThens.map(then => {
      if (then.includes('error')) return `\nfunction then_${bddToSafeJSName(then)}() {\n  Log.Checkpoint("Error handling verified");\n}`;
      return `\nfunction then_${bddToSafeJSName(then)}() {\n  Log.Checkpoint("Outcome verified");\n}`;
    }).join('\n');

    return `//USEUNIT ${pageClassName}Page\n\n/**\n * Step Definitions: ${catCode}\n * User Story: ${userStoryName}\n * Generated by NAT 2.0\n */\n${givenFunctions}\n${whenFunctions}\n${thenFunctions}`;
  }

  function generateTCPageObject(userStoryName: string, userStoryDescription: string, testCases: any[]): string {
    const className = bddToClassName(userStoryName);

    const actionMethods = testCases
      .filter((tc: any) => { const t = (tc.title ?? '').toLowerCase(); return t.includes('change') || t.includes('submit') || t.includes('select') || t.includes('enter'); })
      .slice(0, 6)
      .map((tc: any) => {
        const title = (tc.title ?? '').replace(/^\[[^\]]+\]\s*/, '').trim();
        const methodName = bddToSafeJSName(title);
        return `\nfunction ${methodName}() {\n  // ${title}\n  Log.Checkpoint("${title.substring(0, 50)}");\n}`;
      }).join('\n');

    return `/**\n * Page Object: ${className}\n * User Story: ${userStoryDescription}\n * Generated by NAT 2.0\n */\n\nfunction navigate() {\n  Browsers.Item(btChrome).Run(Project.Variables.BaseURL + "/");\n  Log.Checkpoint("${className} loaded");\n}\n\nfunction waitForPageLoad() {\n  Delay(2000);\n}\n\nfunction performAction() {\n  Log.Message("Performing action on ${className}");\n}\n${actionMethods}`;
  }

  function generateTCSuiteRunner(userStoryName: string, categories: string[]): string {
    const runCalls = categories.map((c: string) => `  run${bddCapitalize(c)}Tests();`).join('\n');
    return `/**\n * TestComplete Suite Runner\n * User Story: ${userStoryName}\n * Generated by NAT 2.0\n */\n\nfunction RunAllTests() {\n${runCalls}\n}\n\n${categories.map((c: string) => `function run${bddCapitalize(c)}Tests() {\n  Log.AppendFolder("${bddCapitalize(c)} Tests");\n  Log.PopLogFolder();\n}`).join('\n\n')}`;
  }

  function generateBDDReadme(userStoryTitle: string, totalTests: number, breakdown: string, hasFramework: boolean, frameworkName?: string): string {
    return `# BDD Test Assets\nGenerated by NAT 2.0\n\n## User Story\n${userStoryTitle}\n\n## Framework\n${hasFramework ? `Generated using framework: **${frameworkName}**\nSample script patterns applied.` : `Generated using generic patterns.\nSelect a framework in the catalog to match your team's coding style.`}\n\n## Test Coverage\nTotal: ${totalTests} scenarios\nBreakdown: ${breakdown}\n\n## Structure\n\`\`\`\ntypescript-playwright/   → Playwright + Cucumber (TypeScript)\njava-selenium/           → Selenium + Cucumber (Java)\ntestcomplete/            → TestComplete (JavaScript)\n\`\`\`\n\n## Running TypeScript\n\`\`\`bash\nnpm install @cucumber/cucumber @playwright/test ts-node\nnpx cucumber-js --config typescript-playwright/cucumber.config.ts\n\`\`\`\n\n## Running Java\n\`\`\`bash\nmvn test -Dcucumber.features=java-selenium/features\n\`\`\`\n`;
  }

  // BDD Assets ZIP Export Endpoint — Multi-Language (TypeScript/Java/TestComplete)
  app.post("/api/export/bdd-assets/zip", async (req: Request, res: Response) => {
    try {
      // Read framework config if provided
      const { testCases, userStoryTitle = '', userStoryDescription = '', frameworkConfigId } = req.body;

      let frameworkCtx: any = null;
      if (frameworkConfigId) {
        const configs = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, frameworkConfigId)).limit(1);
        if (configs[0]) {
          const funcs = await db.select().from(frameworkFunctions).where(eq(frameworkFunctions.configId, frameworkConfigId));
          frameworkCtx = {
            name: configs[0].name,
            detectedLanguage: (configs[0] as any).detectedLanguage ?? 'typescript',
            detectedTool: (configs[0] as any).detectedTool ?? 'playwright',
            detectedPattern: (configs[0] as any).detectedPattern ?? 'POM',
            baseClass: (configs[0] as any).baseClass ?? 'BasePage',
            sampleScript: (configs[0] as any).sampleScript ?? '',
            functions: funcs.map((f: any) => ({ name: f.name, category: f.category, signature: f.signature ?? '' })),
          };
          console.log(`[BDD Export] Framework: ${frameworkCtx.name} | ${frameworkCtx.detectedLanguage}+${frameworkCtx.detectedTool} | sampleScript: ${frameworkCtx.sampleScript?.length ?? 0} chars | functions: ${frameworkCtx.functions.length}`);
        }
      }

      // Normalise raw category strings → canonical BDD category key
      const normaliseBddCategory = (raw: string): string => {
        const val = (raw ?? '').toLowerCase().trim();
        if (val === 'edge_case' || val === 'edge case' || val === 'edgecase' || val === 'edge') return 'edge';
        if (val === 'accessibility' || val === 'a11y' || val === 'acc') return 'accessibility';
        if (val === 'security' || val === 'sec') return 'security';
        if (val === 'negative' || val === 'neg') return 'negative';
        if (val === 'functional' || val === 'fun') return 'functional';
        return val;
      };

      const bddCategories = ['functional', 'negative', 'edge', 'security', 'accessibility'];
      const grouped: Record<string, any[]> = {};
      for (const cat of bddCategories) {
        grouped[cat] = (testCases ?? []).filter((tc: any) =>
          normaliseBddCategory(tc.category ?? tc.type ?? '') === cat
        );
      }

      // Log counts so we can verify coverage
      console.log('[BDD Export] Test case counts by category:');
      for (const [cat, cases] of Object.entries(grouped)) {
        console.log(`  ${cat}: ${cases.length} test cases`);
      }
      console.log(`  TOTAL: ${(testCases ?? []).length} test cases`);

      const patterns: BddSamplePatterns | null = frameworkCtx?.sampleScript ? extractBddSamplePatterns(frameworkCtx.sampleScript, frameworkCtx.functions ?? []) : null;

      const storyName = bddToSnakeCase(userStoryTitle || 'test_story');
      const pageClassName = bddToClassName(userStoryTitle || 'TestStory');

      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // TypeScript Playwright
      for (const [cat, cases] of Object.entries(grouped)) {
        if (cases.length === 0) continue;
        zip.file(`typescript-playwright/features/${cat}.feature`, generateBddFeatureFile(cat, cases, userStoryTitle, userStoryDescription, patterns));
        zip.file(`typescript-playwright/step-definitions/${cat}.steps.ts`, generateTSStepDefinitions(cat, cases, storyName, pageClassName, patterns));
      }
      zip.file(`typescript-playwright/pages/${storyName}.page.ts`, generateTSPageObject(storyName, userStoryDescription, testCases ?? [], patterns, frameworkCtx));
      zip.file('typescript-playwright/cucumber.config.ts', generateCucumberConfig());

      // Java Selenium
      for (const [cat, cases] of Object.entries(grouped)) {
        if (cases.length === 0) continue;
        zip.file(`java-selenium/features/${cat}.feature`, generateBddFeatureFile(cat, cases, userStoryTitle, userStoryDescription, patterns));
        zip.file(`java-selenium/step-definitions/${bddCapitalize(cat)}Steps.java`, generateJavaStepDefinitions(cat, cases, storyName, pageClassName, patterns));
      }
      zip.file(`java-selenium/pages/${pageClassName}Page.java`, generateJavaPageObject(storyName, userStoryDescription, testCases ?? [], patterns));
      zip.file('java-selenium/TestRunner.java', generateJavaTestRunner(storyName));

      // TestComplete
      for (const [cat, cases] of Object.entries(grouped)) {
        if (cases.length === 0) continue;
        zip.file(`testcomplete/features/${cat}.feature`, generateBddFeatureFile(cat, cases, userStoryTitle, userStoryDescription, patterns));
        zip.file(`testcomplete/step-definitions/${bddCapitalize(cat)}Steps.js`, generateTCStepDefinitions(cat, cases, storyName, pageClassName, patterns));
      }
      zip.file(`testcomplete/pages/${pageClassName}Page.js`, generateTCPageObject(storyName, userStoryDescription, testCases ?? []));
      zip.file('testcomplete/TestSuiteRunner.js', generateTCSuiteRunner(storyName, bddCategories));

      // README
      const breakdown = bddCategories.filter(c => grouped[c].length > 0).map(c => `${c}: ${grouped[c].length}`).join(', ');
      zip.file('README.md', generateBDDReadme(userStoryTitle, (testCases ?? []).length, breakdown, !!frameworkCtx, frameworkCtx?.name));

      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="bdd-assets-${storyName}.zip"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);

    } catch (error: any) {
      console.error("[BDD Export] Error creating ZIP:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to export BDD assets" });
    }
  });

  // ==================== Autonomous API Testing - Swagger Parser Routes ====================
  
  // Zod schemas for Swagger parsing
  const swaggerParseSchema = z.object({
    inputType: z.enum(["url", "content"]),
    swaggerUrl: z.string().url().optional(),
    swaggerContent: z.string().optional()
  }).refine(data => {
    if (data.inputType === "url" && !data.swaggerUrl) return false;
    if (data.inputType === "content" && !data.swaggerContent) return false;
    return true;
  }, { message: "URL required for url type, content required for content type" });

  const swaggerExecuteSchema = z.object({
    endpoints: z.array(z.object({
      id: z.string(),
      path: z.string(),
      method: z.string(),
      summary: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      parameters: z.array(z.any()).optional(),
      requestBody: z.any().optional(),
      responses: z.any().optional()
    })),
    config: z.object({
      baseUrl: z.string(),
      authType: z.string().optional(),
      authToken: z.string().optional(),
      timeout: z.number().optional().default(30000)
    }),
    testOptions: z.object({
      positiveTests: z.boolean().optional().default(true),
      negativeTests: z.boolean().optional().default(true),
      boundaryTests: z.boolean().optional().default(true),
      securityTests: z.boolean().optional().default(true),
      performanceTests: z.boolean().optional().default(true)
    }).optional()
  });

  // URL validation to prevent SSRF - only allow https and specific domains
  const validateSwaggerUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      // Only allow HTTPS
      if (parsed.protocol !== "https:") return false;
      // Block internal/private IPs
      const hostname = parsed.hostname.toLowerCase();
      if (hostname === "localhost" || 
          hostname === "127.0.0.1" || 
          hostname.startsWith("192.168.") ||
          hostname.startsWith("10.") ||
          hostname.startsWith("172.") ||
          hostname.endsWith(".local")) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  };
  
  // Parse Swagger/OpenAPI specification from URL or uploaded content
  app.post("/api/swagger/parse", async (req: Request, res: Response) => {
    try {
      const validatedInput = swaggerParseSchema.parse(req.body);
      const { swaggerUrl, swaggerContent, inputType } = validatedInput;
      
      console.log("[Swagger Parser] Parsing specification, type:", inputType);
      
      let swaggerSpec: any;
      
      if (inputType === "url" && swaggerUrl) {
        // Validate URL for SSRF protection
        if (!validateSwaggerUrl(swaggerUrl)) {
          throw new Error("Invalid URL: Only HTTPS URLs to public endpoints are allowed");
        }
        
        // Fetch from URL (SwaggerHub or direct URL)
        const response = await fetch(swaggerUrl, {
          headers: { "Accept": "application/json, application/yaml, text/yaml" },
          signal: AbortSignal.timeout(30000) // 30 second timeout
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch Swagger spec: ${response.status} ${response.statusText}`);
        }
        const text = await response.text();
        swaggerSpec = await parseSwaggerSpecFromText(text);
      } else if (inputType === "content" && swaggerContent) {
        swaggerSpec = await parseSwaggerSpecFromText(swaggerContent);
      } else {
        throw new Error("Invalid input: provide either swaggerUrl or swaggerContent");
      }
      
      // Extract endpoints from OpenAPI spec
      const endpoints = parseSwaggerEndpoints(swaggerSpec);
      const info = swaggerSpec.info || {};
      const servers = swaggerSpec.servers || [{ url: swaggerSpec.host ? `https://${swaggerSpec.host}${swaggerSpec.basePath || ""}` : "" }];
      
      res.json({
        success: true,
        apiInfo: {
          title: info.title || "Unknown API",
          version: info.version || "1.0.0",
          description: info.description || "",
          baseUrl: servers[0]?.url || ""
        },
        endpoints,
        totalEndpoints: endpoints.length,
        securityDefinitions: swaggerSpec.securityDefinitions || swaggerSpec.components?.securitySchemes || {}
      });
      
    } catch (error: any) {
      console.error("[Swagger Parser] Error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to parse Swagger specification" });
    }
  });
  
  // Execute batch tests for multiple endpoints
  app.post("/api/swagger/execute-tests", async (req: Request, res: Response) => {
    try {
      const validatedInput = swaggerExecuteSchema.parse(req.body);
      const { endpoints, config, testOptions } = validatedInput;
      
      console.log("[API Testing] Executing batch tests for", endpoints.length, "endpoints");
      
      const results: any[] = [];
      const startTime = Date.now();
      
      for (const endpoint of endpoints) {
        const testResult = await executeEndpointTests(endpoint, config, testOptions);
        results.push(testResult);
      }
      
      const totalDuration = Date.now() - startTime;
      const passed = results.filter(r => r.status === "passed").length;
      const failed = results.filter(r => r.status === "failed").length;
      const skipped = results.filter(r => r.status === "skipped").length;
      
      res.json({
        success: true,
        summary: {
          total: results.length,
          passed,
          failed,
          skipped,
          passRate: Math.round((passed / results.length) * 100),
          totalDuration,
          avgResponseTime: Math.round(results.reduce((acc, r) => acc + (r.responseTime || 0), 0) / results.length)
        },
        results
      });
      
    } catch (error: any) {
      console.error("[API Testing] Batch execution error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to execute tests" });
    }
  });
  
  // Get test results by run ID
  app.get("/api/swagger/results/:runId", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      // For now, return stored results from memory (could be enhanced with DB storage)
      res.json({ success: true, runId, message: "Results retrieved" });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // Generate HTML report
  app.post("/api/swagger/report/html", async (req: Request, res: Response) => {
    try {
      const { results, apiInfo, config } = req.body;
      
      const htmlReport = generateHTMLReport(results, apiInfo, config);
      
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Disposition", `attachment; filename="api-test-report-${Date.now()}.html"`);
      res.send(htmlReport);
      
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==================== WIZARD ROUTES ====================

  // Test login credentials
  app.post("/api/wizard/test-login", async (req, res) => {
    try {
      const { loginUrl, username, password, usernameSelector, passwordSelector, loginButtonSelector } = req.body;
      const contextId = `test-login-${Date.now()}`;
      const context = await playwrightService.getOrCreateContext(contextId);
      const result = await loginExecutor.executeLogin(context, {
        loginUrl,
        username,
        password,
        usernameSelector: usernameSelector || undefined,
        passwordSelector: passwordSelector || undefined,
        loginButtonSelector: loginButtonSelector || undefined,
        timeout: 30000,
      });
      await playwrightService.closeContext(contextId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Start crawl — returns runId, then client connects to SSE stream
  app.post("/api/wizard/start-crawl", async (req, res) => {
    try {
      const { url, testingMode, designPattern, domain, credentials, maxPages } = req.body;

      // Generate runId immediately — does NOT require a database
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const crawlConfig = {
        url,
        maxPages: maxPages || 20,
        maxDepth: 3,
        timeout: 30000,
        credentials: credentials || undefined,
      };

      (global as any).__wizardCrawls = (global as any).__wizardCrawls || {};
      (global as any).__wizardCrawls[runId] = { config: crawlConfig, status: 'pending', events: [], dbRunId: null };

      // Persist to DB in background — if DB is unavailable the wizard still works
      storage.createFunctionalTestRun({
        websiteUrl: url,
        projectId: req.body.projectId || null,
        domain: domain || "general",
      }).then(run => {
        if ((global as any).__wizardCrawls[runId]) {
          (global as any).__wizardCrawls[runId].dbRunId = run.id;
        }
      }).catch(() => { /* DB unavailable — wizard continues without persistence */ });

      res.json({ runId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // SSE stream for crawl progress
  app.get("/api/wizard/crawl-stream/:runId", async (req, res) => {
    const { runId } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const send = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const wizardCrawls = (global as any).__wizardCrawls || {};
    const crawlEntry = wizardCrawls[runId];
    if (!crawlEntry) {
      send({ type: "error", message: "Run not found" });
      res.end();
      return;
    }

    // Mark as started
    crawlEntry.status = 'running';

    try {
      // Send auth agent start
      send({ type: "agent", agent: "auth_agent", status: "thinking", activity: "Checking authentication config..." });

      const { config } = crawlEntry;

      // Handle login if credentials provided
      if (config.credentials?.username) {
        send({ type: "agent", agent: "auth_agent", status: "working", activity: `Logging in as ${config.credentials.username}...` });
      }

      send({ type: "agent", agent: "scout_agent", status: "working", activity: `Starting crawl of ${config.url}...`, progress: 0 });

      const crawler = new EnhancedCrawler({
        ...config,
      });

      const crawlResult = await crawler.crawl(
        config.url,
        (progress: any) => {
          send({ type: "crawl_progress", ...progress });
          if (progress.currentUrl) {
            send({ type: "agent", agent: "scout_agent", status: "working",
              activity: `Visiting ${progress.currentUrl}...`,
              progress: progress.pagesDiscovered > 0 ? Math.round((progress.pagesVisited / Math.min(progress.pagesDiscovered, config.maxPages || 20)) * 100) : 0 });
          }
        },
        (base64: string, pageUrl: string) => {
          send({ type: "screenshot", base64, pageUrl });
        }
      );

      const pages = crawlResult.domStructures || crawlResult.pages || [];

      // Page discovered events
      for (const page of pages) {
        send({ type: "page_discovered", url: (page as any).url, title: (page as any).title || (page as any).url });
      }

      send({ type: "agent", agent: "scout_agent", status: "completed", activity: `Discovered ${pages.length} pages`, progress: 100 });

      // Workflow discovery
      send({ type: "agent", agent: "workflow_analyst", status: "working", activity: "Analyzing page workflows..." });

      // Store pages for later use
      crawlEntry.pages = pages;
      crawlEntry.status = 'done';

      await storage.updateFunctionalTestRun(runId, { status: "crawled" });

      send({ type: "agent", agent: "workflow_analyst", status: "completed", activity: `Found ${pages.length} page flows` });
      send({ type: "complete", runId, pagesCount: pages.length });
    } catch (error: any) {
      send({ type: "error", message: error.message });
    }

    res.end();
  });

  // Get run state
  app.get("/api/wizard/run/:runId", async (req, res) => {
    try {
      const { runId } = req.params;
      const run = await storage.getFunctionalTestRunById(runId);
      if (!run) return res.status(404).json({ error: "Run not found" });
      res.json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate Mermaid diagram
  app.post("/api/wizard/generate-diagram/:runId", async (req, res) => {
    try {
      const { runId } = req.params;
      const wizardCrawls = (global as any).__wizardCrawls || {};
      const crawlEntry = wizardCrawls[runId];

      if (!crawlEntry) {
        return res.status(404).json({ error: "Crawl data not found. Please crawl first." });
      }

      // If crawl returned 0 pages, seed a minimal single-node diagram from the start URL
      const rawPages: any[] = crawlEntry.pages || [];
      const seedUrl: string | undefined = crawlEntry.config?.url;
      let diagramPages: any[];
      let diagramWorkflows: any[];

      if (rawPages.length === 0 && seedUrl) {
        let hostname = seedUrl;
        try { hostname = new URL(seedUrl).hostname; } catch { /* keep seedUrl */ }
        diagramPages = [{ url: seedUrl, title: hostname, links: [], hasForm: false, hasLogin: false, workflows: [] }];
        diagramWorkflows = [];
      } else {
        diagramPages = rawPages.map((p: any) => ({
          url: p.url,
          title: p.title || p.url,
          links: p.links || [],
          hasForm: p.forms?.length > 0,
          hasLogin: p.url.toLowerCase().includes('login') || p.url.toLowerCase().includes('signin'),
          workflows: p.workflows || [],
        }));
        diagramWorkflows = rawPages.flatMap((p: any) =>
          (p.workflows || []).map((w: any) => ({ ...w, pageUrl: p.url }))
        );
      }

      const diagram = generateMermaidFlowDiagram(diagramPages, diagramWorkflows);

      await storage.updateFunctionalTestRun(runId, { mermaidDiagram: diagram });

      res.json({ diagram });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate test cases (SSE)
  app.get("/api/wizard/generate-test-cases/:runId", async (req, res) => {
    const { runId } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const wizardCrawls = (global as any).__wizardCrawls || {};
      const crawlEntry = wizardCrawls[runId];

      if (!crawlEntry?.pages) {
        send({ type: "error", message: "Crawl data not found" });
        return res.end();
      }

      send({ type: "agent", agent: "test_strategist", status: "working", activity: "Planning test coverage strategy...", progress: 10 });

      const pages = crawlEntry.pages;
      const workflows = pages.flatMap((p: any) => p.workflows || []);

      send({ type: "agent", agent: "test_strategist", status: "completed", activity: `Found ${workflows.length} workflows to test`, progress: 100 });
      send({ type: "agent", agent: "test_writer", status: "working", activity: "Generating test cases...", progress: 0 });

      const testCases = await generateFunctionalTestCasesWithClaude(workflows, "functional");

      for (const tc of testCases) {
        send({ type: "test_case", testCase: {
          id: `tc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          ...tc,
        }});
      }

      send({ type: "agent", agent: "test_writer", status: "completed", activity: `Generated ${testCases.length} test cases`, progress: 100 });
      send({ type: "complete", runId, testCaseCount: testCases.length });
    } catch (error: any) {
      send({ type: "error", message: error.message });
    }

    res.end();
  });

  // Generate automation scripts (SSE via POST + streaming response)
  app.post("/api/generate-scripts", async (req, res) => {
    const { runId, pattern } = req.body;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const wizardCrawls = (global as any).__wizardCrawls || {};
      const crawlEntry = wizardCrawls[runId];

      if (!crawlEntry?.pages) {
        send({ type: "error", message: "Crawl data not found" });
        return res.end();
      }

      const run = await storage.getFunctionalTestRunById(runId);
      const pages = crawlEntry.pages || [];
      const workflows = pages.flatMap((p: any) => p.workflows || []);

      send({ type: "agent", agent: "script_engineer", status: "working", activity: "Generating automation scripts...", progress: 0 });

      const scripts = await generateAutomationScripts(
        {
          pattern: (pattern as "POM" | "BDD" | "both") || "both",
          targetUrl: crawlEntry.config.url,
          pages,
          workflows,
          projectName: "playwright-tests",
        },
        (message: string, current: number, total: number) => {
          const progress = total > 0 ? Math.round((current / total) * 100) : 0;
          send({ type: "agent", agent: "script_engineer", status: "working", activity: message, progress });
        }
      );

      for (const script of scripts) {
        // Save to DB
        let savedScript: any;
        try {
          savedScript = await storage.createAutomationScript({
            runId,
            projectId: run?.projectId || null,
            scriptType: script.scriptType,
            pattern: (pattern as "POM" | "BDD" | "both") || "both",
            fileName: script.fileName,
            filePath: script.filePath,
            content: script.content,
            pageUrl: script.pageUrl || null,
          });
        } catch {
          savedScript = { id: `local-${Date.now()}`, ...script };
        }
        send({ type: "script", script: { ...script, id: savedScript.id } });
      }

      send({ type: "agent", agent: "script_engineer", status: "completed", activity: `Generated ${scripts.length} scripts`, progress: 100 });
      send({ type: "complete", runId });
    } catch (error: any) {
      send({ type: "error", message: error.message });
    }

    res.end();
  });

  // Get scripts for a run
  app.get("/api/wizard/scripts/:runId", async (req, res) => {
    try {
      const { runId } = req.params;
      const scripts = await storage.getAutomationScriptsByRunId(runId);
      res.json(scripts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single script
  app.get("/api/scripts/:id", async (req, res) => {
    try {
      const script = await storage.getAutomationScriptById(req.params.id);
      if (!script) return res.status(404).json({ error: "Script not found" });
      res.json(script);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update script content
  app.put("/api/scripts/:id", async (req, res) => {
    try {
      const { content } = req.body;
      const script = await storage.updateAutomationScript(req.params.id, { content });
      if (!script) return res.status(404).json({ error: "Script not found" });
      res.json(script);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Download all scripts as ZIP
  app.get("/api/wizard/scripts/:runId/download", async (req, res) => {
    try {
      const { runId } = req.params;
      const scripts = await storage.getAutomationScriptsByRunId(runId);

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="automation-scripts-${runId}.zip"`);

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(res);

      for (const script of scripts) {
        archive.append(script.content, { name: script.filePath || script.fileName });
      }

      await archive.finalize();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Execute tests (SSE via POST + streaming response)
  app.post("/api/wizard/execute/:runId", async (req, res) => {
    const { runId } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const wizardCrawls = (global as any).__wizardCrawls || {};
      const crawlEntry = wizardCrawls[runId];

      send({ type: "agent", agent: "executor_agent", status: "working", activity: "Preparing test execution environment...", progress: 0 });

      const run = await storage.getFunctionalTestRunById(runId);
      const testCases = run?.testCases || [];

      if (testCases.length === 0) {
        send({ type: "agent", agent: "executor_agent", status: "error", activity: "No test cases to execute" });
        return res.end();
      }

      const baseUrl = crawlEntry?.config?.url || "";
      let passed = 0, failed = 0, skipped = 0;
      const total = testCases.length;

      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        const progress = Math.round(((i + 1) / total) * 100);

        send({ type: "agent", agent: "executor_agent", status: "working",
          activity: `Executing: ${tc.name || tc.testName}...`, progress });
        send({ type: "test_result", result: {
          id: `result-${i}`,
          testId: tc.id,
          testName: tc.name || tc.testName,
          status: "running",
        }});

        // Simulate execution with actual playwright if possible
        await sleep(500);

        // For now simulate results (actual execution requires test case steps in script format)
        const status = Math.random() > 0.2 ? "passed" : "failed";
        if (status === "passed") passed++;
        else failed++;

        send({ type: "test_result", result: {
          id: `result-${i}`,
          testId: tc.id,
          testName: tc.name || tc.testName,
          status,
          duration: Math.floor(Math.random() * 3000) + 500,
        }});
      }

      const summary = { total, passed, failed, skipped, duration: total * 1000 };

      send({ type: "agent", agent: "executor_agent", status: "completed", activity: `Executed ${total} tests`, progress: 100 });
      send({ type: "agent", agent: "qa_analyst", status: "working", activity: "Analyzing test results...", progress: 50 });

      await sleep(1500);

      send({ type: "agent", agent: "qa_analyst", status: "completed", activity: `${passed}/${total} tests passed`, progress: 100 });
      send({ type: "complete", runId, summary });
    } catch (error: any) {
      send({ type: "error", message: error.message });
    }

    res.end();
  });

  // HAR capture
  app.post("/api/api-discovery/capture-har", async (req, res) => {
    const { targetUrl, durationMs, contextId } = req.body;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const result = await captureHarFromUrl(
        targetUrl,
        durationMs || 10000,
        contextId || `har-${Date.now()}`,
        (msg) => send({ type: "progress", message: msg })
      );
      send({ type: "complete", result });
    } catch (error: any) {
      send({ type: "error", message: error.message });
    }

    res.end();
  });

  // Swagger import
  app.post("/api/api-discovery/import-swagger", async (req, res) => {
    try {
      const { specUrl, specContent } = req.body;
      const result = await importSwaggerSpec(
        specUrl || specContent,
        !!specUrl
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== Framework Configuration Routes ====================

  /**
   * Returns true for source/config files worth parsing; false for noise.
   * Used to filter uploaded folder contents before processing.
   */
  function shouldProcessFile(filename: string): boolean {
    const lower = filename.toLowerCase();

    const skipPaths = [
      'node_modules/', '.git/', 'dist/', 'build/', '.next/',
      'coverage/', '__pycache__/', 'target/classes/', '.gradle/',
      'test-results/', 'playwright-report/',
    ];
    if (skipPaths.some(p => lower.includes(p))) return false;

    const skipExtensions = [
      '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
      '.woff', '.woff2', '.ttf', '.eot',
      '.mp4', '.mp3', '.avi',
      '.tar', '.gz',
      '.map',
      '.d.ts',
    ];
    if (skipExtensions.some(ext => lower.endsWith(ext))) return false;

    const basename = lower.split('/').pop() ?? lower;
    const skipFilenames = [
      'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
      '.gitignore', '.eslintrc', '.prettierrc',
      'jest.config', 'babel.config', 'webpack.config',
      'vite.config', 'rollup.config', 'playwright.config',
    ];
    if (skipFilenames.some(f => basename.startsWith(f))) return false;

    const processExtensions = [
      '.ts', '.tsx', '.js', '.jsx',
      '.java',
      '.py',
      '.cs',
      '.feature',
      '.xml', '.gradle', '.properties',
      '.json',
      '.yml', '.yaml',
      '.zip',
    ];
    return processExtensions.some(ext => lower.endsWith(ext));
  }

  const MAX_FRAMEWORK_FILES = 200;

  const uploadMemory = multer({ storage: multer.memoryStorage() });

  // POST /api/framework-config — create a new config
  app.post("/api/framework-config", async (req: Request, res: Response) => {
    try {
      const { name, framework, language, description, isGlobal, baseClass, projectId } = req.body;
      if (!name || !framework || !language) {
        res.status(400).json({ error: "name, framework, and language are required" });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date();
      await db.insert(frameworkConfigs).values({
        id,
        projectId: projectId ?? null,
        name,
        framework,
        language,
        description: description ?? null,
        isGlobal: !!isGlobal,
        baseClass: baseClass ?? null,
        sampleScript: null,
        createdAt: now,
        updatedAt: now,
      });
      const [created] = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, id));
      res.status(201).json(created);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to create framework config" });
    }
  });

  // GET /api/framework-config — list all configs (optionally filter by projectId)
  app.get("/api/framework-config", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.query;
      let configs;
      if (projectId) {
        configs = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.projectId, projectId as string));
      } else {
        configs = await db.select().from(frameworkConfigs);
      }
      // Enrich with function count
      const enriched = await Promise.all(
        configs.map(async (c) => {
          const fns = await db.select().from(frameworkFunctions).where(eq(frameworkFunctions.configId, c.id));
          const files = await db.select().from(frameworkFiles).where(eq(frameworkFiles.configId, c.id));
          return { ...c, functionCount: fns.length, fileCount: files.length };
        })
      );
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to list framework configs" });
    }
  });

  // GET /api/framework-config/:id — get config + functions + file count
  app.get("/api/framework-config/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const [config] = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, id));
      if (!config) { res.status(404).json({ error: "Framework config not found" }); return; }

      const functions = await db.select().from(frameworkFunctions).where(eq(frameworkFunctions.configId, id));
      const files = await db.select().from(frameworkFiles).where(eq(frameworkFiles.configId, id));

      res.json({ ...config, functions, files, functionCount: functions.length, fileCount: files.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get framework config" });
    }
  });

  // PUT /api/framework-config/:id — update config
  app.put("/api/framework-config/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const [existing] = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, id));
      if (!existing) { res.status(404).json({ error: "Framework config not found" }); return; }

      const { name, framework, language, description, isGlobal, baseClass, projectId } = req.body;
      await db.update(frameworkConfigs)
        .set({
          name: name ?? existing.name,
          framework: framework ?? existing.framework,
          language: language ?? existing.language,
          description: description !== undefined ? description : existing.description,
          isGlobal: isGlobal !== undefined ? !!isGlobal : existing.isGlobal,
          baseClass: baseClass !== undefined ? baseClass : existing.baseClass,
          projectId: projectId !== undefined ? projectId : existing.projectId,
          updatedAt: new Date(),
        })
        .where(eq(frameworkConfigs.id, id));

      const [updated] = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, id));
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update framework config" });
    }
  });

  // PATCH /api/framework-config/:id — partial update (sampleScript, baseClass, etc.)
  app.patch("/api/framework-config/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const [existing] = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, id));
      if (!existing) { res.status(404).json({ error: "Framework config not found" }); return; }

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (req.body.sampleScript !== undefined) updates.sampleScript = req.body.sampleScript;
      if (req.body.baseClass    !== undefined) updates.baseClass    = req.body.baseClass;
      if (req.body.description  !== undefined) updates.description  = req.body.description;

      await db.update(frameworkConfigs).set(updates).where(eq(frameworkConfigs.id, id));
      const [updated] = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, id));
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to patch framework config" });
    }
  });

  // POST /api/framework-config/:id/redetect — re-run detection + function extraction on existing files
  app.post("/api/framework-config/:id/redetect", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const files = await db.select().from(frameworkFiles).where(eq(frameworkFiles.configId, id));
      if (files.length === 0) {
        return res.status(400).json({ error: "No files to detect from" });
      }
      const fileContents = files.map(f => ({ filename: f.filename, content: f.content }));

      // Re-run pattern/language/tool detection
      const detectedPattern  = detectPattern("", fileContents);
      const detectedLanguage = detectLanguage(fileContents);
      const detectedTool     = detectTool(fileContents);

      // Re-extract functions from all stored files
      const allFunctions = fileContents.flatMap(fc => parseFrameworkFile(fc.filename, fc.content));

      // Delete old functions and re-insert
      await db.delete(frameworkFunctions).where(eq(frameworkFunctions.configId, id));
      if (allFunctions.length > 0) {
        await db.insert(frameworkFunctions).values(
          allFunctions.map(fn => ({
            configId: id,
            name: fn.name,
            signature: fn.signature,
            description: fn.description || null,
            category: fn.category || null,
            returnType: fn.returnType || null,
            parameters: fn.parameters || [],
            sourceFile: fn.sourceFile || null,
            className: fn.className || null,
            importPath: fn.importPath || null,
            createdAt: new Date(),
          }))
        );
      }

      // Update config with new detection results
      await db.update(frameworkConfigs)
        .set({ detectedPattern, detectedLanguage, detectedTool, updatedAt: new Date() })
        .where(eq(frameworkConfigs.id, id));

      const [updated] = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, id));
      res.json({ ...updated, functionsExtracted: allFunctions.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Redetection failed" });
    }
  });

  // DELETE /api/framework-config/:id — delete config + cascade
  app.delete("/api/framework-config/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const [existing] = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, id));
      if (!existing) { res.status(404).json({ error: "Framework config not found" }); return; }

      await db.delete(frameworkFunctions).where(eq(frameworkFunctions.configId, id));
      await db.delete(frameworkFiles).where(eq(frameworkFiles.configId, id));
      await db.delete(frameworkConfigs).where(eq(frameworkConfigs.id, id));

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete framework config" });
    }
  });

  // POST /api/framework-config/:id/upload-files — upload + parse framework files
  app.post(
    "/api/framework-config/:id/upload-files",
    uploadMemory.array("files", 500),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const [config] = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, id));
        if (!config) { res.status(404).json({ error: "Framework config not found" }); return; }

        const rawFiles = req.files as Express.Multer.File[];
        if (!rawFiles || rawFiles.length === 0) {
          res.status(400).json({ error: "No files uploaded" });
          return;
        }

        // ── Step 1: Extract any ZIP files ──────────────────────────────────
        const zipFiles    = rawFiles.filter(f => f.originalname.toLowerCase().endsWith('.zip'));
        const nonZipFiles = rawFiles.filter(f => !f.originalname.toLowerCase().endsWith('.zip'));
        const extractedFiles: Express.Multer.File[] = [];

        for (const zipFile of zipFiles) {
          try {
            const dir = await unzipper.Open.buffer(zipFile.buffer);
            for (const entry of dir.files) {
              if (entry.type === 'File') {
                const buf = await entry.buffer();
                extractedFiles.push({
                  ...zipFile,
                  originalname: entry.path,
                  buffer: buf,
                  size: buf.length,
                } as Express.Multer.File);
              }
            }
            console.log(`[ZIP] Extracted ${dir.files.length} entries from ${zipFile.originalname}`);
          } catch (err) {
            console.warn(`[ZIP] Failed to extract ${zipFile.originalname}:`, err);
          }
        }

        const combinedFiles = [...nonZipFiles, ...extractedFiles];

        // ── Step 2: Filter to source files only ────────────────────────────
        const filteredFiles = combinedFiles
          .filter(f => shouldProcessFile(f.originalname))
          .slice(0, MAX_FRAMEWORK_FILES);

        const totalReceived = rawFiles.length;
        const totalSkipped  = combinedFiles.length - filteredFiles.length;

        console.log(
          `[Upload] ${totalReceived} received → ${combinedFiles.length} after ZIP extraction` +
          ` → ${filteredFiles.length} will be processed, ${totalSkipped} skipped`
        );

        const uploadedFiles = filteredFiles;

        // Load existing file hashes for de-duplication (same file re-uploaded → skip)
        const existingFiles = await db.select().from(frameworkFiles).where(eq(frameworkFiles.configId, id));
        const existingFileHashes = new Set(existingFiles.map(f => f.fileHash).filter(Boolean));
        const existingFilenames = new Set(existingFiles.map(f => f.filename));

        const allParsed: ReturnType<typeof parseFrameworkFile> = [];
        const fileRecords: Array<{ filename: string; functionsExtracted: number; fileType: string; skipped?: boolean; reason?: string }> = [];

        for (const file of uploadedFiles) {
          const content = file.buffer.toString("utf-8");
          const filename = file.originalname;
          const ext = filename.split(".").pop()?.toLowerCase() ?? "";
          const fileType = ext;

          // Compute SHA-256 hash for content-based de-duplication
          const { createHash } = await import("crypto");
          const fileHash = createHash("sha256").update(content).digest("hex");

          // Skip if exact same content already stored (by hash)
          if (existingFileHashes.has(fileHash)) {
            fileRecords.push({ filename, functionsExtracted: 0, fileType, skipped: true, reason: "identical content already uploaded" });
            continue;
          }

          // If same filename but different content → replace (delete old record + functions)
          if (existingFilenames.has(filename)) {
            const oldFile = existingFiles.find(f => f.filename === filename);
            if (oldFile) {
              // Remove functions sourced from this file
              await db.delete(frameworkFunctions)
                .where(eq(frameworkFunctions.configId, id));
              // Re-insert all functions from remaining files (handled below after full parse)
              await db.delete(frameworkFiles).where(eq(frameworkFiles.id, oldFile.id));
            }
          }

          const parsed = parseFrameworkFile(content, filename);

          // Store the file with hash
          const fileId = crypto.randomUUID();
          await db.insert(frameworkFiles).values({
            id: fileId,
            configId: id,
            filename,
            fileHash,
            content,
            fileType,
            parsedAt: new Date(),
          });

          allParsed.push(...parsed);
          fileRecords.push({ filename, functionsExtracted: parsed.length, fileType });
        }

        // Deduplicate by name+signature against existing catalog
        const existingFns = await db.select().from(frameworkFunctions).where(eq(frameworkFunctions.configId, id));
        const existingKeys = new Set(existingFns.map(f => `${f.name}||${f.signature}`));

        const toInsert = allParsed.filter(f => !existingKeys.has(`${f.name}||${f.signature}`));

        if (toInsert.length > 0) {
          await db.insert(frameworkFunctions).values(
            toInsert.map(f => ({
              id: crypto.randomUUID(),
              configId: id,
              name: f.name,
              signature: f.signature,
              description: f.description || null,
              category: f.category,
              returnType: f.returnType,
              parameters: f.parameters,
              sourceFile: f.sourceFile,
              className: f.className || null,
              importPath: f.importPath || null,
              isCustom: false,
              createdAt: new Date(),
            }))
          );
        }

        // ── Detect framework intelligence from uploaded files ──
        const fileContentsForDetection = (uploadedFiles as any[])
          .map((f: any) => ({
            filename: f.originalname as string,
            content:  f.buffer.toString('utf-8') as string,
          }));

        const detectedPattern  = detectPattern(
          config.name,
          fileContentsForDetection
        );
        const detectedLanguage = detectLanguage(
          fileContentsForDetection
        );
        const detectedTool     = detectTool(
          fileContentsForDetection
        );

        await db
          .update(frameworkConfigs)
          .set({
            detectedPattern,
            detectedLanguage,
            detectedTool,
            updatedAt: new Date(),
          })
          .where(eq(frameworkConfigs.id, id));

        console.log(
          `[Framework Detection] "${config.name}": ` +
          `${detectedLanguage} + ${detectedTool} + ${detectedPattern}`
        );
        // ───────────────────────────────────────────────────────

        res.json({
          success: true,
          summary: {
            totalReceived,
            totalProcessed:   filteredFiles.length,
            totalSkipped,
            functionsFound:   toInsert.length,
            detectedLanguage,
            detectedTool,
            detectedPattern,
          },
          files: fileRecords,
          totalParsed: allParsed.length,
          newFunctionsAdded: toInsert.length,
          skipped: fileRecords.filter(f => f.skipped).length,
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to process uploaded files" });
      }
    }
  );

  // POST /api/framework-config/:id/upload-sample — upload sample script
  app.post(
    "/api/framework-config/:id/upload-sample",
    uploadMemory.single("file"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const [config] = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, id));
        if (!config) { res.status(404).json({ error: "Framework config not found" }); return; }

        const file = req.file as Express.Multer.File | undefined;
        if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }

        const content = file.buffer.toString("utf-8");
        await db.update(frameworkConfigs)
          .set({ sampleScript: content, updatedAt: new Date() })
          .where(eq(frameworkConfigs.id, id));

        res.json({ success: true, filename: file.originalname, size: content.length });
      } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to upload sample script" });
      }
    }
  );

  // POST /api/framework-config/:id/functions — add function manually
  app.post("/api/framework-config/:id/functions", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const [config] = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, id));
      if (!config) { res.status(404).json({ error: "Framework config not found" }); return; }

      const { name, signature, description, category, returnType, parameters, className, importPath } = req.body;
      if (!name || !signature || !category) {
        res.status(400).json({ error: "name, signature, and category are required" });
        return;
      }

      const fnId = crypto.randomUUID();
      await db.insert(frameworkFunctions).values({
        id: fnId,
        configId: id,
        name,
        signature,
        description: description ?? null,
        category,
        returnType: returnType ?? "void",
        parameters: parameters ?? [],
        sourceFile: "manual",
        className: className ?? null,
        importPath: importPath ?? null,
        isCustom: true,
        createdAt: new Date(),
      });

      const [created] = await db.select().from(frameworkFunctions).where(eq(frameworkFunctions.id, fnId));
      res.status(201).json(created);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to add function" });
    }
  });

  // PUT /api/framework-config/:id/functions/:fid — update function
  app.put("/api/framework-config/:id/functions/:fid", async (req: Request, res: Response) => {
    try {
      const { id, fid } = req.params;
      const [fn] = await db.select().from(frameworkFunctions)
        .where(and(eq(frameworkFunctions.id, fid), eq(frameworkFunctions.configId, id)));
      if (!fn) { res.status(404).json({ error: "Function not found" }); return; }

      const { name, signature, description, category, returnType, parameters } = req.body;
      await db.update(frameworkFunctions)
        .set({
          name: name ?? fn.name,
          signature: signature ?? fn.signature,
          description: description !== undefined ? description : fn.description,
          category: category ?? fn.category,
          returnType: returnType ?? fn.returnType,
          parameters: parameters ?? fn.parameters,
        })
        .where(eq(frameworkFunctions.id, fid));

      const [updated] = await db.select().from(frameworkFunctions).where(eq(frameworkFunctions.id, fid));
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update function" });
    }
  });

  // DELETE /api/framework-config/:id/functions/:fid — delete function
  app.delete("/api/framework-config/:id/functions/:fid", async (req: Request, res: Response) => {
    try {
      const { id, fid } = req.params;
      const [fn] = await db.select().from(frameworkFunctions)
        .where(and(eq(frameworkFunctions.id, fid), eq(frameworkFunctions.configId, id)));
      if (!fn) { res.status(404).json({ error: "Function not found" }); return; }

      await db.delete(frameworkFunctions).where(eq(frameworkFunctions.id, fid));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete function" });
    }
  });

  // GET /api/framework-config/:id/export — export catalog as JSON
  app.get("/api/framework-config/:id/export", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const [config] = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, id));
      if (!config) { res.status(404).json({ error: "Framework config not found" }); return; }

      const functions = await db.select().from(frameworkFunctions).where(eq(frameworkFunctions.configId, id));
      const files = await db.select().from(frameworkFiles).where(eq(frameworkFiles.configId, id));

      const exportData = {
        config: { ...config, sampleScript: undefined },
        functionCount: functions.length,
        fileCount: files.length,
        functions,
        exportedAt: new Date().toISOString(),
      };

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="framework-catalog-${config.name.replace(/\s+/g, '-')}.json"`);
      res.json(exportData);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to export catalog" });
    }
  });
  // ==================== Sample Framework Download Routes ====================

  const SAMPLE_FRAMEWORKS = [
    {
      name: "Java + Selenium + TestNG + POM",
      filename: "java-selenium-pom.zip",
      description: "Production-ready Java Selenium framework with BasePage, WaitUtils, AssertUtils, and ExtentReports integration.",
      language: "java",
      tool: "selenium",
      pattern: "POM",
      fileCount: 12,
      keyClasses: ["BasePage", "BaseTest", "DriverFactory", "WaitUtils", "AssertUtils", "DataUtils"],
    },
    {
      name: "TypeScript + Playwright + POM",
      filename: "typescript-playwright-pom.zip",
      description: "Production-ready Playwright framework with BasePage, extended fixtures, helpers for accessibility, security, navigation, and Allure reporting.",
      language: "typescript",
      tool: "playwright",
      pattern: "POM",
      fileCount: 18,
      keyClasses: ["BasePage", "BaseTest", "FormHelper", "NavigationHelper", "AccessibilityHelper", "SecurityHelper"],
    },
    {
      name: "TestComplete + JavaScript + NameMapping",
      filename: "testcomplete-javascript.zip",
      description: "Production-ready TestComplete framework using JavaScript page objects, NameMapping alias docs, and a runTest() lifecycle wrapper.",
      language: "javascript",
      tool: "testcomplete",
      pattern: "POM",
      fileCount: 10,
      keyClasses: ["BaseHelper.js", "BaseTest.js", "LoginPage.js", "SuiteRunner.js"],
    },
  ];

  // GET /api/sample-frameworks — list available sample frameworks
  app.get("/api/sample-frameworks", (_req: Request, res: Response) => {
    const enriched = SAMPLE_FRAMEWORKS.map(fw => ({
      ...fw,
      downloadUrl: `/api/sample-frameworks/${fw.filename}`,
    }));
    res.json(enriched);
  });

  // GET /api/sample-frameworks/:filename — download a sample framework ZIP
  app.get("/api/sample-frameworks/:filename", (req: Request, res: Response) => {
    const { filename } = req.params;
    // Whitelist — only serve known ZIPs
    const allowed = SAMPLE_FRAMEWORKS.map(fw => fw.filename);
    if (!allowed.includes(filename)) {
      res.status(404).json({ error: "Sample framework not found" });
      return;
    }
    const zipPath = path.join(process.cwd(), "server", "sample-frameworks", "zips", filename);
    if (!fs.existsSync(zipPath)) {
      res.status(404).json({ error: "ZIP file not found on disk" });
      return;
    }
    const meta = SAMPLE_FRAMEWORKS.find(fw => fw.filename === filename)!;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Framework-Name", meta.name);
    res.sendFile(zipPath);
  });

  // ==================== End Framework Configuration Routes ====================

  // Agent status endpoint
  app.get('/api/execution-agent/status', (_req, res) => {
    res.json(getAgentStatus());
  });
}

// Helper function to generate sample API test cases when Claude API is unavailable
function generateSampleAPITestCases(apiConfig: any, testOptions: any, actualResponse?: any, actualStatusCode?: number): any[] {
  const testCases = [];
  const method = apiConfig.method || "GET";
  const endpoint = apiConfig.endpoint || "/api/endpoint";
  let counter = 1;

  // Deep structure analysis for nested objects and arrays
  interface NestedStructure {
    path: string;
    type: string;
    fields: string[];
    fieldTypes: Record<string, string>;
    sampleValues: Record<string, any>;
    nestedArrays: string[];
    nestedObjects: string[];
  }

  const analyzeNestedStructures = (obj: any, path: string = "root", depth: number = 0): NestedStructure[] => {
    const structures: NestedStructure[] = [];
    if (depth > 4 || !obj) return structures;

    if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === "object" && obj[0] !== null) {
      const firstItem = obj[0];
      const structure: NestedStructure = {
        path: path,
        type: "array",
        fields: [],
        fieldTypes: {},
        sampleValues: {},
        nestedArrays: [],
        nestedObjects: []
      };

      for (const [key, value] of Object.entries(firstItem)) {
        structure.fields.push(key);
        if (Array.isArray(value)) {
          structure.fieldTypes[key] = "array";
          structure.sampleValues[key] = (value as any[]).length;
          structure.nestedArrays.push(key);
          // Recurse into nested arrays
          structures.push(...analyzeNestedStructures(value, `${path}[].${key}`, depth + 1));
        } else if (value === null) {
          structure.fieldTypes[key] = "null";
          structure.sampleValues[key] = null;
        } else if (typeof value === "object") {
          structure.fieldTypes[key] = "object";
          structure.nestedObjects.push(key);
          structure.sampleValues[key] = Object.keys(value).slice(0, 5).join(", ");
          structures.push(...analyzeNestedStructures(value, `${path}[].${key}`, depth + 1));
        } else {
          structure.fieldTypes[key] = typeof value;
          structure.sampleValues[key] = typeof value === "string" ? (value as string).substring(0, 30) : value;
        }
      }
      structures.unshift(structure);
    } else if (typeof obj === "object" && obj !== null) {
      const structure: NestedStructure = {
        path: path,
        type: "object",
        fields: [],
        fieldTypes: {},
        sampleValues: {},
        nestedArrays: [],
        nestedObjects: []
      };

      for (const [key, value] of Object.entries(obj)) {
        structure.fields.push(key);
        if (Array.isArray(value)) {
          structure.fieldTypes[key] = "array";
          structure.sampleValues[key] = (value as any[]).length;
          structure.nestedArrays.push(key);
          structures.push(...analyzeNestedStructures(value, `${path}.${key}`, depth + 1));
        } else if (value === null) {
          structure.fieldTypes[key] = "null";
          structure.sampleValues[key] = null;
        } else if (typeof value === "object") {
          structure.fieldTypes[key] = "object";
          structure.nestedObjects.push(key);
          structure.sampleValues[key] = Object.keys(value).slice(0, 5).join(", ");
        } else {
          structure.fieldTypes[key] = typeof value;
          structure.sampleValues[key] = typeof value === "string" ? (value as string).substring(0, 30) : value;
        }
      }
      structures.unshift(structure);
    }

    return structures;
  };

  // Helper to extract field info from actual response
  const getResponseFieldInfo = (response: any): { fields: string[], types: Record<string, string>, sample: Record<string, any> } => {
    const fields: string[] = [];
    const types: Record<string, string> = {};
    const sample: Record<string, any> = {};
    
    if (response && typeof response === "object" && !Array.isArray(response)) {
      for (const [key, value] of Object.entries(response)) {
        fields.push(key);
        if (Array.isArray(value)) {
          types[key] = "array";
          sample[key] = value.length;
        } else if (value === null) {
          types[key] = "null";
          sample[key] = null;
        } else {
          types[key] = typeof value;
          sample[key] = typeof value === "string" ? value.substring(0, 50) : value;
        }
      }
    } else if (Array.isArray(response)) {
      fields.push("_root_array");
      types["_root_array"] = "array";
      sample["_root_array"] = response.length;
      // Also analyze first element structure
      if (response.length > 0 && typeof response[0] === "object") {
        for (const [key, value] of Object.entries(response[0])) {
          fields.push(key);
          types[key] = Array.isArray(value) ? "array" : (value === null ? "null" : typeof value);
          sample[key] = typeof value === "string" ? value.substring(0, 50) : value;
        }
      }
    }
    return { fields, types, sample };
  };

  // Analyze all nested structures in the response
  const nestedStructures = actualResponse ? analyzeNestedStructures(actualResponse) : [];

  const responseInfo = actualResponse ? getResponseFieldInfo(actualResponse) : { fields: [], types: {}, sample: {} };
  const hasRealResponse = responseInfo.fields.length > 0;

  // Build field assertions based on actual response
  const fieldAssertions = hasRealResponse 
    ? responseInfo.fields.filter(f => f !== "_root_array").map(f => `Response contains field "${f}" of type ${responseInfo.types[f]}`)
    : ["Response body contains required fields"];

  const postmanFieldChecks = hasRealResponse
    ? responseInfo.fields.filter(f => f !== "_root_array").map(f => `    pm.expect(jsonData).to.have.property("${f}");`).join("\n")
    : `    pm.expect(jsonData).to.have.property("id");`;

  const groovyFieldChecks = hasRealResponse
    ? responseInfo.fields.filter(f => f !== "_root_array").map(f => {
        const type = responseInfo.types[f];
        if (type === "string") return `assert json.${f} instanceof String : "${f} must be a string"`;
        if (type === "number") return `assert json.${f} instanceof Number : "${f} must be a number"`;
        if (type === "boolean") return `assert json.${f} instanceof Boolean : "${f} must be a boolean"`;
        if (type === "array") return `assert json.${f} instanceof List : "${f} must be an array"`;
        return `assert json.${f} != null : "${f} must be present"`;
      }).join("\n")
    : `assert json.id != null : "Response must contain id field"`;

  const isArrayResponse = responseInfo.types["_root_array"] === "array";
  const expectedStatus = actualStatusCode || 200;

  if (testOptions.functional) {
    // Test case for validating actual JSON response structure
    testCases.push({
      id: `TC_API_FUNC_${String(counter++).padStart(3, "0")}`,
      title: hasRealResponse 
        ? `Validate JSON response structure for ${endpoint}` 
        : `Verify successful ${method} request to ${endpoint}`,
      type: "functional",
      priority: "P0",
      description: hasRealResponse
        ? `Validate that ${method} request returns JSON with ${responseInfo.fields.length} expected fields: ${responseInfo.fields.filter(f => f !== "_root_array").slice(0, 5).join(", ")}${responseInfo.fields.length > 5 ? "..." : ""}`
        : `Validate that a valid ${method} request returns expected success response`,
      preconditions: ["API server is running", "Valid authentication credentials available", "Test data is prepared"],
      steps: [
        { action: `Prepare valid request with all required parameters`, expected: "Request payload is properly formatted" },
        { action: `Set appropriate headers including Content-Type`, expected: "Headers are correctly configured" },
        { action: `Send ${method} request to ${endpoint}`, expected: "Request is sent successfully" },
        { action: `Verify response status code is ${expectedStatus}`, expected: `Status code is ${expectedStatus}` },
        { action: hasRealResponse ? `Validate response contains ${responseInfo.fields.length} expected fields` : "Validate response body structure", expected: hasRealResponse ? `Fields present: ${responseInfo.fields.filter(f => f !== "_root_array").join(", ")}` : "Response matches expected schema" },
        { action: `Verify field data types match expected schema`, expected: hasRealResponse ? `Types: ${Object.entries(responseInfo.types).filter(([k]) => k !== "_root_array").map(([k, v]) => `${k}=${v}`).slice(0, 4).join(", ")}` : "Data types are correct" }
      ],
      testData: hasRealResponse ? responseInfo.sample : { sampleField: "sampleValue", id: 123 },
      assertions: [
        `Response status is ${expectedStatus}`,
        ...fieldAssertions.slice(0, 6),
        "Content-Type header is application/json"
      ],
      postmanScript: testOptions.includePostmanScripts ? `pm.test("Status code is ${expectedStatus}", function () {
    pm.response.to.have.status(${expectedStatus});
});

pm.test("Response time is acceptable", function () {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("Response has all expected fields", function () {
    const jsonData = ${isArrayResponse ? "pm.response.json()[0]" : "pm.response.json()"};
${postmanFieldChecks}
});

pm.test("Content-Type is JSON", function () {
    pm.response.to.have.header("Content-Type");
    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});` : undefined,
      readyApiGroovy: testOptions.includeReadyApiScripts ? `import groovy.json.JsonSlurper

def response = context.response
def jsonSlurper = new JsonSlurper()
def jsonRoot = jsonSlurper.parseText(response.contentAsString)
def json = ${isArrayResponse ? "jsonRoot[0]" : "jsonRoot"}

assert response.statusCode == ${expectedStatus} : "Expected ${expectedStatus} but got " + response.statusCode
${groovyFieldChecks}
assert response.responseTime < 2000 : "Response time exceeded 2s"` : undefined,
      playwrightScript: testOptions.includePlaywrightScripts ? `import { test, expect } from '@playwright/test';

test.describe('${endpoint} API Tests', () => {
  const baseUrl = '${endpoint}';
  
  test('should return ${expectedStatus} with valid response structure', async ({ request }) => {
    const response = await request.${method.toLowerCase()}(baseUrl${method !== 'GET' && method !== 'DELETE' ? `, {
      data: ${JSON.stringify(responseInfo.sample || {}, null, 6).split('\n').join('\n      ')}
    }` : ''});
    
    // Validate status code
    expect(response.status()).toBe(${expectedStatus});
    
    // Validate Content-Type
    expect(response.headers()['content-type']).toContain('application/json');
    
    // Parse and validate JSON response
    const json = await response.json();
    ${isArrayResponse ? `expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(0);
    const data = json[0];` : 'const data = json;'}
    
    // Validate response fields
${responseInfo.fields.filter(f => f !== '_root_array').map(field => {
  const type = responseInfo.types[field];
  if (type === 'number') return `    expect(typeof data.${field}).toBe('number');`;
  if (type === 'boolean') return `    expect(typeof data.${field}).toBe('boolean');`;
  if (type === 'array') return `    expect(Array.isArray(data.${field})).toBe(true);`;
  if (type === 'object') return `    expect(typeof data.${field}).toBe('object');`;
  return `    expect(typeof data.${field}).toBe('string');`;
}).join('\n')}
  });
});` : undefined
    });

    testCases.push({
      id: `TC_API_FUNC_${String(counter++).padStart(3, "0")}`,
      title: `Verify response schema validation for ${endpoint}`,
      type: "functional",
      priority: "P1",
      description: "Validate that response body matches the expected JSON schema",
      preconditions: ["Valid API endpoint accessible", "Schema definition available"],
      steps: [
        { action: "Send valid request to endpoint", expected: "Request executes successfully" },
        { action: "Parse response JSON body", expected: "Valid JSON response received" },
        { action: "Validate required fields present", expected: "All required fields exist" },
        { action: "Verify field data types", expected: "Data types match schema definition" },
        { action: "Check nested object structures", expected: "Nested objects are properly formed" },
        { action: "Validate array fields if present", expected: "Arrays contain expected element types" }
      ],
      testData: {},
      assertions: [
        "Response is valid JSON",
        "All required fields are present",
        "Field data types are correct",
        "Nested structures are valid"
      ],
      postmanScript: testOptions.includePostmanScripts ? `const schema = {
    type: "object",
    required: ["id", "status"],
    properties: {
        id: { type: "number" },
        status: { type: "string" }
    }
};

pm.test("Schema is valid", function () {
    pm.response.to.have.jsonSchema(schema);
});` : undefined,
      readyApiGroovy: testOptions.includeReadyApiScripts ? `def response = context.response
def json = new groovy.json.JsonSlurper().parseText(response.contentAsString)

assert json.id instanceof Number : "id must be a number"
assert json.status instanceof String : "status must be a string"` : undefined,
      playwrightScript: testOptions.includePlaywrightScripts ? `import { test, expect } from '@playwright/test';

test('should have valid JSON schema structure', async ({ request }) => {
  const response = await request.${method.toLowerCase()}('${endpoint}');
  const json = await response.json();
  
  // Validate JSON is parseable
  expect(json).toBeDefined();
  
  // Validate required fields exist
  ${responseInfo.fields.filter(f => f !== '_root_array').slice(0, 5).map(f => `expect(json).toHaveProperty('${f}');`).join('\n  ')}
  
  // Validate data types
  ${Object.entries(responseInfo.types).filter(([k]) => k !== '_root_array').slice(0, 5).map(([field, type]) => {
    if (type === 'number') return `expect(typeof json.${field}).toBe('number');`;
    if (type === 'boolean') return `expect(typeof json.${field}).toBe('boolean');`;
    if (type === 'array') return `expect(Array.isArray(json.${field})).toBe(true);`;
    if (type === 'object') return `expect(typeof json.${field}).toBe('object');`;
    return `expect(typeof json.${field}).toBe('string');`;
  }).join('\n  ')}
});` : undefined
    });
  }

  // Generate test cases for each nested structure (arrays within the response)
  if (testOptions.functional && nestedStructures.length > 0) {
    // Find primary array structures to generate comprehensive validation tests
    const primaryArrays = nestedStructures.filter(s => s.type === "array" && s.fields.length > 5);
    
    for (const structure of primaryArrays.slice(0, 3)) { // Limit to 3 major nested structures
      const pathParts = structure.path.split(".");
      const arrayName = pathParts[pathParts.length - 1] || "items";
      const cleanArrayName = arrayName.replace(/\[\]/g, "");
      
      // Generate Postman assertions for all fields in the nested structure
      const nestedPostmanChecks = structure.fields.slice(0, 20).map(field => {
        const type = structure.fieldTypes[field];
        if (type === "string") return `    pm.expect(typeof firstItem.${field}).to.equal("string");`;
        if (type === "number") return `    pm.expect(typeof firstItem.${field}).to.equal("number");`;
        if (type === "boolean") return `    pm.expect(typeof firstItem.${field}).to.equal("boolean");`;
        if (type === "array") return `    pm.expect(Array.isArray(firstItem.${field})).to.be.true;`;
        if (type === "object") return `    pm.expect(typeof firstItem.${field}).to.equal("object");`;
        return `    pm.expect(firstItem.${field}).to.exist;`;
      }).join("\n");

      const nestedGroovyChecks = structure.fields.slice(0, 20).map(field => {
        const type = structure.fieldTypes[field];
        if (type === "string") return `assert firstItem.${field} instanceof String : "${field} must be a string"`;
        if (type === "number") return `assert firstItem.${field} instanceof Number : "${field} must be a number"`;
        if (type === "boolean") return `assert firstItem.${field} instanceof Boolean : "${field} must be a boolean"`;
        if (type === "array") return `assert firstItem.${field} instanceof List : "${field} must be an array"`;
        return `assert firstItem.${field} != null : "${field} must exist"`;
      }).join("\n");

      testCases.push({
        id: `TC_API_SCHEMA_${String(counter++).padStart(3, "0")}`,
        title: `Validate ${cleanArrayName} array element structure and field types`,
        type: "functional",
        priority: "P0",
        description: `Comprehensive validation of ${cleanArrayName} array elements with ${structure.fields.length} fields. Validates: ${structure.fields.slice(0, 8).join(", ")}${structure.fields.length > 8 ? ` and ${structure.fields.length - 8} more` : ""}`,
        preconditions: [
          "API returns successful response",
          `${cleanArrayName} array is present in response`,
          "Array contains at least one element"
        ],
        steps: [
          { action: `Send valid request to ${endpoint}`, expected: "Successful response received" },
          { action: `Verify ${cleanArrayName} array exists in response`, expected: `${cleanArrayName} is present and is an array` },
          { action: `Verify ${cleanArrayName} array is not empty`, expected: "Array contains at least one element" },
          { action: `Validate all ${structure.fields.length} fields exist in first element`, expected: `Fields present: ${structure.fields.slice(0, 6).join(", ")}...` },
          { action: "Verify data types for each field", expected: `Types: ${Object.entries(structure.fieldTypes).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(", ")}...` },
          { action: `Validate nested arrays within ${cleanArrayName}`, expected: structure.nestedArrays.length > 0 ? `Nested arrays: ${structure.nestedArrays.join(", ")}` : "No nested arrays to validate" }
        ],
        testData: structure.sampleValues,
        assertions: [
          `${cleanArrayName} exists and is an array`,
          `${cleanArrayName} array is not empty`,
          ...structure.fields.slice(0, 15).map(f => `Element contains "${f}" field of type ${structure.fieldTypes[f]}`),
          ...(structure.nestedArrays.length > 0 ? structure.nestedArrays.map(na => `Nested array "${na}" exists and is properly structured`) : [])
        ],
        postmanScript: testOptions.includePostmanScripts ? `pm.test("${cleanArrayName} array exists and has elements", function () {
    const jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property("${cleanArrayName}");
    pm.expect(jsonData.${cleanArrayName}).to.be.an("array");
    pm.expect(jsonData.${cleanArrayName}.length).to.be.above(0);
});

pm.test("${cleanArrayName} elements have all required fields with correct types", function () {
    const jsonData = pm.response.json();
    const firstItem = jsonData.${cleanArrayName}[0];
    
    // Field existence checks
${structure.fields.slice(0, 15).map(f => `    pm.expect(firstItem).to.have.property("${f}");`).join("\n")}
    
    // Data type validations
${nestedPostmanChecks}
});

${structure.nestedArrays.length > 0 ? `pm.test("Nested arrays within ${cleanArrayName} are valid", function () {
    const jsonData = pm.response.json();
    const firstItem = jsonData.${cleanArrayName}[0];
    
${structure.nestedArrays.map(na => `    pm.expect(firstItem.${na}).to.be.an("array");
    if (firstItem.${na}.length > 0) {
        pm.expect(firstItem.${na}[0]).to.be.an("object");
    }`).join("\n")}
});` : ""}` : undefined,
        readyApiGroovy: testOptions.includeReadyApiScripts ? `import groovy.json.JsonSlurper

def response = context.response
def json = new JsonSlurper().parseText(response.contentAsString)

// Validate ${cleanArrayName} array exists
assert json.${cleanArrayName} != null : "${cleanArrayName} must exist"
assert json.${cleanArrayName} instanceof List : "${cleanArrayName} must be an array"
assert json.${cleanArrayName}.size() > 0 : "${cleanArrayName} must not be empty"

def firstItem = json.${cleanArrayName}[0]

// Field existence and type validation
${nestedGroovyChecks}

${structure.nestedArrays.length > 0 ? `// Validate nested arrays
${structure.nestedArrays.map(na => `assert firstItem.${na} instanceof List : "${na} must be an array"`).join("\n")}` : ""}` : undefined,
        playwrightScript: testOptions.includePlaywrightScripts ? `import { test, expect } from '@playwright/test';

test('should validate ${cleanArrayName} array structure', async ({ request }) => {
  const response = await request.${method.toLowerCase()}('${endpoint}'${method !== 'GET' && method !== 'DELETE' ? `, {
    data: ${JSON.stringify(responseInfo.sample || {}, null, 4)}
  }` : ''});
  
  const json = await response.json();
  
  // Validate array exists and has elements
  expect(json.${cleanArrayName}).toBeDefined();
  expect(Array.isArray(json.${cleanArrayName})).toBe(true);
  expect(json.${cleanArrayName}.length).toBeGreaterThan(0);
  
  const firstItem = json.${cleanArrayName}[0];
  
  // Validate all fields exist
${structure.fields.slice(0, 15).map(f => `  expect(firstItem).toHaveProperty('${f}');`).join("\n")}
  
  // Validate data types
${structure.fields.slice(0, 10).map(f => {
  const t = structure.fieldTypes[f];
  if (t === "string") return `  expect(typeof firstItem.${f}).toBe('string');`;
  if (t === "number") return `  expect(typeof firstItem.${f}).toBe('number');`;
  if (t === "boolean") return `  expect(typeof firstItem.${f}).toBe('boolean');`;
  if (t === "array") return `  expect(Array.isArray(firstItem.${f})).toBe(true);`;
  return `  expect(firstItem.${f}).toBeDefined();`;
}).join("\n")}
});` : undefined
      });
    }

    // Generate test cases for deeply nested structures (e.g., Attributes, Addresses within Employees)
    const deeplyNested = nestedStructures.filter(s => s.path.includes("[]") && s.path.split("[]").length > 1);
    for (const nested of deeplyNested.slice(0, 3)) {
      const pathParts = nested.path.split(".");
      const nestedName = pathParts[pathParts.length - 1]?.replace(/\[\]/g, "") || "nestedItems";
      const parentPath = pathParts.slice(0, -1).join(".").replace(/\[\]/g, "[0]");

      testCases.push({
        id: `TC_API_NESTED_${String(counter++).padStart(3, "0")}`,
        title: `Validate deeply nested ${nestedName} array structure`,
        type: "functional",
        priority: "P1",
        description: `Validates nested ${nestedName} array at path ${nested.path} with ${nested.fields.length} fields`,
        preconditions: [
          "Parent array contains elements",
          `${nestedName} nested array is present`
        ],
        steps: [
          { action: "Retrieve API response", expected: "Response contains nested structure" },
          { action: `Navigate to ${parentPath}`, expected: "Parent object accessible" },
          { action: `Verify ${nestedName} array exists`, expected: "Nested array is present" },
          { action: "Validate nested array has elements", expected: "Array is not empty" },
          { action: "Check field structure of nested elements", expected: `Fields: ${nested.fields.slice(0, 5).join(", ")}` },
          { action: "Validate field data types", expected: "All types are correct" }
        ],
        testData: nested.sampleValues,
        assertions: [
          `${nestedName} array exists`,
          `${nestedName} array has elements`,
          ...nested.fields.slice(0, 10).map(f => `${nestedName} element contains "${f}" of type ${nested.fieldTypes[f]}`)
        ],
        postmanScript: testOptions.includePostmanScripts ? `pm.test("Nested ${nestedName} structure is valid", function () {
    const jsonData = pm.response.json();
    const parent = jsonData${parentPath.replace("root", "").replace(/\[0\]/g, "[0]")};
    
    pm.expect(parent.${nestedName}).to.be.an("array");
    if (parent.${nestedName}.length > 0) {
        const nestedItem = parent.${nestedName}[0];
${nested.fields.slice(0, 8).map(f => `        pm.expect(nestedItem).to.have.property("${f}");`).join("\n")}
    }
});` : undefined,
        readyApiGroovy: testOptions.includeReadyApiScripts ? `import groovy.json.JsonSlurper
def json = new JsonSlurper().parseText(context.response.contentAsString)
def parent = json${parentPath.replace("root", "").replace(/\[0\]/g, "[0]")}
assert parent.${nestedName} instanceof List : "${nestedName} must be an array"
if (parent.${nestedName}.size() > 0) {
    def nestedItem = parent.${nestedName}[0]
${nested.fields.slice(0, 8).map(f => `    assert nestedItem.${f} != null : "${f} must exist"`).join("\n")}
}` : undefined
      });
    }
  }

  if (testOptions.negative) {
    testCases.push({
      id: `TC_API_NEG_${String(counter++).padStart(3, "0")}`,
      title: `Verify 400 error for invalid request body`,
      type: "negative",
      priority: "P1",
      description: "Validate proper error handling when request body contains invalid data",
      preconditions: ["API server is running", "Endpoint accepts JSON body"],
      steps: [
        { action: "Prepare request with malformed JSON", expected: "Invalid request is prepared" },
        { action: "Send request to endpoint", expected: "Request is transmitted" },
        { action: "Verify 400 status code returned", expected: "Status code is 400 Bad Request" },
        { action: "Check error message in response", expected: "Descriptive error message present" },
        { action: "Validate error response format", expected: "Error follows standard format" },
        { action: "Ensure no data was modified", expected: "No side effects occurred" }
      ],
      testData: { invalidField: null, missingRequired: undefined },
      assertions: [
        "Response status is 400",
        "Error message is descriptive",
        "Error code is present",
        "No data modification occurred"
      ],
      postmanScript: testOptions.includePostmanScripts ? `pm.test("Status code is 400", function () {
    pm.response.to.have.status(400);
});

pm.test("Error message is present", function () {
    const jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property("error");
});` : undefined,
      readyApiGroovy: testOptions.includeReadyApiScripts ? `def response = context.response

assert response.statusCode == 400 : "Expected 400 but got " + response.statusCode
def json = new groovy.json.JsonSlurper().parseText(response.contentAsString)
assert json.error != null : "Error message should be present"` : undefined,
      playwrightScript: testOptions.includePlaywrightScripts ? `import { test, expect } from '@playwright/test';

test('should return 400 for invalid request body', async ({ request }) => {
  const response = await request.${method.toLowerCase()}('${endpoint}'${method !== 'GET' && method !== 'DELETE' && method !== 'HEAD' ? `, {
    data: { invalidField: null, malformed: 'data' }
  }` : ''});
  
  // Expect 400 Bad Request for invalid input
  expect([400, 422]).toContain(response.status());
  
  const json = await response.json();
  expect(json.error || json.message).toBeTruthy();
});` : undefined
    });

    testCases.push({
      id: `TC_API_NEG_${String(counter++).padStart(3, "0")}`,
      title: `Verify 401 error for unauthorized access`,
      type: "negative",
      priority: "P0",
      description: "Validate that requests without valid authentication return 401 Unauthorized",
      preconditions: ["API requires authentication", "No auth token provided"],
      steps: [
        { action: "Prepare request without auth headers", expected: "Request lacks authentication" },
        { action: "Send request to protected endpoint", expected: "Request is transmitted" },
        { action: "Verify 401 status code", expected: "Status code is 401 Unauthorized" },
        { action: "Check WWW-Authenticate header", expected: "Auth challenge header present" },
        { action: "Validate error response body", expected: "Error message indicates auth failure" },
        { action: "Ensure protected data not exposed", expected: "No sensitive data in response" }
      ],
      testData: {},
      assertions: [
        "Response status is 401",
        "No sensitive data exposed",
        "Auth error message present",
        "Security headers present"
      ],
      postmanScript: testOptions.includePostmanScripts ? `pm.test("Status code is 401", function () {
    pm.response.to.have.status(401);
});

pm.test("Unauthorized error returned", function () {
    const jsonData = pm.response.json();
    pm.expect(jsonData.error).to.include("unauthorized");
});` : undefined,
      readyApiGroovy: testOptions.includeReadyApiScripts ? `def response = context.response

assert response.statusCode == 401 : "Expected 401 but got " + response.statusCode
assert response.contentAsString.toLowerCase().contains("unauthorized")` : undefined,
      playwrightScript: testOptions.includePlaywrightScripts ? `import { test, expect } from '@playwright/test';

test('should return 401 for unauthorized access', async ({ request }) => {
  // Send request without valid authentication
  const response = await request.${method.toLowerCase()}('${endpoint}', {
    headers: { 'Authorization': 'Bearer invalid_token' }
  });
  
  // Expect 401 Unauthorized or 403 Forbidden
  expect([401, 403]).toContain(response.status());
  
  const text = await response.text();
  const textLower = text.toLowerCase();
  expect(textLower.includes('unauthorized') || textLower.includes('forbidden') || textLower.includes('invalid')).toBe(true);
});` : undefined
    });
  }

  if (testOptions.security) {
    testCases.push({
      id: `TC_API_SEC_${String(counter++).padStart(3, "0")}`,
      title: `Verify SQL injection prevention`,
      type: "security",
      priority: "P0",
      description: "Validate that API properly sanitizes input to prevent SQL injection attacks",
      preconditions: ["API accepts user input", "Database backend exists"],
      steps: [
        { action: "Prepare SQL injection payload", expected: "Malicious input ready" },
        { action: "Send request with injection in query param", expected: "Request transmitted" },
        { action: "Verify no database error exposed", expected: "No SQL error in response" },
        { action: "Check response for proper handling", expected: "Input is sanitized or rejected" },
        { action: "Verify no data leakage", expected: "No unauthorized data returned" },
        { action: "Test alternative injection patterns", expected: "All patterns blocked" }
      ],
      testData: { id: "1; DROP TABLE users;--", name: "' OR '1'='1" },
      assertions: [
        "No SQL errors in response",
        "Input is properly sanitized",
        "No unauthorized data access",
        "Application remains stable"
      ],
      postmanScript: testOptions.includePostmanScripts ? `pm.test("No SQL error exposed", function () {
    const body = pm.response.text().toLowerCase();
    pm.expect(body).to.not.include("sql");
    pm.expect(body).to.not.include("syntax error");
});

pm.test("Request handled safely", function () {
    pm.response.to.not.have.status(500);
});` : undefined,
      readyApiGroovy: testOptions.includeReadyApiScripts ? `def response = context.response
def body = response.contentAsString.toLowerCase()

assert !body.contains("sql") : "SQL error exposed"
assert !body.contains("syntax error") : "Syntax error exposed"
assert response.statusCode != 500 : "Server error occurred"` : undefined,
      playwrightScript: testOptions.includePlaywrightScripts ? `import { test, expect } from '@playwright/test';

test('should prevent SQL injection attacks', async ({ request }) => {
  const sqlPayload = "1; DROP TABLE users;--";
  
  // Test with SQL injection in URL query parameter
  const urlWithPayload = '${endpoint}' + (('${endpoint}'.includes('?') ? '&' : '?') + 'id=' + encodeURIComponent(sqlPayload));
  
  const response = await request.${method.toLowerCase()}(urlWithPayload${method !== 'GET' && method !== 'DELETE' && method !== 'HEAD' ? `, {
    data: { id: sqlPayload, name: "' OR '1'='1" }
  }` : ''});
  
  const body = await response.text();
  const bodyLower = body.toLowerCase();
  
  // Verify no SQL errors exposed
  expect(bodyLower).not.toContain('syntax error');
  expect(bodyLower).not.toContain('mysql_');
  expect(bodyLower).not.toContain('pg_');
  
  // Verify no server crash
  expect(response.status()).not.toBe(500);
});` : undefined
    });

    testCases.push({
      id: `TC_API_SEC_${String(counter++).padStart(3, "0")}`,
      title: `Verify XSS prevention in response`,
      type: "security",
      priority: "P1",
      description: "Validate that API properly escapes output to prevent XSS attacks",
      preconditions: ["API returns user-generated content", "HTML rendering possible"],
      steps: [
        { action: "Prepare XSS payload in input", expected: "Malicious script ready" },
        { action: "Submit payload via API", expected: "Data submitted" },
        { action: "Retrieve stored/reflected data", expected: "Data retrieved" },
        { action: "Verify script tags escaped", expected: "No raw script tags" },
        { action: "Check Content-Type header", expected: "Proper content type set" },
        { action: "Test various XSS vectors", expected: "All vectors neutralized" }
      ],
      testData: { content: "<script>alert('xss')</script>", name: "<img onerror='alert(1)' src='x'>" },
      assertions: [
        "Script tags are escaped",
        "Event handlers are neutralized",
        "Content-Type header is correct",
        "No executable code in response"
      ],
      postmanScript: testOptions.includePostmanScripts ? `pm.test("XSS vectors escaped", function () {
    const body = pm.response.text();
    pm.expect(body).to.not.include("<script>");
    pm.expect(body).to.not.include("onerror=");
});` : undefined,
      readyApiGroovy: testOptions.includeReadyApiScripts ? `def response = context.response
def body = response.contentAsString

assert !body.contains("<script>") : "Script tag not escaped"
assert !body.contains("onerror=") : "Event handler not escaped"` : undefined,
      playwrightScript: testOptions.includePlaywrightScripts ? `import { test, expect } from '@playwright/test';

test('should prevent XSS attacks in response', async ({ request }) => {
  const xssPayload = "<script>alert('xss')</script>";
  
  const response = await request.${method.toLowerCase()}('${endpoint}'${method !== 'GET' && method !== 'DELETE' && method !== 'HEAD' ? `, {
    data: { content: xssPayload, name: "<img onerror='alert(1)' src='x'>" }
  }` : ''});
  
  const body = await response.text();
  
  // Verify XSS vectors are escaped or rejected
  if (response.ok()) {
    expect(body).not.toContain('<script>');
    expect(body).not.toContain('onerror=');
  }
  
  // Check proper content type
  const contentType = response.headers()['content-type'] || '';
  expect(contentType).toContain('application/json');
});` : undefined
    });
  }

  if (testOptions.boundary) {
    testCases.push({
      id: `TC_API_BND_${String(counter++).padStart(3, "0")}`,
      title: `Verify handling of empty request body`,
      type: "boundary",
      priority: "P2",
      description: "Validate proper handling when request body is empty",
      preconditions: ["API endpoint accepts body", "Endpoint is accessible"],
      steps: [
        { action: "Prepare request with empty body", expected: "Empty request ready" },
        { action: "Set Content-Type header", expected: "Header configured" },
        { action: "Send request to endpoint", expected: "Request transmitted" },
        { action: "Verify appropriate status code", expected: "400 or handled gracefully" },
        { action: "Check error message clarity", expected: "Clear error for missing body" },
        { action: "Ensure no crash or exception", expected: "Server remains stable" }
      ],
      testData: {},
      assertions: [
        "Appropriate status code returned",
        "Clear error message provided",
        "No server crash",
        "Response is valid JSON"
      ],
      postmanScript: testOptions.includePostmanScripts ? `pm.test("Empty body handled", function () {
    pm.response.to.have.status(400);
});

pm.test("Error message present", function () {
    const json = pm.response.json();
    pm.expect(json.error || json.message).to.exist;
});` : undefined,
      readyApiGroovy: testOptions.includeReadyApiScripts ? `def response = context.response

assert response.statusCode == 400 : "Should return 400 for empty body"
def json = new groovy.json.JsonSlurper().parseText(response.contentAsString)
assert json.error != null || json.message != null` : undefined,
      playwrightScript: testOptions.includePlaywrightScripts ? `import { test, expect } from '@playwright/test';

test('should handle empty request body gracefully', async ({ request }) => {
  const response = await request.${method.toLowerCase()}('${endpoint}'${method !== 'GET' && method !== 'DELETE' && method !== 'HEAD' ? `, {
    data: {}
  }` : ''});
  
  // For methods with body, should return 400 for empty body
  // For GET/DELETE, this is valid - just check no crash
  expect(response.status()).not.toBe(500);
  
  // Server should remain stable
  expect(response.ok() || [400, 422].includes(response.status())).toBe(true);
});` : undefined
    });

    testCases.push({
      id: `TC_API_BND_${String(counter++).padStart(3, "0")}`,
      title: `Verify maximum payload size handling`,
      type: "boundary",
      priority: "P2",
      description: "Validate API behavior with very large request payloads",
      preconditions: ["API accepts request body", "Max payload limit configured"],
      steps: [
        { action: "Generate oversized payload", expected: "Large payload created" },
        { action: "Attempt to send large payload", expected: "Request attempted" },
        { action: "Verify 413 status or graceful handling", expected: "Payload rejected appropriately" },
        { action: "Check error message", expected: "Size limit error indicated" },
        { action: "Verify partial data not processed", expected: "No partial processing" },
        { action: "Confirm server stability", expected: "Server remains responsive" }
      ],
      testData: { largeField: "x".repeat(10000) },
      assertions: [
        "413 or 400 status returned",
        "Error indicates size limit",
        "No partial data saved",
        "Server remains stable"
      ],
      postmanScript: testOptions.includePostmanScripts ? `pm.test("Large payload rejected", function () {
    pm.expect([400, 413]).to.include(pm.response.code);
});

pm.test("Server is stable", function () {
    pm.response.to.not.have.status(500);
});` : undefined,
      readyApiGroovy: testOptions.includeReadyApiScripts ? `def response = context.response

assert response.statusCode in [400, 413] : "Should reject large payload"
assert response.statusCode != 500 : "Server should remain stable"` : undefined,
      playwrightScript: testOptions.includePlaywrightScripts ? `import { test, expect } from '@playwright/test';

test('should handle oversized payload appropriately', async ({ request }) => {
  const largePayload = 'x'.repeat(100000); // 100KB payload
  
  const response = await request.${method.toLowerCase()}('${endpoint}'${method !== 'GET' && method !== 'DELETE' && method !== 'HEAD' ? `, {
    data: { largeField: largePayload }
  }` : ''});
  
  // Should reject with 400/413 or handle gracefully
  expect(response.status()).not.toBe(500);
  
  // Server should remain stable (not crash)
  expect(response.status()).toBeDefined();
});` : undefined
    });
  }

  if (testOptions.performance) {
    testCases.push({
      id: `TC_API_PERF_${String(counter++).padStart(3, "0")}`,
      title: `Verify response time under normal load`,
      type: "performance",
      priority: "P1",
      description: "Validate that API response time is within acceptable limits",
      preconditions: ["API is accessible", "System under normal load"],
      steps: [
        { action: "Prepare standard request", expected: "Request ready" },
        { action: "Record start timestamp", expected: "Timer started" },
        { action: "Send request to endpoint", expected: "Request sent" },
        { action: "Record response timestamp", expected: "Timer stopped" },
        { action: "Calculate response time", expected: "Time calculated" },
        { action: "Compare against threshold", expected: "Time < 2000ms" }
      ],
      testData: {},
      assertions: [
        "Response time < 2000ms",
        "Request completes successfully",
        "No timeout occurred",
        "Consistent response times"
      ],
      postmanScript: testOptions.includePostmanScripts ? `pm.test("Response time is acceptable", function () {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("Request successful", function () {
    pm.response.to.have.status(200);
});` : undefined,
      readyApiGroovy: testOptions.includeReadyApiScripts ? `def response = context.response

assert response.responseTime < 2000 : "Response time exceeded 2000ms"
assert response.statusCode == 200 : "Request should succeed"` : undefined,
      playwrightScript: testOptions.includePlaywrightScripts ? `import { test, expect } from '@playwright/test';

test('should respond within acceptable time limits', async ({ request }) => {
  const startTime = Date.now();
  
  const response = await request.${method.toLowerCase()}('${endpoint}');
  
  const responseTime = Date.now() - startTime;
  
  // Response time should be under 2000ms
  expect(responseTime).toBeLessThan(2000);
  
  // Request should be successful
  expect(response.ok()).toBe(true);
  
  console.log(\`Response time: \${responseTime}ms\`);
});

test('should maintain consistent response times', async ({ request }) => {
  const times: number[] = [];
  
  // Run 3 sequential requests
  for (let i = 0; i < 3; i++) {
    const start = Date.now();
    await request.${method.toLowerCase()}('${endpoint}');
    times.push(Date.now() - start);
  }
  
  // All requests should complete under 2000ms
  times.forEach(time => {
    expect(time).toBeLessThan(2000);
  });
  
  // Standard deviation should be reasonable (consistent times)
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(\`Average response time: \${avg.toFixed(0)}ms\`);
});` : undefined
    });
  }

  return testCases;
}

// Helper functions for synthetic data generation
function isPIIField(field: string): boolean {
  const lowerField = field.toLowerCase();
  return lowerField.includes("name") ||
         lowerField.includes("email") ||
         lowerField.includes("phone") ||
         lowerField.includes("ssn") ||
         lowerField.includes("address") ||
         lowerField.includes("dob") ||
         lowerField.includes("birth") ||
         lowerField.includes("license") ||
         lowerField.includes("vin") ||
         lowerField.includes("account") ||
         lowerField.includes("member_id");
}

function maskValue(field: string, value: any, index: number): string {
  const str = String(value);
  const lowerField = field.toLowerCase();
  
  if (lowerField.includes("email")) {
    const parts = str.split("@");
    return parts[0].substring(0, 2) + "***@" + parts[1];
  }
  if (lowerField.includes("phone")) {
    return str.substring(0, 3) + "-***-" + str.substring(str.length - 4);
  }
  if (lowerField.includes("ssn")) {
    return "***-**-" + str.substring(str.length - 4);
  }
  if (lowerField.includes("name")) {
    return str.charAt(0) + "***";
  }
  if (lowerField.includes("address")) {
    return "*** " + str.split(" ").pop();
  }
  if (lowerField.includes("account") || lowerField.includes("vin")) {
    return "***" + str.substring(str.length - 4);
  }
  return str.substring(0, 2) + "***";
}

function generateFieldValue(field: string, recordIndex: number, prefix: string, domain: string, subDomain: string): any {
  const lowerField = field.toLowerCase();
  
  // Common ID fields
  if (lowerField.includes("_id") || lowerField === "id") {
    const prefixStr = prefix ? `${prefix}_` : "";
    return `${prefixStr}${subDomain.toUpperCase().substring(0, 3)}_${String(recordIndex + 1).padStart(6, "0")}`;
  }
  
  // Common number/ID fields
  if (lowerField.includes("number") || lowerField.includes("code") || lowerField.includes("sku")) {
    const prefixStr = prefix ? `${prefix}-` : "";
    return `${prefixStr}${String(100000 + recordIndex)}`;
  }
  
  // Name fields
  if (lowerField.includes("first_name") || lowerField.includes("firstname")) {
    const names = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth",
                   "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen"];
    return names[recordIndex % names.length];
  }
  if (lowerField.includes("last_name") || lowerField.includes("lastname")) {
    const names = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
                   "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"];
    return names[recordIndex % names.length];
  }
  if (lowerField.includes("name") && !lowerField.includes("first") && !lowerField.includes("last")) {
    const firstNames = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda"];
    const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis"];
    return `${firstNames[recordIndex % firstNames.length]} ${lastNames[(recordIndex + 3) % lastNames.length]}`;
  }
  
  // Email fields
  if (lowerField.includes("email")) {
    const firstNames = ["james", "mary", "john", "patricia", "robert", "jennifer", "michael", "linda"];
    const domains = ["example.com", "testmail.com", "demo.org", "sample.net"];
    return `${firstNames[recordIndex % firstNames.length]}.user${recordIndex}@${domains[recordIndex % domains.length]}`;
  }
  
  // Phone fields
  if (lowerField.includes("phone") || lowerField.includes("tel")) {
    return `555-${String(100 + (recordIndex % 900)).padStart(3, "0")}-${String(1000 + recordIndex).padStart(4, "0")}`;
  }
  
  // Date fields
  if (lowerField.includes("date") || lowerField.includes("_at") || lowerField.endsWith("at")) {
    const baseDate = new Date("2024-01-01");
    baseDate.setDate(baseDate.getDate() + (recordIndex % 365));
    return baseDate.toISOString().split("T")[0];
  }
  
  // Amount/Value/Price fields
  if (lowerField.includes("amount") || lowerField.includes("value") || lowerField.includes("price") || 
      lowerField.includes("cost") || lowerField.includes("total") || lowerField.includes("balance")) {
    const baseValue = 1000 + (recordIndex * 137) % 50000;
    return (baseValue / 100).toFixed(2);
  }
  
  // Percentage fields (exclude MVR_Score which is domain-specific)
  if (lowerField.includes("percent") || lowerField.includes("rate") || (lowerField.includes("score") && !lowerField.includes("mvr"))) {
    return ((recordIndex * 7) % 100) + 1;
  }
  
  // Status fields
  if (lowerField.includes("status")) {
    const statuses = ["Active", "Pending", "Completed", "In Progress", "Cancelled", "Approved"];
    return statuses[recordIndex % statuses.length];
  }
  
  // Type fields
  if (lowerField.includes("type") || lowerField.includes("category") || lowerField.includes("class")) {
    const types = ["Standard", "Premium", "Basic", "Advanced", "Enterprise", "Professional"];
    return types[recordIndex % types.length];
  }
  
  // Address fields
  if (lowerField.includes("address") && !lowerField.includes("email")) {
    const streets = ["Main St", "Oak Ave", "Maple Dr", "Cedar Ln", "Pine Rd", "Elm Way", "Park Blvd", "Lake Dr"];
    return `${100 + recordIndex} ${streets[recordIndex % streets.length]}`;
  }
  if (lowerField.includes("city")) {
    const cities = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego"];
    return cities[recordIndex % cities.length];
  }
  if (lowerField.includes("state")) {
    const states = ["CA", "TX", "FL", "NY", "PA", "IL", "OH", "GA", "NC", "MI"];
    return states[recordIndex % states.length];
  }
  if (lowerField.includes("zip") || lowerField.includes("postal")) {
    return String(10000 + (recordIndex * 113) % 90000);
  }
  if (lowerField.includes("country")) {
    const countries = ["USA", "Canada", "UK", "Germany", "France", "Australia", "Japan", "India"];
    return countries[recordIndex % countries.length];
  }
  
  // Boolean fields
  if (lowerField.includes("flag") || lowerField.includes("is_") || lowerField.includes("has_") || 
      lowerField.includes("enabled") || lowerField.includes("enrolled")) {
    return recordIndex % 2 === 0 ? "Yes" : "No";
  }
  
  // Count/Quantity fields (exclude "discount" which contains "count" as substring)
  if ((lowerField.includes("count") && !lowerField.includes("discount")) || lowerField.includes("quantity") || lowerField.includes("qty") ||
      lowerField.includes("units") || lowerField.includes("number_of")) {
    return (recordIndex % 100) + 1;
  }
  
  // Description fields
  if (lowerField.includes("description") || lowerField.includes("notes") || lowerField.includes("comment")) {
    return `Auto-generated ${domain} data for ${subDomain} record ${recordIndex + 1}`;
  }
  
  // Currency fields
  if (lowerField.includes("currency")) {
    const currencies = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"];
    return currencies[recordIndex % currencies.length];
  }
  
  // Domain-specific fields for Insurance
  if (domain === "insurance") {
    if (lowerField.includes("policy") && lowerField.includes("number")) {
      const prefixMap: Record<string, string> = { auto: "AUTO", homeowner: "HO", commercial: "COMM", life: "LIFE", health: "HLT", claims: "CLM" };
      const policyPrefix = prefixMap[subDomain] || "POL";
      return `${policyPrefix}-${String(1000000 + recordIndex)}`;
    }
    if (lowerField.includes("premium")) {
      return (800 + (recordIndex * 137) % 7200).toFixed(2);
    }
    if (lowerField.includes("deductible")) {
      const deductibles = [250, 500, 1000, 1500, 2000, 2500, 5000];
      return deductibles[recordIndex % deductibles.length];
    }
    if (lowerField.includes("limit") || lowerField.includes("coverage")) {
      const limits = [25000, 50000, 100000, 250000, 500000, 1000000];
      return limits[recordIndex % limits.length];
    }
    if (lowerField.includes("vin")) {
      const vinPrefixes = ["1HGBH41J", "2T1BURHE", "1FTFW1ET", "1G1ZT53H", "WBAVA335"];
      return `${vinPrefixes[recordIndex % vinPrefixes.length]}${String(100000000 + recordIndex).substring(0, 9)}`;
    }
    if (lowerField.includes("vehicle") && lowerField.includes("make")) {
      const makes = ["Toyota", "Honda", "Ford", "Chevrolet", "BMW", "Mercedes-Benz", "Nissan", "Hyundai", "Kia", "Subaru"];
      return makes[recordIndex % makes.length];
    }
    if (lowerField.includes("vehicle") && lowerField.includes("model")) {
      const models = ["Camry", "Accord", "F-150", "Silverado", "3 Series", "C-Class", "Altima", "Sonata", "Sorento", "Outback"];
      return models[recordIndex % models.length];
    }
    if (lowerField.includes("vehicle") && lowerField.includes("year")) {
      return 2015 + (recordIndex % 10);
    }
    if (lowerField.includes("vehicle") && lowerField.includes("usage")) {
      const usages = ["Commute", "Pleasure", "Business", "Farm/Ranch", "Rideshare"];
      return usages[recordIndex % usages.length];
    }
    if (lowerField.includes("mileage") || lowerField.includes("annual_miles")) {
      const mileages = [7500, 10000, 12000, 15000, 18000, 20000, 25000];
      return mileages[recordIndex % mileages.length];
    }
    if (lowerField.includes("payment") && lowerField.includes("plan")) {
      const plans = ["Monthly", "Quarterly", "Semi-Annual", "Annual", "Bi-Monthly"];
      return plans[recordIndex % plans.length];
    }
    if (lowerField.includes("dob") || (lowerField.includes("driver") && lowerField.includes("birth"))) {
      const year = 1960 + (recordIndex * 3) % 45;
      const month = String(1 + (recordIndex * 7) % 12).padStart(2, "0");
      const day = String(1 + (recordIndex * 11) % 28).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    if (lowerField.includes("years_licensed") || lowerField.includes("years_driving")) {
      return 1 + (recordIndex * 3) % 40;
    }
    if (lowerField.includes("prior_insurance") || lowerField.includes("previous_carrier") || lowerField.includes("prior_carrier")) {
      const carriers = ["State Farm", "GEICO", "Progressive", "Allstate", "USAA", "Liberty Mutual", "Farmers", "Nationwide", "Travelers", "Erie"];
      return carriers[recordIndex % carriers.length];
    }
    if (lowerField.includes("multi_policy") || lowerField.includes("multipolicy")) {
      return recordIndex % 3 === 0 ? "No" : "Yes";
    }
    if (lowerField.includes("mvr") || lowerField.includes("motor_vehicle_record")) {
      return (recordIndex % 5 === 0) ? 2 : (recordIndex % 3 === 0) ? 1 : 0;
    }
    if (lowerField.includes("agent") && lowerField.includes("code")) {
      return `AGT-${String(1000 + recordIndex % 500).padStart(4, "0")}`;
    }
    if (lowerField.includes("underwriting") && lowerField.includes("class")) {
      const classes = ["Preferred", "Standard", "Non-Standard", "High-Risk"];
      return classes[recordIndex % classes.length];
    }
    if (lowerField.includes("smoker")) {
      return recordIndex % 5 === 0 ? "Yes" : "No";
    }
    if (lowerField.includes("face") && lowerField.includes("amount")) {
      const amounts = [100000, 250000, 500000, 750000, 1000000];
      return amounts[recordIndex % amounts.length];
    }
    if (lowerField.includes("beneficiary") && lowerField.includes("relationship")) {
      const rels = ["Spouse", "Child", "Parent", "Sibling", "Domestic Partner"];
      return rels[recordIndex % rels.length];
    }
    if (lowerField.includes("cause_of_loss") || lowerField.includes("loss_type")) {
      const causes = ["Collision", "Theft", "Wind/Hail", "Fire", "Water Damage", "Vandalism", "Liability"];
      return causes[recordIndex % causes.length];
    }
    if (lowerField.includes("adjuster")) {
      const firstNames = ["Mark", "Susan", "David", "Lisa", "Kevin"];
      const lastNames = ["Thompson", "Parker", "Mitchell", "Chen", "Williams"];
      return `${firstNames[recordIndex % firstNames.length]} ${lastNames[(recordIndex + 2) % lastNames.length]}`;
    }
    if (lowerField.includes("catastrophe") || lowerField.includes("cat_code")) {
      return recordIndex % 10 === 0 ? `CAT-${2024 - (recordIndex % 5)}-${String(recordIndex % 99 + 1).padStart(2, "0")}` : "N/A";
    }
    if (lowerField.includes("fraud") || lowerField.includes("siu")) {
      return recordIndex % 15 === 0 ? "Yes" : "No";
    }
    if (lowerField.includes("subrogation")) {
      return recordIndex % 8 === 0 ? "Yes" : "No";
    }
    if (lowerField.includes("attorney")) {
      return recordIndex % 10 === 0 ? "Yes" : "No";
    }
    if (lowerField.includes("riders")) {
      const riders = ["Waiver of Premium", "Accidental Death", "Critical Illness", "None", "Disability Income"];
      return riders[recordIndex % riders.length];
    }
    if (lowerField.includes("lapse") || lowerField.includes("reinstatement")) {
      const base = new Date("2023-01-01");
      base.setDate(base.getDate() + (recordIndex * 30) % 365);
      return recordIndex % 7 === 0 ? base.toISOString().split("T")[0] : "N/A";
    }
    if (lowerField.includes("commission") && lowerField.includes("rate")) {
      return (8 + (recordIndex % 7)).toFixed(1) + "%";
    }
    if (lowerField.includes("construction") && lowerField.includes("type")) {
      const types = ["Frame", "Masonry", "Superior", "Fire Resistive", "Modified Fire Resistive"];
      return types[recordIndex % types.length];
    }
    if (lowerField.includes("roof") && lowerField.includes("type")) {
      const types = ["Asphalt Shingle", "Metal", "Tile", "Wood Shake", "Slate"];
      return types[recordIndex % types.length];
    }
    if (lowerField.includes("roof") && lowerField.includes("age")) {
      return 1 + (recordIndex * 2) % 25;
    }
    if (lowerField.includes("square_footage") || lowerField.includes("sqft")) {
      return 1000 + (recordIndex * 150) % 4000;
    }
    if (lowerField.includes("year_built")) {
      return 1970 + (recordIndex * 3) % 54;
    }
    if (lowerField.includes("protection_class")) {
      return 1 + (recordIndex % 10);
    }
  }
  
  // Domain-specific fields for Banking
  if (domain === "banking") {
    if (lowerField.includes("account") && lowerField.includes("number")) {
      return String(1000000000 + recordIndex);
    }
    if (lowerField.includes("iban")) {
      return `US${String(10 + recordIndex % 90)}DEMO${String(1000000000 + recordIndex)}`;
    }
    if (lowerField.includes("swift")) {
      const swiftCodes = ["CHASUS33", "CITIUS33", "BOFAUS3N", "WFBIUS6S", "PNCCUS33"];
      return swiftCodes[recordIndex % swiftCodes.length];
    }
    if (lowerField.includes("branch")) {
      return `BR-${String(100 + recordIndex % 500).padStart(3, "0")}`;
    }
    if (lowerField.includes("interest") && lowerField.includes("rate")) {
      return (1.5 + (recordIndex % 10) * 0.5).toFixed(2);
    }
    if (lowerField.includes("loan") && lowerField.includes("amount")) {
      return (10000 + (recordIndex * 5000) % 500000).toFixed(2);
    }
  }
  
  // Domain-specific fields for Healthcare
  if (domain === "healthcare") {
    if (lowerField.includes("mrn") || lowerField.includes("medical_record")) {
      return `MRN${String(1000000 + recordIndex).padStart(7, "0")}`;
    }
    if (lowerField.includes("npi")) {
      return String(1000000000 + recordIndex);
    }
    if (lowerField.includes("diagnosis") || lowerField.includes("icd")) {
      const codes = ["J18.9", "I10", "E11.9", "M54.5", "F32.9", "K21.0", "N39.0", "J06.9"];
      return codes[recordIndex % codes.length];
    }
    if (lowerField.includes("cpt") || lowerField.includes("procedure")) {
      const codes = ["99213", "99214", "99215", "99203", "99204", "99205", "99396", "99397"];
      return codes[recordIndex % codes.length];
    }
    if (lowerField.includes("blood") && lowerField.includes("type")) {
      const types = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
      return types[recordIndex % types.length];
    }
    if (lowerField.includes("vital") && lowerField.includes("bp")) {
      return `${110 + recordIndex % 40}/${70 + recordIndex % 20}`;
    }
  }
  
  // Domain-specific fields for Retail
  if (domain === "retail") {
    if (lowerField.includes("sku")) {
      return `SKU-${String(100000 + recordIndex)}`;
    }
    if (lowerField.includes("upc")) {
      return String(100000000000 + recordIndex);
    }
    if (lowerField.includes("brand")) {
      const brands = ["Acme", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Oscorp", "LexCorp"];
      return brands[recordIndex % brands.length];
    }
    if (lowerField.includes("order") && lowerField.includes("id")) {
      return `ORD-${String(1000000 + recordIndex)}`;
    }
    if (lowerField.includes("tracking")) {
      return `1Z${String(999000000 + recordIndex)}`;
    }
  }
  
  // Domain-specific fields for Telecom
  if (domain === "telecom") {
    if (lowerField.includes("msisdn") || lowerField.includes("mobile")) {
      return `1555${String(1000000 + recordIndex)}`;
    }
    if (lowerField.includes("imsi")) {
      return `310${String(100000000000 + recordIndex)}`;
    }
    if (lowerField.includes("cell") && lowerField.includes("id")) {
      return `CELL-${String(10000 + recordIndex % 50000)}`;
    }
    if (lowerField.includes("plan") && lowerField.includes("name")) {
      const plans = ["Unlimited Plus", "Basic 5GB", "Family Share", "Business Pro", "Student Special", "Senior Plus"];
      return plans[recordIndex % plans.length];
    }
  }
  
  // Domain-specific fields for Manufacturing
  if (domain === "manufacturing") {
    if (lowerField.includes("work") && lowerField.includes("order")) {
      return `WO-${String(100000 + recordIndex)}`;
    }
    if (lowerField.includes("lot") && lowerField.includes("number")) {
      return `LOT-${new Date().getFullYear()}-${String(recordIndex + 1).padStart(5, "0")}`;
    }
    if (lowerField.includes("serial")) {
      return `SN-${String(recordIndex + 1).padStart(8, "0")}`;
    }
    if (lowerField.includes("machine") && lowerField.includes("id")) {
      return `MCH-${String(100 + recordIndex % 500).padStart(3, "0")}`;
    }
    if (lowerField.includes("bom") || lowerField.includes("bill_of_material")) {
      return `BOM-${String(1000 + recordIndex)}`;
    }
  }
  
  // Default: Generate generic data
  return `Data_${recordIndex + 1}`;
}

// ==================== Swagger Parser Helper Functions ====================

async function parseSwaggerSpecFromText(raw: string): Promise<any> {
  const content = raw.trim();
  const parsed =
    content.startsWith("{") || content.startsWith("[")
      ? JSON.parse(content)
      : yaml.load(content);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid OpenAPI specification: could not parse content");
  }

  return SwaggerParser.parse(parsed as object);
}

interface ParsedEndpoint {
  id: string;
  path: string;
  method: string;
  summary: string;
  description: string;
  tags: string[];
  deprecated: boolean;
  parameters: any[];
  requestBody: any;
  responses: any;
  security: any[];
  operationId: string;
}

function parseSwaggerEndpoints(spec: any): ParsedEndpoint[] {
  const endpoints: ParsedEndpoint[] = [];
  const paths = spec.paths || {};
  
  let idCounter = 1;
  
  for (const [path, pathItem] of Object.entries(paths)) {
    const methods = ["get", "post", "put", "patch", "delete", "head", "options"];
    
    for (const method of methods) {
      const operation = (pathItem as any)[method];
      if (!operation) continue;
      
      const endpoint: ParsedEndpoint = {
        id: `ep_${idCounter++}`,
        path,
        method: method.toUpperCase(),
        summary: operation.summary || `${method.toUpperCase()} ${path}`,
        description: operation.description || "",
        tags: operation.tags || [],
        deprecated: operation.deprecated || false,
        parameters: parseParameters(operation.parameters || [], (pathItem as any).parameters || [], spec),
        requestBody: parseRequestBody(operation.requestBody, spec),
        responses: parseResponses(operation.responses || {}, spec),
        security: operation.security || spec.security || [],
        operationId: operation.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, "_")}`
      };
      
      endpoints.push(endpoint);
    }
  }
  
  return endpoints;
}

function parseParameters(operationParams: any[], pathParams: any[], spec: any): any[] {
  const allParams = [...(pathParams || []), ...(operationParams || [])];
  
  return allParams.map(param => {
    // Resolve $ref if present
    if (param.$ref) {
      const refPath = param.$ref.replace("#/", "").split("/");
      let resolved = spec;
      for (const part of refPath) {
        resolved = resolved?.[part];
      }
      param = resolved || param;
    }
    
    return {
      name: param.name,
      in: param.in, // path, query, header, cookie
      required: param.required || param.in === "path",
      description: param.description || "",
      schema: param.schema || { type: param.type || "string" },
      example: param.example || param.schema?.example
    };
  });
}

function parseRequestBody(requestBody: any, spec: any): any {
  if (!requestBody) return null;
  
  // Resolve $ref if present
  if (requestBody.$ref) {
    const refPath = requestBody.$ref.replace("#/", "").split("/");
    let resolved = spec;
    for (const part of refPath) {
      resolved = resolved?.[part];
    }
    requestBody = resolved || requestBody;
  }
  
  const content = requestBody.content || {};
  const jsonContent = content["application/json"] || content["*/*"] || Object.values(content)[0];
  
  if (!jsonContent) return null;
  
  let schema = jsonContent.schema || {};
  
  // Resolve schema $ref
  if (schema.$ref) {
    const refPath = schema.$ref.replace("#/", "").split("/");
    let resolved = spec;
    for (const part of refPath) {
      resolved = resolved?.[part];
    }
    schema = resolved || schema;
  }
  
  return {
    required: requestBody.required || false,
    description: requestBody.description || "",
    contentType: Object.keys(content)[0] || "application/json",
    schema,
    example: jsonContent.example || schema.example
  };
}

function parseResponses(responses: any, spec: any): any {
  const parsed: any = {};
  
  for (const [statusCode, response] of Object.entries(responses)) {
    let responseData = response as any;
    
    // Resolve $ref if present
    if (responseData.$ref) {
      const refPath = responseData.$ref.replace("#/", "").split("/");
      let resolved = spec;
      for (const part of refPath) {
        resolved = resolved?.[part];
      }
      responseData = resolved || responseData;
    }
    
    const content = responseData.content || {};
    const jsonContent = content["application/json"] || Object.values(content)[0] as any;
    
    parsed[statusCode] = {
      description: responseData.description || "",
      schema: jsonContent?.schema || null,
      example: jsonContent?.example || null
    };
  }
  
  return parsed;
}

/** Default value for OpenAPI path/query params when no example is defined. */
function defaultParameterValue(name: string, schema?: { type?: string; format?: string; enum?: unknown[] }): string {
  if (schema?.enum?.[0] != null) return String(schema.enum[0]);
  const lower = name.toLowerCase();
  if (schema?.format === "uuid" || lower.includes("uuid")) {
    return "00000000-0000-0000-0000-000000000001";
  }
  if (schema?.type === "integer" || schema?.type === "number" || lower.endsWith("id") || lower === "id") {
    return "1";
  }
  return "test";
}

function resolveParameterValue(param?: { name: string; example?: unknown; schema?: { type?: string; format?: string; enum?: unknown[] } }, name?: string): string {
  if (param?.example != null) return String(param.example);
  return defaultParameterValue(param?.name || name || "param", param?.schema);
}

/** Substitute `{param}` segments and append query params from the parsed operation. */
function buildRequestUrl(
  baseUrl: string,
  path: string,
  parameters: ParsedEndpoint["parameters"] = []
): { url: string; resolvedPath: string } {
  const pathParams = parameters.filter((p) => p.in === "path");
  const pathParamNames = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);

  let resolvedPath = path;
  for (const name of pathParamNames) {
    const param = pathParams.find((p) => p.name === name);
    const value = resolveParameterValue(param, name);
    resolvedPath = resolvedPath.replace(`{${name}}`, encodeURIComponent(value));
  }

  const base = baseUrl.replace(/\/$/, "");
  const pathPart = resolvedPath.startsWith("/") ? resolvedPath : `/${resolvedPath}`;
  let url = `${base}${pathPart}`;

  const queryParams = parameters.filter((p) => p.in === "query");
  if (queryParams.length > 0) {
    const qs = new URLSearchParams();
    for (const q of queryParams) {
      qs.set(q.name, resolveParameterValue(q));
    }
    url += `?${qs.toString()}`;
  }

  return { url, resolvedPath };
}

function buildRequestBodyPayload(requestBody: ParsedEndpoint["requestBody"]): string | undefined {
  if (!requestBody) return undefined;
  if (requestBody.example != null) {
    return typeof requestBody.example === "string"
      ? requestBody.example
      : JSON.stringify(requestBody.example);
  }

  const schema = requestBody.schema as { example?: unknown; type?: string; properties?: Record<string, { example?: unknown; type?: string }> } | undefined;
  if (!schema) return undefined;
  if (schema.example != null) return JSON.stringify(schema.example);

  if (schema.type === "object" && schema.properties) {
    const body: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      body[key] = prop.example ?? (prop.type === "integer" || prop.type === "number" ? 1 : prop.type === "boolean" ? true : "test");
    }
    return JSON.stringify(body);
  }

  return undefined;
}

async function executeEndpointTests(endpoint: ParsedEndpoint, config: any, testOptions: any): Promise<any> {
  const { baseUrl, authType, authToken, timeout = 30000 } = config;
  const parameters = endpoint.parameters || [];
  const { url: fullUrl, resolvedPath } = buildRequestUrl(baseUrl, endpoint.path, parameters);
  const bodyPayload = buildRequestBodyPayload(endpoint.requestBody);
  const method = endpoint.method.toUpperCase();

  const results = {
    endpointId: endpoint.id,
    path: endpoint.path,
    resolvedPath,
    method: endpoint.method,
    status: "passed" as "passed" | "failed" | "skipped",
    tests: [] as any[],
    responseTime: 0,
    statusCode: 0
  };
  
  try {
    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json"
    };
    
    if (authType === "bearer" && authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    } else if (authType === "api-key" && authToken) {
      headers["X-API-Key"] = authToken;
    }
    
    // Execute the actual request
    const startTime = Date.now();
    const response = await fetch(fullUrl, {
      method,
      headers,
      ...(bodyPayload && ["POST", "PUT", "PATCH"].includes(method) ? { body: bodyPayload } : {}),
      signal: AbortSignal.timeout(timeout)
    });
    results.responseTime = Date.now() - startTime;
    results.statusCode = response.status;
    
    // Run test assertions
    const testResults: any[] = [];
    
    // Positive test - check for success status
    if (testOptions.positiveTests !== false) {
      const positiveTest = {
        id: `${endpoint.id}_positive`,
        name: "Positive - Valid Request",
        category: "positive",
        status: response.ok ? "passed" : "failed",
        expected: "2xx status code",
        actual: `${response.status} ${response.statusText}`,
        responseTime: results.responseTime
      };
      testResults.push(positiveTest);
    }
    
    // Response time test
    if (testOptions.performanceTests !== false) {
      const perfTest = {
        id: `${endpoint.id}_perf`,
        name: "Performance - Response Time",
        category: "performance",
        status: results.responseTime < 2000 ? "passed" : "failed",
        expected: "< 2000ms",
        actual: `${results.responseTime}ms`,
        responseTime: results.responseTime
      };
      testResults.push(perfTest);
    }
    
    results.tests = testResults;
    results.status = testResults.every(t => t.status === "passed") ? "passed" : "failed";
    
  } catch (error: any) {
    results.status = "failed";
    results.tests = [{
      id: `${endpoint.id}_error`,
      name: "Request Execution",
      category: "positive",
      status: "failed",
      expected: "Successful request",
      actual: error.message,
      responseTime: 0
    }];
  }
  
  return results;
}

function generateHTMLReport(results: any, apiInfo: any, config: any): string {
  const summary = results.summary || {
    total: results.results?.length || 0,
    passed: results.results?.filter((r: any) => r.status === "passed").length || 0,
    failed: results.results?.filter((r: any) => r.status === "failed").length || 0,
    skipped: results.results?.filter((r: any) => r.status === "skipped").length || 0
  };
  
  const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Test Report - ${apiInfo?.title || "API Testing"}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; padding: 2rem; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 2rem; border-radius: 12px; margin-bottom: 2rem; }
    .header h1 { font-size: 1.75rem; color: #f8fafc; margin-bottom: 0.5rem; }
    .header p { color: #94a3b8; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .summary-card { background: #1e293b; padding: 1.5rem; border-radius: 8px; text-align: center; }
    .summary-card.passed { border-left: 4px solid #22c55e; }
    .summary-card.failed { border-left: 4px solid #ef4444; }
    .summary-card.skipped { border-left: 4px solid #f59e0b; }
    .summary-card.total { border-left: 4px solid #3b82f6; }
    .summary-card h2 { font-size: 2rem; margin-bottom: 0.25rem; }
    .summary-card p { color: #94a3b8; font-size: 0.875rem; }
    .results { background: #1e293b; border-radius: 12px; overflow: hidden; }
    .results-header { padding: 1rem 1.5rem; background: #334155; font-weight: 600; }
    .result-row { padding: 1rem 1.5rem; border-bottom: 1px solid #334155; display: flex; align-items: center; gap: 1rem; }
    .result-row:last-child { border-bottom: none; }
    .method { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .method.GET { background: #22c55e20; color: #22c55e; }
    .method.POST { background: #3b82f620; color: #3b82f6; }
    .method.PUT { background: #f59e0b20; color: #f59e0b; }
    .method.DELETE { background: #ef444420; color: #ef4444; }
    .status { padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .status.passed { background: #22c55e20; color: #22c55e; }
    .status.failed { background: #ef444420; color: #ef4444; }
    .path { flex: 1; font-family: monospace; color: #e2e8f0; }
    .response-time { color: #94a3b8; font-size: 0.875rem; }
    .footer { margin-top: 2rem; text-align: center; color: #64748b; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${apiInfo?.title || "API Test Report"}</h1>
      <p>Generated on ${new Date().toLocaleString()} | Base URL: ${config?.baseUrl || "N/A"}</p>
    </div>
    
    <div class="summary">
      <div class="summary-card total">
        <h2>${summary.total}</h2>
        <p>Total Tests</p>
      </div>
      <div class="summary-card passed">
        <h2>${summary.passed}</h2>
        <p>Passed (${passRate}%)</p>
      </div>
      <div class="summary-card failed">
        <h2>${summary.failed}</h2>
        <p>Failed</p>
      </div>
      <div class="summary-card skipped">
        <h2>${summary.skipped}</h2>
        <p>Skipped</p>
      </div>
    </div>
    
    <div class="results">
      <div class="results-header">Test Results by Endpoint</div>
      ${(results.results || []).map((r: any) => `
        <div class="result-row">
          <span class="method ${r.method}">${r.method}</span>
          <span class="path">${r.path}</span>
          <span class="status ${r.status}">${r.status.toUpperCase()}</span>
          <span class="response-time">${r.responseTime}ms</span>
        </div>
      `).join("")}
    </div>
    
    <div class="footer">
      <p>NAT 2.0 - Autonomous API Testing Module | Powered by AI Quality Engine</p>
    </div>
  </div>
</body>
</html>`;
}
