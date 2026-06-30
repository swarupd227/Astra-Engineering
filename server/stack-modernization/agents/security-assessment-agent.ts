/**
 * Security Assessment Agent
 * Analyzes uploaded code for known vulnerabilities using registry advisory APIs
 * and LLM-based pattern analysis for security anti-patterns.
 */

import type { StackModernizationState, SecurityAssessmentResult } from "../types";
import { getLLMClient } from "../services/llm-selector";
import { safeMaxTokens } from "../services/token-manager";
import { trackedLLMCall } from "../services/llm-call-tracker";
import { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } from "../services/token-budgets";
import { logActivity } from "../state";
import https from "https";

interface AdvisoryEntry {
  id: string;
  package: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  fixedIn?: string;
}

async function fetchNpmAuditAdvisories(
  packages: Array<{ name: string; version: string }>
): Promise<AdvisoryEntry[]> {
  if (packages.length === 0) return [];
  const requires: Record<string, string> = {};
  for (const p of packages) requires[p.name] = p.version || "*";
  const body = JSON.stringify({ name: "audit-check", version: "0.0.0", requires });

  return new Promise((resolve) => {
    const req = https.request(
      "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const entries: AdvisoryEntry[] = [];
            for (const [pkg, advisories] of Object.entries(parsed)) {
              if (!Array.isArray(advisories)) continue;
              for (const adv of advisories as any[]) {
                entries.push({
                  id: adv.id?.toString() || `npm-${pkg}-${entries.length}`,
                  package: pkg,
                  severity: mapSeverity(adv.severity),
                  title: adv.title || adv.overview || "Unknown advisory",
                  fixedIn: adv.patched_versions || undefined,
                });
              }
            }
            resolve(entries);
          } catch {
            resolve([]);
          }
        });
      }
    );
    req.on("error", () => resolve([]));
    req.write(body);
    req.end();
  });
}

function mapSeverity(s: string | undefined): "critical" | "high" | "medium" | "low" {
  const v = (s || "").toLowerCase();
  if (v === "critical") return "critical";
  if (v === "high") return "high";
  if (v === "moderate" || v === "medium") return "medium";
  return "low";
}

function analyzeSecurityPatternsFromCode(
  files: Array<{ relativePath: string; content: string }>
): string[] {
  const advisories: string[] = [];
  const patterns = [
    { regex: /eval\s*\(/g, msg: "Usage of eval() detected - potential code injection risk" },
    { regex: /innerHTML\s*=/g, msg: "Direct innerHTML assignment - potential XSS vulnerability" },
    { regex: /password\s*=\s*["'][^"']+["']/gi, msg: "Hardcoded password detected" },
    { regex: /api[_-]?key\s*=\s*["'][^"']+["']/gi, msg: "Hardcoded API key detected" },
    { regex: /http:\/\/(?!localhost)/g, msg: "Non-HTTPS URL detected in code" },
    { regex: /disable.*ssl|verify\s*=\s*false|rejectUnauthorized.*false/gi, msg: "SSL verification disabled" },
    { regex: /md5|sha1(?![\w-])/gi, msg: "Weak hashing algorithm usage (MD5/SHA1)" },
    { regex: /exec\s*\(\s*[`"'].*\$\{/g, msg: "Command injection risk - string interpolation in exec()" },
  ];

  for (const file of files) {
    if (!file.content || file.content.length < 20) continue;
    const ext = file.relativePath.split(".").pop()?.toLowerCase() || "";
    if (!["js", "ts", "tsx", "jsx", "py", "cs", "java"].includes(ext)) continue;
    for (const p of patterns) {
      if (p.regex.test(file.content)) {
        advisories.push(`${p.msg} in ${file.relativePath}`);
        p.regex.lastIndex = 0;
      }
    }
  }
  return advisories;
}

export async function executeSecurityAssessmentAgent(
  state: StackModernizationState
): Promise<SecurityAssessmentResult> {
  const cves: AdvisoryEntry[] = [];
  const advisories: string[] = [];

  // 1. Static pattern analysis
  const patternAdvisories = analyzeSecurityPatternsFromCode(state.extractedFiles || []);
  advisories.push(...patternAdvisories);

  // 2. npm audit for JS/TS projects
  const manifests = state.repoProfile?.packageManifests || [];
  for (const m of manifests) {
    if (m.type === "package.json" && m.parsed) {
      const deps = Object.entries({
        ...(m.parsed.dependencies || {}),
        ...(m.parsed.devDependencies || {}),
      }).map(([name, version]) => ({ name, version: String(version) }));
      if (deps.length > 0) {
        const npmAdvisories = await fetchNpmAuditAdvisories(deps);
        cves.push(...npmAdvisories);
      }
    }
  }

  // 3. LLM analysis for deeper patterns
  try {
    const { client, model } = getLLMClient(state.llmProvider);
    const { sanitizeForContentFilter } = await import("../services/prompt-sanitizer");
    const codeSnippets = (state.extractedFiles || [])
      .filter((f) => ["js", "ts", "py", "cs", "java"].includes(f.relativePath.split(".").pop()?.toLowerCase() || ""))
      .slice(0, 10)
      .map((f) => `--- ${f.relativePath} ---\n${sanitizeForContentFilter(f.content.slice(0, 2000), "standard")}`)
      .join("\n\n");

    if (codeSnippets.length > 100) {
      const budgetBlock = buildBudgetConstraint("securityAssessment", "json");
      const resp = await trackedLLMCall(client, {
        model,
        messages: [
          { role: "system", content: `${budgetBlock}\n\nYou are a security auditor. Analyze the code and return a JSON object: { "issues": [{ "severity": "high"|"medium"|"low", "description": "..." }] }. Return ONLY valid JSON.` },
          { role: "user", content: `Scan these code files for security vulnerabilities, hardcoded secrets, injection risks, and insecure patterns:\n\n${codeSnippets}` },
        ],
        temperature: 0,
        max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.securityAssessment, model),
      }, { analysisId: state.analysisId, phase: "assessment", agent: "SecurityAssessment" });
      const text = resp.choices[0]?.message?.content?.trim() || "";
      try {
        let clean = text;
        if (clean.startsWith("```")) clean = clean.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
        const parsed = JSON.parse(clean);
        if (Array.isArray(parsed.issues)) {
          for (const issue of parsed.issues) {
            advisories.push(`[${(issue.severity || "medium").toUpperCase()}] ${issue.description}`);
          }
        }
      } catch { /* ignore parse failure */ }
    }
  } catch (e) {
    console.warn("[SecurityAssessment] LLM analysis failed:", e instanceof Error ? e.message : e);
  }

  const critical = cves.filter((c) => c.severity === "critical").length;
  const high = cves.filter((c) => c.severity === "high").length;
  const medium = cves.filter((c) => c.severity === "medium").length;
  const low = cves.filter((c) => c.severity === "low").length;
  const totalVulnerabilities = cves.length + advisories.length;

  let score = 100;
  score -= critical * 20;
  score -= high * 10;
  score -= medium * 3;
  score -= low * 1;
  score -= Math.min(advisories.length * 2, 20);
  score = Math.max(0, Math.min(100, score));

  return { totalVulnerabilities, critical, high, medium, low, cves, advisories, score };
}
