import { describe, expect, it } from "vitest";
import { DEFAULT_CITIZENS, loadConfig, resolveFromRoot } from "@civ/shared";
import { HOME_CLAIM_REACH_BLOCKS } from "@civ/agent-core";
import {
  applyWorldLabOneCitizenEnv,
  catalogClaimDistances,
  evaluateWorldLabOneCitizenLaunch,
  EXPECTED_ONE_CITIZEN,
  isLiveCivilizationDatabasePath,
  isWorldLabDatabasePath,
  LIVE_CIVILIZATION_DATABASE_RELATIVE,
  mergeDotenvWithoutOverride,
  PROPOSED_H9_STREET_STAND,
  selectActiveRosterCitizens,
  WORLD_LAB_DATABASE_RELATIVE,
  WORLD_LAB_ONE_CITIZEN_ENV,
  WORLD_LAB_WORLD_SPAWN,
} from "./world-lab-one-citizen-guard.js";

const liveCivEnv = {
  MINECRAFT_HOST: "127.0.0.1",
  MINECRAFT_PORT: "25565",
  DATABASE_PATH: "./data/civilization.sqlite",
  SIM_CITIZEN_COUNT: "5",
  AUTO_START_PAPER: "true",
};

describe("dotenv vs shell vs .env", () => {
  it("does not let .env overwrite a pre-set shell variable", () => {
    const merged = mergeDotenvWithoutOverride({ MINECRAFT_PORT: "25567" }, liveCivEnv);
    expect(merged.MINECRAFT_PORT).toBe("25567");
    expect(merged.DATABASE_PATH).toBe("./data/civilization.sqlite");
  });

  it("fills from .env when the process env does not already have the key", () => {
    const merged = mergeDotenvWithoutOverride({}, liveCivEnv);
    expect(merged.MINECRAFT_PORT).toBe("25565");
    expect(merged.SIM_CITIZEN_COUNT).toBe("5");
    expect(loadConfig(merged).AUTO_START_PAPER).toBe(true);
  });
});

describe("roster selection", () => {
  it("SIM_CITIZEN_COUNT=1 selects Atlas via DEFAULT_CITIZENS.slice(0, 1), not Maya", () => {
    expect(DEFAULT_CITIZENS.map((row) => row.name)).toEqual(["Atlas", "Maya", "Theo", "Ava", "Kai"]);
    expect(selectActiveRosterCitizens(1)).toEqual([{ name: "Atlas", id: "citizen_atlas" }]);
    expect(EXPECTED_ONE_CITIZEN).toEqual({ name: "Atlas", id: "citizen_atlas" });
    expect(selectActiveRosterCitizens(1)[0]?.name).not.toBe("Maya");
    expect(selectActiveRosterCitizens(5).map((row) => row.name)).toEqual(["Atlas", "Maya", "Theo", "Ava", "Kai"]);
  });
});

