
export interface BRDSubSection {
  title: string;
  content: string;
  originalIndex: number;
  originalIndices?: number[];
  subsections?: BRDSubSection[];
}

export interface BRDSection {
  title: string;
  content: string;
  subsections?: BRDSubSection[];
  originalIndex?: number;
  originalIndices?: number[];
}

export interface BRDDocument {
  title: string;
  version: string;
  date: string;
  sections: BRDSection[];
  rawMarkdown: string;
  brdTemplateId?: string;
  brdFileName?: string;
  brdFileType?: string;
}

/**
 * Helper to escape special regex characters
 */
export const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/**
 * Checks if content is a placeholder (TBD, N/A, empty, etc.)
 */
export const isPlaceholder = (c: string): boolean => {
  const low = (c || "").toLowerCase().trim();
  return (
    !low ||
    low === "tbd" ||
    low === "n/a" ||
    low.includes("generated in pass") ||
    low.includes("to be generated") ||
    low.includes("section will be provided") ||
    (low.length < 50 && low.includes("none specified"))
  );
};

/**
 * Checks if a section (and its subsections) are all empty/placeholder
 */
export const isSectionEmpty = (section: any): boolean => {
  const hasContent = !isPlaceholder(section.content);
  const hasSubsections =
    section.subsections &&
    section.subsections.some((sub: any) => !isSectionEmpty(sub));
  return !hasContent && !hasSubsections;
};

/**
 * Clean section title for display (remove trailing "**:" or "**" from LLM output)
 */
export const cleanSectionTitleForDisplay = (title: string): string => {
  if (!title) return "";
  return title
    .replace(/\*\*:?\s*$/g, "")
    .replace(/^\*\*|\*\*$/g, "")
    .trim();
};

/**
 * Normalize text by removing leading numbers and formatting.
 * Used to compare titles for duplicate detection.
 */
export const normalizeTitle = (text: string): string => {
  if (!text) return "";
  let normalized = text.replace(/^#+\s+/, "");
  normalized = normalized.replace(/^\d+(?:\.\d+)*(?:[.)]\s*|\s+)/, "");
  normalized = normalized.replace(/^\*\*|\*\*$/g, "");
  normalized = normalized.replace(/\*\*/g, "");
  normalized = normalized.replace(/^_|_$/g, "");
  normalized = normalized.replace(/:\s*$/, "");
  normalized = normalized.replace(/\s+/g, " ");
  let result = normalized.trim().toLowerCase();

  result = result
    .replace(/\bgoals\b/g, "goal")
    .replace(/\brequirements\b/g, "requirement")
    .replace(/\brules\b/g, "rule")
    .replace(/\bpolicies\b/g, "policy")
    .replace(/\bentities\b/g, "entity")
    .replace(/\bpersonas\b/g, "persona")
    .replace(/\bobjectives\b/g, "objective")
    .replace(/\bstakeholders\b/g, "stakeholder")
    .replace(/\bdocuments\b/g, "document")
    .replace(/\bconstraints\b/g, "constraint")
    .replace(/\bassumptions\b/g, "assumption")
    .replace(/\bdependencies\b/g, "dependency")
    .replace(/\brisks\b/g, "risk")
    .replace(/\bmilestones\b/g, "milestone")
    .replace(/\bsummaries\b/g, "summary");

  return result;
};

/**
 * Extract numbered heading from content (e.g., "2.1 Business Goals" from "## 2.1 Business Goals")
 */
export const extractNumberedHeading = (content: string): string | null => {
  if (!content) return null;
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(/^(#{1,6})\s+(\d+(?:\.\d+)*[.)]?\s*.+)$/);
    if (headingMatch) return headingMatch[2].trim();

    const numberedMatch = trimmed.match(/^(\d+(?:\.\d+)*[.)]?\s*.+)$/);
    if (numberedMatch) return numberedMatch[1].trim();

    break;
  }
  return null;
};

