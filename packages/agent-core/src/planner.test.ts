import { describe, expect, it } from "vitest";
import type { BodyObservation, SettlementState } from "@civ/shared";
import { WORLD_LAB_CLAIMABLE_HOMES } from "./available-homes.js";
import { assignSettlementNeeds, experimentWorkAssignment, planCitizen } from "./planner.js";

const emptySettlement = (): SettlementState => ({
  id: "settlement_first",
  name: "First Settlement",
  food: 0,
  wood: 0,
  stone: 0,
  beds: 0,
  housingCapacity: 0,
  tools: 0,
  shelterComplete: false,
  needs: ["NEED_FOOD", "NEED_WOOD", "NEED_HOUSING"],
});

const obs = (over: Partial<BodyObservation> = {}): BodyObservation => ({
  username: "Atlas",
  connected: true,
  spawned: true,
  health: 20,
  food: 20,
  inventory: [],
  players: [],
  nearby: [],
  ...over,
});

describe("planCitizen", () => {
  it("flees when health is critical near a hostile", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        health: 5,
        nearby: [
          {
            id: 1,
            name: "zombie",
            type: "mob",
            hostile: true,
            position: { x: 1, y: 64, z: 1 },
            distance: 4,
          },
        ],
      }),
      settlement: emptySettlement(),
      assignedNeeds: [],
    });
    expect(planned.action).toBe("flee");
    expect(planned.source).toBe("reflex");
  });

  it("eats when hungry and food is held", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ food: 6, inventory: [{ name: "bread", count: 2 }] }),
      settlement: emptySettlement(),
      assignedNeeds: ["NEED_WOOD"],
    });
    expect(planned.action).toBe("eatFood");
  });

  it("does not send everyone to gather wood just because it is night", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        isNight: true,
        inventory: [
          { name: "wooden_pickaxe", count: 1 },
          { name: "oak_planks", count: 16 },
        ],
      }),
      settlement: {
        ...emptySettlement(),
        food: 20,
        wood: 40,
        stone: 40,
        tools: 4,
        needs: ["NEED_HOUSING"],
      },
      assignedNeeds: ["NEED_HOUSING"],
      workRole: "build",
    });
    expect(planned.task).not.toBe("gather_wood");
    expect(planned.action).toBe("buildShelter");
  });

  it("does not treat empty settlement reserve as personal starvation when steak is carried", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ food: 14, inventory: [{ name: "cooked_beef", count: 64 }] }),
      settlement: { ...emptySettlement(), food: 0, needs: ["NEED_FOOD"] },
      assignedNeeds: [],
      workRole: "wood",
    });
    expect(planned.action).not.toBe("gatherFood");
    expect(planned.reason.toLowerCase()).not.toMatch(/no food|has no food|starv/);
  });

  it("prefers existing shelter at night once it is verified", () => {
    const planned = planCitizen({
      citizenId: "citizen_maya",
      observation: obs({ isNight: true }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: [] },
      assignedNeeds: [],
    });
    expect(planned.action).toBe("seekSafety");
  });

  it("follows a human directive unless an emergency reflex fires", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs(),
      settlement: emptySettlement(),
      assignedNeeds: ["NEED_FOOD"],
      humanDirective: { id: "d1", intent: "gather_wood", mode: "DIRECTIVE" },
    });
    expect(planned.task).toBe("gather_wood");
    expect(planned.directiveId).toBe("d1");
  });

  it("lets emergency reflex beat a human directive", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        health: 5,
        nearby: [{ id: 1, name: "zombie", type: "mob", hostile: true, position: { x: 1, y: 64, z: 1 }, distance: 3 }],
      }),
      settlement: emptySettlement(),
      assignedNeeds: [],
      humanDirective: { id: "d1", intent: "gather_wood", mode: "ADMIN_OVERRIDE" },
    });
    expect(planned.action).toBe("flee");
  });

  it("gathers wood after a shelter oak_door prerequisite failure instead of rebuilding immediately", () => {
    const planned = planCitizen({
      citizenId: "citizen_kai",
      observation: obs({ inventory: [{ name: "oak_log", count: 2 }] }),
      settlement: { ...emptySettlement(), needs: ["NEED_HOUSING"] },
      assignedNeeds: ["NEED_HOUSING"],
      workRole: "build",
      lastOutcome: {
        task: "build_shelter",
        action: "buildShelter",
        success: false,
        code: "MISSING_INGREDIENT",
        error: "Need more wood for the shelter",
        item: "oak_door",
        nextTask: "gather_wood",
        streak: 1,
      },
    });
    expect(planned.task).toBe("gather_wood");
    expect(planned.action).toBe("mineBlock");
  });

  it("deposits when the last mining action reported a full inventory", () => {
    const planned = planCitizen({
      citizenId: "citizen_ava",
      observation: obs({ inventory: [{ name: "oak_log", count: 64 }] }),
      settlement: emptySettlement(),
      assignedNeeds: ["NEED_WOOD"],
      workRole: "wood",
      lastOutcome: {
        task: "gather_wood",
        action: "mineBlock",
        success: false,
        code: "INVENTORY_FULL",
        error: "Inventory is full",
        streak: 1,
      },
    });
    expect(planned.action).toBe("depositItems");
  });
});

