import type { KnowledgeLang } from "./chunk.js";
import type { EmbeddingProvider } from "./embedding.js";
import { KnowledgeIndex, type SearchHit } from "./index-search.js";
import type { KnowledgeStore } from "./store.js";

export type KnowledgeSearch = (query: string, options?: { lang?: KnowledgeLang; k?: number }) => Promise<SearchHit[]>;

/**
 * The index in memory plus the embedding of a question. If the question cannot be embedded (no key, the
 * service is down, the quota is used up) the search falls back to the keyword search alone: worse, but it answers.
 */
export class KnowledgeService {
  constructor(
    private index: KnowledgeIndex,
    private readonly embedder: EmbeddingProvider | null,
    private readonly onFallback: (error: unknown) => void = () => {},
  ) {}

  get size(): number {
    return this.index.size;
  }

  /** Loads the index again after a re-ingest; the old one stays if the new file does not load. */
  async reload(store: KnowledgeStore): Promise<void> {
    this.index = new KnowledgeIndex(await store.load());
  }

  search: KnowledgeSearch = async (query, options = {}) => {
    let embedding: Float32Array | undefined;
    // A vector of another model or size would be refused by the index: the search would then fail for every question.
    const canEmbed = this.embedder && this.index.model === this.embedder.model && this.index.dim === this.embedder.dim;
    if (canEmbed) {
      try {
        embedding = (await this.embedder!.embed([query], "query"))[0];
      } catch (error) {
        this.onFallback(error);
      }
    }
    return this.index.search({ text: query, ...(embedding ? { embedding } : {}), ...(options.lang ? { lang: options.lang } : {}), k: options.k ?? 4 });
  };
}
