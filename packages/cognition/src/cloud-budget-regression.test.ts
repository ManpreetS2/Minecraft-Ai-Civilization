import { describe, expect, it } from "vitest";
import { CloudBudgetGate } from "./cloud-budget.js";

const FLAT = { attemptBoundUsd: 0.01, maxAttempts: 1 };

function gate(maxConcurrency = 2): CloudBudgetGate {
  return new CloudBudgetGate({
    maxConcurrency,
    maxRequestsPerRun: 5,
    spendAllowanceUsd: 1,
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
    const live = admitted(budget.tryAdmit(FLAT));
    expect(() => budget.reconcile("unknown", undefined, true)).toThrow(/unknown or already reconciled/);
    expect(budget.snapshot.inFlight).toBe(1);
    expect(budget.tryAdmit(FLAT)).toMatchObject({ ok: false, reason: "cloud concurrency limit reached" });
    budget.releaseWithoutCharge(live);
    expect(budget.snapshot.inFlight).toBe(0);
  });

  it("rejects double settlement without changing another reservation's capacity or spend", () => {
    const budget = gate();
    const first = admitted(budget.tryAdmit(FLAT));
    const second = admitted(budget.tryAdmit(FLAT));
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
    const reservation = admitted(budget.tryAdmit(FLAT));
    expect(() =>
      budget.reconcile(reservation, { model: "gpt-4o-mini", inputTokens: NaN, outputTokens: 12 }, false),
    ).toThrow(/usage report was invalid/);
    expect(budget.snapshot.closed).toBe(true);
    expect(Number.isFinite(budget.snapshot.spendUsd)).toBe(true);
    expect(budget.tryAdmit(FLAT)).toMatchObject({ ok: false, code: "closed", reason: expect.stringMatching(/usage report/) });
    expect(budget.snapshot.inFlight).toBe(0);
    expect(budget.snapshot.heldUsd).toBeCloseTo(0.01);
  });

  it("does not interpret missing usage on a successful call as a free request", () => {
    const budget = gate();
    const reservation = admitted(budget.tryAdmit(FLAT));
    expect(() => budget.reconcile(reservation, undefined, false)).toThrow(/usage report was invalid/);
    expect(budget.snapshot.closed).toBe(true);
    expect(budget.snapshot.inFlight).toBe(0);
    expect(budget.snapshot.heldUsd).toBeCloseTo(0.01);
    // The hold cannot be refunded after the call was treated as billable, and it is not reported as spend.
    expect(() => budget.releaseWithoutCharge(reservation)).toThrow(/unknown or already reconciled/);
    expect(budget.snapshot.heldUsd).toBeCloseTo(0.01);
    expect(budget.snapshot.spendUsd).toBe(0);
  });

  it("settling unknown usage keeps other live reservations intact", () => {
    const budget = gate();
    const first = admitted(budget.tryAdmit(FLAT));
    const second = admitted(budget.tryAdmit(FLAT));
    budget.settleUnknownUsage(first, "usage unknown in test");
    expect(budget.snapshot).toMatchObject({ inFlight: 1, closed: true, closedReason: "usage unknown in test" });
    expect(budget.snapshot.heldUsd).toBeCloseTo(0.01);
    expect(budget.snapshot.reservedUsd).toBeCloseTo(0.01);
    budget.releaseWithoutCharge(second);
    expect(budget.snapshot.inFlight).toBe(0);
    expect(budget.snapshot.heldUsd).toBeCloseTo(0.01);
    expect(budget.snapshot.reservedUsd).toBe(0);
  });

  it("charges retries to the request budget and refuses them once exhausted or closed", () => {
    const budget = new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 2, spendAllowanceUsd: 1 });
    admitted(budget.tryAdmit(FLAT));
    expect(budget.tryChargeRetry()).toBe(true);
    expect(budget.snapshot.requestsUsed).toBe(2);
    expect(budget.tryChargeRetry()).toBe(false);
    expect(budget.snapshot.requestsUsed).toBe(2);

    const closed = gate();
    closed.close();
    expect(closed.tryChargeRetry()).toBe(false);
  });

  it("does not admit a zero-cost reservation past a zero allowance", () => {
    const zero = new CloudBudgetGate({ maxConcurrency: 1, maxRequestsPerRun: 1, spendAllowanceUsd: 0 });
    expect(zero.tryAdmit(FLAT)).toMatchObject({ ok: false, code: "spend" });
    expect(zero.tryAdmit({ attemptBoundUsd: 0, maxAttempts: 1 })).toMatchObject({ ok: false, code: "closed" });
  });

  it("rejects invalid run limits rather than admitting unbounded or permanently pending calls", () => {
    const valid = { maxConcurrency: 1, maxRequestsPerRun: 1, spendAllowanceUsd: 1 };
    expect(() => new CloudBudgetGate({ ...valid, maxConcurrency: 0 })).toThrow(RangeError);
    expect(() => new CloudBudgetGate({ ...valid, maxRequestsPerRun: NaN })).toThrow(RangeError);
    expect(() => new CloudBudgetGate({ ...valid, spendAllowanceUsd: NaN })).toThrow(RangeError);
  });

  it("preserves successful billing and accounting for a correctly settled reservation", () => {
    const budget = gate();
    const reservation = admitted(budget.tryAdmit(FLAT));
    const cost = budget.reconcile(reservation, { model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 100 }, false);
    expect(cost).toBeGreaterThan(0);
    expect(budget.snapshot.inFlight).toBe(0);
    expect(budget.snapshot.requestsUsed).toBe(1);
    expect(budget.snapshot.spendUsd).toBeCloseTo(cost);
    expect(budget.snapshot.reservedUsd).toBe(0);
  });
});
