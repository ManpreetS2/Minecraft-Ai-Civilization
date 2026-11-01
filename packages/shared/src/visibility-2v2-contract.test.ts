import { describe, expect, it } from "vitest";
import {
  authorizeEventForCitizen,
  readEventVisibility,
  type EventVisibility,
} from "./event-visibility.js";

// Synthetic identities; provider family is not an authorization rule or permanent allegiance.
const citizens = [
  "GPT Citizen A",
  "GPT Citizen B",
  "Claude Citizen A",
  "Claude Citizen B",
] as const;
const [owner, recipient] = citizens;
const allowed = (reader: string, visibility: EventVisibility) =>
  authorizeEventForCitizen(reader, visibility, owner).visible;

describe("PRIV-001 2v2 visibility contracts", () => {
  it("A: private memory is visible only to its actor, including exclusion of its starting peer", () => {
    for (const reader of citizens)
      expect(allowed(reader, { class: "actor_private" })).toBe(reader === owner);
  });

  it("B: directed speech reaches only explicitly authorized participants", () => {
    const visibility: EventVisibility = { class: "directed", audienceIds: [owner, recipient] };
    for (const reader of citizens)
      expect(allowed(reader, visibility)).toBe([owner, recipient].some((id) => id === reader));
    // Sending does not itself grant read access when the sender is not in the audience.
    expect(allowed(owner, { class: "directed", audienceIds: [recipient] })).toBe(false);
  });

  it("C: nearby speech uses a substantiated audience, never provider/community inference", () => {
    const visibility: EventVisibility = {
      class: "nearby_speech",
      speakerId: owner,
      audienceIds: [citizens[2]],
      evidenceRefs: ["fixture:observed-hearing-range:1"],
    };
    for (const reader of citizens)
      expect(allowed(reader, visibility)).toBe([owner, citizens[2]].some((id) => id === reader));
  });

  it.each([undefined, []].map((audienceIds) => ({ audienceIds })))(
    "C: missing/empty hearing audience fails closed ($audienceIds)",
    ({ audienceIds }) => {
      for (const reader of citizens)
        expect(allowed(reader, { class: "nearby_speech", speakerId: owner, audienceIds })).toBe(
          false,
        );
    },
  );

  it.each(
    [
      undefined,
      null,
      false,
      "world_public",
      [],
      {},
      { class: "PUBLIC" },
      { class: null },
      { class: "unknown" },
    ].map((raw) => ({ raw })),
  )("D/PRIV-002: malformed or unknown visibility fails closed ($raw)", ({ raw }) => {
    const visibility = readEventVisibility(raw === undefined ? {} : { visibility: raw });
    for (const reader of citizens) expect(allowed(reader, visibility)).toBe(false);
  });

  it.each([null, "GPT Citizen B", [42, null, {}]].map((audienceIds) => ({ audienceIds })))(
    "PRIV-002: malformed directed audience grants no access ($audienceIds)",
    ({ audienceIds }) => {
      const visibility = readEventVisibility({ visibility: { class: "directed", audienceIds } });
      for (const reader of citizens) expect(allowed(reader, visibility)).toBe(false);
    },
  );

  it("E: observer-only audit information is unavailable to every citizen", () => {
    for (const reader of citizens) expect(allowed(reader, { class: "observer_only" })).toBe(false);
  });

  it("H SECURITY DEFECT: settlement_public must fail closed without verified settlement membership", () => {
    // scopeNote describes intent only. No existing API argument can verify membership.
    const visibility: EventVisibility = {
      class: "settlement_public",
      scopeNote: "initial GPT community only",
    };
    expect(allowed(citizens[2], visibility)).toBe(false);
  });
});
