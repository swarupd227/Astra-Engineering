import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface HighlightedTextProps {
  /** The full text to render. */
  text: string;
  /**
   * Substring to highlight (case-insensitive). When empty / whitespace,
   * the text is rendered as-is with no marks.
   */
  query?: string | null;
  /**
   * When true, this row is the *active* find-in-page match. Highlights are
   * rendered with a brighter color so it stands out from the rest. The
   * caller is also expected to render an "active" affordance (e.g. a left
   * border or ring) on the row container.
   */
  isActive?: boolean;
  /** Optional className applied to the wrapping span. */
  className?: string;
  /** Optional className applied to each <mark>. */
  highlightClassName?: string;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Renders `text` with case-insensitive matches of `query` wrapped in `<mark>`.
 *
 * Used by the "find in page" inline search to highlight the typed term
 * inside any text the page surfaces (titles, snippets, list items, etc.)
 * without changing how the text is otherwise styled or laid out.
 */
export function HighlightedText({
  text,
  query,
  isActive = false,
  className,
  highlightClassName,
}: HighlightedTextProps) {
  const segments = useMemo(() => {
    const q = (query ?? "").trim();
    if (!q || !text) return [{ text, match: false }];
    const re = new RegExp(escapeRegex(q), "gi");
    const out: Array<{ text: string; match: boolean }> = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      const idx = m.index ?? 0;
      if (idx > last) out.push({ text: text.slice(last, idx), match: false });
      out.push({ text: m[0], match: true });
      last = idx + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last), match: false });
    return out;
  }, [text, query]);

  if (segments.length === 1 && !segments[0].match) {
    return <span className={className}>{segments[0].text}</span>;
  }

  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className={cn(
              "rounded-sm px-0.5 text-foreground transition-colors",
              isActive
                ? "bg-amber-300 dark:bg-amber-400/70 ring-1 ring-amber-500/60"
                : "bg-yellow-200/50 dark:bg-yellow-400/20",
              highlightClassName,
            )}
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
