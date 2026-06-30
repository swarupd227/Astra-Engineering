import { loadTemplates } from "./templates";
import { callLlmWithRetry } from "./llm-caller";
import {
  buildSpecSystemPrompt,
  buildSpecStaticUserContext,
  buildSpecDynamicUserPrompt,
  buildRequirementsSystemPrompt,
  buildRequirementsDynamicUserPrompt,
  TDD_SYSTEM_PROMPT,
  buildTddDynamicUserPrompt,
} from "../../prompts/prompt_specs_generation";

export interface SpecsGenerationUserStory {
  id: number;
  title: string;
  state?: string;
  description?: string;
  acceptanceCriteria?: string;
  storyPoints?: number | null;
}

export interface SpecsGenerationFeature {
  id: number;
  title: string;
  state?: string;
  description?: string;
  userStories: SpecsGenerationUserStory[];
}

export interface SpecsGenerationResult {
  featureId: number;
  featureTitle: string;
  specsContent: string;
  requirementsContent: string;
  tddTestsContent?: string;
}

function buildSpecMetadataBlock(featureTitle: string, documentDate: string): string {
  return [
    `# Feature: ${featureTitle}`,
    `Status: NEW`,
    `Owner: DevX`,
    `Last Updated: ${documentDate}`,
    "",
    "",
  ].join("\n");
}

export class SpecsGenerator {
  /**
   * Generate specs.md and requirements.md for each selected feature.
   *
   * Batch-wise processing rules:
   * - Build a FIFO queue of feature–user story combinations
   * - Each queue item is processed independently by the LLM
   * - For each feature, we compose a single specs.md and requirements.md
   * - A Traceability Matrix is added to each specs.md file
   */
  async generateForFeatures(
    features: SpecsGenerationFeature[],
    enableTdd: boolean = false,
    onChunk?: (
      result: SpecsGenerationResult,
      index: number,
      total: number
    ) => Promise<void> | void,
    onProgress?: (step: string, progress: number) => void
  ): Promise<SpecsGenerationResult[]> {
    if (!Array.isArray(features) || features.length === 0) {
      return [];
    }

    const { specTemplate, requirementsTemplate } = await loadTemplates();

    const results: SpecsGenerationResult[] = [];
    const total = features.length;
    let batchSize = Math.max(
      1,
      Math.min(
        parseInt(process.env.SPECS_MAX_CONCURRENCY || "8", 10) || 8,
        total
      )
    );
    let index = 0;

    while (index < total) {
      const remaining = total - index;
      const currentBatchSize = Math.min(batchSize, remaining);
      const batch = features.slice(index, index + currentBatchSize);

      try {
        const batchResults = await Promise.all(
          batch.map((feature, batchIdx) =>
            this.generateForSingleFeature(
              feature,
              specTemplate,
              requirementsTemplate,
              enableTdd,
              onProgress
                ? (step, _pct) => {
                    const overallIdx = index + batchIdx;
                    const base = Math.round((overallIdx / total) * 100);
                    const featureSlice = Math.round((1 / total) * 100);
                    const featureProgress = Math.round((_pct / 100) * featureSlice);
                    onProgress(step, Math.min(95, base + featureProgress));
                  }
                : undefined
            )
          )
        );

        for (const result of batchResults) {
          results.push(result);
          if (onChunk) {
            await onChunk(result, results.length, total);
          }
        }

        index += currentBatchSize;
      } catch (error) {
        if (currentBatchSize === 1) {
          throw error;
        }

        const newBatchSize = Math.max(1, Math.floor(currentBatchSize / 2));
        console.warn(
          `[SpecsGenerator] Batch of size ${currentBatchSize} failed. Reducing concurrency to ${newBatchSize} and retrying...`,
          error
        );
        batchSize = newBatchSize;
      }
    }

    return results;
  }

