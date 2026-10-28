import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fail, ok } from "@civ/shared";
import { CivilizationStore } from "./store.js";
import {
  cancelCitizenWork,
  lastOutcomeFrom,
  loadCitizenLastOutcome,
  mergeUnresolved,
  persistCitizenLastOutcome,
  physicalWorkComplete,
  RETRYABLE_FAILURE_LIMIT,
  shouldBackoffToObserve,
  suppressedActions,
} from "./task-recovery.js";
import type { PlannedTask } from "./planner.js";

const plan = (over: Partial<PlannedTask> = {}): PlannedTask => ({
  goal: "acquire_food",
  task: "fish_shore",
  action: "fishShore",
  source: "planner",
  reason: "try fishing",
  priority: 0.5,
  ...over,
});

describe("physical vs planner results", () => {
  it("does not mark CURFEW_STOP or cancelled work complete", () => {
    const interrupted = fail("CURFEW_STOP", "leave for bed", 10, true, { collected: 1, workComplete: false });
    expect(physicalWorkComplete(interrupted)).toBe(false);
    const outcome = lastOutcomeFrom(plan(), interrupted);
    expect(outcome.success).toBe(false);
    expect(outcome.workComplete).toBe(false);
    expect(outcome.skillStatus).toBe("INTERRUPTED");
    expect(outcome.collected).toBe(1);
  });

  it("does not treat ok() with workComplete false as success", () => {
    const fake = ok({ collected: 0, workComplete: false }, 5);
    expect(physicalWorkComplete(fake)).toBe(false);
    const outcome = lastOutcomeFrom(plan({ task: "mine_ore", action: "mineOre" }), fake);
    expect(outcome.success).toBe(false);
    expect(outcome.code).toBe("INTERRUPTED");
  });

  it("reads missing details from failures, not from success results", () => {
    const denied = fail("ACCESS_DENIED", "no chest", 0, false, { missing: "authorized_storage" });
    const unresolved = mergeUnresolved(undefined, plan(), denied, false);
    expect(unresolved).toEqual([
      {
        action: "fishShore",
        task: "fish_shore",
        code: "ACCESS_DENIED",
        item: undefined,
        missing: "authorized_storage",
      },
    ]);
    const interruptedSuccess = ok({ collected: 0, workComplete: false }, 4);
    expect(mergeUnresolved(undefined, plan(), interruptedSuccess, false)).toEqual([]);
  });

  it("keeps ACCESS_DENIED as an unresolved block after a later observe success", () => {
    const denied = lastOutcomeFrom(
      plan(),
      fail("ACCESS_DENIED", "no chest", 0, false, { missing: "authorized_storage" }),
    );
    expect(denied.unresolved?.some((entry) => entry.action === "fishShore")).toBe(true);
    const observed = lastOutcomeFrom(
      plan({ task: "observe", action: "observeNearby", goal: "idle" }),
      ok({ entities: [] }, 2),
      denied,
    );
    expect(observed.success).toBe(true);
    expect(observed.unresolved?.some((entry) => entry.action === "fishShore")).toBe(true);
    const suppressed = suppressedActions(observed.unresolved, {
      hasStorage: false,
      hasRod: true,
      hasPickaxe: false,
      hasShore: true,
      hasOre: false,
      availableHomeIds: [],
    });
    expect(suppressed.has("fishShore")).toBe(true);
  });

  it("clears fishing suppression once authorized storage exists", () => {
    const denied = lastOutcomeFrom(plan(), fail("ACCESS_DENIED", "no chest", 0, false));
    const suppressed = suppressedActions(denied.unresolved, {
      hasStorage: true,
      hasRod: true,
      hasPickaxe: false,
      hasShore: true,
      hasOre: false,
      availableHomeIds: [],
    });
    expect(suppressed.has("fishShore")).toBe(false);
  });
});

describe("repeated failure limits", () => {
  it("backs off after consecutive retryable failures of the same task", () => {
    let previous = lastOutcomeFrom(plan({ task: "gather_wood", action: "mineBlock" }), fail("TIMEOUT", "stuck", 1, true));
    expect(shouldBackoffToObserve(previous)).toBe(false);
    previous = lastOutcomeFrom(plan({ task: "gather_wood", action: "mineBlock" }), fail("TIMEOUT", "stuck", 1, true), previous);
    previous = lastOutcomeFrom(plan({ task: "gather_wood", action: "mineBlock" }), fail("TIMEOUT", "stuck", 1, true), previous);
    expect(previous.streak).toBe(RETRYABLE_FAILURE_LIMIT);
    expect(shouldBackoffToObserve(previous)).toBe(true);
  });

  it("does not backoff curfew or non-retryable access denial into observe", () => {
    expect(
      shouldBackoffToObserve({
        task: "fish_shore",
        action: "fishShore",
        success: false,
        code: "ACCESS_DENIED",
        streak: 5,
        retryable: false,
      }),
    ).toBe(false);
    expect(
      shouldBackoffToObserve({
        task: "mine_ore",
        action: "mineOre",
        success: false,
        code: "CURFEW_STOP",
        streak: 5,
        workComplete: false,
      }),
    ).toBe(false);
  });
});

describe("independent citizens", () => {
  it("aborting Atlas does not abort Maya", () => {
    const atlas = { abort: new AbortController() };
    const maya = { abort: new AbortController() };
    cancelCitizenWork(atlas);
    expect(atlas.abort.signal.aborted).toBe(true);
    expect(maya.abort.signal.aborted).toBe(false);
  });

  it("persists last outcomes separately across a store reopen", () => {
    const path = join(mkdtempSync(join(tmpdir(), "civ-outcome-")), "test.sqlite");
    const store = new CivilizationStore(path);
    persistCitizenLastOutcome(store, "citizen_atlas", {
      task: "fish_shore",
      action: "fishShore",
      success: false,
      code: "ACCESS_DENIED",
      streak: 1,
      unresolved: [{ action: "fishShore", code: "ACCESS_DENIED" }],
    });
    persistCitizenLastOutcome(store, "citizen_maya", {
      task: "claim_home",
      action: "claimHome",
      success: false,
      code: "CLAIM_CONFLICT",
      item: "home_h9",
      streak: 1,
      unresolved: [{ action: "claimHome", code: "CLAIM_CONFLICT", item: "home_h9" }],
    });
    store.close();
    const restored = new CivilizationStore(path);
    expect(loadCitizenLastOutcome(restored, "citizen_atlas")?.code).toBe("ACCESS_DENIED");
    expect(loadCitizenLastOutcome(restored, "citizen_maya")?.item).toBe("home_h9");
    expect(loadCitizenLastOutcome(restored, "citizen_atlas")?.item).toBeUndefined();
    restored.close();
  });
});
