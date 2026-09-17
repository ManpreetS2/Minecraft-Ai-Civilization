import { classifyFailure } from "./classify.js";
import { parseCompoundGoal } from "./compound.js";
import { speechIsNotAction } from "./communication.js";
import { guardDecisionFacts, personalEdibleCount } from "./fact-guards.js";
import { detectEmergencyReflex } from "./reflex.js";
import { isDecisionStale } from "./stale.js";
import type { CognitionVector } from "./vectors.js";

export type VectorEval = {
  id: string;
  family: string;
  pass: boolean;
  detail?: string;
};

export function evaluateCognitionVector(row: CognitionVector): VectorEval {
  try {
    if (row.family === "personal_vs_settlement_food") {
      const inventory = (row.facts.inventory as Array<{ name: string; count: number }>) ?? [];
      const edible = personalEdibleCount(inventory);
      const guarded = guardDecisionFacts({
        goal: "gather_food",
        reason: "I have no food.",
        facts: {
          hunger: Number(row.facts.hunger ?? 14),
          health: Number(row.facts.health ?? 20),
          personalInventory: inventory,
          settlementFoodReserve: Number(row.facts.settlementFoodReserve ?? 0),
        },
      });
      const pass = edible === Number(row.expect.personalFood ?? edible) && !guarded.ok;
      return { id: row.id, family: row.family, pass, detail: guarded.violations[0]?.code };
    }
    if (row.family === "compound") {
      const parsed = parseCompoundGoal(String(row.facts.text ?? ""), {
        hasPickaxe: Boolean(row.facts.hasPickaxe),
      });
      if (row.expect.code) {
        return { id: row.id, family: row.family, pass: !parsed.ok && "code" in parsed && parsed.code === row.expect.code };
      }
      return {
        id: row.id,
        family: row.family,
        pass: parsed.ok && parsed.primaryGoal === row.expect.primary,
      };
    }
    if (row.family === "no_llm") {
      const reflex = detectEmergencyReflex({
        oxygen: typeof row.facts.oxygen === "number" ? row.facts.oxygen : undefined,
        onFire: Boolean(row.facts.onFire),
        hunger: typeof row.facts.hunger === "number" ? row.facts.hunger : undefined,
        health: typeof row.facts.health === "number" ? row.facts.health : 18,
        inventory: (row.facts.inventory as Array<{ name: string; count: number }>) ?? [],
        nearbyHostiles: (row.facts.nearbyHostiles as Array<{ name: string; distance: number }>) ?? [],
        nearbyCitizens: [],
      });
      return { id: row.id, family: row.family, pass: Boolean(reflex) };
    }
    if (row.family === "fact_consistency" && typeof row.expect.guard === "string") {
      const inventory = (row.facts.inventory as Array<{ name: string; count: number }>) ?? [];
      const guarded = guardDecisionFacts({
        goal: String(row.facts.goal ?? "rest"),
        reason: String(row.facts.reason ?? ""),
        facts: {
          health: typeof row.facts.health === "number" ? row.facts.health : 20,
          personalInventory: inventory,
          nearbyHostiles: (row.facts.nearbyHostiles as Array<{ name: string; distance: number }>) ?? [],
          projectComplete: Boolean(row.facts.projectComplete),
        },
      });
      return {
        id: row.id,
        family: row.family,
        pass: guarded.violations.some((item) => item.code === row.expect.guard),
      };
    }
    if (row.family === "infrastructure_veto") {
      const classified = classifyFailure({
        errorMessage: String(row.facts.errorMessage ?? ""),
        goal: String(row.facts.goal ?? ""),
      });
      return { id: row.id, family: row.family, pass: classified.track === "SYSTEM" && classified.citizenLearns === false };
    }
    if (row.family === "execution_vs_decision") {
      const classified = classifyFailure({
        goal: String(row.facts.goal ?? ""),
        errorCode: String(row.facts.errorCode ?? ""),
      });
      return { id: row.id, family: row.family, pass: classified.category === "SKILL_EXECUTION" };
    }
    if (row.family === "speech_not_action") {
      return {
        id: row.id,
        family: row.family,
        pass: speechIsNotAction({
          speakerId: "citizen_atlas",
          listenerId: "citizen_maya",
          intent: "offer_resource",
          text: String(row.facts.text ?? ""),
          createdAtMs: 1,
        }),
      };
    }
    if (row.family === "staleness") {
      const assumed = {
        version: 2,
        createdAtMs: 1,
        hunger: 6,
        health: 18,
        hasFoodInInventory: false,
        nearbyHostile: false,
        ...(typeof row.facts.assumed === "object" && row.facts.assumed ? row.facts.assumed : {}),
      } as Parameters<typeof isDecisionStale>[0];
      const current = {
        ...assumed,
        ...(typeof row.facts.current === "object" && row.facts.current ? row.facts.current : {}),
      } as Parameters<typeof isDecisionStale>[1];
      const result = isDecisionStale(assumed, current);
      return { id: row.id, family: row.family, pass: result.stale === Boolean(row.expect.stale) || row.expect.stale === undefined };
    }
    return { id: row.id, family: row.family, pass: true };
  } catch (error) {
    return { id: row.id, family: row.family, pass: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function evaluateCognitionVectors(rows: CognitionVector[]): { passed: number; failed: VectorEval[] } {
  const results = rows.map(evaluateCognitionVector);
  return {
    passed: results.filter((row) => row.pass).length,
    failed: results.filter((row) => !row.pass),
  };
}
