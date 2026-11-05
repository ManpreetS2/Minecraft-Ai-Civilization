import type {
  ActionVerificationResult,
  InventoryConservationAudit,
  InventoryDiscrepancy,
} from "./types.js";
import type { ValidatedManifest } from "./schemas.js";

export function auditInventoryConservation(args: {
  manifest?: ValidatedManifest;
  actionVerifications: ActionVerificationResult[];
  citizenFinalInventories?: Record<string, Record<string, number>>;
}): InventoryConservationAudit {
  const discrepancies: InventoryDiscrepancy[] = [];
  const totalItemsAcquired: Record<string, number> = {};
  const totalItemsConsumed: Record<string, number> = {};
  const citizenLedger: Record<string, Record<string, number>> = {};

  // 1. Verify empty start
  let initialInventoriesEmpty = true;
  if (args.manifest) {
    for (const citizen of args.manifest.citizens) {
      if (citizen.inventory.length > 0 || !citizen.inventoryVerified) {
        initialInventoriesEmpty = false;
        discrepancies.push({
          citizenId: citizen.id,
          item: "starter_inventory",
          amount: citizen.inventory.reduce((acc: number, i: { count: number }) => acc + i.count, 0),
          type: "SPONTANEOUS_GAIN",
          description: `Citizen '${citizen.id}' started with unverified non-empty inventory`,
        });
      }
    }
  }

  // 2. Accumulate verified action deltas
  for (const ver of args.actionVerifications) {
    if (ver.status !== "VERIFIED") continue;

    const citizenId = ver.citizenId;
    if (!citizenLedger[citizenId]) {
      citizenLedger[citizenId] = {};
    }

    const deltas = ver.physicalDeltas.inventoryDelta;
    for (const [item, delta] of Object.entries(deltas)) {
      citizenLedger[citizenId]![item] = (citizenLedger[citizenId]![item] ?? 0) + delta;
      if (delta > 0) {
        totalItemsAcquired[item] = (totalItemsAcquired[item] ?? 0) + delta;
      } else if (delta < 0) {
        totalItemsConsumed[item] = (totalItemsConsumed[item] ?? 0) + Math.abs(delta);
      }
    }
  }

  // 3. Reconcile with final observed inventories
  const finalInventories = args.citizenFinalInventories ?? {};
  for (const [citizenId, observedInv] of Object.entries(finalInventories)) {
    const calculatedInv = citizenLedger[citizenId] ?? {};
    for (const [item, observedCount] of Object.entries(observedInv)) {
      const calculatedCount = calculatedInv[item] ?? 0;
      if (observedCount > calculatedCount) {
        const excess = observedCount - calculatedCount;
        discrepancies.push({
          citizenId,
          item,
          amount: excess,
          type: "SPONTANEOUS_GAIN",
          description: `Citizen '${citizenId}' holds ${observedCount}x '${item}', but verified actions only account for ${calculatedCount}x (+${excess} spontaneous gain)`,
        });
      }
    }
  }

  return {
    initialInventoriesEmpty,
    totalItemsAcquired,
    totalItemsConsumed,
    citizenFinalInventories: finalInventories,
    discrepancies,
    valid: initialInventoriesEmpty && discrepancies.length === 0,
  };
}
