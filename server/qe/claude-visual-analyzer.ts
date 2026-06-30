import { qeAnthropicClient as anthropic } from './ai-client.js';
import pRetry from "p-retry";
import pLimit from "p-limit";

const limit = pLimit(3);

function isRateLimitError(error: any): boolean {
  if (!error) return false;
  const errorMsg = error.message || error.toString();
  return (
    errorMsg.includes("rate_limit") ||
    errorMsg.includes("429") ||
    errorMsg.toLowerCase().includes("rate limit")
  );
}

export interface VisualDifference {
  area: string;
  severity: 'critical' | 'major' | 'minor';
  description: string;
  expectedValue: string;
  actualValue: string;
  suggestion: string;
}

export interface VisualAnalysisResult {
  totalDifferences: number;
  criticalIssues: number;
  majorIssues: number;
  minorIssues: number;
  differences: VisualDifference[];
  overallAssessment: string;
  recommendations: string[];
}

export async function analyzeVisualDifferencesWithClaude(
  designDescription: string,
  liveWebsiteDescription: string,
  screenshotContext?: string
): Promise<VisualAnalysisResult> {
  const prompt = `You are an expert UI/UX quality analyst specializing in visual regression testing.

DESIGN SPECIFICATION:
${designDescription}

LIVE WEBSITE IMPLEMENTATION:
${liveWebsiteDescription}

${screenshotContext ? `SCREENSHOT ANALYSIS CONTEXT:\n${screenshotContext}\n` : ''}

TASK:
Compare the design specification against the live website implementation and identify visual differences, inconsistencies, and quality issues.

ANALYZE THE FOLLOWING ASPECTS:
1. Layout & Spacing: Alignment, margins, padding, grid systems
2. Typography: Font families, sizes, weights, line heights, letter spacing
3. Colors: Brand colors, text colors, background colors, borders
4. Components: Buttons, forms, cards, navigation, modals
5. Responsive Design: Breakpoints, mobile/tablet/desktop layouts
6. Visual Hierarchy: Element prominence, contrast, emphasis
7. Accessibility: Color contrast ratios, ARIA labels, keyboard navigation
8. Interactions: Hover states, transitions, animations

SEVERITY LEVELS:
- critical: Breaks functionality, accessibility issues, brand violations
- major: Significant visual inconsistencies, poor UX
- minor: Small styling differences, minor spacing issues

FOR EACH DIFFERENCE, PROVIDE:
1. area: Which UI component/section is affected
2. severity: critical, major, or minor
3. description: Clear explanation of the difference
4. expectedValue: What the design specifies
5. actualValue: What is implemented
6. suggestion: How to fix the issue

OVERALL ASSESSMENT:
Provide a summary of the visual quality and adherence to design specifications.

RECOMMENDATIONS:
List 3-5 actionable recommendations for improving visual consistency.

OUTPUT FORMAT:
Return a valid JSON object with this structure:
{
  "totalDifferences": 0,
  "criticalIssues": 0,
  "majorIssues": 0,
  "minorIssues": 0,
  "differences": [
    {
      "area": "Header navigation",
      "severity": "major",
      "description": "Navigation menu alignment is incorrect",
      "expectedValue": "Center-aligned with 24px spacing",
      "actualValue": "Left-aligned with 16px spacing",
      "suggestion": "Apply justify-content: center and gap: 24px to the nav container"
    }
  ],
  "overallAssessment": "The implementation has several visual inconsistencies...",
  "recommendations": [
    "Standardize spacing using a consistent spacing scale",
    "Ensure all interactive elements have proper hover states"
  ]
}

IMPORTANT:
- Be thorough but realistic
- Focus on user-visible differences
- Provide actionable, specific suggestions
- No emoji or special characters

Return ONLY the JSON object, no markdown formatting.`;

  return await pRetry(
    async () => {
      try {
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 8192,
          temperature: 0.5,
          messages: [{ role: "user", content: prompt }],
        });

        const content = message.content[0];
        if (content.type !== "text") {
          throw new Error("Unexpected response type from Claude");
        }

        let responseText = content.text.trim();
        responseText = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "");
        
        const analysis = JSON.parse(responseText);

        return {
          totalDifferences: analysis.totalDifferences || 0,
          criticalIssues: analysis.criticalIssues || 0,
          majorIssues: analysis.majorIssues || 0,
          minorIssues: analysis.minorIssues || 0,
          differences: Array.isArray(analysis.differences) ? analysis.differences : [],
          overallAssessment: analysis.overallAssessment || "No assessment provided",
          recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [],
        };
      } catch (error: any) {
        if (isRateLimitError(error)) {
          throw error;
        }
        const abortError: any = new Error("Non-retryable error");
        abortError.name = "AbortError";
        throw abortError;
      }
    },
    {
      retries: 3,
      minTimeout: 2000,
      maxTimeout: 5000,
      onFailedAttempt: (error) => {
        console.log(
          `Claude visual analysis attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`
        );
      },
    }
  );
}

export async function analyzeScreenshotWithClaude(
  screenshotBase64: string,
  designRequirements: string
): Promise<VisualAnalysisResult> {
  const prompt = `You are an expert UI/UX quality analyst specializing in visual regression testing.

DESIGN REQUIREMENTS:
${designRequirements}

TASK:
Analyze the provided screenshot and compare it against the design requirements. Identify all visual differences, inconsistencies, and quality issues.

Focus on:
- Layout alignment and spacing
- Typography (fonts, sizes, weights)
- Color accuracy
- Component styling
- Responsive design
- Visual hierarchy
- Accessibility concerns

Provide a comprehensive analysis with specific, actionable feedback.`;

  return await pRetry(
    async () => {
      try {
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 8192,
          temperature: 0.5,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: screenshotBase64,
                  },
                },
                {
                  type: "text",
                  text: prompt,
                },
              ],
            },
          ],
        });

        const content = message.content[0];
        if (content.type !== "text") {
          throw new Error("Unexpected response type from Claude");
        }

        let responseText = content.text.trim();
        responseText = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "");
        
        const analysis = JSON.parse(responseText);

        return {
          totalDifferences: analysis.totalDifferences || 0,
          criticalIssues: analysis.criticalIssues || 0,
          majorIssues: analysis.majorIssues || 0,
          minorIssues: analysis.minorIssues || 0,
          differences: Array.isArray(analysis.differences) ? analysis.differences : [],
          overallAssessment: analysis.overallAssessment || "No assessment provided",
          recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [],
        };
      } catch (error: any) {
        if (isRateLimitError(error)) {
          throw error;
        }
        const abortError: any = new Error("Non-retryable error");
        abortError.name = "AbortError";
        throw abortError;
      }
    },
    {
      retries: 3,
      minTimeout: 2000,
      maxTimeout: 5000,
      onFailedAttempt: (error) => {
        console.log(
          `Claude screenshot analysis attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`
        );
      },
    }
  );
}
