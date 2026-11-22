import "dotenv/config";
import { join } from "node:path";
import { GeminiEmbeddingProvider } from "../modules/knowledge/embedding.js";
import { KnowledgeIndex } from "../modules/knowledge/index-search.js";
import { RETRIEVAL_CASES } from "../modules/knowledge/retrieval-cases.js";
import { evaluateRetrieval } from "../modules/knowledge/retrieval-eval.js";
import { FileKnowledgeStore } from "../modules/knowledge/store.js";

/**
 * Quality of the search over knowledge/index.json: recall@1/3/5 and MRR for vectors only, BM25 only and the
 * hybrid (RRF), on the questions of retrieval-cases.ts (the question vectors cost one embedding request each):
 *   pnpm --filter @weather/api kb:eval
 */
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Set GEMINI_API_KEY in apps/api/.env");
  process.exit(1);
}
const index = new KnowledgeIndex(await new FileKnowledgeStore(join(process.cwd(), "knowledge", "index.json")).load());
if (!index.size || !index.model || !index.dim) {
  console.error("The index is empty: run pnpm kb:ingest first");
  process.exit(1);
}
const embedder = new GeminiEmbeddingProvider({ apiKey, model: index.model, dim: index.dim });
const queries = new Map<string, Float32Array>();
const texts = RETRIEVAL_CASES.map((c) => c.question);
(await embedder.embed(texts, "query")).forEach((v, i) => queries.set(texts[i]!, v));

const pct = (x: number) => `${(x * 100).toFixed(0)} %`.padStart(6);
console.log(`${index.size} fragments, ${RETRIEVAL_CASES.length} questions, model ${index.model}/${index.dim}`);
console.log("mode      recall@1  recall@3  recall@5   MRR");
for (const s of await evaluateRetrieval(index, RETRIEVAL_CASES, async (t) => queries.get(t)!)) {
  console.log(`${s.mode.padEnd(8)}  ${pct(s.recallAt1)}  ${pct(s.recallAt3)}  ${pct(s.recallAt5)}   ${s.mrr.toFixed(2)}`);
}
