import { describe, expect, it } from "vitest";
import {
  evaluateTwoFishRodLogs,
  evaluateTwoFishTestLaunch,
  humanBlocksStand,
  occupantConflictsFishingSite,
  parseApprovedTwoFishArea,
} from "./two-fish-test-guard.js";

const flags = {
  MECHANICS_TWO_FISH_TEST_ENABLED: "true",
  TWO_FISH_ALLOW_WORLD_MUTATION: "true",
  TWO_FISH_RED_APPROVED: "true",
  TWO_FISH_BLUE_SHARED: "true",
  TWO_FISH_USER_APPROVED: "true",
};

const pond = {
  TWO_FISH_KAI_ORIGIN: "-1043,63,980",
  TWO_FISH_ATLAS_ORIGIN: "-1044,63,981",
  TWO_FISH_KAI_CHEST: "-1042,63,980",
  TWO_FISH_ATLAS_CHEST: "-1042,63,982",
};

describe("two-fish launch guard", () => {
  it("stays blocked until sharing and approval flags are set", () => {
    const idle = evaluateTwoFishTestLaunch({});
    expect(idle.allowed).toBe(false);
    if (!idle.allowed) expect(idle.error).toMatch(/MECHANICS_TWO_FISH_TEST_ENABLED/);
    expect(evaluateTwoFishTestLaunch({ ...flags, TWO_FISH_BLUE_SHARED: "false" }).allowed).toBe(false);
    expect(evaluateTwoFishTestLaunch({ ...flags, MECHANICS_CURFEW_TEST_ENABLED: "true" }).allowed).toBe(false);
    expect(evaluateTwoFishTestLaunch({ ...flags, TWO_FISH_PORT: "25565" }).allowed).toBe(false);
  });

  it("allows world-lab after RED/BLUE-shared/user approval", () => {
    expect(evaluateTwoFishTestLaunch(flags)).toMatchObject({ allowed: true, port: 25567, rconPort: 25577 });
  });
});

describe("same-pond two-fish area", () => {
  it("accepts adjacent shoreline stands and distinct non-merging chests", () => {
    const area = parseApprovedTwoFishArea(pond);
    expect(area).toMatchObject({
      kai: { origin: { x: -1043, y: 63, z: 980 }, chest: { x: -1042, y: 63, z: 980 } },
      atlas: { origin: { x: -1044, y: 63, z: 981 }, chest: { x: -1042, y: 63, z: 982 } },
      target: 5,
    });
    expect(parseApprovedTwoFishArea({ ...pond, TWO_FISH_TARGET: "2" })).toMatchObject({ target: 2 });
    expect("error" in parseApprovedTwoFishArea({ ...pond, TWO_FISH_TARGET: "3" })).toBe(true);
  });

  it("refuses the same block, a distant second pond, shared/merging chests, and preserves", () => {
    expect("error" in parseApprovedTwoFishArea({ ...pond, TWO_FISH_ATLAS_ORIGIN: "-1043,63,980" })).toBe(true);
    expect("error" in parseApprovedTwoFishArea({ ...pond, TWO_FISH_ATLAS_ORIGIN: "20,68,240" })).toBe(true);
    expect("error" in parseApprovedTwoFishArea({ ...pond, TWO_FISH_ATLAS_CHEST: "-1042,63,980" })).toBe(true);
    expect("error" in parseApprovedTwoFishArea({ ...pond, TWO_FISH_ATLAS_CHEST: "-1042,63,981" })).toBe(true);
    expect("error" in parseApprovedTwoFishArea({ ...pond, TWO_FISH_KAI_CHEST: "-954,58,944" })).toBe(true);
  });

  it("allows HomeProbe outside the fishing AABB and refuses a body standing on a fishing cell", () => {
    const area = parseApprovedTwoFishArea(pond);
    if ("error" in area) throw new Error(area.error);
    expect(occupantConflictsFishingSite({ x: -1082.5, y: 68, z: 799.5 }, area)).toBe(false);
    expect(occupantConflictsFishingSite({ x: -1043.4, y: 63, z: 980.2 }, area)).toBe(true);
    expect(humanBlocksStand({ x: -1034.5, y: 70, z: 984.5 }, area)).toBe(false);
    expect(humanBlocksStand({ x: -1042.8, y: 63.1, z: 980.4 }, area)).toBe(true);
  });
});

describe("two-fish rod log isolation", () => {
  it("passes distinct bobber ids and own-bite reels", () => {
    const verdict = evaluateTwoFishRodLogs(
      [
        "FISH_ROD Kai Kai-1 WAIT_FOR_OWN_BITE bind bobberId=10",
        "FISH_ROD Atlas Atlas-1 WAIT_FOR_OWN_BITE bind bobberId=11",
        "FISH_ROD Kai Kai-1 REEL reel own-particle-bite",
        "FISH_ROD Atlas Atlas-1 REEL reel own-biting-metadata",
      ],
      "Kai",
      "Atlas",
    );
    expect(verdict).toMatchObject({
      ownership: "PASS",
      biteResponse: "PASS",
      kaiBobberIds: [10],
      atlasBobberIds: [11],
      interference: false,
    });
  });

  it("fails when both bots bind the same bobber id", () => {
    const verdict = evaluateTwoFishRodLogs(
      [
        "FISH_ROD Kai Kai-1 WAIT_FOR_OWN_BITE bind bobberId=10",
        "FISH_ROD Atlas Atlas-1 WAIT_FOR_OWN_BITE bind bobberId=10",
        "FISH_ROD Atlas Atlas-1 REEL reel own-particle-bite",
      ],
      "Kai",
      "Atlas",
    );
    expect(verdict.ownership).toBe("FAIL");
    expect(verdict.interference).toBe(true);
    expect(verdict.sharedBobberIds).toEqual([10]);
  });
});
