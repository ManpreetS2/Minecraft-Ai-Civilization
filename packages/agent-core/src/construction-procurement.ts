/**
 * Phase D — material procurement planning for construction (offline).
 * Does not invent chest contents; only uses observed inventory bags passed in.
 */
import { recipeAwareMaterialNeeds } from "@civ/minecraft-knowledge";
import type { SettlementRuntime } from "./settlement-runtime.js";
import { authorizedInventoryForCitizen } from "./build-structure.js";

export type ProcurementPlan = {
  remaining: Record<string, number>;
  shortfall: Record<string, number>;
  craftHints: Array<{ item: string; from: string; note: string }>;
  /** Suggested next obtain/craft item (incremental — not whole building). */
  nextObtainItem?: string;
  nextObtainCount: number;
  status: "SATISFIED" | "NEED_CRAFT" | "NEED_GATHER" | "BLOCKED";
  reason: string;
};

/**
 * Plan procurement from remaining BOM vs authorized inventory.
 * Chest contents must be supplied by caller after a real observe/open — never assumed.
 */
export function planConstructionProcurement(args: {
  citizenId: string;
  runtime: SettlementRuntime;
  remainingBill: Record<string, number>;
  physicalInventory: Record<string, number>;
  /** Optional observed authorized-chest bag (must be freshly observed). */
  observedAuthorizedChest?: Record<string, number>;
  now?: number;
}): ProcurementPlan {
  const physical = { ...args.physicalInventory };
  if (args.observedAuthorizedChest) {
    for (const [item, count] of Object.entries(args.observedAuthorizedChest)) {
      physical[item] = (physical[item] ?? 0) + count;
    }
  }
  const authorized = authorizedInventoryForCitizen(
    args.runtime,
    args.citizenId,
    physical,
    args.now,
  );
  const { shortfall, craftHints } = recipeAwareMaterialNeeds(args.remainingBill, authorized);
  if (Object.keys(shortfall).length === 0) {
    return {
      remaining: args.remainingBill,
      shortfall: {},
      craftHints,
      nextObtainCount: 0,
      status: "SATISFIED",
      reason: "Authorized inventory covers remaining bill",
    };
  }
  const next = Object.entries(shortfall).sort((a, b) => b[1] - a[1])[0]!;
  const needsCraft = craftHints.some((h) => h.item === next[0]);
  // Incremental: ask for a stack-sized bite, not the entire remaining building.
  const bite = Math.min(next[1], next[0].endsWith("_planks") ? 16 : next[0].endsWith("_log") ? 8 : 1);
  return {
    remaining: args.remainingBill,
    shortfall,
    craftHints,
    nextObtainItem: next[0],
    nextObtainCount: bite,
    status: needsCraft ? "NEED_CRAFT" : "NEED_GATHER",
    reason: needsCraft
      ? `Craft/convert toward ${bite} ${next[0]} (shortfall ${next[1]})`
      : `Gather ${bite} ${next[0]} (shortfall ${next[1]}); not fabricating stock`,
  };
}

export function releaseConstructionReservations(
  runtime: SettlementRuntime,
  citizenId: string,
): number {
  let n = 0;
  for (const hold of runtime.reservations.list()) {
    if (hold.ownerId === citizenId && hold.purpose === "construction") {
      runtime.reservations.release(hold.id);
      n += 1;
    }
  }
  return n;
}

export function reserveProcurementBite(
  runtime: SettlementRuntime,
  citizenId: string,
  plan: ProcurementPlan,
  now = Date.now(),
): void {
  if (!plan.nextObtainItem || plan.nextObtainCount <= 0) return;
  runtime.reservations.reserve(
    citizenId,
    "construction",
    plan.nextObtainItem,
    plan.nextObtainCount,
    10 * 60_000,
    now,
  );
}
