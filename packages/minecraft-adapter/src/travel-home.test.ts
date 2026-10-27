import { describe, expect, it } from "vitest";
import { estimateTravelMs, evaluateReturnHome, evaluateLateDayBedtime, msUntilBedtime, msUntilVanillaSleep, vanillaMorning, vanillaNightWindowEnded, vanillaSleepTimeValid, STALL_RECOVERY_BUFFER_MS, curfewWorkInterrupted } from "./travel-home.js";

describe("return-home travel estimate", () => {
  it("includes stall recovery time in the walk estimate", () => {
    const estimate = estimateTravelMs(10, { expectedRecoveries: 1 });
    expect(estimate).toBeGreaterThan(10 * 300);
    expect(estimate).toBeGreaterThanOrEqual(STALL_RECOVERY_BUFFER_MS);
  });

  it("stops optional work when the bedtime window is shorter than travel plus recovery", () => {
    const plan = evaluateReturnHome({
      position: { x: 0, y: 12, z: 0 },
      home: { x: 80, y: 64, z: 0 },
      timeOfDay: 12_400,
    });
    expect(plan.shouldStopOptionalWork).toBe(true);
    expect(plan.delayMs).toBeGreaterThan(0);
    expect(plan.reason).toMatch(/bedtime|recovery/);
  });

  it("reports delay from the actual position when the route is impassable", () => {
    const plan = evaluateReturnHome({
      position: { x: 10, y: -20, z: 10 },
      home: { x: -1096, y: 69, z: 732 },
      timeOfDay: 1_000,
      routeImpassable: true,
    });
    expect(plan.shouldStopOptionalWork).toBe(true);
    expect(plan.delayMs).toBe(plan.estimateMs);
    expect(plan.reason).toMatch(/impassable/);
    expect(msUntilBedtime(1_000)).toBeGreaterThan(10_000);
  });

  it("does not treat an early-day H1 walk as a complete bedtime/sleep test", () => {
    const early = evaluateLateDayBedtime({
      position: { x: -1095.5, y: 69, z: 731.5 },
      home: { x: -1096, y: 69, z: 730 },
      bed: { x: -1097, y: 69, z: 728 },
      timeOfDay: 1_000,
      arrivedAtHome: true,
      sleptInOwnBed: false,
    });
    expect(early.complete).toBe(false);
    expect(early.lateDayDeparture).toBe(false);
    expect(early.reason).toMatch(/not a complete bedtime/);
  });

  it("requires late-day departure, actual arrival, and own-bed night sleep", () => {
    const work = { x: -1082.5, y: 68, z: 799.5 };
    const home = { x: -1096, y: 69, z: 730 };
    const bed = { x: -1097, y: 69, z: 728 };
    const leaving = evaluateLateDayBedtime({
      position: work,
      home,
      bed,
      timeOfDay: 12_000,
    });
    expect(leaving.lateDayDeparture).toBe(true);
    expect(leaving.complete).toBe(false);
    expect(leaving.returnHome.shouldStopOptionalWork).toBe(true);
    expect(leaving.reason).toMatch(/actual home arrival/);

    const arrived = evaluateLateDayBedtime({
      position: { x: home.x + 0.5, y: home.y, z: home.z + 0.5 },
      home,
      bed,
      timeOfDay: 13_100,
      arrivedAtHome: true,
    });
    expect(arrived.homeArrival).toBe(true);
    expect(arrived.sleepTimeValid).toBe(true);
    expect(arrived.complete).toBe(false);
    expect(arrived.reason).toMatch(/own-bed sleep/);

    const slept = evaluateLateDayBedtime({
      position: { x: home.x + 0.5, y: home.y, z: home.z + 0.5 },
      home,
      bed,
      timeOfDay: 13_100,
      arrivedAtHome: true,
      sleptInOwnBed: true,
    });
    expect(slept.complete).toBe(true);
  });

  it("reports curfew interrupt as incomplete work without dropping inventory", () => {
    const plan = evaluateReturnHome({
      position: { x: -1043, y: 63, z: 980 },
      home: { x: -1089, y: 68, z: 817 },
      timeOfDay: 11_990,
    });
    const inventory = { cod: 2, fishing_rod: 1 };
    const stopped = curfewWorkInterrupted({ plan, durationMs: 4_000, inventory });
    expect(stopped.success).toBe(false);
    expect(stopped.code).toBe("CURFEW_STOP");
    expect(stopped.details?.workComplete).toBe(false);
    expect(stopped.details?.inventoryPreserved).toBe(true);
    expect(stopped.details?.inventory).toEqual(inventory);
  });

  it("does not treat a stop-work ETA as a guaranteed safe path", () => {
    const plan = evaluateReturnHome({
      position: { x: -1043, y: 63, z: 980 },
      home: { x: -1089, y: 68, z: 817 },
      timeOfDay: 11_990,
    });
    expect(plan.shouldStopOptionalWork).toBe(true);
    expect(plan.routeGuaranteed).toBe(false);
    expect(plan.etaKind).toBe("straight_line_plus_recovery_buffer");
  });

  it("keeps impassable routes honest instead of inventing a teleport", () => {
    const plan = evaluateReturnHome({
      position: { x: 10, y: -20, z: 10 },
      home: { x: -1096, y: 69, z: 732 },
      timeOfDay: 1_000,
      routeImpassable: true,
    });
    expect(plan.routeGuaranteed).toBe(false);
    expect(plan.reason).toMatch(/do not teleport/);
  });

  it("treats sunset as travel time and 13000 as vanilla sleep", () => {
    expect(vanillaSleepTimeValid(12_766)).toBe(false);
    expect(vanillaSleepTimeValid(13_000)).toBe(true);
    expect(vanillaSleepTimeValid(22_999)).toBe(true);
    expect(vanillaSleepTimeValid(23_000)).toBe(false);
    expect(vanillaSleepTimeValid(1_000, true)).toBe(true);
    expect(vanillaMorning(23_100)).toBe(true);
    expect(vanillaNightWindowEnded(12_766, 23_100)).toBe(true);
    expect(msUntilVanillaSleep(12_766)).toBe((13_000 - 12_766) * 50);
  });
});
