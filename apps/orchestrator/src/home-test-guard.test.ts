import { describe, expect, it } from "vitest";
import { evaluateHomeTestLaunch, parseApprovedHomeFixtures } from "./home-test-guard.js";

describe("home test launch guard", () => {
  it("does not connect unless enable, mutation, and RED approval flags are set", () => {
    const idle = evaluateHomeTestLaunch({});
    expect(idle.allowed).toBe(false);
    if (!idle.allowed) expect(idle.error).toMatch(/MECHANICS_HOME_TEST_ENABLED/);

    const noMutate = evaluateHomeTestLaunch({ MECHANICS_HOME_TEST_ENABLED: "true" });
    expect(noMutate.allowed).toBe(false);
    if (!noMutate.allowed) expect(noMutate.error).toMatch(/HOME_TEST_ALLOW_WORLD_MUTATION/);

    const noRed = evaluateHomeTestLaunch({
      MECHANICS_HOME_TEST_ENABLED: "true",
      HOME_TEST_ALLOW_WORLD_MUTATION: "true",
    });
    expect(noRed.allowed).toBe(false);
    if (!noRed.allowed) expect(noRed.error).toMatch(/HOME_TEST_RED_APPROVED/);
  });

  it("refuses live civ and Mindcraft ports even when approved", () => {
    const flags = {
      MECHANICS_HOME_TEST_ENABLED: "true",
      HOME_TEST_ALLOW_WORLD_MUTATION: "true",
      HOME_TEST_RED_APPROVED: "true",
    };
    const live = evaluateHomeTestLaunch({ ...flags, HOME_TEST_PORT: "25565" });
    expect(live.allowed).toBe(false);
    const mindcraft = evaluateHomeTestLaunch({ ...flags, HOME_TEST_PORT: "25566" });
    expect(mindcraft.allowed).toBe(false);
  });

  it("allows the isolated 1.21.11 lab port after RED approval", () => {
    const lab = evaluateHomeTestLaunch({
      MECHANICS_HOME_TEST_ENABLED: "true",
      HOME_TEST_ALLOW_WORLD_MUTATION: "true",
      HOME_TEST_RED_APPROVED: "true",
    });
    expect(lab).toMatchObject({ allowed: true, port: 25567, version: "1.21.11", rconPort: 25577 });
  });

  it("refuses to invent chest or bed coordinates", () => {
    const missing = parseApprovedHomeFixtures({ HOME_TEST_HOME_ID: "home_h7" });
    expect("error" in missing).toBe(true);
    if ("error" in missing) expect(missing.error).toMatch(/HOME_TEST_ORIGIN/);
  });

  it("loads the RED H1 probe fixture only when that profile is named", () => {
    const profile = parseApprovedHomeFixtures({ HOME_TEST_PROFILE: "H1_PROBE" });
    expect(profile).toMatchObject({
      homeId: "home_h1",
      bedA: { x: -1097, y: 69, z: 728 },
      chestA: { x: -1096, y: 69, z: 729 },
      distractorBed: { x: -1055, y: 65, z: 779 },
      communalChest: { x: -1038, y: 65, z: 839 },
    });
  });
});
