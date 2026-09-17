import { describe, expect, it } from "vitest";
import { createEvent } from "./events.js";
import { translateError } from "./error-copy.js";
import {
  aggregatePresentedEvents,
  eventImportance,
  filterPresentedEvents,
  presentEvent,
} from "./format-event.js";
import {
  citizenDisplayName,
  formatLocalTime,
  formatWorldClock,
  friendlyItem,
  friendlyTask,
  relationshipPercent,
} from "./friendly-names.js";
import { buildObserverView } from "./observer-view.js";

const names = { citizen_atlas: "Atlas", citizen_maya: "Maya", citizen_kai: "Kai" };

describe("friendly names", () => {
  it("uses Atlas instead of citizen_atlas", () => {
    expect(citizenDisplayName("citizen_atlas")).toBe("Atlas");
    expect(citizenDisplayName("citizen_atlas", names)).toBe("Atlas");
  });

  it("uses friendly task names and a readable fallback", () => {
    expect(friendlyTask("gather_wood")).toBe("gathering wood");
    expect(friendlyTask("gather_food")).toBe("finding food");
    expect(friendlyTask("mine_stone")).toBe("mining stone");
    expect(friendlyTask("contribute_to_project")).toBe("helping with the settlement project");
    expect(friendlyTask("some_new_task")).toBe("some new task");
  });

  it("formats item counts", () => {
    expect(friendlyItem("oak_log", 4)).toBe("oak logs");
    expect(friendlyItem("wooden_pickaxe", 1)).toBe("a wooden pickaxe");
  });
});

