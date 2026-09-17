export type InferenceType = "routine" | "reflection";

export type InferenceJob<T> = {
  id: string;
  citizenId: string;
  type: InferenceType;
  requestType?: "routine" | "reflection" | "classify";
  priority?: number;
  createdAt?: number;
  deadline?: number;
  stalenessKey?: string;
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
  private readonly inFlightByCitizen = new Map<string, number>();

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

  private pickNext(now: number): Waiter<unknown> | undefined {
    for (let i = this.waiting.length - 1; i >= 0; i -= 1) {
      const waiter = this.waiting[i];
      if (waiter?.job.deadline && waiter.job.deadline < now) {
        this.waiting.splice(i, 1);
        waiter.reject(new Error("DEADLINE_EXCEEDED"));
      }
    }
    if (this.waiting.length === 0) return undefined;
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    this.waiting.forEach((waiter, index) => {
      const inflight = this.inFlightByCitizen.get(waiter.job.citizenId) ?? 0;
      const queuedSame = this.waiting.filter((row) => row.job.citizenId === waiter.job.citizenId).length;
      const score = inflight * 100 + queuedSame + index * 0.001;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return this.waiting.splice(bestIndex, 1)[0];
  }

  private pump(): void {
    while (this.inFlight < this.maxConcurrency && this.waiting.length > 0) {
      const next = this.pickNext(Date.now());
      if (!next) return;
      this.inFlight += 1;
      this.inFlightByCitizen.set(next.job.citizenId, (this.inFlightByCitizen.get(next.job.citizenId) ?? 0) + 1);
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
          const remaining = (this.inFlightByCitizen.get(next.job.citizenId) ?? 1) - 1;
          if (remaining <= 0) this.inFlightByCitizen.delete(next.job.citizenId);
          else this.inFlightByCitizen.set(next.job.citizenId, remaining);
          this.pump();
        });
    }
  }
}
