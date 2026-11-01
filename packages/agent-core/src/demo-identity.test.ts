import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  generatePersonality,
  loadConfig,
  withEventVisibility,
  type SimEvent,
} from "@civ/shared";
import { CivilizationStore } from "./store.js";
import { buildCitizenContextPack, ensureCitizenPersonality } from "./citizen-context.js";
import { experimentWorkAssignment } from "./planner.js";

function tempDb(): CivilizationStore {
  const dir = mkdtempSync(join(tmpdir(), "civ-m12-"));
  return new CivilizationStore(join(dir, "test.sqlite"));
}

function demoCfg(overrides: Record<string, string> = {}) {
  return loadConfig({
    DEMO_PROFILE: "three_citizen",
    SIM_CITIZEN_COUNT: "3",
    SIM_ASSIGN_WORK_ROLES: "false",
    SIM_PERMADEATH_ENABLED: "false",
    DEMO_PERSONALITY_SEED: "civ-demo-2026",
    DEMO_BULLETIN_TARGET_TOKENS: "200",
    LLM_PROVIDER: "none",
    LLM_ENABLED: "false",
    CLOUD_LLM_ENABLED: "false",
    ...overrides,
  });
}

describe("Mission 012 — personality persistence", () => {
  it("traits persist through restart and are not silently rerolled", () => {
    const path = join(mkdtempSync(join(tmpdir(), "civ-m12p-")), "p.sqlite");
    const store = new CivilizationStore(path);
    const first = ensureCitizenPersonality(store, "citizen_atlas", "civ-demo-2026");
    expect(first).toBeDefined();
    const json = store.getCitizen("citizen_atlas")?.personalityJson;
    expect(json).toBeTruthy();

    // Attempt overwrite with different seed — ensurePersonality must no-op.
    const different = generatePersonality("other-seed", "citizen_atlas");
    expect(store.ensurePersonality("citizen_atlas", JSON.stringify(different))).toBe(false);
    expect(store.getCitizen("citizen_atlas")?.personalityJson).toBe(json);

    store.close();
    const restored = new CivilizationStore(path);
    const again = ensureCitizenPersonality(restored, "citizen_atlas", "other-seed");
    expect(again?.traits).toEqual(first?.traits);
    // Simulate respawn identity restore without trait loss.
    restored.restoreLivingIdentity("citizen_atlas", "respawn");
    expect(parseTraits(restored.getCitizen("citizen_atlas")?.personalityJson)).toEqual(first?.traits);
    restored.close();
  });
});

function parseTraits(json?: string) {
  return json ? (JSON.parse(json) as { traits: Record<string, number> }).traits : undefined;
}

describe("Mission 012 — work roles and government not auto-assigned", () => {
  it("experiment work assignment stays empty when roles disabled", () => {
    const { roles, assignedNeeds } = experimentWorkAssignment(
      ["citizen_atlas", "citizen_maya", "citizen_theo"],
      ["NEED_FOOD", "NEED_HOUSING"],
      false,
    );
    expect(roles.size).toBe(0);
    expect([...assignedNeeds.values()].every((needs) => needs.length === 0)).toBe(true);
  });
});

