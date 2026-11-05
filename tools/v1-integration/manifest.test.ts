import { describe, expect, it } from "vitest";
import { buildManifest, validateBundle } from "./manifest.js";
import { bundleFixture } from "./bundle-fixture.js";
describe("versioned result bundle negative evidence", () => {
  it("preserves unknowns and never equates fixture execution with independent validation", () => {
    const run = buildManifest(bundleFixture());
    expect(run.citizens[0]?.model).toBeNull();
    expect(run.providerUsage.costUsd).toBeNull();
    expect(validateBundle(run).verdict).toBe("NOT PROVEN");
  });
  it.each(["fake-duration", "missing-ticks", "non-monotonic", "missing-inventory", "unauthorized", "wrong-citizen", "truncated", "false-success", "restart"])("rejects or leaves unproven %s", (kind) => {
    const run = bundleFixture(); run.mode = "public-live-demonstration"; run.tickSource = "paper";
    run.startedAt = "2026-11-05T10:00:00Z"; run.endedAt = "2026-11-05T11:00:00Z";
    if (kind === "fake-duration") run.endedAt = "2026-11-05T10:01:00Z";
    if (kind === "missing-ticks") run.ticks = null;
    if (kind === "non-monotonic") run.ticks = [10, 9];
    if (kind === "missing-inventory") run.actions[0]!.inventoryDelta = null;
    if (kind === "unauthorized") run.actions[0]!.authorizedKnowledge = false;
    if (kind === "wrong-citizen") run.actions[0]!.citizenId = "other";
    if (kind === "truncated") run.expectedActionCount = 2;
    if (kind === "false-success") run.actions[0]!.observedSuccess = false;
    if (kind === "restart") run.restarted = true;
    const expected: Record<string, string> = { 'fake-duration': '60-minute', 'missing-ticks': 'Paper ticks missing', 'non-monotonic': 'Non-monotonic', 'missing-inventory': 'inventory delta missing', unauthorized: 'Unauthorized citizen', 'wrong-citizen': 'Mismatched citizen', truncated: 'Truncated action', 'false-success': 'Failed action', restart: 'Restart persistence' };
    const verdict = validateBundle(run);
    expect(verdict.verdict).not.toBe("PASS");
    expect([...verdict.failures, ...verdict.unproven].join('; ')).toContain(expected[kind]);
  });
  it("rejects session reuse and secret configuration", () => {
    const run = bundleFixture(); run.citizens[1]!.sessionId = run.citizens[0]!.sessionId;
    expect(() => buildManifest(run)).toThrow(/Independent/);
    run.citizens[1]!.sessionId = "other"; run.configuration.API_KEY = "do-not-store";
    expect(() => buildManifest(run)).toThrow(/Secret/);
  });
  it('never trusts fabricated or missing validator receipts', () => {
    const run = bundleFixture(); run.mode = 'public-live-demonstration'; run.tickSource = 'paper';
    run.startedAt = '2026-11-05T10:00:00Z'; run.endedAt = '2026-11-05T11:00:00Z';
    run.actions = []; run.expectedActionCount = 0;
    run.validator = { name: 'fabricated', verdict: 'PASS', artifact: 'missing.json' };
    expect(validateBundle(run).verdict).toBe('NOT PROVEN');
    expect(validateBundle(run).unproven.join(' ')).toContain('not independently verified');
  });
  it('rejects nested secret properties and strips unrelated nested fields', () => {
    const run = bundleFixture(); Object.assign(run.providerUsage, { apiKey: 'never-store' });
    expect(() => buildManifest(run)).toThrow(/Secret/);
    const clean = bundleFixture(); Object.assign(clean.providerUsage, { arbitrary: 'untrusted' });
    expect(JSON.stringify(buildManifest(clean))).not.toContain('untrusted');
    Object.assign(clean.actions[0]!, { token: 'never-store' });
    expect(() => buildManifest(clean)).toThrow(/Secret/);
  });
});

