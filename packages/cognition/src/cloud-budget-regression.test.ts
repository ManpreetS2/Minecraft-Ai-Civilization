import { describe, expect, it } from "vitest";
import { CloudBudgetGate } from "./cloud-budget.js";

function gate(maxConcurrency = 2): CloudBudgetGate {
  return new CloudBudgetGate({
    maxConcurrency,
    maxRequestsPerRun: 5,
    spendAllowanceUsd: 1,
    reserveUsdPerRequest: 0.01,
  });
}

function admitted(result: ReturnType<CloudBudgetGate["tryAdmit"]>): string {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.reservationId;
}

describe("CloudBudgetGate reservation integrity", () => {
  it("does not release another live request when a nonexistent reservation is reconciled", () => {
    const budget = gate(1);
    const live = admitted(budget.tryAdmit());
    expect(() => budget.reconcile("unknown", undefined, true)).toThrow(/unknown or already reconciled/);
    expect(budget.snapshot.inFlight).toBe(1);
    expect(budget.tryAdmit()).toMatchObject({ ok: false, reason: "cloud concurrency limit reached" });
    budget.releaseWithoutCharge(live);
    expect(budget.snapshot.inFlight).toBe(0);
  });

  it("rejects double settlement without changing another reservation's capacity or spend", () => {
    const budget = gate();
    const first = admitted(budget.tryAdmit());
    const second = admitted(budget.tryAdmit());
    budget.releaseWithoutCharge(first);
    const before = budget.snapshot;
    expect(() => budget.releaseWithoutCharge(first)).toThrow(/unknown or already reconciled/);
    expect(() => budget.reconcile("bogus", undefined, true)).toThrow(/unknown or already reconciled/);
    expect(budget.snapshot).toEqual(before);
    expect(budget.snapshot.inFlight).toBe(1);
    budget.releaseWithoutCharge(second);
    expect(budget.snapshot.inFlight).toBe(0);
  });

  it("closes cloud admissions when provider usage is non-finite instead of corrupting spend", () => {
    const budget = gate();
    const reservation = admitted(budget.tryAdmit());
    expect(() =>
      budget.reconcile(reservation, { model: "gpt-4o-mini", inputTokens: NaN, outputTokens: 12 }, false),
    ).toThrow(/invalid cloud usage/);
    expect(budget.snapshot.closed).toBe(true);
    expect(Number.isFinite(budget.snapshot.spendUsd)).toBe(true);
    expect(budget.tryAdmit()).toMatchObject({ ok: false, reason: "cloud cognition shut down" });
    budget.releaseWithoutCharge(reservation);
    expect(budget.snapshot.inFlight).toBe(0);
  });

  it("does not interpret missing usage on a successful call as a free request", () => {
    const budget = gate();
    const reservation = admitted(budget.tryAdmit());
    expect(() => budget.reconcile(reservation, undefined, false)).toThrow(/invalid cloud usage/);
    expect(budget.snapshot.closed).toBe(true);
    expect(Number.isFinite(budget.snapshot.spendUsd)).toBe(true);
    budget.releaseWithoutCharge(reservation);
    expect(budget.snapshot.inFlight).toBe(0);
  });

  it("closes cloud admissions for negative or fractional token counts", () => {
    for (const usage of [
      { inputTokens: -1, outputTokens: 1 },
      { inputTokens: 1, outputTokens: 1.5 },
      { inputTokens: Infinity, outputTokens: 1 },
    ]) {
      const budget = gate();
      const reservation = admitted(budget.tryAdmit());
      expect(() => budget.reconcile(reservation, { model: "gpt-4o-mini", ...usage }, false)).toThrow(
        /invalid cloud usage/,
      );
      expect(budget.snapshot.closed).toBe(true);
    }
  });

  it("rejects invalid run limits rather than admitting unbounded or permanently pending calls", () => {
    const valid = { maxConcurrency: 1, maxRequestsPerRun: 1, spendAllowanceUsd: 1 };
    expect(() => new CloudBudgetGate({ ...valid, maxConcurrency: 0 })).toThrow(RangeError);
    expect(() => new CloudBudgetGate({ ...valid, maxRequestsPerRun: NaN })).toThrow(RangeError);
    expect(() => new CloudBudgetGate({ ...valid, spendAllowanceUsd: NaN })).toThrow(RangeError);
    expect(() => new CloudBudgetGate({ ...valid, reserveUsdPerRequest: -0.01 })).toThrow(RangeError);
  });

  it("preserves successful billing and accounting for a correctly settled reservation", () => {
    const budget = gate();
    const reservation = admitted(budget.tryAdmit());
    const cost = budget.reconcile(reservation, { model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 100 }, false);
    expect(cost).toBeGreaterThan(0);
    expect(budget.snapshot.inFlight).toBe(0);
    expect(budget.snapshot.requestsUsed).toBe(1);
    expect(budget.snapshot.spendUsd).toBeCloseTo(cost);
  });
});
