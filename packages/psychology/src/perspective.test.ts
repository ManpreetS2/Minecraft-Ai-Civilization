import { describe, expect, it } from "vitest";
import {
  CognitiveStore,
  itemLostEvent,
  conversationHeardEvent,
  createIdFactory,
  mutableClock,
  type WorldSnapshot,
} from "@civ/memory";
import { CitizenMind } from "./mind.js";
import { compactMindSnapshot } from "./mind-snapshot.js";

const ATLAS = "citizen_atlas";
const MAYA = "citizen_maya";
const THEO = "citizen_theo";
const AVA = "citizen_ava";
const KAI = "citizen_kai";

function snap(): WorldSnapshot {
  return {
    settlementOrigin: { x: 0, y: 64, z: 0 },
    nearbyRadius: 24,
    citizens: [
      { id: ATLAS, name: "Atlas", position: { x: 2, y: 64, z: 2 } },
      { id: MAYA, name: "Maya", position: { x: 3, y: 64, z: 3 } },
      { id: THEO, name: "Theo", position: { x: 4, y: 64, z: 2 } },
      { id: AVA, name: "Ava", position: { x: 5, y: 64, z: 2 } },
      { id: KAI, name: "Kai", position: { x: 200, y: 64, z: 200 } },
    ],
  };
}

function runtime() {
  return new CitizenMind(new CognitiveStore(":memory:"), {
    clock: mutableClock("2026-09-17T12:00:00.000Z"),
    id: createIdFactory("p"),
  });
}

describe("belief divergence on one empty chest", () => {
  it("keeps one objective event while locals diverge by provenance", () => {
    const mind = runtime();
    const world = snap();
    const lost = itemLostEvent({
      id: "evt_chest",
      timestamp: "2026-09-17T12:00:00.000Z",
      citizenId: MAYA,
      item: "bread",
      count: 5,
      location: { x: 2, y: 64, z: 2 },
    });
    mind.ingest(lost, world);
    mind.hear({
      observerId: KAI,
      informantId: MAYA,
      claim: "Theo stole food",
      aboutCitizenId: THEO,
    });
    const objective = mind.store.getObjectiveEvent("evt_chest");
    expect(objective?.facts.count).toBe(5);
    const kai = mind.whatDoesCitizenBelieveAbout(KAI, THEO);
    expect(kai?.rumors.some((r) => /stole/i.test(r.text))).toBe(true);
    expect(mind.store.getObjectiveEvent("evt_chest")?.facts.thief).toBeUndefined();
  });
});

describe("perspective fixtures", () => {
  const observers = [ATLAS, MAYA, THEO, AVA, KAI];
  const sources = ["DIRECT", "WITNESSED", "HEARD", "RECORDED", "INFERRED"] as const;
  for (let index = 0; index < 20; index += 1) {
    const observer = observers[index % observers.length]!;
    const source = sources[index % sources.length]!;
    it(`case ${index + 1}: ${observer} ${source} does not rewrite objective facts`, () => {
      const mind = runtime();
      const heard = conversationHeardEvent({
        id: `evt_talk_${index}`,
        timestamp: "2026-09-17T12:00:00.000Z",
        speakerId: MAYA,
        listenerIds: [observer],
        text: "Theo took bread from the chest.",
        location: { x: 2, y: 64, z: 2 },
      });
      mind.ingest(heard, snap());
      const event = mind.store.getObjectiveEvent(`evt_talk_${index}`);
      expect(event?.facts.text).toBe("Theo took bread from the chest.");
      expect(event?.facts.guilty).toBeUndefined();
    });
  }
});

describe("compact mind snapshot", () => {
  it("is a slice, not the whole DB", () => {
    const mind = runtime();
    mind.ingest(
      itemLostEvent({
        id: "evt_loss",
        timestamp: "2026-09-17T12:00:00.000Z",
        citizenId: ATLAS,
        item: "chest",
        count: 1,
        location: { x: 1, y: 64, z: 1 },
      }),
      snap(),
    );
    const compact = compactMindSnapshot(mind.snapshot(ATLAS));
    expect(compact.citizenId).toBe(ATLAS);
    expect(compact.recentMeaningfulMemoryIds.length).toBeLessThanOrEqual(6);
  });
});

describe("body death does not erase identity", () => {
  it("keeps memories after deceased flag", () => {
    const mind = runtime();
    mind.store.upsertIdentity(ATLAS, "Atlas", "t0");
    mind.store.markDeceased(ATLAS, "t");
    const shot = mind.snapshot(ATLAS);
    expect(shot.deceased).toBe(true);
    expect(shot.citizenId).toBe(ATLAS);
  });
});

describe("no global reputation", () => {
  it("stores only pairwise beliefs", () => {
    const mind = runtime();
    mind.hear({ observerId: ATLAS, informantId: MAYA, claim: "Theo stole food", aboutCitizenId: THEO });
    const belief = mind.whatDoesCitizenBelieveAbout(ATLAS, THEO);
    expect(belief && "reputation" in belief).toBe(false);
    expect(JSON.stringify(belief ?? {})).not.toMatch(/"reputation"/);
  });
});
