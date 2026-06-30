import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { useGlobalSearch } from "./context";

const DEFAULT_DEBOUNCE_MS = 120;

/** SSR-safe Mac detection so the badge shows ⌘K vs Ctrl+K. */
const isMacPlatform = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform =
    (navigator as Navigator & { platform?: string }).platform || "";
  return /Mac|iPhone|iPad|iPod/i.test(ua) || /Mac/i.test(platform);
};

interface FindInPageInlineProps {
  className?: string;
  placeholder?: string;
  inputClassName?: string;
  /** Override the debounce (ms) before the typed query is published. */
  debounceMs?: number;
}

/**
 * Generic "find in page" inline search input.
 *
 * Owns the typed query and the prev/next match cursor; publishes both into
 * the global-search context so the page that owns the searchable content
 * can filter, highlight, and scroll its rows in place.
 *
 * Keyboard:
 *   - Enter         → next match
 *   - Shift + Enter → previous match
 *   - Esc           → clear / blur
 *   - Ctrl/Cmd + K  → focus the input
 *
 * Pages opt in by calling `useFindInPage(items)` (or by reading
 * `useGlobalSearch()` directly) and rendering `<HighlightedText>` plus a
 * `data-search-id="..."` attribute on each row container.
 */
export function FindInPageInline({
  className,
  placeholder = "Search this page…",
  inputClassName,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: FindInPageInlineProps) {
  const {
    setActiveQuery,
    matchIds,
    matchIndex,
    setMatchIndex,
  } = useGlobalSearch();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounce(query, debounceMs);

  useEffect(() => {
    setActiveQuery(debounced.trim());
  }, [debounced, setActiveQuery]);

  // Reset the active match cursor on every new (debounced) query.
  useEffect(() => {
    setMatchIndex(0);
  }, [debounced, setMatchIndex]);

  // Clear published state on unmount so other pages don't inherit it.
  useEffect(() => {
    return () => {
      setActiveQuery("");
      setMatchIndex(0);
    };
  }, [setActiveQuery, setMatchIndex]);

  // Global Ctrl/Cmd+K shortcut to focus the input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isShortcut =
        (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (!isShortcut) return;
      e.preventDefault();
      const el = inputRef.current;
      if (!el) return;
      if (document.activeElement === el) {
        el.select();
      } else {
        el.focus();
        el.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const total = matchIds.length;
  const hasMatches = total > 0;
  const hasQuery = debounced.trim().length > 0;

  const goNext = () => {
    if (!hasMatches) return;
    setMatchIndex((matchIndex + 1) % total);
  };
  const goPrev = () => {
    if (!hasMatches) return;
    setMatchIndex((matchIndex - 1 + total) % total);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (query) {
        setQuery("");
      } else {
        inputRef.current?.blur();
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) goPrev();
      else goNext();
    }
  };

  const shortcutLabel = isMacPlatform() ? "⌘K" : "Ctrl+K";
  const rightPadding = !hasQuery
    ? "pr-16"
    : hasMatches
      ? "pr-36"
      : "pr-24";

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn("h-9 w-80 pl-8 text-sm", rightPadding, inputClassName)}
        aria-label="Find in page"
      />

      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {hasQuery ? (
          <>
            <span
              className={cn(
                "px-1.5 text-[11px] tabular-nums select-none",
                hasMatches
                  ? "text-muted-foreground"
                  : "text-muted-foreground/60",
              )}
              aria-live="polite"
            >
              {hasMatches ? `${matchIndex + 1} / ${total}` : `0 / 0`}
            </span>
            {hasMatches && (
              <>
                <button
                  type="button"
                  onClick={goPrev}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Previous match (Shift+Enter)"
                  title="Previous match (Shift+Enter)"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Next match (Enter)"
                  title="Next match (Enter)"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Clear search"
              title="Clear (Esc)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <kbd
            className={cn(
              "pointer-events-none mr-1",
              "rounded border border-border/60 bg-muted/60 px-1.5 py-0.5",
              "text-[10px] font-medium text-muted-foreground",
            )}
            aria-hidden="true"
          >
            {shortcutLabel}
          </kbd>
        )}
      </div>
    </div>
  );
}
