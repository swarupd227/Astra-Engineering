import { chromium, Browser, Page } from 'playwright';
import { qeAnthropicClient as anthropic } from './ai-client.js';
import { getBrowserExecutablePath } from './playwright-setup';
import pRetry from "p-retry";
import pLimit from "p-limit";
import type { AccessibilityViolation, WCAGCriterion } from "@shared/qe-schema";

const limit = pLimit(2);

// ============================================
// Accessibility Scanning Service (axe-core)
// ============================================

export interface AccessibilityScanResult {
  url: string;
  status: string;
  overallScore: number;
  violationsCount: number;
  passesCount: number;
  incompleteCount: number;
  inapplicableCount: number;
  criticalCount: number;
  seriousCount: number;
  moderateCount: number;
  minorCount: number;
  violations: AccessibilityViolation[];
  passes: any[];
  incomplete: any[];
  wcagCriteria: WCAGCriterion[];
  aiAnalysis?: AccessibilityAIAnalysis;
  metadata: {
    browser: string;
    viewport: string;
    scanDuration: number;
    axeVersion: string;
  };
}

export interface AccessibilityAIAnalysis {
  summary: string;
  prioritizedIssues: {
    issue: string;
    impact: string;
    affectedUsers: string;
    remediation: string;
    codeExample?: string;
  }[];
  complianceStatus: {
    wcag21AA: boolean;
    section508: boolean;
    adaCompliance: boolean;
  };
  recommendations: string[];
  estimatedFixTime: string;
}

export async function runAccessibilityScan(url: string, wcagLevel: string = "AA"): Promise<AccessibilityScanResult> {
  let browser: Browser | null = null;
  const startTime = Date.now();
  
  try {
    console.log(`[nRadiVerse] Starting accessibility scan for: ${url}`);
    
    browser = await chromium.launch({
      headless: true,
      executablePath: getBrowserExecutablePath() ?? undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Inject and run axe-core
    const axeResults = await page.evaluate(async () => {
      // Inject axe-core script
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.8.3/axe.min.js';
      document.head.appendChild(script);
      
      // Wait for axe to load
      await new Promise((resolve) => {
        script.onload = resolve;
        setTimeout(resolve, 3000); // Fallback timeout
      });
      
      // Check if axe is available
      if (typeof (window as any).axe === 'undefined') {
        return null;
      }
      
      // Run axe analysis
      const results = await (window as any).axe.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']
        }
      });
      
      return results;
    });
    
    const scanDuration = Date.now() - startTime;
    
    if (!axeResults) {
      // Fallback with DOM analysis if axe failed to load (page still open)
      console.log('[nRadiVerse] axe-core failed to load, using DOM analysis fallback');
      const fallbackResult = await performDOMAccessibilityAnalysis(url, page, scanDuration);
      if (browser) {
        await browser.close();
        browser = null;
      }
      return fallbackResult;
    }
    
    // Process axe results (keep browser open for screenshot)
    const violations: AccessibilityViolation[] = axeResults.violations.map((v: any) => ({
      id: v.id,
      impact: v.impact as "critical" | "serious" | "moderate" | "minor",
      description: v.description,
      help: v.help,
      helpUrl: v.helpUrl,
      tags: v.tags,
      nodes: v.nodes.map((n: any) => ({
        html: n.html,
        target: n.target,
        failureSummary: n.failureSummary || n.any?.[0]?.message || 'Element failed this rule'
      }))
    }));
    
    const criticalCount = violations.filter(v => v.impact === 'critical').length;
    const seriousCount = violations.filter(v => v.impact === 'serious').length;
    const moderateCount = violations.filter(v => v.impact === 'moderate').length;
    const minorCount = violations.filter(v => v.impact === 'minor').length;
    
    // Calculate overall score (100 - weighted violations)
    const weightedScore = 100 - (criticalCount * 15) - (seriousCount * 10) - (moderateCount * 5) - (minorCount * 2);
    const overallScore = Math.max(0, Math.min(100, weightedScore));
    
    // Map to WCAG criteria
    const wcagCriteria = mapToWCAGCriteria(violations, axeResults.passes || []);
    
    // Capture screenshot for vision AI analysis (before closing browser)
    let screenshotBase64: string | undefined;
    try {
      const screenshotBuffer = await page.screenshot({ fullPage: true, type: 'png' });
      screenshotBase64 = screenshotBuffer.toString('base64');
      console.log('[nRadiVerse] Screenshot captured for vision AI analysis');
    } catch (screenshotError) {
      console.error('[nRadiVerse] Screenshot capture failed:', screenshotError);
    }
    
    // Close browser after screenshot
    await browser.close();
    browser = null;
    
    // Get AI analysis WITH vision (screenshot + violations)
    let aiAnalysis: AccessibilityAIAnalysis | undefined;
    try {
      aiAnalysis = await generateAccessibilityAIAnalysisWithVision(url, violations, screenshotBase64);
    } catch (error) {
      console.error('[nRadiVerse] AI analysis failed:', error);
    }
    
    return {
      url,
      status: 'completed',
      overallScore,
      violationsCount: violations.length,
      passesCount: axeResults.passes?.length || 0,
      incompleteCount: axeResults.incomplete?.length || 0,
      inapplicableCount: axeResults.inapplicable?.length || 0,
      criticalCount,
      seriousCount,
      moderateCount,
      minorCount,
      violations,
      passes: axeResults.passes || [],
      incomplete: axeResults.incomplete || [],
      wcagCriteria,
      aiAnalysis,
      metadata: {
        browser: 'Chromium',
        viewport: '1920x1080',
        scanDuration,
        axeVersion: '4.8.3'
      }
    };
    
  } catch (error: any) {
    console.error('[nRadiVerse] Accessibility scan error:', error);
    if (browser) await browser.close();
    throw new Error(`Accessibility scan failed: ${error.message}`);
  }
}