describe("assignSettlementNeeds", () => {
  it("spreads needs across citizens", () => {
    const assigned = assignSettlementNeeds(["a", "b", "c"], ["NEED_FOOD", "NEED_WOOD", "NEED_STONE"]);
    expect(assigned.get("a")).toEqual(["NEED_FOOD"]);
    expect(assigned.get("b")).toEqual(["NEED_WOOD"]);
    expect(assigned.get("c")).toEqual(["NEED_STONE"]);
  });
});

describe("experimentWorkAssignment", () => {
  it("does not assign roster jobs when disabled", () => {
    const result = experimentWorkAssignment(
      ["citizen_atlas", "citizen_maya", "citizen_theo", "citizen_ava", "citizen_kai"],
      ["NEED_FOOD", "NEED_WOOD", "NEED_STONE", "NEED_TOOLS", "NEED_HOUSING"],
      false,
    );
    expect(result.roles.size).toBe(0);
    expect(result.assignedNeeds.get("citizen_atlas")).toEqual([]);
    expect(result.assignedNeeds.get("citizen_maya")).toEqual([]);
  });

  it("preserves legacy roster jobs when enabled", () => {
    const result = experimentWorkAssignment(
      ["citizen_atlas", "citizen_maya", "citizen_theo", "citizen_ava", "citizen_kai"],
      ["NEED_FOOD", "NEED_WOOD"],
      true,
    );
    expect(result.roles.get("citizen_atlas")).toBe("wood");
    expect(result.roles.get("citizen_maya")).toBe("food");
    expect(result.assignedNeeds.get("citizen_atlas")).toEqual(["NEED_FOOD"]);
    expect(result.assignedNeeds.get("citizen_maya")).toEqual(["NEED_WOOD"]);
  });
});

