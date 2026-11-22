import { describe, expect, it, vi } from "vitest";
import { KnowledgeService } from "../../knowledge/service.js";
import { KnowledgeIndex, type KnowledgeChunk } from "../../knowledge/index-search.js";
import { normalizeVector } from "../../knowledge/vector.js";
import type { EmbeddingProvider } from "../../knowledge/embedding.js";
import { createKnowledgeTool } from "./knowledge-tool.js";

const chunk = (id: string, text: string, v: number[], model = "m"): KnowledgeChunk => ({
  id, source: `Source ${id}`, kind: "standard", lang: "en", title: id, text, contentHash: id, model, dim: v.length, embedding: normalizeVector(v),
});
const ctx = () => ({ now: new Date(), onCitations: vi.fn() });

describe("search_knowledge", () => {
  const hit = { chunk: chunk("a#1", "x".repeat(5000), [1, 0]), score: 1 };

  it("returns the fragments with their sources and reports them as citations", async () => {
    const tool = createKnowledgeTool(async () => [hit]);
    const c = ctx();
    const result = await tool.run({ query: "guideline" }, c);
    expect(result.ok).toBe(true);
    const body = JSON.parse(result.content);
    expect(body.results[0]).toMatchObject({ id: "a#1", source: "Source a#1", language: "en" });
    expect(c.onCitations).toHaveBeenCalledWith([{ id: "a#1", title: "a#1", source: "Source a#1" }]);
  });

  it("cuts a long fragment", async () => {
    const result = await createKnowledgeTool(async () => [hit]).run({ query: "guideline" }, ctx());
    expect(JSON.parse(result.content).results[0].text.length).toBeLessThan(2300);
  });

  it("says plainly when nothing is found, and reports no citations as sources", async () => {
    const c = ctx();
    const result = await createKnowledgeTool(async () => []).run({ query: "nothing" }, c);
    expect(JSON.parse(result.content).results).toEqual([]);
    expect(JSON.parse(result.content).note).toMatch(/Nothing found/);
  });

  it("passes the language and refuses a bad query", async () => {
    const search = vi.fn(async () => []);
    const tool = createKnowledgeTool(search);
    await tool.run({ query: "guideline", lang: "ru" }, ctx());
    expect(search).toHaveBeenCalledWith("guideline", { lang: "ru", k: 3 });
    expect((await tool.run({ query: "a" }, ctx())).ok).toBe(false);
    expect((await tool.run({ query: "guideline", lang: "de" }, ctx())).ok).toBe(false);
  });
});

describe("KnowledgeService", () => {
  const index = new KnowledgeIndex([chunk("dust", "PM2.5 dust guideline", [1, 0]), chunk("gas", "MQ-3 alcohol sensor", [0, 1])]);
  const embedder = (impl: () => Promise<Float32Array[]>): EmbeddingProvider => ({ model: "m", dim: 2, embed: impl });

  it("searches by vectors and keywords when the question can be embedded", async () => {
    const service = new KnowledgeService(index, embedder(async () => [new Float32Array([0, 1])]));
    expect((await service.search("unrelated words"))[0]!.chunk.id).toBe("gas");
  });

  it("falls back to the keyword search when the embedding fails, and says so", async () => {
    const onFallback = vi.fn();
    const service = new KnowledgeService(index, embedder(async () => { throw new Error("quota"); }), onFallback);
    expect((await service.search("alcohol"))[0]!.chunk.id).toBe("gas");
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("uses the keyword search alone when there is no embedder or its model differs from the index", async () => {
    expect((await new KnowledgeService(index, null).search("alcohol"))[0]!.chunk.id).toBe("gas");
    const other: EmbeddingProvider = { model: "other", dim: 2, embed: async () => [new Float32Array([1, 0])] };
    expect((await new KnowledgeService(index, other).search("alcohol"))[0]!.chunk.id).toBe("gas");
  });
});
