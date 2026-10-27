import { describe, expect, it } from "vitest";
import { evaluateReturnHome } from "@civ/minecraft-adapter";
import { cancelledThisCitizen, optionalWorkInterrupted } from "./optional-work.js";

describe("curfew does not complete optional work", () => {
  it("reports CURFEW_STOP for a 1/2 fish quota with inventory preserved", () => {
    const plan = evaluateReturnHome({
      position: { x: -1043, y: 63, z: 980 },
      home: { x: -1096, y: 69, z: 730 },
      timeOfDay: 12_000,
    });
    expect(plan.shouldStopOptionalWork).toBe(true);
    const stopped = optionalWorkInterrupted({
      plan,
      durationMs: 12_345,
      inventory: { fishing_rod: 1, cod: 1 },
      extra: { caught: { cod: 1 }, deposited: 1, quotaProgress: "1/2" },
    });
    expect(stopped.success).toBe(false);
    expect(stopped.code).toBe("CURFEW_STOP");
    expect(stopped.durationMs).toBe(12_345);
    expect(stopped.details?.workComplete).toBe(false);
    expect(stopped.details?.inventoryPreserved).toBe(true);
    expect(stopped.details?.inventory).toEqual({ fishing_rod: 1, cod: 1 });
    expect(stopped.details?.quotaProgress).toBe("1/2");
    expect(stopped.details?.caught).toEqual({ cod: 1 });
  });

  it("reports CURFEW_STOP for a 1/2 ore quota, not ok() success", () => {
    const plan = evaluateReturnHome({
      position: { x: -953, y: 58, z: 946 },
      home: { x: -1065, y: 68, z: 847 },
      timeOfDay: 12_100,
    });
    const stopped = optionalWorkInterrupted({
      plan,
      durationMs: 8_000,
      inventory: { stone_pickaxe: 1, coal: 1 },
      extra: { mined: [{ name: "coal_ore", position: { x: -953, y: 58, z: 946 } }], collected: { coal: 1 }, quotaProgress: "1/2" },
    });
    expect(stopped.success).toBe(false);
    expect(stopped.code).toBe("CURFEW_STOP");
    expect(stopped.details?.workComplete).toBe(false);
    expect(stopped.details?.quotaProgress).toBe("1/2");
    expect(stopped.details?.inventory).toEqual({ stone_pickaxe: 1, coal: 1 });
  });

  it("keeps abort isolated to one citizen signal", () => {
    const kai = new AbortController();
    const atlas = new AbortController();
    kai.abort();
    const kaiStop = cancelledThisCitizen({
      durationMs: 40,
      inventory: { oak_log: 8 },
      extra: { citizenId: "citizen_kai" },
    });
    expect(kai.signal.aborted).toBe(true);
    expect(atlas.signal.aborted).toBe(false);
    expect(kaiStop.code).toBe("CANCELLED");
    expect(kaiStop.details?.inventory).toEqual({ oak_log: 8 });
    expect(kaiStop.details?.workComplete).toBe(false);
  });
});
