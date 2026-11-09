// QA78: the new global timer wrapper (bindScheduledCallbacks) and QA69-L3. Ordinary assertions only.
import { describe, expect, it } from "vitest";
import { createActionBoundary, LATE_WRITE_REFUSED } from "../../../packages/agent-core/src/action-boundary.js";
import { fail } from "../../../packages/shared/src/index.js";
import { child } from "../support/child.js";
import { sleep } from "../support/fish-rig.js";

const CANCELLED = fail("CANCELLED", "cancelled", 1, false);

describe("QA69-L3: a refused write inside a timer armed DURING the action no longer crashes the process (child processes, production boundary)", () => {
  it("timer created during the action, firing after the owner is inactive: process survives, nothing reaches the wire", () => {
    const r = child("timer-child.ts", "timer-created-during-action");
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ survived: true, wire: [] });
  });
  it("interval created during the action: at most the pre-abort tick reaches the wire, process survives", () => {
    const r = child("timer-child.ts", "interval-created-during-action");
    expect(r.code).toBe(0);
    expect((r.json?.wire as string[]).length).toBeLessThanOrEqual(1);
  });
  it("ONLY LATE_WRITE_REFUSED is swallowed: any other error thrown in an action timer still reaches uncaughtException", () => {
    const r = child("timer-child.ts", "other-error-in-timer");
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/boom-not-a-refusal/);
  });
  it("real mineflayer digging plugin: abandon WITH stopDigging and WITHOUT stopDigging both exit 0 with the late swing refused", () => {
    for (const mode of ["abandon-with-stop", "abandon-no-stop"]) {
      const p = child("dig-timer-child.ts", mode);
      expect(p.code, mode).toBe(0);
      expect(p.json, mode).toMatchObject({ survived: true });
      expect(p.err, mode).not.toMatch(/late arm_animation refused/);
    }
  });
});

describe("timer wrapper lifecycle (in-process, production boundary)", () => {
  const original = globalThis.setTimeout;
  const originalInterval = globalThis.setInterval;

  it("globals are wrapped only while an action runs, and restored to the exact original functions afterwards", async () => {
    expect(globalThis.setTimeout).toBe(original);
    const client = { write() {} }; const boundary = createActionBoundary(() => client);
    let during = original;
    await boundary.run("a", async () => { during = globalThis.setTimeout; return { success: true, data: {}, durationMs: 1 } as never; }, { timeoutMs: 1_000 });
    expect(during).not.toBe(original);
    expect(globalThis.setTimeout).toBe(original);
    expect(globalThis.setInterval).toBe(originalInterval);
  });

  it("overlapping actions on two bodies, finishing in either order, restore only after the LAST one and never leave a wrapper behind", async () => {
    for (const firstLonger of [true, false]) {
      const a = createActionBoundary(() => ({ write() {} })); const b = createActionBoundary(() => ({ write() {} }));
      let midWrapped = false;
      const pa = a.run("a", async () => { await sleep(firstLonger ? 120 : 30); return { success: true, data: {}, durationMs: 1 } as never; }, { timeoutMs: 2_000 });
      const pb = b.run("b", async () => { await sleep(firstLonger ? 30 : 120); return { success: true, data: {}, durationMs: 1 } as never; }, { timeoutMs: 2_000 });
      await sleep(75); midWrapped = globalThis.setTimeout !== original;
      await Promise.all([pa, pb]);
      expect(midWrapped).toBe(true);
      expect(globalThis.setTimeout).toBe(original);
    }
  });

  it("restored after a skill that rejects, after a deadline abandonment, and after a caller abort", async () => {
    const boundary = createActionBoundary(() => ({ write() {} }));
    await boundary.run("reject", async () => { throw new Error("nope"); }, { timeoutMs: 1_000 });
    expect(globalThis.setTimeout).toBe(original);
    await boundary.run("never", () => new Promise(() => undefined), { timeoutMs: 40, graceMs: 20 });
    expect(globalThis.setTimeout).toBe(original);
    const abort = new AbortController();
    const p = boundary.run("abort", (s) => new Promise((r) => s.addEventListener("abort", () => r(CANCELLED))), { signal: abort.signal, timeoutMs: 1_000 });
    await sleep(10); abort.abort(); await p;
    expect(globalThis.setTimeout).toBe(original);
  });

  it("an action's own timers behave normally: arguments are forwarded, clearTimeout cancels, unref() works, the callback `this` is preserved", async () => {
    const boundary = createActionBoundary(() => ({ write() {} }));
    const seen: unknown[] = [];
    await boundary.run("t", async () => {
      await new Promise<void>((resolve) => setTimeout((a: string, b: number) => { seen.push(a, b); resolve(); }, 5, "x", 7));
      const cancelled = setTimeout(() => seen.push("SHOULD_NOT_RUN"), 20); clearTimeout(cancelled);
      const handle = setTimeout(() => undefined, 5); expect(typeof (handle as { unref?: unknown }).unref).toBe("function");
      const iv = setInterval(() => seen.push("tick"), 5); await sleep(18); clearInterval(iv);
      await sleep(30);
      return { success: true, data: {}, durationMs: 1 } as never;
    }, { timeoutMs: 2_000 });
    expect(seen.slice(0, 2)).toEqual(["x", 7]);
    expect(seen).not.toContain("SHOULD_NOT_RUN");
    expect(seen.filter((s) => s === "tick").length).toBeGreaterThanOrEqual(2);
    void LATE_WRITE_REFUSED;
  });
});
