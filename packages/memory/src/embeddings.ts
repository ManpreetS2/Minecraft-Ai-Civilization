import { clamp01 } from "./bounds.js";

export type EmbeddingProvider = {
  readonly name: string;
  readonly available: boolean;
  embed(text: string): Promise<number[] | null>;
};

export class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly name = "noop";
  readonly available = false;

  async embed(_text: string): Promise<number[] | null> {
    return null;
  }
}

/**
 * Optional local embeddings via Ollama `nomic-embed-text`.
 * Memory insertion must never block on this provider.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = "ollama-nomic-embed-text";
  readonly available = true;

  constructor(
    private readonly host: string,
    private readonly model = "nomic-embed-text",
  ) {}

  async embed(text: string): Promise<number[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`${this.host.replace(/\/$/, "")}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { embedding?: number[] };
      if (!Array.isArray(body.embedding) || body.embedding.length === 0) return null;
      return body.embedding.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return clamp01((dot / denom + 1) / 2);
}

export type EmbeddingJob = {
  memoryId: string;
  citizenId: string;
  text: string;
};

/**
 * Fire-and-forget queue. Failures are ignored; retrieval falls back to lexical scoring.
 */
export class EmbeddingQueue {
  private readonly pending: EmbeddingJob[] = [];
  private busy = false;

  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly save: (job: EmbeddingJob, vector: number[]) => void,
  ) {}

  enqueue(job: EmbeddingJob): void {
    if (!this.provider.available) return;
    this.pending.push(job);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift();
        if (!job) break;
        const vector = await this.provider.embed(job.text);
        if (vector && vector.length > 0) this.save(job, vector);
      }
    } finally {
      this.busy = false;
    }
  }
}
