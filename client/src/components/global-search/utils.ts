import type {
  BrdMatchResult,
  EpicResult,
  FeatureResult,
  FileMatchResult,
  SearchResult,
  SearchResultGroups,
  SearchSource,
  SearchableBrdSource,
  SearchableEpic,
  SearchableFeature,
  SearchableFileSource,
  SearchableStory,
  StoryResult,
} from "./types";

export const MAX_PER_GROUP = 8;
export const SNIPPET_CONTEXT = 60;
export const MAX_MATCHES_PER_FILE = 3;
// Allow several in-chunk hits so a broad query like "BR-" inside a single
// "Functional Requirements" section surfaces multiple distinct requirements
// instead of collapsing to only the first one.
export const MAX_MATCHES_PER_BRD_CHUNK = 8;

const HIGHLIGHT_OPEN = "<<";
const HIGHLIGHT_CLOSE = ">>";

const stripHtml = (s: string): string =>
  s ? s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";

// Position-preserving character normalization. Maps Unicode look-alikes back
// to ASCII so that e.g. searching "BR-09" still matches "BR‑09" (non-breaking
// hyphen), and "don't" matches "don't" (curly apostrophe). Every replacement
// is a single character so string offsets remain valid for snippet extraction.
export const normalizeForSearch = (s: string): string => {
  if (!s) return "";
  return s
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/\u00A0/g, " ");
};

export const tokens = (q: string): string[] =>
  normalizeForSearch(q)
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

const matchesAllTokens = (haystack: string, needles: string[]): boolean => {
  if (needles.length === 0) return true;
  const hay = normalizeForSearch(haystack).toLowerCase();
  return needles.every((t) => hay.includes(t));
};

const firstHitOffset = (text: string, needles: string[]): number => {
  if (needles.length === 0) return -1;
  return normalizeForSearch(text).toLowerCase().indexOf(needles[0]);
};

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const safeText = (s?: string): string => (s ? stripHtml(s) : "");

export const extractSnippet = (
  content: string,
  needles: string[],
  matchOffset: number,
  ctx = SNIPPET_CONTEXT,
): string => {
  if (!content || matchOffset < 0) return "";
  const first = needles[0] ?? "";
  const start = Math.max(0, matchOffset - ctx);
  const end = Math.min(content.length, matchOffset + first.length + ctx);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  const slice = content.slice(start, end);
  if (!first) return `${prefix}${slice}${suffix}`.replace(/\s+/g, " ");
  let highlighted = slice;
  for (const n of needles) {
    if (!n) continue;
    const re = new RegExp(escapeRegex(n), "gi");
    highlighted = highlighted.replace(
      re,
      (m) => `${HIGHLIGHT_OPEN}${m}${HIGHLIGHT_CLOSE}`,
    );
  }
  return `${prefix}${highlighted}${suffix}`.replace(/[ \t]+/g, " ").trim();
};

const buildTitleSnippet = (text: string, needles: string[]): string | undefined => {
  if (!text || needles.length === 0) return undefined;
  const off = firstHitOffset(text, needles);
  if (off < 0) return undefined;
  return extractSnippet(text, needles, off);
};

// ── Per-entity scorers ─────────────────────────────────────────────────────

const epicResultsFor = (
  source: SearchSource,
  needles: string[],
): EpicResult[] => {
  const out: EpicResult[] = [];
  for (const e of source.epics ?? []) {
    const title = safeText(e.title);
    const desc = safeText(e.description);
    const titleMatch = matchesAllTokens(title, needles);
    const descMatch = !titleMatch && matchesAllTokens(`${title} ${desc}`, needles);
    if (!titleMatch && !descMatch) continue;
    const score = (titleMatch ? 100 : 60) + Math.max(0, 30 - title.length / 8);
    out.push({
      key: e.entityKey,
      kind: "epic",
      title,
      subtitle:
        e.subtitle ??
        `Epic · ${source.sourceLabel}` +
          (typeof e.childCount === "number"
            ? ` · ${e.childCount} feature${e.childCount === 1 ? "" : "s"}`
            : ""),
      snippet: descMatch ? buildTitleSnippet(desc, needles) : undefined,
      score,
      sourceId: source.sourceId,
      sourceLabel: source.sourceLabel,
      entity: e,
    });
  }
  return out;
};

