/**
 * RAG query: given stack and error/query text, return top-k doc chunks for the fix agent.
 */

import type { DocStack } from "./types";
import { getDocChunks } from "./ingest-docs";

const DEFAULT_TOP_K = 5;

function scoreChunk(chunk: { text: string; keywords?: string[] }, query: string): number {
  const q = query.toLowerCase();
  const text = chunk.text.toLowerCase();
  let score = 0;
  if (chunk.keywords) {
    for (const kw of chunk.keywords) {
      if (q.includes(kw.toLowerCase()) || text.includes(kw.toLowerCase())) score += 2;
    }
  }
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  for (const w of words) {
    if (text.includes(w)) score += 1;
  }
  if (text.includes(q)) score += 3;
  return score;
}

/**
 * Query docs for a stack; returns top-k chunk texts for use in fix-agent prompt.
 */
export async function queryDocs(
  stack: DocStack,
  query: string,
  topK: number = DEFAULT_TOP_K
): Promise<string[]> {
  const chunks = getDocChunks().filter((c) => c.stack === stack);
  if (chunks.length === 0) return [];
  const scored = chunks.map((c) => ({ chunk: c, score: scoreChunk(c, query) }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);
  return top.map((t) => t.chunk.text);
}
