import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BodyObservation } from "@civ/shared";
import {
  authorizedWorkStorage,
  chooseActivity,
  listActivityOptions,
  type ActivityChoiceInput,
} from "./activity-choice.js";
import { WORLD_LAB_CLAIMABLE_HOMES } from "./available-homes.js";
import { listDiscoveredSites, rememberDiscoveredSite, siteIsReachable } from "./discovered-sites.js";
import { claimHome } from "./homes.js";
import { CivilizationStore } from "./store.js";

const shore = { stand: { x: -1043, y: 63, z: 980 }, water: { x: -1044, y: 62, z: 980 } };
const homeBed = { x: -1097, y: 69, z: 728 };

function obs(over: Partial<BodyObservation> = {}): BodyObservation {
  return {
    username: "Kai",
    connected: true,
    spawned: true,
    health: 20,
    food: 12,
    gameTime: 1_000,
    isNight: false,
    position: { x: -1042.5, y: 63, z: 980.5 },
    inventory: [{ name: "fishing_rod", count: 1 }],
    players: [],
    nearby: [],
    ...over,
  };
}

function base(over: Partial<ActivityChoiceInput> = {}): ActivityChoiceInput {
  return {
    citizenId: "citizen_kai",
    observation: obs(),
    heldFood: 0,
    visibleShores: [shore],
    authorizedStorage: { x: -1096, y: 69, z: 729 },
    home: {
      homeId: "home_h1",
      bed: homeBed,
      status: "active",
      origin: { x: -1096, y: 69, z: 730 },
      entrance: { x: -1096, y: 69, z: 732 },
      personalChest: { x: -1096, y: 69, z: 729 },
    },
    settlementFoodNeed: true,
    ...over,
  };
}

