/**
 * Golden Repo Metadata Extractor
 *
 * Reads `domain.*` and `persona.*` files from the project's linked golden repository
 * (already fetched and passed in as `complianceGuidelines`) and returns the resolved
 * domain + persona definitions. These are highest-priority sources for SDLC artifact
 * generation; they suppress per-chunk LLM inference of domain or personas.
 *
 * The complianceGuidelines array shape is `Array<{ name, content, ...}>` produced by
 * `server/routes.ts` when reading files from ADO via `goldenRepoReference.filePaths`.
 */

export type GoldenPersona = {
  name: string;
  role: string;
  focus?: string;
  painPoints?: string[];
  goals?: string[];
};

export type GoldenRepoMetadata = {
  goldenDomain?: string;
  goldenDomainContext?: string;
  goldenPersonas?: GoldenPersona[];
};

// Any file whose name CONTAINS "domain" — e.g. domain.md, business_domain.md,
// Bussiness_Domain_Guide.md, BusinessDomainGuide.md, domain-overview.json.
// Common skip-list: README, license, etc. — not domain even if "domain" appears unrelated.
const DOMAIN_FILE_RE = /domain/i;
// Any file whose name CONTAINS "persona" — e.g. persona.md, personas.md, UserPersona.md,
// user_persona.md, primary_personas.json.
const PERSONA_FILE_RE = /persona/i;
const SUPPORTED_EXT_RE = /\.(md|markdown|json|ya?ml|txt)$/i;
const SKIP_FILES_RE = /(^|[\\/])(readme|license|changelog|contributing|code[-_]?of[-_]?conduct|security)\.[^.]+$/i;

const guidelineFilename = (g: any): string => {
  const candidate = g?.name || g?.title || g?.path || g?.fileName || g?.filename || g?.id || "";
  return String(candidate).trim();
};

const guidelineContent = (g: any): string => String(g?.content || g?.description || g?.body || "");

const matchesFile = (filename: string, regex: RegExp): boolean => {
  if (!filename) return false;
  // Strip the path so /docs/UserPersona.md is treated as UserPersona.md.
  const basename = filename.split(/[\\/]/).pop() || filename;
  if (SKIP_FILES_RE.test(basename)) return false;
  // Require the keyword in the filename and a recognised text/markup extension.
  // Files without an extension still match if they contain the keyword (e.g. "domain", "persona").
  const hasExt = SUPPORTED_EXT_RE.test(basename);
  const noExt = !basename.includes('.');
  if (!hasExt && !noExt) return false;
  return regex.test(basename);
};

