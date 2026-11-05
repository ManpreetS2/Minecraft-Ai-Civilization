import { describe, expect, it } from "vitest";
import { auditInformationBoundaries, buildDirectory } from "../src/information-verifier.js";
import type { EventStreamItem, PersistentFactItem } from "../src/schemas.js";

describe("Information Verifier — Audience, Privacy, and Provenance Boundaries", () => {
  const directory = buildDirectory([
    { id: "north_cove", memberIds: ["gpt_atlas", "gpt_maya"] },
    { id: "south_vale", memberIds: ["claude_theo", "claude_ava"] },
  ]);

  it("detects cross-community leakage of settlement_public events", () => {
    const events: EventStreamItem[] = [
      {
        id: "ev-settlement-1",
        type: "ResourceDeposited",
        timestamp: "2026-11-01T12:00:00.000Z",
        citizenId: "gpt_atlas",
        payload: {
          item: "iron_ore",
          count: 5,
          visibility: {
            class: "settlement_public",
            audience: { scope: "community", communityId: "north_cove" },
          },
        },
      },
    ];

    // Leaked delivery to a member of south_vale!
    const deliveries = [
      {
        citizenId: "claude_theo",
        eventId: "ev-settlement-1",
        deliveredAt: "2026-11-01T12:00:01.000Z",
      },
    ];

    const audit = auditInformationBoundaries({
      events,
      deliveries,
      directory,
    });

    expect(audit.valid).toBe(false);
    expect(audit.violations.length).toBe(1);
    expect(audit.violations[0]?.violationType).toBe("RIVAL_SETTLEMENT_LEAK");
    expect(audit.violations[0]?.description).toContain("Cross-community leakage");
  });

  it("detects actor_private events leaked to other citizens", () => {
    const events: EventStreamItem[] = [
      {
        id: "ev-private-1",
        type: "ItemCrafted",
        timestamp: "2026-11-01T12:00:00.000Z",
        citizenId: "gpt_atlas",
        payload: {
          item: "diamond_sword",
          visibility: {
            class: "actor_private",
            audienceIds: ["gpt_atlas"],
          },
        },
      },
    ];

    const deliveries = [
      {
        citizenId: "gpt_maya", // Even within same community, actor_private cannot be delivered to others!
        eventId: "ev-private-1",
        deliveredAt: "2026-11-01T12:00:01.000Z",
      },
    ];

    const audit = auditInformationBoundaries({
      events,
      deliveries,
      directory,
    });

    expect(audit.valid).toBe(false);
    expect(audit.violations[0]?.violationType).toBe("ACTOR_PRIVATE_LEAK");
  });

  it("detects spoken claims incorrectly promoted to confirmed world truth", () => {
    const events: EventStreamItem[] = [
      {
        id: "ev-speech-1",
        type: "ConversationOccurred",
        timestamp: "2026-11-01T12:00:00.000Z",
        citizenId: "gpt_atlas",
        payload: {
          message: "I saw a hidden cave full of gold at 50, 64, 50",
          visibility: {
            class: "nearby_speech",
            speakerId: "gpt_atlas",
            audienceIds: ["gpt_maya"],
          },
        },
      },
    ];

    // Maya records this spoken claim as an 'observed_fact' instead of 'communicated_claim'!
    const facts: PersistentFactItem[] = [
      {
        id: "fact-maya-1",
        citizenId: "gpt_maya",
        factKey: "gold_cave_location",
        content: "There is a hidden cave full of gold at 50, 64, 50",
        kind: "observed_fact", // Violation!
        createdAt: "2026-11-01T12:00:02.000Z",
        sourceEventId: "ev-speech-1",
      },
    ];

    const audit = auditInformationBoundaries({
      events,
      facts,
      directory,
    });

    expect(audit.valid).toBe(false);
    expect(audit.violations[0]?.violationType).toBe("CLAIM_PROMOTED_TO_FACT");
    expect(audit.violations[0]?.description).toContain("recorded as an 'observed_fact' instead of 'communicated_claim'");
  });

  it("detects unobserved rival settlement coordinates in citizen knowledge", () => {
    const events: EventStreamItem[] = [];
    const facts: PersistentFactItem[] = [
      {
        id: "fact-theo-1",
        citizenId: "claude_theo", // south_vale
        factKey: "enemy_camp",
        content: "The north_cove camp is at x=100, z=100 with 2 citizens",
        kind: "observed_fact",
        createdAt: "2026-11-01T12:00:00.000Z",
      },
    ];

    const rivalSites = [
      { communityId: "north_cove", x: 100, y: 64, z: 100 },
      { communityId: "south_vale", x: 250, y: 64, z: 250 },
    ];

    // Theo never traveled within 32 blocks of (100, 100)
    const citizenPositions = new Map<string, Array<{ x: number; y: number; z: number }>>([
      ["claude_theo", [{ x: 250, y: 64, z: 250 }, { x: 240, y: 64, z: 245 }]],
    ]);

    const audit = auditInformationBoundaries({
      events,
      facts,
      directory,
      rivalSites,
      citizenPositionsHistory: citizenPositions,
    });

    expect(audit.valid).toBe(false);
    expect(audit.violations[0]?.violationType).toBe("RIVAL_SETTLEMENT_LEAK");
    expect(audit.violations[0]?.description).toContain("holds unobserved rival settlement knowledge");
  });

  it("detects private chest content disclosure across citizens", () => {
    const events: EventStreamItem[] = [
      {
        id: "ev-chest-1",
        type: "ItemDeposited",
        timestamp: "2026-11-01T12:00:00.000Z",
        citizenId: "gpt_atlas",
        payload: {
          container: "personal chest",
          item: "diamond",
          count: 3,
        },
      },
    ];

    const facts: PersistentFactItem[] = [
      {
        id: "fact-theo-2",
        citizenId: "claude_theo",
        factKey: "atlas_private_chest",
        content: "Atlas has 3 diamonds in personal chest",
        kind: "observed_fact",
        createdAt: "2026-11-01T12:00:05.000Z",
        sourceEventId: "ev-chest-1",
      },
    ];

    const audit = auditInformationBoundaries({
      events,
      facts,
      directory,
    });

    expect(audit.valid).toBe(false);
    expect(audit.violations[0]?.violationType).toBe("PRIVATE_CHEST_LEAK");
  });
});