async function performDOMAccessibilityAnalysis(url: string, page: Page, scanDuration: number): Promise<AccessibilityScanResult> {
  // Perform basic DOM analysis when axe-core fails
  const domIssues = await page.evaluate(() => {
    const issues: any[] = [];
    
    // Check images without alt
    document.querySelectorAll('img:not([alt])').forEach((img, i) => {
      issues.push({
        id: 'image-alt',
        impact: 'critical',
        description: 'Images must have alternate text',
        help: 'All images must have an alt attribute that describes the image content',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/image-alt',
        tags: ['wcag2a', 'wcag111'],
        nodes: [{ html: img.outerHTML.substring(0, 200), target: [`img:nth-of-type(${i+1})`], failureSummary: 'Element has no alt attribute' }]
      });
    });
    
    // Check form inputs without labels
    document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])').forEach((input, i) => {
      const id = input.getAttribute('id');
      const hasLabel = id ? document.querySelector(`label[for="${id}"]`) : false;
      const hasAriaLabel = input.hasAttribute('aria-label') || input.hasAttribute('aria-labelledby');
      
      if (!hasLabel && !hasAriaLabel) {
        issues.push({
          id: 'label',
          impact: 'critical',
          description: 'Form elements must have labels',
          help: 'Ensure every form element has a corresponding label',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/label',
          tags: ['wcag2a', 'wcag412'],
          nodes: [{ html: (input as Element).outerHTML.substring(0, 200), target: [`input:nth-of-type(${i+1})`], failureSummary: 'Form element does not have an associated label' }]
        });
      }
    });
    
    // Check buttons without accessible names
    document.querySelectorAll('button').forEach((btn, i) => {
      if (!btn.textContent?.trim() && !btn.hasAttribute('aria-label')) {
        issues.push({
          id: 'button-name',
          impact: 'critical',
          description: 'Buttons must have discernible text',
          help: 'Buttons must have accessible name',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/button-name',
          tags: ['wcag2a', 'wcag412'],
          nodes: [{ html: btn.outerHTML.substring(0, 200), target: [`button:nth-of-type(${i+1})`], failureSummary: 'Button has no accessible name' }]
        });
      }
    });
    
    // Check links without accessible names
    document.querySelectorAll('a').forEach((link, i) => {
      if (!link.textContent?.trim() && !link.hasAttribute('aria-label') && !link.querySelector('img[alt]')) {
        issues.push({
          id: 'link-name',
          impact: 'serious',
          description: 'Links must have discernible text',
          help: 'Links must have accessible name',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/link-name',
          tags: ['wcag2a', 'wcag412'],
          nodes: [{ html: link.outerHTML.substring(0, 200), target: [`a:nth-of-type(${i+1})`], failureSummary: 'Link has no accessible name' }]
        });
      }
    });
    
    // Check document language
    if (!document.documentElement.hasAttribute('lang')) {
      issues.push({
        id: 'html-lang',
        impact: 'serious',
        description: 'HTML element must have a lang attribute',
        help: 'Page must have a valid lang attribute',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/html-lang',
        tags: ['wcag2a', 'wcag311'],
        nodes: [{ html: '<html>', target: ['html'], failureSummary: 'The html element does not have a lang attribute' }]
      });
    }
    
    return issues;
  });
  
  const violations = domIssues as AccessibilityViolation[];
  const criticalCount = violations.filter(v => v.impact === 'critical').length;
  const seriousCount = violations.filter(v => v.impact === 'serious').length;
  const moderateCount = violations.filter(v => v.impact === 'moderate').length;
  const minorCount = violations.filter(v => v.impact === 'minor').length;
  
  const overallScore = Math.max(0, 100 - (criticalCount * 15) - (seriousCount * 10) - (moderateCount * 5) - (minorCount * 2));
  
  // Capture screenshot for vision AI analysis
  let screenshotBase64: string | undefined;
  try {
    const screenshotBuffer = await page.screenshot({ fullPage: true, type: 'png' });
    screenshotBase64 = screenshotBuffer.toString('base64');
    console.log('[nRadiVerse] Screenshot captured for DOM fallback vision AI analysis');
  } catch (screenshotError) {
    console.error('[nRadiVerse] Screenshot capture failed:', screenshotError);
  }
  
  let aiAnalysis: AccessibilityAIAnalysis | undefined;
  try {
    aiAnalysis = await generateAccessibilityAIAnalysisWithVision(url, violations, screenshotBase64);
  } catch (error) {
    console.error('[nRadiVerse] AI analysis failed:', error);
  }
  
  return {
    url,
    status: 'completed',
    overallScore,
    violationsCount: violations.length,
    passesCount: 0,
    incompleteCount: 0,
    inapplicableCount: 0,
    criticalCount,
    seriousCount,
    moderateCount,
    minorCount,
    violations,
    passes: [],
    incomplete: [],
    wcagCriteria: mapToWCAGCriteria(violations, []),
    aiAnalysis,
    metadata: {
      browser: 'Chromium',
      viewport: '1920x1080',
      scanDuration,
      axeVersion: 'DOM-fallback'
    }
  };
}

