import { describe, expect, it } from "vitest";
import { buildCitizenBulletin } from "./bulletin.js";
import { createCommunityDirectory } from "./event-audience.js";
import type { SimEvent } from "./events.js";
import type { EventVisibility } from "./event-visibility.js";

const citizens = [
  "GPT Citizen A",
  "GPT Citizen B",
  "Claude Citizen A",
  "Claude Citizen B",
] as const;
const secret = "unshared settlement at x=137 z=-211";
const directory = createCommunityDirectory([{ id: "fixture", memberIds: citizens }]);
function event(id: string, visibility: EventVisibility | undefined, message = secret): SimEvent {
  return {
    id,
    type: "ConversationOccurred",
    timestamp: "2026-10-31T00:00:00.000Z",
    citizenId: citizens[0],
    payload: {
      message,
      ...(visibility
        ? {
            visibility:
              visibility.class === "world_public"
                ? { ...visibility, audience: { scope: "world" } }
                : visibility,
          }
        : {}),
    },
  };
}
function bulletin(
  readerCitizenId: string,
  events: SimEvent[],
  alreadyDeliveredIds: ReadonlySet<string> = new Set(),
) {
  return buildCitizenBulletin({ readerCitizenId, events, alreadyDeliveredIds, directory });
}

describe("PRIV-001 production bulletin and memory boundaries", () => {
  it("E/F/I: private coordinates, observer records and unknown events never reach unauthorized text or IDs", () => {
    const events = [
      event("private", { class: "actor_private" }),
      event("observer", { class: "observer_only" }),
      event("unknown", undefined),
      event("directed", { class: "directed", audienceIds: [citizens[0]] }),
      event("nearby", {
        class: "nearby_speech",
        audienceIds: [citizens[0]],
        evidenceRefs: ["fixture:hearing"],
      }),
      event("public", { class: "world_public" }, "Intentionally announced: rain"),
    ];
    for (const reader of citizens.slice(1)) {
      const result = bulletin(reader, events);
      expect(result.text).not.toContain(secret);
      expect(result.deliveredEventIds).toEqual(["public"]);
      expect(result.lines.map((line) => line.eventId)).toEqual(["public"]);
      expect(new Set(result.excluded.map((row) => row.eventId))).toEqual(
        new Set(events.slice(0, 5).map((row) => row.id)),
      );
    }
    expect(bulletin(citizens[0], [events[0]!]).deliveredEventIds).toContain("private");
  });

  it("G: an acknowledged event cannot be delivered again", () => {
    const events = [event("announcement", { class: "world_public" }, "Voluntarily published fact")];
    const first = bulletin(citizens[0], events);
    expect(first.deliveredEventIds).toEqual(["announcement"]);
    const second = bulletin(citizens[0], events, new Set(first.deliveredEventIds));
    expect(second.deliveredEventIds).toEqual([]);
    expect(second.text).not.toContain("Voluntarily published fact");
    expect(second.excluded).toEqual([{ eventId: "announcement", reason: "already_delivered" }]);
    expect(bulletin(citizens[1], events).deliveredEventIds).toEqual(["announcement"]);
  });

  it("PRIV-003: budget-omitted events remain eligible on a later delivery", () => {
    const events = [
      event("a", { class: "world_public" }, "First"),
      event("b", { class: "world_public" }, "Second"),
    ];
    const first = buildCitizenBulletin({
      readerCitizenId: citizens[0],
      events,
      alreadyDeliveredIds: new Set(),
      maxLines: 1,
      directory,
    });
    expect(first.deliveredEventIds).toEqual(["a"]);
    expect(
      bulletin(citizens[0], events, new Set(first.deliveredEventIds)).deliveredEventIds,
    ).toEqual(["b"]);
  });

  it("PRIV-003: scanning an unauthorized event does not acknowledge it", () => {
    const hidden = event("late", { class: "directed", audienceIds: [citizens[0]] });
    const first = bulletin(citizens[1], [hidden]);
    expect(first.deliveredEventIds).toEqual([]);
    const shared = event("late", { class: "directed", audienceIds: [citizens[0], citizens[1]] });
    expect(
      bulletin(citizens[1], [shared], new Set(first.deliveredEventIds)).deliveredEventIds,
    ).toEqual(["late"]);
  });

  it("H/I SECURITY DEFECT: settlement-scoped coordinates cannot leak through a public-looking summary", () => {
    const scoped = event("settlement-location", {
      class: "settlement_public",
      scopeNote: "initial GPT community only",
    });
    scoped.payload = { visibility: scoped.payload.visibility, summary: secret };
    const result = bulletin(citizens[2], [scoped]);
    // All output surfaces are included in one assertion so a leak is fully visible.
    expect({
      containsSecret: result.text.includes(secret),
      ids: result.deliveredEventIds,
      lines: result.lines.length,
    }).toEqual({ containsSecret: false, ids: [], lines: 0 });
  });

  it.each([
    "inventory: 7 diamonds",
    "hidden goal: leave tonight",
    "private thought: distrust my peer",
  ])("PRIV-004: an unshared %s is excluded even for a starting-community peer", (message) => {
    const privateEvent = event("private-disclosure", { class: "actor_private" }, message);
    for (const reader of citizens.slice(1)) {
      const result = bulletin(reader, [privateEvent]);
      expect(result.text).not.toContain(message);
      expect(result.deliveredEventIds).toEqual([]);
    }
  });

  it("PRIV-003: duplicate input IDs are emitted once within a bulletin", () => {
    const shared = event("same-id", { class: "world_public" }, "Published once");
    expect(bulletin(citizens[0], [shared, shared]).deliveredEventIds).toEqual(["same-id"]);
  });
});
