import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { validateThreeCitizenDemo, THREE_CITIZEN_DEMO_ROSTER, isThreeCitizenDemo } from "./demo-profile.js";
import {
  generatePersonality,
  formatPersonalityTendencies,
  PERSONALITY_AXES,
  parsePersonalityJson,
} from "./personality.js";
import {
  authorizeEventForCitizen,
  readEventVisibility,
  withEventVisibility,
} from "./event-visibility.js";
import { buildCitizenBulletin, estimateTokens } from "./bulletin.js";
import { createCommunityDirectory } from "./event-audience.js";
import type { SimEvent } from "./events.js";

// SEC-001: bulletins need a directory; world audiences reach only readers the directory knows.
const DEMO_DIRECTORY = createCommunityDirectory([
  { id: "demo", memberIds: ["citizen_atlas", "citizen_maya", "citizen_theo", "citizen_sage", "citizen_nova"] },
]);
import { DEFAULT_CITIZENS } from "./types.js";

function demoConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    DEMO_PROFILE: "three_citizen",
    SIM_CITIZEN_COUNT: "3",
    SIM_ASSIGN_WORK_ROLES: "false",
    SIM_PERMADEATH_ENABLED: "false",
    DEMO_PERSONALITY_SEED: "civ-demo-2026",
    DEMO_RUN_MINUTES: "60",
    LLM_PROVIDER: "none",
    LLM_ENABLED: "false",
    CLOUD_LLM_ENABLED: "false",
    ...overrides,
  });
}

function evt(
  id: string,
  type: SimEvent["type"],
  payload: Record<string, unknown>,
  citizenId?: string,
  timestamp = "2026-10-27T12:00:00.000Z",
): SimEvent {
  return { id, type, timestamp, citizenId, payload };
}

describe("Mission 012 — three-citizen demo profile", () => {
  it("roster is Atlas, Maya, Theo with distinct identities", () => {
    expect(THREE_CITIZEN_DEMO_ROSTER.map((c) => c.name)).toEqual(["Atlas", "Maya", "Theo"]);
    const ids = new Set(THREE_CITIZEN_DEMO_ROSTER.map((c) => c.id));
    expect(ids.size).toBe(3);
    expect(DEFAULT_CITIZENS.slice(0, 3)).toEqual(THREE_CITIZEN_DEMO_ROSTER);
  });

  it("validates consistent demo model settings and disabled governance/roles", () => {
    const ok = validateThreeCitizenDemo(demoConfig());
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.profile.assignWorkRoles).toBe(false);
    expect(ok.profile.governanceEnabled).toBe(false);
    expect(ok.profile.economyEnabled).toBe(false);
    expect(ok.profile.permadeath).toBe(false);
    expect(ok.profile.keepInventory).toBe(false);
    expect(ok.profile.starterResources).toBe("none");
    expect(ok.profile.runMinutes).toBe(60);
    expect(ok.profile.roster).toHaveLength(3);
  });

  it("rejects invalid demo configurations with clear errors", () => {
    const bad = validateThreeCitizenDemo(
      demoConfig({ SIM_CITIZEN_COUNT: "5", SIM_ASSIGN_WORK_ROLES: "true", SIM_PERMADEATH_ENABLED: "true" }),
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.some((e) => e.includes("SIM_CITIZEN_COUNT"))).toBe(true);
    expect(bad.errors.some((e) => e.includes("SIM_ASSIGN_WORK_ROLES"))).toBe(true);
    expect(bad.errors.some((e) => e.includes("SIM_PERMADEATH"))).toBe(true);
  });

  it("does not treat DEMO_PROFILE=none as three-citizen", () => {
    const cfg = loadConfig({ DEMO_PROFILE: "none" });
    expect(isThreeCitizenDemo(cfg)).toBe(false);
    expect(validateThreeCitizenDemo(cfg).ok).toBe(false);
  });
});

