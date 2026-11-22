import { Bm25Index } from "./bm25.js";
import type { KnowledgeLang } from "./chunk.js";
import { rrfFuse } from "./rrf.js";
import { tokenize } from "./tokenize.js";
import { dot, normalizeVector } from "./vector.js";

/** A fragment of the knowledge base with its vector. `model` and `dim` say which embeddings the vector came from. */
export type KnowledgeChunk = {
  id: string;
  source: string;
  url?: string;
  kind: string;
  lang: KnowledgeLang;
  title: string;
  text: string;
  contentHash: string;
  model: string;
  dim: number;
  embedding: Float32Array;
};

export type SearchMode = "hybrid" | "vector" | "bm25";

export type SearchQuery = {
  text: string;
  /** The embedding of the question (task type "query"). Without it only the keyword search can run. */
  embedding?: Float32Array;
  lang?: KnowledgeLang;
  kind?: string;
  k?: number;
  mode?: SearchMode;
};

export type SearchHit = { chunk: KnowledgeChunk; score: number };

/** How many places of each list are fused: more than any `k` we return, so that the fusion has something to merge. */
const POOL = 50;

/**
 * All fragments in memory. Search is exact: the cosine (4) against every fragment that passed the filters, BM25 (6)
 * over the same fragments, and the two lists fused with RRF (5). The filters (language, kind) work before the
 * ranking. Vectors of different models or sizes are never mixed: the index refuses to be built from them.
 */
export class KnowledgeIndex {
  readonly model: string | null;
  readonly dim: number | null;
  private readonly bm25: Bm25Index;

  constructor(readonly chunks: KnowledgeChunk[]) {
    const models = new Set(chunks.map((c) => `${c.model}/${c.dim}`));
    if (models.size > 1) {
      throw new Error(`The knowledge base mixes embeddings of different models or sizes (${[...models].join(", ")}); re-index everything`);
    }
    for (const c of chunks) {
      if (c.embedding.length !== c.dim) throw new Error(`Fragment ${c.id}: its vector has ${c.embedding.length} numbers, the record says ${c.dim}`);
    }
    this.model = chunks[0]?.model ?? null;
    this.dim = chunks[0]?.dim ?? null;
    this.bm25 = new Bm25Index(chunks.map((c) => tokenize(`${c.title}\n${c.text}`)));
  }

  get size(): number {
    return this.chunks.length;
  }

  search(query: SearchQuery): SearchHit[] {
    const k = query.k ?? 5;
    const mode = query.mode ?? "hybrid";
    const allowed = new Set<number>();
    this.chunks.forEach((c, i) => {
      if ((!query.lang || c.lang === query.lang) && (!query.kind || c.kind === query.kind)) allowed.add(i);
    });
    if (!allowed.size) return [];

    const keyword = mode === "vector" ? [] : this.bm25.search(tokenize(query.text), allowed).slice(0, POOL).map((r) => r.index);

    let vector: number[] = [];
    if (mode !== "bm25" && query.embedding) {
      if (this.dim !== null && query.embedding.length !== this.dim) {
        throw new Error(`The question vector has ${query.embedding.length} numbers, the index ${this.dim}`);
      }
      const q = normalizeVector(query.embedding);
      vector = [...allowed]
        .map((i) => ({ i, s: dot(q, this.chunks[i]!.embedding) }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .slice(0, POOL)
        .map((r) => r.i);
    }

    const ranked = mode === "hybrid" ? rrfFuse([vector, keyword]) : (mode === "vector" ? vector : keyword).map((index, place) => ({ index, score: 1 / (place + 1) }));
    return ranked.slice(0, k).map((r) => ({ chunk: this.chunks[r.index]!, score: r.score }));
  }
}
