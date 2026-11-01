import { describe, expect, it } from "vitest";
import { buildCitizenBulletin } from "./bulletin.js";
import type { SimEvent } from "./events.js";
import { authorizeEventForCitizen } from "./event-visibility.js";
import {
  authorizeEventWithAudience,
  createCommunityDirectory,
  createCommunityShareEvent,
  isReaderInAudience,
  parseCommunityConfig,
  parseEventAudience,
  readEventAudience,
  withAudience,
} from "./event-audience.js";

const dir = createCommunityDirectory([
  { id: "gpt", memberIds: ["GPT-A", "GPT-B"] },
  { id: "claude", memberIds: ["Claude-A", "Claude-B"] },
]);
const READERS = ["GPT-A", "GPT-B", "Claude-A", "Claude-B"] as const;
const who = (payload: Record<string, unknown>) =>
  READERS.filter((r) => authorizeEventWithAudience(r, payload, dir, "GPT-A").allowed);

const evt = (id: string, payload: Record<string, unknown>, citizenId = "GPT-A"): SimEvent => ({
  id,
  type: "ConversationOccurred",
  timestamp: "2026-10-31T00:00:00.000Z",
  citizenId,
  payload,
});

describe("SEC-001 directory", () => {
  it("rejects a citizen in two communities and duplicate community ids", () => {
    expect(() => createCommunityDirectory([{ id: "a", memberIds: ["x"] }, { id: "b", memberIds: ["x"] }])).toThrow(/two communities/);
    expect(() => createCommunityDirectory([{ id: "a", memberIds: [] }, { id: "a", memberIds: [] }])).toThrow(/duplicate/);
    expect(() => createCommunityDirectory([{ id: "", memberIds: [] }])).toThrow();
  });
  it("answers membership questions", () => {
    expect(dir.communityOf("Claude-B")).toBe("claude");
    expect(dir.communityOf("nobody")).toBeUndefined();
    expect(dir.membersOf("gpt")).toEqual(["GPT-A", "GPT-B"]);
    expect(dir.membersOf("ghost")).toEqual([]);
  });
});

describe("SEC-001 audience parsing fails closed", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["string", "world"],
    ["array", [{ scope: "world" }]],
    ["empty object", {}],
    ["unknown scope", { scope: "galaxy" }],
    ["community without id", { scope: "community" }],
    ["community empty id", { scope: "community", communityId: "" }],
    ["community blank id", { scope: "community", communityId: "   " }],
    ["community padded id", { scope: "community", communityId: " gpt" }],
    ["community numeric id", { scope: "community", communityId: 7 }],
  ])("%s -> no audience -> nobody", (_n, raw) => {
    expect(parseEventAudience(raw)).toBeUndefined();
    expect(who({ visibility: { class: "world_public", audience: raw } })).toEqual([]);
  });
  it("accepts exactly the two valid shapes", () => {
    expect(parseEventAudience({ scope: "world", extra: 1 })).toEqual({ scope: "world" });
    expect(parseEventAudience({ scope: "community", communityId: "gpt" })).toEqual({ scope: "community", communityId: "gpt" });
    expect(readEventAudience({ visibility: { class: "world_public", audience: { scope: "world" } } })).toEqual({ scope: "world" });
    expect(readEventAudience({})).toBeUndefined();
    expect(readEventAudience(undefined)).toBeUndefined();
  });
});