function mapToWCAGCriteria(violations: AccessibilityViolation[], passes: any[]): WCAGCriterion[] {
  const criteriaMap: Record<string, WCAGCriterion> = {
    '1.1.1': { id: '1.1.1', level: 'A', principle: 'perceivable', status: 'pass' },
    '1.3.1': { id: '1.3.1', level: 'A', principle: 'perceivable', status: 'pass' },
    '1.4.3': { id: '1.4.3', level: 'AA', principle: 'perceivable', status: 'pass' },
    '1.4.11': { id: '1.4.11', level: 'AA', principle: 'perceivable', status: 'pass' },
    '2.1.1': { id: '2.1.1', level: 'A', principle: 'operable', status: 'pass' },
    '2.1.2': { id: '2.1.2', level: 'A', principle: 'operable', status: 'pass' },
    '2.4.3': { id: '2.4.3', level: 'A', principle: 'operable', status: 'pass' },
    '2.4.6': { id: '2.4.6', level: 'AA', principle: 'operable', status: 'pass' },
    '3.1.1': { id: '3.1.1', level: 'A', principle: 'understandable', status: 'pass' },
    '3.2.1': { id: '3.2.1', level: 'A', principle: 'understandable', status: 'pass' },
    '3.3.1': { id: '3.3.1', level: 'A', principle: 'understandable', status: 'pass' },
    '4.1.1': { id: '4.1.1', level: 'A', principle: 'robust', status: 'pass' },
    '4.1.2': { id: '4.1.2', level: 'A', principle: 'robust', status: 'pass' },
  };
  
  // Map violations to WCAG criteria
  for (const violation of violations) {
    for (const tag of violation.tags) {
      // Extract WCAG criterion number from tags like "wcag111" -> "1.1.1"
      const match = tag.match(/wcag(\d)(\d)(\d+)/);
      if (match) {
        const criterionId = `${match[1]}.${match[2]}.${match[3]}`;
        if (criteriaMap[criterionId]) {
          criteriaMap[criterionId].status = 'fail';
          criteriaMap[criterionId].violations = (criteriaMap[criterionId].violations || 0) + 1;
        }
      }
    }
  }
  
  return Object.values(criteriaMap);
}

async function generateAccessibilityAIAnalysisWithVision(
  url: string, 
  violations: AccessibilityViolation[],
  screenshotBase64?: string
): Promise<AccessibilityAIAnalysis> {
  const violationsSummary = violations.map(v => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    elementsAffected: v.nodes.length
  }));
  
  const prompt = `You are an expert accessibility auditor analyzing a web page screenshot for WCAG 2.1 AA compliance. This is a healthcare application where accessibility is CRITICAL for users with disabilities.

URL: ${url}

AUTOMATED ACCESSIBILITY VIOLATIONS FOUND BY AXE-CORE:
${JSON.stringify(violationsSummary, null, 2)}

DETAILED VIOLATIONS:
${violations.slice(0, 8).map(v => `
- ${v.id} (${v.impact}): ${v.description}
  Help: ${v.help}
  Affected elements: ${v.nodes.length}
  Example: ${v.nodes[0]?.html?.substring(0, 150) || 'N/A'}
`).join('\n')}

YOUR TASK - VISUAL ACCESSIBILITY AUDIT:
${screenshotBase64 ? `
1. CAREFULLY EXAMINE the screenshot of the page
2. IDENTIFY additional accessibility issues that automated tools cannot detect:
   - Color contrast issues (text over images, gradients)
   - Text that is too small or hard to read
   - Missing focus indicators or unclear interactive elements
   - Poor visual hierarchy that affects comprehension
   - Icons without visible text labels
   - Images that appear to convey information without alt text
   - Form fields that lack visible labels
   - Touch targets that appear too small (< 44x44 px)
   - Content that may be affected by color blindness
   - Animations or moving content that could cause issues
