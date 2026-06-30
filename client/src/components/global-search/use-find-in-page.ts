import { useEffect, useMemo } from "react";
import { useGlobalSearch } from "./context";

export interface FindInPageItem {
  /**
   * A stable identifier used for both navigation order and DOM lookup.
   * The page must render this exact string as `data-search-id="..."` on
   * the matching row container so scroll-on-active can find it.
   */
  id: string;
  /** The text that should be matched against the active query. */
  text: string;
}

export interface UseFindInPageResult {
  /** Trimmed query published by the inline search input. */
  activeQuery: string;
  /** The currently-active match id (drives auto-scroll + active styling). */
  activeId: string | null;
  /** True when this row's text contains the active query. */
  isMatch: (id: string) => boolean;
  /** True when this row is the currently-focused match. */
  isActiveMatch: (id: string) => boolean;
  /** All matched ids, in the order the page provided them. */
  matchIds: string[];
}

/**
 * Wires a page's searchable items into the global "find in page" flow.
 *
 * Consumers pass an ordered list of `{ id, text }` items. The hook:
 *   1. Computes which items match the current `activeQuery` (case-insensitive
 *      substring), preserving the caller-provided order.
 *   2. Publishes that ordered list to the global-search context so the
 *      `FindInPageInline` input can drive prev/next navigation and the
 *      `current / total` counter.
 *   3. Auto-scrolls the active match into view by querying the DOM for
 *      `[data-search-id="<id>"]`.
 *
 * The caller is responsible for:
 *   - Rendering `data-search-id="..."` on each matchable row container.
 *   - Wrapping the matched text in `<HighlightedText query={activeQuery}
 *     isActive={isActiveMatch(id)} />` (or applying its own highlight).
 *   - Optionally adding an "active" affordance to the row container, e.g.
 *     a left border, when `isActiveMatch(id)` is true.
 *
 * IMPORTANT: pass a *memoised* `items` array (e.g. via `useMemo`), otherwise
 * the hook re-publishes match ids on every render.
 */
export function useFindInPage(items: FindInPageItem[]): UseFindInPageResult {
  const {
    activeQuery,
    setMatchIds,
    matchIndex,
  } = useGlobalSearch();

  const matchIds = useMemo<string[]>(() => {
    const q = activeQuery.trim().toLowerCase();
    if (!q) return [];
    const ids: string[] = [];
    for (const item of items) {
      if (!item.text) continue;
      if (item.text.toLowerCase().includes(q)) ids.push(item.id);
    }
    return ids;
  }, [activeQuery, items]);

  // Publish the matches to the global-search context.
  useEffect(() => {
    setMatchIds(matchIds);
  }, [matchIds, setMatchIds]);

  // Reset published matches when the page unmounts so the input on the
  // next page doesn't inherit a stale `n / N`.
  useEffect(() => {
    return () => {
      setMatchIds([]);
    };
  }, [setMatchIds]);

  const activeId = matchIds[matchIndex] ?? null;

  // Scroll the active row into view AND mark it via a data attribute, so
  // pages that don't want to thread `activeId` through their component
  // tree can simply target `[data-find-in-page-active="true"]` in CSS.
  //
  // Some pages need a couple of frames before the active row exists in the
  // DOM (e.g. the artifacts page expands ancestor work items in a sibling
  // effect that fires off the same `activeId` change, and the spec/specs
  // pages can lazily mount group children on first match). To handle that
  // reliably, we re-query for a few animation frames before giving up.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!activeId) return;

    let cancelled = false;
    let foundEl: HTMLElement | null = null;
    let rafId: number | null = null;
    const MAX_ATTEMPTS = 8;

    const tryLocate = (attempt: number) => {
      if (cancelled) return;
      const el = document.querySelector(
        `[data-search-id="${CSS.escape(activeId)}"]`,
      ) as HTMLElement | null;
      if (el) {
        foundEl = el;
        el.setAttribute("data-find-in-page-active", "true");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (attempt >= MAX_ATTEMPTS) return;
      rafId = window.requestAnimationFrame(() => tryLocate(attempt + 1));
    };

    tryLocate(0);

    return () => {
      cancelled = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (foundEl) foundEl.removeAttribute("data-find-in-page-active");
    };
  }, [activeId]);

  const matchSet = useMemo(() => new Set(matchIds), [matchIds]);

  return {
    activeQuery,
    activeId,
    isMatch: (id: string) => matchSet.has(id),
    isActiveMatch: (id: string) => activeId === id,
    matchIds,
  };
}
