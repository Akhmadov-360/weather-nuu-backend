import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Bm25Index } from "./bm25.js";
import { chunkDocument, hashChunk, parseDocument } from "./chunk.js";
import { KnowledgeIndex, type KnowledgeChunk } from "./index-search.js";
import { rrfFuse } from "./rrf.js";
import { FileKnowledgeStore } from "./store.js";
import { tokenize } from "./tokenize.js";
import { dot, normalizeVector, vectorFromBuffer, vectorToBuffer } from "./vector.js";

describe("tokenize", () => {
  it("lowercases and keeps names with a dot or a hyphen whole and in parts", () => {
    const t = tokenize("Датчик PMS и MQ-3, PM2.5");
    expect(t).toContain("pm2.5");
    expect(t).toContain("mq-3");
    expect(t).toContain("mq");
    expect(t).toContain("3");
    expect(t).toContain("датчик");
  });

  it("makes the forms of a word one term", () => {
    expect(tokenize("пыль")).toEqual(tokenize("ПЫЛЬ"));
    expect(tokenize("загрязнение")[0]).toBe(tokenize("загрязнения")[0]);
  });

  it("treats every apostrophe of the Uzbek Latin alphabet as the same sign and drops it inside a word", () => {
    expect(tokenize("o'zbek")).toEqual(tokenize("oʻzbek"));
    expect(tokenize("o'zbek")).toEqual(tokenize("o’zbek"));
    expect(tokenize("ko'cha")).toEqual(["kocha"]);
  });

  it("gives nothing for text without words", () => {
    expect(tokenize(" ... -- ")).toEqual([]);
  });
});

describe("vectors", () => {
  it("normalizes to length one and refuses a zero vector", () => {
    const v = normalizeVector([3, 4]);
    expect(dot(v, v)).toBeCloseTo(1);
    expect(() => normalizeVector([0, 0])).toThrow();
  });

  it("gives the cosine for normalized vectors", () => {
    const a = normalizeVector([1, 0]);
    const b = normalizeVector([1, 1]);
    expect(dot(a, b)).toBeCloseTo(Math.SQRT1_2);
    expect(dot(a, normalizeVector([0, 5]))).toBeCloseTo(0);
  });

  it("goes to bytes and back without change, also from a slice of a bigger buffer", () => {
    const v = normalizeVector([0.1, -0.2, 0.3, 0.4]);
    const back = vectorFromBuffer(vectorToBuffer(v), 4);
    expect([...back]).toEqual([...v]);
    const big = Buffer.concat([Buffer.from([1, 2, 3]), vectorToBuffer(v)]);
    expect([...vectorFromBuffer(big.subarray(3), 4)]).toEqual([...v]);
  });

  it("refuses bytes of the wrong length", () => {
    expect(() => vectorFromBuffer(Buffer.alloc(7), 2)).toThrow();
  });

  it("refuses vectors of different sizes", () => {
    expect(() => dot(new Float32Array(2), new Float32Array(3))).toThrow();
  });
});

describe("Bm25Index", () => {
  const docs = [tokenize("пыль PM2.5 в воздухе вредна"), tokenize("датчик MQ-3 измеряет пары алкоголя"), tokenize("температура и влажность воздуха")];
  const index = new Bm25Index(docs);

  it("puts the document with the exact term first", () => {
    expect(index.search(tokenize("MQ-3"))[0]!.index).toBe(1);
    expect(index.search(tokenize("PM2.5"))[0]!.index).toBe(0);
  });

  it("ignores terms it does not know and returns nothing for them", () => {
    expect(index.search(tokenize("космос"))).toEqual([]);
  });

  it("gives a rarer term more weight than a common one", () => {
    const idx = new Bm25Index([["a", "b"], ["a", "c"], ["a", "d"], ["a", "rare"]]);
    const common = idx.search(["a"])[0]!.score;
    const rare = idx.search(["rare"])[0]!.score;
    expect(rare).toBeGreaterThan(common);
  });

  it("scores a shorter document higher for the same count of the term", () => {
    const idx = new Bm25Index([["x", "y", "y", "y", "y", "y", "y"], ["x", "y"]]);
    const r = idx.search(["x"]);
    expect(r[0]!.index).toBe(1);
  });

  it("matches the formula on a hand-made example", () => {
    // N = 2, n(t) = 1, IDF = ln((2 - 1 + 0.5)/(1 + 0.5) + 1) = ln 2; |d| = avgdl, so the norm is k1 = 1.2; f = 1
    const idx = new Bm25Index([["t", "u"], ["v", "w"]]);
    expect(idx.search(["t"])[0]!.score).toBeCloseTo((Math.log(2) * 1 * 2.2) / (1 + 1.2));
  });

  it("searches only the allowed documents", () => {
    expect(index.search(tokenize("воздух"), new Set([2])).map((r) => r.index)).toEqual([2]);
  });

  it("works on an empty set", () => {
    expect(new Bm25Index([]).search(["a"])).toEqual([]);
  });
});

