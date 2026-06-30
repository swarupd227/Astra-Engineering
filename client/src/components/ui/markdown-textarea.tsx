import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { richHtmlToMarkdown } from "@/lib/markdown-paste";

/**
 * Replace the value of a controlled <textarea> in a way that React notices,
 * so the element's existing `onChange` handler fires exactly once with the
 * new value. This keeps <MarkdownTextarea> a true drop-in for <Textarea> –
 * callers don't need to change their onChange handlers.
 */
function setReactTextareaValue(el: HTMLTextAreaElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export type MarkdownTextareaProps = React.ComponentProps<typeof Textarea>;

/**
 * A drop-in replacement for <Textarea> that converts rich clipboard content
 * (HTML – e.g. tables copied from Confluence, Word, Excel or web pages) into
 * GFM Markdown on paste, instead of letting the browser strip it down to
 * structureless plain text. Plain-text pastes are left completely untouched.
 */
export const MarkdownTextarea = React.forwardRef<
  HTMLTextAreaElement,
  MarkdownTextareaProps
>(({ onPaste, ...props }, ref) => {
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Let any caller-provided handler run first; respect its preventDefault().
    onPaste?.(e);
    if (e.defaultPrevented) return;

    const html = e.clipboardData.getData("text/html");
    if (!html) return; // No rich content -> normal plain-text paste.

    let markdown = "";
    try {
      markdown = richHtmlToMarkdown(html);
    } catch {
      return; // On any conversion error, fall back to default paste behavior.
    }
    if (!markdown) return;

    e.preventDefault();

    const el = e.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const nextValue = el.value.slice(0, start) + markdown + el.value.slice(end);

    setReactTextareaValue(el, nextValue);

    // Restore the caret to just after the inserted Markdown.
    const caret = start + markdown.length;
    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* element may have unmounted */
      }
    });
  };

  return <Textarea ref={ref} onPaste={handlePaste} {...props} />;
});

MarkdownTextarea.displayName = "MarkdownTextarea";