3. COMBINE your visual analysis with the automated findings
` : `
Analyze the automated findings and provide recommendations.
`}

WCAG 2.1 AA SUCCESS CRITERIA TO CHECK:
- 1.1.1 Non-text Content (alt text for images)
- 1.3.1 Info and Relationships (proper headings, labels)
- 1.4.1 Use of Color (don't use color alone to convey info)
- 1.4.3 Contrast (Minimum) (4.5:1 for normal text, 3:1 for large)
- 1.4.4 Resize Text (up to 200% without loss)
- 1.4.10 Reflow (responsive at 320px width)
- 1.4.11 Non-text Contrast (3:1 for UI components)
- 2.1.1 Keyboard (all functionality via keyboard)
- 2.4.3 Focus Order (logical navigation order)
- 2.4.4 Link Purpose (clear link text)
- 2.4.6 Headings and Labels (descriptive)
- 2.4.7 Focus Visible (visible focus indicator)
- 3.1.1 Language of Page (html lang attribute)
- 3.3.1 Error Identification (clear error messages)
- 3.3.2 Labels or Instructions (form instructions)
- 4.1.2 Name, Role, Value (ARIA for custom controls)

Return valid JSON with this structure:
{
  "summary": "Comprehensive accessibility assessment based on BOTH automated testing AND visual inspection. Include specific issues you SEE in the screenshot.",
  "prioritizedIssues": [
    {
      "issue": "Specific accessibility issue identified",
      "impact": "How this affects users with disabilities",
      "affectedUsers": "Screen reader users, keyboard users, low vision users, color blind users, etc.",
      "remediation": "Step-by-step fix instructions with specific guidance",
      "codeExample": "HTML/CSS/ARIA code fix example"
    }
  ],
  "complianceStatus": {
    "wcag21AA": false,
    "section508": false,
    "adaCompliance": false
  },
  "recommendations": [
    "Priority recommendation 1 with specific action",
    "Priority recommendation 2 with specific action",
    "Priority recommendation 3 with specific action"
  ],
  "estimatedFixTime": "X hours/days based on issue complexity"
}

Provide 5-10 prioritized issues, ranked by impact. Include BOTH automated findings AND visual observations.`;

  // Build message content - include screenshot if available
  const messageContent: any[] = [];
  
  if (screenshotBase64) {
    messageContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png" as const,
        data: screenshotBase64,
      },
    });
    console.log('[nRadiVerse] Including screenshot in vision AI analysis');
  }
  
  messageContent.push({
    type: "text",
    text: prompt,
  });

  const response = await pRetry(
    async () => {
      return await limit(async () => {
        const result = await anthropic.messages.create({
          model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          messages: [{
            role: "user",
            content: messageContent,
          }],
        });
        return result;
      });
    },
    { retries: 2, minTimeout: 1000 }
  );
  
  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }
  
  console.log('[nRadiVerse] Vision AI accessibility analysis received');
  
  // Extract JSON from response with robust parsing
  const jsonMatch = content.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[nRadiVerse] No JSON found in response:', content.text.substring(0, 500));
    throw new Error('No JSON found in response');
  }
  
  // Clean and parse JSON with fallback
  let jsonStr = jsonMatch[0];
  
  // Try to parse directly first
  try {
    return JSON.parse(jsonStr);
  } catch (parseError) {
    console.log('[nRadiVerse] Initial JSON parse failed, attempting cleanup...');
    
    // Clean common JSON issues from LLM responses
    jsonStr = jsonStr
      .replace(/,\s*}/g, '}')  // Remove trailing commas before }
      .replace(/,\s*]/g, ']')  // Remove trailing commas before ]
      .replace(/[\x00-\x1F\x7F]/g, ' ')  // Remove control characters
      .replace(/\n\s*\n/g, '\n')  // Collapse multiple newlines
      .replace(/\\n/g, ' ')  // Replace escaped newlines with space in strings
      .replace(/\t/g, ' ');  // Replace tabs with space
    
    try {
      return JSON.parse(jsonStr);
    } catch (secondError) {
      // As a last resort, try to extract key fields manually
      console.error('[nRadiVerse] JSON cleanup failed, using fallback response');
      
      // Return a minimal valid response
      return {
        summary: "AI analysis completed but response parsing encountered issues. Please review the automated scan results below.",
        prioritizedIssues: [],
        complianceStatus: {
          wcag21AA: false,
          section508: false,
          adaCompliance: false
        },
        recommendations: ["Re-run the scan for detailed AI analysis"],
        estimatedFixTime: "Unknown"
      };
    }
  }
}

// ============================================
// Image Comparison Service (pixelmatch, ssim)
// ============================================

export interface ImageComparisonResult {
  diffPercentage: number;
  ssimScore: number;
  psnrScore: number;
  mseScore: number;
  pixelsDifferent: number;
  totalPixels: number;
  histogramCorrelation: number;
  diffImageData?: string;
  status: 'pass' | 'warning' | 'fail';
  aiAnalysis?: ImageAIAnalysis;
}

export interface ImageAIAnalysis {
  summary: string;
  significantDifferences: {
    region: string;
    description: string;
    severity: string;
    likelyImpact: string;
  }[];
  recommendations: string[];
  overallAssessment: string;
}