describe("world-lab one-citizen launch guard", () => {
  it("refuses the current live-civ .env values", () => {
    const decision = evaluateWorldLabOneCitizenLaunch(liveCivEnv);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.error).toMatch(/25565|AUTO_START_PAPER|SIM_CITIZEN_COUNT/);
  });

  it("refuses port 25565 even when the lab database and count=1 are set", () => {
    const decision = evaluateWorldLabOneCitizenLaunch({
      ...WORLD_LAB_ONE_CITIZEN_ENV,
      MINECRAFT_PORT: "25565",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.error).toMatch(/25565/);
  });

  it("refuses live-civ sqlite, count!=1, AUTO_START_PAPER, and work roles", () => {
    expect(evaluateWorldLabOneCitizenLaunch({ ...WORLD_LAB_ONE_CITIZEN_ENV, DATABASE_PATH: LIVE_CIVILIZATION_DATABASE_RELATIVE }).allowed).toBe(false);
    expect(evaluateWorldLabOneCitizenLaunch({ ...WORLD_LAB_ONE_CITIZEN_ENV, SIM_CITIZEN_COUNT: "5" }).allowed).toBe(false);
    expect(evaluateWorldLabOneCitizenLaunch({ ...WORLD_LAB_ONE_CITIZEN_ENV, SIM_CITIZEN_COUNT: "2" }).allowed).toBe(false);
    expect(evaluateWorldLabOneCitizenLaunch({ ...WORLD_LAB_ONE_CITIZEN_ENV, AUTO_START_PAPER: "true" }).allowed).toBe(false);
    expect(evaluateWorldLabOneCitizenLaunch({ ...WORLD_LAB_ONE_CITIZEN_ENV, SIM_ASSIGN_WORK_ROLES: "true" }).allowed).toBe(false);
    expect(evaluateWorldLabOneCitizenLaunch({ ...WORLD_LAB_ONE_CITIZEN_ENV, MINECRAFT_PORT: "25566" }).allowed).toBe(false);
  });

  it("allows isolated WORLD-LAB values and names Atlas as the one body", () => {
    const decision = evaluateWorldLabOneCitizenLaunch(WORLD_LAB_ONE_CITIZEN_ENV);
    expect(decision).toMatchObject({
      allowed: true,
      citizen: { name: "Atlas", id: "citizen_atlas" },
      rconPort: 25577,
    });
    if (!decision.allowed) throw new Error(decision.error);
    expect(decision.config.MINECRAFT_PORT).toBe(25567);
    expect(decision.config.AUTO_START_PAPER).toBe(false);
    expect(decision.config.SIM_CITIZEN_COUNT).toBe(1);
    expect(decision.config.SIM_ASSIGN_WORK_ROLES).toBe(false);
    expect(decision.activeBodies).toHaveLength(1);
    expect(decision.offlineRoster.map((row) => row.name)).toEqual(["Maya", "Theo", "Ava", "Kai"]);
    expect(isWorldLabDatabasePath(decision.databasePath)).toBe(true);
  });

  it("pins isolated keys after a live-civ env so .env cannot keep 25565", () => {
    const pinned = applyWorldLabOneCitizenEnv(liveCivEnv);
    expect(pinned.MINECRAFT_PORT).toBe("25567");
    expect(pinned.DATABASE_PATH).toBe(WORLD_LAB_DATABASE_RELATIVE);
    expect(pinned.AUTO_START_PAPER).toBe("false");
    const decision = evaluateWorldLabOneCitizenLaunch(pinned);
    expect(decision.allowed).toBe(true);
  });
});

describe("database path isolation", () => {
  it("does not treat world-lab-civilization.sqlite as live-civ civilization.sqlite", () => {
    const lab = resolveFromRoot(WORLD_LAB_DATABASE_RELATIVE);
    const live = resolveFromRoot(LIVE_CIVILIZATION_DATABASE_RELATIVE);
    expect(isWorldLabDatabasePath(lab)).toBe(true);
    expect(isLiveCivilizationDatabasePath(lab)).toBe(false);
    expect(isLiveCivilizationDatabasePath(live)).toBe(true);
    expect(isWorldLabDatabasePath(live)).toBe(false);
  });
});

describe("claim reach from spawn vs proposed H9 street", () => {
  it("world spawn is slightly outside HOME_CLAIM_REACH; H9 street is inside", () => {
    const fromSpawn = catalogClaimDistances(WORLD_LAB_WORLD_SPAWN);
    const fromStreet = catalogClaimDistances(PROPOSED_H9_STREET_STAND);
    expect(fromSpawn[0]?.id).toBe("home_h9");
    expect(fromSpawn[0]?.inClaimReach).toBe(false);
    expect(fromSpawn[0]?.distance).toBeGreaterThan(HOME_CLAIM_REACH_BLOCKS);
    expect(fromStreet[0]?.id).toBe("home_h9");
    expect(fromStreet[0]?.inClaimReach).toBe(true);
    expect(fromStreet.every((row) => row.id === "home_h9" || !row.inClaimReach || row.distance <= HOME_CLAIM_REACH_BLOCKS)).toBe(true);
  });
});
