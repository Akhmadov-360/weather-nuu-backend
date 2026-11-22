import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashChunk } from "../modules/knowledge/chunk.js";
import { KnowledgeIndex, type KnowledgeChunk } from "../modules/knowledge/index-search.js";
import { FileKnowledgeStore } from "../modules/knowledge/store.js";
import { mulberry32 } from "../modules/events/synthetic.js";
import { normalizeVector } from "../modules/knowledge/vector.js";

/**
 * Time to load the index from its file and to search it, for 1000 and 5000 fragments of about 500 tokens with
 * vectors of 768 numbers (random: the time does not depend on the meaning):
 *   pnpm --filter @weather/api kb:bench
 */
const DIM = 768;
const WORDS = Array.from({ length: 2000 }, (_, i) => `w${i.toString(36)}${i % 7 === 0 ? "pm" : ""}`);

function makeChunks(n: number): KnowledgeChunk[] {
  const rand = mulberry32(7);
  return Array.from({ length: n }, (_, i) => {
    const text = Array.from({ length: 350 }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(" ");
    return {
      id: `c${i}`,
      source: "bench",
      kind: "bench",
      lang: (["ru", "uz", "en"] as const)[i % 3]!,
      title: `Fragment ${i}`,
      text,
      contentHash: hashChunk(`Fragment ${i}`, text),
      model: "bench",
      dim: DIM,
      embedding: normalizeVector(Array.from({ length: DIM }, () => rand() - 0.5)),
    };
  });
}

const ms = (since: number) => (performance.now() - since).toFixed(1);
const dir = await mkdtemp(join(tmpdir(), "kb-bench-"));
console.log("fragments  file MB  read+parse ms  build index ms  search ms (hybrid, median of 50)  heap MB");
try {
  for (const n of [1000, 5000]) {
    const path = join(dir, `index-${n}.json`);
    const store = new FileKnowledgeStore(path);
    await store.save(makeChunks(n));
    const size = (await stat(path)).size / 1e6;

    let t = performance.now();
    const loaded = await store.load();
    const load = ms(t);
    t = performance.now();
    const index = new KnowledgeIndex(loaded);
    const build = ms(t);

    const rand = mulberry32(99);
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const embedding = Float32Array.from({ length: DIM }, () => rand() - 0.5);
      const text = `${WORDS[Math.floor(rand() * WORDS.length)]} ${WORDS[Math.floor(rand() * WORDS.length)]} pm`;
      const s = performance.now();
      index.search({ text, embedding, k: 5 });
      times.push(performance.now() - s);
    }
    times.sort((a, b) => a - b);
    console.log(`${String(n).padStart(9)}  ${size.toFixed(1).padStart(7)}  ${load.padStart(13)}  ${build.padStart(14)}  ${times[25]!.toFixed(1).padStart(32)}  ${(process.memoryUsage().heapUsed / 1e6).toFixed(0).padStart(7)}`);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
