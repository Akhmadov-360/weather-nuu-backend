import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GeminiEmbeddingProvider, HashEmbeddingProvider } from "./embedding.js";
import { ingest } from "./ingest.js";
import { KnowledgeIndex } from "./index-search.js";

const file = (name: string, body: string, lang = "en") => ({
  name,
  raw: `---\nsource: Source of ${name}\nurl: https://example.org/${name}\nlang: ${lang}\nkind: standard\n---\n${body}`,
});

describe("ingest", () => {
  const embedder = new HashEmbeddingProvider(16);

  it("makes fragments with ids, header fields and vectors, in the order of the file names", async () => {
    const { chunks, report } = await ingest([file("b.md", "# B\nbeta text"), file("a.md", "# A\nalpha text")], [], embedder);
    expect(chunks.map((c) => c.id)).toEqual(["a#1", "b#1"]);
    expect(chunks[0]).toMatchObject({ source: "Source of a.md", url: "https://example.org/a.md", kind: "standard", lang: "en", model: "hash-test", dim: 16 });
    expect(chunks[0]!.embedding).toHaveLength(16);
    expect(report).toEqual({ total: 2, embedded: 2, reused: 0, removed: 0 });
  });

  it("does not embed what did not change, embeds what did, and drops what is gone", async () => {
    const first = await ingest([file("a.md", "# A\nalpha text"), file("b.md", "# B\nbeta text")], [], embedder);
    const spy = vi.spyOn(embedder, "embed");
    const second = await ingest([file("a.md", "# A\nalpha text"), file("b.md", "# B\nbeta CHANGED")], first.chunks, embedder);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toHaveLength(1);
    expect(second.report).toEqual({ total: 2, embedded: 1, reused: 1, removed: 1 });
    expect(second.chunks[0]!.embedding).toBe(first.chunks[0]!.embedding);
    spy.mockRestore();
  });

  it("embeds everything again when the model changes, so the result has one model", async () => {
    const first = await ingest([file("a.md", "# A\nalpha")], [], new HashEmbeddingProvider(16));
    const second = await ingest([file("a.md", "# A\nalpha")], first.chunks, new HashEmbeddingProvider(32));
    expect(second.report.embedded).toBe(1);
    expect(second.chunks[0]!.dim).toBe(32);
    expect(() => new KnowledgeIndex(second.chunks)).not.toThrow();
  });

  it("names the file when its header is wrong", async () => {
    await expect(ingest([{ name: "bad.md", raw: "no header" }], [], embedder)).rejects.toThrow(/bad\.md/);
  });

  it("does not call the service when nothing is to be embedded", async () => {
    const spy = vi.spyOn(embedder, "embed");
    await ingest([], [], embedder);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("HashEmbeddingProvider", () => {
  it("is repeatable and puts texts with common words closer than unrelated ones", async () => {
    const e = new HashEmbeddingProvider(64);
    const [a, a2, near, far] = await e.embed(["dust particles in the room", "dust particles in the room", "particles of dust indoors", "temperature of the street air"], "document");
    const dot = (x: Float32Array, y: Float32Array) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    expect([...a!]).toEqual([...a2!]);
    expect(dot(a!, near!)).toBeGreaterThan(dot(a!, far!));
  });
});

describe("GeminiEmbeddingProvider", () => {
  const vectorOf = (n: number, v: number) => ({ values: Array.from({ length: n }, () => v) });

  it("asks for document or query vectors of the right size and returns them normalized", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { requests: unknown[] };
      return new Response(JSON.stringify({ embeddings: body.requests.map(() => vectorOf(8, 2)) }), { status: 200 });
    });
    const p = new GeminiEmbeddingProvider({ apiKey: "k", model: "gemini-embedding-001", dim: 8, fetch: fetcher as unknown as typeof fetch });
    const out = await p.embed(["a", "b"], "query");
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain("/v1beta/models/gemini-embedding-001:batchEmbedContents");
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
    const sent = JSON.parse(String(init!.body)) as { requests: { taskType: string; outputDimensionality: number; model: string }[] };
    expect(sent.requests.map((r) => r.taskType)).toEqual(["RETRIEVAL_QUERY", "RETRIEVAL_QUERY"]);
    expect(sent.requests[0]).toMatchObject({ outputDimensionality: 8, model: "models/gemini-embedding-001" });
    expect(out).toHaveLength(2);
    expect(out[0]!.reduce((s, v) => s + v * v, 0)).toBeCloseTo(1);
  });

  it("uses the document task type for documents and splits big lists into batches", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { requests: unknown[] };
      return new Response(JSON.stringify({ embeddings: body.requests.map(() => vectorOf(4, 1)) }), { status: 200 });
    });
    const p = new GeminiEmbeddingProvider({ apiKey: "k", model: "m", dim: 4, fetch: fetcher as unknown as typeof fetch });
    const out = await p.embed(Array.from({ length: 120 }, (_, i) => `t${i}`), "document");
    expect(out).toHaveLength(120);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).requests[0].taskType).toBe("RETRIEVAL_DOCUMENT");
  });

  it("maps 429 to a quota error and other failures to an upstream error, without the key in the message", async () => {
    const make = (status: number) => new GeminiEmbeddingProvider({ apiKey: "secret-key", model: "m", dim: 4, fetch: (async () => new Response("{}", { status })) as unknown as typeof fetch });
    await expect(make(429).embed(["a"], "query")).rejects.toMatchObject({ kind: "quota", status: 429 });
    const error = await make(500).embed(["a"], "query").catch((e: Error) => e);
    expect(error).toMatchObject({ kind: "upstream", status: 500 });
    expect((error as Error).message).not.toContain("secret-key");
  });

  it("rejects an answer with the wrong count or size of vectors", async () => {
    const wrongCount = new GeminiEmbeddingProvider({ apiKey: "k", model: "m", dim: 4, fetch: (async () => new Response(JSON.stringify({ embeddings: [] }), { status: 200 })) as unknown as typeof fetch });
    await expect(wrongCount.embed(["a"], "query")).rejects.toThrow(/Asked for 1/);
    const wrongSize = new GeminiEmbeddingProvider({ apiKey: "k", model: "m", dim: 4, fetch: (async () => new Response(JSON.stringify({ embeddings: [vectorOf(3, 1)] }), { status: 200 })) as unknown as typeof fetch });
    await expect(wrongSize.embed(["a"], "query")).rejects.toThrow(/expected 4/);
  });

  it("reports a network failure as an upstream error", async () => {
    const p = new GeminiEmbeddingProvider({ apiKey: "k", model: "m", dim: 4, fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    await expect(p.embed(["a"], "query")).rejects.toMatchObject({ kind: "upstream" });
  });
});

