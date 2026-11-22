import { ProviderError } from "../assistant/providers/types.js";
import { normalizeVector } from "./vector.js";

/** Documents and questions are embedded with different task types: the model puts a question next to the text that answers it. */
export type EmbedTask = "document" | "query";

export interface EmbeddingProvider {
  /** Written into every stored fragment: vectors of different models are never mixed. */
  readonly model: string;
  readonly dim: number;
  /** One normalized vector per text, in the same order. */
  embed(texts: string[], task: EmbedTask, signal?: AbortSignal): Promise<Float32Array[]>;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
/** The API accepts up to 100 texts in one batch. */
const BATCH = 50;

export type GeminiEmbeddingOptions = {
  apiKey: string;
  /** For example `gemini-embedding-001`. It comes from the settings: model names change. */
  model: string;
  /** 768 by default: smaller than the native size, so the vectors are normalized here. */
  dim?: number;
  baseUrl?: string;
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
};

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dim: number;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: GeminiEmbeddingOptions) {
    this.model = options.model;
    this.dim = options.dim ?? 768;
    this.fetcher = options.fetch ?? fetch;
  }

  async embed(texts: string[], task: EmbedTask, signal?: AbortSignal): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH) out.push(...(await this.batch(texts.slice(i, i + BATCH), task, signal)));
    return out;
  }

  private async batch(texts: string[], task: EmbedTask, signal?: AbortSignal): Promise<Float32Array[]> {
    const url = `${this.options.baseUrl ?? DEFAULT_BASE_URL}/v1beta/models/${this.model}:batchEmbedContents`;
    const body = {
      requests: texts.map((text) => ({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
        taskType: task === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY",
        outputDimensionality: this.dim,
      })),
    };
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30_000);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.options.apiKey },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      throw new ProviderError("upstream", `The embedding request failed: ${error instanceof Error ? error.name : "error"}`);
    }
    if (response.status === 429) throw new ProviderError("quota", "The embedding quota is used up", 429);
    if (!response.ok) throw new ProviderError("upstream", `The embedding service answered ${response.status}`, response.status);
    const json = (await response.json()) as { embeddings?: { values?: number[] }[] };
    const embeddings = json.embeddings ?? [];
    if (embeddings.length !== texts.length) {
      throw new ProviderError("upstream", `Asked for ${texts.length} vectors, got ${embeddings.length}`);
    }
    return embeddings.map((e) => {
      if (!e.values || e.values.length !== this.dim) {
        throw new ProviderError("upstream", `A vector has ${e.values?.length ?? 0} numbers, expected ${this.dim}`);
      }
      return normalizeVector(e.values);
    });
  }
}

/**
 * A model without a network for tests and the offline run: the same text gives the same vector, texts that share
 * words give close vectors (each word adds a fixed pseudo-random direction). It has no sense of meaning.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly model = "hash-test";
  constructor(readonly dim = 64) {}

  async embed(texts: string[], _task?: EmbedTask): Promise<Float32Array[]> {
    return texts.map((text) => {
      const v = new Float32Array(this.dim);
      for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
        let h = 2166136261;
        for (const ch of word) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
        for (let i = 0; i < this.dim; i++) {
          h = Math.imul(h ^ (h >>> 15), 2246822519) + i;
          v[i]! += ((h >>> 0) / 4294967296 - 0.5) * 2;
        }
      }
      if (v.every((x) => x === 0)) v[0] = 1;
      return normalizeVector(v);
    });
  }
}
