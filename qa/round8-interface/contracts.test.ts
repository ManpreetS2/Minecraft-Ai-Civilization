import { expect, it, vi } from "vitest";
import { offlineRegistry } from "../../packages/cognition/src/routing/offline-fixture.js";
import { createInMemoryCitizenSessionStore } from "../../packages/cognition/src/routing/citizen-registry.js";
import { PaidRequestGate, PAID_RUN_APPROVAL_ENV } from "../../packages/cognition/src/routing/paid-request-gate.js";
import { RUN, prompt, world } from "./fixture.js";
for (const count of [2, 4] as const) it(`${count} citizens: manager, cognition and physical dispatch share runtime identities and private observations`, async () => {
  const w = world(count);
  for (const id of w.bodies.keys()) w.privateMemory(id, `R8-PRIVATE-${id}`);
  await w.tick(); await w.tick(); await w.tick();
  const events = w.store.listAllEventsForObserver();
  const starts = events.filter(e => e.type === "ActionStarted");
  expect(starts.length).toBeGreaterThan(0);
  for (const e of starts) { expect(e.payload.runId).toBe(RUN); expect(e.payload.actionId).toMatch(/^[a-f0-9-]{36}$/); expect(w.bodies.has(e.citizenId!)).toBe(true); }
  for (const terminal of events.filter(e => e.type === "ActionCompleted" || e.type === "ActionFailed")) {
    expect(starts.some(start => start.payload.actionId === terminal.payload.actionId && start.citizenId === terminal.citizenId && start.payload.runId === terminal.payload.runId)).toBe(true);
  }
  const decisions = w.fixture.registry.evidenceLog();
  for (const a of w.assignments) {
    expect(decisions.some(e => e.citizenId === a.citizenId && e.runId === RUN && e.family === a.family && e.model === a.model && e.outcome === "decided")).toBe(true);
    for (const owner of w.assignments) expect(w.sent(a.citizenId).includes(`R8-PRIVATE-${owner.citizenId}`)).toBe(owner.citizenId === a.citizenId);
    expect(w.bodies.get(a.citizenId)!.bot.food).toBe(9);
  }
  expect(new Set(decisions.map(e => e.sessionId)).size).toBe(count);
  expect(new Set(decisions.map(e => e.decidedBy)).size).toBe(2);
  console.log(JSON.stringify({ mode: "offline_simulated", acceptance: "NOT_PROVEN", transport: "simulated_mock", actualPaidRequestsSent: 0, actualPaidSpendUsd: 0, simulatedDecisions: decisions.length, simulatedActionDispatches: starts.length, runId: RUN }));
});
it("same-run restart retains session identity and simulated usage; foreign citizen prompts fail before dispatch", async () => {
  const store = createInMemoryCitizenSessionStore(); const first = offlineRegistry({ store });
  await first.registry.providerFor("gpt-a").decide(prompt("gpt-a"));
  const id = first.registry.providerFor("gpt-a").sessionId, before = first.registry.accounting();
  const second = offlineRegistry({ store });
  expect(second.registry.providerFor("gpt-a").sessionId).toBe(id);
  expect(second.registry.accounting().experiment.spendUsd).toBe(before.experiment.spendUsd);
  expect(second.registry.accounting().experiment.requestsUsed).toBe(before.experiment.requestsUsed);
  await expect(second.registry.providerFor("gpt-a").decide(prompt("claude-a"))).rejects.toMatchObject({ code: "MISROUTED" });
  expect(second.openai.calls).toHaveLength(0);
});
for (const id of ["gpt-a", "claude-a"]) it(`${id}: unknown usage retains a hold and closes admissions across restart`, async () => {
  const store = createInMemoryCitizenSessionStore(); const first = offlineRegistry({ store, script: () => ({ usage: null }) });
  await expect(first.registry.providerFor(id).decide(prompt(id))).rejects.toThrow();
  const before = first.registry.accounting();
  expect(before.citizens[id]!.unverifiedHoldUsd).toBeGreaterThan(0);
  expect(before.experiment.closed).toBe(true);
  const second = offlineRegistry({ store });
  expect(second.registry.accounting().experiment.heldUsd).toBeCloseTo(before.experiment.heldUsd);
  await expect(second.registry.providerFor(id).decide(prompt(id))).rejects.toThrow();
});
it("cancelled in-flight inference preserves usage uncertainty and closeAll prevents subsequent mock sends", async () => {
  const f = offlineRegistry({ script: () => ({ hang: true }) });
  const session = f.registry.providerFor("gpt-a"), pending = session.decide(prompt("gpt-a"));
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(f.registry.accounting().experiment.inFlight).toBe(1));
  f.registry.closeAll(); await rejected;
  expect(f.registry.accounting().citizens["gpt-a"]!.unverifiedHoldUsd).toBeGreaterThan(0);
  const sent = f.openai.calls.length;
  await expect(session.decide(prompt("gpt-a"))).rejects.toMatchObject({ code: "CLOSED" });
  expect(f.openai.calls).toHaveLength(sent);
});
it("owner gate itself denies after revoke; it is not claimed to be wired to the inherited registry", () => {
  const gate = PaidRequestGate.fromApproval({ ownerApprovalReference: "synthetic-fixture-approval", runId: RUN, maxRequests: 3, expiresAt: "2099-01-01T00:00:00Z" }, { env: { [PAID_RUN_APPROVAL_ENV]: RUN } });
  expect(gate.take()).toBeUndefined(); gate.revoke("test-stop"); expect(gate.take()).toMatch(/test-stop/);
  expect(gate.snapshot.requestsTaken).toBe(1);
});
