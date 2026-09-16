import type Database from "better-sqlite3";
import type { SimEvent } from "@civ/shared";
import { tryAdaptSimEvent } from "./events.js";
import { CognitiveStore } from "./store.js";
import type { ObjectiveWorldEvent } from "./types.js";

/**
 * Merge-safe integration helpers.
 *
 * Intentionally NOT wired into AgentManager, OllamaProvider, CivilizationStore,
 * minecraft-adapter, gather/pathfinding, society chat, dashboard formatters,
 * or permanent-death runtime handlers. Another branch owns those files.
 *
 * After merge:
 *   const cognitive = attachCognitiveStore(civilizationStore.db);
 *   const adapted = fromSimEvent(event);
 *   if (adapted) mind.ingest(adapted, snapshot);
 */
export function attachCognitiveStore(db: Database.Database): CognitiveStore {
  return new CognitiveStore(db);
}

export function fromSimEvent(event: SimEvent): ObjectiveWorldEvent | null {
  return tryAdaptSimEvent(event);
}

export const INTEGRATION_TODO = [
  "Do not edit packages/agent-core/src/manager.ts until the stabilization branch merges.",
  "Do not edit packages/cognition/src/ollama.ts or schema.ts while output normalization is in flight.",
  "Do not edit packages/agent-core/src/store.ts; attach CognitiveStore to the same Database later.",
  "Do not edit minecraft-adapter pathing, gather skills, society chat, or dashboard event formatting.",
  "Do not replace permanent-death runtime handlers; only ingest CitizenDied as an objective event.",
  "After merge, pass CognitionContext.relevantMemories into the existing CognitionPrompt.memories field.",
  "Memory/psychology inform HIGH-LEVEL decisions only, never block-level movement.",
] as const;
