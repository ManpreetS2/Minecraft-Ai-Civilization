import type { ReflectionTrigger } from "@civ/psychology";
import type { CognitionConfig } from "./config.js";
import { providerOrder, type InferenceRoute, type ProviderKind } from "./inference-route.js";
import { detectEmergencyReflex, type WorldView } from "./reflex.js";

export type CognitionMode = "NO_LLM" | "ROUTINE_DELIBERATION" | "DEEP_REFLECTION";

export type DeliberationTrigger =
  | "goal_completed"
  | "goal_failed_repeatedly"
  | "major_need_changed"
  | "significant_event"
  | "idle"
  | "settlement_changed"
  | "reflection_updated";

export type RouteInput = {
  view: WorldView;
  llmEnabled: boolean;
  reflectionEnabled: boolean;
  reflectionAvailable: boolean;
  reflectionTrigger?: ReflectionTrigger;
  shouldDeliberate: boolean;
  hasGoal: boolean;
  busy: boolean;
};

export type RouteResult = {
  mode: CognitionMode;
  reason: string;
  reflex?: ReturnType<typeof detectEmergencyReflex>;
  providerOrder?: ProviderKind[];
};

/**
 * Privilege router first, then optional provider order.
 * Emergencies never select Ollama or an OpenAI-compatible backend.
 *
 *   ModelRouter
 *   ├── NO_LLM (reflex / cooldown / disabled)
 *   ├── OllamaProvider
 *   └── OpenAICompatibleProvider
 */
export class ModelRouter {
  constructor(
    private readonly config: Pick<CognitionConfig, "enabled" | "reflectionEnabled"> & {
      inferenceRoute?: InferenceRoute;
    },
  ) {}

  route(input: RouteInput): RouteResult {
    const reflex = detectEmergencyReflex(input.view);
    if (reflex) {
      return { mode: "NO_LLM", reason: `emergency_reflex:${reflex.kind}`, reflex };
    }

    const rareReflection =
      Boolean(input.reflectionTrigger) &&
      this.config.reflectionEnabled &&
      input.reflectionEnabled &&
      isRareReflection(input.reflectionTrigger);

    if (rareReflection) {
      return {
        mode: input.reflectionAvailable ? "DEEP_REFLECTION" : "ROUTINE_DELIBERATION",
        reason: input.reflectionAvailable
          ? `reflection:${input.reflectionTrigger?.kind}`
          : "reflection_model_unavailable_fallback",
        providerOrder: this.providers(),
      };
    }

    if (!this.config.enabled || !input.llmEnabled) {
      return { mode: "NO_LLM", reason: "llm_disabled" };
    }

    if (input.busy && !input.shouldDeliberate) {
      return { mode: "NO_LLM", reason: "busy_executing_plan" };
    }

    if (!input.shouldDeliberate) {
      return { mode: "NO_LLM", reason: "no_deliberation_trigger" };
    }

    return {
      mode: "ROUTINE_DELIBERATION",
      reason: "routine_trigger",
      providerOrder: this.providers(),
    };
  }

  providers(): ProviderKind[] {
    return providerOrder(this.config.inferenceRoute ?? "LOCAL");
  }
}

const RARE = new Set([
  "close_citizen_death",
  "major_betrayal",
  "large_resource_loss",
  "settlement_destruction",
  "migration_decision",
  "major_achievement",
  "leadership_conflict",
  "belief_changing_discovery",
]);

export function isRareReflection(trigger?: ReflectionTrigger): boolean {
  if (!trigger) return false;
  return RARE.has(trigger.kind) && trigger.salience >= 0.45;
}
