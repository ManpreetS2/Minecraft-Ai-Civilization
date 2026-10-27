import { describe, expect, it } from "vitest";
import { curfewWorkInterrupted, evaluateReturnHome } from "@civ/minecraft-adapter";
import { classifySkill } from "@civ/skills";
import {
  curfewDidNotCompleteWork,
  evaluateCitizenCurfew,
  planCurfewBedtimeAction,
  shouldAbortActiveWorkForCurfew,
  workHandoffToCurfew,
} from "./curfew-runtime.js";

const h7 = {
  homeId: "home_h7",
  bed: { x: -1089, y: 68, z: 817 },
  origin: { x: -1089, y: 68, z: 817 },
  entrance: { x: -1086, y: 68, z: 816 },
  status: "active" as const,
};
const h4 = {
  homeId: "home_h4",
  bed: { x: -1055, y: 65, z: 779 },
  origin: { x: -1055, y: 65, z: 779 },
  status: "active" as const,
};
const pond = { x: -1043, y: 63, z: 980 };

describe("citizen curfew runtime decision", () => {
  it("leaves work before night when travel plus recovery no longer fits", () => {
    const atlas = evaluateCitizenCurfew({
      home: h7,
      position: pond,
      timeOfDay: 11_990,
      isNight: false,
    });
    expect(atlas.shouldLeaveWork).toBe(true);
    expect(atlas.homeId).toBe("home_h7");
    expect(atlas.bed).toEqual(h7.bed);
    expect(atlas.plan?.shouldStopOptionalWork).toBe(true);
  });

  it("keeps each citizen's own claim instead of routing everyone to H1", () => {
    const maya = evaluateCitizenCurfew({
      home: h4,
      position: pond,
      timeOfDay: 11_990,
      isNight: false,
    });
    expect(maya.homeId).toBe("home_h4");
    expect(maya.bed).toEqual(h4.bed);
    expect(maya.destination).not.toEqual({ x: -1096.5, y: 69, z: 730.5 });
  });

  it("does not invent a house when the citizen has no claim", () => {
    const none = evaluateCitizenCurfew({
      position: pond,
      timeOfDay: 14_000,
      isNight: true,
    });
    expect(none.shouldLeaveWork).toBe(false);
    expect(none.homeId).toBeUndefined();
    expect(none.reason).toMatch(/no claimed home/);
  });

  it("aborts this citizen's work only, without completing it or clearing inventory", () => {
    const atlas = { abort: new AbortController(), inventory: { cod: 2 } };
    const maya = { abort: new AbortController(), inventory: { salmon: 1 } };
    const plan = evaluateReturnHome({ position: pond, home: h7.origin, timeOfDay: 11_990 });
    expect(
      shouldAbortActiveWorkForCurfew({
        busy: true,
        lastAction: "fishShore",
        lastTask: "fish_shore",
        home: h7,
        position: pond,
        timeOfDay: 11_990,
      }),
    ).toBe(true);
    expect(
      shouldAbortActiveWorkForCurfew({
        busy: true,
        lastAction: "sleep",
        lastTask: "sleep_at_home",
        home: h7,
        position: pond,
        timeOfDay: 11_990,
      }),
    ).toBe(false);

    atlas.abort.abort();
    const stopped = curfewWorkInterrupted({ plan, durationMs: 50, inventory: { ...atlas.inventory } });
    expect(classifySkill(stopped)).toBe("INTERRUPTED");
    expect(curfewDidNotCompleteWork(stopped.code)).toBe(true);
    expect(stopped.success).toBe(false);
    expect(atlas.inventory).toEqual({ cod: 2 });
    expect(maya.abort.signal.aborted).toBe(false);
    expect(maya.inventory).toEqual({ salmon: 1 });
  });

  it("does not abort WAIT_INSIDE_HOME or GREEN returnHome for this citizen", () => {
    expect(
      shouldAbortActiveWorkForCurfew({
        busy: true,
        lastAction: "waitInsideHome",
        lastTask: "WAIT_INSIDE_HOME",
        home: h7,
        position: { x: -1088.5, y: 68, z: 817.5 },
        timeOfDay: 12_766,
      }),
    ).toBe(false);
    expect(
      shouldAbortActiveWorkForCurfew({
        busy: true,
        lastAction: "returnHome",
        lastTask: "return_home",
        home: h7,
        position: pond,
        timeOfDay: 11_990,
      }),
    ).toBe(false);
  });

  it("plans wait inside when already home before vanilla sleep, then own-bed sleep at night", () => {
    const early = evaluateCitizenCurfew({
      home: h7,
      position: { x: -1088.5, y: 68, z: 817.5 },
      timeOfDay: 12_766,
    });
    const wait = planCurfewBedtimeAction({ curfew: early, timeOfDay: 12_766 });
    expect(early.alreadyInside).toBe(true);
    expect(wait?.action).toBe("waitInsideHome");
    expect(wait?.target).toEqual(h7.bed);

    const night = evaluateCitizenCurfew({
      home: h4,
      position: { x: -1054.5, y: 65, z: 779.5 },
      timeOfDay: 14_000,
      isNight: true,
    });
    const sleep = planCurfewBedtimeAction({ curfew: night, timeOfDay: 14_000 });
    expect(sleep?.action).toBe("sleep");
    expect(sleep?.target).toEqual(h4.bed);
    expect(sleep?.target).not.toEqual(h7.bed);
  });

  it("treats CURFEW_STOP as a handoff to bedtime, not completed work", () => {
    expect(workHandoffToCurfew("CURFEW_STOP")).toBe(true);
    expect(workHandoffToCurfew("ok")).toBe(false);
  });
});
