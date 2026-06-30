/**
 * Requirement Extractor Agent - TypeScript Implementation
 * 
 * Production-grade requirement extraction agent.
 * Hardened against LLM JSON errors, schema drift, and partial failures.
 */

import type { ExtractedRequirements, Requirement } from '../models';
import { llmClient } from '../llmClient';

export class RequirementExtractorAgent {
  
  private static readonly VALID_PRIORITIES = new Set(["critical", "high", "medium", "low"]);

  private static readonly CATEGORY_MAP: Record<string, string> = {
    "functional": "functional",
    "non-functional": "non-functional", 
    "technical": "constraint",
    "business": "functional",
    "security": "non-functional",
    "performance": "non-functional",
    "ui": "functional",
    "ux": "functional"
  };

  constructor() {
    // Empty constructor like Python version
  }

  // ==========================================================
  // PUBLIC API
  // ==========================================================

  async extractRequirements(
    brdContent: string,
    userRequirements: string = ""
  ): Promise<ExtractedRequirements> {

    const prompt = this.buildPrompt(brdContent, userRequirements);

    const raw = await llmClient.generateCompletion([
      { role: "system", content: "Return ONLY valid JSON. No markdown. No explanation." },
      { role: "user", content: prompt }
    ], {
      temperature: 0.2,
      useFastModel: true
    });

    // console.log("\n[RAW LLM REQUIREMENT OUTPUT]");
    // console.log(raw);
    // console.log("=".repeat(80));

    let data = this.safeJsonLoad(raw);

    // Retry once if JSON invalid
    if (!data || !data.requirements) {
      // console.log("Invalid JSON detected - retrying with correction prompt");

      const retryPrompt = this.buildRetryPrompt(brdContent);
      const retryRaw = await llmClient.generateCompletion([
        { role: "system", content: "You MUST output valid JSON only." },
        { role: "user", content: retryPrompt }
      ], {
        temperature: 0,
        useFastModel: true
      });

      // console.log("\n[RETRY LLM OUTPUT]");
      // console.log(retryRaw);
      // console.log("=".repeat(80));

      data = this.safeJsonLoad(retryRaw);
    }

    // Final fallback - NEVER return empty
    if (!data || !data.requirements) {
      // console.log("ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¡Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã…â€œÃƒâ€šÃ‚Â¿ LLM failed twice ÃƒÅ½Ã¢â‚¬Å“ÃƒÆ’Ã¢â‚¬Â¡ÃƒÆ’Ã‚Â¶ using deterministic fallback requirement");

      const fallback: Requirement = {
        requirementId: "REQ-001",
        category: "functional", 
        description: brdContent.substring(0, 300).trim(),
        priority: "medium",
        keywords: this.fallbackKeywords(brdContent, ""),
      };

      return {
        requirements: [fallback],
        extractionTimestamp: new Date()
      };
    }

    // ======================================================
    // NORMALIZATION
    // ======================================================

    const requirements: Requirement[] = [];

    for (let idx = 0; idx < data.requirements.length; idx++) {
      const rawReq = data.requirements[idx];
      try {
        const req = this.normalizeRequirement(rawReq, idx + 1);
        requirements.push(req);
      } catch (e) {
        // console.log(`ÃƒÅ½Ã¢â‚¬Å“ÃƒÆ’Ã…â€œÃƒÆ’Ã‚Â¡ Skipping invalid requirement #${idx + 1}: ${e}`);
      }
    }

    if (requirements.length === 0) {
      throw new Error("No valid requirements after normalization");
    }

    // console.log(`ÃƒÅ½Ã¢â‚¬Å“Ãƒâ€šÃ‚Â£ÃƒÆ’Ã‚Â´ Extracted ${requirements.length} requirements`);

    return {
      requirements,
      extractionTimestamp: new Date()
    };
  }

  // ==========================================================
  // PROMPTS
  // ==========================================================

  private buildPrompt(brd: string, userReq: string): string {
    return `Extract ALL requirements from the following BRD.

Return STRICT JSON only in this schema:

{
  "requirements": [
    {
      "requirement_id": "REQ-001",
      "category": "functional | non-functional | technical",
      "description": "Requirement statement",
      "priority": "critical | high | medium | low",
      "acceptance_criteria": "Clear measurable criteria"
    }
  ],
  "summary": "Short summary"
}

BRD:
${brd}

Additional user requirements:
${userReq}`;
  }

  private buildRetryPrompt(brd: string): string {
    return `The previous response was INVALID JSON.

Return ONLY valid JSON using this exact schema:

{
  "requirements": [ ... ],
  "summary": "text"
}

BRD:
${brd.substring(0, 3000)}`;
  }

  // ==========================================================
  // NORMALIZATION
  // ==========================================================

  private normalizeRequirement(raw: any, index: number): Requirement {
    const categoryRaw = String(raw.category || "functional").toLowerCase().trim();
    const category = RequirementExtractorAgent.CATEGORY_MAP[categoryRaw] || "functional";

    const priorityRaw = String(raw.priority || "medium").toLowerCase().trim();
    let priority: "High" | "Medium" | "Low" = "Medium";
    if (priorityRaw === "high" || priorityRaw === "critical") priority = "High";
    else if (priorityRaw === "low") priority = "Low";

    const description = String(raw.description || "").trim();
    if (!description) {
      throw new Error("Missing description");
    }

    let keywords = raw.keywords;
    if (!Array.isArray(keywords) || keywords.length === 0) {
      keywords = this.fallbackKeywords(description, raw.acceptance_criteria || "");
    }

    return {
      requirementId: `REQ-${String(index).padStart(3, '0')}`,
      description: raw.requirement || raw.title || description,
      category: this.validateCategory(category),
      priority: priority || "medium",
      keywords
    };
  }

  // ==========================================================
  // SAFE JSON HANDLING (SINGLE SOURCE OF TRUTH)
  // ==========================================================

  private safeJsonLoad(text: string): any | null {
    try {
      let cleaned = text.trim();
      if (cleaned.startsWith("```")) {
        const parts = cleaned.split("```");
        if (parts.length >= 2) {
          cleaned = parts[1];
        }
      }
      return JSON.parse(cleaned);
    } catch {
      // First attempt failed, try to extract JSON object
    }

    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}") + 1;
      if (start >= 0 && end > start) {
        return JSON.parse(text.substring(start, end));
      }
    } catch {
      // Second attempt failed too
    }

    return null;
  }

  // ==========================================================
  // FALLBACK KEYWORDS
  // ==========================================================

  private fallbackKeywords(description: string, acceptance: string): string[] {
    const words = (description + " " + acceptance).toLowerCase().split(/\s+/);
    const keywords = words
      .map(w => w.replace(/[,.()]/g, ""))
      .filter(w => w.length > 4);
    
    // Remove duplicates while preserving order
    const uniqueKeywords: string[] = [];
    const seen = new Set<string>();
    
    for (const keyword of keywords) {
      if (!seen.has(keyword)) {
        seen.add(keyword);
        uniqueKeywords.push(keyword);
      }
    }
    
    return uniqueKeywords.slice(0, 8);
  }

  private validateCategory(category: any): 'functional' | 'non-functional' | 'constraint' | 'dependency' | 'priority' {
    const validCategories = ['functional', 'non-functional', 'constraint', 'dependency', 'priority'];
    if (validCategories.includes(category)) {
      return category;
    }
    return 'functional'; // Default fallback
  }

  private validatePriority(priority: any): string {
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    if (validPriorities.includes(priority)) {
      return priority;
    }
    return 'medium'; // Default fallback
  }
}
