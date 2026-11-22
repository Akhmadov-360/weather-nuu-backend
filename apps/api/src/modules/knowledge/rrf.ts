import type { ScoredIndex } from "./bm25.js";

/**
 * Reciprocal Rank Fusion, formula (5): RRF(d) = sum over lists i of 1 / (k + rank_i(d)), ranks from 1.
 * Only the places in the lists count, not the scores, so lists with different scales (a cosine and BM25) can be merged.
 */
export function rrfFuse(rankings: number[][], k = 60): ScoredIndex[] {
  const scores = new Map<number, number>();
  for (const list of rankings) {
    list.forEach((index, place) => scores.set(index, (scores.get(index) ?? 0) + 1 / (k + place + 1)));
  }
  return [...scores].map(([index, score]) => ({ index, score })).sort((a, b) => b.score - a.score || a.index - b.index);
}
