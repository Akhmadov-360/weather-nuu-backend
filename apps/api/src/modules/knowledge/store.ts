import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { KnowledgeLang } from "./chunk.js";
import type { KnowledgeChunk } from "./index-search.js";
import { vectorFromBuffer, vectorToBuffer } from "./vector.js";

/** Where the fragments live. Search does not know: today a file, after the database migration a table. */
export interface KnowledgeStore {
  load(): Promise<KnowledgeChunk[]>;
  save(chunks: KnowledgeChunk[]): Promise<void>;
}

type StoredChunk = {
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
  /** The raw bytes of the Float32Array, base64: no text parsing of thousands of numbers. */
  embedding: string;
};

type StoredFile = { format: 1; chunks: StoredChunk[] };

export class FileKnowledgeStore implements KnowledgeStore {
  constructor(private readonly path: string) {}

  /** An absent file is an empty base: nothing has been ingested yet. */
  async load(): Promise<KnowledgeChunk[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const file = JSON.parse(raw) as StoredFile;
    if (file.format !== 1) throw new Error(`Unknown format of the knowledge index: ${String(file.format)}`);
    return file.chunks.map(({ embedding, ...rest }) => ({ ...rest, embedding: vectorFromBuffer(Buffer.from(embedding, "base64"), rest.dim) }));
  }

  /** Written to a temporary file first and renamed, so that a crash cannot leave half an index. */
  async save(chunks: KnowledgeChunk[]): Promise<void> {
    const file: StoredFile = {
      format: 1,
      chunks: chunks.map(({ embedding, ...rest }) => ({ ...rest, embedding: vectorToBuffer(embedding).toString("base64") })),
    };
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    await writeFile(temp, JSON.stringify(file));
    await rename(temp, this.path);
  }
}
