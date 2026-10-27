import { describe, expect, it } from "vitest";
import {
  applyDeposit,
  clampFishQuotaBounds,
  createCitizenFishLedger,
  creditCatch,
  depositableFromInventory,
  evaluateFishQuotaStop,
  evaluateTwoBotConcurrency,
  fishQuotaVerdict,
  quotaFishCount,
  rodUsable,
  runFishQuotaLoop,
  sessionsOverlap,
  snapshotQuotaCounts,
  standsSeparated,
  TWO_FISH_MAX_STAND_SEPARATION,
  TWO_FISH_MIN_STAND_SEPARATION,
} from "./fish-quota.js";

describe("quota counts and provenance", () => {
  it("counts only real fish species, not junk or cobblestone", () => {
    expect(
      quotaFishCount(
        snapshotQuotaCounts([
          { name: "cod", count: 2 },
          { name: "salmon", count: 1 },
          { name: "lily_pad", count: 4 },
          { name: "cobblestone", count: 8 },
          { name: "fishing_rod", count: 1 },
        ]),
      ),
    ).toBe(3);
  });

  it("keeps Kai and Atlas inventories on separate ledgers", () => {
    const kai = creditCatch(createCitizenFishLedger("Kai", "Kai", []), { salmon: 2 });
    const atlas = creditCatch(createCitizenFishLedger("Atlas", "Atlas", [{ name: "cod", count: 3 }]), { cod: 1 });
    expect(kai.caught.salmon).toBe(2);
    expect(kai.caught.cod).toBe(0);
    expect(atlas.initialQuota.cod).toBe(3);
    expect(atlas.caught.cod).toBe(1);
    expect(atlas.caught.salmon).toBe(0);
    expect(quotaFishCount(kai.caught)).toBe(2);
    expect(quotaFishCount(atlas.caught)).toBe(1);
  });

  it("does not double-credit the same event id", () => {
    const once = creditCatch(createCitizenFishLedger("Kai", "Kai", []), { salmon: 1 }, 5, "bite-1");
    const twice = creditCatch(once, { salmon: 1 }, 5, "bite-1");
    expect(quotaFishCount(twice.caught)).toBe(1);
  });

  it("records mixed species toward the same 5-fish quota", () => {
    let ledger = createCitizenFishLedger("Kai", "Kai", []);
    ledger = creditCatch(ledger, { salmon: 2, cod: 2, tropical_fish: 1, pufferfish: 1 });
    expect(quotaFishCount(ledger.caught)).toBe(5);
    expect(ledger.caught.tropical_fish).toBe(1);
    expect(ledger.caught.pufferfish).toBe(0);
  });
});

describe("exact deposit of new catches only", () => {
  it("does not deposit baseline fish or the rod", () => {
    const ledger = creditCatch(
      createCitizenFishLedger("Atlas", "Atlas", [
        { name: "cod", count: 2 },
        { name: "fishing_rod", count: 1 },
      ]),
      { salmon: 3, cod: 2 },
    );
    const pending = depositableFromInventory(ledger, [
      { name: "cod", count: 4 },
      { name: "salmon", count: 3 },
      { name: "fishing_rod", count: 1 },
    ]);
    expect(pending.cod).toBe(2);
    expect(pending.salmon).toBe(3);
    expect(pending.tropical_fish).toBe(0);
    expect(quotaFishCount(pending)).toBe(5);
  });

  it("storage PASS only when exactly 5 credited fish were deposited", () => {
    let ledger = createCitizenFishLedger("Kai", "Kai", []);
    ledger = creditCatch(ledger, { salmon: 5 });
    expect(fishQuotaVerdict(ledger).fishing).toBe("PASS");
    expect(fishQuotaVerdict(ledger).storage).toBe("FAIL");
    ledger = applyDeposit(ledger, { salmon: 5 });
    expect(fishQuotaVerdict(ledger).storage).toBe("PASS");
    expect(fishQuotaVerdict(ledger).progress).toBe("5/5");
  });
});