describe("Mission 012 — delivery isolation and context packs", () => {
  it("multiple citizens retain isolated delivery state from shared history", () => {
    const store = tempDb();
    // SEC-001: broadcast events need a verified audience; one colony community holds all three citizens.
    store.upsertCommunity("colony");
    for (const id of ["citizen_atlas", "citizen_maya", "citizen_theo"]) store.addCommunityMember("colony", id);
    const config = demoCfg();
    const events: SimEvent[] = [
      {
        id: "ann-1",
        type: "HumanDirectiveIssued",
        timestamp: "2026-10-27T12:00:00.000Z",
        payload: withEventVisibility(
          { announcement: "Seek food and shelter.", message: "Seek food and shelter." },
          { class: "world_public", audience: { scope: "world" } },
        ),
      },
      {
        id: "chat-maya",
        type: "ConversationOccurred",
        timestamp: "2026-10-27T12:01:00.000Z",
        citizenId: "citizen_maya",
        payload: withEventVisibility(
          { message: "Maya private note to Atlas only" },
          { class: "directed", audienceIds: ["citizen_maya", "citizen_atlas"] },
        ),
      },
      {
        id: "secret-atlas",
        type: "ResourceCollected",
        timestamp: "2026-10-27T12:02:00.000Z",
        citizenId: "citizen_atlas",
        payload: withEventVisibility(
          { summary: "Atlas found a hidden cave stash" },
          { class: "actor_private", audienceIds: ["citizen_atlas"] },
        ),
      },
      {
        id: "inv-atlas",
        type: "MemoryCreated",
        timestamp: "2026-10-27T12:03:00.000Z",
        citizenId: "citizen_atlas",
        payload: withEventVisibility(
          { summary: "Atlas private inventory: 9 cooked_beef" },
          { class: "actor_private", audienceIds: ["citizen_atlas"] },
        ),
      },
      {
        id: "dbg",
        type: "SystemIncident",
        timestamp: "2026-10-27T12:04:00.000Z",
        payload: withEventVisibility({ summary: "observer debug only" }, { class: "observer_only" }),
      },
    ];
    for (const event of events) store.appendEvent(event);

    const atlas = buildCitizenContextPack({ store, config, citizenId: "citizen_atlas", events });
    const maya = buildCitizenContextPack({ store, config, citizenId: "citizen_maya", events });
    const theo = buildCitizenContextPack({ store, config, citizenId: "citizen_theo", events });

    expect(atlas.personality).toBeDefined();
    expect(maya.personality).toBeDefined();
    expect(theo.personality).toBeDefined();
    expect(atlas.personality?.traits).not.toEqual(maya.personality?.traits);
    expect(maya.personality?.traits).not.toEqual(theo.personality?.traits);

    expect(atlas.bulletin.text).toContain("Seek food and shelter");
    expect(maya.bulletin.text).toContain("Maya private note");
    expect(theo.bulletin.text).not.toContain("Maya private note");
    expect(theo.bulletin.text).not.toContain("hidden cave");
    expect(theo.bulletin.text).not.toContain("cooked_beef");
    expect(theo.bulletin.text).not.toContain("observer debug");
    expect(atlas.bulletin.text).toContain("hidden cave");

    // Observer retains complete audit record.
    const observer = store.listAllEventsForObserver(50);
    expect(observer.map((e) => e.id).sort()).toEqual(events.map((e) => e.id).sort());

    // Isolated delivery: second pack for Theo should not re-deliver public ann.
    const theoAgain = buildCitizenContextPack({ store, config, citizenId: "citizen_theo", events });
    expect(theoAgain.bulletin.lines.some((l) => l.eventId === "ann-1")).toBe(false);
    expect(store.getDeliveredEventIds("citizen_atlas").has("secret-atlas")).toBe(true);
    expect(store.getDeliveredEventIds("citizen_theo").has("secret-atlas")).toBe(false);

    // Late visibility: promote observer-only to public for Theo without losing it.
    const late: SimEvent = {
      ...events[4]!,
      payload: withEventVisibility({ summary: "observer debug only" }, { class: "world_public", audience: { scope: "world" } }),
    };
    const latePack = buildCitizenContextPack({
      store,
      config,
      citizenId: "citizen_theo",
      events: [...events.slice(0, 4), late],
    });
    expect(latePack.bulletin.lines.some((l) => l.eventId === "dbg")).toBe(true);

    expect(atlas.sharedObjective).toContain("Survive");
    expect(atlas.promptExtras.personalityContext).toContain("tendencies");
    store.close();
  });

  it("demo model configuration is consistent across citizens (shared seed + objective)", () => {
    const store = tempDb();
    const config = demoCfg({ OPENAI_MODEL: "gpt-4o-mini", LLM_PROVIDER: "openai" });
    const packs = ["citizen_atlas", "citizen_maya", "citizen_theo"].map((id) =>
      buildCitizenContextPack({ store, config, citizenId: id, events: [] }),
    );
    expect(new Set(packs.map((p) => p.sharedObjective)).size).toBe(1);
    expect(packs.every((p) => p.personality?.seed === "civ-demo-2026")).toBe(true);
    store.close();
  });
});
