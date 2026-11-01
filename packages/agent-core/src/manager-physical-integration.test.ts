import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "@civ/shared";
import { OFFLINE_2V2_ASSIGNMENTS, createJsonFileCitizenSessionStore } from "@civ/cognition/routing";
import { OfflinePhysicalWorld } from "./testing/physical-world.js";

// No planner, executor or skill mocks. This suite verifies capabilities; the separate isolation
// reproducer fails on the protected executor's legacy aggregate write and blocks overall acceptance.
const worlds: OfflinePhysicalWorld[] = [];
const dirs: string[] = [];
const network = vi.fn(() => { throw new Error("real network forbidden"); });
beforeEach(() => { network.mockClear(); vi.stubGlobal("fetch", network); });
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.unstubAllGlobals();
  expect(network).not.toHaveBeenCalled();
});
function world(options: Omit<ConstructorParameters<typeof OfflinePhysicalWorld>[0], "config"> = {}) {
  const assignments = options.count === 4 ? OFFLINE_2V2_ASSIGNMENTS : OFFLINE_2V2_ASSIGNMENTS.filter((a) => a.citizenId.endsWith("-a"));
  const config = loadConfig({ DEMO_PROFILE: "none", LLM_PROVIDER: "none", LLM_ENABLED: "true", CLOUD_LLM_ENABLED: "false", LLM_COOLDOWN_MS: "1", DEMO_BULLETIN_TARGET_TOKENS: "400", HUMAN_DIRECTIVES_ENABLED: "false", COMMUNITIES_JSON: JSON.stringify([
    { id: "north", memberIds: assignments.filter((a) => a.family === "gpt").map((a) => a.citizenId) },
    { id: "south", memberIds: assignments.filter((a) => a.family === "claude").map((a) => a.citizenId) },
  ]) });
  const w = new OfflinePhysicalWorld({ ...options, config }); worlds.push(w); return w;
}

describe("real manager/planner/executor physical capabilities (offline only)", { timeout: 40_000 }, () => {
  it.each([2, 4] as const)("%i empty-start bodies gather/eat and execute independent family mock choices", async (count) => {
    const w = world({ count });
    for (const [id, body] of w.bodies) {
      expect(body.totalItems()).toBe(0);
      w.privateMemory(id, `SECRET-${id}`);
    }
    expect([...w.world.blocks.values()]).not.toContain("crafting_table");
    await w.tick(); // Hunger reflex: real gatherFood -> dig -> drop -> pickup.
    for (const fx of w.bodies.values()) {
      expect(fx.count("sweet_berries")).toBe(2);
      expect(fx.stats.pickups).toContain("sweet_berries");
    }
    await w.tick(); // Hunger reflex: real eatFood, consumes an item and verifies hunger.
    for (const fx of w.bodies.values()) { expect(fx.bot.food).toBe(9); expect(fx.count("sweet_berries")).toBe(1); }
    await w.tick(); // Distinct scripted model choices consumed by actual planner/executor.
    for (const a of w.assignments) {
      const fx = w.bodies.get(a.citizenId)!;
      expect([...w.trace].reverse().find((e) => e.id === a.citizenId)?.source).toBe("llm");
      if (a.family === "gpt") expect(fx.count("oak_log")).toBeGreaterThan(0);
      else { expect(fx.count("wooden_pickaxe")).toBe(1); expect(fx.stats.placed.some((b) => b.name === "crafting_table")).toBe(true); }
      for (const other of w.assignments) expect(w.sent(a.citizenId).includes(`SECRET-${other.citizenId}`)).toBe(a.citizenId === other.citizenId);
    }
    const complete = w.store.listAllEventsForObserver().filter((e) => e.type === "TaskCompleted");
    for (const id of w.bodies.keys()) expect(complete.some((e) => e.citizenId === id)).toBe(true);
    expect(w.world.dropped).toHaveLength(0);
    console.log(JSON.stringify({ scenario: "manager-physical-capabilities", count, mode: "offline", trace: w.trace, globalSettlementIsolation: "BLOCKED: run separate executor isolation reproducer", humanInterventions: 0, unmodeled: ["live physics", "hostiles", "night survival", "real model decisions"] }));
  });

  it("restart preserves real SQLite private history and independent session identities alongside persistent simulated bodies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "t3-physical-manager-")); dirs.push(dir);
    const sessions = createJsonFileCitizenSessionStore(join(dir, "sessions.json"));
    const w = world({ databasePath: join(dir, "offline.sqlite"), sessionStore: sessions });
    for (const id of w.bodies.keys()) w.privateMemory(id, `RESTART-SECRET-${id}`);
    await w.tick(); await w.tick();
    const before = w.fixture.registry.accounting();
    const inventories = [...w.bodies].map(([id, fx]) => [id, fx.items.map((i) => ({ name: i.name, count: i.count }))]);
    await w.restart();
    expect([...w.bodies].map(([id, fx]) => [id, fx.items.map((i) => ({ name: i.name, count: i.count }))])).toEqual(inventories);
    expect(w.fixture.registry.accounting().experiment.requestsUsed).toBe(before.experiment.requestsUsed);
    await w.tick();
    for (const id of w.bodies.keys()) {
      expect(w.sent(id)).toContain(`RESTART-SECRET-${id}`);
      for (const rival of w.bodies.keys()) if (rival !== id) expect(w.sent(id)).not.toContain(`RESTART-SECRET-${rival}`);
    }
  });

  it("a failed Claude inference does not stop either body's verified hunger recovery or the GPT decision", async () => {
    const w = world({ script: (id) => id.startsWith("claude") ? { status: 400 } : { goal: "gather_wood" } });
    await w.tick(); await w.tick(); await w.tick();
    for (const fx of w.bodies.values()) expect(fx.bot.food).toBe(9);
    expect(w.bodies.get("gpt-a")!.count("oak_log")).toBeGreaterThan(0);
    expect(w.store.listAllEventsForObserver().some((e) => e.type === "LLMSkipped" && e.citizenId === "claude-a")).toBe(true);
  });

  it("two rival bodies contest one observable bush without duplicating its drop or crediting both", async () => {
    const w = world();
    for (const [cell, name] of w.world.blocks) if (name === "sweet_berry_bush") w.world.blocks.delete(cell);
    w.world.blocks.set("3,64,3", "sweet_berry_bush");
    for (const fx of w.bodies.values()) fx.bot.entity.position.set(0.5, 64, 0.5);
    await w.tick();
    expect([...w.bodies.values()].reduce((n, fx) => n + fx.count("sweet_berries"), 0)).toBe(2);
    expect([...w.bodies.values()].reduce((n, fx) => n + fx.stats.digs.filter((b) => b === "sweet_berry_bush").length, 0)).toBe(1);
    expect(w.trace.filter((t) => t.action === "gatherFood" && t.success)).toHaveLength(1);
    expect(w.trace.filter((t) => t.action === "gatherFood" && !t.success)).toHaveLength(1);
  });
});