export async function compareImages(
  baselineBase64: string,
  currentBase64: string,
  threshold: number = 0.1
): Promise<ImageComparisonResult> {
  try {
    // Import dependencies dynamically
    const pixelmatch = (await import('pixelmatch')).default;
    const { PNG } = await import('pngjs');
    const { ssim } = await import('ssim.js');
    
    // Extract base64 data (remove data URL prefix if present)
    const getBase64Data = (str: string) => {
      const match = str.match(/^data:image\/\w+;base64,(.+)$/);
      return match ? match[1] : str;
    };
    
    const baselineData = Buffer.from(getBase64Data(baselineBase64), 'base64');
    const currentData = Buffer.from(getBase64Data(currentBase64), 'base64');
    
    // Parse PNG images
    const baselinePng = PNG.sync.read(baselineData);
    const currentPng = PNG.sync.read(currentData);
    
    // Check if dimensions match
    const baselineWidth = baselinePng.width;
    const baselineHeight = baselinePng.height;
    const currentWidth = currentPng.width;
    const currentHeight = currentPng.height;
    
    // Use baseline dimensions as the target
    const width = baselineWidth;
    const height = baselineHeight;
    const totalPixels = width * height;
    
    // If dimensions don't match, we need to crop/resize the current image
    let currentImageData = currentPng.data;
    if (currentWidth !== baselineWidth || currentHeight !== baselineHeight) {
      console.log(`[nRadiVerse] Image size mismatch: baseline ${baselineWidth}x${baselineHeight}, current ${currentWidth}x${currentHeight}. Cropping to match.`);
      
      // Create a new buffer for the cropped/resized current image
      const croppedCurrent = new PNG({ width, height });
      
      // Copy pixels from current to cropped (crop to smaller common area)
      const copyWidth = Math.min(baselineWidth, currentWidth);
      const copyHeight = Math.min(baselineHeight, currentHeight);
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const targetIdx = (y * width + x) * 4;
          
          if (x < copyWidth && y < copyHeight && x < currentWidth && y < currentHeight) {
            // Copy from current image
            const sourceIdx = (y * currentWidth + x) * 4;
            croppedCurrent.data[targetIdx] = currentPng.data[sourceIdx];
            croppedCurrent.data[targetIdx + 1] = currentPng.data[sourceIdx + 1];
            croppedCurrent.data[targetIdx + 2] = currentPng.data[sourceIdx + 2];
            croppedCurrent.data[targetIdx + 3] = currentPng.data[sourceIdx + 3];
          } else {
            // Fill with magenta to highlight size difference
            croppedCurrent.data[targetIdx] = 255;     // R
            croppedCurrent.data[targetIdx + 1] = 0;   // G
            croppedCurrent.data[targetIdx + 2] = 255; // B
            croppedCurrent.data[targetIdx + 3] = 255; // A
          }
        }
      }
      currentImageData = croppedCurrent.data;
    }
    
    // Create diff image
    const diffPng = new PNG({ width, height });
    
    // Run pixelmatch comparison
    const pixelsDifferent = pixelmatch(
      baselinePng.data,
      currentImageData,
      diffPng.data,
      width,
      height,
      { threshold, includeAA: true }
    );
    
    const diffPercentage = (pixelsDifferent / totalPixels) * 100;
    
    // Calculate SSIM score using ssim.js
    let ssimScore = 0.95; // Default fallback
    try {
      const ssimResult = ssim(
        { data: baselinePng.data, width, height },
        { data: currentImageData, width, height }
      );
      ssimScore = ssimResult.mssim;
    } catch (ssimError) {
      console.warn('[nRadiVerse] SSIM calculation failed, using fallback:', ssimError);
    }
    
    // Calculate MSE (Mean Squared Error)
    let mseSum = 0;
    const dataLength = width * height * 4;
    for (let i = 0; i < dataLength; i += 4) {
      const rDiff = baselinePng.data[i] - currentImageData[i];
      const gDiff = baselinePng.data[i + 1] - currentImageData[i + 1];
      const bDiff = baselinePng.data[i + 2] - currentImageData[i + 2];
      mseSum += (rDiff * rDiff + gDiff * gDiff + bDiff * bDiff) / 3;
    }
    const mseScore = mseSum / totalPixels;
    
    // Calculate PSNR (Peak Signal-to-Noise Ratio)
    const maxPixelValue = 255;
    const psnrScore = mseScore > 0 ? 10 * Math.log10((maxPixelValue * maxPixelValue) / mseScore) : 100;
    
    // Calculate histogram correlation
    const histogramCorrelation = calculateHistogramCorrelation(baselinePng.data, currentImageData);
    
    // Encode diff image to base64
    const diffBuffer = PNG.sync.write(diffPng);
    const diffImageData = `data:image/png;base64,${diffBuffer.toString('base64')}`;
    
    // Determine status based on thresholds
    let status: 'pass' | 'warning' | 'fail';
    if (ssimScore >= 0.95 && diffPercentage < 1) {
      status = 'pass';
    } else if (ssimScore >= 0.85 || diffPercentage < 5) {
      status = 'warning';
    } else {
      status = 'fail';
    }
    
    // Generate AI analysis for significant differences
    let aiAnalysis: ImageAIAnalysis | undefined;
    if (diffPercentage > 0.5 || ssimScore < 0.95) {
      try {
        aiAnalysis = await generateImageAIAnalysis(diffPercentage, ssimScore, psnrScore, mseScore, pixelsDifferent, totalPixels);
      } catch (error) {
        console.error('[nRadiVerse] Image AI analysis failed:', error);
      }
    }
    
    return {
      diffPercentage,
      ssimScore,
      psnrScore,
      mseScore,
      pixelsDifferent,
      totalPixels,
      histogramCorrelation,
      diffImageData,
      status,
      aiAnalysis
    };
    
  } catch (error: any) {
    console.error('[nRadiVerse] Image comparison error:', error);
    throw new Error(`Image comparison failed: ${error.message}`);
  }
}

// ============================================
// Medical Image Comparison Service
// ============================================

export interface MedicalAIAnalysis {
  summary: string;
  clinicalFindings: {
    finding: string;
    location: string;
    significance: string;
    changeType: 'improvement' | 'regression' | 'stable' | 'new';
  }[];
  overallAssessment: 'significant_improvement' | 'moderate_improvement' | 'stable' | 'slight_regression' | 'significant_regression';
  recommendations: string[];
  technicalNotes: string;
}

export interface MedicalComparisonResult {
  metrics: {
    ssim: number;
    psnr: number;
    mse: number;
    diffPercentage: number;
    pixelsDifferent: number;
    totalPixels: number;
    histogramCorrelation: number;
  };
  diffImage: string;
  aiAnalysis?: MedicalAIAnalysis;
}

export async function compareMedicalImages(
  beforeImage: string,
  afterImage: string,
  threshold: number = 0.1,
  antiAliasing: boolean = true
): Promise<MedicalComparisonResult> {
  console.log('[nRadiVerse] Starting medical image comparison');
  
  // Use existing comparison logic
  const result = await compareImages(beforeImage, afterImage, threshold);
  
  // Generate medical-context AI analysis WITH actual images
  let aiAnalysis: MedicalAIAnalysis | undefined;
  try {
    aiAnalysis = await generateMedicalAIAnalysisWithVision(
      beforeImage,
      afterImage,
      result.diffPercentage,
      result.ssimScore,
      result.psnrScore,
      result.mseScore,
      result.pixelsDifferent,
      result.totalPixels
    );
    console.log('[nRadiVerse] Medical AI analysis with vision generated successfully');
  } catch (error) {
    console.error('[nRadiVerse] Medical AI analysis failed:', error);
  }
  
  return {
    metrics: {
      ssim: result.ssimScore,
      psnr: result.psnrScore,
      mse: result.mseScore,
      diffPercentage: result.diffPercentage,
      pixelsDifferent: result.pixelsDifferent,
      totalPixels: result.totalPixels,
      histogramCorrelation: result.histogramCorrelation
    },
    diffImage: result.diffImageData || afterImage,
    aiAnalysis
  };
}