const featureResultsFor = (
  source: SearchSource,
  needles: string[],
): FeatureResult[] => {
  const out: FeatureResult[] = [];
  for (const f of source.features ?? []) {
    const title = safeText(f.title);
    const desc = safeText(f.description);
    const titleMatch = matchesAllTokens(title, needles);
    const descMatch = !titleMatch && matchesAllTokens(`${title} ${desc}`, needles);
    if (!titleMatch && !descMatch) continue;
    const score = (titleMatch ? 90 : 55) + Math.max(0, 25 - title.length / 8);
    out.push({
      key: f.entityKey,
      kind: "feature",
      title,
      subtitle:
        f.subtitle ??
        (f.parentEpicTitle
          ? `Feature · ${f.parentEpicTitle} · ${source.sourceLabel}`
          : `Feature · ${source.sourceLabel}`),
      snippet: descMatch ? buildTitleSnippet(desc, needles) : undefined,
      score,
      sourceId: source.sourceId,
      sourceLabel: source.sourceLabel,
      entity: f,
    });
  }
  return out;
};

const storyResultsFor = (
  source: SearchSource,
  needles: string[],
): StoryResult[] => {
  const out: StoryResult[] = [];
  for (const s of source.stories ?? []) {
    const title = safeText(s.title);
    const desc = safeText(s.description);
    const ac = safeText(s.acceptanceCriteria);
    const titleMatch = matchesAllTokens(title, needles);
    const bodyMatch =
      !titleMatch && matchesAllTokens(`${title} ${desc} ${ac}`, needles);
    if (!titleMatch && !bodyMatch) continue;
    const score = (titleMatch ? 80 : 50) + Math.max(0, 20 - title.length / 8);
    out.push({
      key: s.entityKey,
      kind: "story",
      title,
      subtitle:
        s.subtitle ??
        (s.parentFeatureTitle
          ? `User Story · ${s.parentFeatureTitle} · ${source.sourceLabel}`
          : `User Story · ${source.sourceLabel}`),
      snippet: bodyMatch ? buildTitleSnippet(`${desc} ${ac}`.trim(), needles) : undefined,
      score,
      sourceId: source.sourceId,
      sourceLabel: source.sourceLabel,
      entity: s,
    });
  }
  return out;
};

const brdMatchesFor = (
  source: SearchSource,
  needles: string[],
): BrdMatchResult[] => {
  const out: BrdMatchResult[] = [];
  if (needles.length === 0) return out;
  for (const brd of source.brdSources ?? []) {
    for (const chunk of brd.chunks) {
      const headingHit = chunk.heading
        ? matchesAllTokens(chunk.heading, needles)
        : false;
      const contentLower = normalizeForSearch(chunk.content || "").toLowerCase();
      const first = needles[0];
      let at = contentLower.indexOf(first);
      let perChunk = 0;
      while (at >= 0 && perChunk < MAX_MATCHES_PER_BRD_CHUNK) {
        const ws = Math.max(0, at - SNIPPET_CONTEXT);
        const we = Math.min(chunk.content.length, at + first.length + SNIPPET_CONTEXT);
        const window = chunk.content.slice(ws, we);
        if (matchesAllTokens(window, needles)) {
          out.push({
            key: `${brd.entityKey}:${chunk.id}:${at}`,
            kind: "brd-match",
            title: chunk.heading || brd.documentTitle,
            subtitle: `${brd.documentTitle} · ${source.sourceLabel}`,
            snippet: extractSnippet(chunk.content, needles, at),
            score: (headingHit ? 75 : 65) - perChunk * 5,
            sourceId: source.sourceId,
            sourceLabel: source.sourceLabel,
            source: brd,
            chunkId: chunk.id,
            highlightTerm: first,
          });
          perChunk++;
        }
        at = contentLower.indexOf(first, at + first.length);
      }
      if (perChunk === 0 && headingHit) {
        out.push({
          key: `${brd.entityKey}:${chunk.id}:heading`,
          kind: "brd-match",
          title: chunk.heading || brd.documentTitle,
          subtitle: `${brd.documentTitle} · ${source.sourceLabel}`,
          snippet: buildTitleSnippet(chunk.heading || "", needles),
          score: 72,
          sourceId: source.sourceId,
          sourceLabel: source.sourceLabel,
          source: brd,
          chunkId: chunk.id,
          highlightTerm: first,
        });
      }
    }
  }
  return out;
};