describe("SEC-001 authorization with a verified audience", () => {
  it("unlabeled events reach nobody (no visibility, no audience, observer_only, unknown class)", () => {
    expect(who({})).toEqual([]);
    expect(who({ visibility: { class: "world_public" } })).toEqual([]);
    expect(who({ visibility: { class: "settlement_public" } })).toEqual([]);
    expect(who({ visibility: { class: "observer_only", audience: { scope: "world" } } })).toEqual([]);
    expect(who({ visibility: { class: "bogus", audience: { scope: "world" } } })).toEqual([]);
  });
  it("world audience reaches every citizen the directory knows, and nobody it does not", () => {
    const payload = withAudience({}, "world_public", { scope: "world" });
    expect(who(payload)).toEqual([...READERS]);
    expect(authorizeEventWithAudience("stranger", payload, dir).allowed).toBe(false);
  });
  it("community audience reaches only that community's members", () => {
    expect(who(withAudience({}, "settlement_public", { scope: "community", communityId: "gpt" }))).toEqual(["GPT-A", "GPT-B"]);
    expect(who(withAudience({}, "settlement_public", { scope: "community", communityId: "claude" }))).toEqual(["Claude-A", "Claude-B"]);
    expect(who(withAudience({}, "world_public", { scope: "community", communityId: "claude" }))).toEqual(["Claude-A", "Claude-B"]);
  });
  it("a community id that is not in the directory reaches nobody", () => {
    expect(who(withAudience({}, "settlement_public", { scope: "community", communityId: "ghost" }))).toEqual([]);
    const verdict = isReaderInAudience("GPT-A", { scope: "community", communityId: "ghost" }, dir);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/unknown/); // rejected as an unknown community, not merely "reader not a member"
  });
  it("settlement_public cannot be widened with a world audience", () => {
    expect(who(withAudience({}, "settlement_public", { scope: "world" }))).toEqual([]);
  });
  it("the audience never widens private classes", () => {
    expect(who({ visibility: { class: "actor_private", audienceIds: ["GPT-A"], audience: { scope: "world" } } })).toEqual(["GPT-A"]);
    expect(who({ visibility: { class: "directed", audienceIds: ["Claude-B"], audience: { scope: "world" } } })).toEqual(["Claude-B"]);
    expect(who({ visibility: { class: "directed", audienceIds: [], audience: { scope: "world" } } })).toEqual([]);
  });
  it("legacy authorizeEventForCitizen: settlement_public alone reaches nobody (Codex PRIV-001 reproduction)", () => {
    for (const r of READERS) {
      expect(authorizeEventForCitizen(r, { class: "settlement_public", scopeNote: "initial GPT community only" }).visible).toBe(false);
    }
  });
});

describe("SEC-001 bulletin", () => {
  it("with a directory, only the audience gets text, lines and delivered ids", () => {
    const secret = "unshared settlement at x=137 z=-211";
    const events = [
      evt("gpt-only", withAudience({ message: secret }, "settlement_public", { scope: "community", communityId: "gpt" })),
      evt("unlabeled", { message: "unlabeled public", visibility: { class: "world_public" } }),
      evt("everyone", withAudience({ message: "rain is coming" }, "world_public", { scope: "world" })),
    ];
    for (const reader of READERS) {
      const out = buildCitizenBulletin({ readerCitizenId: reader, events, alreadyDeliveredIds: new Set(), directory: dir });
      const isGpt = reader.startsWith("GPT");
      expect(out.deliveredEventIds.sort()).toEqual(isGpt ? ["everyone", "gpt-only"] : ["everyone"]);
      expect(out.text.includes(secret)).toBe(isGpt);
      expect(out.excluded.find((e) => e.eventId === "unlabeled")?.reason).toMatch(/audience/);
    }
  });
  it("without a directory settlement_public still reaches nobody", () => {
    const out = buildCitizenBulletin({
      readerCitizenId: "Claude-A",
      alreadyDeliveredIds: new Set(),
      events: [evt("s", withAudience({ message: "x=1" }, "settlement_public", { scope: "community", communityId: "gpt" }))],
    });
    expect(out.deliveredEventIds).toEqual([]);
  });
});