describe("rrfFuse", () => {
  it("adds 1/(k+rank) over the lists", () => {
    const r = rrfFuse([[10, 20], [20, 10]], 60);
    expect(r.find((x) => x.index === 10)!.score).toBeCloseTo(1 / 61 + 1 / 62);
    expect(r.find((x) => x.index === 20)!.score).toBeCloseTo(1 / 62 + 1 / 61);
  });

  it("puts a document found by both lists above one found by a single list", () => {
    expect(rrfFuse([[1, 2], [3, 2]])[0]!.index).toBe(2);
  });

  it("copes with empty lists", () => {
    expect(rrfFuse([[], []])).toEqual([]);
  });
});

describe("parseDocument and chunkDocument", () => {
  const file = "---\nsource: WHO 2021\nurl: https://example.org/who\nlang: en\nkind: standard\ntitle: WHO\n---\n# Guidelines\nIntro text.\n\n## PM2.5\nAnnual 5.\n\n## PM10\nAnnual 15.\n";

  it("reads the header and the body", () => {
    const { header, body } = parseDocument(file);
    expect(header).toEqual({ source: "WHO 2021", url: "https://example.org/who", lang: "en", kind: "standard", title: "WHO" });
    expect(body.startsWith("# Guidelines")).toBe(true);
  });

  it("refuses a file with no header, a missing key or an unknown language", () => {
    expect(() => parseDocument("no header")).toThrow(/header/);
    expect(() => parseDocument("---\nlang: en\nkind: x\n---\ntext")).toThrow(/source/);
    expect(() => parseDocument("---\nsource: s\nlang: de\nkind: x\n---\ntext")).toThrow(/language/);
  });

  it("makes a fragment of every section with the path of headings as the title", () => {
    const chunks = chunkDocument(parseDocument(file).body, "WHO");
    expect(chunks.map((c) => c.title)).toEqual(["WHO / Guidelines", "WHO / Guidelines / PM2.5", "WHO / Guidelines / PM10"]);
    expect(chunks[1]!.text).toBe("Annual 5.");
  });

  it("cuts a long section at paragraph borders, with an overlap", () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${"word ".repeat(40)}`.trim());
    const chunks = chunkDocument(paragraphs.join("\n\n"), "Doc", { targetChars: 500, overlapChars: 300 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(500 + 300);
    // the end of one fragment starts the next
    const first = chunks[0]!.text.split("\n\n");
    expect(chunks[1]!.text.startsWith(first[first.length - 1]!)).toBe(true);
    // nothing is lost
    for (const p of paragraphs) expect(chunks.some((c) => c.text.includes(p))).toBe(true);
  });

  it("gives the same hash for the same text and another for a changed one", () => {
    expect(hashChunk("T", "a")).toBe(hashChunk("T", "a"));
    expect(hashChunk("T", "a")).not.toBe(hashChunk("T", "b"));
    expect(hashChunk("T", "a")).not.toBe(hashChunk("U", "a"));
  });

  it("makes no fragments of a text without words", () => {
    expect(chunkDocument("\n\n", "Doc")).toEqual([]);
  });
});

function chunk(id: string, text: string, vector: number[], extra: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    id,
    source: `src-${id}`,
    kind: "standard",
    lang: "en",
    title: id,
    text,
    contentHash: hashChunk(id, text),
    model: "m1",
    dim: vector.length,
    embedding: normalizeVector(vector),
    ...extra,
  };
}

describe("KnowledgeIndex", () => {
  const chunks = [
    chunk("dust", "PM2.5 fine particles of dust", [1, 0, 0]),
    chunk("gas", "MQ-3 alcohol vapour sensor", [0, 1, 0]),
    chunk("temp", "temperature and humidity", [0, 0, 1]),
    chunk("pyl", "пыль и частицы PM2.5", [0.9, 0.1, 0], { lang: "ru", kind: "sensor" }),
  ];
  const index = new KnowledgeIndex(chunks);

  it("finds by meaning (the vector) when the words do not match", () => {
    const hits = index.search({ text: "nothing in common", embedding: new Float32Array([0, 1, 0]), mode: "vector", k: 1 });
    expect(hits[0]!.chunk.id).toBe("gas");
  });

  it("finds by an exact term (BM25) when the vector points elsewhere", () => {
    const hits = index.search({ text: "MQ-3", embedding: new Float32Array([1, 0, 0]), mode: "bm25", k: 1 });
    expect(hits[0]!.chunk.id).toBe("gas");
  });

  it("fuses both in the hybrid mode", () => {
    const hits = index.search({ text: "MQ-3", embedding: new Float32Array([0, 1, 0.1]), k: 3 });
    expect(hits[0]!.chunk.id).toBe("gas");
  });

  it("works with the keyword search alone when there is no question vector", () => {
    const hits = index.search({ text: "temperature", k: 2 });
    expect(hits[0]!.chunk.id).toBe("temp");
  });

  it("limits the search by language and by kind before ranking", () => {
    const ru = index.search({ text: "PM2.5", embedding: new Float32Array([1, 0, 0]), lang: "ru", k: 5 });
    expect(ru.map((h) => h.chunk.id)).toEqual(["pyl"]);
    const sensor = index.search({ text: "PM2.5", kind: "sensor", k: 5 });
    expect(sensor.map((h) => h.chunk.id)).toEqual(["pyl"]);
    expect(index.search({ text: "PM2.5", lang: "uz" })).toEqual([]);
  });

  it("returns at most k hits", () => {
    expect(index.search({ text: "PM2.5 sensor", embedding: new Float32Array([1, 1, 1]), k: 2 })).toHaveLength(2);
  });

  it("refuses a question vector of the wrong size", () => {
    expect(() => index.search({ text: "x", embedding: new Float32Array(5) })).toThrow(/numbers/);
  });

  it("refuses to be built from different models or sizes", () => {
    expect(() => new KnowledgeIndex([chunk("a", "a", [1, 0]), chunk("b", "b", [1, 0], { model: "m2" })])).toThrow(/mixes/);
    expect(() => new KnowledgeIndex([chunk("a", "a", [1, 0]), chunk("b", "b", [1, 0, 0])])).toThrow(/mixes/);
  });

  it("refuses a fragment whose vector does not match its record", () => {
    expect(() => new KnowledgeIndex([chunk("a", "a", [1, 0], { dim: 3 })])).toThrow(/record says/);
  });

  it("is empty and finds nothing when there are no fragments", () => {
    const empty = new KnowledgeIndex([]);
    expect(empty.size).toBe(0);
    expect(empty.search({ text: "x", embedding: new Float32Array([1]) })).toEqual([]);
  });
});

describe("FileKnowledgeStore", () => {
  it("returns an empty base for a missing file", async () => {
    expect(await new FileKnowledgeStore(join(tmpdir(), "no-such-dir-kb", "index.json")).load()).toEqual([]);
  });

  it("saves and loads the fragments with their vectors unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kb-"));
    try {
      const store = new FileKnowledgeStore(join(dir, "sub", "index.json"));
      const input = [chunk("a", "text a", [0.3, 0.4, 0.5], { url: "https://example.org" }), chunk("b", "текст b", [1, 2, 3], { lang: "ru" })];
      await store.save(input);
      const out = await store.load();
      expect(out.map((c) => c.id)).toEqual(["a", "b"]);
      expect([...out[0]!.embedding]).toEqual([...input[0]!.embedding]);
      expect(out[0]!.url).toBe("https://example.org");
      expect(out[1]!.text).toBe("текст b");
      expect(new KnowledgeIndex(out).size).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
