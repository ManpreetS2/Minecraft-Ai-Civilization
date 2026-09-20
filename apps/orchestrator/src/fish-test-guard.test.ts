import { describe, expect, it } from "vitest";
import { evaluateFishTestLaunch, parseApprovedFishArea } from "./fish-test-guard.js";

const flags = {
  MECHANICS_FISH_TEST_ENABLED: "true",
  FISH_TEST_ALLOW_WORLD_MUTATION: "true",
  FISH_TEST_RED_APPROVED: "true",
  FISH_TEST_BLUE_IDLE: "true",
  FISH_TEST_USER_APPROVED: "true",
};

describe("fish test launch guard", () => {
  it("does not connect unless enable, mutation, RED, BLUE idle, and user flags are set", () => {
    const idle = evaluateFishTestLaunch({});
    expect(idle.allowed).toBe(false);
    if (!idle.allowed) expect(idle.error).toMatch(/MECHANICS_FISH_TEST_ENABLED/);

    const noRed = evaluateFishTestLaunch({
      MECHANICS_FISH_TEST_ENABLED: "true",
      FISH_TEST_ALLOW_WORLD_MUTATION: "true",
    });
    expect(noRed.allowed).toBe(false);
    if (!noRed.allowed) expect(noRed.error).toMatch(/FISH_TEST_RED_APPROVED/);
  });

  it("refuses live civ, Mindcraft, and concurrent harnesses", () => {
    expect(evaluateFishTestLaunch({ ...flags, FISH_TEST_PORT: "25565" }).allowed).toBe(false);
    expect(evaluateFishTestLaunch({ ...flags, FISH_TEST_PORT: "25566" }).allowed).toBe(false);
    expect(evaluateFishTestLaunch({ ...flags, MECHANICS_HOME_TEST_ENABLED: "true" }).allowed).toBe(false);
    expect(evaluateFishTestLaunch({ ...flags, MECHANICS_MINE_TEST_ENABLED: "true" }).allowed).toBe(false);
    expect(evaluateFishTestLaunch({ ...flags, FISH_TEST_VERSION: "1.21.4" }).allowed).toBe(false);
  });

  it("allows isolated 1.21.11 world-lab after all approvals", () => {
    const lab = evaluateFishTestLaunch(flags);
    expect(lab).toMatchObject({ allowed: true, port: 25567, version: "1.21.11", rconPort: 25577 });
  });
});

describe("approved fish area", () => {
  it("refuses to invent origin or chest coordinates", () => {
    const missing = parseApprovedFishArea({});
    expect("error" in missing).toBe(true);
    if ("error" in missing) expect(missing.error).toMatch(/FISH_TEST_ORIGIN/);
  });

  it("refuses Site C, farm pad, H1, coal pocket, and protected chests", () => {
    expect(
      "error" in
        parseApprovedFishArea({
          FISH_TEST_ORIGIN: "-1032,64,888",
          FISH_TEST_CHEST: "-1030,64,890",
        }),
    ).toBe(true);
    expect(
      "error" in
        parseApprovedFishArea({
          FISH_TEST_ORIGIN: "20,68,240",
          FISH_TEST_CHEST: "23,69,238",
        }),
    ).toBe(true);
    expect(
      "error" in
        parseApprovedFishArea({
          FISH_TEST_ORIGIN: "-1097,69,728",
          FISH_TEST_CHEST: "-1090,69,720",
        }),
    ).toBe(true);
    expect(
      "error" in
        parseApprovedFishArea({
          FISH_TEST_ORIGIN: "-953,58,945",
          FISH_TEST_CHEST: "-900,64,900",
        }),
    ).toBe(true);
    expect(
      "error" in
        parseApprovedFishArea({
          FISH_TEST_ORIGIN: "400,64,400",
          FISH_TEST_CHEST: "-954,58,944",
        }),
    ).toBe(true);
  });

  it("accepts an explicit shore away from preserves and requires home only when returning", () => {
    const area = parseApprovedFishArea({
      FISH_TEST_ORIGIN: "400,63,400",
      FISH_TEST_CHEST: "402,64,398",
      FISH_TEST_RADIUS: "8",
      FISH_TEST_CASTS: "1",
      FISH_TEST_TIMEOUT_MS: "60000",
    });
    expect(area).toMatchObject({
      origin: { x: 400, y: 63, z: 400 },
      chest: { x: 402, y: 64, z: 398 },
      radius: 8,
      casts: 1,
      timeoutMs: 60_000,
      returnHome: false,
      verifyCancel: true,
    });

    const missingHome = parseApprovedFishArea({
      FISH_TEST_ORIGIN: "400,63,400",
      FISH_TEST_CHEST: "402,64,398",
      FISH_TEST_RETURN_HOME: "true",
    });
    expect("error" in missingHome).toBe(true);

    const withHome = parseApprovedFishArea({
      FISH_TEST_ORIGIN: "400,63,400",
      FISH_TEST_CHEST: "402,64,398",
      FISH_TEST_RETURN_HOME: "true",
      FISH_TEST_HOME: "-1097,69,728",
    });
    expect(withHome).toMatchObject({
      returnHome: true,
      home: { x: -1097, y: 69, z: 728 },
    });
  });
});
