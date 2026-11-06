import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { EventBus } from "@civ/shared";
import { WORKSHOP_CABIN_ID } from "@civ/minecraft-knowledge";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { CivilizationStore } from "../../../packages/agent-core/src/store.js";
import { executePlan, completionMemoryForTask } from "../../../packages/agent-core/src/executor.js";
import { SettlementRuntime } from "../../../packages/agent-core/src/settlement-runtime.js";
import { executeBuildStructurePlan, dispatchCitizenBuildIntention, plannedTaskForConstructionProject, type BuildStructureProject } from "../../../packages/agent-core/src/build-structure.js";
import { createProductionHarness, stubNavOk } from "../../../packages/agent-core/src/construction-production-harness.js";
import { communityConstruction } from "../../../packages/agent-core/src/community-construction.js";
const roots: string[] = [];
const stores: CivilizationStore[] = [];
afterEach(() => { for (const s of stores.splice(0)) if (s.isOpen()) s.close(); for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); vi.useRealTimers(); setNavigationBackend(createNavigationBackend("pathfinder")); });
const audit = { actor: "orchestrator-config" as const, reason: "independent persistence test" };
function setup(options: { missing?: boolean; silent?: boolean } = {}) {
  vi.useFakeTimers();
  setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
  const root = mkdtempSync(join(tmpdir(), "construction-qa-")); roots.push(root);
  const path = join(root, "test.sqlite");
  const open = () => { const s = new CivilizationStore(path); stores.push(s); return s; };
  let store = open();
  store.upsertCommunity("north", "North", audit); store.addCommunityMember("north", "citizen_atlas", audit);
  const harness = createProductionHarness({ inventory: options.missing ? [] : [{ name: "oak_planks", count: 1000 }, { name: "oak_door", count: 10 }, { name: "chest", count: 10 }, { name: "torch", count: 10 }, { name: "crafting_table", count: 10 }], silentPlace: options.silent });
  const originalItems = harness.ctx.bot.inventory.items.bind(harness.ctx.bot.inventory);
  let deposited = 0;
  const items = () => originalItems().map((i, type) => ({ ...i, type, count: i.count - (i.name === "oak_planks" ? deposited : 0) }));
  harness.ctx.bot.inventory.items = items;
  Object.defineProperty(harness.ctx.bot.inventory, "slots", { get: () => [...Array(9).fill(null), ...items()] });
  Object.assign(harness.ctx.bot, { entities: {}, activateBlock: async () => undefined, openContainer: async () => ({ containerItems: () => deposited ? [{ name: "oak_planks", count: deposited }] : [], deposit: async (_type: number, _metadata: unknown, count: number) => { deposited += count; }, close: () => undefined }) });
  let runtime = new SettlementRuntime();
  const initial = { goal: "contribute_to_project", task: "build_structure", action: "buildStructure" as const, source: "planner" as const, reason: "controlled objective", priority: 1, item: WORKSHOP_CABIN_ID, target: { x: 100, y: 70, z: 100 } };
  const project = () => runtime.forCommunity("north", store).project as BuildStructureProject | undefined;
  const step = async () => {
    const plan = plannedTaskForConstructionProject(project(), "citizen_atlas") ?? initial;
    const pending = executePlan(harness.ctx, plan.action === "obtainItem" ? initial : plan, store, new EventBus(), runtime);
    pending.catch(() => undefined); await vi.runAllTimersAsync(); return pending;
  };
  const restart = () => { store.close(); store = open(); runtime = new SettlementRuntime(); return project(); };
  const inventory = () => Object.fromEntries(harness.ctx.bot.inventory.items().map(i => [i.name, i.count]));
  return { harness, step, project, restart, inventory, store: () => store, runtime: () => runtime, initial };
}

it("completes through real executor placements and reopens SQLite without rebuilding", async () => {
  const f = setup();
  let result;
  for (let n = 0; n < 300; n++) { result = await f.step(); if (f.project()?.status === "COMPLETED") break; if (!result.success) break; }
  console.log("completion evidence", JSON.stringify({ project: f.project(), requests: f.harness.placeRequests.length, inventory: f.inventory(), result }));
  expect(f.project()?.status).toBe("COMPLETED");
  expect(f.harness.placeRequests.length).toBeGreaterThan(0);
  expect(f.inventory().oak_planks).toBeLessThan(1000);
  const before = structuredClone(f.project()); const requests = f.harness.placeRequests.length; const inventory = f.inventory();
  expect(f.restart()).toMatchObject({ id: before!.id, status: before!.status, ownerCitizenId: before!.ownerCitizenId, placed: before!.placed });
  await f.step(); await f.step();
  expect(f.harness.placeRequests).toHaveLength(requests);
  expect(f.inventory()).toEqual(inventory);
  expect(f.project()?.id).toBe(before!.id);
});

it("partial placements and consumed materials reconcile after SQLite reopen", async () => {
  const f = setup(); await f.step(); await f.step();
  const before = structuredClone(f.project()); const inventory = f.inventory();
  expect(before?.placed).toBeGreaterThan(0); expect(before?.status).not.toBe("COMPLETED");
  expect(f.restart()).toEqual(before); expect(f.inventory()).toEqual(inventory);
  await f.step(); expect(f.project()?.id).toBe(before!.id); expect(f.project()!.placed).toBeGreaterThanOrEqual(before!.placed!);
});

