import { describe, expect, it } from "vitest";
import { createCommunityDirectory, withAudience, type SimEvent } from "@civ/shared";
import { observersForEvent, tryAdaptSimEvent } from "./events.js";
import type { WorldSnapshot } from "./types.js";

const dir = createCommunityDirectory([
  { id: "gpt", memberIds: ["GPT-A", "GPT-B"] },
  { id: "claude", memberIds: ["Claude-A", "Claude-B"] },
]);
const at = { x: 0, y: 64, z: 0 };
const snapshot: WorldSnapshot = {
  citizens: ["GPT-A", "GPT-B", "Claude-A", "Claude-B"].map((id) => ({ id, name: id, position: at })),
  nearbyRadius: 32,
} as WorldSnapshot;
const ALL = ["Claude-A", "Claude-B", "GPT-A", "GPT-B"];

function adapted(payload: Record<string, unknown>) {
  const sim: SimEvent = {
    id: "e1",
    type: "ConversationOccurred",
    timestamp: "2026-10-31T00:00:00.000Z",
    citizenId: "GPT-A",
    payload: { speakerId: "GPT-A", listenerIds: ["GPT-B"], text: "hello", location: at, ...payload },
  };
  const event = tryAdaptSimEvent(sim);
  if (!event) throw new Error("not adapted");
  return event;
}
const ids = (roles: { citizenId: string }[]) => roles.map((r) => r.citizenId).sort();
const gptBroadcast = () => adapted(withAudience({}, "settlement_public", { scope: "community", communityId: "gpt" }));

describe("SEC-001 observersForEvent: the directory is required", () => {
  it("is part of the signature (omitting it does not typecheck)", () => {
    expect(observersForEvent.length).toBe(3);
    // @ts-expect-error the directory parameter is required
    observersForEvent(adapted({}), snapshot);
  });
  it("the adapter carries the visibility class and the audience label", () => {
    expect(adapted({}).facts.visibilityClass).toBe("unknown");
    expect(gptBroadcast().facts.visibilityClass).toBe("settlement_public");
    expect(gptBroadcast().facts.audience).toEqual({ scope: "community", communityId: "gpt" });
  });
});

describe("SEC-001 observersForEvent gates only broadcast classes", () => {
  it("non-broadcast events keep their legitimate nearby witnesses, whatever the communities", () => {
    for (const payload of [
      {}, // unclassified physical observation
      { visibility: { class: "directed", audienceIds: ["GPT-B"] } },
      { visibility: { class: "nearby_speech", audienceIds: ["GPT-B"] } },
      { visibility: { class: "actor_private", audienceIds: ["GPT-A"] } },
    ]) {
      expect(ids(observersForEvent(adapted(payload), snapshot, dir))).toEqual(ALL);
    }
  });
  it("a broadcast event with a missing audience gives no second-hand observers; DIRECT participants stay", () => {
    for (const klass of ["world_public", "settlement_public"]) {
      const roles = observersForEvent(adapted({ visibility: { class: klass } }), snapshot, dir);
      expect(ids(roles)).toEqual(["GPT-A", "GPT-B"]);
      expect(roles.every((r) => r.source === "DIRECT")).toBe(true);
    }
  });
  it("proximity, heardBy and recordReaders cannot cross communities for a community broadcast", () => {
    const event = gptBroadcast();
    event.facts.heardBy = ["Claude-A"];
    event.facts.recordReaders = ["Claude-B"];
    expect(ids(observersForEvent(event, snapshot, dir))).toEqual(["GPT-A", "GPT-B"]);
  });
  it("heardBy / recordReaders of the SAME community still work for a community broadcast", () => {
    const sim = adapted({ ...withAudience({}, "settlement_public", { scope: "community", communityId: "gpt" }), listenerIds: [] });
    sim.facts.heardBy = ["GPT-B", "Claude-A"];
    const far: WorldSnapshot = { ...snapshot, citizens: snapshot.citizens.map((c) => ({ ...c, position: { x: 900, y: 64, z: 900 } })) };
    const roles = observersForEvent(sim, far, dir);
    expect(ids(roles)).toEqual(["GPT-A", "GPT-B"]);
    expect(roles.find((r) => r.citizenId === "GPT-B")?.source).toBe("HEARD");
  });
  it("a world audience lets nearby citizens of both communities witness; an unknown community lets nobody second-hand", () => {
    const world = adapted(withAudience({}, "world_public", { scope: "world" }));
    expect(ids(observersForEvent(world, snapshot, dir))).toEqual(ALL);
    const ghost = adapted(withAudience({}, "settlement_public", { scope: "community", communityId: "ghost" }));
    expect(ids(observersForEvent(ghost, snapshot, dir))).toEqual(["GPT-A", "GPT-B"]);
  });
  it("a malformed audience on a broadcast event fails closed", () => {
    const event = gptBroadcast();
    event.facts.audience = { scope: "community" };
    expect(ids(observersForEvent(event, snapshot, dir))).toEqual(["GPT-A", "GPT-B"]);
  });
});
