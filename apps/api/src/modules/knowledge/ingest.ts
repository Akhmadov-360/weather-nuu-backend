import { chunkDocument, parseDocument } from "./chunk.js";
import type { EmbeddingProvider } from "./embedding.js";
import type { KnowledgeChunk } from "./index-search.js";

export type IngestReport = { total: number; embedded: number; reused: number; removed: number };

/**
 * Source files to fragments with vectors. A fragment whose text and model have not changed keeps the vector it
 * had (nothing is sent to the embedding service); a changed or new one is embedded; a fragment whose source
 * text is gone is dropped. Switching the model re-embeds everything, so the result never mixes two models.
 */
export async function ingest(
  files: { name: string; raw: string }[],
  existing: KnowledgeChunk[],
  embedder: EmbeddingProvider,
): Promise<{ chunks: KnowledgeChunk[]; report: IngestReport }> {
  const known = new Map(existing.filter((c) => c.model === embedder.model && c.dim === embedder.dim).map((c) => [c.contentHash, c]));

  type Pending = Omit<KnowledgeChunk, "embedding" | "model" | "dim">;
  const wanted: Pending[] = [];
  const ids = new Set<string>();
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    let parsed;
    try {
      parsed = parseDocument(file.raw);
    } catch (error) {
      throw new Error(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const { header, body } = parsed;
    chunkDocument(body, header.title ?? header.source).forEach((c, i) => {
      const id = `${file.name.replace(/\.md$/, "")}#${i + 1}`;
      if (ids.has(id)) throw new Error(`Two fragments have the id ${id}`);
      ids.add(id);
      wanted.push({
        id,
        source: header.source,
        ...(header.url ? { url: header.url } : {}),
        kind: header.kind,
        lang: header.lang,
        title: c.title,
        text: c.text,
        contentHash: c.contentHash,
      });
    });
  }

  const missing = wanted.filter((w) => !known.has(w.contentHash));
  // The same text under two ids is embedded once.
  const unique = [...new Map(missing.map((w) => [w.contentHash, w])).values()];
  const vectors = unique.length ? await embedder.embed(unique.map((w) => `${w.title}\n${w.text}`), "document") : [];
  const fresh = new Map(unique.map((w, i) => [w.contentHash, vectors[i]!]));

  const chunks: KnowledgeChunk[] = wanted.map((w) => ({
    ...w,
    model: embedder.model,
    dim: embedder.dim,
    embedding: known.get(w.contentHash)?.embedding ?? fresh.get(w.contentHash)!,
  }));
  const keptHashes = new Set(wanted.map((w) => w.contentHash));
  return {
    chunks,
    report: {
      total: chunks.length,
      embedded: missing.length,
      reused: chunks.length - missing.length,
      removed: existing.filter((c) => !keptHashes.has(c.contentHash)).length,
    },
  };
}