it.each([{ missing: true }, { silent: true }])("failed or missing-material placement cannot complete or consume: %j", async options => {
  const f = setup(options); const before = f.inventory();
  const result = await f.step();
  expect(result.success).toBe(false); expect(f.project()?.status).not.toBe("COMPLETED"); expect(f.inventory()).toEqual(before);
  expect(completionMemoryForTask("build_structure", result)).not.toBe("Completed build_structure");
});

it("an aborted construction cannot add placements and persists the existing progress", async () => {
  const f = setup(); await f.step(); const before = structuredClone(f.project()); const count = f.harness.placeRequests.length;
  const controller = new AbortController(); controller.abort(); f.harness.ctx.signal = controller.signal;
  await f.step(); expect(f.harness.placeRequests).toHaveLength(count); expect(f.project()?.status).not.toBe("COMPLETED");
  expect(f.restart()?.placed).toBeLessThanOrEqual(before!.placed!);
});

it("unaffiliated citizen cannot continue or change durable task", async () => {
  const f = setup(); await f.step(); const before = structuredClone(communityConstruction(f.store()).forCitizen("citizen_atlas").load());
  f.harness.ctx.citizenId = "intruder";
  const pending = executePlan(f.harness.ctx, f.initial, f.store(), new EventBus(), f.runtime()); await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ success: false, code: "ACCESS_DENIED" }); expect(f.restart()).toEqual(before);
});

it("a forged completed row is revalidated against the observed world", async () => {
  const f = setup(); await f.step(); const forged = structuredClone(f.project()!); forged.status = "COMPLETED"; forged.session!.status = "COMPLETE";
  communityConstruction(f.store()).forCitizen("citizen_atlas").save(forged); f.restart();
  const result = await f.step();
  expect(completionMemoryForTask("build_structure", result)).not.toBe("Completed build_structure");
  expect(f.project()?.status).not.toBe("COMPLETED");
});

it("another member cannot replace the task owner after restart", async () => {
  const f = setup(); await f.step(); const before = structuredClone(f.project()!);
  f.store().addCommunityMember("north", "other", audit); f.restart(); f.harness.ctx.citizenId = "other";
  const pending = executePlan(f.harness.ctx, f.initial, f.store(), new EventBus(), f.runtime()); pending.catch(() => undefined); await vi.runAllTimersAsync(); await pending;
  expect(f.project()?.ownerCitizenId).toBe(before.ownerCitizenId);
  expect(f.project()?.id).toBe(before.id);
});

it("shutdown with a closed store reports no durable completion", async () => {
  const f = setup(); await f.step(); const count = f.harness.placeRequests.length;
  f.store().close(); const controller = new AbortController(); controller.abort(); f.harness.ctx.signal = controller.signal;
  const result = await f.step();
  expect(f.harness.placeRequests).toHaveLength(count);
  expect(completionMemoryForTask("build_structure", result)).not.toBe("Completed build_structure");
});

it("replayed completion attempts do not repeatedly consume validation materials", async () => {
  const f = setup(); for (let n = 0; n < 80; n++) await f.step();
  const before = f.inventory(); const count = f.harness.placeRequests.length;
  await f.step(); await f.step();
  expect(f.harness.placeRequests).toHaveLength(count);
  expect(f.inventory()).toEqual(before);
});

it("dispatcher with property observations completes and reloads without duplicate placements", async () => {
  const f = setup();
  const dispatch = async () => {
    const p = dispatchCitizenBuildIntention({ intention: { citizenId: "citizen_atlas", blueprintId: WORKSHOP_CABIN_ID, origin: f.initial.target, facing: "south", inventory: f.inventory() }, runtime: f.runtime().forCommunity("north", f.store()), ctx: f.harness.ctx, getBlock: f.harness.getBlock, getBlockProperties: f.harness.getBlockProperties, maxPlacements: 1, persist: project => ({ ok: communityConstruction(f.store()).forCitizen("citizen_atlas").save(project) }) });
    p.catch(() => undefined); await vi.runAllTimersAsync(); return p;
  };
  let result;
  for (let i = 0; i < 100; i++) { result = await dispatch(); if (result.phase === "COMPLETED") break; }
  expect(result?.worldVerifiedComplete).toBe(true);
  expect(result?.phase).toBe("COMPLETED");
  const before = structuredClone(f.project()!); const requests = f.harness.placeRequests.length; const inventory = f.inventory();
  expect(f.restart()).toMatchObject({ id: before.id, ownerCitizenId: before.ownerCitizenId, status: "COMPLETED", placed: before.placed });
  await dispatch(); await dispatch();
  expect(f.harness.placeRequests).toHaveLength(requests); expect(f.inventory()).toEqual(inventory);
  console.log("dispatcher restart evidence", JSON.stringify({ id: before.id, status: before.status, placed: before.placed, requests, inventory }));
});

it("explicit cancellation survives SQLite restart", async () => {
  const f = setup(); await f.step();
  const pending = executeBuildStructurePlan({ ctx: f.harness.ctx, plan: f.initial, runtime: f.runtime().forCommunity("north", f.store()), cancelled: true, persist: project => ({ ok: communityConstruction(f.store()).forCitizen("citizen_atlas").save(project) }) });
  pending.catch(() => undefined); await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ success: false, code: "CANCELLED" });
  expect(f.project()?.cancelled).toBe(true);
  expect(f.restart()?.cancelled).toBe(true);
});