/**
 * Remove the first top non-empty line if it matches the expected section title
 * (markdown heading, bold pseudo-heading, "Title:", or numbered "1. Title").
 */
function stripOneLeadingMatchingHeading(md: string, expectedTitle: string): string {
  const lines = md.split("\n");
  const normalizedExpected = normalizeTitle(expectedTitle);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let lineText = line;
    let normalizedLine = "";
    let hasPattern = false;

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      lineText = headingMatch[2];
      normalizedLine = normalizeTitle(lineText);
      hasPattern = true;
    } else {
      const boldMatch = line.match(/^\*\*(.+?)\*\*\s*$/);
      if (boldMatch) {
        lineText = boldMatch[1];
        normalizedLine = normalizeTitle(lineText);
        hasPattern = true;
      } else {
        const colonMatch = line.match(/^(.+?):\s*$/);
        if (colonMatch) {
          lineText = colonMatch[1];
          normalizedLine = normalizeTitle(lineText);
          hasPattern = true;
        } else {
          const numberedMatch = line.match(/^(\d+(?:\.\d+)*[.)]\s*)?(.+)$/);
          if (numberedMatch && numberedMatch[1]) {
            lineText = numberedMatch[2];
            normalizedLine = normalizeTitle(lineText);
            hasPattern = true;
          } else {
            normalizedLine = normalizeTitle(line);
          }
        }
      }
    }

    if (
      normalizedLine &&
      (normalizedLine === normalizedExpected ||
        normalizedLine.includes(normalizedExpected) ||
        normalizedExpected.includes(normalizedLine))
    ) {
      const result = lines.slice(i + 1).join("\n");
      return result.replace(/^\n+/, "");
    }

    if (hasPattern) break;
  }

  return md;
}

/**
 * Strip duplicate top heading(s) from markdown content.
 * Repeats until the first non-empty line no longer matches (handles LLM output
 * like two consecutive "## 1. Document Information" lines).
 */
