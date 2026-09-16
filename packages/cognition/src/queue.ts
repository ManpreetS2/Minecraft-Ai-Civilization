export type InferenceType = "routine" | "reflection";

export type InferenceJob<T> = {
  id: string;
  citizenId: string;
  type: InferenceType;
  run: () => Promise<T>;
};

export type QueueSnapshot = {
  queued: number;
  inFlight: number;
  maxConcurrency: number;
};

export type InferenceMeta = {
  queueWaitMs: number;
  latencyMs: number;
  type: InferenceType;
  citizenId: string;
};

type Waiter<T> = {
  job: InferenceJob<T>;
  enqueuedAt: number;
  resolve: (value: { value: T; meta: InferenceMeta }) => void;
  reject: (error: unknown) => void;
};

/**
 * Conservative scheduler so five citizens do not hammer Ollama at once.
 * Default concurrency is 1; 2 is the intended max on a 4080 Super until benchmarked.
 */
export class InferenceQueue {
  private readonly waiting: Array<Waiter<unknown>> = [];
  private inFlight = 0;

  constructor(private readonly maxConcurrency: number) {}

  snapshot(): QueueSnapshot {
    return { queued: this.waiting.length, inFlight: this.inFlight, maxConcurrency: this.maxConcurrency };
  }

  enqueue<T>(job: InferenceJob<T>): Promise<{ value: T; meta: InferenceMeta }> {
    return new Promise((resolve, reject) => {
      this.waiting.push({
        job: job as InferenceJob<unknown>,
        enqueuedAt: Date.now(),
        resolve: resolve as Waiter<unknown>["resolve"],
        reject,
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.inFlight < this.maxConcurrency && this.waiting.length > 0) {
      const next = this.waiting.shift();
      if (!next) return;
      this.inFlight += 1;
      const started = Date.now();
      const queueWaitMs = started - next.enqueuedAt;
      void next.job
        .run()
        .then((value) => {
          next.resolve({
            value,
            meta: {
              queueWaitMs,
              latencyMs: Date.now() - started,
              type: next.job.type,
              citizenId: next.job.citizenId,
            },
          });
        })
        .catch((error: unknown) => next.reject(error))
        .finally(() => {
          this.inFlight -= 1;
          this.pump();
        });
    }
  }
}
