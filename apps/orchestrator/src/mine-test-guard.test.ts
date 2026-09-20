import { describe, expect, it } from "vitest";
import { evaluateMineTestLaunch, parseApprovedMineArea } from "./mine-test-guard.js";

const flags = {
  MECHANICS_MINE_TEST_ENABLED: "true",
  MINE_TEST_ALLOW_WORLD_MUTATION: "true",
  MINE_TEST_RED_APPROVED: "true",
  MINE_TEST_BLUE_IDLE: "true",
  MINE_TEST_USER_APPROVED: "true",
};

describe("mine test launch guard", () => {
  it("does not connect unless enable, mutation, RED, BLUE idle, and user flags are set", () => {
    const idle = evaluateMineTestLaunch({});
    expect(idle.allowed).toBe(false);
    if (!idle.allowed) expect(idle.error).toMatch(/MECHANICS_MINE_TEST_ENABLED/);

    const noRed = evaluateMineTestLaunch({
      MECHANICS_MINE_TEST_ENABLED: "true",
      MINE_TEST_ALLOW_WORLD_MUTATION: "true",
    });
    expect(noRed.allowed).toBe(false);
    if (!noRed.allowed) expect(noRed.error).toMatch(/MINE_TEST_RED_APPROVED/);
  });

  it("refuses live civ, Mindcraft, and concurrent home/farm harnesses", () => {
    expect(evaluateMineTestLaunch({ ...flags, MINE_TEST_PORT: "25565" }).allowed).toBe(false);
    expect(evaluateMineTestLaunch({ ...flags, MINE_TEST_PORT: "25566" }).allowed).toBe(false);
    expect(evaluateMineTestLaunch({ ...flags, MECHANICS_HOME_TEST_ENABLED: "true" }).allowed).toBe(false);
    expect(evaluateMineTestLaunch({ ...flags, MECHANICS_FISH_TEST_ENABLED: "true" }).allowed).toBe(false);
    expect(evaluateMineTestLaunch({ ...flags, MINE_TEST_VERSION: "1.21.4" }).allowed).toBe(false);
  });

  it("allows isolated 1.21.11 world-lab after all approvals", () => {
    const lab = evaluateMineTestLaunch(flags);
    expect(lab).toMatchObject({ allowed: true, port: 25567, version: "1.21.11", rconPort: 25577 });
  });
});

describe("approved mine area", () => {
  it("refuses to invent origin or chest coordinates", () => {
    const missing = parseApprovedMineArea({});
    expect("error" in missing).toBe(true);
    if ("error" in missing) expect(missing.error).toMatch(/MINE_TEST_ORIGIN/);
  });

  it("refuses Site C, farm pad, and H1 overlap", () => {
    const siteC = parseApprovedMineArea({
      MINE_TEST_ORIGIN: "-1032,64,888",
      MINE_TEST_CHEST: "-1030,64,890",
      MINE_TEST_RADIUS: "16",
    });
    expect("error" in siteC).toBe(true);

    const farm = parseApprovedMineArea({
      MINE_TEST_ORIGIN: "20,68,240",
      MINE_TEST_CHEST: "23,69,238",
      MINE_TEST_RADIUS: "8",
    });
    expect("error" in farm).toBe(true);

    const home = parseApprovedMineArea({
      MINE_TEST_ORIGIN: "-1097,69,728",
      MINE_TEST_CHEST: "-1096,69,729",
      MINE_TEST_RADIUS: "12",
    });
    expect("error" in home).toBe(true);
  });

  it("accepts an explicit bounded area away from preserves", () => {
    const area = parseApprovedMineArea({
      MINE_TEST_ORIGIN: "400,40,400",
      MINE_TEST_CHEST: "402,41,398",
      MINE_TEST_RADIUS: "16",
      MINE_TEST_RESOURCE: "coal",
    });
    expect(area).toMatchObject({
      origin: { x: 400, y: 40, z: 400 },
      chest: { x: 402, y: 41, z: 398 },
      radius: 16,
      resource: "coal",
    });
  });
});
