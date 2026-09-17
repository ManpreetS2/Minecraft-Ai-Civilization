export type EventLoopSample = { lagMs: number; worstLagMs: number; samples: number };

export class EventLoopMonitor {
  lagMs = 0;
  worstLagMs = 0;
  samples = 0;
  private timer?: ReturnType<typeof setInterval>;
  private last = Date.now();

  start(intervalMs = 250): void {
    this.stop();
    this.last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      this.lagMs = Math.max(0, now - this.last - intervalMs);
      this.worstLagMs = Math.max(this.worstLagMs, this.lagMs);
      this.samples += 1;
      this.last = now;
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  snapshot(): EventLoopSample {
    return { lagMs: this.lagMs, worstLagMs: this.worstLagMs, samples: this.samples };
  }
}

export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
