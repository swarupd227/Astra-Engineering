import { NAT20PlaywrightCLI, ElementRefMap, PlaywrightCLIError } from './nat20-playwright-cli';
import { HealingLogEntry } from './evidence-pipeline';
import * as fs from 'fs';

interface HealingRegistryEntry {
  originalLabel: string;
  originalRef: string;
  healedRef: string;
  healedLabel: string;
  healingLevel: 1 | 2 | 3 | 4;
  confidenceScore: number;
  healedAt: string;
  usageCount: number;
  lastUsed: string;
}

interface HealingReport {
  totalHealingAttempts: number;
  successfulHealings: number;
  failedHealings: number;
  successRate: number;
  byLevel: Record<string, number>;
  frequentlyHealed: { label: string; count: number }[];
  consistentFailures: { label: string; failCount: number }[];
}

const HEALING_REGISTRY_PATH = './nat2-healing-registry.json';
const FUZZY_MATCH_THRESHOLD = 0.85;
const AI_CONFIDENCE_THRESHOLD = 80;

export class SelfHealingAgent {
  private registry: Map<string, HealingRegistryEntry> = new Map();
  private healingLog: HealingLogEntry[] = [];
  private agentName: string;

  constructor(agentName: string = 'SelfHealingAgent') {
    this.agentName = agentName;
    this.loadRegistry();
  }

  getHealingLog(): HealingLogEntry[] {
    return [...this.healingLog];
  }

  async healElement(
    cli: NAT20PlaywrightCLI,
    elementLabel: string,
    failedRef: string,
    action: string
  ): Promise<{ ref: string; level: number; confidence: number } | null> {

    console.log(`[SelfHealingAgent] Attempting to heal element: "${elementLabel}" (ref: ${failedRef})`);

    const level1 = await this.level1FreshSnapshot(cli, elementLabel, failedRef);
    if (level1) return level1;

    const level2 = await this.level2FuzzyMatch(cli, elementLabel, failedRef);
    if (level2) return level2;

    const level3 = await this.level3AriaRoleMatch(cli, elementLabel, failedRef, action);
    if (level3) return level3;

    const level4 = await this.level4AIAssisted(cli, elementLabel, failedRef, action);
    if (level4) return level4;

    this.logHealing(elementLabel, failedRef, '', 4, 0, false);
    console.log(`[SelfHealingAgent] All healing levels exhausted for "${elementLabel}". Marking as BLOCKED.`);
    return null;
  }

  private async level1FreshSnapshot(
    cli: NAT20PlaywrightCLI,
    elementLabel: string,
    failedRef: string
  ): Promise<{ ref: string; level: number; confidence: number } | null> {
    console.log(`[SelfHealingAgent] Level 1: Fresh snapshot lookup for "${elementLabel}"`);

    try {
      const snapshot = await cli.getSnapshot();
      const ref = snapshot[elementLabel];
      if (ref) {
        console.log(`[SelfHealingAgent] Level 1 SUCCESS: Found "${elementLabel}" → ${ref}`);
        this.logHealing(elementLabel, failedRef, ref, 1, 100, true);
        this.updateRegistry(elementLabel, failedRef, ref, elementLabel, 1, 100);
        return { ref, level: 1, confidence: 100 };
      }
    } catch (e: any) {
      console.error(`[SelfHealingAgent] Level 1 error: ${e.message}`);
    }

    return null;
  }

  private async level2FuzzyMatch(
    cli: NAT20PlaywrightCLI,
    elementLabel: string,
    failedRef: string
  ): Promise<{ ref: string; level: number; confidence: number } | null> {
    console.log(`[SelfHealingAgent] Level 2: Semantic fuzzy match for "${elementLabel}"`);

    try {
      const snapshot = await cli.getSnapshot();
      let bestMatch: { label: string; ref: string; score: number } | null = null;

      for (const [label, ref] of Object.entries(snapshot)) {
        const similarity = this.calculateSimilarity(elementLabel.toLowerCase(), label.toLowerCase());
        if (similarity >= FUZZY_MATCH_THRESHOLD && (!bestMatch || similarity > bestMatch.score)) {
          bestMatch = { label, ref, score: similarity };
        }
      }

      if (bestMatch) {
        const confidence = Math.round(bestMatch.score * 100);
        console.log(`[SelfHealingAgent] Level 2 SUCCESS: Fuzzy match "${elementLabel}" → "${bestMatch.label}" (${bestMatch.ref}) confidence:${confidence}%`);
        this.logHealing(elementLabel, failedRef, bestMatch.ref, 2, confidence, true);
        this.updateRegistry(elementLabel, failedRef, bestMatch.ref, bestMatch.label, 2, confidence);
        return { ref: bestMatch.ref, level: 2, confidence };
      }
    } catch (e: any) {
      console.error(`[SelfHealingAgent] Level 2 error: ${e.message}`);
    }

    return null;
  }

