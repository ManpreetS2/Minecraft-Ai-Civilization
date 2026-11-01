/** Intact acceptance assertion, separate from capability tests: no live server or provider transport. */
import assert from "node:assert/strict";
import { OfflinePhysicalWorld } from "../packages/agent-core/src/testing/physical-world.js";
import { loadConfig } from "@civ/shared";
const w = new OfflinePhysicalWorld({ config: loadConfig({ LLM_PROVIDER: "none", LLM_ENABLED: "true", CLOUD_LLM_ENABLED: "false", LLM_COOLDOWN_MS: "1", COMMUNITIES_JSON: JSON.stringify([{ id: "north", memberIds: ["gpt-a"] }, { id: "south", memberIds: ["claude-a"] }]) }) });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("real network forbidden"); };
try {
  const before = w.store.getSettlement();
  await w.tick();
  assert.equal(w.bodies.get("gpt-a")!.count("sweet_berries"), 2, "real gather must acquire food");
  assert.equal(w.bodies.get("claude-a")!.count("sweet_berries"), 2, "both bodies must acquire independently");
  assert.deepEqual(w.store.getSettlement(), before, "community-scoped personal actions must not mutate settlement_first");
  console.log("PASS: real manager/executor leaves legacy settlement unchanged");
} finally { await w.close(); globalThis.fetch = originalFetch; }