describe("stop conditions never fake 5/5", () => {
  it("reports PARTIAL 3/5 on timeout, not PASS", () => {
    const ledger = creditCatch(createCitizenFishLedger("Kai", "Kai", []), { cod: 3 });
    const stop = evaluateFishQuotaStop({
      ledger,
      attempts: 4,
      maxAttempts: 12,
      elapsedMs: 90_000,
      timeoutMs: 80_000,
      rodPresent: true,
    });
    expect(stop.continue).toBe(false);
    if (!stop.continue && !stop.complete) expect(stop.code).toBe("TIMEOUT");
    expect(fishQuotaVerdict(ledger)).toMatchObject({ fishing: "PARTIAL", progress: "3/5", storage: "FAIL" });
  });

  it("reports CURFEW_STOP at 1/2 instead of completing the quota", () => {
    const ledger = creditCatch(createCitizenFishLedger("Kai", "Kai", []), { salmon: 1 });
    const stop = evaluateFishQuotaStop({
      ledger,
      target: 2,
      attempts: 1,
      maxAttempts: 12,
      elapsedMs: 8_000,
      timeoutMs: 60_000,
      rodPresent: true,
      returnHomeStop: true,
    });
    expect(stop.continue).toBe(false);
    if (!stop.continue && !stop.complete) expect(stop.code).toBe("CURFEW_STOP");
    expect(fishQuotaVerdict(ledger, 2)).toMatchObject({ fishing: "PARTIAL", progress: "1/2", storage: "FAIL" });
  });

  it("cancels, denies storage, and stops on a broken rod", () => {
    const empty = createCitizenFishLedger("Atlas", "Atlas", []);
    const cancelled = evaluateFishQuotaStop({
      ledger: empty,
      attempts: 0,
      maxAttempts: 12,
      elapsedMs: 0,
      timeoutMs: 60_000,
      rodPresent: true,
      signalAborted: true,
    });
    expect(!cancelled.continue && !cancelled.complete && cancelled.code).toBe("CANCELLED");

    const denied = evaluateFishQuotaStop({
      ledger: empty,
      attempts: 0,
      maxAttempts: 12,
      elapsedMs: 0,
      timeoutMs: 60_000,
      rodPresent: true,
      chestDenied: true,
    });
    expect(!denied.continue && !denied.complete && denied.code).toBe("ACCESS_DENIED");

    expect(rodUsable([{ name: "fishing_rod", count: 1, durabilityUsed: 64, maxDurability: 64 }])).toEqual({
      present: true,
      broken: true,
    });
  });
});

describe("same-pond stands", () => {
  it("allows adjacent shoreline cells and refuses the same block or a distant second pond", () => {
    expect(TWO_FISH_MIN_STAND_SEPARATION).toBe(1);
    expect(TWO_FISH_MAX_STAND_SEPARATION).toBe(8);
    expect(standsSeparated({ x: -1043, y: 63, z: 980 }, { x: -1044, y: 63, z: 981 })).toBe(true);
    expect(standsSeparated({ x: -1043, y: 63, z: 980 }, { x: -1043, y: 63, z: 980 })).toBe(false);
    expect(standsSeparated({ x: -1043, y: 63, z: 980 }, { x: 20, y: 68, z: 240 })).toBe(false);
  });
});

