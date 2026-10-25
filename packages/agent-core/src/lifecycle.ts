export type DrainResult = {
  /** Operations present when drain began. */
  attempted: number;
  /** Operations still unsettled when the write gate closed. */
  remaining: number;
  /** True when the wait hit timeoutMs before all ops settled. */
  timedOut: boolean;
  /** True only when every tracked op settled before close — never claimed on timeout. */
  fullyDrained: boolean;
};

/**
 * Tracks in-flight async work so shutdown can abort and drain before
 * closing SQLite. New work is refused once shutdown begins; in-flight
 * callbacks may still persist until the tracker is closed.
 */
export class OperationTracker {
  private readonly pending = new Set<Promise<unknown>>();
  private shuttingDown = false;
  private closed = false;
  private drainPromise?: Promise<DrainResult>;

  get size(): number {
    return this.pending.size;
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Accept new cognition / action / startup work. */
  canAcceptWork(): boolean {
    return !this.shuttingDown && !this.closed;
  }

  /** Persist results from in-flight work until the tracker is fully closed. */
  canWrite(): boolean {
    return !this.closed;
  }

  track<T>(operation: Promise<T>): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("OperationTracker is closed"));
    }
    const tracked = operation.finally(() => {
      this.pending.delete(tracked);
    });
    this.pending.add(tracked);
    return tracked;
  }

  /**
   * Marks shutdown, waits for outstanding ops (or timeout), then closes the write gate.
   * Concurrent callers share one drain. Timed-out drains never report fullyDrained=true.
   */
  drainAndClose(timeoutMs = 8_000): Promise<DrainResult> {
    if (this.closed && !this.drainPromise) {
      return Promise.resolve({
        attempted: 0,
        remaining: this.pending.size,
        timedOut: false,
        fullyDrained: this.pending.size === 0,
      });
    }
    if (this.drainPromise) return this.drainPromise;
    this.shuttingDown = true;
    this.drainPromise = this.runDrain(timeoutMs);
    return this.drainPromise;
  }

  private async runDrain(timeoutMs: number): Promise<DrainResult> {
    const snapshot = [...this.pending];
    const attempted = snapshot.length;

    if (attempted === 0) {
      this.closed = true;
      return { attempted: 0, remaining: 0, timedOut: false, fullyDrained: true };
    }

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(snapshot),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve();
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    const remaining = this.pending.size;
    this.closed = true;
    const fullyDrained = remaining === 0 && !timedOut;
    return { attempted, remaining, timedOut, fullyDrained };
  }
}
