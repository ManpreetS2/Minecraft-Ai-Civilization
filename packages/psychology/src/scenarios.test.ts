import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CognitiveStore,
  citizenAttackedCitizenEvent,
  citizenDeathEvent,
  createIdFactory,
  dangerEncounteredEvent,
  itemReceivedEvent,
  mutableClock,
  taskOutcomeEvent,
  type WorldSnapshot,
} from "@civ/memory";
import { CitizenMind } from "./mind.js";
import { AppraisalResultSchema, DeterministicAppraisal, validateAppraisalOutput } from "./appraisal.js";

const ATLAS = "citizen_atlas";
const MAYA = "citizen_maya";
const THEO = "citizen_theo";
const AVA = "citizen_ava";
const KAI = "citizen_kai";

function settlementSnapshot(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    settlementOrigin: { x: 0, y: 64, z: 0 },
    nearbyRadius: 24,
    citizens: [
      { id: ATLAS, name: "Atlas", position: { x: 2, y: 64, z: 2 }, health: 18, hunger: 4 },
      { id: MAYA, name: "Maya", position: { x: 3, y: 64, z: 3 }, health: 20, hunger: 16 },
      { id: THEO, name: "Theo", position: { x: 4, y: 64, z: 1 }, health: 20, hunger: 14 },
      { id: AVA, name: "Ava", position: { x: 6, y: 64, z: 4 }, health: 20, hunger: 15 },
      { id: KAI, name: "Kai", position: { x: 220, y: 64, z: 180 }, health: 20, hunger: 18 },
    ],
    ...overrides,
  };
}

function mind(store = new CognitiveStore(":memory:")): { mind: CitizenMind; store: CognitiveStore } {
  return {
    store,
    mind: new CitizenMind(store, {
      clock: mutableClock("2026-09-16T12:00:00.000Z"),
      id: createIdFactory("t"),
    }),
  };
}

describe("Scenario A — Maya gives starving Atlas food", () => {
  it("stores objective facts and local evidence without global reputation", () => {
    const { mind: runtime, store } = mind();
    const snapshot = settlementSnapshot({
      citizens: [
        { id: ATLAS, name: "Atlas", position: { x: 2, y: 64, z: 2 }, health: 18, hunger: 4 },
        { id: MAYA, name: "Maya", position: { x: 3, y: 64, z: 3 }, health: 20, hunger: 16 },
        { id: THEO, name: "Theo", position: { x: 180, y: 64, z: 190 }, health: 20, hunger: 14 },
        { id: AVA, name: "Ava", position: { x: 6, y: 64, z: 4 }, health: 20, hunger: 15 },
        { id: KAI, name: "Kai", position: { x: 220, y: 64, z: 180 }, health: 20, hunger: 18 },
      ],
    });
    const event = itemReceivedEvent({
      id: "evt_bread",
      timestamp: "2026-09-16T12:00:00.000Z",
      giverId: MAYA,
      receiverId: ATLAS,
      item: "bread",
      count: 3,
      receiverHunger: 4,
      location: { x: 2, y: 64, z: 2 },
    });
    const result = runtime.ingest(event, snapshot);

    const objective = store.getObjectiveEvent("evt_bread");
    expect(objective?.facts.item).toBe("bread");
    expect(objective?.facts.count).toBe(3);
    expect(objective?.facts.receiverHunger).toBe(4);

    const atlasMemories = runtime.whatDoesCitizenRemember(ATLAS);
    expect(atlasMemories.some((m) => /Maya gave me 3 bread when I was very hungry/i.test(m.summary))).toBe(true);
    expect(atlasMemories.some((m) => m.source === "DIRECT")).toBe(true);

    const atlasAboutMaya = runtime.whatDoesCitizenBelieveAbout(ATLAS, MAYA);
    expect(atlasAboutMaya).toBeTruthy();
    expect(atlasAboutMaya?.knownFacts[0]?.text).toMatch(/bread/);
    expect(atlasAboutMaya?.knownFacts[0]?.source).toBe("DIRECT");

    expect(runtime.whatDoesCitizenBelieveAbout(THEO, MAYA)).toBeUndefined();
    expect(runtime.whatDoesCitizenBelieveAbout(KAI, MAYA)).toBeUndefined();
    expect(runtime.whatDoesCitizenRemember(KAI)).toHaveLength(0);

    expect(result.memoriesCreated.some((m) => /is good/i.test(m.summary))).toBe(false);
    expect(JSON.stringify(atlasAboutMaya)).not.toMatch(/trust \+25/i);
    expect(store.listBeliefs(KAI)).toHaveLength(0);
  });
});