const tryParseJson = (text: string): any | null => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const stripQuotes = (s: string) => s.replace(/^["'`]|["'`]$/g, "").trim();

/**
 * Parse a domain file's content. Accepts:
 *  - JSON: { domain: "Insurance", entities: "...", businessRules: "..." }
 *  - YAML-ish front-matter: `domain: Insurance`
 *  - Markdown heading: `# Domain: Insurance` or `# Insurance`
 *  - Plain text where the first non-empty line is the domain name.
 */
const parseDomainFile = (content: string): { domain?: string; context?: string } => {
  const text = (content || "").trim();
  if (!text) return {};

  const json = tryParseJson(text);
  if (json && typeof json === "object") {
    const domain = (json.domain || json.name || json.industry || "").toString().trim();
    const ctxParts: string[] = [];
    if (json.entities) ctxParts.push(`ENTITIES:\n${json.entities}`);
    if (json.relationships) ctxParts.push(`RELATIONSHIPS:\n${json.relationships}`);
    if (json.businessRules || json.business_rules) ctxParts.push(`BUSINESS RULES:\n${json.businessRules || json.business_rules}`);
    if (json.regulations) ctxParts.push(`REGULATIONS:\n${json.regulations}`);
    if (json.context) ctxParts.push(String(json.context));
    return { domain: domain || undefined, context: ctxParts.join("\n\n") || undefined };
  }

  // Look for `domain:` line (YAML / front-matter style).
  const yamlMatch = text.match(/^\s*domain\s*:\s*(.+?)\s*$/im);
  if (yamlMatch) {
    return { domain: stripQuotes(yamlMatch[1]), context: text };
  }

  // Markdown heading: `# Domain: Insurance` or `# Insurance Domain` or just `# Insurance`.
  const headingMatch = text.match(/^#{1,3}\s*(?:domain\s*[:\-]?\s*)?(.+?)\s*$/im);
  if (headingMatch) {
    const candidate = headingMatch[1].replace(/\s+domain$/i, "").trim();
    if (candidate.length > 0 && candidate.length < 80) {
      return { domain: candidate, context: text };
    }
  }

  // Fallback: first non-empty line.
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (firstLine && firstLine.length < 80) {
    return { domain: firstLine.replace(/^#+\s*/, ""), context: text };
  }

  return { context: text };
};

/**
 * Parse a persona file's content. Accepts:
 *  - JSON array: [{ name, role, focus, painPoints, goals }]
 *  - JSON object with `personas` key.
 *  - Markdown headings (`## Sarah Chen — Product Manager` or `## Sarah Chen (Product Manager)`)
 *    followed by optional bullet sections "Focus:", "Pain Points:", "Goals:".
 *  - Simple bullet list: `- Sarah Chen — Product Manager`
 */
const SKIP_PERSONA_HEADING_RE =
  /^(overview|summary|introduction|table of contents|user personas?)$/i;

const stripLeadingNumber = (s: string): string => s.replace(/^\d+\.\s*/, "").trim();

const extractRoleFromBlock = (block: string): string | undefined => {
  const boldRole = block.match(/\*\*Role\*\*\s*:\s*(.+?)(?:\r?\n|$)/i);
  if (boldRole) return boldRole[1].trim();
  const plainRole = block.match(/(?:^|\n)\s*Role\s*:\s*(.+?)(?:\r?\n|$)/i);
  if (plainRole) return plainRole[1].trim();
  return undefined;
};

const parsePersonaFile = (content: string): GoldenPersona[] => {
  const text = (content || "").trim();
  if (!text) return [];

  const json = tryParseJson(text);
  if (json) {
    const arr = Array.isArray(json) ? json : Array.isArray(json?.personas) ? json.personas : null;
    if (Array.isArray(arr)) {
      return arr
        .map((p) => normalizePersona(p))
        .filter((p): p is GoldenPersona => Boolean(p && p.name && p.role));
    }
  }

  // ── (0) Numbered headings: `## 1. Name` + `**Role**:` (common golden-repo format) ──
  const numberedPersonas = parseNumberedPersonaBlocks(text);
  if (numberedPersonas.length > 0) return numberedPersonas;

  const personas: GoldenPersona[] = [];
  let m: RegExpExecArray | null;

  // ── (a) Multi-persona file split: `# User Persona – {Name}` / `## Persona: {Name}` ──
  // Split first, then run the table+heading parsers within each section.
  const personaSectionRe = /^#{1,3}\s*(?:user\s+)?persona\s*[–\-:]\s*(.+?)\s*$/gim;
  const sectionMatches: Array<{ index: number; explicitName: string }> = [];
  while ((m = personaSectionRe.exec(text)) !== null) {
    sectionMatches.push({ index: m.index, explicitName: m[1].trim() });
  }

  const sections: Array<{ block: string; explicitName?: string }> = [];
  if (sectionMatches.length > 0) {
    for (let i = 0; i < sectionMatches.length; i++) {
      const start = sectionMatches[i].index;
      const end = i + 1 < sectionMatches.length ? sectionMatches[i + 1].index : text.length;
      sections.push({ block: text.slice(start, end), explicitName: sectionMatches[i].explicitName });
    }
  } else {
    sections.push({ block: text });
  }

  // ── (b) Markdown-table parser (highest priority within a section) ──
  
  for (const section of sections) {
    const fromTable = parsePersonaFromTable(section.block);
    if (fromTable) {
      if (section.explicitName && !fromTable.name) fromTable.name = section.explicitName;
      if (fromTable.name && fromTable.role) personas.push(fromTable);
    }
  }

  // ── (c) Heading-based blocks: `## Name — Role`, `## Name (Role)`, `## Name: Role` ──
  if (personas.length === 0) {
    const headingRe = /^#{2,4}\s+(.+?)\s*$/gm;
    const headings: Array<{ index: number; raw: string }> = [];
    while ((m = headingRe.exec(text)) !== null) {
      headings.push({ index: m.index, raw: m[1] });
    }

    for (let i = 0; i < headings.length; i++) {
      const start = headings[i].index;
      const end = i + 1 < headings.length ? headings[i + 1].index : text.length;
      const block = text.slice(start, end);
      const headerLine = headings[i].raw;
      const parsed = parsePersonaHeader(headerLine);
      if (!parsed) continue;
      const blockSections = extractPersonaSections(block);
      personas.push({
        name: parsed.name,
        role: parsed.role,
        focus: blockSections.focus,
        painPoints: blockSections.painPoints,
        goals: blockSections.goals,
      });
    }
  }

  // ── (d) Bullet list fallback: `- Sarah Chen — Product Manager` ──
  if (personas.length === 0) {
    const bulletRe = /^[\s]*[-*•]\s+(.+?)\s*$/gm;
    while ((m = bulletRe.exec(text)) !== null) {
      const parsed = parsePersonaHeader(m[1]);
      if (parsed) personas.push({ name: parsed.name, role: parsed.role });
    }
  }

  return personas;
};

/**
 * Parse a markdown table where the FIRST column is a field label
 * (e.g. "Persona Name", "Role", "Goals") and the SECOND column is the value.
 * Returns null if the section doesn't contain a recognisable persona table.
 *
 * Example input:
 *     | Persona Name | Account Manager                       |
 *     | Role         | Internal Sales Personnel              |
 *     | Goals        | - Reduce CRM friction\n- Use AI follow|
 *     | Pain Points  | - Multiple customer follow-ups        |
 */
const parsePersonaFromTable = (block: string): GoldenPersona | null => {
  const lines = block.split(/\r?\n/);
  const rows: Array<{ key: string; value: string }> = [];
  let currentKey: string | null = null;
  let currentValueLines: string[] = [];

  const flushRow = () => {
    if (currentKey !== null) {
      rows.push({ key: currentKey, value: currentValueLines.join('\n').trim() });
    }
    currentKey = null;
    currentValueLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      // Blank line ends an in-progress multi-line value cell.
      if (currentKey !== null) {
        currentValueLines.push('');
      }
      continue;
    }
    // `|---|---|` separator row — skip.
    if (/^\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/.test(line)) continue;

    if (line.startsWith('|') && line.endsWith('|') && line.length > 2) {
      // Pipe-separated row.
      const cells = line.slice(1, -1).split('|').map(c => c.trim());
      if (cells.length >= 2) {
        flushRow();
        currentKey = cells[0].replace(/[*_`]/g, '').toLowerCase();
        currentValueLines = [cells.slice(1).join(' | ')];
        continue;
      }
    }

    // Continuation of the previous cell (e.g. multi-line bullet content).
    if (currentKey !== null) {
      currentValueLines.push(rawLine);
    }
  }
  flushRow();

  if (rows.length === 0) return null;

  const findRow = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const found = rows.find(r => r.key === k.toLowerCase()
        || r.key.includes(k.toLowerCase()));
      if (found) return found.value;
    }
    return undefined;
  };

  // Skip header-style tables like `| Field | Value |` where the first row is the header.
  const filteredRows = rows.filter(r => !(r.key === 'field' || r.key === 'attribute' || r.key === 'key'));
  if (filteredRows.length === 0) return null;

  const name = findRow('persona name', 'name', 'persona') || '';
  const role = findRow('role', 'job title', 'title', 'position') || '';
  if (!name && !role) return null;

  const splitBullets = (raw: string | undefined): string[] | undefined => {
    if (!raw) return undefined;
    const items = raw
      .split(/\r?\n/)
      .map(l => l.replace(/^[\s\-*•\d.\)]+/, '').trim())
      .filter(l => l.length > 0);
    return items.length > 0 ? items : undefined;
  };

  return {
    name: name.trim(),
    role: role.trim(),
    focus: findRow('focus', 'primary focus')?.trim() || undefined,
    painPoints: splitBullets(findRow('pain points', 'painpoints', 'pains', 'challenges')),
    goals: splitBullets(findRow('goals', 'goal', 'objectives')),
  };
};

const normalizePersona = (p: any): GoldenPersona | null => {
  if (!p || typeof p !== "object") return null;
  const name = String(p.name || p.persona || "").trim();
  const role = String(p.role || p.title || p.position || "").trim();
  if (!name || !role) return null;
  const arr = (v: any): string[] | undefined => {
    if (!v) return undefined;
    if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
    if (typeof v === "string") return v.split(/[\n;,]/).map((s) => s.trim()).filter(Boolean);
    return undefined;
  };
  return {
    name,
    role,
    focus: p.focus ? String(p.focus).trim() : undefined,
    painPoints: arr(p.painPoints || p.pain_points || p.pains),
    goals: arr(p.goals || p.goal),
  };
};

const parsePersonaHeader = (raw: string): { name: string; role: string } | null => {
  if (!raw) return null;
  const cleaned = stripLeadingNumber(raw.replace(/^[-*•\s]+/, "").trim());
  if (!cleaned || SKIP_PERSONA_HEADING_RE.test(cleaned)) return null;
  // Patterns: "Name — Role", "Name - Role", "Name (Role)", "Name: Role", "Name, Role"
  const dashMatch = cleaned.match(/^(.+?)\s*[—\-–]\s*(.+)$/);
  if (dashMatch) return { name: dashMatch[1].trim(), role: dashMatch[2].trim() };
  const parenMatch = cleaned.match(/^(.+?)\s*\((.+?)\)\s*$/);
  if (parenMatch) return { name: parenMatch[1].trim(), role: parenMatch[2].trim() };
  const colonMatch = cleaned.match(/^(.+?)\s*:\s*(.+)$/);
  if (colonMatch) return { name: colonMatch[1].trim(), role: colonMatch[2].trim() };
  const commaMatch = cleaned.match(/^(.+?),\s*(.+)$/);
  if (commaMatch) return { name: commaMatch[1].trim(), role: commaMatch[2].trim() };
  return null;
};

const extractPersonaSections = (block: string): { focus?: string; painPoints?: string[]; goals?: string[] } => {
  const focus = sectionText(block, /focus/i);
  const painPoints = sectionList(block, /pain\s*points?/i);
  const goals = sectionList(block, /goals?/i);
  return { focus, painPoints, goals };
};

const sectionText = (block: string, label: RegExp): string | undefined => {
  const re = new RegExp(`(?:^|\\n)\\s*[*_-]*\\s*${label.source}\\s*[:\\-]\\s*([\\s\\S]*?)(?=\\n\\s*[*_-]*\\s*[A-Z][^\\n]*?[:\\-]|\\n\\s*#|$)`, "im");
  const m = block.match(re);
  return m ? m[1].trim().replace(/^\n+/, "").split(/\n\s*\n/)[0].trim() : undefined;
};

const sectionList = (block: string, label: RegExp): string[] | undefined => {
  const text = sectionText(block, label);
  if (!text) return undefined;
  const items = text.split(/\n/).map((l) => l.replace(/^[\s\-*•]+/, "").trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
};

/**
 * Hilti-style numbered persona blocks:
 *   ## 1. Professional Contractor / Site Worker
 *   **Role**: Skilled tradesperson...
 */
const parseNumberedPersonaBlocks = (text: string): GoldenPersona[] => {
  const headingRe = /^#{2}\s+\d+\.\s+(.+?)\s*$/gm;
  const headings: Array<{ index: number; raw: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(text)) !== null) {
    headings.push({ index: m.index, raw: m[1].trim() });
  }
  if (headings.length === 0) return [];

  const personas: GoldenPersona[] = [];
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index;
    const end = i + 1 < headings.length ? headings[i + 1].index : text.length;
    const block = text.slice(start, end);
    const withoutNum = stripLeadingNumber(headings[i].raw);
    if (!withoutNum || SKIP_PERSONA_HEADING_RE.test(withoutNum)) continue;

    let name = withoutNum;
    let role = extractRoleFromBlock(block);

    const parenMatch = withoutNum.match(/^(.+?)\s*\((.+?)\)\s*$/);
    if (parenMatch) {
      name = parenMatch[1].trim();
      if (!role) role = parenMatch[2].trim();
    }

    if (!role) continue;

    const blockSections = extractPersonaSections(block);
    const goals =
      sectionList(block, /primary\s*goals?/i) || blockSections.goals;
    const painPoints =
      sectionList(block, /pain\s*points?/i) || blockSections.painPoints;

    personas.push({
      name,
      role,
      focus: blockSections.focus,
      painPoints,
      goals,
    });
  }

  return personas;
};

/**
 * Inspect already-fetched golden-repo guideline files and pull out the optional
 * `domain.*` and `persona.*` files if present. Returns an empty object when neither
 * file exists — callers must then fall back to lower-priority sources.
 */
export function extractGoldenRepoMetadata(
  complianceGuidelines: any[] | undefined | null
): GoldenRepoMetadata {
  if (!Array.isArray(complianceGuidelines) || complianceGuidelines.length === 0) {
    return {};
  }

  const result: GoldenRepoMetadata = {};

  for (const g of complianceGuidelines) {
    const filename = guidelineFilename(g);
    if (!filename) continue;
    const content = guidelineContent(g);
    if (!content) continue;

    if (!result.goldenDomain && matchesFile(filename, DOMAIN_FILE_RE)) {
      const parsed = parseDomainFile(content);
      if (parsed.domain) result.goldenDomain = parsed.domain;
      if (parsed.context) result.goldenDomainContext = parsed.context;
    }

    if (matchesFile(filename, PERSONA_FILE_RE)) {
      const personas = parsePersonaFile(content);
      if (
        personas.length > 0 &&
        (!result.goldenPersonas || personas.length > result.goldenPersonas.length)
      ) {
        result.goldenPersonas = personas;
      }
    }
  }

  return result;
}
