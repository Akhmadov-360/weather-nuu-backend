import type { KnowledgeLang } from "./chunk.js";
import type { KnowledgeIndex, SearchMode } from "./index-search.js";

/** A question and the topic whose fragments answer it (the file name without the language, for example `sensors`). */
export type RetrievalCase = { lang: KnowledgeLang; question: string; topic: string };

export type ModeScore = { mode: SearchMode; recallAt1: number; recallAt3: number; recallAt5: number; mrr: number };

const isRelevant = (chunkId: string, topic: string) => chunkId.startsWith(`${topic}.`);

/**
 * Whether the right fragment was found and at which place, for each way of searching. A fragment is right when it
 * belongs to the topic of the question, in any language (the vectors work across languages; the keyword search
 * does not, and the table shows it). recall@k: the share of questions with a right fragment among the first k.
 * MRR: the mean of 1/place of the first right fragment (0 when there is none among the first 10).
 */
export async function evaluateRetrieval(
  index: KnowledgeIndex,
  cases: RetrievalCase[],
  embedQuery: (text: string) => Promise<Float32Array>,
  modes: SearchMode[] = ["vector", "bm25", "hybrid"],
): Promise<ModeScore[]> {
  const embeddings = await Promise.all(cases.map((c) => embedQuery(c.question)));
  return modes.map((mode) => {
    let r1 = 0;
    let r3 = 0;
    let r5 = 0;
    let rr = 0;
    cases.forEach((c, i) => {
      const hits = index.search({ text: c.question, embedding: embeddings[i]!, k: 10, mode });
      const place = hits.findIndex((h) => isRelevant(h.chunk.id, c.topic)) + 1;
      if (place > 0) {
        if (place <= 1) r1++;
        if (place <= 3) r3++;
        if (place <= 5) r5++;
        rr += 1 / place;
      }
    });
    const n = cases.length || 1;
    return { mode, recallAt1: r1 / n, recallAt3: r3 / n, recallAt5: r5 / n, mrr: rr / n };
  });
}