describe("Scenario B — Theo attacks Atlas", () => {
  it("gives Atlas a direct memory, nearby Ava a witnessed memory, and distant Kai nothing", () => {
    const { mind: runtime } = mind();
    const event = citizenAttackedCitizenEvent({
      timestamp: "2026-09-16T12:05:00.000Z",
      attackerId: THEO,
      victimId: ATLAS,
      damage: 4,
      location: { x: 2, y: 64, z: 2 },
    });
    runtime.ingest(event, settlementSnapshot());

    const atlas = runtime.whatDoesCitizenRemember(ATLAS);
    expect(atlas.some((m) => m.source === "DIRECT" && /Theo attacked me/i.test(m.summary))).toBe(true);

    const ava = runtime.whatDoesCitizenRemember(AVA);
    expect(ava.some((m) => m.source === "WITNESSED")).toBe(true);

    expect(runtime.whatDoesCitizenRemember(KAI)).toHaveLength(0);
    expect(runtime.whatDoesCitizenBelieveAbout(KAI, THEO)).toBeUndefined();

    const belief = runtime.whatDoesCitizenBelieveAbout(ATLAS, THEO);
    expect(belief?.resentmentEvidence).toBeGreaterThan(0);
  });
});

describe("Scenario C — Creeper destroys Atlas storage", () => {
  it("creates an important threat memory and a strengthenable creeper association", () => {
    const { mind: runtime } = mind();
    runtime.ingest(
      dangerEncounteredEvent({
        timestamp: "2026-09-16T12:10:00.000Z",
        citizenId: ATLAS,
        threatKey: "creeper",
        harmOccurred: true,
        outcome: "destroyed",
        destroyed: "storage",
        location: { x: 2, y: 64, z: 2 },
      }),
      settlementSnapshot(),
    );
    const snap = runtime.snapshot(ATLAS);
    expect(snap.memories.some((m) => m.importance >= 0.35 && /creeper/i.test(m.summary))).toBe(true);
    const creepers = snap.associations.filter((a) => a.subjectKey === "creeper" && a.associationType === "danger");
    expect(creepers[0]?.strength ?? 0).toBeGreaterThan(0.3);

    const retrieved = runtime.retrieve({
      citizenId: ATLAS,
      query: "creeper",
      nearbyEntities: ["creeper"],
    });
    expect(retrieved[0]?.memory.summary).toMatch(/creeper/i);
  });
});

describe("Scenario D — repeated safe creeper encounters", () => {
  it("can weaken a threat association", () => {
    const { mind: runtime } = mind();
    const snapshot = settlementSnapshot();
    runtime.ingest(
      dangerEncounteredEvent({
        citizenId: ATLAS,
        threatKey: "creeper",
        harmOccurred: true,
        outcome: "destroyed",
        destroyed: "storage",
        location: { x: 2, y: 64, z: 2 },
      }),
      snapshot,
    );
    const before = runtime.snapshot(ATLAS).associations.find((a) => a.subjectKey === "creeper")?.strength ?? 0;
    for (let i = 0; i < 4; i += 1) {
      runtime.ingest(
        dangerEncounteredEvent({
          citizenId: ATLAS,
          threatKey: "creeper",
          harmOccurred: false,
          outcome: "harmless",
          location: { x: 8, y: 64, z: 8 },
        }),
        snapshot,
      );
    }
    const after = runtime.snapshot(ATLAS).associations.find((a) => a.subjectKey === "creeper")?.strength ?? 0;
    expect(after).toBeLessThan(before);
  });
});

describe("Scenario E — repeated successful mining", () => {
  it("raises mining familiarity and confidence without assigning a miner personality", () => {
    const { mind: runtime } = mind();
    const snapshot = settlementSnapshot();
    for (let i = 0; i < 8; i += 1) {
      runtime.ingest(
        taskOutcomeEvent({
          citizenId: ATLAS,
          activity: "mine_stone",
          success: true,
          location: { x: 2, y: 64, z: 2 },
        }),
        snapshot,
      );
    }
    runtime.consolidate(ATLAS);
    const snap = runtime.snapshot(ATLAS);
    const mining = snap.activities.find((a) => a.activity === "mine_stone");
    expect(mining?.attempts).toBe(8);
    expect(mining?.familiarity).toBeGreaterThan(0.5);
    expect(mining?.confidence).toBeGreaterThan(0.5);
    expect(snap.narrative).not.toMatch(/is a miner/i);
    expect(snap.behaviorProfile.phrases.every((p) => !/you are/i.test(p))).toBe(true);
    expect(snap.memories.some((m) => m.tags.includes("summary"))).toBe(true);
  });
});

