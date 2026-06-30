import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { SearchSource } from "./types";

interface GlobalSearchContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  sources: SearchSource[];
  registerSource: (source: SearchSource) => void;
  unregisterSource: (sourceId: string) => void;
  /**
   * The query currently being typed in an inline search input on this page.
   * Pages that want to react to typing (e.g. filter & highlight their own
   * content in place) can subscribe to this value. Inline search components
   * that opt in publish their debounced text here.
   */
  activeQuery: string;
  setActiveQuery: (q: string) => void;
  /**
   * Ordered list of match identifiers (for example `epic:abc-123`,
   * `feature:xyz`, `story:foo`) representing every row on the page whose
   * visible content matches the active query. The page that owns the
   * searchable content publishes this list; the inline search input reads
   * it to drive prev/next navigation.
   */
  matchIds: string[];
  setMatchIds: (ids: string[]) => void;
  /** 0-based index of the currently-focused match within `matchIds`. */
  matchIndex: number;
  setMatchIndex: (n: number) => void;
}

const GlobalSearchContext = createContext<GlobalSearchContextValue | null>(null);

export function GlobalSearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<Map<string, SearchSource>>(() => new Map());
  const [activeQuery, setActiveQuery] = useState("");
  const [matchIds, setMatchIdsState] = useState<string[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);

  const setMatchIds = useCallback((ids: string[]) => {
    setMatchIdsState((prev) => {
      if (
        prev.length === ids.length &&
        prev.every((v, i) => v === ids[i])
      ) {
        return prev;
      }
      return ids;
    });
  }, []);

  const registerSource = useCallback((source: SearchSource) => {
    setSources((prev) => {
      const next = new Map(prev);
      next.set(source.sourceId, source);
      return next;
    });
  }, []);

  const unregisterSource = useCallback((sourceId: string) => {
    setSources((prev) => {
      if (!prev.has(sourceId)) return prev;
      const next = new Map(prev);
      next.delete(sourceId);
      return next;
    });
  }, []);

  const sourcesList = useMemo(() => Array.from(sources.values()), [sources]);

  const value = useMemo<GlobalSearchContextValue>(
    () => ({
      open,
      setOpen,
      sources: sourcesList,
      registerSource,
      unregisterSource,
      activeQuery,
      setActiveQuery,
      matchIds,
      setMatchIds,
      matchIndex,
      setMatchIndex,
    }),
    [
      open,
      sourcesList,
      registerSource,
      unregisterSource,
      activeQuery,
      matchIds,
      setMatchIds,
      matchIndex,
    ],
  );

  return (
    <GlobalSearchContext.Provider value={value}>
      {children}
    </GlobalSearchContext.Provider>
  );
}

export function useGlobalSearch(): GlobalSearchContextValue {
  const ctx = useContext(GlobalSearchContext);
  if (!ctx) {
    throw new Error("useGlobalSearch must be used within a GlobalSearchProvider");
  }
  return ctx;
}

/**
 * Register the current page's data as a search source.
 *
 * IMPORTANT: callers should `useMemo` the `source` object so registration only
 * re-runs when the underlying data changes. Pass `null` to skip registration
 * (useful when the page hasn't loaded data yet).
 */
export function useRegisterSearchSource(source: SearchSource | null) {
  // Safe to call outside a provider during SSR / tests by returning early.
  const ctx = useContext(GlobalSearchContext);
  useEffect(() => {
    if (!ctx || !source) return;
    ctx.registerSource(source);
    return () => ctx.unregisterSource(source.sourceId);
  }, [ctx, source]);
}
