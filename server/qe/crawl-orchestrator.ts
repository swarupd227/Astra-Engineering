import { playwrightService, PageInfo } from './playwright-service';
import { Page } from 'playwright';
import type { CrawlProgress, WorkflowStep } from '@shared/qe-schema';

export interface CrawlConfig {
  maxDepth: number;
  maxPages: number;
  sameDomainOnly: boolean;
  timeout: number;
}

export interface DiscoveredWorkflow {
  id: string;
  type: 'form_submission' | 'navigation_path' | 'cta_flow';
  name: string;
  entryPoint: string;
  steps: WorkflowStep[];
  confidence: number;
}

function humanizeFieldName(name: string): string {
  if (!name) return 'field';
  
  // Remove common prefixes/suffixes
  let cleaned = name.replace(/^(input|field|txt|sel|chk|_wpc|wpc)[-_]?/i, '');
  cleaned = cleaned.replace(/[-_](input|field|txt|sel|chk)$/i, '');
  
  // Split by camelCase, snake_case, or kebab-case
  const words = cleaned
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);
  
  // Capitalize first letter of each word
  return words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export class CrawlOrchestrator {
  private config: CrawlConfig;
  private visitedUrls: Set<string> = new Set();
  private urlQueue: Array<{ url: string; depth: number }> = [];
  private pageInfoMap: Map<string, PageInfo> = new Map();
  private discoveredWorkflows: DiscoveredWorkflow[] = [];
  private progress: CrawlProgress = {
    status: 'initializing',
    pagesVisited: 0,
    pagesQueued: 0,
    formsFound: 0,
    buttonsFound: 0,
    inputsFound: 0,
  };

  constructor(config: Partial<CrawlConfig> = {}) {
    this.config = {
      maxDepth: config.maxDepth || 3,
      maxPages: config.maxPages || 20,
      sameDomainOnly: config.sameDomainOnly !== false,
      timeout: config.timeout || 30000,
    };
  }

  getProgress(): CrawlProgress {
    return { ...this.progress };
  }

  getDiscoveredWorkflows(): DiscoveredWorkflow[] {
    return [...this.discoveredWorkflows];
  }

  getNavigationGraph(): Map<string, PageInfo> {
    return new Map(this.pageInfoMap);
  }

  private isSameDomain(url1: string, url2: string): boolean {
    try {
      const host1 = new URL(url1).hostname;
      const host2 = new URL(url2).hostname;
      
      // Exact match
      if (host1 === host2) return true;
      
      // Allow subdomains of the main domain (e.g., docs.github.com for github.com)
      const getBaseDomain = (host: string) => {
        const parts = host.split('.');
        // Handle common TLDs
        if (parts.length >= 2) {
          return parts.slice(-2).join('.');
        }
        return host;
      };
      
      return getBaseDomain(host1) === getBaseDomain(host2);
    } catch {
      return false;
    }
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      parsed.search = '';
      return parsed.href;
    } catch {
      return url;
    }
  }

  async crawl(
    startUrl: string,
    onProgress?: (progress: CrawlProgress) => void
  ): Promise<{ pages: PageInfo[]; workflows: DiscoveredWorkflow[] }> {
    const contextId = `crawl-${Date.now()}`;
    
    this.visitedUrls.clear();
    this.urlQueue = [];
    this.pageInfoMap.clear();
    this.discoveredWorkflows = [];
    this.progress = {
      status: 'initializing',
      pagesVisited: 0,
      pagesQueued: 0,
      formsFound: 0,
      buttonsFound: 0,
      inputsFound: 0,
      currentUrl: startUrl,
    };
    
    try {
      onProgress?.(this.getProgress());

      await playwrightService.initialize();
      
      this.urlQueue.push({ url: startUrl, depth: 0 });
      this.progress.pagesQueued = 1;
      this.progress.status = 'crawling';
      onProgress?.(this.getProgress());

      while (
        this.urlQueue.length > 0 &&
        this.visitedUrls.size < this.config.maxPages
      ) {
        const { url, depth } = this.urlQueue.shift()!;

        if (this.visitedUrls.has(url) || depth > this.config.maxDepth) {
          continue;
        }

        try {
          console.log(`[Crawler] Visiting: ${url} (depth: ${depth})`);
          this.progress.currentUrl = url;
          onProgress?.(this.getProgress());

          const page = await playwrightService.navigateToPage(contextId, url);
          const pageInfo = await playwrightService.extractPageInfo(page);
          
          this.pageInfoMap.set(url, pageInfo);
          this.visitedUrls.add(url);
          this.progress.pagesVisited = this.visitedUrls.size;
          this.progress.formsFound += pageInfo.forms.length;
          this.progress.buttonsFound += pageInfo.buttons.length;
          this.progress.inputsFound += pageInfo.inputs.length;

          if (depth < this.config.maxDepth) {
            for (const link of pageInfo.links) {
              const normalizedLink = this.normalizeUrl(link);
              
              if (
                !this.visitedUrls.has(normalizedLink) &&
                (!this.config.sameDomainOnly || this.isSameDomain(startUrl, normalizedLink))
              ) {
                this.urlQueue.push({ url: normalizedLink, depth: depth + 1 });
              }
            }
          }

          this.progress.pagesQueued = this.urlQueue.length;
          onProgress?.(this.getProgress());

          await page.close();
        } catch (error: any) {
          console.error(`[Crawler] Error visiting ${url}:`, error.message);
        }
      }

      this.progress.status = 'analyzing';
      this.progress.currentUrl = undefined;
      onProgress?.(this.getProgress());

      this.discoveredWorkflows = this.analyzeWorkflows();

      this.progress.status = 'completed';
      onProgress?.(this.getProgress());

      return {
        pages: Array.from(this.pageInfoMap.values()),
        workflows: this.discoveredWorkflows,
      };
    } catch (error: any) {
      console.error('[Crawler] Crawl failed:', error);
      this.progress.status = 'error';
      this.progress.error = error.message;
      onProgress?.(this.getProgress());
      throw error;
    } finally {
      await playwrightService.closeContext(contextId);
    }
  }

  private analyzeWorkflows(): DiscoveredWorkflow[] {
    const workflows: DiscoveredWorkflow[] = [];
    const pages = Array.from(this.pageInfoMap.entries());

    for (const [url, pageInfo] of pages) {
      for (const form of pageInfo.forms) {
        const formWorkflow = this.analyzeFormWorkflow(url, form, pageInfo, workflows.length);
        if (formWorkflow) {
          workflows.push(formWorkflow);
        }
      }

      const navWorkflows = this.analyzeNavigationWorkflows(url, pageInfo, workflows.length);
      workflows.push(...navWorkflows);

      const ctaWorkflows = this.analyzeCTAWorkflows(url, pageInfo, workflows.length);
      workflows.push(...ctaWorkflows);
    }

    return workflows;
  }

  private analyzeFormWorkflow(
    url: string,
    form: any,
    pageInfo: PageInfo,
    workflowCount: number
  ): DiscoveredWorkflow | null {
    const formIndex = parseInt(form.selector.match(/nth-of-type\((\d+)\)/)?.[1] || '0') - 1;
    
    const inputs = pageInfo.inputs.filter(
      (input) => input.formIndex === formIndex
    );

    if (inputs.length === 0) {
      return null;
    }

    const formName = this.inferFormPurpose(form, inputs, pageInfo);
    const steps: WorkflowStep[] = [];

    steps.push({
      action: 'navigate',
      description: `Navigate to ${pageInfo.title || url}`,
      expectedOutcome: 'Page loads successfully',
    });

    for (const input of inputs) {
      // Use displayLabel (human-readable) with fallback to humanized name
      const fieldLabel = input.displayLabel || 
        (input.placeholder) || 
        (input.name ? humanizeFieldName(input.name) : null) ||
        (input.id ? humanizeFieldName(input.id) : null) ||
        input.type;
      
      steps.push({
        action: 'fill',
        description: `Fill ${fieldLabel} field`,
        selector: input.selector,
        expectedOutcome: 'Input accepts value',
      });
    }

    const submitButton = pageInfo.buttons.find((btn) =>
      btn.text?.toLowerCase().includes('submit') ||
      btn.text?.toLowerCase().includes('send') ||
      btn.selector.includes('submit')
    );

    if (submitButton) {
      steps.push({
        action: 'click',
        description: `Click ${submitButton.text || 'submit button'}`,
        selector: submitButton.selector,
        expectedOutcome: 'Form submits successfully',
      });
    }

    return {
      id: `workflow-${workflowCount + 1}`,
      type: 'form_submission',
      name: formName,
      entryPoint: url,
      steps,
      confidence: inputs.length > 2 && submitButton ? 0.9 : 0.6,
    };
  }

  private inferFormPurpose(form: any, inputs: any[], pageInfo: PageInfo): string {
    const combinedText = [
      form.name,
      form.id,
      ...inputs.map((i) => i.name || i.id || ''),
      ...pageInfo.h1,
    ]
      .join(' ')
      .toLowerCase();

    if (combinedText.includes('login') || combinedText.includes('sign in')) {
      return 'Login Form';
    }
    if (combinedText.includes('register') || combinedText.includes('sign up') || combinedText.includes('signup')) {
      return 'Registration Form';
    }
    if (combinedText.includes('contact') || combinedText.includes('message')) {
      return 'Contact Form';
    }
    if (combinedText.includes('search')) {
      return 'Search Form';
    }
    if (combinedText.includes('checkout') || combinedText.includes('payment')) {
      return 'Checkout Form';
    }
    return 'Generic Form Submission';
  }

  private analyzeNavigationWorkflows(url: string, pageInfo: PageInfo, workflowCount: number): DiscoveredWorkflow[] {
    const workflows: DiscoveredWorkflow[] = [];
    const navLinks = pageInfo.links.filter((link) => 
      this.visitedUrls.has(this.normalizeUrl(link))
    );

    if (navLinks.length >= 2) {
      const steps: WorkflowStep[] = [
        {
          action: 'navigate',
          description: `Start at ${pageInfo.title || url}`,
          expectedOutcome: 'Page loads successfully',
        },
      ];

      for (const link of navLinks.slice(0, 3)) {
        const targetPage = this.pageInfoMap.get(this.normalizeUrl(link));
        steps.push({
          action: 'click',
          description: `Navigate to ${targetPage?.title || link}`,
          selector: `a[href="${link}"]`,
          expectedOutcome: 'Page loads successfully',
        });
      }

      workflows.push({
        id: `workflow-${workflowCount + workflows.length + 1}`,
        type: 'navigation_path',
        name: `Navigation from ${pageInfo.title || url}`,
        entryPoint: url,
        steps,
        confidence: 0.7,
      });
    }

    return workflows;
  }

  private analyzeCTAWorkflows(url: string, pageInfo: PageInfo, workflowCount: number): DiscoveredWorkflow[] {
    const workflows: DiscoveredWorkflow[] = [];
    const ctaButtons = pageInfo.buttons.filter((btn) => {
      const text = btn.text?.toLowerCase() || '';
      return (
        text.includes('get started') ||
        text.includes('try now') ||
        text.includes('download') ||
        text.includes('subscribe') ||
        text.includes('buy') ||
        text.includes('add to cart')
      );
    });

    for (const button of ctaButtons) {
      workflows.push({
        id: `workflow-${workflowCount + workflows.length + 1}`,
        type: 'cta_flow',
        name: `${button.text} CTA`,
        entryPoint: url,
        steps: [
          {
            action: 'navigate',
            description: `Navigate to ${pageInfo.title || url}`,
            expectedOutcome: 'Page loads successfully',
          },
          {
            action: 'click',
            description: `Click "${button.text}"`,
            selector: button.selector,
            expectedOutcome: 'Action completes successfully',
          },
        ],
        confidence: 0.8,
      });
    }

    return workflows;
  }

  reset(): void {
    this.visitedUrls.clear();
    this.urlQueue = [];
    this.pageInfoMap.clear();
    this.discoveredWorkflows = [];
    this.progress = {
      status: 'initializing',
      pagesVisited: 0,
      pagesQueued: 0,
      formsFound: 0,
      buttonsFound: 0,
      inputsFound: 0,
    };
  }
}

export const crawlOrchestrator = new CrawlOrchestrator();
