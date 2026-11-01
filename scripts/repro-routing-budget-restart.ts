/** Offline security reproducer. Expected to pass only once the registry retains cost-fault closure across restart. */
import assert from "node:assert/strict";
import { createInMemoryCitizenSessionStore, offlineRegistry, OFFLINE_2V2_ASSIGNMENTS } from "../packages/cognition/src/routing/index.js";
const store = createInMemoryCitizenSessionStore();
const assignments = [OFFLINE_2V2_ASSIGNMENTS[0]!];
const first = offlineRegistry({ assignments, store, script: () => ({ usage: null }) });
const prompt = { citizenName: assignments[0]!.citizenName, inventory: [], settlementNeeds: [], memories: [], nearbyCitizens: [] };
try {
  await assert.rejects(first.registry.providerFor(assignments[0]!.citizenId).decide(prompt));
  assert.equal(first.registry.accounting().experiment.closed, true, "missing usage must close the run");
} finally { first.registry.closeAll(); }
const restarted = offlineRegistry({ assignments, store });
try {
  assert.equal(restarted.registry.accounting().experiment.closed, true, "restart must not reopen a run closed by unknown usage");
} finally { restarted.registry.closeAll(); }
console.log("PASS: cost-safety closure survives registry restart (offline scripted transport only)");