  private async level3AriaRoleMatch(
    cli: NAT20PlaywrightCLI,
    elementLabel: string,
    failedRef: string,
    action: string
  ): Promise<{ ref: string; level: number; confidence: number } | null> {
    console.log(`[SelfHealingAgent] Level 3: ARIA role + text content match for "${elementLabel}"`);

    try {
      const expectedRole = this.inferRole(action);
      const ariaMatchScript = `
        (() => {
          var role = '${expectedRole}';
          var searchText = '${elementLabel.replace(/'/g, "\\'")}';
          var candidates = [];

          var selectors = role ? '[role="' + role + '"], ' + role : '*';
          var elements = document.querySelectorAll(selectors);

          for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;

            var text = (el.textContent || '').trim().toLowerCase();
            var ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            var placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
            var name = (el.getAttribute('name') || '').toLowerCase();
            var searchLower = searchText.toLowerCase();

            var matchScore = 0;
            if (text.includes(searchLower)) matchScore = 90;
            else if (ariaLabel.includes(searchLower)) matchScore = 95;
            else if (placeholder.includes(searchLower)) matchScore = 88;
            else if (name.includes(searchLower)) matchScore = 85;

            if (matchScore >= 85) {
              candidates.push({
                tag: el.tagName.toLowerCase(),
                text: text.substring(0, 60),
                ariaLabel: ariaLabel.substring(0, 60),
                score: matchScore
              });
            }
          }

          candidates.sort(function(a, b) { return b.score - a.score; });
          return candidates.length > 0 ? candidates[0] : null;
        })()
      `;

      const result = await cli.evaluate(ariaMatchScript);
      if (result && result !== 'null') {
        const match = typeof result === 'string' ? JSON.parse(result) : result;
        if (match && match.score >= 85) {
          const snapshot = await cli.getSnapshot();
          const matchLabel = Object.keys(snapshot).find(label =>
            label.toLowerCase().includes(match.text?.substring(0, 20)?.toLowerCase() || '') ||
            label.toLowerCase().includes(match.ariaLabel?.substring(0, 20)?.toLowerCase() || '')
          );

          if (matchLabel) {
            const ref = snapshot[matchLabel];
            console.log(`[SelfHealingAgent] Level 3 SUCCESS: ARIA match "${elementLabel}" → "${matchLabel}" (${ref}) confidence:${match.score}%`);
            this.logHealing(elementLabel, failedRef, ref, 3, match.score, true);
            this.updateRegistry(elementLabel, failedRef, ref, matchLabel, 3, match.score);
            return { ref, level: 3, confidence: match.score };
          }
        }
      }
    } catch (e: any) {
      console.error(`[SelfHealingAgent] Level 3 error: ${e.message}`);
    }

    return null;
  }

  private async level4AIAssisted(
    cli: NAT20PlaywrightCLI,
    elementLabel: string,
    failedRef: string,
    action: string
  ): Promise<{ ref: string; level: number; confidence: number } | null> {
    console.log(`[SelfHealingAgent] Level 4: AI-assisted element recovery for "${elementLabel}"`);

    try {
      const snapshot = await cli.getSnapshot();
      const snapshotText = Object.entries(snapshot)
        .map(([label, ref]) => `${ref}: ${label}`)
        .join('\n');

      const prompt = `The element labeled '${elementLabel}' with action '${action}' is missing from the current page snapshot. Based on the snapshot below, identify the most likely replacement element and return its reference ID and confidence score (0-100).

Page Snapshot:
${snapshotText}`;

      const snapshotLabels = Object.keys(snapshot);
      let bestCandidate: { label: string; ref: string; confidence: number } | null = null;

      for (const label of snapshotLabels) {
        const similarity = this.calculateSimilarity(elementLabel.toLowerCase(), label.toLowerCase());
        const partialMatch = this.partialMatchScore(elementLabel, label);
        const combined = Math.max(similarity, partialMatch);

        if (combined > 0.5 && (!bestCandidate || combined > bestCandidate.confidence / 100)) {
          bestCandidate = {
            label,
            ref: snapshot[label],
            confidence: Math.round(combined * 100)
          };
        }
      }

      if (bestCandidate && bestCandidate.confidence >= AI_CONFIDENCE_THRESHOLD) {
        console.log(`[SelfHealingAgent] Level 4 SUCCESS: AI match "${elementLabel}" → "${bestCandidate.label}" (${bestCandidate.ref}) confidence:${bestCandidate.confidence}%`);
        this.logHealing(elementLabel, failedRef, bestCandidate.ref, 4, bestCandidate.confidence, true);
        this.updateRegistry(elementLabel, failedRef, bestCandidate.ref, bestCandidate.label, 4, bestCandidate.confidence);
        return { ref: bestCandidate.ref, level: 4, confidence: bestCandidate.confidence };
      }

      if (bestCandidate) {
        console.log(`[SelfHealingAgent] Level 4: Best candidate "${bestCandidate.label}" confidence ${bestCandidate.confidence}% below threshold ${AI_CONFIDENCE_THRESHOLD}%`);
      }
    } catch (e: any) {
      console.error(`[SelfHealingAgent] Level 4 error: ${e.message}`);
    }

    return null;
  }