describe("runFishQuotaLoop", () => {
  it("completes 5/5 with after-each deposits", async () => {
    const { result } = await runFishQuotaLoop({
      ledger: createCitizenFishLedger("Kai", "Kai", []),
      attempt: async () => ({ ok: true, caught: { salmon: 1 } }),
      deposit: async (items) => ({ ok: true, deposited: items }),
      timeoutMs: 20_000,
      maxAttempts: 5,
    });
    expect(result.fishing).toBe("PASS");
    expect(result.storage).toBe("PASS");
    expect(result.progress).toBe("5/5");
    expect(result.caught.salmon).toBe(5);
  });

  it("keeps 3/5 as PARTIAL when the time budget ends", async () => {
    let clock = 0;
    let bites = 0;
    const { result } = await runFishQuotaLoop({
      ledger: createCitizenFishLedger("Atlas", "Atlas", []),
      now: () => clock,
      startedAt: 0,
      timeoutMs: 5_000,
      maxAttempts: 12,
      attempt: async () => {
        if (bites < 3) {
          bites += 1;
          clock += 10;
          return { ok: true, caught: { cod: 1 } };
        }
        clock = 8_000;
        return { ok: false, code: "SEARCH_EXHAUSTED", error: "no bite" };
      },
      deposit: async (items) => ({ ok: true, deposited: items }),
    });
    expect(result.fishing).toBe("PARTIAL");
    expect(result.progress).toBe("3/5");
    expect(result.storage).toBe("FAIL");
    expect(result.caughtCount).toBe(3);
  });

  it("records ACCESS_DENIED without inventing a 5/5", async () => {
    const { result, code } = await runFishQuotaLoop({
      ledger: createCitizenFishLedger("Kai", "Kai", []),
      chestDenied: true,
      attempt: async () => ({ ok: true, caught: { salmon: 1 } }),
      deposit: async () => ({ ok: false, code: "ACCESS_DENIED", error: "wrong chest" }),
    });
    expect(code).toBe("ACCESS_DENIED");
    expect(result.fishing).not.toBe("PASS");
    expect(result.progress).toBe("0/5");
  });

  it("honours cancellation mid-quota", async () => {
    const abort = new AbortController();
    let bites = 0;
    const { result, code } = await runFishQuotaLoop({
      ledger: createCitizenFishLedger("Atlas", "Atlas", []),
      signal: abort.signal,
      attempt: async () => {
        bites += 1;
        if (bites >= 2) abort.abort();
        return { ok: true, caught: { salmon: 1 } };
      },
      deposit: async (items) => ({ ok: true, deposited: items }),
    });
    expect(code).toBe("CANCELLED");
    expect(result.caughtCount).toBeLessThan(5);
    expect(result.fishing).not.toBe("PASS");
  });

  it("keeps 1/2 as PARTIAL CURFEW_STOP when bedtime fires", async () => {
    let bites = 0;
    const { result, code } = await runFishQuotaLoop({
      ledger: createCitizenFishLedger("Kai", "Kai", []),
      target: 2,
      returnHomeStop: () => bites >= 1,
      attempt: async () => {
        bites += 1;
        return { ok: true, caught: { cod: 1 } };
      },
      deposit: async (items) => ({ ok: true, deposited: items }),
    });
    expect(code).toBe("CURFEW_STOP");
    expect(result.fishing).toBe("PARTIAL");
    expect(result.progress).toBe("1/2");
    expect(result.caughtCount).toBe(1);
    expect(result.depositedCount).toBe(1);
  });

  it("storage FAIL when deposit moves fewer than the credited five", async () => {
    const { result } = await runFishQuotaLoop({
      ledger: createCitizenFishLedger("Kai", "Kai", []),
      attempt: async () => ({ ok: true, caught: { salmon: 1 } }),
      deposit: async (items) => {
        const deposited = { ...items, salmon: Math.max(0, (items.salmon ?? 0) - 1) };
        return { ok: true, deposited };
      },
      maxAttempts: 5,
      timeoutMs: 20_000,
    });
    expect(result.fishing).toBe("PASS");
    expect(result.depositedCount).toBeLessThan(5);
    expect(result.storage).toBe("FAIL");
  });

  it("runs two isolated sessions at the same time", async () => {
    const kai = runFishQuotaLoop({
      ledger: createCitizenFishLedger("Kai", "Kai", []),
      attempt: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ok: true, caught: { salmon: 1 } };
      },
      deposit: async (items) => ({ ok: true, deposited: items }),
      maxAttempts: 5,
      timeoutMs: 20_000,
    });
    const atlas = runFishQuotaLoop({
      ledger: createCitizenFishLedger("Atlas", "Atlas", []),
      attempt: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ok: true, caught: { cod: 1 } };
      },
      deposit: async (items) => ({ ok: true, deposited: items }),
      maxAttempts: 5,
      timeoutMs: 20_000,
    });
    const started = Date.now();
    const [kaiDone, atlasDone] = await Promise.all([kai, atlas]);
    const ended = Date.now();
    expect(kaiDone.result.caught.salmon).toBe(5);
    expect(kaiDone.result.caught.cod).toBe(0);
    expect(atlasDone.result.caught.cod).toBe(5);
    expect(atlasDone.result.caught.salmon).toBe(0);
    expect(evaluateTwoBotConcurrency({ startedAt: started, endedAt: ended }, { startedAt: started, endedAt: ended })).toBe(
      "PASS",
    );
    expect(sessionsOverlap({ startedAt: 0, endedAt: 10 }, { startedAt: 10, endedAt: 20 })).toBe(false);
  });

  it("does not burn the 12-cast budget on INTERACTION_FAILED recasts", async () => {
    let fails = 0;
    const { result } = await runFishQuotaLoop({
      ledger: createCitizenFishLedger("Kai", "Kai", []),
      timeoutMs: 20_000,
      maxAttempts: 5,
      attempt: async () => {
        if (fails < 8) {
          fails += 1;
          return { ok: false, code: "INTERACTION_FAILED", error: "Fishing rod did not cast a bobber" };
        }
        return { ok: true, caught: { cod: 1 } };
      },
      deposit: async (items) => ({ ok: true, deposited: items }),
    });
    expect(fails).toBe(8);
    expect(result.fishing).toBe("PASS");
    expect(result.progress).toBe("5/5");
    expect(result.attempts).toBe(5);
  });
});

describe("quota bounds", () => {
  it("caps target at 5", () => {
    expect(clampFishQuotaBounds({ target: 99, maxAttempts: 99, timeoutMs: 9_999_999 })).toEqual({
      target: 5,
      maxAttempts: 24,
      timeoutMs: 600_000,
    });
  });
});
