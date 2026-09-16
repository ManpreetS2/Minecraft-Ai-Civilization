import type { Clock, IdFactory } from "./types.js";

export function systemClock(): Clock {
  return {
    now: () => new Date(),
    iso: () => new Date().toISOString(),
    millis: () => Date.now(),
  };
}

export function fixedClock(at: Date | string): Clock {
  const date = typeof at === "string" ? new Date(at) : at;
  return {
    now: () => new Date(date),
    iso: () => date.toISOString(),
    millis: () => date.getTime(),
  };
}

export function mutableClock(start: Date | string = "2026-09-16T12:00:00.000Z"): Clock & { set: (at: Date | string) => void; advanceMs: (ms: number) => void } {
  let current = typeof start === "string" ? new Date(start) : new Date(start);
  return {
    now: () => new Date(current),
    iso: () => current.toISOString(),
    millis: () => current.getTime(),
    set: (at) => {
      current = typeof at === "string" ? new Date(at) : new Date(at);
    },
    advanceMs: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

export function createIdFactory(prefix = "id"): IdFactory {
  let n = 0;
  return () => `${prefix}_${++n}`;
}

export function randomId(): string {
  return crypto.randomUUID();
}

export function periodKey(iso: string): string {
  return iso.slice(0, 10);
}
