import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, fail } from "@civ/shared";
import { CivilizationStore, communityPhysicalState, executePlan, physicalBlockKey, type PlannedTask } from "@civ/agent-core";
import { withdrawItems } from "@civ/skills";
import { loadCraftFixture } from "../../../packages/agent-core/src/testing/load-craft-fixture.js";
import { caseTitle } from "../src/scenario.js";
import { AUDIT, installNoNetworkGuard } from "../src/fixture.js";

/**
 * ADV-03 freshness and ordering contract (see qa/v1/CHEST_OBSERVATION_CONTRACT.md). Additive contract:
 *   observedContainerDetails(key) -> { contents, observedAt (ISO), observedBy, revision, basis: "observed" } | undefined
 *   recordContainerObservation(key, observed, { expectedRevision? }) -> false, changing nothing, when expectedRevision is stale
 * `observedContainerContents` keeps returning bare counts. Gated on the accessor: on source without it the group is BLOCKED.
 */
vi.mock("@civ/skills", async (original) => ({ ...(await original<typeof import("@civ/skills")>()), depositItems: vi.fn(), withdrawItems: vi.fn() }));
installNoNetworkGuard();

type Details = { contents: Record<string, number>; observedAt: string; observedBy: string; revision: number; basis: string };
type Handle = {
  observedContainerContents(k: string): Record<string, number> | undefined;
  observedContainerDetails?(k: string): Details | undefined;
  recordContainerObservation(k: string, c: Record<string, number>, o?: { expectedRevision?: number }): boolean;
  grantAsset(k: string, id: string): boolean;
  registerAsset(kind: string, dim: string, pos: { x: number; y: number; z: number }): boolean;
};
const pos = { x: 12, y: 64, z: 8 };
const key = physicalBlockKey("overworld", pos);
const HAS_DETAILS = (() => {
  const probe = new CivilizationStore(":memory:");
  try {
    probe.upsertCommunity("probe", "Probe", AUDIT);
    probe.addCommunityMember("probe", "citizen_atlas", AUDIT);
    return typeof (communityPhysicalState(probe).forCitizen("citizen_atlas") as unknown as Handle).observedContainerDetails === "function";
  } catch {
    return false;
  } finally {
    probe.close();
  }
})();

let store: CivilizationStore;
const of = (id: string) => communityPhysicalState(store).forCitizen(id) as unknown as Handle;
const details = (id: string) => of(id).observedContainerDetails!(key);
const rec = (id: string, c: Record<string, number>, expectedRevision?: number) => of(id).recordContainerObservation(key, c, expectedRevision === undefined ? undefined : { expectedRevision });
const plan = { action: "withdrawItems", task: "withdraw_food", goal: "eat", source: "planner", reason: "qa", priority: 1, item: "bread" } as unknown as PlannedTask;

beforeEach(() => {
  store = new CivilizationStore(":memory:");
  store.upsertCommunity("north", "North", AUDIT);
  store.upsertCommunity("south", "South", AUDIT);
  for (const id of ["citizen_atlas", "citizen_maya"]) store.addCommunityMember("north", id, AUDIT);
  store.addCommunityMember("south", "citizen_theo", AUDIT);
  if (HAS_DETAILS) {
    of("citizen_atlas").registerAsset("chest", "overworld", pos);
    vi.mocked(withdrawItems).mockReset();
  }
});
afterEach(() => store.close());

(HAS_DETAILS ? describe : describe.skip)("ADV-03 observation freshness and ordering contract", () => {
  it(caseTitle("ADV-03", "details name when, by whom and on what basis; the revision rises by one per accepted observation"), () => {
    rec("citizen_atlas", { bread: 4 });
    const d1 = details("citizen_atlas")!;
    expect(d1.contents).toEqual({ bread: 4 });
    expect(d1.observedBy).toBe("citizen_atlas");
    expect(Number.isNaN(Date.parse(d1.observedAt))).toBe(false);
    expect(d1.basis).toBe("observed"); // never "assumed": unverified assumptions are not storable
    rec("citizen_atlas", { bread: 3 });
    expect(details("citizen_atlas")!.revision).toBe(d1.revision + 1);
    expect(of("citizen_atlas").observedContainerContents(key)).toEqual({ bread: 3 }); // backward compatible
  });

  it(caseTitle("ADV-03", "a stale revision cannot overwrite a newer verified observation; the current revision can"), () => {
    of("citizen_atlas").grantAsset(key, "citizen_maya");
    rec("citizen_atlas", { bread: 4 });
    const seenByBoth = details("citizen_atlas")!.revision;
    expect(rec("citizen_maya", { bread: 1 }, seenByBoth)).toBe(true);
    expect(rec("citizen_atlas", { bread: 99 }, seenByBoth)).toBe(false);
    expect(of("citizen_atlas").observedContainerContents(key)).toEqual({ bread: 1 });
    expect(rec("citizen_atlas", { bread: 2 }, details("citizen_atlas")!.revision)).toBe(true);
  });

  it(caseTitle("ADV-03", "a failed live withdrawal is a new observation (revision up, bread gone); an unreachable chest is not"), async () => {
    rec("citizen_atlas", { bread: 4, apple: 2 });
    const before = details("citizen_atlas")!;
    const fx = await loadCraftFixture({ trees: [] });
    fx.ctx.citizenId = "citizen_atlas";
    Object.assign(fx.ctx.bot, { game: { dimension: "overworld" }, blockAt: () => ({ name: "chest" }) });
    vi.mocked(withdrawItems).mockResolvedValue(fail("PATH_FAILED", "could not reach chest", 1, true));
    await executePlan(fx.ctx, plan, store, new EventBus());
    expect(details("citizen_atlas")!.revision).toBe(before.revision);
    vi.mocked(withdrawItems).mockResolvedValue(fail("VERIFY_FAILED", "chest holds no bread", 1, true));
    await executePlan(fx.ctx, plan, store, new EventBus());
    const after = details("citizen_atlas")!;
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.contents).toEqual({ apple: 2 });
    expect(Date.parse(after.observedAt)).toBeGreaterThanOrEqual(Date.parse(before.observedAt));
  });

  it(caseTitle("ADV-03", "details are as private as contents: a rival or a citizen who left the community gets undefined"), () => {
    rec("citizen_atlas", { bread: 4 });
    expect(details("citizen_theo")).toBeUndefined();
    of("citizen_atlas").grantAsset(key, "citizen_maya");
    store.removeCommunityMember("north", "citizen_maya", AUDIT);
    store.addCommunityMember("south", "citizen_maya", AUDIT);
    expect(details("citizen_maya")).toBeUndefined();
  });
});

if (!HAS_DETAILS) {
  describe(caseTitle("ADV-03", "freshness contract interface gaps (recorded, not faked)"), () => {
    // BLOCKED while observedContainerDetails / expectedRevision do not exist on the source under test.
    it.skip(caseTitle("ADV-03", "observedContainerDetails with observedAt/observedBy/revision/basis is absent", { blocked: true }), () => undefined);
    it.skip(caseTitle("ADV-03", "recordContainerObservation(..., { expectedRevision }) ordering token is absent", { blocked: true }), () => undefined);
  });
}