  private async generateForSingleFeature(
    feature: SpecsGenerationFeature,
    specTemplate: string,
    requirementsTemplate: string,
    enableTdd: boolean = false,
    onProgress?: (step: string, progress: number) => void
  ): Promise<SpecsGenerationResult> {
    const featureTitle = feature.title || `Feature ${feature.id}`;
    const baseContext = this.buildBaseContext(feature);
    const documentDate = new Date().toISOString().slice(0, 10);
    const staticUser = buildSpecStaticUserContext(baseContext);
    const totalSteps = enableTdd ? 3 : 2;

    onProgress?.(`Generating specs for "${featureTitle}"...`, 0);
    const rawSpecsContent = await this.generateSpec(
      featureTitle,
      staticUser,
      documentDate,
      specTemplate,
      enableTdd,
    );

    onProgress?.(`Generating requirements for "${featureTitle}"...`, Math.round((1 / totalSteps) * 100));
    const requirementsContent = await this.generateRequirements(
      featureTitle,
      staticUser,
      documentDate,
      requirementsTemplate,
    );

    let tddTestsContent: string | undefined;
    if (enableTdd) {
      onProgress?.(`Generating TDD tests for "${featureTitle}"...`, Math.round((2 / totalSteps) * 100));
      tddTestsContent = await this.generateTddTests(featureTitle, staticUser, documentDate);
    }

    // Strip any metadata block the LLM may have generated (it mimics the template)
    const strippedSpecs = rawSpecsContent.replace(
      /^#\s*Feature:.*\n(?:(?:Status|Owner|Last Updated):.*\n)*\n*/,
      ""
    );

    const metadataBlock = buildSpecMetadataBlock(featureTitle, documentDate);
    const specsContent = metadataBlock + strippedSpecs;

    return {
      featureId: feature.id,
      featureTitle,
      specsContent,
      requirementsContent,
      tddTestsContent,
    };
  }

  private buildBaseContext(feature: SpecsGenerationFeature): string {
    const featureTitle = feature.title || `Feature ${feature.id}`;
    const stories = feature.userStories || [];

    const storiesSummary =
      stories.length > 0
        ? stories
            .map((s) => {
              const parts: string[] = [];
              parts.push(`- US ${s.id}: ${s.title}`);
              if (s.storyPoints != null) {
                parts.push(`  - Story Points: ${s.storyPoints}`);
              }
              if (s.state) {
                parts.push(`  - State: ${s.state}`);
              }
              if (s.acceptanceCriteria) {
                parts.push(
                  `  - Acceptance Criteria:\n${String(s.acceptanceCriteria).trim()}`
                );
              }
              if (s.description) {
                parts.push(
                  `  - Description:\n${String(s.description).trim()}`
                );
              }
              return parts.join("\n");
            })
            .join("\n")
        : "- No user stories were provided for this feature.";

    return [
      `Feature ID: ${feature.id}`,
      `Feature Title: ${featureTitle}`,
      feature.state ? `Feature State: ${feature.state}` : "",
      feature.description
        ? `Feature Description:\n${String(feature.description).trim()}`
        : "",
      "",
      "User Stories (selected for this feature):",
      storiesSummary,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async generateSpec(
    featureTitle: string,
    staticUser: string,
    documentDate: string,
    specTemplate: string,
    enableTdd: boolean
  ): Promise<string> {
    return callLlmWithRetry(`Spec generation for "${featureTitle}"`, {
      systemPrompt: buildSpecSystemPrompt(specTemplate, enableTdd),
      staticUser,
      dynamicUser: buildSpecDynamicUserPrompt(featureTitle, documentDate),
      temperature: 0.2,
      maxTokens: 6000,
    });
  }

  private async generateRequirements(
    featureTitle: string,
    staticUser: string,
    documentDate: string,
    requirementsTemplate: string
  ): Promise<string> {
    return callLlmWithRetry(
      `Requirements checklist for "${featureTitle}"`,
      {
        systemPrompt: buildRequirementsSystemPrompt(requirementsTemplate),
        staticUser,
        dynamicUser: buildRequirementsDynamicUserPrompt(featureTitle, documentDate),
        temperature: 0.15,
        maxTokens: 4000,
      }
    );
  }

  private async generateTddTests(
    featureTitle: string,
    staticUser: string,
    documentDate: string
  ): Promise<string> {
    return callLlmWithRetry(`TDD tests for "${featureTitle}"`, {
      systemPrompt: TDD_SYSTEM_PROMPT,
      staticUser,
      dynamicUser: buildTddDynamicUserPrompt(featureTitle, documentDate),
      temperature: 0.2,
      maxTokens: 6000,
    });
  }
}
