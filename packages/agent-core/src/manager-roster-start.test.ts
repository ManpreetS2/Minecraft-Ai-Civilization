import { afterEach, describe, expect, it, vi } from "vitest";
import type { MinecraftBody } from "@civ/minecraft-adapter";
import { loadConfig, ok } from "@civ/shared";
import { AgentManager } from "./manager.js";
import { CivilizationStore } from "./store.js";
vi.mock("@civ/minecraft-adapter", async (original) => ({
  ...await original<typeof import("@civ/minecraft-adapter")>(),
  MinecraftBody: class { constructor() { throw new Error("default network body must not be constructed"); } },
}));
const managers: AgentManager[] = [];
const stores: CivilizationStore[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.stop();
  for (const s of stores.splice(0)) if (s.isOpen()) s.close();
});
const roster = [{ id: "gpt-independent", name: "NorthOne" }, { id: "claude-independent", name: "SouthOne" }];
function setup() {
  const store = new CivilizationStore(":memory:"); stores.push(store);
  const made: Array<{ citizenId?: string; username: string }> = [];
  const createBody = (options: ConstructorParameters<typeof MinecraftBody>[0]) => {
    made.push(options);
    return { connected: true, on: () => undefined, connect: async () => ok({}, 0), disconnect: async () => undefined, isDeceased: () => false } as unknown as MinecraftBody;
  };
  return { store, made, createBody };
}
describe("explicit independent citizen startup", () => {
  it("connects the supplied stable roster rather than Atlas/Maya and preserves the experiment run ID", async () => {
    const fx = setup();
    const legacyAtlas = fx.store.getCitizen("citizen_atlas");
    const manager = new AgentManager(loadConfig({ LLM_ENABLED: "false", DEMO_PROFILE: "none", SIM_RUN_ID: "offline-stable-run" }), fx.store, { roster, createBody: fx.createBody });
    managers.push(manager);
    await manager.start(undefined, { deferTicks: true });
    expect(fx.made.map((b) => [b.citizenId, b.username])).toEqual(roster.map((r) => [r.id, r.name]));
    expect(manager.list().map((c) => c.record.id)).toEqual(roster.map((r) => r.id));
    expect(fx.store.getMeta("runId")).toBe("offline-stable-run");
    expect(fx.store.getCitizen("citizen_atlas")).toEqual(legacyAtlas);
    const personalities = manager.list().map((c) => fx.store.getCitizen(c.record.id)!.personalityJson);
    expect(personalities.every((p) => typeof p === "string" && p.length > 0)).toBe(true);
    expect(personalities[0]).not.toBe(personalities[1]);
  }, 10_000);
  it.each([
    [{ id: "same", name: "NorthOne" }, { id: "same", name: "SouthOne" }],
    [{ id: "a", name: "SameName" }, { id: "b", name: "samename" }],
    [{ id: "a", name: "/tell @a" }],
    [],
  ].map((invalid) => ({ invalid })))("rejects invalid roster before opening a body", ({ invalid }) => {
    const fx = setup();
    expect(() => new AgentManager(loadConfig({ LLM_ENABLED: "false" }), fx.store, { roster: invalid, createBody: fx.createBody })).toThrow(/roster|identity|username/i);
    expect(fx.made).toHaveLength(0);
  });
  it("refuses a partial explicit roster before run state or bodies are created", async () => {
    const fx = setup();
    const manager = new AgentManager(loadConfig({ LLM_ENABLED: "false" }), fx.store, { roster, createBody: fx.createBody }); managers.push(manager);
    await expect(manager.start(1, { deferTicks: true })).rejects.toThrow(/roster|count/i);
    expect(fx.made).toHaveLength(0);
    expect(fx.store.getMeta("runId")).toBeUndefined();
  });
  it("refuses a stable ID rebound to a different persisted Minecraft identity", async () => {
    const fx = setup();
    fx.store.upsertCitizen({ id: roster[0]!.id, name: "Original", minecraftUsername: "Original", status: "offline", createdAt: "2026-01-01T00:00:00.000Z" });
    const manager = new AgentManager(loadConfig({ LLM_ENABLED: "false" }), fx.store, { roster, createBody: fx.createBody }); managers.push(manager);
    await expect(manager.start(undefined, { deferTicks: true })).rejects.toThrow(/persisted|conflicts/i);
    expect(fx.made).toHaveLength(0);
    expect(fx.store.getMeta("runId")).toBeUndefined();
  });
});