async function generateMedicalAIAnalysisWithVision(
  beforeImage: string,
  afterImage: string,
  diffPercentage: number,
  ssimScore: number,
  psnrScore: number,
  mseScore: number,
  pixelsDifferent: number,
  totalPixels: number
): Promise<MedicalAIAnalysis> {
  // Extract base64 data from data URLs
  const extractBase64 = (dataUrl: string): { data: string; mediaType: string } => {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { mediaType: match[1], data: match[2] };
    }
    // If not a data URL, assume it's raw base64 PNG
    return { mediaType: 'image/png', data: dataUrl };
  };

  const before = extractBase64(beforeImage);
  const after = extractBase64(afterImage);

  const prompt = `You are an experienced radiologist analyzing two medical images: a BEFORE treatment image and an AFTER treatment image. These could be X-rays, CT scans, MRI scans, ultrasound images, or other medical imaging modalities.

IMPORTANT: You are viewing the ACTUAL medical images. The first image is BEFORE treatment, the second image is AFTER treatment.

QUANTITATIVE COMPARISON METRICS:
- Structural Similarity (SSIM): ${ssimScore.toFixed(4)} (1.0 = identical)
- PSNR: ${psnrScore.toFixed(2)} dB
- MSE: ${mseScore.toFixed(4)}
- Pixel Difference: ${diffPercentage.toFixed(4)}% (${pixelsDifferent.toLocaleString()} of ${totalPixels.toLocaleString()} pixels changed)

YOUR TASK:
1. CAREFULLY EXAMINE both images visually
2. IDENTIFY the type of medical imaging (X-ray, CT, MRI, etc.) and the anatomical region shown
3. DESCRIBE specific visible abnormalities, lesions, masses, or pathologies in the BEFORE image
4. COMPARE with the AFTER image - note what has changed, improved, worsened, or remained stable
5. Provide CLINICAL FINDINGS based on what you actually SEE in the images
6. Give RECOMMENDATIONS for the treating physician

Return your analysis as valid JSON in this exact format:
{
  "summary": "A detailed 3-4 sentence clinical summary describing what you observe in both images, the type of imaging, anatomical region, and your overall impression of the treatment response",
  "clinicalFindings": [
    {
      "finding": "Specific finding name (e.g., 'Right lower lobe opacity', 'Renal calculus', 'Pulmonary nodule')",
      "location": "Precise anatomical location (e.g., 'Right lower lung field', 'Left kidney mid-pole', 'Right upper quadrant')",
      "significance": "Clinical significance - describe what you SEE and what it means (size changes, density changes, resolution, etc.)",
      "changeType": "improvement" | "regression" | "stable" | "new"
    }
  ],
  "overallAssessment": "significant_improvement" | "moderate_improvement" | "stable" | "slight_regression" | "significant_regression",
  "recommendations": [
    "Specific clinical recommendation based on your findings",
    "Follow-up imaging recommendation with timeframe if needed",
    "Additional workup or consultation recommendations"
  ],
  "technicalNotes": "Notes about image quality, positioning, technique, or any limitations affecting interpretation"
}

GUIDELINES FOR ASSESSMENT:
- significant_improvement: Clear visible reduction in pathology (e.g., tumor shrinkage >50%, resolution of infiltrates, cleared stones)
- moderate_improvement: Partial improvement visible (e.g., decreased opacity, smaller lesions, partial resolution)
- stable: No significant visible change in pathology
- slight_regression: Mild worsening visible (e.g., slight enlargement, new small findings)
- significant_regression: Clear worsening (e.g., increased size, new significant pathology, spread)

Provide 3-6 clinical findings based on what you actually observe, and 3-4 specific recommendations.`;

  const response = await pRetry(
    async () => {
      return await limit(async () => {
        const result = await anthropic.messages.create({
          model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: before.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                  data: before.data,
                },
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: after.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                  data: after.data,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          }],
        });
        return result;
      });
    },
    { retries: 2, minTimeout: 1000 }
  );
  
  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }
  
  console.log('[nRadiVerse] Vision AI response received, parsing JSON...');
  
  const jsonMatch = content.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[nRadiVerse] No JSON found in response:', content.text.substring(0, 500));
    throw new Error('No JSON found in response');
  }
  
  const parsed = JSON.parse(jsonMatch[0]);
  
  // Validate and normalize the response
  return {
    summary: parsed.summary || 'Medical image analysis completed.',
    clinicalFindings: Array.isArray(parsed.clinicalFindings) ? parsed.clinicalFindings : [],
    overallAssessment: parsed.overallAssessment || 'stable',
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    technicalNotes: parsed.technicalNotes || ''
  };
}