const fileMatchesFor = (
  source: SearchSource,
  needles: string[],
): FileMatchResult[] => {
  const out: FileMatchResult[] = [];
  if (needles.length === 0) return out;
  for (const file of source.fileSources ?? []) {
    const content = file.content || "";
    if (!content) continue;
    const hayLower = normalizeForSearch(content).toLowerCase();
    let cursor = 0;
    let perFile = 0;
    const first = needles[0];
    while (perFile < MAX_MATCHES_PER_FILE) {
      const at = hayLower.indexOf(first, cursor);
      if (at < 0) break;
      const ws = Math.max(0, at - SNIPPET_CONTEXT);
      const we = Math.min(content.length, at + first.length + SNIPPET_CONTEXT);
      const window = content.slice(ws, we);
      if (matchesAllTokens(window, needles)) {
        out.push({
          key: `${source.sourceId}:file:${file.fileId}:${at}`,
          kind: "file-match",
          title: file.fileName || file.filePath,
          subtitle: `${file.parentTitle} · ${file.filePath} · ${source.sourceLabel}`,
          snippet: extractSnippet(content, needles, at),
          score: 70 - perFile * 5,
          sourceId: source.sourceId,
          sourceLabel: source.sourceLabel,
          source: file,
          matchOffset: at,
          highlightTerm: first,
        });
        perFile++;
      }
      cursor = at + first.length;
    }
  }
  return out;
};

export const buildSearchResults = (
  query: string,
  sources: SearchSource[],
): SearchResultGroups => {
  const needles = tokens(query);
  if (needles.length === 0) {
    return {
      brdMatches: [],
      fileMatches: [],
      epics: [],
      features: [],
      stories: [],
      totalCount: 0,
    };
  }

  const epicHits: EpicResult[] = [];
  const featureHits: FeatureResult[] = [];
  const storyHits: StoryResult[] = [];
  const brdHits: BrdMatchResult[] = [];
  const fileHits: FileMatchResult[] = [];

  for (const source of sources) {
    epicHits.push(...epicResultsFor(source, needles));
    featureHits.push(...featureResultsFor(source, needles));
    storyHits.push(...storyResultsFor(source, needles));
    brdHits.push(...brdMatchesFor(source, needles));
    fileHits.push(...fileMatchesFor(source, needles));
  }

  epicHits.sort((a, b) => b.score - a.score);
  featureHits.sort((a, b) => b.score - a.score);
  storyHits.sort((a, b) => b.score - a.score);
  brdHits.sort((a, b) => b.score - a.score);
  fileHits.sort((a, b) => b.score - a.score);

  return {
    brdMatches: brdHits.slice(0, MAX_PER_GROUP),
    fileMatches: fileHits.slice(0, MAX_PER_GROUP),
    epics: epicHits.slice(0, MAX_PER_GROUP),
    features: featureHits.slice(0, MAX_PER_GROUP),
    stories: storyHits.slice(0, MAX_PER_GROUP),
    totalCount:
      epicHits.length +
      featureHits.length +
      storyHits.length +
      brdHits.length +
      fileHits.length,
  };
};

export const splitHighlightSegments = (
  snippet: string,
): Array<{ text: string; highlighted: boolean }> => {
  if (!snippet) return [];
  const segments: Array<{ text: string; highlighted: boolean }> = [];
  let i = 0;
  while (i < snippet.length) {
    const open = snippet.indexOf(HIGHLIGHT_OPEN, i);
    if (open < 0) {
      segments.push({ text: snippet.slice(i), highlighted: false });
      break;
    }
    if (open > i) {
      segments.push({ text: snippet.slice(i, open), highlighted: false });
    }
    const close = snippet.indexOf(HIGHLIGHT_CLOSE, open + HIGHLIGHT_OPEN.length);
    if (close < 0) {
      segments.push({
        text: snippet.slice(open + HIGHLIGHT_OPEN.length),
        highlighted: true,
      });
      break;
    }
    segments.push({
      text: snippet.slice(open + HIGHLIGHT_OPEN.length, close),
      highlighted: true,
    });
    i = close + HIGHLIGHT_CLOSE.length;
  }
  return segments;
};

export const orderedResults = (groups: SearchResultGroups): SearchResult[] => [
  ...groups.brdMatches,
  ...groups.fileMatches,
  ...groups.epics,
  ...groups.features,
  ...groups.stories,
];

// Type-erased helpers for entity adapters (used by individual pages)
export const adaptEpic = <T>(
  entityKey: string,
  e: T,
  pick: (e: T) => Omit<SearchableEpic, "entityKey">,
): SearchableEpic => ({ entityKey, ...pick(e) });

export const adaptFeature = <T>(
  entityKey: string,
  f: T,
  pick: (f: T) => Omit<SearchableFeature, "entityKey">,
): SearchableFeature => ({ entityKey, ...pick(f) });

export const adaptStory = <T>(
  entityKey: string,
  s: T,
  pick: (s: T) => Omit<SearchableStory, "entityKey">,
): SearchableStory => ({ entityKey, ...pick(s) });
