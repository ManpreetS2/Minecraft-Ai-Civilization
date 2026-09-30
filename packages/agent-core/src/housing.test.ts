import { describe, expect, it } from "vitest";
import {
  applyClaim,
  distance3,
  planHousing,
  type HouseRecord,
  type HousingCitizen,
  type HousingWorld,
} from "./housing.js";

function houses(list: HouseRecord[]): HousingWorld {
  return {
    houses: list,
    distance: distance3,
    persistClaim: () => true,
    claimRadius: 2,
  };
}

const homeless = (over: Partial<HousingCitizen> = {}): HousingCitizen => ({
  id: "citizen_maya",
  position: { x: 0, y: 64, z: 0 },
  connected: true,
  ...over,
});

describe("housing planner edge cases", () => {
  it("chooses among two eligible homes at similar distance without hardcoded H1", () => {
    const world = houses([
      { id: "H2", bed: { x: 10, y: 64, z: 0 }, valid: true, reachable: true },
      { id: "H7", bed: { x: 10.5, y: 64, z: 0 }, valid: true, reachable: true },
    ]);
    const plan = planHousing(homeless(), world);
    expect(plan.action).toBe("travel");
    if (plan.action === "travel") {
      expect(["H2", "H7"]).toContain(plan.houseId);
      expect(plan.houseId).not.toBe("H1");
    }
  });

  it("replans when nearest house becomes claimed while traveling", () => {
    const world = houses([
      { id: "near", bed: { x: 5, y: 64, z: 0 }, valid: true, reachable: true, claimedBy: "citizen_atlas" },
      { id: "far", bed: { x: 20, y: 64, z: 0 }, valid: true, reachable: true },
    ]);
    const plan = planHousing(homeless({ position: { x: 4, y: 64, z: 0 } }), world);
    expect(plan.action).toBe("travel");
    if (plan.action === "travel") expect(plan.houseId).toBe("far");
  });

  it("tries next eligible house when nearest route is blocked", () => {
    const world = houses([
      { id: "blocked", bed: { x: 5, y: 64, z: 0 }, valid: true, reachable: false },
      { id: "open", bed: { x: 12, y: 64, z: 0 }, valid: true, reachable: true },
    ]);
    const plan = planHousing(homeless(), world);
    expect(plan.action).toBe("travel");
    if (plan.action === "travel") expect(plan.houseId).toBe("open");
  });

  it("reports when all houses unreachable or catalog empty", () => {
    const unreachable = planHousing(
      homeless(),
      houses([
        { id: "a", bed: { x: 5, y: 64, z: 0 }, valid: true, reachable: false },
        { id: "b", bed: { x: 8, y: 64, z: 0 }, valid: true, reachable: false },
      ]),
    );
    expect(unreachable.action).toBe("wait_unreachable");

    const empty = planHousing(homeless(), houses([]));
    expect(empty.action).toBe("abort");
    if (empty.action === "abort") expect(empty.code).toBe("NO_HOUSING");
  });

  it("short-circuits when citizen becomes housed mid-plan", () => {
    const world = houses([{ id: "home", bed: { x: 5, y: 64, z: 0 }, valid: true, claimedBy: "citizen_maya", reachable: true }]);
    const plan = planHousing(homeless({ homeId: "home" }), world);
    expect(plan.action).toBe("already_housed");
  });

  it("aborts on disconnect during housing travel", () => {
    const plan = planHousing(
      homeless({ connected: false }),
      houses([{ id: "h", bed: { x: 5, y: 64, z: 0 }, valid: true, reachable: true }]),
    );
    expect(plan.action).toBe("abort");
    if (plan.action === "abort") expect(plan.code).toBe("NOT_CONNECTED");
  });

  it("notes night while far from housing when routes blocked", () => {
    const world = {
      ...houses([{ id: "h", bed: { x: 50, y: 64, z: 0 }, valid: true, reachable: false }]),
      isNight: true,
    };
    const plan = planHousing(homeless(), world);
    expect(plan.action).toBe("wait_unreachable");
    if (plan.action === "wait_unreachable") expect(plan.reason).toMatch(/night/i);
  });

  it("fails when inside claim range but persistence fails", () => {
    const world: HousingWorld = {
      houses: [{ id: "h", bed: { x: 1, y: 64, z: 0 }, valid: true, reachable: true }],
      distance: distance3,
      persistClaim: () => false,
      claimRadius: 2,
    };
    const plan = planHousing(homeless({ position: { x: 0, y: 64, z: 0 } }), world);
    expect(plan.action).toBe("abort");
    if (plan.action === "abort") expect(plan.code).toBe("CLAIM_FAILED");
  });

  it("detects destroyed claimed bed / invalid home", () => {
    const destroyed = planHousing(homeless({ homeId: "gone" }), houses([]));
    expect(destroyed.action).toBe("abort");
    if (destroyed.action === "abort") expect(destroyed.code).toBe("INVALID_HOME");

    const invalid = planHousing(
      homeless({ homeId: "h" }),
      houses([{ id: "h", bed: { x: 1, y: 64, z: 0 }, valid: false, claimedBy: "citizen_maya" }]),
    );
    expect(invalid.action).toBe("abort");
    if (invalid.action === "abort") expect(invalid.code).toBe("INVALID_HOME");
  });

  it("applyClaim assigns without hardcoded H1", () => {
    const next = applyClaim(
      [
        { id: "H3", bed: { x: 1, y: 64, z: 0 }, valid: true },
        { id: "H4", bed: { x: 2, y: 64, z: 0 }, valid: true },
      ],
      "citizen_theo",
      "H4",
    );
    expect(next.find((h) => h.id === "H4")?.claimedBy).toBe("citizen_theo");
    expect(next.find((h) => h.id === "H3")?.claimedBy).toBeUndefined();
  });
});
