import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, fail, ok } from "@civ/shared";
import { CivilizationStore, communityPhysicalState, executePlan, physicalBlockKey, type PlannedTask } from "@civ/agent-core";
import { withdrawItems, type SkillContext } from "@civ/skills";
import { loadCraftFixture } from "../../../packages/agent-core/src/testing/load-craft-fixture.js";
import { caseTitle } from "../src/scenario.js";
import { AUDIT, installNoNetworkGuard } from "../src/fixture.js";

/**
 * ADV-03: community storage access follows CURRENT authorization (provisional V1 policy, pending owner
 * confirmation). Written against the semantics a fix must deliver, so on source with the three known defects (original
 * PR #14, dbbb7c4) these tests are RED, and they are skipped as BLOCKED where the chest-contents interface does not
 * exist at all. Red evidence at dbbb7c4 and green evidence on a minimal reference patch are in the QA PR description.
 */
vi.mock("@civ/skills", async (original) => ({ ...(await original<typeof import("@civ/skills")>()), depositItems: vi.fn(), withdrawItems: vi.fn() }));

installNoNetworkGuard();
const HAS_CONTENTS = (() => {
  const probe = new CivilizationStore(":memory:");
  try {
    probe.upsertCommunity("probe", "Probe", AUDIT);
    probe.addCommunityMember("probe", "citizen_atlas", AUDIT);
    const handle = communityPhysicalState(probe).forCitizen("citizen_atlas") as unknown as { recordContainerObservation?: unknown };
    return typeof handle.recordContainerObservation === "function";
  } catch {
    return false;
  } finally {
    probe.close();
  }
})();
const suite = HAS_CONTENTS ? describe : describe.skip;
const BLOCK = !HAS_CONTENTS;

const pos = { x: 12, y: 64, z: 8 };
const key = physicalBlockKey("overworld", pos);
let store: CivilizationStore;
const of = (id: string) => communityPhysicalState(store).forCitizen(id);
const move = (id: string, from: string, to: string) => {
  store.removeCommunityMember(from, id, AUDIT);
  store.addCommunityMember(to, id, AUDIT);
};
const rec = (id: string, c: Record<string, number>) => (of(id) as unknown as { recordContainerObservation(k: string, c: Record<string, number>): boolean }).recordContainerObservation(key, c);
const read = (id: string) => (of(id) as unknown as { observedContainerContents(k: string): Record<string, number> | undefined }).observedContainerContents(key);

beforeEach(() => {
  store = new CivilizationStore(":memory:");
  store.upsertCommunity("north", "North", AUDIT);
  store.upsertCommunity("south", "South", AUDIT);
  for (const id of ["citizen_atlas", "citizen_maya"]) store.addCommunityMember("north", id, AUDIT);
  store.addCommunityMember("south", "citizen_theo", AUDIT);
  of("citizen_atlas").registerAsset("chest", "overworld", pos);
  if (HAS_CONTENTS) vi.mocked(withdrawItems).mockReset();
});
afterEach(() => store.close());

suite("ADV-03 access revocation follows current community membership", () => {
  it(caseTitle("ADV-03", "owner leaves the community: the old community's chest contents are no longer readable or recordable by the owner"), () => {
    of("citizen_atlas").grantAsset(key, "citizen_maya");
    expect(rec("citizen_maya", { bread: 4 })).toBe(true);
    move("citizen_atlas", "north", "south");
    rec("citizen_maya", { bread: 9 });
    expect(read("citizen_atlas")).toBeUndefined();
    expect(rec("citizen_atlas", { diamond: 1 })).toBe(false);
  });

  it(caseTitle("ADV-03", "grantee leaves the granting community: access is gone, the historical grant row is not what authorizes"), () => {
    of("citizen_atlas").grantAsset(key, "citizen_maya");
    rec("citizen_atlas", { bread: 4 });
    move("citizen_maya", "north", "south");
    expect(read("citizen_maya")).toBeUndefined();
    expect(rec("citizen_maya", { bread: 99 })).toBe(false);
    expect(read("citizen_atlas")).toEqual({ bread: 4 });
  });

  it(caseTitle("ADV-03", "owner and grantee who return to the original community regain access (provisional policy), and a revoked grant stays revoked"), () => {
    of("citizen_atlas").grantAsset(key, "citizen_maya");
    rec("citizen_atlas", { bread: 4 });
    move("citizen_maya", "north", "south");
    move("citizen_maya", "south", "north");
    expect(read("citizen_maya")).toEqual({ bread: 4 });
    expect(of("citizen_atlas").revokeAsset(key, "citizen_maya")).toBe(true);
    expect(read("citizen_maya")).toBeUndefined();
    expect(of("citizen_atlas").grantAsset(key, "citizen_maya")).toBe(true); // reissued
    expect(read("citizen_maya")).toEqual({ bread: 4 });
  });

  it(caseTitle("ADV-03", "rival-community members and unknown citizens never read, record or learn the chest exists"), () => {
    rec("citizen_atlas", { bread: 4 });
    expect(read("citizen_theo")).toBeUndefined();
    expect(rec("citizen_theo", { bread: 0 })).toBe(false);
    expect(() => of("citizen_ghost")).toThrow();
    expect(JSON.stringify(of("citizen_theo").read())).not.toContain("bread");
  });
});