export const stripDuplicatedTopHeading = (
  md: string,
  expectedTitle: string
): string => {
  if (!md || !expectedTitle) return md;

  let cur = md;
  for (let guard = 0; guard < 64; guard++) {
    const next = stripOneLeadingMatchingHeading(cur, expectedTitle);
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
};

/**
 * Helper to build markdown header
 */
export const withHeading = (
  numberedTitle: string,
  content: string,
  level: 2 | 3,
  skipTbd: boolean = false
): string => {
  const clean = stripDuplicatedTopHeading((content || "").trim(), numberedTitle);
  const headingPrefix = level === 2 ? "##" : "###";
  if (!clean || clean.toLowerCase() === "tbd") {
    return skipTbd
      ? `${headingPrefix} ${numberedTitle}`
      : `${headingPrefix} ${numberedTitle}\n\nTBD`;
  }

  const lines = clean.split("\n");
  const firstLine = lines[0].trim();
  let contentToUse = clean;

  if (
    firstLine.startsWith("#") ||
    (firstLine.startsWith("**") && firstLine.endsWith("**"))
  ) {
    contentToUse = lines.slice(1).join("\n").trim();
  }

  if (!contentToUse) contentToUse = clean;

  const headingToUse = numberedTitle.startsWith("#") ? numberedTitle : `${headingPrefix} ${numberedTitle}`;
  return `${headingToUse}\n\n${contentToUse}`;
};

/**
 * Normalizes BRD structure for preview — forces the fixed 1–13 outline.
 * Only used as a fallback when rawMarkdown is not available.
 */
export const normalizeBrdStructureForPreview = (
  flatSections: Array<{ title: string; content: string }>
): Array<{ title: string; content: string; originalIndices: number[] }> => {
  const FIXED: Array<{
    n: string;
    title: string;
    subs?: Array<{ n: string; title: string }>;
  }> = [
      { n: "1", title: "Document Information" },
      { n: "2", title: "Executive Summary" },
      {
        n: "3",
        title: "Introduction",
        subs: [
          { n: "3.1", title: "Purpose" },
          { n: "3.2", title: "Scope" },
          { n: "3.3", title: "Definitions and Acronyms" },
        ],
      },
      {
        n: "4",
        title: "Business Objectives",
        subs: [
          { n: "4.1", title: "Business Goals" },
          { n: "4.2", title: "Success Criteria" },
          { n: "4.3", title: "Key Performance Indicators (KPIs)" },
        ],
      },
      {
        n: "5",
        title: "Stakeholder Analysis",
        subs: [
          { n: "5.1", title: "Key Stakeholders" },
          { n: "5.2", title: "User Personas" },
        ],
      },
      {
        n: "6",
        title: "Requirements",
        subs: [
          { n: "6.1", title: "Functional Requirements" },
          { n: "6.2", title: "Non-Functional Requirements" },
          { n: "6.3", title: "Technical Requirements" },
          { n: "6.4", title: "Integration Requirements" },
        ],
      },
      {
        n: "7",
        title: "Business Rules",
        subs: [{ n: "7.1", title: "Business Rules Overview" }],
      },
      {
        n: "8",
        title: "Data Requirements",
        subs: [
          { n: "8.1", title: "Data Entities" },
          { n: "8.2", title: "Data Migration" },
        ],
      },
      {
        n: "9",
        title: "Constraints and Assumptions",
        subs: [
          { n: "9.1", title: "Constraints" },
          { n: "9.2", title: "Assumptions" },
          { n: "9.3", title: "Dependencies" },
        ],
      },
      { n: "10", title: "Risks and Mitigation" },
      { n: "11", title: "Timeline and Milestones" },
      {
        n: "12",
        title: "Appendices",
        subs: [
          { n: "12.1", title: "Reference Documents" },
          { n: "12.2", title: "Approval Matrix" },
        ],
      },
      { n: "13", title: "Additional Organizational Guidelines" },
    ];

  const mapFixedKey = (tNorm: string, _content?: string): string | null => {
    if (tNorm === "document information" || tNorm === "doc info") return "1";
    if (tNorm === "executive summary" || tNorm === "project summary" || tNorm === "summary") return "2";
    if (tNorm === "introduction" || tNorm === "intro") return "3";
    if (tNorm === "purpose") return "3.1";
    if (tNorm === "scope") return "3.2";
    if (tNorm === "definitions" || tNorm === "acronyms" || (tNorm.includes("definitions") && tNorm.includes("acronyms"))) return "3.3";

    if (tNorm === "business objectives" || tNorm === "business objective" || tNorm === "objectives") return "4";
    if (tNorm === "business goals" || tNorm === "business goal" || tNorm === "goals") return "4.1";
    if (tNorm === "success criteria") return "4.2";
    if (tNorm === "key performance indicators" || tNorm === "kpi" || tNorm === "kpis") return "4.3";

    if (tNorm === "stakeholder analysis" || tNorm === "stakeholders") return "5";
    if (tNorm === "key stakeholders") return "5.1";
    if (tNorm === "user personas" || tNorm === "personas") return "5.2";

    if (tNorm === "requirements" || tNorm === "requirement") return "6";
    if (tNorm === "functional requirements" || tNorm === "functional") return "6.1";
    if (tNorm === "non-functional requirements" || tNorm === "nfr" || tNorm === "nfrs") return "6.2";
    if (tNorm === "technical requirements") return "6.3";
    if (tNorm === "integration requirements") return "6.4";

    if (tNorm === "business rules" || tNorm === "rule") return "7";
    if (tNorm === "business rules overview" || tNorm === "rules overview") return "7.1";

    if (tNorm === "data requirements" || tNorm === "data") return "8";
    if (tNorm === "data entities" || tNorm === "entity" || tNorm === "entities") return "8.1";
    if (tNorm === "data migration") return "8.2";

    if (tNorm === "constraints and assumptions" || tNorm === "constraints" || tNorm === "assumptions") return "9";
    if (tNorm === "constraints") return "9.1";
    if (tNorm === "assumptions") return "9.2";
    if (tNorm === "dependencies") return "9.3";

    if (tNorm === "risks and mitigation" || tNorm === "risks" || tNorm === "risk") return "10";
    if (tNorm === "timeline and milestones" || tNorm === "timeline" || tNorm === "milestones") return "11";

    if (tNorm === "appendices" || tNorm === "appendix") return "12";
    if (tNorm === "reference documents") return "12.1";
    if (tNorm === "approval matrix") return "12.2";

    if (tNorm === "additional organizational guidelines" || tNorm === "guidelines") return "13";

    return null;
  };

  const isRequirementLikeTitle = (tNorm: string): boolean => {
    return (
      tNorm.includes("requirement") ||
      tNorm.includes("validation") ||
      tNorm.includes("field modification") ||
      tNorm.includes("message tag") ||
      tNorm.includes("integration point") ||
      tNorm.includes("technical specification") ||
      tNorm.includes("interface") ||
      tNorm.includes("api") ||
      tNorm.includes("non functional") ||
      tNorm.includes("functional")
    );
  };

  const mapRequirementSubsection = (tNorm: string): "6.1" | "6.2" | "6.3" | "6.4" | "6.x" => {
    if (tNorm.includes("non functional") || tNorm.includes("nfr") || tNorm.includes("performance") || tNorm.includes("security")) return "6.2";
    if (tNorm.includes("integration") || tNorm.includes("interface") || tNorm.includes("api")) return "6.4";
    if (tNorm.includes("technical") || tNorm.includes("specification") || tNorm.includes("architecture")) return "6.3";
    if (tNorm.includes("functional") || tNorm.includes("business requirement") || tNorm.includes("user story")) return "6.1";
    return "6.x";
  };

  const fixedTitlesByNum = new Map<string, string>();
  const fixedSubTitlesByNum = new Map<string, string>();
  for (const s of FIXED) {
    fixedTitlesByNum.set(s.n, `${s.n}. ${s.title}`);
    for (const sub of s.subs || []) {
      fixedSubTitlesByNum.set(sub.n, `${sub.n} ${sub.title}`);
    }
  }

  const bucket: Record<string, { title: string; contentParts: string[]; originalIndices: number[] }> = {};

  const addToBucket = (key: string, numberedTitle: string, content: string, originalIndex?: number) => {
    if (!bucket[key]) bucket[key] = { title: numberedTitle, contentParts: [], originalIndices: [] };
    const cleaned = stripDuplicatedTopHeading(content || "", numberedTitle);
    if (!cleaned || cleaned === "TBD") return;
    if (bucket[key].contentParts.includes(cleaned)) {
      if (originalIndex !== undefined && !bucket[key].originalIndices.includes(originalIndex))
        bucket[key].originalIndices.push(originalIndex);
      return;
    }
    if (isPlaceholder(cleaned) && bucket[key].contentParts.some((p) => !isPlaceholder(p))) return;
    if (!isPlaceholder(cleaned) && bucket[key].contentParts.every((p) => isPlaceholder(p)))
      bucket[key].contentParts = [];
    if (originalIndex !== undefined && !bucket[key].originalIndices.includes(originalIndex))
      bucket[key].originalIndices.push(originalIndex);
    bucket[key].contentParts.push(cleaned);
  };

  let lastFixedKey = "1";
  for (let i = 0; i < flatSections.length; i++) {
    const sec = flatSections[i];
    const titleRaw = cleanSectionTitleForDisplay(sec.title || "");
    const tNorm = normalizeTitle(titleRaw);
    const numPrefixMatch = titleRaw.match(/^(\d+(?:\.\d+)*)/);
    const explicitNum = numPrefixMatch ? numPrefixMatch[1] : null;

    let key = mapFixedKey(tNorm, sec.content);
    if (!key && explicitNum) {
      if (fixedTitlesByNum.has(explicitNum) || fixedSubTitlesByNum.has(explicitNum))
        key = explicitNum;
    }

    if (key) {
      lastFixedKey = key.includes(".") ? key.split(".")[0] : key;
      const isSub = key.includes(".");
      const numberedTitle = isSub
        ? fixedSubTitlesByNum.get(key) || `${key} ${titleRaw}`
        : fixedTitlesByNum.get(key) || `${key}. ${titleRaw}`;
      addToBucket(key, numberedTitle, sec.content, i);
    } else {
      // If no standard mapping found, use the original numbering if present, else bucket as misc
      const manualNum = explicitNum || `${lastFixedKey}.misc-${i}`;
      const manualTitle = titleRaw || `Section ${manualNum}`;
      addToBucket(manualNum, manualTitle, sec.content, i);
    }
  }

  const out: Array<{ title: string; content: string; originalIndices: number[] }> = [];
  const emitSection = (n: string, title: string, subs?: Array<{ n: string; title: string }>) => {
    const b = bucket[n];
    let finalParts = b ? [...b.contentParts] : [];
    let indices = b ? [...b.originalIndices] : [];

    if (subs) {
      for (const sub of subs) {
        const sb = bucket[sub.n];
        if (sb && sb.contentParts.length > 0) {
          const subTitle = fixedSubTitlesByNum.get(sub.n) || `${sub.n} ${sub.title}`;
          finalParts.push(withHeading(subTitle, sb.contentParts.join("\n\n"), 3));
          if (sb.originalIndices) {
            for (const idx of sb.originalIndices) if (!indices.includes(idx)) indices.push(idx);
          }
        }
      }
    }

    const nTitle = `${n}. ${title}`;
    out.push({
      title: nTitle,
      content: stripDuplicatedTopHeading(finalParts.join("\n\n").trim(), nTitle),
      originalIndices: indices,
    });
  };

  for (const fixed of FIXED) emitSection(fixed.n, fixed.title, fixed.subs);

  // FINAL SAFETY: Emit anything else in the bucket that wasn't a standard fixed section
  const emittedKeys = new Set(out.map(o => o.title.split('.')[0]));
  Object.keys(bucket).forEach(key => {
    if (!emittedKeys.has(key) && !key.includes('.')) {
      emitSection(key, bucket[key].title);
    }
  });

  // Ensure overall numeric sorting so 7 and 8 come between 6 and 9
  out.sort((a, b) => {
    const numA = parseFloat(a.title);
    const numB = parseFloat(b.title);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return 0;
  });

  return out;
};

/**
 * Builds hierarchical sections from flat sections
 */
export const buildHierarchicalSections = (
  flatSections: Array<{ title: string; content: string; originalIndex?: number; originalIndices?: number[] }>
): BRDSection[] => {
  const getNumbering = (section: { title: string; content: string }): string | null => {
    const t = section.title.trim();
    const titleMatch = t.match(/^(\d+(?:\.\d+){0,2})\s*[.)]?\s+/);
    if (titleMatch) return titleMatch[1];
    const contentMatch = section.content.match(/^(#{1,6})\s+(\d+(?:\.\d+){0,2})\s*[.)]?\s+/m);
    if (contentMatch) return contentMatch[2];
    return null;
  };

  const getLevel = (num: string | null): 1 | 2 | 3 => {
    if (!num) return 1;
    const dots = (num.match(/\./g) || []).length;
    if (dots === 0) return 1;
    if (dots === 1) return 2;
    return 3;
  };

  const hierarchicalSections: BRDSection[] = [];
  const stack: Array<{ level: 1 | 2 | 3; node: BRDSection | BRDSubSection }> = [];

  for (let i = 0; i < flatSections.length; i++) {
    const s = flatSections[i];
    const num = getNumbering(s);
    const level = getLevel(num);

    if (level === 1) {
      const node: BRDSection = {
        title: s.title,
        content: s.content,
        subsections: [],
        originalIndex: s.originalIndex ?? i,
        originalIndices: s.originalIndices || [s.originalIndex ?? i],
      };
      hierarchicalSections.push(node);
      stack.length = 0;
      stack.push({ level: 1, node });
      continue;
    }

    const child: BRDSubSection = {
      title: s.title,
      content: s.content,
      originalIndex: s.originalIndex ?? i,
      originalIndices: s.originalIndices || [s.originalIndex ?? i],
      subsections: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1]?.node;
    if (!parent) {
      hierarchicalSections.push({ title: s.title, content: s.content, originalIndex: i });
      continue;
    }

    if ("subsections" in parent) {
      parent.subsections = parent.subsections || [];
      parent.subsections.push(child);
    }
    stack.push({ level, node: child });
  }

  return hierarchicalSections;
};

/**
 * Prepares a BRDDocument object from raw API response data.
 * Priority 1: rawMarkdown (Direct Extraction)
 * Priority 2: generatedBrdJson (Fallback)
 */
export const prepareBrdDocument = (brdData: any): BRDDocument | null => {
  if (!brdData) return null;

  let brd: BRDDocument | null = null;

  if (brdData.generatedMarkdown && brdData.generatedMarkdown.trim() !== "") {
    const markdown = brdData.generatedMarkdown;
    const lines = markdown.split("\n");
    const sections: { title: string; content: string }[] = [];
    let currentSection: { title: string; content: string } | null = null;

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
      if (headingMatch) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          title: headingMatch[2].trim(),
          content: ""
        };
      } else if (currentSection) {
        currentSection.content += line + "\n";
      } else if (line.trim() !== "") {
        currentSection = { title: "Introduction", content: line + "\n" };
      }
    }
    if (currentSection) sections.push(currentSection);

    brd = {
      title: brdData.title || "Business Requirements Document",
      version: "1.0",
      date: brdData.updatedAt || new Date().toISOString().split("T")[0],
      sections: sections.length > 0 ? (sections as BRDSection[]) : [{ title: "Document", content: markdown }],
      rawMarkdown: markdown,
    };
  } else if (brdData.generatedBrdJson) {
    try {
      brd =
        typeof brdData.generatedBrdJson === "string"
          ? JSON.parse(brdData.generatedBrdJson)
          : brdData.generatedBrdJson;
    } catch (e) {
      console.error("[BRD-Utils] Failed to parse generatedBrdJson:", e);
    }
  }

  if (brd) {
    brd.brdFileName = brdData.brdFileName;
    brd.brdFileType = brdData.brdFileType;
  }

  return brd;
};