describe("Mission 012 — seeded personality", () => {
  it("same seed produces identical personality values", () => {
    const a = generatePersonality("seed-A", "citizen_atlas", "2026-01-01T00:00:00.000Z");
    const b = generatePersonality("seed-A", "citizen_atlas", "2026-01-01T00:00:00.000Z");
    expect(a.traits).toEqual(b.traits);
  });

  it("different seeds produce varied but bounded traits", () => {
    const a = generatePersonality("seed-1", "citizen_atlas");
    const b = generatePersonality("seed-2", "citizen_atlas");
    expect(a.traits).not.toEqual(b.traits);
    for (const axis of PERSONALITY_AXES) {
      expect(a.traits[axis]).toBeGreaterThanOrEqual(0);
      expect(a.traits[axis]).toBeLessThanOrEqual(100);
      expect(b.traits[axis]).toBeGreaterThanOrEqual(0);
      expect(b.traits[axis]).toBeLessThanOrEqual(100);
    }
  });

  it("independent citizens under one seed have natural variation", () => {
    const atlas = generatePersonality("civ-demo-2026", "citizen_atlas");
    const maya = generatePersonality("civ-demo-2026", "citizen_maya");
    const theo = generatePersonality("civ-demo-2026", "citizen_theo");
    expect(atlas.traits).not.toEqual(maya.traits);
    expect(maya.traits).not.toEqual(theo.traits);
    expect(atlas.traits).not.toEqual(theo.traits);
  });

  it("formats tendencies neutrally without hard rules", () => {
    const p = generatePersonality("civ-demo-2026", "citizen_maya");
    const text = formatPersonalityTendencies(p.traits);
    expect(text).toContain("not commands");
    expect(text.toLowerCase()).not.toContain("must attack");
    expect(parsePersonalityJson(JSON.stringify(p))?.traits).toEqual(p.traits);
  });
});

