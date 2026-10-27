import { describe, expect, it } from "vitest";
import {
  CONSTRUCTION_EXPERIMENT_ENV_PINS,
  H9_ORIGIN,
  ISOLATED_PAPER_PORT,
  MISSION_006B_STAGE1_AUTH_PHRASE,
  ORIGINAL_PAPER_PORT,
  PROPOSED_CONSTRUCTION_PAD,
  assertIsolatedNotOriginal,
  evaluateConstructionExperimentLive,
  evaluateMission006BStage1Live,
  hasMission006BStage1Authorization,
  padSafeFromSettlementHomes,
  pathsAliasSameTree,
} from "./construction-experiment-guard.js";

describe("construction experiment guard", () => {
  it("pins AUTO_START_PAPER false", () => {
    expect(CONSTRUCTION_EXPERIMENT_ENV_PINS.AUTO_START_PAPER).toBe("false");
  });

  it("uses isolated ports distinct from original World-Lab", () => {
    expect(ISOLATED_PAPER_PORT).not.toBe(ORIGINAL_PAPER_PORT);
    expect(ISOLATED_PAPER_PORT).toBe(25568);
  });

  it("proposed pad is far from H9", () => {
    const safe = padSafeFromSettlementHomes(PROPOSED_CONSTRUCTION_PAD);
    expect(safe.ok).toBe(true);
    const nearH9 = padSafeFromSettlementHomes({ x: H9_ORIGIN.x + 5, y: 68, z: H9_ORIGIN.z });
    expect(nearH9.ok).toBe(false);
  });

  it("detects path aliasing", () => {
    expect(pathsAliasSameTree("C:\\a\\world-lab", "C:\\a\\world-lab\\world")).toBe(true);
    expect(pathsAliasSameTree("C:\\a\\experiments\\x", "C:\\a\\world-lab")).toBe(false);
  });

  it("denies live by default", () => {
    const gate = evaluateConstructionExperimentLive({
      ...process.env,
      CONSTRUCTION_EXPERIMENT_ENABLED: undefined,
      CONSTRUCTION_EXPERIMENT_ALLOW_LIVE: undefined,
      CONSTRUCTION_EXPERIMENT_ALLOW_WORLD_MUTATION: undefined,
      AUTO_START_PAPER: "false",
    });
    expect(gate.allowed).toBe(false);
  });

  it("denies live against original paper port even with approvals", () => {
    const gate = evaluateConstructionExperimentLive({
      CONSTRUCTION_EXPERIMENT_ENABLED: "true",
      CONSTRUCTION_EXPERIMENT_ALLOW_LIVE: "true",
      CONSTRUCTION_EXPERIMENT_ALLOW_WORLD_MUTATION: "true",
      AUTO_START_PAPER: "false",
      MINECRAFT_PORT: String(ORIGINAL_PAPER_PORT),
      DATABASE_PATH: "./experiments/construction-006a/world-lab-civilization.sqlite",
      CONSTRUCTION_EXPERIMENT_WORLD_LAB: "./experiments/construction-006a/world-lab-isolated",
    });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.error).toMatch(/port/i);
  });

  it("assertIsolatedNotOriginal rejects original paths", () => {
    const bad = assertIsolatedNotOriginal({
      isolatedWorldLab: "world-lab",
      isolatedSqlite: "./data/world-lab-civilization.sqlite",
    });
    expect(bad.ok).toBe(false);
  });

  it("Mission 006B Stage 1 requires exact auth phrase", () => {
    expect(hasMission006BStage1Authorization({})).toBe(false);
    expect(
      hasMission006BStage1Authorization({
        CONSTRUCTION_006B_STAGE1_AUTH: "sure go ahead",
      }),
    ).toBe(false);
    expect(
      hasMission006BStage1Authorization({
        CONSTRUCTION_006B_STAGE1_AUTH: MISSION_006B_STAGE1_AUTH_PHRASE,
      }),
    ).toBe(true);
  });

  it("hard-stops stages 2–4 even with Stage 1 auth phrase", () => {
    const env = {
      CONSTRUCTION_006B_STAGE1_AUTH: MISSION_006B_STAGE1_AUTH_PHRASE,
      CONSTRUCTION_EXPERIMENT_ENABLED: "true",
      CONSTRUCTION_EXPERIMENT_ALLOW_LIVE: "true",
      CONSTRUCTION_EXPERIMENT_ALLOW_WORLD_MUTATION: "true",
      AUTO_START_PAPER: "false",
      MINECRAFT_PORT: String(ISOLATED_PAPER_PORT),
    };
    expect(evaluateMission006BStage1Live(env, "stage2_wall").allowed).toBe(false);
    expect(evaluateMission006BStage1Live(env, "stage3_door").allowed).toBe(false);
    expect(evaluateMission006BStage1Live(env, "stage4_cabin").allowed).toBe(false);
  });
});
