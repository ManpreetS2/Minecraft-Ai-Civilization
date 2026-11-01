import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "@civ/shared";
import { createJsonFileCitizenSessionStore } from "@civ/cognition/routing";
import { OfflinePhysicalWorld } from "./testing/physical-world.js";

/**
 * Independent QA of PR #33 (8389e8c), test-only. Real manager, planner, executor, skills and SQLite against simulated
 * bodies and scripted provider replies. This is not live Minecraft evidence.
 *
 * `it.fails` marks a defect that is reproduced today: the test passes while the defect exists and turns red the moment
 * it is fixed, which is the signal to change it to a plain `it`. The same defect is also scripted in
 * scripts/repro-manager-executor-isolation.ts.
 */
const worlds: OfflinePhysicalWorld[] = [];
const dirs: string[] = [];
const network = vi.fn(() => {
  throw new Error("real network forbidden");
});
beforeEach(() => {
  network.mockClear();
  vi.stubGlobal("fetch", network);
});
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.unstubAllGlobals();
  expect(network).not.toHaveBeenCalled();
});

function world(options: { databasePath?: string; sessionStore?: ReturnType<typeof createJsonFileCitizenSessionStore> } = {}) {
  const config = loadConfig({
    DEMO_PROFILE: "none",
    LLM_PROVIDER: "none",
    LLM_ENABLED: "true",
    CLOUD_LLM_ENABLED: "false",
    LLM_COOLDOWN_MS: "1",
    HUMAN_DIRECTIVES_ENABLED: "false",
    COMMUNITIES_JSON: JSON.stringify([
      { id: "north", memberIds: ["gpt-a"] },
      { id: "south", memberIds: ["claude-a"] },
    ]),
  });
  const w = new OfflinePhysicalWorld({ ...options, config });
  worlds.push(w);
  return w;
}

const legacy = (w: OfflinePhysicalWorld) => {
  const s = w.store.getSettlement();
  return { food: s.food, wood: s.wood, stone: s.stone, tools: s.tools };
};
const EMPTY = { food: 0, wood: 0, stone: 0, tools: 0 };

describe("QA: personal inventory must not become the legacy settlement_first stock", { timeout: 60_000 }, () => {
  it.fails("DEFECT: gathering berries raises settlement_first.food (0 -> 2)", async () => {
    const w = world();
    await w.tick();
    expect(w.bodies.get("gpt-a")!.count("sweet_berries")).toBe(2);
    expect(legacy(w)).toEqual(EMPTY);
  });

  it.fails("DEFECT: chopping and crafting raise settlement_first.wood and .tools from personal inventory", async () => {
    const w = world();
    await w.tick();
    await w.tick();
    await w.tick();
    expect(w.bodies.get("gpt-a")!.count("oak_log")).toBeGreaterThan(0);
    expect(w.bodies.get("claude-a")!.count("wooden_pickaxe")).toBe(1);
    expect(legacy(w)).toEqual(EMPTY);
  });

  it.fails("DEFECT: the leaked stock is written to SQLite and survives a manager restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-isolation-"));
    dirs.push(dir);
    const w = world({ databasePath: join(dir, "qa.sqlite"), sessionStore: createJsonFileCitizenSessionStore(join(dir, "sessions.json")) });
    await w.tick();
    await w.restart();
    expect(legacy(w)).toEqual(EMPTY);
  });

  it("the leak is the aggregate row only: each body still holds exactly its own items", async () => {
    const w = world();
    await w.tick();
    expect(w.bodies.get("gpt-a")!.count("sweet_berries")).toBe(2);
    expect(w.bodies.get("claude-a")!.count("sweet_berries")).toBe(2);
    expect(w.world.dropped).toHaveLength(0);
  });
});

describe("QA: nothing one community knows reaches the other's provider prompt", { timeout: 60_000 }, () => {
  const SECRETS: Record<string, string[]> = {
    "gpt-a": ["SECRET-NORTH-LOCATION x=901 y=64 z=-402", "SECRET-NORTH-CHEST holds diamond x9"],
    "claude-a": ["SECRET-SOUTH-LOCATION x=-777 y=70 z=313", "SECRET-SOUTH-CHEST holds netherite_ingot x4"],
  };

  it("private locations and inventories stay in their owner's prompts across gathering, crafting and restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-isolation-"));
    dirs.push(dir);
    const w = world({ databasePath: join(dir, "qa.sqlite"), sessionStore: createJsonFileCitizenSessionStore(join(dir, "sessions.json")) });
    for (const [id, lines] of Object.entries(SECRETS)) w.privateMemory(id, lines.join(" | "));
    await w.tick();
    await w.tick();
    await w.tick();
    await w.restart();
    await w.tick();
    for (const [owner, lines] of Object.entries(SECRETS)) {
      const rival = owner === "gpt-a" ? "claude-a" : "gpt-a";
      const own = w.sent(owner);
      const theirs = w.sent(rival);
      for (const line of lines) {
        expect(own, `${owner} should know its own ${line}`).toContain(line);
        expect(theirs, `${rival} must not see ${line}`).not.toContain(line);
      }
      expect(theirs).not.toContain(`Citizen: ${owner === "gpt-a" ? "GPT-A" : "Claude-A"}`);
      expect(theirs).not.toMatch(new RegExp(`\b${owner}\b`));
    }
  });

  it("each prompt describes only its own inventory, not the rival's crafted tools", async () => {
    const w = world();
    await w.tick();
    await w.tick();
    await w.tick();
    expect(w.bodies.get("claude-a")!.count("wooden_pickaxe")).toBe(1);
    expect(w.sent("gpt-a")).not.toContain("wooden_pickaxe");
    expect(w.sent("gpt-a")).not.toContain("crafting_table");
  });
});

describe("QA: event provenance", { timeout: 60_000 }, () => {
  it("every observed event names a real actor and task results stay actor-private", async () => {
    const w = world();
    await w.tick();
    await w.tick();
    await w.tick();
    const events = w.store.listAllEventsForObserver();
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(["gpt-a", "claude-a"]).toContain(e.citizenId);
    for (const e of events.filter((x) => x.type === "TaskCompleted")) {
      expect((e as unknown as { payload?: { visibility?: { class?: string } } }).payload?.visibility?.class).toBe("actor_private");
    }
    // A rival's resource events do not show up as the other citizen's own work.
    const collected = events.filter((e) => e.type === "ResourceCollected").map((e) => e.citizenId);
    expect(collected).not.toContain("claude-a");
  });
});
