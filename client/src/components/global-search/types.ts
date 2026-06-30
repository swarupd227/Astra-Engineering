export type EntityId = string | number;

export type SearchResultKind = "epic" | "feature" | "story" | "brd-match" | "file-match";

interface SearchableBase {
  /** Unique global key, e.g. `specs:epic:16992` */
  entityKey: string;
  title: string;
  description?: string;
  /** Optional subtitle override (parent context). */
  subtitle?: string;
}

export interface SearchableEpic extends SearchableBase {
  id: EntityId;
  childCount?: number;
  /** Optional child Feature keys for "expand all" jump behavior. */
  childFeatureKeys?: string[];
}

export interface SearchableFeature extends SearchableBase {
  id: EntityId;
  parentEpicId?: EntityId;
  parentEpicTitle?: string;
  storyCount?: number;
}

export interface SearchableStory extends SearchableBase {
  id: EntityId;
  acceptanceCriteria?: string;
  parentFeatureId?: EntityId;
  parentFeatureTitle?: string;
}

export interface SearchableBrdChunk {
  id: string;
  heading?: string;
  content: string;
}

export interface SearchableBrdSource {
  entityKey: string;
  documentId?: EntityId;
  documentTitle: string;
  chunks: SearchableBrdChunk[];
}

export interface SearchableFileSource {
  fileId: string;
  fileName: string;
  filePath: string;
  parentTitle: string;
  content: string;
  featureId?: number;
}

// ── Result rows produced by the palette ────────────────────────────────────

export interface SearchResultBase {
  key: string;
  kind: SearchResultKind;
  title: string;
  subtitle?: string;
  snippet?: string;
  score: number;
  /** Where this match came from (page that registered the source). */
  sourceId: string;
  sourceLabel: string;
}

export interface EpicResult extends SearchResultBase {
  kind: "epic";
  entity: SearchableEpic;
}

export interface FeatureResult extends SearchResultBase {
  kind: "feature";
  entity: SearchableFeature;
}

export interface StoryResult extends SearchResultBase {
  kind: "story";
  entity: SearchableStory;
}

export interface BrdMatchResult extends SearchResultBase {
  kind: "brd-match";
  source: SearchableBrdSource;
  chunkId: string;
  /** First search token (case-insensitive substring). */
  highlightTerm: string;
}

export interface FileMatchResult extends SearchResultBase {
  kind: "file-match";
  source: SearchableFileSource;
  /** Offset of the first matched char inside `source.content`. */
  matchOffset: number;
  highlightTerm: string;
}

export type SearchResult =
  | EpicResult
  | FeatureResult
  | StoryResult
  | BrdMatchResult
  | FileMatchResult;

export interface SearchResultGroups {
  brdMatches: BrdMatchResult[];
  fileMatches: FileMatchResult[];
  epics: EpicResult[];
  features: FeatureResult[];
  stories: StoryResult[];
  totalCount: number;
}

// ── Source registration contract ───────────────────────────────────────────

export interface SearchSource {
  /** Unique per page (e.g. "specs", "sdlc", "brd", "workflow", "hub"). */
  sourceId: string;
  /** Shown in result subtitles to disambiguate origin. */
  sourceLabel: string;
  epics?: SearchableEpic[];
  features?: SearchableFeature[];
  stories?: SearchableStory[];
  brdSources?: SearchableBrdSource[];
  fileSources?: SearchableFileSource[];
  onSelectEpic?: (result: EpicResult) => void;
  onSelectFeature?: (result: FeatureResult) => void;
  onSelectStory?: (result: StoryResult) => void;
  onSelectBrdMatch?: (result: BrdMatchResult) => void;
  onSelectFileMatch?: (result: FileMatchResult) => void;
}
