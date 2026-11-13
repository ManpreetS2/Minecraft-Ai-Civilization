/** Desired integration obligations. Ordinary red assertions expose missing interfaces; no it.fails or skips. */
import { expect, it } from "vitest";
import { offlineRegistry } from "../../packages/cognition/src/routing/offline-fixture.js";
import { PaidRequestGate, PAID_RUN_APPROVAL_ENV } from "../../packages/cognition/src/routing/paid-request-gate.js";
import { homeRig } from "../v103/support/home.js";
import { installInstantNavigation } from "../v103/support/offline-body.js";
import { RUN, prompt, world } from "./fixture.js";
for (const id of ["gpt-a", "claude-a"]) it(`${id}: proposed shared owner gate revocation stops subsequent dispatch`, async () => {
  const gate = PaidRequestGate.fromApproval({ ownerApprovalReference: "synthetic-fixture-only", runId: RUN, maxRequests: 3, expiresAt: "2099-01-01T00:00:00Z" }, { env: { [PAID_RUN_APPROVAL_ENV]: RUN } });
  // 'gate' is the proposed #171 option, deliberately absent from the inherited
  // registry's public type. All transports and keys remain fake; no paid request.
  const f = offlineRegistry({ gate, allowPaidRequests: true } as unknown as Parameters<typeof offlineRegistry>[0]);
  gate.revoke("fixture-owner-stop");
  await expect(f.registry.providerFor(id).decide(prompt(id))).rejects.toThrow(/revok|stop/);
});
it("model-derived dispatch carries its actual provider decision correlation rather than only citizen/time", async () => {
  const w = world(); await w.tick(); await w.tick(); await w.tick();
  const decisions = w.fixture.registry.evidenceLog().filter(e => e.outcome === "decided");
  const started = w.store.listAllEventsForObserver().filter(e => e.type === "ActionStarted" && e.payload.source === "llm");
  expect(started.length).toBeGreaterThan(0);
  for (const event of started) expect(decisions.some(d => d.correlationId === event.payload.decisionCorrelationId && d.citizenId === event.citizenId && d.runId === event.payload.runId)).toBe(true);
});
it("normal physical success joins its exact dispatch as pending receipts already do", async () => {
  const restore = installInstantNavigation();
  try {
    const h = homeRig({ purpose: "personal", item: "cobblestone", type: 4, chestStock: 0, carry: 4, windowMs: 1 });
    expect((await h.run("deposit_personal", "depositItems", 10000)).success).toBe(true);
    const start = h.seen.find(e => e.type === "ActionStarted")!.payload as Record<string, unknown>;
    const physical = h.seen.find(e => e.type === "ItemDeposited")!.payload as Record<string, unknown>;
    expect(physical.actionId).toBe(start.actionId);
    expect(physical.transferId).toMatch(/^[a-f0-9-]{36}$/);
  } finally { restore(); }
});
