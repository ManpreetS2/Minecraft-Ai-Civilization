import { describe, expect, it } from "vitest";
import {
  classifyFluid,
  detectInWater,
  detectSubmerged,
  findShoreCandidates,
  isLavaBlock,
  isWaterBlock,
  MAX_SWIM_STEPS,
  planWaterSafety,
  WaterRecoverySession,
  type BodyWaterState,
  type WaterCell,
} from "./water-safety.js";

function cell(over: Partial<WaterCell> & Pick<WaterCell, "position">): WaterCell {
  return {
    blockName: "air",
    isWater: false,
    isLava: false,
    isSolidStand: false,
    waterDepth: 0,
    ...over,
  };
}

function state(over: Partial<BodyWaterState> & Pick<BodyWaterState, "position" | "feet">): BodyWaterState {
  return {
    connected: true,
    cancelled: false,
    air: 20,
    ...over,
  };
}

const shore = [{ position: { x: 2, y: 64, z: 0 }, distance: 2, reachableEstimate: true }];

describe("water safety state machine", () => {
  it("land → shallow water → land", () => {
    const session = new WaterRecoverySession();
    const land = session.step(
      state({ position: { x: 0, y: 64, z: 0 }, feet: cell({ position: { x: 0, y: 64, z: 0 }, blockName: "grass_block", isSolidStand: true }) }),
      shore,
    );
    expect(land.action).toBe("none");
    const shallow = session.step(
      state({
        position: { x: 1, y: 64, z: 0 },
        feet: cell({ position: { x: 1, y: 64, z: 0 }, blockName: "water", isWater: true, waterDepth: 1 }),
      }),
      shore,
    );
    expect(shallow.action).toBe("none");
    const back = session.step(
      state({ position: { x: 2, y: 64, z: 0 }, feet: cell({ position: { x: 2, y: 64, z: 0 }, blockName: "grass_block", isSolidStand: true }) }),
      shore,
    );
    expect(back.inWater).toBe(false);
    expect(session.phase).toBe("recovered");
  });

  it("land → deep water → submerged → shore", () => {
    const session = new WaterRecoverySession();
    const deep = session.step(
      state({
        position: { x: 0, y: 62, z: 0 },
        feet: cell({ position: { x: 0, y: 62, z: 0 }, blockName: "water", isWater: true, waterDepth: 4 }),
        head: cell({ position: { x: 0, y: 63, z: 0 }, blockName: "water", isWater: true, waterDepth: 3 }),
      }),
      shore,
    );
    expect(deep.action).toBe("swim_to_shore");
    if (deep.action === "swim_to_shore") {
      expect(deep.teleported).toBe(false);
      expect(deep.fabricatedArrival).toBe(false);
      expect(deep.interruptWork).toBe(true);
    }
  });

  it("submerged low air with/without shore", () => {
    const ok = planWaterSafety(
      state({
        position: { x: 0, y: 60, z: 0 },
        air: 4,
        feet: cell({ position: { x: 0, y: 60, z: 0 }, blockName: "water", isWater: true, waterDepth: 3 }),
        head: cell({ position: { x: 0, y: 61, z: 0 }, blockName: "water", isWater: true, waterDepth: 2 }),
      }),
      [
        { position: { x: 5, y: 64, z: 0 }, distance: 5, reachableEstimate: true },
        { position: { x: 2, y: 64, z: 0 }, distance: 2, reachableEstimate: true },
      ],
    );
    expect(ok.action).toBe("swim_to_shore");
    if (ok.action === "swim_to_shore") expect(ok.target).toEqual({ x: 2, y: 64, z: 0 });

    const none = planWaterSafety(
      state({
        position: { x: 0, y: 60, z: 0 },
        air: 3,
        feet: cell({ position: { x: 0, y: 60, z: 0 }, blockName: "water", isWater: true, waterDepth: 5 }),
        head: cell({ position: { x: 0, y: 61, z: 0 }, blockName: "water", isWater: true, waterDepth: 4 }),
      }),
      [{ position: { x: 10, y: 64, z: 0 }, distance: 10, reachableEstimate: false }],
    );
    expect(none.action).toBe("abort");
    if (none.action === "abort") expect(none.code).toBe("NO_SHORE");
  });

  it("no progress from current / shore becomes blocked / max steps", () => {
    const session = new WaterRecoverySession();
    const submerged = state({
      position: { x: 0, y: 60, z: 0 },
      feet: cell({ position: { x: 0, y: 60, z: 0 }, blockName: "water", isWater: true, waterDepth: 3 }),
      head: cell({ position: { x: 0, y: 61, z: 0 }, blockName: "water", isWater: true, waterDepth: 2 }),
    });
    for (let i = 0; i < 5; i += 1) session.step(submerged, shore);
    expect(session.lastDecision?.action).toBe("abort");
    if (session.lastDecision?.action === "abort") expect(session.lastDecision.code).toBe("NO_PROGRESS");

    const blocked = planWaterSafety(submerged, [{ ...shore[0]!, blocked: true, reachableEstimate: true }]);
    expect(blocked.action).toBe("abort");

    const max = new WaterRecoverySession();
    max.steps = MAX_SWIM_STEPS;
    const over = max.step(submerged, shore);
    expect(over.action).toBe("abort");
    if (over.action === "abort") expect(over.code).toBe("MAX_STEPS");
  });

  it("disconnect / abort / exit before recovery / prefer land / fishing / lava / bubble column", () => {
    expect(
      planWaterSafety(
        state({
          position: { x: 0, y: 64, z: 0 },
          connected: false,
          feet: cell({ position: { x: 0, y: 64, z: 0 }, blockName: "air" }),
        }),
        [],
      ).action,
    ).toBe("abort");

    expect(
      planWaterSafety(
        state({
          position: { x: 0, y: 64, z: 0 },
          cancelled: true,
          feet: cell({ position: { x: 0, y: 64, z: 0 }, blockName: "water", isWater: true, waterDepth: 2 }),
        }),
        shore,
      ),
    ).toMatchObject({ action: "abort", code: "CANCELLED" });

    const session = new WaterRecoverySession();
    session.phase = "escaping";
    const exited = session.step(
      state({
        position: { x: 2, y: 64, z: 0 },
        feet: cell({ position: { x: 2, y: 64, z: 0 }, blockName: "grass_block", isSolidStand: true }),
      }),
      shore,
    );
    expect(exited.action).toBe("none");
    expect(session.phase).toBe("recovered");

    expect(
      planWaterSafety(
        state({
          position: { x: 0, y: 64, z: 0 },
          feet: cell({ position: { x: 0, y: 64, z: 0 }, blockName: "grass_block", isSolidStand: true }),
        }),
        shore,
        { landRouteAvailable: true, waterRouteShorter: true },
      ).action,
    ).toBe("avoid_deep_water");

    expect(
      planWaterSafety(
        state({
          position: { x: 0, y: 64, z: 0 },
          fishingActivity: true,
          feet: cell({ position: { x: 0, y: 64, z: 0 }, blockName: "water", isWater: true, waterDepth: 1 }),
        }),
        shore,
      ).reason,
    ).toMatch(/fishing/i);

    expect(isLavaBlock("lava")).toBe(true);
    expect(isWaterBlock("water")).toBe(true);
    expect(classifyFluid("bubble_column")).toBe("water");
    const lava = planWaterSafety(
      state({
        position: { x: 0, y: 64, z: 0 },
        feet: cell({ position: { x: 0, y: 64, z: 0 }, blockName: "lava", isLava: true }),
      }),
      shore,
    );
    expect(lava.action).toBe("abort");

    const bubble = planWaterSafety(
      state({
        position: { x: 0, y: 60, z: 0 },
        air: 4,
        feet: cell({
          position: { x: 0, y: 60, z: 0 },
          blockName: "bubble_column",
          isWater: true,
          waterDepth: 3,
          unusual: true,
        }),
        head: cell({
          position: { x: 0, y: 61, z: 0 },
          blockName: "water",
          isWater: true,
          waterDepth: 2,
          unusual: true,
        }),
      }),
      shore,
    );
    expect(bubble.action).toBe("swim_to_shore");
  });

  it("finds shore candidates and detects submerged", () => {
    const origin = { x: 0, y: 63, z: 0 };
    const shores = findShoreCandidates(
      origin,
      (pos) => {
        if (pos.x === 2 && pos.y === 64 && pos.z === 0) {
          return cell({ position: pos, blockName: "grass_block", isSolidStand: true });
        }
        if (pos.y < 64) return cell({ position: pos, blockName: "water", isWater: true, waterDepth: 2 });
        return cell({ position: pos, blockName: "air" });
      },
      4,
    );
    expect(shores[0]?.position).toEqual({ x: 2, y: 64, z: 0 });
    const s = state({
      position: { x: 0, y: 60, z: 0 },
      feet: cell({ position: { x: 0, y: 60, z: 0 }, blockName: "water", isWater: true, waterDepth: 3 }),
      head: cell({ position: { x: 0, y: 61, z: 0 }, blockName: "water", isWater: true, waterDepth: 2 }),
    });
    expect(detectInWater(s)).toBe(true);
    expect(detectSubmerged(s)).toBe(true);
  });
});