describe("planCitizen without assigned jobs", () => {
  it("does not farm from settlement NEED_FOOD unless hungry or assigned", () => {
    const planned = planCitizen({
      citizenId: "citizen_ava",
      observation: obs({ food: 20, inventory: [{ name: "wooden_pickaxe", count: 1 }] }),
      settlement: { ...emptySettlement(), needs: ["NEED_FOOD"], wood: 4, shelterComplete: true },
      assignedNeeds: [],
    });
    expect(planned.action).not.toBe("gatherFood");
    expect(planned.action).not.toBe("workFarmPlot");
    expect(planned.reason).not.toMatch(/Assigned to obtain food/);
  });

  it("sleeps in a claimed home bed at night instead of the nearest unused bed", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ isNight: true }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
      home: { homeId: "home_h7", bed: { x: -1089, y: 68, z: 817 }, status: "active" },
    });
    expect(planned.action).toBe("sleep");
    expect(planned.task).toBe("sleep_at_home");
    expect(planned.target).toEqual({ x: -1089, y: 68, z: 817 });
  });

  it("does not invent a house when no home has been claimed", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ isNight: true }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
    });
    expect(planned.action).toBe("seekSafety");
    expect(planned.action).not.toBe("sleep");
  });

  it("does not assign ore mining by roster when work roles are off", () => {
    const planned = planCitizen({
      citizenId: "citizen_kai",
      observation: obs({ food: 20, inventory: [{ name: "stone_pickaxe", count: 1 }] }),
      settlement: { ...emptySettlement(), shelterComplete: true, wood: 8, needs: [] },
      assignedNeeds: [],
    });
    expect(planned.action).not.toBe("mineOre");
    expect(planned.occupation).not.toBe("miner");
  });

  it("fail-closes model mine_ore (internal planner action, not a cognition goal)", () => {
    const planned = planCitizen({
      citizenId: "citizen_maya",
      observation: obs({
        position: { x: -953, y: 58, z: 945 },
        inventory: [{ name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
      llmGoal: "mine_ore",
      llmReason: "Need iron for better tools",
      authorizedStorage: { x: -1038, y: 65, z: 839 },
      knownSites: [{ kind: "ore", origin: { x: -953, y: 58, z: 945 }, citizenId: "citizen_maya", seenAt: "2026-09-20T00:00:00.000Z" }],
    });
    expect(planned.source).toBe("llm");
    expect(planned.action).toBe("deferCapability");
    expect(planned.task).toBe("unsupported_goal");
    expect(planned.action).not.toBe("mineOre");
    expect(planned.occupation).toBeUndefined();
  });

  it("stops claimed-home work before night using travel ETA, not a go-home command", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        isNight: false,
        gameTime: 11_990,
        position: { x: -1043, y: 63, z: 980 },
        inventory: [{ name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
      llmGoal: "mine_ore",
      llmReason: "Keep mining iron",
      home: {
        homeId: "home_h7",
        bed: { x: -1089, y: 68, z: 817 },
        origin: { x: -1089, y: 68, z: 817 },
        status: "active",
      },
    });
    expect(planned.action).toBe("sleep");
    expect(planned.action).not.toBe("returnHome");
    expect(planned.task).toBe("sleep_at_home");
    expect(planned.target).toEqual({ x: -1089, y: 68, z: 817 });
    expect(planned.reason).toMatch(/stop work|night/i);
  });

  it("waits inside a claimed house arrived at before vanilla sleep", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        isNight: false,
        gameTime: 12_766,
        position: { x: -1088.5, y: 68, z: 817.5 },
        inventory: [{ name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
      llmGoal: "mine_ore",
      llmReason: "Keep mining iron",
      home: {
        homeId: "home_h7",
        bed: { x: -1089, y: 68, z: 817 },
        origin: { x: -1089, y: 68, z: 817 },
        status: "active",
      },
    });
    expect(planned.action).toBe("waitInsideHome");
    expect(planned.task).toBe("WAIT_INSIDE_HOME");
    expect(planned.target).toEqual({ x: -1089, y: 68, z: 817 });
    expect(planned.reason).toMatch(/wait inside/i);
  });

  it("sleeps the claimed bed once vanilla night has started inside", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        isNight: true,
        gameTime: 14_000,
        position: { x: -1088.5, y: 68, z: 817.5 },
      }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
      home: {
        homeId: "home_h7",
        bed: { x: -1089, y: 68, z: 817 },
        origin: { x: -1089, y: 68, z: 817 },
        status: "active",
      },
    });
    expect(planned.action).toBe("sleep");
    expect(planned.task).toBe("sleep_at_home");
    expect(planned.target).toEqual({ x: -1089, y: 68, z: 817 });
  });

  it("hands interrupted work to curfew instead of resuming the quota", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        isNight: false,
        gameTime: 11_990,
        position: { x: -1043, y: 63, z: 980 },
        inventory: [{ name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
      llmGoal: "mine_ore",
      llmReason: "Keep mining iron",
      lastOutcome: {
        task: "mine_ore",
        action: "mineOre",
        success: false,
        code: "CURFEW_STOP",
        streak: 1,
      },
      home: {
        homeId: "home_h7",
        bed: { x: -1089, y: 68, z: 817 },
        origin: { x: -1089, y: 68, z: 817 },
        status: "active",
      },
      knownSites: [{ kind: "ore", origin: { x: -953, y: 58, z: 945 }, citizenId: "citizen_atlas", seenAt: "2026-09-20T00:00:00.000Z" }],
    });
    expect(planned.action).toBe("sleep");
    expect(planned.action).not.toBe("mineOre");
  });

  it("keeps Maya waiting in H4, not Atlas H1, before vanilla sleep", () => {
    const planned = planCitizen({
      citizenId: "citizen_maya",
      observation: obs({
        isNight: false,
        gameTime: 12_766,
        position: { x: -1054.5, y: 65, z: 779.5 },
      }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
      home: {
        homeId: "home_h4",
        bed: { x: -1055, y: 65, z: 779 },
        origin: { x: -1055, y: 65, z: 779 },
        status: "active",
      },
    });
    expect(planned.action).toBe("waitInsideHome");
    expect(planned.target).toEqual({ x: -1055, y: 65, z: 779 });
    expect(planned.target).not.toEqual({ x: -1097, y: 69, z: 728 });
  });

  it("does not keep WAIT_INSIDE_HOME running after sunrise", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        isNight: false,
        gameTime: 23_100,
        position: { x: -1088.5, y: 68, z: 817.5 },
        inventory: [{ name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
      llmGoal: "mine_ore",
      llmReason: "Need iron for better tools",
      home: {
        homeId: "home_h7",
        bed: { x: -1089, y: 68, z: 817 },
        origin: { x: -1089, y: 68, z: 817 },
        status: "active",
      },
      knownSites: [{ kind: "ore", origin: { x: -953, y: 58, z: 945 }, citizenId: "citizen_atlas", seenAt: "2026-09-20T00:00:00.000Z" }],
    });
    expect(planned.action).not.toBe("waitInsideHome");
    expect(planned.action).not.toBe("sleep");
    expect(planned.action).not.toBe("returnHome");
  });

  it("sends Maya to her own bed, not Atlas H1", () => {
    const planned = planCitizen({
      citizenId: "citizen_maya",
      observation: obs({
        isNight: true,
        gameTime: 14_000,
        position: { x: -1043, y: 63, z: 980 },
      }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
      home: {
        homeId: "home_h4",
        bed: { x: -1055, y: 65, z: 779 },
        origin: { x: -1055, y: 65, z: 779 },
        status: "active",
      },
    });
    expect(planned.target).toEqual({ x: -1055, y: 65, z: 779 });
    expect(planned.target).not.toEqual({ x: -1097, y: 69, z: 728 });
  });

  it("fail-closes llm mine_ore even when storage exists but ore is unknown (not a cognition goal)", () => {
    const planned = planCitizen({
      citizenId: "citizen_maya",
      observation: obs({ inventory: [{ name: "stone_pickaxe", count: 1 }] }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
      llmGoal: "mine_ore",
      llmReason: "Need iron for better tools",
      authorizedStorage: { x: -1096, y: 69, z: 729 },
    });
    expect(planned.action).toBe("deferCapability");
    expect(planned.task).toBe("unsupported_goal");
  });

  it("claims the nearest reachable house, not H1, when the citizen has no home", () => {
    const planned = planCitizen({
      citizenId: "citizen_kai",
      observation: obs({
        food: 20,
        isNight: false,
        gameTime: 1_000,
        position: { x: -1065, y: 68, z: 847 },
        inventory: [{ name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, wood: 8, needs: [] },
      assignedNeeds: [],
      availableHomes: [...WORLD_LAB_CLAIMABLE_HOMES],
    });
    expect(planned.action).toBe("claimHome");
    expect(planned.item).toBe("home_h9");
    expect(planned.item).not.toBe("home_h1");
    expect(planned.occupation).toBeUndefined();
  });

  it("walks toward catalog housing at night from the pond instead of claiming distant H1 or looping seekSafety", () => {
    const planned = planCitizen({
      citizenId: "citizen_kai",
      observation: obs({
        isNight: true,
        gameTime: 14_000,
        position: { x: -1043, y: 63, z: 980 },
        inventory: [{ name: "fishing_rod", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
      availableHomes: [...WORLD_LAB_CLAIMABLE_HOMES],
    });
    expect(planned.action).toBe("travelTowardHousing");
    expect(planned.item).toBe("home_h9");
    expect(planned.action).not.toBe("claimHome");
    expect(planned.item).not.toBe("home_h1");
    expect(planned.action).not.toBe("seekSafety");
    expect(planned.action).not.toBe("sleep");
  });

  it("after repeated seek_shelter failures switches to housing travel, not build_shelter", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        isNight: true,
        gameTime: 14_000,
        position: { x: -1043.5, y: 63, z: 981.5 },
        inventory: [],
      }),
      settlement: { ...emptySettlement(), shelterComplete: false },
      assignedNeeds: [],
      availableHomes: [...WORLD_LAB_CLAIMABLE_HOMES],
      lastOutcome: {
        task: "seek_shelter",
        action: "seekSafety",
        success: false,
        code: "TARGET_UNREACHABLE",
        streak: 3,
        retryable: true,
      },
    });
    expect(planned.action).toBe("travelTowardHousing");
    expect(planned.item).toBe("home_h9");
    expect(planned.action).not.toBe("buildShelter");
    expect(planned.reason).toMatch(/Seek shelter failed/i);
  });

  it("walks toward the nearest eligible house from the pond by day without claiming it", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        isNight: false,
        gameTime: 1_000,
        position: { x: -1043.5, y: 63, z: 981.5 },
        inventory: [],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, wood: 8, needs: [] },
      assignedNeeds: [],
      availableHomes: [...WORLD_LAB_CLAIMABLE_HOMES],
    });
    expect(planned.action).toBe("travelTowardHousing");
    expect(planned.task).toBe("seek_housing");
    expect(planned.action).not.toBe("claimHome");
    expect(planned.item).not.toBe("home_h1");
    expect(planned.item).toBe("home_h9");
    expect(planned.target).toEqual({ x: -1063, y: 68, z: 847 });
    expect(planned.reason).toMatch(/outside claim reach|walk toward/i);
  });

  it("does not hardcode H9 when a different catalog house is nearer", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        isNight: false,
        gameTime: 1_000,
        position: { x: -1043.5, y: 63, z: 981.5 },
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: [] },
      assignedNeeds: [],
      availableHomes: [
        {
          id: "home_west",
          origin: { x: -1200, y: 68, z: 700 },
          entrance: { x: -1198, y: 68, z: 700 },
          bed: { x: -1201, y: 68, z: 699 },
          personalChest: { x: -1200, y: 68, z: 701 },
        },
        {
          id: "home_south",
          origin: { x: -1043, y: 63, z: 900 },
          entrance: { x: -1041, y: 63, z: 900 },
          bed: { x: -1044, y: 63, z: 899 },
          personalChest: { x: -1043, y: 63, z: 901 },
        },
      ],
    });
    expect(planned.action).toBe("travelTowardHousing");
    expect(planned.item).toBe("home_south");
    expect(planned.item).not.toBe("home_h9");
    expect(planned.target).toEqual({ x: -1041, y: 63, z: 900 });
  });

  it("claims once the body is in range after travel, still not assigning H1", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        isNight: false,
        gameTime: 1_000,
        position: { x: -1061, y: 68, z: 847 },
        inventory: [{ name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, wood: 8, needs: [] },
      assignedNeeds: [],
      availableHomes: [...WORLD_LAB_CLAIMABLE_HOMES],
    });
    expect(planned.action).toBe("claimHome");
    expect(planned.item).toBe("home_h9");
    expect(planned.item).not.toBe("home_h1");
  });

  it("does not invent a house when none are eligible", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        isNight: false,
        gameTime: 1_000,
        position: { x: -1043.5, y: 63, z: 981.5 },
        inventory: [{ name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, wood: 8, needs: [] },
      assignedNeeds: [],
      availableHomes: [],
    });
    expect(planned.action).not.toBe("travelTowardHousing");
    expect(planned.action).not.toBe("claimHome");
  });

  it("skips a blocked house and walks toward the next eligible one", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        isNight: false,
        gameTime: 1_000,
        position: { x: -1043.5, y: 63, z: 981.5 },
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: [] },
      assignedNeeds: [],
      availableHomes: [...WORLD_LAB_CLAIMABLE_HOMES],
      lastOutcome: {
        task: "seek_housing",
        action: "travelTowardHousing",
        success: false,
        code: "HAZARD_BLOCKED",
        item: "home_h9",
        streak: 1,
        retryable: true,
      },
    });
    expect(planned.action).toBe("travelTowardHousing");
    expect(planned.item).not.toBe("home_h9");
    expect(planned.item).toBeTruthy();
  });

  it("reports no-house-found after every eligible house is unreachable", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        isNight: false,
        gameTime: 1_000,
        position: { x: -1043.5, y: 63, z: 981.5 },
        inventory: [{ name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, wood: 8, needs: [] },
      assignedNeeds: [],
      availableHomes: [WORLD_LAB_CLAIMABLE_HOMES.find((home) => home.id === "home_h9")!],
      lastOutcome: {
        task: "seek_housing",
        action: "travelTowardHousing",
        success: false,
        code: "TARGET_UNREACHABLE",
        item: "home_h9",
        streak: 1,
        retryable: true,
      },
    });
    expect(planned.action).not.toBe("travelTowardHousing");
    expect(planned.action).not.toBe("claimHome");
  });

  it("fail-closes unsupported claim_home while homeless (housing remains deterministic without LLM)", () => {
    const withBadGoal = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        isNight: false,
        gameTime: 1_000,
        position: { x: -1043.5, y: 63, z: 981.5 },
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: [] },
      assignedNeeds: [],
      availableHomes: [...WORLD_LAB_CLAIMABLE_HOMES],
      llmGoal: "claim_home",
      llmReason: "I should find a house",
    });
    expect(withBadGoal.source).toBe("llm");
    expect(withBadGoal.action).toBe("deferCapability");
    expect(withBadGoal.modelProvenance?.kind).toBe("rejected_unsupported");

    const fallback = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        isNight: false,
        gameTime: 1_000,
        position: { x: -1043.5, y: 63, z: 981.5 },
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: [] },
      assignedNeeds: [],
      availableHomes: [...WORLD_LAB_CLAIMABLE_HOMES],
    });
    expect(fallback.source).toBe("planner");
    expect(fallback.action).toBe("travelTowardHousing");
  });

  it("fail-closes model claim_home when housing is already claimed (not a cognition goal)", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        isNight: false,
        gameTime: 1_000,
        position: { x: -1088.5, y: 68, z: 817.5 },
        inventory: [{ name: "stone_pickaxe", count: 1 }, { name: "oak_log", count: 8 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: [] },
      assignedNeeds: [],
      home: {
        homeId: "home_h7",
        bed: { x: -1089, y: 68, z: 817 },
        origin: { x: -1089, y: 68, z: 817 },
        status: "active",
      },
      llmGoal: "claim_home",
      llmReason: "I should find a house",
    });
    expect(planned.source).toBe("llm");
    expect(planned.action).toBe("deferCapability");
    expect(planned.task).toBe("unsupported_goal");
  });

  it("does not force fishing when hungry at a claimed home far from any shore", () => {
    const planned = planCitizen({
      citizenId: "citizen_kai",
      observation: obs({
        food: 12,
        gameTime: 1_000,
        position: { x: -1096, y: 69, z: 730 },
        inventory: [{ name: "fishing_rod", count: 1 }, { name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: ["NEED_FOOD"] },
      assignedNeeds: [],
      home: {
        homeId: "home_h1",
        bed: { x: -1097, y: 69, z: 728 },
        status: "active",
        origin: { x: -1096, y: 69, z: 730 },
        personalChest: { x: -1096, y: 69, z: 729 },
      },
      authorizedStorage: { x: -1096, y: 69, z: 729 },
      visibleShores: [],
      knownSites: [],
    });
    expect(planned.action).not.toBe("fishShore");
    expect(planned.occupation).not.toBe("fisher");
  });

  it("reports BLOCKED instead of fishing when the only known chest is unauthorized", () => {
    const planned = planCitizen({
      citizenId: "citizen_kai",
      observation: obs({
        food: 12,
        gameTime: 1_000,
        position: { x: -1043, y: 63, z: 980 },
        inventory: [{ name: "fishing_rod", count: 1 }, { name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: ["NEED_FOOD"] },
      assignedNeeds: [],
      visibleShores: [{ stand: { x: -1043, y: 63, z: 980 }, water: { x: -1044, y: 62, z: 980 } }],
    });
    expect(planned.action).not.toBe("fishShore");
    expect(planned.trace?.blocked.some((entry) => entry.code === "ACCESS_DENIED")).toBe(true);
  });

  it("does not retry fishing after ACCESS_DENIED when storage is still missing", () => {
    const planned = planCitizen({
      citizenId: "citizen_kai",
      observation: obs({
        food: 12,
        gameTime: 1_000,
        position: { x: -1043, y: 63, z: 980 },
        inventory: [{ name: "fishing_rod", count: 1 }, { name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: ["NEED_FOOD"] },
      assignedNeeds: [],
      visibleShores: [{ stand: { x: -1043, y: 63, z: 980 }, water: { x: -1044, y: 62, z: 980 } }],
      lastOutcome: {
        task: "fish_shore",
        action: "fishShore",
        success: false,
        code: "ACCESS_DENIED",
        streak: 1,
        workComplete: false,
        unresolved: [{ action: "fishShore", task: "fish_shore", code: "ACCESS_DENIED" }],
      },
    });
    expect(planned.action).not.toBe("fishShore");
  });

  it("fail-closes llm mine_ore without treating it as an executor action name", () => {
    const planned = planCitizen({
      citizenId: "citizen_maya",
      observation: obs({
        position: { x: -953, y: 58, z: 945 },
        inventory: [{ name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
      llmGoal: "mine_ore",
      llmReason: "Need iron for better tools",
      knownSites: [{ kind: "ore", origin: { x: -953, y: 58, z: 945 }, citizenId: "citizen_maya", seenAt: "2026-09-20T00:00:00.000Z" }],
    });
    expect(planned.action).toBe("deferCapability");
    expect(planned.action).not.toBe("mine_ore");
    expect(planned.action).not.toBe("mineOre");
  });

  it("backs off gather_wood after repeated timeouts instead of looping", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({ food: 20 }),
      settlement: { ...emptySettlement(), shelterComplete: true, wood: 8, needs: [] },
      assignedNeeds: [],
      lastOutcome: {
        task: "gather_wood",
        action: "mineBlock",
        success: false,
        code: "TIMEOUT",
        streak: 3,
        retryable: true,
      },
    });
    expect(planned.action).toBe("observeNearby");
    expect(planned.reason).toMatch(/repeated failures/i);
  });

  it("lets Atlas and Maya plan from independent last outcomes", () => {
    const atlas = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 12,
        gameTime: 1_000,
        position: { x: -1043, y: 63, z: 980 },
        inventory: [{ name: "fishing_rod", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: ["NEED_FOOD"] },
      assignedNeeds: [],
      visibleShores: [{ stand: { x: -1043, y: 63, z: 980 }, water: { x: -1044, y: 62, z: 980 } }],
      lastOutcome: {
        task: "fish_shore",
        action: "fishShore",
        success: false,
        code: "ACCESS_DENIED",
        streak: 1,
        unresolved: [{ action: "fishShore", code: "ACCESS_DENIED" }],
      },
    });
    const maya = planCitizen({
      citizenId: "citizen_maya",
      observation: obs({
        food: 20,
        gameTime: 1_000,
        position: { x: -1065, y: 68, z: 847 },
        inventory: [{ name: "stone_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, wood: 8, needs: [] },
      assignedNeeds: [],
      availableHomes: [...WORLD_LAB_CLAIMABLE_HOMES],
    });
    expect(atlas.action).not.toBe("fishShore");
    expect(maya.action).toBe("claimHome");
    expect(maya.item).toBe("home_h9");
  });

  it("does not spin acquire_food forever after FOOD_NOT_FOUND; prefers fishing when a rod and shore exist", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 6,
        inventory: [{ name: "fishing_rod", count: 1 }],
        position: { x: -1043.5, y: 63, z: 981.5 },
      }),
      settlement: emptySettlement(),
      assignedNeeds: [],
      visibleShores: [{ stand: { x: -1043, y: 63, z: 980 }, water: { x: -1044, y: 62, z: 980 } }],
      lastOutcome: {
        task: "acquire_food",
        action: "gatherFood",
        success: false,
        code: "FOOD_NOT_FOUND",
        streak: 3,
        retryable: false,
      },
    });
    expect(planned.action).toBe("fishShore");
    expect(planned.target).toEqual({ x: -1043, y: 63, z: 980 });
  });

  it("backs off sleep_at_home after repeated STUCK on the same home route", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        isNight: true,
        gameTime: 14_000,
        position: { x: -1036, y: 64, z: 836 },
        inventory: [{ name: "wooden_pickaxe", count: 1 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true },
      assignedNeeds: [],
      home: {
        homeId: "home_h9",
        status: "active",
        bed: { x: -1067, y: 68, z: 848 },
        origin: { x: -1065, y: 68, z: 847 },
        entrance: { x: -1063, y: 68, z: 847 },
      },
      lastOutcome: {
        task: "sleep_at_home",
        action: "sleep",
        success: false,
        code: "STUCK",
        streak: 3,
        retryable: true,
        error: "no initial progress; obstacle=crafting_table",
      },
    });
    expect(planned.action).toBe("observeNearby");
    expect(planned.reason).toMatch(/crafting_table|blocked/i);
  });

  it("routes LLM proposals through the unified cognition map (gather_food / build_shelter)", () => {
    const food = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        inventory: [{ name: "wooden_pickaxe", count: 1 }, { name: "oak_log", count: 8 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: [] },
      assignedNeeds: [],
      home: {
        homeId: "home_h7",
        bed: { x: -1089, y: 68, z: 817 },
        origin: { x: -1089, y: 68, z: 817 },
        status: "active",
      },
      llmGoal: "gather_food",
      llmReason: "Need more food for the settlement",
    });
    expect(food.source).toBe("llm");
    expect(food.action).toBe("gatherFood");
    expect(food.task).toBe("gather_food");
    expect(food.occupation).toBe("gatherer");

    const shelter = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        inventory: [{ name: "wooden_pickaxe", count: 1 }, { name: "oak_log", count: 16 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: false, wood: 20, needs: [] },
      assignedNeeds: [],
      home: {
        homeId: "home_h7",
        bed: { x: -1089, y: 68, z: 817 },
        origin: { x: -1089, y: 68, z: 817 },
        status: "active",
      },
      llmGoal: "build_shelter",
      llmReason: "Finish the hut",
    });
    expect(shelter.source).toBe("llm");
    expect(shelter.action).toBe("buildShelter");
  });

  it("defers help_citizen from the planner LLM path (never shareItem)", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        inventory: [{ name: "wooden_pickaxe", count: 1 }, { name: "bread", count: 4 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: [] },
      assignedNeeds: [],
      home: {
        homeId: "home_h7",
        bed: { x: -1089, y: 68, z: 817 },
        origin: { x: -1089, y: 68, z: 817 },
        status: "active",
      },
      llmGoal: "help_citizen",
      llmReason: "Share food with a neighbor",
    });
    expect(planned.source).toBe("llm");
    expect(planned.action).toBe("deferCapability");
    expect(planned.task).toBe("help_citizen");
    expect(planned.action).not.toBe("shareItem");
  });

  it("routes contribute_to_project to buildStructure without inventing success", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        inventory: [{ name: "wooden_pickaxe", count: 1 }, { name: "oak_log", count: 32 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: [] },
      assignedNeeds: [],
      home: {
        homeId: "home_h7",
        bed: { x: -1089, y: 68, z: 817 },
        origin: { x: -1089, y: 68, z: 817 },
        status: "active",
      },
      llmGoal: "contribute_to_project",
      llmReason: "Help with the workshop",
    });
    expect(planned.source).toBe("llm");
    expect(planned.action).toBe("buildStructure");
    expect(planned.task).toBe("build_structure");
  });

  it("does not execute unrecognized model goals as arbitrary executor actions", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        inventory: [{ name: "wooden_pickaxe", count: 1 }, { name: "oak_log", count: 8 }],
      }),
      settlement: { ...emptySettlement(), shelterComplete: true, needs: [] },
      assignedNeeds: [],
      home: {
        homeId: "home_h7",
        bed: { x: -1089, y: 68, z: 817 },
        origin: { x: -1089, y: 68, z: 817 },
        status: "active",
      },
      llmGoal: "teleport_home",
      llmReason: "Warp to bed",
    });
    expect(planned.action).toBe("deferCapability");
    expect(planned.action).not.toBe("teleport_home");
    expect(planned.task).toBe("unsupported_goal");
  });

  it("preserves LLM-disabled deterministic planner behavior (no llmGoal)", () => {
    const planned = planCitizen({
      citizenId: "citizen_atlas",
      observation: obs({
        food: 20,
        inventory: [{ name: "wooden_pickaxe", count: 1 }],
      }),
      settlement: {
        ...emptySettlement(),
        food: 20,
        wood: 40,
        stone: 40,
        tools: 4,
        needs: ["NEED_HOUSING"],
        shelterComplete: false,
      },
      assignedNeeds: ["NEED_HOUSING"],
      workRole: "build",
    });
    expect(planned.source).toBe("planner");
    expect(planned.action).toBe("buildShelter");
    expect(planned.task).toBe("build_shelter");
  });
});
