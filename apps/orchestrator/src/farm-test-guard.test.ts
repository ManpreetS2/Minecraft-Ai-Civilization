import { describe, expect, it } from "vitest";
import { evaluateFarmTestLaunch } from "./farm-test-guard.js";

describe("farm test launch guard", () => {
  it("does not connect unless both enable flags are set", () => {
    const idle = evaluateFarmTestLaunch({});
    expect(idle.allowed).toBe(false);
    if (!idle.allowed) expect(idle.error).toMatch(/MECHANICS_FARM_TEST_ENABLED/);

    const noMutate = evaluateFarmTestLaunch({ MECHANICS_FARM_TEST_ENABLED: "true" });
    expect(noMutate.allowed).toBe(false);
    if (!noMutate.allowed) expect(noMutate.error).toMatch(/FARM_TEST_ALLOW_WORLD_MUTATION/);
  });

  it("refuses live civ and Mindcraft ports even when enabled", () => {
    const live = evaluateFarmTestLaunch({
      MECHANICS_FARM_TEST_ENABLED: "true",
      FARM_TEST_ALLOW_WORLD_MUTATION: "true",
      FARM_TEST_PORT: "25565",
    });
    expect(live.allowed).toBe(false);
    if (!live.allowed) expect(live.error).toMatch(/25565/);

    const mindcraft = evaluateFarmTestLaunch({
      MECHANICS_FARM_TEST_ENABLED: "true",
      FARM_TEST_ALLOW_WORLD_MUTATION: "true",
      FARM_TEST_PORT: "25566",
    });
    expect(mindcraft.allowed).toBe(false);
    if (!mindcraft.allowed) expect(mindcraft.error).toMatch(/25566/);
  });

  it("allows the isolated 1.21.11 lab port", () => {
    const lab = evaluateFarmTestLaunch({
      MECHANICS_FARM_TEST_ENABLED: "true",
      FARM_TEST_ALLOW_WORLD_MUTATION: "true",
    });
    expect(lab).toMatchObject({ allowed: true, port: 25567, version: "1.21.11", rconPort: 25577 });
  });

  it("rejects non-1.21.11 versions", () => {
    const old = evaluateFarmTestLaunch({
      MECHANICS_FARM_TEST_ENABLED: "true",
      FARM_TEST_ALLOW_WORLD_MUTATION: "true",
      FARM_TEST_VERSION: "1.21.4",
    });
    expect(old.allowed).toBe(false);
  });
});
