import { FOOD_ITEM_NAMES } from "@civ/shared";
import type { Goal } from "./goals.js";

export type VerifiedFacts = {
  hunger?: number;
  health?: number;
  personalInventory: Array<{ name: string; count: number }>;
  settlementFoodReserve?: number;
  nearbyHostiles?: Array<{ name: string; distance: number }>;
  projectComplete?: boolean;
  projectId?: string;
  tools?: string[];
};

export type GuardViolation = {
  code:
    | "PERSONAL_FOOD_PRESENT"
    | "HEALTH_NOT_CRITICAL"
    | "NO_CREEPER_THREAT"
    | "PROJECT_ALREADY_COMPLETE"
    | "TOOL_PRESENT"
    | "INVENTED_FACT";
  message: string;
};

export type GuardResult = {
  ok: boolean;
  violations: GuardViolation[];
};

const PERSONAL_NO_FOOD_CLAIM =
  /\b(i have no food|i('m| am) (out of food|starving)|have nothing to eat|starving with empty (hands|inventory)|my inventory has no food)\b/i;
const SETTLEMENT_FOOD_TALK = /\b(settlement|reserve|shared (chest|storage)|community food)\b/i;
const CRITICAL_INJURY_CLAIM = /\b(critically injured|bleeding out|about to die|health is critical)\b/i;
const CREEPER_CLAIM = /\b(creeper (is )?(here|attacking|about to explode)|immediate creeper)\b/i;
const NO_TOOL_CLAIM = /\b(no pickaxe|don't have (a |any )?pickaxe|tool is missing|without (a )?pickaxe)\b/i;

export function personalEdibleCount(inventory: Array<{ name: string; count: number }>): number {
  return inventory.reduce((sum, item) => (isEdibleName(item.name) ? sum + item.count : sum), 0);
}

export function isEdibleName(name: string): boolean {
  return FOOD_ITEM_NAMES.has(name) || /steak|cooked_|bread|apple|carrot|potato|berry|pie|stew|beef|porkchop|chicken|mutton|cod|salmon/i.test(name);
}

export function hasTool(facts: VerifiedFacts, pattern: RegExp): boolean {
  if (facts.tools?.some((name) => pattern.test(name))) return true;
  return facts.personalInventory.some((item) => item.count > 0 && pattern.test(item.name));
}

/**
 * Pure fact validation. Cognition may not invent missing world truth.
 * Settlement reserve 0 is not personal starvation when the citizen holds food.
 */
export function guardDecisionFacts(args: {
  goal: Goal | string;
  reason?: string;
  facts: VerifiedFacts;
}): GuardResult {
  const violations: GuardViolation[] = [];
  const reason = args.reason ?? "";
  const edible = personalEdibleCount(args.facts.personalInventory);
  const hunger = args.facts.hunger ?? 20;
  const health = args.facts.health ?? 20;
  const hostiles = args.facts.nearbyHostiles ?? [];
  const creeperClose = hostiles.some((h) => /creeper/i.test(h.name) && h.distance < 8);

  if (edible > 0 && PERSONAL_NO_FOOD_CLAIM.test(reason) && !SETTLEMENT_FOOD_TALK.test(reason)) {
    violations.push({
      code: "PERSONAL_FOOD_PRESENT",
      message: `Citizen is carrying ${edible} edible item(s). Settlement reserve is a separate fact.`,
    });
  }
  if (edible > 0 && hunger > 7 && PERSONAL_NO_FOOD_CLAIM.test(reason)) {
    violations.push({
      code: "PERSONAL_FOOD_PRESENT",
      message: "Personal hunger is not starvation while edible inventory is present.",
    });
  }
  if (health >= 18 && CRITICAL_INJURY_CLAIM.test(reason)) {
    violations.push({ code: "HEALTH_NOT_CRITICAL", message: "Health is not critical." });
  }
  if (!creeperClose && CREEPER_CLAIM.test(reason)) {
    violations.push({ code: "NO_CREEPER_THREAT", message: "No verified close Creeper threat." });
  }
  if (args.facts.projectComplete && (args.goal === "contribute_to_project" || args.goal === "build_shelter") && /finish|complete the (same )?project/i.test(reason)) {
    violations.push({ code: "PROJECT_ALREADY_COMPLETE", message: "The project is already complete." });
  }
  if (hasTool(args.facts, /pickaxe/i) && NO_TOOL_CLAIM.test(reason)) {
    violations.push({ code: "TOOL_PRESENT", message: "A pickaxe is already in verified inventory." });
  }
  return { ok: violations.length === 0, violations };
}

export function settlementFoodIsNotPersonal(facts: VerifiedFacts): boolean {
  return personalEdibleCount(facts.personalInventory) > 0;
}
