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

function adapted(payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const sim: SimEvent = {
    id: "e1",
    type: "ConversationOccurred",
    timestamp: "2026-10-31T00:00:00.000Z",
    citizenId: "GPT-A",
    payload: { speakerId: "GPT-A", listenerIds: ["GPT-B"], text: "hello", location: at, ...extra, ...payload },
  };
  const event = tryAdaptSimEvent(sim);
  if (!event) throw new Error("not adapted");
  return event;
}
const ids = (roles: { citizenId: string }[]) => roles.map((r) => r.citizenId).sort();

describe("SEC-001 observersForEvent with a directory", () => {
  it("without a directory the old behaviour is unchanged (everyone nearby witnesses)", () => {
    expect(ids(observersForEvent(adapted({}), snapshot))).toEqual(["Claude-A", "Claude-B", "GPT-A", "GPT-B"]);
  });
  it("a missing audience means no second-hand observers; DIRECT participants still remember their own event", () => {
    const roles = observersForEvent(adapted({}), snapshot, { directory: dir });
    expect(ids(roles)).toEqual(["GPT-A", "GPT-B"]);
    expect(roles.every((r) => r.source === "DIRECT")).toBe(true);
  });
  it("proximity and heardBy cannot cross communities when the audience names one community", () => {
    const payload = withAudience({}, "settlement_public", { scope: "community", communityId: "gpt" });
    const event = adapted(payload);
    event.facts.heardBy = ["Claude-A"];
    event.facts.recordReaders = ["Claude-B"];
    expect(ids(observersForEvent(event, snapshot, { directory: dir }))).toEqual(["GPT-A", "GPT-B"]);
  });
  it("a world audience lets nearby citizens of both communities witness; an unknown community lets nobody", () => {
    const world = adapted(withAudience({}, "world_public", { scope: "world" }));
    expect(ids(observersForEvent(world, snapshot, { directory: dir }))).toEqual(["Claude-A", "Claude-B", "GPT-A", "GPT-B"]);
    const ghost = adapted(withAudience({}, "settlement_public", { scope: "community", communityId: "ghost" }));
    expect(ids(observersForEvent(ghost, snapshot, { directory: dir }))).toEqual(["GPT-A", "GPT-B"]);
  });
  it("a malformed audience on the adapted event fails closed", () => {
    const event = adapted({});
    event.facts.audience = { scope: "community" };
    expect(ids(observersForEvent(event, snapshot, { directory: dir }))).toEqual(["GPT-A", "GPT-B"]);
  });
});