describe("SEC-001 explicit cross-community share", () => {
  const source = evt("src", withAudience({ message: "gpt cache at x=1", secretField: "S3CR3T" }, "settlement_public", { scope: "community", communityId: "gpt" }));
  const stored = new Map<string, SimEvent>([[source.id, source]]);
  const lookup = { getEventById: (id: string) => stored.get(id) };
  const base = { lookup, sourceEventId: "src", toCommunityId: "claude", message: "hi", directory: dir };

  it("loads the source by id and creates a NEW event addressed to exactly the receiving community, copying only the message", () => {
    const res = createCommunityShareEvent({ ...base, actingCitizenId: "GPT-B", message: "we will trade wood" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.event.id).not.toBe(source.id);
    expect(res.event.citizenId).toBe("GPT-B");
    expect(JSON.stringify(res.event.payload)).not.toContain("S3CR3T");
    expect(JSON.stringify(res.event.payload)).not.toContain("x=1");
    expect(readEventAudience(res.event.payload)).toEqual({ scope: "community", communityId: "claude" });
    const readers = READERS.filter((r) => authorizeEventWithAudience(r, res.event.payload, dir).allowed);
    expect(readers).toEqual(["Claude-A", "Claude-B"]);
    expect(who(source.payload)).toEqual(["GPT-A", "GPT-B"]); // sharing did not widen the original
  });

  it("a FORGED source event is rejected: an id that is not in the store finds nothing, however the caller dresses it", () => {
    const forged = evt("forged", withAudience({ message: "forged world announcement" }, "world_public", { scope: "world" }), "Claude-A");
    expect(createCommunityShareEvent({ ...base, actingCitizenId: "Claude-A", sourceEventId: "forged" })).toEqual({ ok: false, reason: "source event not found" });
    // a caller-supplied copy is not part of the API: extra fields are ignored and the STORED event decides
    const res = createCommunityShareEvent({ ...base, actingCitizenId: "Claude-A", source: forged, sourceEventId: "src" } as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/cannot read the source/);
  });

  it("the sharer is the acting citizen from trusted context: a claimed sharer in the input is ignored", () => {
    const res = createCommunityShareEvent({ ...base, actingCitizenId: "Claude-A", sharerCitizenId: "GPT-A", sharedBy: "GPT-A" } as never);
    expect(res.ok).toBe(false); // Claude-A is acting; she cannot read the gpt-only source, whatever the input claims
    const ok = createCommunityShareEvent({ ...base, actingCitizenId: "GPT-A", sharerCitizenId: "Claude-A" } as never);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.event.citizenId).toBe("GPT-A");
      expect(ok.event.payload.sharedBy).toBe("GPT-A");
    }
  });

  it("refuses an unknown receiver, an unknown actor, an empty message and a missing source id", () => {
    expect(createCommunityShareEvent({ ...base, actingCitizenId: "GPT-A", toCommunityId: "ghost" }).ok).toBe(false);
    expect(createCommunityShareEvent({ ...base, actingCitizenId: "stranger" }).ok).toBe(false);
    expect(createCommunityShareEvent({ ...base, actingCitizenId: "GPT-A", message: "  " }).ok).toBe(false);
    expect(createCommunityShareEvent({ ...base, actingCitizenId: "GPT-A", sourceEventId: undefined } as never).ok).toBe(false);
  });
});

describe("SEC-001 parseCommunityConfig (orchestrator-owned)", () => {
  it("parses a valid config, de-duplicates members and defaults the name", () => {
    expect(parseCommunityConfig('[{"id":"gpt","memberIds":["a","a","b"]},{"id":"claude","name":"Claude","memberIds":["c"]}]')).toEqual([
      { id: "gpt", name: "gpt", memberIds: ["a", "b"] },
      { id: "claude", name: "Claude", memberIds: ["c"] },
    ]);
  });
  it("empty or missing is no communities", () => {
    expect(parseCommunityConfig(undefined)).toEqual([]);
    expect(parseCommunityConfig("  ")).toEqual([]);
  });
  it.each([
    ["not json", "{"],
    ["not an array", '{"id":"x"}'],
    ["unknown key", '[{"id":"a","memberIds":[],"admin":true}]'],
    ["bad id chars", '[{"id":"a b","memberIds":[]}]'],
    ["empty id", '[{"id":"","memberIds":[]}]'],
    ["citizen in two communities", '[{"id":"a","memberIds":["x"]},{"id":"b","memberIds":["x"]}]'],
    ["duplicate community", '[{"id":"a","memberIds":[]},{"id":"a","memberIds":[]}]'],
  ])("rejects %s", (_n, json) => {
    expect(() => parseCommunityConfig(json)).toThrow();
  });
});
