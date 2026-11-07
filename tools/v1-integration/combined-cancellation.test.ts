import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  createNavigationBackend,
  setNavigationBackend,
  type NavigationBackend,
} from "@civ/minecraft-adapter";
import { EventBus, createEvent, ok } from "@civ/shared";
import { WORKSHOP_CABIN_ID } from "@civ/minecraft-knowledge";
import { CivilizationStore } from "../../packages/agent-core/src/store.js";
import { executePlan } from "../../packages/agent-core/src/executor.js";
import { SettlementRuntime } from "../../packages/agent-core/src/settlement-runtime.js";
import {
  createProductionHarness,
  stubNavOk,
} from "../../packages/agent-core/src/construction-production-harness.js";
import { buildFixture } from "./fixtures.js";
import { createIndependentOfflineRuntime } from "../../apps/orchestrator/src/independent-offline-runtime.js";

it("reopens partial construction after cancellation during delayed navigation without late placement", async () => {
  const root = mkdtempSync(join(tmpdir(), "combined-construction-stop-"));
  let store = new CivilizationStore(join(root, "state.sqlite"));
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  try {
    const audit = { actor: "orchestrator-config" as const, reason: "combined cancellation" };
    store.upsertCommunity("north", "North", audit);
    store.addCommunityMember("north", "citizen_atlas", audit);
    const harness = createProductionHarness({
      inventory: [
        { name: "oak_planks", count: 200 },
        { name: "oak_door", count: 1 },
        { name: "chest", count: 1 },
        { name: "torch", count: 1 },
        { name: "crafting_table", count: 1 },
      ],
    });
    Object.assign(harness.ctx.bot, { entities: {} });
    const plan = {
      goal: "contribute_to_project",
      task: "build_structure",
      action: "buildStructure" as const,
      source: "planner" as const,
      reason: "restart test",
      priority: 1,
      item: WORKSHOP_CABIN_ID,
      target: { x: 100, y: 70, z: 100 },
    };
    const runtime = new SettlementRuntime();
    setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
    await executePlan(harness.ctx, plan, store, new EventBus(), runtime);
    const id = runtime.forCommunity("north", store).project!.id;
    const count = harness.placeRequests.length;
    let navigating = false;
    setNavigationBackend({
      ...stubNavOk(),
      navigateToPlaceBlock: async () => {
        navigating = true;
        await gate;
        return ok({ position: plan.target, distance: 0 }, 0);
      },
    } as unknown as NavigationBackend);
    const controller = new AbortController();
    harness.ctx.signal = controller.signal;
    const pending = executePlan(harness.ctx, plan, store, new EventBus(), runtime);
    pending.catch(() => undefined);
    await vi.waitFor(() => expect(navigating).toBe(true));
    controller.abort();
    release();
    expect((await pending).success).toBe(false);
    expect(harness.placeRequests).toHaveLength(count);
    store.close();
    store = new CivilizationStore(join(root, "state.sqlite"));
    const restarted = new SettlementRuntime();
    expect(restarted.forCommunity("north", store).project!.id).toBe(id);
    expect(restarted.forCommunity("north", store).project!.status).not.toBe("COMPLETED");
    harness.ctx.signal = undefined;
    setNavigationBackend(stubNavOk() as unknown as NavigationBackend);
    await executePlan(harness.ctx, plan, store, new EventBus(), restarted);
    expect(harness.placeRequests).toHaveLength(count + 1);
    expect(restarted.forCommunity("north", store).project!.id).toBe(id);
  } finally {
    release();
    if (store.isOpen()) store.close();
    rmSync(root, { recursive: true, force: true });
    setNavigationBackend(createNavigationBackend("pathfinder"));
  }
}, 30_000);

it("discards actual delayed provider replies after citizen death and manager shutdown while preserving memory", async () => {
  const fixture = buildFixture(2, "observe");
  fixture.registry.closeAll();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const runtime = createIndependentOfflineRuntime({
    ...fixture.args,
    script: () => ({ after: gate, goal: "observe" }),
  });
  try {
    await runtime.manager.start(undefined, { deferTicks: true });
    const event = createEvent(
      "TaskCompleted",
      { summary: "PRIVATE-GPT", visibility: { class: "actor_private" } },
      "gpt-a",
    );
    runtime.manager.events.emit(event);
    fixture.store.addMemory(
      {
        id: "combined-private",
        citizenId: "gpt-a",
        kind: "episodic",
        content: "PRIVATE-GPT",
        importance: 1,
        createdAt: new Date().toISOString(),
      },
      { sourceEventId: event.id },
    );
    const citizens = runtime.manager.list();
    await Promise.all(
      citizens.map((c) =>
        runtime.manager["tickCitizen"](c, fixture.store.getSettlement(), [], undefined),
      ),
    );
    await vi.waitFor(() => expect(runtime.registry.accounting().experiment.requestsUsed).toBe(2));
    runtime.manager.events.emit(createEvent("CitizenDied", {}, "gpt-a"));
    await runtime.manager.stop();
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(citizens.every((c) => c.pendingLlm === undefined)).toBe(true);
    expect(runtime.registry.evidenceLog().some((e) => e.outcome === "decided")).toBe(false);
    expect(runtime.registry.accounting().experiment.requestsUsed).toBe(2);
    const reopened = new CivilizationStore(fixture.databasePath);
    try {
      expect(reopened.getMemories("gpt-a").some((m) => m.content === "PRIVATE-GPT")).toBe(true);
    } finally {
      reopened.close();
    }
    expect(JSON.stringify(runtime.claude.get("claude-a")?.calls)).not.toContain("PRIVATE-GPT");
  } finally {
    release();
    await runtime.manager.stop();
    if (fixture.store.isOpen()) fixture.store.close();
    fixture.restoreNavigation();
    fixture.cleanup();
  }
}, 30_000);
