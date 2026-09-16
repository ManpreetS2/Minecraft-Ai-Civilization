import type { CitizenMind, ReflectionContext, ReflectionTrigger } from "@civ/psychology";
import type { CognitionContext } from "@civ/psychology";
import type { WorldSnapshot } from "@civ/memory";
import { trimCognitionContext, type TrimmedContext } from "./trim.js";

/** Compact engine facts only. Does not dump a mechanics encyclopedia. */
export type RelevantGameKnowledge = {
  facts: string[];
  goal?: string;
};

export type ContextBuilderInput = {
  citizenId: string;
  name?: string;
  currentGoal?: string;
  currentTask?: string;
  health?: number;
  hunger?: number;
  inventory?: string[];
  settlementNeeds?: string[];
  snapshot?: WorldSnapshot;
  query?: string;
  contextSize?: number;
  gameKnowledge?: RelevantGameKnowledge;
};

export type EngineAwareContext = TrimmedContext & {
  relevantGameKnowledge?: RelevantGameKnowledge;
};

export class CognitionContextBuilder {
  constructor(private readonly mind: CitizenMind) {}

  build(input: ContextBuilderInput): EngineAwareContext {
    const ctx: CognitionContext = this.mind.context({
      citizenId: input.citizenId,
      name: input.name,
      currentGoal: input.currentGoal,
      currentTask: input.currentTask,
      health: input.health,
      hunger: input.hunger,
      inventory: input.inventory,
      settlementNeeds: input.settlementNeeds,
      snapshot: input.snapshot,
      query: input.query,
    });
    const trimmed = trimCognitionContext(ctx, input.contextSize ?? 8192);
    return { ...trimmed, relevantGameKnowledge: input.gameKnowledge };
  }

  buildReflection(trigger: ReflectionTrigger, limit = 10): ReflectionContext {
    const snapshot = this.mind.snapshot(trigger.citizenId);
    return {
      trigger,
      relevantMemories: snapshot.memories.filter((m) => m.importance >= 0.35).slice(0, limit),
      psychState: snapshot.psych,
      socialBeliefs: snapshot.beliefs,
    };
  }
}