describe("Scenario F — citizen hears a rumor", () => {
  it("stores HEARD provenance with lower confidence and does not mutate objective truth", () => {
    const { mind: runtime, store } = mind();
    runtime.hear({
      observerId: ATLAS,
      informantId: MAYA,
      aboutCitizenId: THEO,
      claim: "Theo took 5 iron",
    });
    const memories = runtime.whatDoesCitizenRemember(ATLAS);
    expect(memories[0]?.source).toBe("HEARD");
    expect(memories[0]?.summary).toMatch(/Maya told me/i);
    const belief = runtime.whatDoesCitizenBelieveAbout(ATLAS, THEO);
    expect(belief?.rumors[0]?.text).toMatch(/iron/);
    expect(belief?.rumors[0]?.confidence ?? 1).toBeLessThan(0.7);
    expect(belief?.knownFacts).toHaveLength(0);
    expect(store.listObjectiveEvents()).toHaveLength(0);
  });
});

describe("Scenario G — citizen dies", () => {
  it("keeps historical data and lets nearby witnesses remember the death", () => {
    const { mind: runtime, store } = mind();
    runtime.ingest(
      itemReceivedEvent({
        giverId: MAYA,
        receiverId: AVA,
        item: "bread",
        count: 1,
        receiverHunger: 10,
        location: { x: 6, y: 64, z: 4 },
      }),
      settlementSnapshot(),
    );
    runtime.ingest(
      citizenDeathEvent({
        deceasedId: AVA,
        cause: "zombie",
        location: { x: 6, y: 64, z: 4 },
      }),
      settlementSnapshot({
        citizens: settlementSnapshot().citizens.map((c) =>
          c.id === AVA ? { ...c, deceased: false } : c,
        ),
      }),
    );
    expect(store.getIdentity(AVA)?.deceased).toBe(true);
    expect(runtime.whatDoesCitizenRemember(AVA).length).toBeGreaterThan(0);
    expect(runtime.whatDoesCitizenRemember(ATLAS).some((m) => /Ava died/i.test(m.summary))).toBe(true);
    expect(runtime.whatDoesCitizenRemember(KAI)).toHaveLength(0);
    const snap = runtime.snapshot(AVA);
    expect(snap.deceased).toBe(true);
    expect(snap.narrative).toMatch(/deceased/i);
  });
});

describe("Scenario H — restart database", () => {
  it("restores memories, psych, associations, and social evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "cog-h-"));
    const path = join(dir, "civ.sqlite");
    const first = mind(new CognitiveStore(path));
    first.mind.ingest(
      itemReceivedEvent({
        giverId: MAYA,
        receiverId: ATLAS,
        item: "bread",
        count: 3,
        receiverHunger: 4,
        location: { x: 2, y: 64, z: 2 },
      }),
      settlementSnapshot(),
    );
    first.store.close();

    const second = mind(new CognitiveStore(path));
    expect(second.mind.whatDoesCitizenRemember(ATLAS)[0]?.summary).toMatch(/bread/);
    expect(second.mind.whatDoesCitizenBelieveAbout(ATLAS, MAYA)?.knownFacts.length).toBeGreaterThan(0);
    expect(second.store.getPsych(ATLAS).positiveAffect).toBeGreaterThan(0.4);
    second.store.close();
  });
});

describe("appraisal bounds", () => {
  it("rejects hidden chain-of-thought fields and out-of-range deltas", () => {
    expect(() =>
      validateAppraisalOutput({
        memoryImportance: 0.4,
        emotionalSalience: 0.4,
        moodDelta: 9,
        stressDelta: 0,
        fearDelta: 0,
        angerDelta: 0,
        sadnessDelta: 0,
        positiveAffectDelta: 0,
        confidenceDelta: 0,
        associationProposals: [],
        summary: "ok",
        tags: [],
        keepDurable: true,
      }),
    ).toThrow();
    const ok = new DeterministicAppraisal().appraise({
      citizenId: ATLAS,
      event: itemReceivedEvent({ giverId: MAYA, receiverId: ATLAS, item: "bread", count: 1, receiverHunger: 4 }),
      source: "DIRECT",
      dimensions: {
        goalImpact: 0.8,
        materialImpact: 0.3,
        threatLevel: 0,
        helpfulness: 0.9,
        harm: 0,
        novelty: 0.4,
        responsibility: 0,
        socialRelevance: 0.7,
        relationshipRelevance: 0.5,
        urgency: 0.7,
        certainty: 0.9,
      },
      currentNeeds: { hunger: 4 },
      currentMood: {
        citizenId: ATLAS,
        moodValence: 0,
        stress: 0.4,
        fear: 0,
        anger: 0,
        sadness: 0,
        positiveAffect: 0.4,
        confidence: 0.4,
        currentConcerns: [],
        updatedAt: "2026-09-16T12:00:00.000Z",
      },
      relevantMemories: [],
      learnedAssociations: [],
      activityFamiliarity: {},
    });
    expect(ok.summary).not.toMatch(/chain of thought/i);
    expect(AppraisalResultSchema.parse(ok)).toBeTruthy();
    expect(ok.summary).toMatch(/very hungry/);
  });
});
