/**
 * Real store/executor ChestRegressionAdapter for the integrated candidate.
 * Callers must stub withdrawItems (via @civ/skills mock) to prove empty-chest withdrawals.
 */
import { EventBus } from "@civ/shared";
import { CivilizationStore, communityPhysicalState, executePlan, physicalBlockKey } from "@civ/agent-core";
import { loadCraftFixture } from "../../packages/agent-core/src/testing/load-craft-fixture.js";
import type { ChestRegressionAdapter } from "./regressions.js";

const pos = { x: 12, y: 64, z: 8 };
const audit = { actor: "orchestrator-config" as const, reason: "integrated chest regression" };
type Role = "owner" | "grantee" | "rival";
const IDS: Record<Role, string> = {
  owner: "citizen_atlas",
  grantee: "citizen_maya",
  rival: "citizen_theo",
};

export function createIntegratedChestAdapter(deps: {
  stubEmptyWithdraw: () => void;
}): ChestRegressionAdapter {
  let store: CivilizationStore | undefined;
  const key = () => physicalBlockKey("overworld", pos);
  const of = (role: Role) => communityPhysicalState(store!).forCitizen(IDS[role]);
  const asRole = (actor: string): Role => {
    if (actor === "owner" || actor === "grantee" || actor === "rival") return actor;
    throw new Error(`unknown chest regression actor ${actor}`);
  };

  return {
    async reset() {
      store?.close();
      store = new CivilizationStore(":memory:");
      store.upsertCommunity("north", "North", audit);
      store.upsertCommunity("south", "South", audit);
      store.addCommunityMember("north", IDS.owner, audit);
      store.addCommunityMember("north", IDS.grantee, audit);
      store.addCommunityMember("south", IDS.rival, audit);
      of("owner").registerAsset("chest", "overworld", pos);
    },
    async grant(actor, recipient) {
      return of(asRole(actor)).grantAsset(key(), IDS[asRole(recipient)]);
    },
    async changeCommunity(actor, community) {
      const id = IDS[asRole(actor)];
      const current = store!.getCommunityDirectory().communityOf(id);
      if (!current) throw new Error(`no membership for ${id}`);
      if (current === community) return;
      store!.removeCommunityMember(current, id, audit);
      store!.addCommunityMember(community, id, audit);
    },
    async write(actor, count) {
      return of(asRole(actor)).recordContainerObservation(key(), { bread: count });
    },
    async read(actor) {
      return of(asRole(actor)).observedContainerContents(key())?.bread;
    },
    async withdrawFromEmpty(actor) {
      deps.stubEmptyWithdraw();
      const fx = await loadCraftFixture({ trees: [] });
      fx.ctx.citizenId = IDS[asRole(actor)];
      Object.assign(fx.ctx.bot, { game: { dimension: "overworld" }, blockAt: () => ({ name: "chest" }) });
      const result = await executePlan(
        fx.ctx,
        {
          action: "withdrawItems",
          task: "withdraw_food",
          goal: "eat",
          source: "planner",
          reason: "integrated chest regression",
          priority: 1,
          item: "bread",
        },
        store!,
        new EventBus(),
      );
      return result.success;
    },
  };
}
