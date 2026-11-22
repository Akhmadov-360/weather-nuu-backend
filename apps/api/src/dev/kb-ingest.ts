import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { GeminiEmbeddingProvider } from "../modules/knowledge/embedding.js";
import { ingest } from "../modules/knowledge/ingest.js";
import { FileKnowledgeStore } from "../modules/knowledge/store.js";

/**
 * Reads apps/api/knowledge/*.md, embeds the new and changed fragments and writes knowledge/index.json:
 *   pnpm --filter @weather/api kb:ingest
 * Needs GEMINI_API_KEY; the model is EMBEDDING_MODEL (default gemini-embedding-001) with 768 numbers.
 * Fragments that did not change are not sent to the service again.
 */
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Set GEMINI_API_KEY in apps/api/.env");
  process.exit(1);
}
const dir = join(process.cwd(), "knowledge");
const names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();
const files = await Promise.all(names.map(async (name) => ({ name, raw: await readFile(join(dir, name), "utf8") })));

const store = new FileKnowledgeStore(join(dir, "index.json"));
const embedder = new GeminiEmbeddingProvider({ apiKey, model: process.env.EMBEDDING_MODEL ?? "gemini-embedding-001", dim: 768 });
const { chunks, report } = await ingest(files, await store.load(), embedder);
await store.save(chunks);
console.log(`${files.length} files -> ${report.total} fragments (${report.embedded} embedded, ${report.reused} reused, ${report.removed} removed), model ${embedder.model}/${embedder.dim}`);