/**
 * Assembles a complete BRD document as a single markdown string.
 * If rawMarkdown is available, returns it directly.
 */
export const assembleSectionsMarkdown = (brd: BRDDocument): string => {
  if (!brd) return "";

  // Always parse and re-sort even if rawMarkdown exists, to fix out-of-order storage issues
  const sectionsToProcess = (brd.rawMarkdown && (!brd.sections || brd.sections.length === 0))
    ? (prepareBrdDocument({ generatedMarkdown: brd.rawMarkdown })?.sections || [])
    : brd.sections || [];

  // Sort strictly by the leading number (e.g. 6 before 13), stripping markdown hashes first
  const sorted = [...sectionsToProcess].sort((a, b) => {
    const titleA = (a?.title || "").replace(/^#+\s+/, "");
    const titleB = (b?.title || "").replace(/^#+\s+/, "");
    const numA = parseFloat(titleA.match(/^\d+/)?.[0] || "999");
    const numB = parseFloat(titleB.match(/^\d+/)?.[0] || "999");
    return numA - numB;
  });

  return sorted
    .map((section) => {
      const isSelfPlaceholder = isPlaceholder(section.content);
      const level = section.title.split(".").length > 1 ? 3 : 2;
      return withHeading(section.title, isSelfPlaceholder ? "" : section.content, level, true);
    })
    .join("\n\n");
};
