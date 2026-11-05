/** Community-owned container contents: observed (not global stock), readable only by owner and grantees. Offline. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, ok } from "@civ/shared";
import { depositItems, withdrawItems, type SkillContext } from "@civ/skills";
import { CivilizationStore } from "./store.js";
import { communityPhysicalState, physicalBlockKey } from "./community-physical-state.js";
import { executePlan } from "./executor.js";
import { loadCraftFixture } from "./testing/load-craft-fixture.js";

vi.mock("@civ/skills", async (original) => ({
  ...(await original<typeof import("@civ/skills")>()),
  depositItems: vi.fn(),
  withdrawItems: vi.fn(),
}));

const pos = { x: 12, y: 64, z: 8 };
const key = physicalBlockKey("overworld", pos);
const audit = { actor: "orchestrator-config" as const, reason: "container contents regression" };
let store: CivilizationStore;

beforeEach(() => {
  store = new CivilizationStore(":memory:");
  store.upsertCommunity("north", "North", audit);
  store.upsertCommunity("south", "South", audit);
  store.addCommunityMember("north", "citizen_atlas", audit);
  store.addCommunityMember("north", "citizen_maya", audit);
  store.addCommunityMember("south", "citizen_theo", audit);
  communityPhysicalState(store).forCitizen("citizen_atlas").registerAsset("chest", "overworld", pos);
  vi.mocked(depositItems).mockReset();
  vi.mocked(withdrawItems).mockReset();
});
afterEach(() => store.close());

const of = (id: string) => communityPhysicalState(store).forCitizen(id);

async function ctx(id: string, held: Array<{ name: string; count: number }> = []): Promise<SkillContext> {
  const fx = await loadCraftFixture({ trees: [] });
  fx.ctx.citizenId = id;
  Object.assign(fx.ctx.bot, { game: { dimension: "overworld" }, blockAt: () => ({ name: "chest" }) });
  fx.items.push(...held);
  return fx.ctx;
}
const withdrawPlan = { action: "withdrawItems" as const, task: "withdraw_food", goal: "eat", source: "planner" as const, reason: "t", priority: 1 };
const depositPlan = { action: "depositItems" as const, task: "deposit", goal: "storage", source: "planner" as const, reason: "t", priority: 1 };

describe("observed container contents API", () => {
  it("is readable only by the owner and explicit grantees", () => {
    const owner = of("citizen_atlas");
    expect(owner.recordContainerObservation(key, { bread: 4 })).toBe(true);
    expect(owner.observedContainerContents(key)).toEqual({ bread: 4 });
    const details = owner.observedContainerDetails(key);
    expect(details?.contents).toEqual({ bread: 4 });
    expect(details?.observedBy).toBe("citizen_atlas");
    expect(details?.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(details?.basis).toBe("observed");
    expect(details?.revision).toBe(1);
    expect(of("citizen_maya").observedContainerContents(key)).toBeUndefined();
    expect(of("citizen_maya").observedContainerDetails(key)).toBeUndefined();
    expect(of("citizen_theo").observedContainerContents(key)).toBeUndefined();
    owner.grantAsset(key, "citizen_maya");
    expect(of("citizen_maya").observedContainerContents(key)).toEqual({ bread: 4 });
    expect(of("citizen_maya").observedContainerDetails(key)?.observedBy).toBe("citizen_atlas");
    expect(owner.recordContainerObservation(key, { bread: 99 }, { expectedRevision: 0 })).toBe(false);
    expect(owner.recordContainerObservation(key, { bread: 3 }, { expectedRevision: 1 })).toBe(true);
    expect(owner.observedContainerDetails(key)?.revision).toBe(2);
    owner.revokeAsset(key, "citizen_maya");
    expect(of("citizen_maya").observedContainerContents(key)).toBeUndefined();
  });

  it("refuses observations from non-authorized citizens and leaves the stored value unchanged", () => {
    const owner = of("citizen_atlas");
    owner.recordContainerObservation(key, { bread: 4 });
    expect(of("citizen_maya").recordContainerObservation(key, { bread: 99 })).toBe(false);
    expect(of("citizen_theo").recordContainerObservation(key, { bread: 99 })).toBe(false);
    expect(owner.observedContainerContents(key)).toEqual({ bread: 4 });
  });

  it("merges observed items, rejects invalid counts, and never records non-chest assets", () => {
    const owner = of("citizen_atlas");
    owner.recordContainerObservation(key, { bread: 4, apple: 2 });
    owner.recordContainerObservation(key, { bread: 1 });
    expect(owner.observedContainerContents(key)).toEqual({ bread: 1, apple: 2 });
    for (const bad of [{ bread: -1 }, { bread: 1.5 }, { bread: Number.NaN }, { bread: Number.POSITIVE_INFINITY }]) {
      expect(() => owner.recordContainerObservation(key, bad)).toThrow(/invalid/);
    }
    owner.registerAsset("crafting_table", "overworld", { x: 1, y: 64, z: 1 });
    expect(owner.recordContainerObservation(physicalBlockKey("overworld", { x: 1, y: 64, z: 1 }), { bread: 1 })).toBe(false);
    expect(owner.observedContainerContents(key)).toEqual({ bread: 1, apple: 2 });
  });

  it("is removed when the owner abandons the container and never enters community-wide state", () => {
    const owner = of("citizen_atlas");
    owner.recordContainerObservation(key, { bread: 4 });
    expect(owner.read().state.storageContents ?? {}).toEqual({});
    expect(store.getSettlement().storageContents ?? {}).toEqual({});
    owner.abandonAsset(key);
    expect(store.db.prepare("SELECT count(*) AS n FROM physical_asset_contents").get()).toEqual({ n: 0 });
  });
});

describe("executor uses observed contents, not global stock", () => {
  it("records actual deposited contents for the owner only and leaves the settlement row untouched", async () => {
    vi.mocked(depositItems).mockResolvedValue(ok({ deposited: 3, contents: { oak_log: 3 }, position: pos }, 1));
    const before = JSON.stringify(store.getSettlement());
    const result = await executePlan(await ctx("citizen_atlas", [{ name: "oak_log", count: 3 }]), depositPlan, store, new EventBus());
    expect(result.success).toBe(true);
    expect(of("citizen_atlas").observedContainerContents(key)).toEqual({ oak_log: 3 });
    expect(of("citizen_maya").observedContainerContents(key)).toBeUndefined();
    expect(JSON.stringify(store.getSettlement())).toEqual(before);
  });

  it("lets the owner and a grantee withdraw observed food and updates the observation from the live count", async () => {
    of("citizen_atlas").recordContainerObservation(key, { bread: 2 });
    of("citizen_atlas").grantAsset(key, "citizen_maya");
    vi.mocked(withdrawItems).mockResolvedValue(ok({ item: "bread", count: 1, contents: { bread: 1 } }, 1));
    expect((await executePlan(await ctx("citizen_atlas"), withdrawPlan, store, new EventBus())).success).toBe(true);
    expect(vi.mocked(withdrawItems).mock.calls[0]?.[1]).toBe("bread");
    expect(of("citizen_atlas").observedContainerContents(key)).toEqual({ bread: 1 });
    expect((await executePlan(await ctx("citizen_maya"), withdrawPlan, store, new EventBus())).success).toBe(true);
    expect(withdrawItems).toHaveBeenCalledTimes(2);
  });

  it("never withdraws for ungranted same-community members or other communities", async () => {
    of("citizen_atlas").recordContainerObservation(key, { bread: 2 });
    for (const id of ["citizen_maya", "citizen_theo"]) {
      await executePlan(await ctx(id), withdrawPlan, store, new EventBus());
    }
    expect(withdrawItems).not.toHaveBeenCalled();
  });

  it("invalidates the observed item after a live withdraw proves absence, without fabricating other stock", async () => {
    of("citizen_atlas").recordContainerObservation(key, { bread: 2, apple: 1 });
    vi.mocked(withdrawItems).mockResolvedValue({ success: false, code: "ITEM_NOT_FOUND", error: "empty", durationMs: 1, retryable: true });
    const result = await executePlan(await ctx("citizen_atlas"), withdrawPlan, store, new EventBus());
    expect(result.success).toBe(false);
    // Only the attempted item is cleared; unrelated last-observed keys remain until a later live observation.
    expect(of("citizen_atlas").observedContainerContents(key)).toEqual({ apple: 1 });
  });
});

describe("chest observation revision survives SQLite reopen", () => {
  it("keeps revision/observedAt and rejects stale expectedRevision after restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "chest-rev-"));
    const path = join(dir, "chest.sqlite");
    try {
      const first = new CivilizationStore(path);
      first.upsertCommunity("north", "North", audit);
      first.addCommunityMember("north", "citizen_atlas", audit);
      const write = communityPhysicalState(first).forCitizen("citizen_atlas");
      write.registerAsset("chest", "overworld", pos);
      expect(write.recordContainerObservation(key, { bread: 4 })).toBe(true);
      const before = write.observedContainerDetails(key)!;
      expect(before.revision).toBe(1);
      first.close();

      const second = new CivilizationStore(path);
      const read = communityPhysicalState(second).forCitizen("citizen_atlas");
      const after = read.observedContainerDetails(key)!;
      expect(after.contents).toEqual({ bread: 4 });
      expect(after.revision).toBe(before.revision);
      expect(after.observedAt).toBe(before.observedAt);
      expect(after.basis).toBe("observed");
      expect(read.recordContainerObservation(key, { bread: 99 }, { expectedRevision: 0 })).toBe(false);
      expect(read.recordContainerObservation(key, { bread: 3 }, { expectedRevision: after.revision })).toBe(true);
      expect(read.observedContainerDetails(key)?.revision).toBe(after.revision + 1);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
