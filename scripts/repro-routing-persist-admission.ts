/** Offline regression: an undurable admission must not send a request. */
import assert from "node:assert/strict";
import { createInMemoryCitizenSessionStore, offlineRegistry, OFFLINE_2V2_ASSIGNMENTS } from "../packages/cognition/src/routing/index.js";
const backing = createInMemoryCitizenSessionStore(); let failWrites = false;
const fixture = offlineRegistry({ assignments: [OFFLINE_2V2_ASSIGNMENTS[0]!], store: {
  load: (id) => backing.load(id), save: (record) => { if (failWrites) throw new Error("synthetic disk write failure"); backing.save(record); },
} });
failWrites = true;
try {
  await fixture.registry.providerFor("gpt-a").decide({ citizenName: "GPT-A", inventory: [], settlementNeeds: [], memories: [], nearbyCitizens: [] }).catch(() => undefined);
  assert.equal(fixture.openai.calls.length, 0, "admission persistence failed before send; no provider request is allowed");
} finally { fixture.registry.closeAll(); }
console.log("PASS: undurable admission refuses before any provider transport call");
