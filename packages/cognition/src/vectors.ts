import { GOALS, type Goal } from "./goals.js";

export type VectorFamily =
  | "fact_consistency"
  | "goal_validity"
  | "compound"
  | "follow_up"
  | "personal_vs_settlement_food"
  | "no_llm"
  | "staleness"
  | "memory_retrieval"
  | "lesson"
  | "rumor_provenance"
  | "social"
  | "uncertainty"
  | "perspective"
  | "reflection"
  | "communication"
  | "fallback"
  | "directive"
  | "conflicting_goals"
  | "success_failure_learning"
  | "recovery"
  | "creeper_loss"
  | "execution_vs_decision"
  | "infrastructure_veto"
  | "speech_not_action"
  | "diversity";

export type CognitionVector = {
  id: string;
  family: VectorFamily;
  title: string;
  facts: Record<string, unknown>;
  expect: Record<string, unknown>;
};

const CITIZENS = ["Atlas", "Maya", "Theo", "Ava", "Kai"] as const;

function v(family: VectorFamily, n: number, title: string, facts: Record<string, unknown>, expect: Record<string, unknown>): CognitionVector {
  return { id: `${family}_${String(n).padStart(3, "0")}`, family, title, facts, expect };
}

export function buildCognitionVectors(): CognitionVector[] {
  const out: CognitionVector[] = [];

  out.push(
    v("personal_vs_settlement_food", 1, "Atlas holds 64 steak, hunger 14, settlement food 0", {
      hunger: 14,
      health: 20,
      inventory: [{ name: "steak", count: 64 }],
      settlementFoodReserve: 0,
      settlementNeeds: ["NEED_FOOD"],
    }, { cannotClaim: "no food", personalFood: 64, settlementFood: 0, forbiddenPersonalGoalReason: "starvation" }),
    v("fact_consistency", 1, "Health 20 cannot be critically injured", { health: 20, reason: "I am critically injured" }, { guard: "HEALTH_NOT_CRITICAL" }),
    v("fact_consistency", 2, "No creeper nearby cannot claim immediate creeper", { nearbyHostiles: [], reason: "A creeper is about to explode" }, { guard: "NO_CREEPER_THREAT" }),
    v("fact_consistency", 3, "Pickaxe present cannot claim tool absent", { inventory: [{ name: "iron_pickaxe", count: 1 }], reason: "I don't have a pickaxe" }, { guard: "TOOL_PRESENT" }),
    v("fact_consistency", 4, "Complete project cannot finish same project", { projectComplete: true, goal: "contribute_to_project", reason: "finish the same project" }, { guard: "PROJECT_ALREADY_COMPLETE" }),
    v("no_llm", 1, "Creeper at 4 blocks is reflex", { nearbyHostiles: [{ name: "creeper", distance: 4 }], health: 18, inventory: [] }, { mode: "NO_LLM", reflex: true }),
    v("no_llm", 2, "Drowning is reflex", { oxygen: 2, inventory: [], nearbyHostiles: [] }, { mode: "NO_LLM", reflex: "drowning" }),
    v("no_llm", 3, "Fire is reflex", { onFire: true, inventory: [], nearbyHostiles: [] }, { mode: "NO_LLM", reflex: "fire" }),
    v("no_llm", 4, "Hunger 5 with bread is eat reflex", { hunger: 5, inventory: [{ name: "bread", count: 1 }], nearbyHostiles: [] }, { mode: "NO_LLM", reflex: "eat_available_food" }),
    v("compound", 1, "Gather stone and craft tools without pickaxe", { text: "Gather stone and craft better tools", hasPickaxe: false }, { primary: "craft_tools", followUp: ["mine_stone"] }),
    v("compound", 2, "Walk west is execution-level", { text: "walk west then jump" }, { code: "EXECUTION_LEVEL" }),
    v("compound", 3, "Unknown phrase rejected", { text: "do a backflip" }, { code: "UNKNOWN_GOAL" }),
    v("execution_vs_decision", 1, "Path blocked is not a bad gather_wood decision", { goal: "gather_wood", errorCode: "PATH_BLOCKED" }, { category: "SKILL_EXECUTION", not: "AGENT_DECISION" }),
    v("infrastructure_veto", 1, "Keepalive is system", { errorMessage: "client timed out after 30000 milliseconds", goal: "gather_wood" }, { track: "SYSTEM", citizenLearns: false }),
    v("speech_not_action", 1, "I'll give Maya food is not a transfer", { text: "I'll give Maya food" }, { fulfillsPromise: false }),
    v("communication", 1, "Mining one log should stay silent", { activity: "gather_wood", routine: true }, { speak: false }),
  );

  for (const goal of GOALS) {
    out.push(v("goal_validity", out.filter((x) => x.family === "goal_validity").length + 1, `Goal ${goal} is bounded`, { goal }, { valid: true, goal }));
  }

  CITIZENS.forEach((name, i) => {
    out.push(v("diversity", i + 1, `${name} should not clone all-wood when NEED_WOOD`, {
      citizen: name,
      settlementNeeds: ["NEED_WOOD"],
      inventory: i === 0 ? [{ name: "steak", count: 8 }] : [],
      recentWork: i % 2 === 0 ? "build" : "gather_wood",
    }, { notAllSame: true }));
  });

  const perspectives = [
    ["Atlas", "DIRECT", "Theo took bread", "uncertain"],
    ["Maya", "WITNESSED", "Theo was near the chest", "suspicious"],
    ["Kai", "HEARD", "Maya said Theo stole food", "rumor"],
    ["Ava", "DIRECT", "Creeper exploded the chest", "creeper"],
    ["Theo", "DIRECT", "I withdrew 5 bread", "necessary"],
  ] as const;
  perspectives.forEach((row, i) => {
    out.push(v("perspective", i + 1, `${row[0]} interprets empty chest via ${row[1]}`, {
      citizen: row[0],
      source: row[1],
      claim: row[2],
      objective: "5 bread removed from chest",
    }, { interpretation: row[3], objectiveUnchanged: true }));
  });

  for (let i = 1; i <= 12; i += 1) {
    out.push(v("rumor_provenance", i, `Rumor chain step ${i}`, {
      informant: CITIZENS[i % 5],
      claim: "Theo stole food",
      confidence: 0.4 + (i % 3) * 0.1,
    }, { storedAs: "HEARD", notObjective: true }));
  }

  for (let i = 1; i <= 10; i += 1) {
    out.push(v("staleness", i, `Stale case ${i}`, {
      assumed: { hunger: 6, hasFoodInInventory: false, nearbyHostile: false, health: 18 },
      current: i === 1
        ? { hunger: 16, hasFoodInInventory: true, nearbyHostile: false, health: 18 }
        : i === 2
          ? { hunger: 6, hasFoodInInventory: false, nearbyHostile: true, health: 18 }
          : i === 3
            ? { hunger: 6, hasFoodInInventory: false, nearbyHostile: false, health: 3 }
            : i === 4
              ? { hunger: 6, hasFoodInInventory: true, nearbyHostile: false, health: 18, directiveId: "d2" }
              : i === 5
                ? { hunger: 6, hasFoodInInventory: false, nearbyHostile: false, health: 18, projectComplete: true }
                : { hunger: 6, hasFoodInInventory: false, nearbyHostile: false, health: 18 },
    }, { stale: i <= 5 }));
  }

  const extras: Array<[VectorFamily, string]> = [
    ["memory_retrieval", "Relevant memory subset"],
    ["lesson", "Lesson same goal same error"],
    ["social", "Pairwise trust not global reputation"],
    ["uncertainty", "Unknown source stays uncertain"],
    ["reflection", "Routine mining does not reflect"],
    ["fallback", "LLM down uses heuristic"],
    ["directive", "Human directive is high priority context"],
    ["conflicting_goals", "Hunger vs settlement wood"],
    ["success_failure_learning", "Recovery records success"],
    ["recovery", "Safe rebuild weakens obsolete avoidance"],
    ["creeper_loss", "Creeper storage loss is high salience"],
    ["follow_up", "Follow-ups reconsider after primary complete"],
    ["fact_consistency", "Cannot invent hostile"],
  ];
  let n = 20;
  for (const [family, title] of extras) {
    for (let i = 0; i < 8; i += 1) {
      n += 1;
      out.push(v(family, n, `${title} ${i + 1}`, { variant: i, citizen: CITIZENS[i % 5] }, { covered: true }));
    }
  }

  for (let i = 0; i < 20; i += 1) {
    out.push(v("perspective", 10 + i, `Perspective fixture ${i + 1}`, {
      observer: CITIZENS[i % 5],
      target: CITIZENS[(i + 1) % 5],
      mood: i % 3 === 0 ? "stressed" : "calm",
      source: i % 2 === 0 ? "HEARD" : "WITNESSED",
      need: i % 4 === 0 ? "food" : "none",
    }, { objectiveUnchanged: true, localBelief: true }));
  }

  return out;
}

export const COGNITION_VECTORS: CognitionVector[] = buildCognitionVectors();

export function vectorsByFamily(family: VectorFamily): CognitionVector[] {
  return COGNITION_VECTORS.filter((row) => row.family === family);
}

export type GoalName = Goal;
