import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventBus, fail, loadConfig, ok, type Relationship } from "@civ/shared";
import { completionMemoryForTask, persistConfirmed, persistConstructionProgress } from "./executor.js";
import { AgentManager } from "./manager.js";
import { CivilizationStore } from "./store.js";

function tmpStore(prefix: string): { store: CivilizationStore; path: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const path = join(dir, "t.sqlite");
  return { store: new CivilizationStore(path), path };
}

describe("shelter completion honesty", () => {
  it("does not treat persisted=false as durable shelter completion", () => {
    const physical = ok({ complete: true, persisted: false }, 12);
    expect(physical.success).toBe(true);
    expect(persistConfirmed(physical)).toBe(false);
    const memory = completionMemoryForTask("build_shelter", physical);
    expect(memory).not.toMatch(/completed build_shelter/i);
    expect(memory).toMatch(/not persisted/i);
  });

  it("records durable completion only when persistence is confirmed", () => {
    const durable = ok({ complete: true, persisted: true }, 12);
    expect(persistConfirmed(durable)).toBe(true);
    expect(completionMemoryForTask("build_shelter", durable)).toBe("Completed build_shelter");
  });

  it("does not convert physical success into a physical failure string", () => {
    const physical = ok({ complete: true, persisted: false }, 8);
    const memory = completionMemoryForTask("build_shelter", physical);
    expect(memory).not.toMatch(/failed/i);
    expect(persistConfirmed(fail("DATABASE_ERROR", "closed", 0))).toBe(false);
    expect(completionMemoryForTask("build_shelter", fail("DATABASE_ERROR", "closed", 0))).toMatch(
      /Task build_shelter failed/,
    );
  });
});

describe("persistence vs physical success", () => {
  it("does not emit ConstructionProgress when the settlement write fails", () => {
    const { store } = tmpStore("civ-persist-");
    const events = new EventBus();
    store.saveSettlement = () => {
      throw new Error("disk full");
    };
    const result = persistConstructionProgress(store, events, "citizen_atlas", () => {
      store.saveSettlement(store.getSettlement());
      return { placed: 4, total: 12 };
    });
    expect(result.persisted).toBe(false);
    expect(result.write.ok).toBe(false);
    if (!result.write.ok) expect(result.write.reason).toBe("error");
    expect(events.getRecent().filter((e) => e.type === "ConstructionProgress")).toHaveLength(0);
    store.close();
  });

  it("emits ConstructionProgress only after a successful durable write", () => {
    const { store } = tmpStore("civ-persist-");
    const events = new EventBus();
    const result = persistConstructionProgress(store, events, "citizen_atlas", () => {
      const settlement = store.getSettlement();
      settlement.construction = {
        blueprintId: "hut",
        startedAt: new Date().toISOString(),
        totalBlocks: 10,
        placedBlocks: 3,
        complete: false,
      };
      store.saveSettlement(settlement);
      return { placed: 3, total: 10 };
    });
    expect(result.persisted).toBe(true);
    const progress = events.getRecent().filter((e) => e.type === "ConstructionProgress");
    expect(progress).toHaveLength(1);
    expect(progress[0]?.payload).toMatchObject({ placed: 3, total: 10, persisted: true });
    store.close();
  });

  it("does not emit RelationshipChanged when relationship persistence fails", async () => {
    const { store, path } = tmpStore("civ-persist-");
    const manager = new AgentManager(
      loadConfig({
        DATABASE_PATH: path,
        LLM_ENABLED: "false",
        AUTO_START_PAPER: "false",
        SIM_CITIZEN_COUNT: "0",
      }),
      store,
    );
    store.saveRelationship = () => {
      throw new Error("disk full");
    };

    const rel: Relationship = {
      citizenId: "citizen_atlas",
      otherId: "citizen_maya",
      trust: 0.1,
      affection: 0,
      respect: 0,
      resentment: 0,
      familiarity: 0.2,
    };
    const wrote = manager["persistRelationship"](rel);
    expect(wrote.ok).toBe(false);
    if (!wrote.ok) expect(wrote.reason).toBe("error");

    const other = {
      record: {
        id: "citizen_maya",
        name: "Maya",
        minecraftUsername: "Maya",
        createdAt: new Date().toISOString(),
        status: "online" as const,
      },
      body: {
        isDeceased: () => false,
        connected: true,
        nearbyPlayers: () => [{ username: "Atlas" }],
        position: () => ({ x: 1, y: 64, z: 0 }),
        chat: async () => ({ success: true, data: { message: "" }, durationMs: 0 }),
        disconnect: async () => undefined,
        markDeceased: () => undefined,
      },
      busy: true,
      lastLlmAt: 0,
      lastChatAt: 0,
      lastPlan: {
        goal: "gather_wood",
        task: "gather_wood",
        action: "mineBlock",
        source: "planner" as const,
        reason: "wood",
        priority: 0.6,
      },
    };
    const atlas = {
      record: {
        id: "citizen_atlas",
        name: "Atlas",
        minecraftUsername: "Atlas",
        createdAt: new Date().toISOString(),
        status: "online" as const,
      },
      body: {
        isDeceased: () => false,
        connected: true,
        nearbyPlayers: () => [{ username: "Maya" }],
        position: () => ({ x: 0, y: 64, z: 0 }),
        chat: async () => ({ success: true, data: { message: "" }, durationMs: 0 }),
        disconnect: async () => undefined,
        markDeceased: () => undefined,
      },
      busy: false,
      lastLlmAt: 0,
      lastChatAt: 0,
      lastPlan: {
        goal: "gather_wood",
        task: "gather_wood",
        action: "mineBlock",
        source: "planner" as const,
        reason: "wood",
        priority: 0.6,
      },
    };
    manager["citizens"].set("citizen_atlas", atlas as never);
    manager["citizens"].set("citizen_maya", other as never);
    manager["maybeSocial"](atlas as never, true);

    expect(manager.events.getRecent().filter((e) => e.type === "RelationshipChanged")).toHaveLength(0);
    await manager.stop();
  });

  it("does not recursively emit ErrorOccurred when persisting a persistence failure fails", async () => {
    const { store, path } = tmpStore("civ-persist-");
    const manager = new AgentManager(
      loadConfig({
        DATABASE_PATH: path,
        LLM_ENABLED: "false",
        AUTO_START_PAPER: "false",
        SIM_CITIZEN_COUNT: "0",
      }),
      store,
    );
    store.appendEvent = () => {
      throw new Error("append failed");
    };
    manager["reportWrite"]("saveRelationship", { ok: false, reason: "error", error: new Error("disk full") });
    const errors = manager.events.getRecent().filter((e) => e.type === "ErrorOccurred");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.payload.durable).toBe(false);
    await manager.stop();
  });
});