describe("autonomous activity selection", () => {
  it("chooses fishing when hungry with a rod, discovered shore, and authorized chest", () => {
    const { option, trace } = chooseActivity(base());
    expect(option.action).toBe("fishShore");
    expect(option.target).toEqual(shore.stand);
    expect(option.reason).not.toMatch(/assigned fisher|TWO_FISH/i);
    expect(trace.options.some((entry) => entry.action === "fishShore")).toBe(true);
    expect(trace.observations.visibleShores).toBe(1);
  });

  it("prefers visible animals over fishing for the same food need", () => {
    const { option } = chooseActivity(
      base({
        observation: obs({
          nearby: [
            {
              id: 2,
              name: "cow",
              type: "mob",
              hostile: false,
              position: { x: -1040, y: 63, z: 978 },
              distance: 4,
            },
          ],
        }),
      }),
    );
    expect(option.action).toBe("gatherFood");
    expect(option.action).not.toBe("fishShore");
  });

  it("does not hardcode fishing when the citizen is fed and an ore site is known", () => {
    const { option, trace } = chooseActivity(
      base({
        observation: obs({
          food: 20,
          position: { x: -953, y: 58, z: 946 },
          inventory: [
            { name: "fishing_rod", count: 1 },
            { name: "stone_pickaxe", count: 1 },
          ],
        }),
        heldFood: 4,
        settlementFoodNeed: false,
        knownSites: [
          {
            kind: "ore",
            origin: { x: -953, y: 58, z: 946 },
            citizenId: "citizen_kai",
            seenAt: "2026-09-20T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(option.action).toBe("mineOre");
    expect(trace.options.some((entry) => entry.action === "fishShore")).toBe(false);
  });

  it("blocks fishing without a discovered reachable shore and does not inject pond coordinates", () => {
    const listed = listActivityOptions(
      base({
        observation: obs({ position: { x: -1095.5, y: 69, z: 730.5 } }),
        visibleShores: [],
        knownSites: [],
      }),
    );
    expect(listed.options.some((entry) => entry.action === "fishShore")).toBe(false);
    expect(listed.blocked.some((entry) => entry.missing === "reachable_shore" && entry.code === "SEARCH_EXHAUSTED")).toBe(
      true,
    );
  });

  it("blocks fishing when the only offered chest is a test fixture", () => {
    const listed = listActivityOptions(base({ authorizedStorage: { x: -1042, y: 63, z: 980 } }));
    expect(listed.options.some((entry) => entry.action === "fishShore")).toBe(false);
    expect(listed.blocked.some((entry) => entry.code === "ACCESS_DENIED" && entry.missing === "authorized_storage")).toBe(
      true,
    );
  });

  it("offers claimHome for the nearest unclaimed house and does not default to H1", () => {
    const { option, trace } = chooseActivity(
      base({
        home: undefined,
        authorizedStorage: undefined,
        observation: obs({
          food: 20,
          inventory: [{ name: "stone_pickaxe", count: 1 }],
          position: { x: -1065, y: 68, z: 847 },
        }),
        heldFood: 4,
        settlementFoodNeed: false,
        visibleShores: [],
        availableHomes: [
          {
            id: "home_h1",
            origin: { x: -1096, y: 69, z: 730 },
            entrance: { x: -1096, y: 69, z: 732 },
            bed: { x: -1097, y: 69, z: 728 },
            personalChest: { x: -1096, y: 69, z: 729 },
          },
          {
            id: "home_h9",
            origin: { x: -1065, y: 68, z: 847 },
            entrance: { x: -1063, y: 68, z: 847 },
            bed: { x: -1067, y: 68, z: 848 },
            personalChest: { x: -1066, y: 68, z: 847 },
          },
        ],
      }),
    );
    expect(option.action).toBe("claimHome");
    expect(option.item).toBe("home_h9");
    expect(trace.blocked.some((entry) => entry.code === "HOME_MISSING")).toBe(true);
  });

  it("does not inject fishing when hungry at a house with no reachable shore", () => {
    const listed = listActivityOptions(
      base({
        observation: obs({
          food: 12,
          position: { x: -1065, y: 68, z: 847 },
          inventory: [{ name: "fishing_rod", count: 1 }],
        }),
        visibleShores: [],
        knownSites: [],
      }),
    );
    expect(listed.options.some((entry) => entry.action === "fishShore")).toBe(false);
  });

  it("blocks fishing when the rod is missing", () => {
    const listed = listActivityOptions(base({ observation: obs({ inventory: [] }) }));
    expect(listed.blocked.some((entry) => entry.code === "MISSING_TOOL")).toBe(true);
  });

  it("blocks mining without authorized storage even with a pickaxe and ore site", () => {
    const listed = listActivityOptions(
      base({
        observation: obs({
          food: 20,
          position: { x: -953, y: 58, z: 946 },
          inventory: [{ name: "stone_pickaxe", count: 1 }],
        }),
        heldFood: 4,
        settlementFoodNeed: false,
        authorizedStorage: undefined,
        visibleShores: [],
        knownSites: [
          {
            kind: "ore",
            origin: { x: -953, y: 58, z: 946 },
            citizenId: "citizen_kai",
            seenAt: "2026-09-20T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(listed.options.some((entry) => entry.action === "mineOre")).toBe(false);
    expect(listed.blocked.some((entry) => entry.id === "mine_ore" && entry.code === "ACCESS_DENIED")).toBe(true);
  });

  it("does not re-offer fishing after an unresolved ACCESS_DENIED", () => {
    const { option } = chooseActivity(
      base({
        lastOutcome: {
          task: "fish_shore",
          action: "fishShore",
          success: false,
          code: "ACCESS_DENIED",
          streak: 1,
          unresolved: [{ action: "fishShore", code: "ACCESS_DENIED" }],
        },
        authorizedStorage: undefined,
      }),
    );
    expect(option.action).not.toBe("fishShore");
  });

  it("cancels optional fishing when there is not enough time to return home", () => {
    const { option } = chooseActivity(
      base({
        observation: obs({
          gameTime: 12_000,
          position: { x: -1042.5, y: 63, z: 980.5 },
        }),
      }),
    );
    expect(option.action).toBe("sleep");
    expect(option.task).toBe("sleep_at_home");
    expect(option.target).toEqual(homeBed);
    expect(option.action).not.toBe("returnHome");
  });
});

describe("storage permission and discovered sites", () => {
  it("refuses another citizen's personal chest and accepts own or communal storage", () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-act-"));
    const store = new CivilizationStore(join(dir, "civ.sqlite"));
    store.upsertCitizen({
      id: "citizen_kai",
      name: "Kai",
      minecraftUsername: "Kai",
      createdAt: new Date().toISOString(),
      status: "online",
    });
    store.upsertCitizen({
      id: "citizen_atlas",
      name: "Atlas",
      minecraftUsername: "Atlas",
      createdAt: new Date().toISOString(),
      status: "online",
    });
    expect(
      claimHome(store, {
        citizenId: "citizen_atlas",
        homeId: "home_h2",
        origin: { x: -1058, y: 68, z: 757 },
        bed: { x: -1056, y: 68, z: 756 },
        personalChest: { x: -1057, y: 68, z: 757 },
        storageAccess: "personal",
      }).success,
    ).toBe(true);
    expect(authorizedWorkStorage(store, "citizen_kai")).toBeUndefined();
    const settlement = store.getSettlement();
    settlement.storage = { x: -1038, y: 65, z: 839 };
    store.saveSettlement(settlement);
    expect(authorizedWorkStorage(store, "citizen_kai")).toEqual({ x: -1038, y: 65, z: 839 });
    expect(
      claimHome(store, {
        citizenId: "citizen_kai",
        homeId: "home_h1",
        origin: { x: -1096, y: 69, z: 730 },
        bed: homeBed,
        personalChest: { x: -1096, y: 69, z: 729 },
        storageAccess: "personal",
      }).success,
    ).toBe(true);
    expect(authorizedWorkStorage(store, "citizen_kai")).toEqual({ x: -1096, y: 69, z: 729 });
    const fixtureSettlement = store.getSettlement();
    fixtureSettlement.storage = { x: -1042, y: 63, z: 980 };
    store.saveSettlement(fixtureSettlement);
    expect(authorizedWorkStorage(store, "citizen_maya")).toBeUndefined();
    store.close();
  });

  it("persists a discovered shore across a store reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "civ-site-"));
    const path = join(dir, "civ.sqlite");
    const store = new CivilizationStore(path);
    rememberDiscoveredSite(store, {
      kind: "shore",
      origin: shore.stand,
      stand: shore.stand,
      citizenId: "citizen_kai",
      seenAt: "2026-09-20T00:00:00.000Z",
    });
    store.close();
    const restored = new CivilizationStore(path);
    const sites = listDiscoveredSites(restored);
    expect(sites).toHaveLength(1);
    expect(sites[0]?.kind).toBe("shore");
    expect(sites[0]?.origin).toEqual(shore.stand);
    expect(siteIsReachable({ x: -1042, y: 63, z: 980 }, shore.stand)).toBe(true);
    expect(siteIsReachable({ x: -1096, y: 69, z: 730 }, shore.stand)).toBe(false);
    restored.close();
  });
});

describe("homeless housing travel vs claim", () => {
  it("offers travelTowardHousing from the pond and not claimHome", () => {
    const { option, trace } = chooseActivity(
      base({
        home: undefined,
        authorizedStorage: undefined,
        observation: obs({
          food: 20,
          inventory: [{ name: "stone_pickaxe", count: 1 }],
          position: { x: -1043.5, y: 63, z: 981.5 },
        }),
        heldFood: 4,
        settlementFoodNeed: false,
        visibleShores: [],
        availableHomes: [...WORLD_LAB_CLAIMABLE_HOMES],
      }),
    );
    expect(option.action).toBe("travelTowardHousing");
    expect(option.item).toBe("home_h9");
    expect(option.item).not.toBe("home_h1");
    expect(trace.options.some((entry) => entry.action === "claimHome")).toBe(false);
  });

  it("blocks seek_housing when the catalog is empty", () => {
    const listed = listActivityOptions(
      base({
        home: undefined,
        authorizedStorage: undefined,
        observation: obs({
          food: 20,
          inventory: [{ name: "stone_pickaxe", count: 1 }],
          position: { x: -1043.5, y: 63, z: 981.5 },
        }),
        heldFood: 4,
        settlementFoodNeed: false,
        visibleShores: [],
        availableHomes: [],
      }),
    );
    expect(listed.options.some((entry) => entry.action === "travelTowardHousing" || entry.action === "claimHome")).toBe(
      false,
    );
    expect(listed.blocked.some((entry) => entry.id === "seek_housing" && entry.code === "SEARCH_EXHAUSTED")).toBe(true);
  });
});