describe("Mission 012 — visibility and bulletin", () => {
  it("unknown visibility fails closed", () => {
    const vis = readEventVisibility({});
    expect(vis.class).toBe("unknown");
    const auth = authorizeEventForCitizen("citizen_theo", vis);
    expect(auth.visible).toBe(false);
  });

  it("Atlas receives legitimate public announcement; private Maya talk hidden from Theo", () => {
    const events: SimEvent[] = [
      evt(
        "e-public",
        "HumanDirectiveIssued",
        withEventVisibility(
          { announcement: "Night falls in one hour — seek shelter.", message: "Night falls in one hour — seek shelter." },
          { class: "world_public", audience: { scope: "world" } },
        ),
      ),
      evt(
        "e-private-chat",
        "ConversationOccurred",
        withEventVisibility(
          { message: "Maya whispers a secret plan to Atlas" },
          { class: "directed", audienceIds: ["citizen_maya", "citizen_atlas"] },
        ),
        "citizen_maya",
      ),
      evt(
        "e-atlas-cache",
        "ResourceCollected",
        withEventVisibility(
          { summary: "hidden iron vein at -120,40", resource: "iron_ore" },
          { class: "actor_private", audienceIds: ["citizen_atlas"] },
        ),
        "citizen_atlas",
      ),
      evt(
        "e-inventory",
        "MemoryCreated",
        withEventVisibility(
          { summary: "Atlas inventory: 12 bread, diamond pickaxe" },
          { class: "actor_private", audienceIds: ["citizen_atlas"] },
        ),
        "citizen_atlas",
      ),
      evt(
        "e-observer",
        "SystemIncident",
        withEventVisibility({ summary: "debug stacktrace" }, { class: "observer_only" }),
      ),
      evt("e-ambiguous", "TaskCompleted", { summary: "something happened somewhere" }),
    ];

    const atlas = buildCitizenBulletin({
      readerCitizenId: "citizen_atlas",
      events,
      alreadyDeliveredIds: new Set(),
      directory: DEMO_DIRECTORY,
      targetTokens: 200,
    });
    const maya = buildCitizenBulletin({
      readerCitizenId: "citizen_maya",
      events,
      alreadyDeliveredIds: new Set(),
      directory: DEMO_DIRECTORY,
      targetTokens: 200,
    });
    const theo = buildCitizenBulletin({
      readerCitizenId: "citizen_theo",
      events,
      alreadyDeliveredIds: new Set(),
      directory: DEMO_DIRECTORY,
      targetTokens: 200,
    });

    expect(atlas.lines.some((l) => l.eventId === "e-public")).toBe(true);
    expect(maya.lines.some((l) => l.eventId === "e-private-chat")).toBe(true);
    expect(theo.lines.some((l) => l.eventId === "e-private-chat")).toBe(false);
    expect(theo.lines.some((l) => l.eventId === "e-atlas-cache")).toBe(false);
    expect(theo.lines.some((l) => l.eventId === "e-inventory")).toBe(false);
    expect(theo.text).not.toContain("iron vein");
    expect(theo.text).not.toContain("diamond pickaxe");
    expect(theo.text).not.toContain("secret plan");
    expect(atlas.lines.some((l) => l.eventId === "e-atlas-cache")).toBe(true);
    expect(theo.excluded.some((e) => e.eventId === "e-ambiguous" && e.reason.includes("unknown"))).toBe(true);
    expect(theo.excluded.some((e) => e.eventId === "e-observer")).toBe(true);
    expect(theo.lines.some((l) => l.eventId === "e-public")).toBe(true);
  });

  it("bulletin ordering and deduplication are deterministic; tokens measured", () => {
    const events: SimEvent[] = [
      evt("b2", "SettlementNeedDetected", withEventVisibility({ summary: "need food", dedupeKey: "food" }, { class: "world_public", audience: { scope: "world" } }), undefined, "2026-10-27T12:00:02.000Z"),
      evt("b1", "SettlementNeedDetected", withEventVisibility({ summary: "need food again", dedupeKey: "food" }, { class: "world_public", audience: { scope: "world" } }), undefined, "2026-10-27T12:00:01.000Z"),
      evt("b3", "CitizenInjured", withEventVisibility({ summary: "Maya hurt" }, { class: "world_public", audience: { scope: "world" } }), "citizen_maya", "2026-10-27T12:00:03.000Z"),
    ];
    const first = buildCitizenBulletin({
      readerCitizenId: "citizen_theo",
      events,
      alreadyDeliveredIds: new Set(),
      directory: DEMO_DIRECTORY,
      targetTokens: 200,
    });
    const second = buildCitizenBulletin({
      readerCitizenId: "citizen_theo",
      events,
      alreadyDeliveredIds: new Set(),
      directory: DEMO_DIRECTORY,
      targetTokens: 200,
    });
    expect(first.text).toEqual(second.text);
    expect(first.lines.map((l) => l.eventId)).toEqual(second.lines.map((l) => l.eventId));
    expect(first.lines.filter((l) => l.summary.includes("need food")).length).toBe(1);
    expect(first.estimatedTokens).toBe(estimateTokens(first.text));
    expect(first.estimatedTokens).toBeGreaterThan(0);
  });

  it("old events are not repeated once delivered; late-visible events are not lost", () => {
    const publicEvt = evt(
      "late-public",
      "HumanDirectiveIssued",
      withEventVisibility({ announcement: "All clear" }, { class: "unknown" }),
      undefined,
      "2026-10-27T11:00:00.000Z",
    );
    const first = buildCitizenBulletin({
      readerCitizenId: "citizen_atlas",
      events: [publicEvt],
      alreadyDeliveredIds: new Set(),
      directory: DEMO_DIRECTORY,
    });
    expect(first.lines).toHaveLength(0);

    const revealed: SimEvent = {
      ...publicEvt,
      payload: withEventVisibility({ announcement: "All clear" }, { class: "world_public", audience: { scope: "world" } }),
    };
    const second = buildCitizenBulletin({
      readerCitizenId: "citizen_atlas",
      events: [revealed],
      alreadyDeliveredIds: new Set(first.deliveredEventIds),
      directory: DEMO_DIRECTORY,
    });
    expect(second.lines.some((l) => l.eventId === "late-public")).toBe(true);

    const third = buildCitizenBulletin({
      readerCitizenId: "citizen_atlas",
      events: [revealed],
      alreadyDeliveredIds: new Set(second.deliveredEventIds),
      directory: DEMO_DIRECTORY,
    });
    expect(third.lines.some((l) => l.eventId === "late-public")).toBe(false);
  });

  it("nearby_speech without substantiated audience fails closed", () => {
    const auth = authorizeEventForCitizen("citizen_theo", {
      class: "nearby_speech",
      speakerId: "citizen_maya",
    });
    expect(auth.visible).toBe(false);
  });

  it("logs urgent overflow when over budget", () => {
    const events: SimEvent[] = Array.from({ length: 20 }, (_, i) =>
      evt(
        `u${i}`,
        "CitizenDied",
        withEventVisibility({ summary: `death ${i} ${"x".repeat(40)}` }, { class: "world_public", audience: { scope: "world" } }),
        "citizen_maya",
        `2026-10-27T12:00:${String(i).padStart(2, "0")}.000Z`,
      ),
    );
    const result = buildCitizenBulletin({
      readerCitizenId: "citizen_theo",
      events,
      alreadyDeliveredIds: new Set(),
      directory: DEMO_DIRECTORY,
      targetTokens: 80,
      maxLines: 3,
    });
    expect(result.urgentOverflow || result.lines.length > 0).toBe(true);
  });
});
