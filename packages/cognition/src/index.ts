import type { AppConfig } from "@civ/shared";
import { HeuristicProvider } from "./heuristic.js";
import { OllamaProvider } from "./ollama.js";
import type { CognitionProvider } from "./schema.js";

export function createCognition(config: AppConfig): CognitionProvider {
  if (!config.LLM_ENABLED || config.LLM_PROVIDER === "none") {
    return new HeuristicProvider();
  }
  if (config.LLM_PROVIDER === "ollama") {
    return new OllamaProvider(config.OLLAMA_HOST, config.OLLAMA_MODEL);
  }
  return new HeuristicProvider();
}

export { HeuristicProvider } from "./heuristic.js";
export { OllamaProvider } from "./ollama.js";
export {
  DecisionSchema,
  extractJson,
  normalizeDecisionInput,
  normalizeGoal,
  validateDecision,
  type CognitionPrompt,
  type CognitionProvider,
  type HighLevelDecision,
} from "./schema.js";