describe("error translation", () => {
  it("translates technical failures into human copy", () => {
    expect(translateError("TIMEOUT GoalNear(243,73,162)", "build_shelter").headline).toMatch(/couldn't reach the shelter site/);
    expect(translateError("TIMEOUT GoalNear(243,73,162)").subtext).toMatch(/Movement stopped after no progress was made/);
    expect(translateError("TARGET_BLACKLISTED").headline).toMatch(/gave up on an unreachable target/);
    expect(translateError("NO_RECIPE wooden_pickaxe").subtext).toMatch(/wooden pickaxe/);
    expect(translateError("MISSING 2 STICK").subtext).toBe("Missing 2 sticks.");
    expect(translateError("client timed out after 30000 milliseconds").headline).toMatch(/lost connection/);
    expect(translateError("client timed out after 30000 milliseconds").subtext).toMatch(/Trying to reconnect/);
  });
});

describe("event presentation", () => {
  it("formats the observer headlines from the spec", () => {
    expect(presentEvent(createEvent("TaskStarted", { task: "gather_wood" }, "citizen_atlas")).headline).toBe(
      "Atlas is moving toward trees.",
    );
    expect(presentEvent(createEvent("TaskStarted", { task: "mine_stone" }, "citizen_atlas")).headline).toBe(
      "Atlas is mining stone.",
    );
    expect(presentEvent(createEvent("TaskCompleted", { task: "gather_wood" }, "citizen_atlas")).headline).toBe(
      "Atlas finished gathering wood.",
    );
    expect(presentEvent(createEvent("CitizenRespawned", {}, "citizen_ava")).headline).toBe(
      "Ava respawned and returned to the simulation.",
    );
    expect(
      presentEvent(createEvent("CitizenDied", { permanent: true, terminal: true }, "citizen_ava")).headline,
    ).toBe("Ava died permanently.");
    expect(presentEvent(createEvent("ItemCrafted", { item: "wooden_pickaxe" }, "citizen_kai")).headline).toBe(
      "Kai crafted a wooden pickaxe.",
    );
    expect(
      presentEvent(createEvent("ItemDeposited", { item: "oak_log", count: 8 }, "citizen_atlas")).headline,
    ).toBe("Atlas stored 8 oak logs in the shared chest.");
    expect(
      presentEvent(createEvent("ItemWithdrawn", { item: "oak_log", count: 4 }, "citizen_theo")).headline,
    ).toBe("Theo took 4 oak logs from the shared chest.");
    expect(
      presentEvent(
        createEvent("ItemTransferCompleted", { item: "bread", count: 3, receiver: "citizen_atlas" }, "citizen_maya"),
        names,
      ).headline,
    ).toBe("Maya gave Atlas 3 bread.");
    expect(presentEvent(createEvent("SettlementProjectCreated", {})).headline).toMatch(/planning its first shelter/);
    expect(
      presentEvent(createEvent("ConstructionProgress", { placed: 27, total: 46 }, "citizen_theo")).headline,
    ).toBe("Starter shelter: 27 / 46 blocks complete.");
    expect(presentEvent(createEvent("ConstructionCompleted", {})).headline).toBe("The first shelter was completed.");
  });

  it("keeps debug events out of the default feed", () => {
    expect(eventImportance("ActionStarted")).toBe("DEBUG");
    expect(eventImportance("TaskStarted")).toBe("NORMAL");
    expect(eventImportance("CitizenDied")).toBe("MAJOR");
    const events = [
      presentEvent(createEvent("ActionStarted", { action: "moveTo" }, "citizen_atlas")),
      presentEvent(createEvent("TaskStarted", { task: "gather_wood" }, "citizen_atlas")),
    ];
    expect(filterPresentedEvents(events, false)).toHaveLength(1);
    expect(filterPresentedEvents(events, true)).toHaveLength(2);
  });

  it("aggregates noisy collect and construction events", () => {
    const collected = aggregatePresentedEvents(
      Array.from({ length: 4 }, () =>
        presentEvent(createEvent("ResourceCollected", { name: "oak_log", count: 1 }, "citizen_atlas")),
      ),
    );
    expect(collected).toHaveLength(1);
    expect(collected[0]?.headline).toBe("Atlas collected 4 oak logs.");

    const built = aggregatePresentedEvents(
      Array.from({ length: 12 }, () =>
        presentEvent({
          type: "ConstructionBlockPlaced",
          timestamp: new Date().toISOString(),
          citizenId: "citizen_kai",
          payload: {},
        }),
      ),
    );
    expect(built).toHaveLength(1);
    expect(built[0]?.headline).toBe("Kai added 12 blocks to the starter shelter.");
  });
});

describe("local time and relationships", () => {
  it("shows a local clock instead of a raw ISO stamp", () => {
    const stamp = "2026-09-16T22:41:31.581Z";
    const label = formatLocalTime(stamp, new Date("2026-09-16T23:00:00Z"));
    expect(label).not.toMatch(/T22:41/);
    expect(label).toMatch(/\d/);
    expect(formatWorldClock(stamp, { gameTime: 24000, isNight: true })).toMatch(/Minecraft Day 2 — Night/);
  });

  it("formats relationship percentages without extra decimals", () => {
    expect(relationshipPercent(0.271)).toBe(27);
    expect(relationshipPercent(0.184)).toBe(18);
  });
});

describe("learning vs system", () => {
  it("keeps citizen learning separate from system incidents", () => {
    const view = buildObserverView(
      {
        updatedAt: new Date().toISOString(),
        population: 2,
        activeBots: 2,
        citizens: [
          {
            id: "citizen_atlas",
            name: "Atlas",
            connected: true,
            status: "online",
            currentTask: "gather_wood",
            currentGoal: "gather_wood",
            health: 18,
            hunger: 14,
            lastKnownPosition: { x: 10, y: 70, z: 10 },
          },
          { id: "citizen_maya", name: "Maya", connected: true, status: "online" },
        ],
        settlement: {
          id: "s1",
          name: "First Settlement",
          food: 12,
          wood: 34,
          stone: 18,
          beds: 0,
          housingCapacity: 0,
          tools: 0,
          shelterComplete: false,
          origin: { x: 8, y: 70, z: 8 },
          storage: { x: 9, y: 70, z: 9 },
          construction: { blueprintId: "starter", startedAt: new Date().toISOString(), totalBlocks: 46, placedBlocks: 31, complete: false },
          needs: ["NEED_FOOD", "NEED_TOOLS", "NEED_HOUSING"],
        },
        events: [
          createEvent("ErrorOccurred", { error: "client timed out after 30000 milliseconds" }, "citizen_atlas"),
          createEvent("LessonCreated", { lesson: "Bring a pickaxe before trying to collect stone." }, "citizen_atlas"),
        ],
        memories: [
          {
            id: "m1",
            citizenId: "citizen_atlas",
            kind: "social",
            content: "Maya gave him food when he was hungry.",
            importance: 0.8,
            createdAt: new Date().toISOString(),
          },
          {
            id: "m2",
            citizenId: "citizen_atlas",
            kind: "world",
            content: "Bring a pickaxe before trying to collect stone.",
            importance: 0.9,
            createdAt: new Date().toISOString(),
          },
        ],
        relationships: [
          {
            citizenId: "citizen_atlas",
            otherId: "citizen_maya",
            trust: 0.27,
            affection: 0.18,
            respect: 0.22,
            resentment: 0,
            familiarity: 0.46,
          },
        ],
        performance: { avgTickMs: 18, llmInFlight: 1, activePaths: 2 },
      },
      {
        directives: [],
        directivesEnabled: true,
        runId: "dev-2026-09-16-03",
        permanentDeath: false,
      },
    );

    expect(view.citizens[0]?.activity).toBe("Gathering wood");
    expect(view.citizens[0]?.healthLabel).toBe("Health 18 / 20");
    expect(view.citizens[0]?.location).toBe("Near the village");
    expect(view.settlement.food).toBe(12);
    expect(view.settlement.logs).toBe(34);
    expect(view.settlement.shelter?.status).toBe("BUILDING");
    expect(view.settlement.needs).toEqual(["Food", "Stone tools", "Shelter"]);
    expect(view.health.permanentDeath).toBe("OFF");
    expect(view.health.averageTick).toBe("18 ms");
    expect(view.learned[0]?.text).toMatch(/pickaxe/);
    expect(view.remembers[0]?.text).toMatch(/Maya gave him food/);
    expect(view.incidents.some((row) => /connection/i.test(row.headline))).toBe(true);
    expect(view.relationships[0]).toMatchObject({ from: "Atlas", to: "Maya", trust: 27, familiarity: 46 });
    expect(view.learned.every((row) => !/timed out/i.test(row.text))).toBe(true);
  });
});