suite("ADV-03 physical stock observations", () => {
  const withdrawPlan = { action: "withdrawItems", task: "withdraw_food", goal: "eat", source: "planner", reason: "qa", priority: 1, item: "bread" } as unknown as PlannedTask;
  async function actor(id: string): Promise<SkillContext> {
    const fx = await loadCraftFixture({ trees: [] });
    fx.ctx.citizenId = id;
    Object.assign(fx.ctx.bot, { game: { dimension: "overworld" }, blockAt: () => ({ name: "chest" }) });
    return fx.ctx;
  }

  it(caseTitle("ADV-03", "a withdrawal that proves one item absent invalidates only that item and leaves other observations alone"), async () => {
    rec("citizen_atlas", { bread: 4, apple: 2 });
    vi.mocked(withdrawItems).mockResolvedValue(fail("VERIFY_FAILED", "chest holds no bread", 1, true));
    await executePlan(await actor("citizen_atlas"), withdrawPlan, store, new EventBus());
    const after = read("citizen_atlas") ?? {};
    expect(after.bread ?? 0).toBe(0);
    expect(after.apple).toBe(2);
    expect(Object.keys(after).every((k) => k === "apple" || k === "bread")).toBe(true);
  });

  it(caseTitle("ADV-03", "failing to reach the chest does not prove the item absent"), async () => {
    rec("citizen_atlas", { bread: 4 });
    vi.mocked(withdrawItems).mockResolvedValue(fail("PATH_FAILED", "could not reach chest", 1, true));
    await executePlan(await actor("citizen_atlas"), withdrawPlan, store, new EventBus());
    expect(read("citizen_atlas")).toEqual({ bread: 4 });
  });

  it(caseTitle("ADV-03", "an unauthorized rival's failed withdrawal neither reads nor changes the owner's observation"), async () => {
    rec("citizen_atlas", { bread: 4 });
    vi.mocked(withdrawItems).mockResolvedValue(fail("VERIFY_FAILED", "chest holds no bread", 1, true));
    await executePlan(await actor("citizen_theo"), withdrawPlan, store, new EventBus());
    expect(read("citizen_atlas")).toEqual({ bread: 4 });
  });

  it(caseTitle("ADV-03", "a partial withdrawal records exactly the contents the adapter reported and fabricates no other stock"), async () => {
    rec("citizen_atlas", { bread: 4, apple: 2 });
    vi.mocked(withdrawItems).mockResolvedValue(ok({ count: 1, contents: { bread: 3 } } as never, 1));
    await executePlan(await actor("citizen_atlas"), { ...withdrawPlan, count: 4 } as PlannedTask, store, new EventBus());
    expect(read("citizen_atlas")).toEqual({ bread: 3, apple: 2 });
  });
});

describe(caseTitle("ADV-03", "interface gaps (recorded, not faked)"), () => {
  // The container-contents interface returns bare counts. There is no observedAt/verified-live metadata, and no
  // ordering token for concurrent observers, so these two obligations cannot be asserted honestly yet.
  it.skip(caseTitle("ADV-03", "a stale observation is never treated as verified live stock without a recheck (needs observation metadata: observedAt/verifiedLive)", { blocked: true }), () => undefined);
  it.skip(caseTitle("ADV-03", "concurrent observations cannot overwrite a newer authoritative result (needs an ordering token on recordContainerObservation)", { blocked: true }), () => undefined);
  // Skipped while the interface is absent (HAS_CONTENTS false); when present the real suites above run instead.
  (BLOCK ? it.skip : it.skip)(caseTitle("ADV-03", "chest contents interface (recordContainerObservation) does not exist on this source", { blocked: true }), () => undefined);
});