describe("the knowledge files of the repository", () => {
  const dir = join(__dirname, "..", "..", "..", "knowledge");
  const files = readdirSync(dir).filter((n) => n.endsWith(".md")).map((name) => ({ name, raw: readFileSync(join(dir, name), "utf8") }));

  it("all have a valid header and make fragments of a sensible size", async () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    const { chunks } = await ingest(files, [], new HashEmbeddingProvider(8));
    expect(chunks.length).toBeGreaterThan(files.length);
    for (const c of chunks) {
      expect(c.text.length, c.id).toBeGreaterThan(20);
      expect(c.text.length, c.id).toBeLessThan(3000);
    }
    for (const lang of ["ru", "uz", "en"]) expect(chunks.some((c) => c.lang === lang), lang).toBe(true);
  });
});

describe("evaluateRetrieval", () => {
  it("scores a search that finds the right topic first as one and one that never finds it as zero", async () => {
    const { evaluateRetrieval } = await import("./retrieval-eval.js");
    const { KnowledgeIndex } = await import("./index-search.js");
    const embedder = new HashEmbeddingProvider(32);
    const { chunks } = await ingest(
      [file("who-2021.en.md", "# WHO\nguideline levels for particulate matter PM2.5 and PM10"), file("sensors.en.md", "# Sensors\nthe MQ-3 sensor reacts to alcohol vapour")],
      [],
      embedder,
    );
    const index = new KnowledgeIndex(chunks);
    const embedQuery = async (t: string) => (await embedder.embed([t], "query"))[0]!;
    const good = await evaluateRetrieval(index, [{ lang: "en", topic: "sensors", question: "alcohol vapour MQ-3" }], embedQuery, ["bm25", "hybrid"]);
    expect(good.map((s) => s.mrr)).toEqual([1, 1]);
    const none = await evaluateRetrieval(index, [{ lang: "en", topic: "station", question: "alcohol vapour MQ-3" }], embedQuery, ["hybrid"]);
    expect(none[0]).toMatchObject({ recallAt5: 0, mrr: 0 });
  });
});
