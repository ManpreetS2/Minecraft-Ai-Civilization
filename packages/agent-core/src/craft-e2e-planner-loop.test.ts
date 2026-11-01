/**
 * CRAFT-001 (planner + executor layer): drive the PRODUCTION decision loop
 *   planCitizen -> executePlan -> lastOutcomeFrom -> planCitizen ...
 * from an EMPTY inventory against the Mineflayer-shaped mock bot until a wooden pickaxe exists.
 * The observation fed back to the planner is built from the mock's REAL inventory each tick.
 * Offline only; live Minecraft behaviour stays UNVERIFIED.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus, type BodyObservation, type SettlementState } from "@civ/shared";
import { createNavigationBackend, setNavigationBackend, type NavigationBackend } from "@civ/minecraft-adapter";
import { afterEach, describe, expect, it } from "vitest";
import { executePlan } from "./executor.js";
import { planCitizen, type LastOutcome } from "./planner.js";
import { CivilizationStore } from "./store.js";
import { lastOutcomeFrom } from "./task-recovery.js";
import { loadCraftFixture } from "./testing/load-craft-fixture.js";

const settlement = (): SettlementState => ({
  id: "settlement_first",
  name: "First Settlement",
  food: 0,
  wood: 0,
  stone: 0,
  beds: 0,
  housingCapacity: 0,
  tools: 0,
  shelterComplete: false,
  needs: [],
});

/** Explicit budget: these drive the real gather/craft/place loop and the slowest case takes ~5s on a quiet box. */
const E2E_TIMEOUT_MS = 30_000;

describe("CRAFT-001 planner->executor loop from an empty inventory", { timeout: E2E_TIMEOUT_MS }, () => {
  afterEach(() => setNavigationBackend(createNavigationBackend("pathfinder")));

  it("reaches a wooden_pickaxe in a bounded number of ticks, each tick's claim matching the real inventory", async () => {
    const fx = await loadCraftFixture({ trees: [{ x: 6, z: 3, height: 4 }, { x: -5, z: 8, height: 4 }] });
    setNavigationBackend(fx.nav as NavigationBackend);
    const store = new CivilizationStore(join(mkdtempSync(join(tmpdir(), "civ-craft001-")), "t.sqlite"));
    const events = new EventBus();
    (fx.ctx as { events?: EventBus }).events = events;
    const started: string[] = [];
    events.on((event) => {
      if (event.type === "ActionStarted") started.push(String((event.payload as { action?: string }).action));
    });

    expect(fx.totalItems()).toBe(0);
    let last: LastOutcome | undefined;
    const trace: Array<{ tick: number; action: string; task: string; item?: string; ok: boolean; inv: string }> = [];

    for (let tick = 1; tick <= 8 && fx.count("wooden_pickaxe") === 0; tick++) {
      const p = fx.bot.entity.position;
      const observation: BodyObservation = {
        username: "Atlas",
        connected: true,
        spawned: true,
        health: 20,
        food: 20,
        inventory: fx.items.map((stack) => ({ name: stack.name, count: stack.count })),
        players: [],
        nearby: [],
        position: { x: p.x, y: p.y, z: p.z },
        gameTime: 1_000,
        isNight: false,
      };
      const before = fx.totalItems();
      const plan = planCitizen({ citizenId: "citizen_craft001", observation, settlement: settlement(), assignedNeeds: [], lastOutcome: last });
      const result = await executePlan(fx.ctx, plan, store, events);
      last = lastOutcomeFrom(plan, result, last);
      trace.push({ tick, action: plan.action, task: plan.task, item: plan.item, ok: result.success, inv: fx.items.map((s) => `${s.name}x${s.count}`).join(",") });
      // a "successful" tick must be backed by an observable change in the real inventory or world
      if (result.success) {
        expect(fx.totalItems() !== before || fx.blocksNamed("crafting_table") > 0, `tick ${tick} claimed success with no observable change: ${JSON.stringify(trace)}`).toBe(true);
      }
    }

    const dump = JSON.stringify(trace);
    expect(fx.count("wooden_pickaxe"), dump).toBe(1);
    expect(trace.length, dump).toBeLessThanOrEqual(8);
    expect(trace[0]?.action, dump).toBe("mineBlock"); // empty inventory starts with wood gathering
    expect(trace.some((t) => t.action === "obtainItem" && t.item === "wooden_pickaxe"), dump).toBe(true);
    expect(fx.blocksNamed("crafting_table"), dump).toBe(1);
    expect(fx.stats.windowOpens, dump).toBe(1);
    expect(fx.stats.digs.filter((n) => n.endsWith("_log")).length, dump).toBeGreaterThanOrEqual(3);
    expect(started.length).toBe(trace.length);
  }, 60_000);
});
