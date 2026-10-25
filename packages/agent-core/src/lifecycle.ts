/**
 * Tracks in-flight async work so shutdown can abort and drain before
 * closing SQLite. New work is refused once shutdown begins; in-flight
 * callbacks may still persist until the tracker is closed.
 */
export class OperationTracker {
  private readonly pending = new Set<Promise<unknown>>();
  private shuttingDown = false;
  private closed = false;

  get size(): number {
    return this.pending.size;
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Accept new cognition / action work. */
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
   * Marks shutdown, waits for outstanding ops (or timeout), then closes the gate.
   * Safe to call repeatedly — subsequent calls resolve immediately.
   */
  async drainAndClose(timeoutMs = 8_000): Promise<{ drained: number; timedOut: boolean }> {
    if (this.closed) {
      return { drained: 0, timedOut: false };
    }
    this.shuttingDown = true;
    const snapshot = [...this.pending];
    if (snapshot.length === 0) {
      this.closed = true;
      return { drained: 0, timedOut: false };
    }

    let timedOut = false;
    await Promise.race([
      Promise.allSettled(snapshot),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, timeoutMs);
      }),
    ]);

    this.closed = true;
    return { drained: snapshot.length, timedOut };
  }
}
