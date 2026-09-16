import type { CognitionContext } from "@civ/psychology";
import type { CognitionDecision } from "./schema.js";
import type { WorldView } from "./reflex.js";

export type BenchmarkScenario = {
  id: string;
  title: string;
  view: WorldView;
  context: Partial<CognitionContext> & Pick<CognitionContext, "citizen">;
  settlementNeeds: string[];
  currentGoal?: string;
  expectMode?: "NO_LLM" | "ROUTINE_DELIBERATION";
  expectReflex?: boolean;
  acceptableGoals: CognitionDecision["goal"][];
};

function baseContext(id: string, name: string): CognitionContext {
  return {
    citizen: { id, name },
    immediateNeeds: { health: 18, hunger: 16, concerns: [] },
    inventorySummary: [],
    nearbyWorldState: { entities: [] },
    mood: {
      citizenId: id,
      moodValence: 0,
      stress: 0.2,
      fear: 0,
      anger: 0,
      sadness: 0,
      positiveAffect: 0.4,
      confidence: 0.4,
      currentConcerns: [],
      updatedAt: "2026-09-16T12:00:00.000Z",
    },
    activeAffect: { dominant: "neutral", intensity: 0 },
    relevantMemories: [],
    relevantSocialBeliefs: [],
    activityFamiliarity: {},
    learnedAssociations: [],
    habits: [],
    recentImportantEvents: [],
    settlementNeeds: [],
    uncertainty: 0.3,
    uncertainties: [],
  };
}

export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  {
    id: "starving_with_food",
    title: "Starving citizen with food in inventory",
    view: {
      hunger: 5,
      health: 16,
      inventory: [{ name: "bread", count: 2 }],
      nearbyHostiles: [],
      nearbyCitizens: [],
    },
    context: baseContext("citizen_atlas", "Atlas"),
    settlementNeeds: [],
    expectReflex: true,
    expectMode: "NO_LLM",
    acceptableGoals: ["rest", "seek_safety"],
  },
  {
    id: "shelter_needs_wood",
    title: "Shelter project needs wood",
    view: {
      hunger: 16,
      health: 18,
      inventory: [{ name: "wooden_axe", count: 1 }],
      nearbyHostiles: [],
      nearbyCitizens: ["Maya"],
    },
    context: { ...baseContext("citizen_maya", "Maya"), settlementNeeds: ["NEED_WOOD", "NEED_HOUSING"] },
    settlementNeeds: ["NEED_WOOD", "NEED_HOUSING"],
    expectMode: "ROUTINE_DELIBERATION",
    acceptableGoals: ["gather_wood", "contribute_to_project", "build_shelter"],
  },
  {
    id: "repeated_failure",
    title: "Citizen repeatedly failed the same task",
    view: { hunger: 14, health: 18, inventory: [], nearbyHostiles: [], nearbyCitizens: [] },
    context: {
      ...baseContext("citizen_theo", "Theo"),
      currentGoal: "mine_stone",
      activityFamiliarity: {
        mine_stone: {
          citizenId: "citizen_theo",
          activity: "mine_stone",
          attempts: 6,
          successes: 0,
          failures: 6,
          recentSuccessRate: 0,
          familiarity: 0.4,
          confidence: 0.2,
        },
      },
    },
    currentGoal: "mine_stone",
    settlementNeeds: ["NEED_STONE"],
    acceptableGoals: ["reconsider", "mine_stone", "gather_wood", "explore"],
  },
  {
    id: "helped_by_maya",
    title: "Citizen remembers Maya helped them",
    view: {
      hunger: 14,
      health: 18,
      inventory: [],
      nearbyHostiles: [],
      nearbyCitizens: ["citizen_maya"],
    },
    context: {
      ...baseContext("citizen_atlas", "Atlas"),
      relevantMemories: [
        {
          summary: "Maya gave me 3 bread when I was very hungry.",
          importance: 0.72,
          source: "DIRECT",
          eventType: "citizen_item_received",
        },
      ],
      relevantSocialBeliefs: [
        {
          targetId: "citizen_maya",
          evidenceSummary: "Maya gave me 3 bread when I was very hungry.",
          familiarity: 0.4,
          sourceNotes: ["DIRECT: Maya gave me 3 bread when I was very hungry."],
        },
      ],
    },
    settlementNeeds: [],
    acceptableGoals: ["assist_citizen", "socialize", "rest", "explore", "gather_wood", "gather_food"],
  },
  {
    id: "creeper_association",
    title: "Danger associated with prior creeper loss",
    view: {
      hunger: 14,
      health: 14,
      inventory: [],
      nearbyHostiles: [{ name: "creeper", distance: 11 }],
      nearbyCitizens: [],
    },
    context: {
      ...baseContext("citizen_atlas", "Atlas"),
      learnedAssociations: [
        {
          id: "a1",
          citizenId: "citizen_atlas",
          subjectType: "entity",
          subjectKey: "creeper",
          associationType: "danger",
          strength: 0.7,
          confidence: 0.8,
          supportingMemoryIds: [],
          lastReinforcedAt: "t",
        },
      ],
      relevantMemories: [
        {
          summary: "A creeper destroyed my storage.",
          importance: 0.8,
          source: "DIRECT",
          eventType: "danger_encountered",
        },
      ],
      nearbyWorldState: { entities: ["creeper"] },
    },
    settlementNeeds: [],
    acceptableGoals: ["seek_safety", "defend", "rest", "explore"],
  },
  {
    id: "idle_no_urgent",
    title: "Idle citizen with no urgent needs",
    view: { hunger: 18, health: 20, inventory: [], nearbyHostiles: [], nearbyCitizens: [] },
    context: baseContext("citizen_kai", "Kai"),
    settlementNeeds: [],
    acceptableGoals: ["rest", "explore", "reconsider", "gather_wood", "contribute_to_project"],
  },
];
