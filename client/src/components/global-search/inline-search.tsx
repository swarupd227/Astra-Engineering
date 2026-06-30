import { useEffect, useMemo, useRef, useState } from "react";
import {
  Crown,
  FileCode,
  FileText,
  Layers,
  ListChecks,
  Search,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { useGlobalSearch } from "./context";
import { buildSearchResults, splitHighlightSegments } from "./utils";
import type { SearchResult } from "./types";

const KIND_ICON = {
  "brd-match": FileText,
  "file-match": FileCode,
  epic: Crown,
  feature: Layers,
  story: ListChecks,
} as const;

function SnippetText({ snippet }: { snippet?: string }) {
  if (!snippet) return null;
  const segments = splitHighlightSegments(snippet);
  return (
    <span className="block text-[11px] text-muted-foreground truncate">
      {segments.map((seg, i) =>
        seg.highlighted ? (
          <mark
            key={i}
            className="rounded-sm bg-yellow-400/40 px-0.5 text-foreground"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}

interface ResultRowProps {
  result: SearchResult;
  active: boolean;
  onSelect: (r: SearchResult) => void;
  onHover: () => void;
}

function ResultRow({ result, active, onSelect, onHover }: ResultRowProps) {
  const Icon = KIND_ICON[result.kind];
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // Prevent input from losing focus before click handler fires.
        e.preventDefault();
      }}
      onClick={() => onSelect(result)}
      onMouseEnter={onHover}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-foreground",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          result.kind === "epic" && "text-amber-500",
          result.kind === "feature" && "text-blue-500",
          result.kind === "story" && "text-emerald-500",
          result.kind === "brd-match" && "text-violet-500",
          result.kind === "file-match" && "text-rose-500",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{result.title}</p>
        {result.subtitle ? (
          <p className="truncate text-[11px] text-muted-foreground">
            {result.subtitle}
          </p>
        ) : null}
        <SnippetText snippet={result.snippet} />
      </div>
    </button>
  );
}

interface GlobalSearchInlineProps {
  className?: string;
  placeholder?: string;
  /** Width of the search input. Defaults to a sensible compact size. */
  inputClassName?: string;
}

/**
 * Inline page-level search input that replaces the modal command palette.
 * Drops a small search field with a popover dropdown of results directly in
 * the page header. Uses the same registered search sources, callbacks, and
 * matching logic as the previous palette — only the surface changed.
 */
export function GlobalSearchInline({
  className,
  placeholder = "Search BRD, Epics, Features, Stories...",
  inputClassName,
}: GlobalSearchInlineProps) {
  const { sources } = useGlobalSearch();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounce(query, 150);

  const groups = useMemo(() => {
    const q = debounced.trim();
    if (!q) return null;
    return buildSearchResults(q, sources);
  }, [debounced, sources]);

  const flatResults: SearchResult[] = useMemo(() => {
    if (!groups) return [];
    return [
      ...groups.brdMatches,
      ...groups.fileMatches,
      ...groups.epics,
      ...groups.features,
      ...groups.stories,
    ];
  }, [groups]);

  useEffect(() => {
    setActiveIdx(0);
  }, [debounced]);

  const handleSelect = (result: SearchResult) => {
    // Close the dropdown but keep the query and results so the user can
    // come back to the same suggestions without retyping. Refocusing the
    // input (or pressing ↓) reopens the popover with the same matches.
    setOpen(false);
    const source = sources.find((s) => s.sourceId === result.sourceId);
    if (!source) return;
    switch (result.kind) {
      case "epic":
        source.onSelectEpic?.(result);
        break;
      case "feature":
        source.onSelectFeature?.(result);
        break;
      case "story":
        source.onSelectStory?.(result);
        break;
      case "brd-match":
        source.onSelectBrdMatch?.(result);
        break;
      case "file-match":
        source.onSelectFileMatch?.(result);
        break;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (query) {
        setQuery("");
        setOpen(false);
      } else {
        setOpen(false);
        inputRef.current?.blur();
      }
      return;
    }
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
    }
    if (flatResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = flatResults[activeIdx];
      if (r) handleSelect(r);
    }
  };

  const hasQuery = debounced.trim().length > 0;
  const showResults = open && hasQuery && groups !== null;
  const isEmpty = showResults && groups.totalCount === 0;

  return (
    <div className={cn("relative", className)}>
      <Popover open={showResults} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => {
                if (query.trim().length > 0) setOpen(true);
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className={cn(
                "h-9 w-72 pl-8 pr-8 text-sm",
                inputClassName,
              )}
              aria-label="Search this page"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setOpen(false);
                  inputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="end"
          sideOffset={4}
          className="w-[28rem] max-w-[calc(100vw-2rem)] p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {isEmpty ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No matches for "{debounced}".
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {groups && groups.brdMatches.length > 0 && (
                <ResultGroup
                  title={`BRD Matches (${groups.brdMatches.length})`}
                  results={groups.brdMatches}
                  flatResults={flatResults}
                  activeIdx={activeIdx}
                  onSelect={handleSelect}
                  onHover={setActiveIdx}
                />
              )}
              {groups && groups.fileMatches.length > 0 && (
                <ResultGroup
                  title={`Spec Files (${groups.fileMatches.length})`}
                  results={groups.fileMatches}
                  flatResults={flatResults}
                  activeIdx={activeIdx}
                  onSelect={handleSelect}
                  onHover={setActiveIdx}
                />
              )}
              {groups && groups.epics.length > 0 && (
                <ResultGroup
                  title={`Epics (${groups.epics.length})`}
                  results={groups.epics}
                  flatResults={flatResults}
                  activeIdx={activeIdx}
                  onSelect={handleSelect}
                  onHover={setActiveIdx}
                />
              )}
              {groups && groups.features.length > 0 && (
                <ResultGroup
                  title={`Features (${groups.features.length})`}
                  results={groups.features}
                  flatResults={flatResults}
                  activeIdx={activeIdx}
                  onSelect={handleSelect}
                  onHover={setActiveIdx}
                />
              )}
              {groups && groups.stories.length > 0 && (
                <ResultGroup
                  title={`User Stories (${groups.stories.length})`}
                  results={groups.stories}
                  flatResults={flatResults}
                  activeIdx={activeIdx}
                  onSelect={handleSelect}
                  onHover={setActiveIdx}
                />
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface ResultGroupProps {
  title: string;
  results: SearchResult[];
  flatResults: SearchResult[];
  activeIdx: number;
  onSelect: (r: SearchResult) => void;
  onHover: (idx: number) => void;
}

function ResultGroup({
  title,
  results,
  flatResults,
  activeIdx,
  onSelect,
  onHover,
}: ResultGroupProps) {
  return (
    <div className="px-1 pb-1 last:pb-0">
      <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-0.5">
        {results.map((r) => {
          const idx = flatResults.findIndex((x) => x.key === r.key);
          return (
            <ResultRow
              key={r.key}
              result={r}
              active={idx === activeIdx}
              onSelect={onSelect}
              onHover={() => onHover(idx)}
            />
          );
        })}
      </div>
    </div>
  );
}