function calculateHistogramCorrelation(data1: Buffer, data2: Buffer): number {
  // Calculate RGB histograms
  const hist1 = new Array(256).fill(0);
  const hist2 = new Array(256).fill(0);
  
  for (let i = 0; i < data1.length; i += 4) {
    const gray1 = Math.round((data1[i] + data1[i + 1] + data1[i + 2]) / 3);
    const gray2 = Math.round((data2[i] + data2[i + 1] + data2[i + 2]) / 3);
    hist1[gray1]++;
    hist2[gray2]++;
  }
  
  // Calculate correlation
  const mean1 = hist1.reduce((a, b) => a + b, 0) / 256;
  const mean2 = hist2.reduce((a, b) => a + b, 0) / 256;
  
  let numerator = 0;
  let denom1 = 0;
  let denom2 = 0;
  
  for (let i = 0; i < 256; i++) {
    const diff1 = hist1[i] - mean1;
    const diff2 = hist2[i] - mean2;
    numerator += diff1 * diff2;
    denom1 += diff1 * diff1;
    denom2 += diff2 * diff2;
  }
  
  const correlation = numerator / (Math.sqrt(denom1 * denom2) + 0.0001);
  return Math.max(0, Math.min(1, (correlation + 1) / 2));
}

async function generateImageAIAnalysis(
  diffPercentage: number,
  ssimScore: number,
  psnrScore: number,
  mseScore: number,
  pixelsDifferent: number,
  totalPixels: number
): Promise<ImageAIAnalysis> {
  const prompt = `You are a visual quality analyst for medical imaging applications. Analyze these image comparison metrics and provide insights.

IMAGE COMPARISON METRICS:
- Difference Percentage: ${diffPercentage.toFixed(4)}%
- SSIM Score: ${ssimScore.toFixed(4)} (target: >0.95)
- PSNR: ${psnrScore.toFixed(2)} dB (target: >30 dB)
- MSE: ${mseScore.toFixed(4)}
- Pixels Different: ${pixelsDifferent.toLocaleString()} of ${totalPixels.toLocaleString()}

CONTEXT: This is visual regression testing for a healthcare/medical imaging application where visual accuracy is critical.

Provide analysis including:
1. Summary of the visual differences detected
2. Identify potential regions/types of differences (layout shifts, color changes, missing elements)
3. Assess severity and impact on user experience
4. Recommendations for the development team

Return valid JSON:
{
  "summary": "Brief overall assessment",
  "significantDifferences": [
    {
      "region": "Potential affected area",
      "description": "What might have changed",
      "severity": "critical/major/minor",
      "likelyImpact": "Impact on users"
    }
  ],
  "recommendations": ["Recommendation 1", "Recommendation 2"],
  "overallAssessment": "Detailed assessment and next steps"
}`;

  const response = await pRetry(
    async () => {
      return await limit(async () => {
        const result = await anthropic.messages.create({
          model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        });
        return result;
      });
    },
    { retries: 2, minTimeout: 1000 }
  );
  
  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }
  
  const jsonMatch = content.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }
  
  return JSON.parse(jsonMatch[0]);
}

// ============================================
// Responsive Testing Service
// ============================================

export interface ResponsiveTestResult {
  url: string;
  status: string;
  overallScore: number;
  devicesTestedCount: number;
  passedDevicesCount: number;
  failedDevicesCount: number;
  deviceResults: DeviceResult[];
  aiAnalysis?: ResponsiveAIAnalysis;
}

export interface DeviceResult {
  deviceName: string;
  deviceType: string;
  viewport: { width: number; height: number };
  orientation: string;
  browser: string;
  status: string;
  score: number;
  issues: string[];
  screenshotData?: string;
}

export interface ResponsiveAIAnalysis {
  summary: string;
  criticalIssues: string[];
  deviceSpecificRecommendations: {
    deviceCategory: string;
    issues: string[];
    fixes: string[];
  }[];
  prioritizedFixes: string[];
}