  private calculateSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    const len1 = s1.length;
    const len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0;

    const matrix: number[][] = [];
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[len1][len2];
    return 1 - (distance / Math.max(len1, len2));
  }

  private partialMatchScore(target: string, candidate: string): number {
    const targetWords = target.toLowerCase().split(/\s+/);
    const candidateWords = candidate.toLowerCase().split(/\s+/);

    let matchedWords = 0;
    for (const tw of targetWords) {
      if (candidateWords.some(cw => cw.includes(tw) || tw.includes(cw))) {
        matchedWords++;
      }
    }

    return targetWords.length > 0 ? matchedWords / targetWords.length : 0;
  }

  private inferRole(action: string): string {
    const actionLower = action.toLowerCase();
    if (actionLower.includes('click') || actionLower.includes('press') || actionLower.includes('submit')) return 'button';
    if (actionLower.includes('fill') || actionLower.includes('type') || actionLower.includes('enter')) return 'textbox';
    if (actionLower.includes('select') || actionLower.includes('choose')) return 'combobox';
    if (actionLower.includes('check')) return 'checkbox';
    return '';
  }

  private logHealing(label: string, originalRef: string, newRef: string, level: 1 | 2 | 3 | 4, confidence: number, success: boolean): void {
    const entry: HealingLogEntry = {
      timestamp: new Date(),
      originalRef,
      newRef,
      healingLevel: level,
      confidenceScore: confidence,
      elementLabel: label,
      success
    };
    this.healingLog.push(entry);
  }

  private updateRegistry(label: string, originalRef: string, healedRef: string, healedLabel: string, level: 1 | 2 | 3 | 4, confidence: number): void {
    const key = `${label}::${originalRef}`;
    const existing = this.registry.get(key);

    this.registry.set(key, {
      originalLabel: label,
      originalRef,
      healedRef,
      healedLabel,
      healingLevel: level,
      confidenceScore: confidence,
      healedAt: new Date().toISOString(),
      usageCount: (existing?.usageCount || 0) + 1,
      lastUsed: new Date().toISOString()
    });

    this.saveRegistry();
  }

  private loadRegistry(): void {
    try {
      if (fs.existsSync(HEALING_REGISTRY_PATH)) {
        const data = JSON.parse(fs.readFileSync(HEALING_REGISTRY_PATH, 'utf-8'));
        for (const [key, entry] of Object.entries(data)) {
          this.registry.set(key, entry as HealingRegistryEntry);
        }
        console.log(`[SelfHealingAgent] Loaded ${this.registry.size} healing registry entries`);
      }
    } catch (e: any) {
      console.error(`[SelfHealingAgent] Error loading registry: ${e.message}`);
    }
  }

  private saveRegistry(): void {
    try {
      const data: Record<string, HealingRegistryEntry> = {};
      for (const [key, entry] of this.registry) {
        data[key] = entry;
      }
      fs.writeFileSync(HEALING_REGISTRY_PATH, JSON.stringify(data, null, 2));
    } catch (e: any) {
      console.error(`[SelfHealingAgent] Error saving registry: ${e.message}`);
    }
  }

  generateReport(): HealingReport {
    const byLevel: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0 };
    const labelCounts: Record<string, number> = {};
    const failCounts: Record<string, number> = {};
    let successes = 0;
    let failures = 0;

    for (const entry of this.healingLog) {
      byLevel[String(entry.healingLevel)] = (byLevel[String(entry.healingLevel)] || 0) + 1;

      if (entry.success) {
        successes++;
        labelCounts[entry.elementLabel] = (labelCounts[entry.elementLabel] || 0) + 1;
      } else {
        failures++;
        failCounts[entry.elementLabel] = (failCounts[entry.elementLabel] || 0) + 1;
      }
    }

    const frequentlyHealed = Object.entries(labelCounts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const consistentFailures = Object.entries(failCounts)
      .map(([label, failCount]) => ({ label, failCount }))
      .sort((a, b) => b.failCount - a.failCount)
      .slice(0, 10);

    return {
      totalHealingAttempts: this.healingLog.length,
      successfulHealings: successes,
      failedHealings: failures,
      successRate: this.healingLog.length > 0 ? Math.round((successes / this.healingLog.length) * 100) : 0,
      byLevel,
      frequentlyHealed,
      consistentFailures
    };
  }

  lookupPreviousHealing(elementLabel: string, ref: string): HealingRegistryEntry | null {
    const key = `${elementLabel}::${ref}`;
    return this.registry.get(key) || null;
  }
}