export async function runResponsiveTest(url: string, devices: string[]): Promise<ResponsiveTestResult> {
  const deviceConfigs: Record<string, { name: string; type: string; width: number; height: number }> = {
    "iphone-15-pro": { name: "iPhone 15 Pro", type: "mobile", width: 393, height: 852 },
    "iphone-14": { name: "iPhone 14", type: "mobile", width: 390, height: 844 },
    "iphone-se": { name: "iPhone SE", type: "mobile", width: 375, height: 667 },
    "galaxy-s23": { name: "Samsung Galaxy S23", type: "mobile", width: 360, height: 780 },
    "pixel-7": { name: "Google Pixel 7", type: "mobile", width: 412, height: 915 },
    "ipad-pro-12": { name: "iPad Pro 12.9\"", type: "tablet", width: 1024, height: 1366 },
    "ipad-air": { name: "iPad Air", type: "tablet", width: 820, height: 1180 },
    "ipad-mini": { name: "iPad Mini", type: "tablet", width: 768, height: 1024 },
    "surface-pro": { name: "Surface Pro 9", type: "tablet", width: 912, height: 1368 },
    "hd": { name: "HD (1366x768)", type: "desktop", width: 1366, height: 768 },
    "fhd": { name: "Full HD (1920x1080)", type: "desktop", width: 1920, height: 1080 },
    "2k": { name: "2K (2560x1440)", type: "desktop", width: 2560, height: 1440 },
    "4k": { name: "4K (3840x2160)", type: "desktop", width: 3840, height: 2160 },
    "barco-3mp": { name: "Barco Coronis 3MP", type: "medical", width: 1536, height: 2048 },
    "barco-5mp": { name: "Barco Coronis 5MP", type: "medical", width: 2048, height: 2560 },
    "eizo-rx": { name: "EIZO RadiForce RX", type: "medical", width: 2560, height: 1600 },
  };
  
  let browser: Browser | null = null;
  const deviceResults: DeviceResult[] = [];
  
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: getBrowserExecutablePath() ?? undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    
    const devicesToTest = devices.length > 0 ? devices : Object.keys(deviceConfigs).slice(0, 6);
    
    for (const deviceId of devicesToTest) {
      const config = deviceConfigs[deviceId];
      if (!config) continue;
      
      try {
        const context = await browser.newContext({
          viewport: { width: config.width, height: config.height },
          userAgent: config.type === 'mobile' 
            ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
            : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          isMobile: config.type === 'mobile',
          hasTouch: config.type === 'mobile' || config.type === 'tablet',
        });
        
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        
        // Analyze responsive issues
        const issues = await page.evaluate((viewport) => {
          const issuesList: string[] = [];
          
          // Check for horizontal overflow
          if (document.body.scrollWidth > viewport.width) {
            issuesList.push('Horizontal scrolling detected - content overflows viewport');
          }
          
          // Check touch targets on mobile
          if (viewport.width < 768) {
            document.querySelectorAll('button, a, input, [role="button"]').forEach((el) => {
              const rect = el.getBoundingClientRect();
              if (rect.width < 44 || rect.height < 44) {
                issuesList.push(`Touch target too small: ${el.tagName} (${Math.round(rect.width)}x${Math.round(rect.height)}px)`);
              }
            });
          }
          
          // Check for fixed position elements that might cause issues
          document.querySelectorAll('[style*="position: fixed"], [style*="position:fixed"]').forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.width > viewport.width * 0.8) {
              issuesList.push('Large fixed element may cause layout issues');
            }
          });
          
          // Check for font sizes too small for mobile
          if (viewport.width < 768) {
            document.querySelectorAll('p, span, div, li').forEach((el) => {
              const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
              if (fontSize < 14 && el.textContent?.trim()) {
                issuesList.push(`Font size may be too small for mobile (${fontSize}px)`);
              }
            });
          }
          
          // Limit issues to avoid overwhelming the report
          return [...new Set(issuesList)].slice(0, 5);
        }, { width: config.width, height: config.height });
        
        // Take screenshot
        const screenshotBuffer = await page.screenshot({ fullPage: false });
        const screenshotData = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
        
        // Calculate score based on issues
        const score = Math.max(60, 100 - (issues.length * 8));
        const status = issues.length === 0 ? 'pass' : issues.length <= 2 ? 'warning' : 'fail';
        
        deviceResults.push({
          deviceName: config.name,
          deviceType: config.type,
          viewport: { width: config.width, height: config.height },
          orientation: config.height > config.width ? 'portrait' : 'landscape',
          browser: 'Chromium',
          status,
          score,
          issues,
          screenshotData
        });
        
        await context.close();
        
      } catch (deviceError: any) {
        console.error(`[nRadiVerse] Device test failed for ${deviceId}:`, deviceError.message);
        deviceResults.push({
          deviceName: config.name,
          deviceType: config.type,
          viewport: { width: config.width, height: config.height },
          orientation: config.height > config.width ? 'portrait' : 'landscape',
          browser: 'Chromium',
          status: 'fail',
          score: 0,
          issues: [`Test failed: ${deviceError.message}`]
        });
      }
    }
    
    await browser.close();
    browser = null;
    
    const passedCount = deviceResults.filter(r => r.status === 'pass').length;
    const failedCount = deviceResults.filter(r => r.status === 'fail').length;
    const overallScore = deviceResults.length > 0 
      ? Math.round(deviceResults.reduce((sum, r) => sum + r.score, 0) / deviceResults.length)
      : 0;
    
    // Generate AI analysis
    let aiAnalysis: ResponsiveAIAnalysis | undefined;
    const allIssues = deviceResults.flatMap(r => r.issues);
    if (allIssues.length > 0) {
      try {
        aiAnalysis = await generateResponsiveAIAnalysis(url, deviceResults);
      } catch (error) {
        console.error('[nRadiVerse] Responsive AI analysis failed:', error);
      }
    }
    
    return {
      url,
      status: 'completed',
      overallScore,
      devicesTestedCount: deviceResults.length,
      passedDevicesCount: passedCount,
      failedDevicesCount: failedCount,
      deviceResults,
      aiAnalysis
    };
    
  } catch (error: any) {
    if (browser) await browser.close();
    throw new Error(`Responsive test failed: ${error.message}`);
  }
}

async function generateResponsiveAIAnalysis(url: string, deviceResults: DeviceResult[]): Promise<ResponsiveAIAnalysis> {
  const issuesSummary = deviceResults.map(d => ({
    device: d.deviceName,
    type: d.deviceType,
    status: d.status,
    score: d.score,
    issues: d.issues
  }));
  
  const prompt = `You are a responsive design expert analyzing cross-device testing results for a healthcare application.

URL: ${url}

DEVICE TEST RESULTS:
${JSON.stringify(issuesSummary, null, 2)}

Provide comprehensive responsive design analysis including:
1. Summary of overall responsive design quality
2. Critical issues that need immediate attention
3. Device-specific recommendations grouped by category (mobile, tablet, desktop, medical displays)
4. Prioritized list of fixes with implementation guidance

Return valid JSON:
{
  "summary": "Overall responsive design assessment",
  "criticalIssues": ["Issue 1", "Issue 2"],
  "deviceSpecificRecommendations": [
    {
      "deviceCategory": "mobile",
      "issues": ["Issue 1"],
      "fixes": ["Fix 1 with CSS/HTML guidance"]
    }
  ],
  "prioritizedFixes": ["Most important fix first", "Second priority"]
}`;

  const response = await pRetry(
    async () => {
      return await limit(async () => {
        const result = await anthropic.messages.create({
          model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        });
        return result;
      });
    },
    { retries: 2, minTimeout: 1000 }
  );
  
  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }
  
  const jsonMatch = content.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }
  
  return JSON.parse(jsonMatch[0]);
}
