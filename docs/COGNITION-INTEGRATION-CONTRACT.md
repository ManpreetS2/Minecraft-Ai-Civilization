# Cognition Integration Contract

For Agent #1. This branch is **cognition-only**. Do not treat passing unit tests as live Minecraft success.

Cognition proposes a **high-level intent**. Runtime chooses mechanics. Minecraft verifies outcomes.

```
verified facts  →  CognitionService.decide()  →  BoundedDecision
                         ↑                         ↓
                   OutcomeInput              planner / skills
```

## Packages to consume

- `@civ/cognition` — `CognitionService`, `ModelRouter`, `BoundedDecision`, fact guards, reflexes, ledger
- `@civ/psychology` — `CitizenMind`, `MindSnapshot`, social beliefs, obligations
- `@civ/memory` — `CognitiveStore`, `ExperienceLedger` storage, retrieval

Do **not** import cognition from Mineflayer adapters.

## CognitionInput (runtime → mind)

Agent #1 must provide **verified** fields only.

```ts
type CognitionInput = {
  citizenId: string;
  name?: string;
  verifiedObservation: {
    health?: number;
    hunger?: number;
    oxygen?: number;
    onFire?: boolean;
    inventory: Array<{ name: string; count: number }>; // personal, not settlement chests
    nearbyHostiles: Array<{ name: string; distance: number }>;
    nearbyCitizens: string[];
  };
  personalNeeds: { health?: number; hunger?: number; concerns?: string[] };
  personalInventory: Array<{ name: string; count: number }>;
  settlementFacts: {
    needs: string[];           // e.g. NEED_WOOD, NEED_FOOD
    foodReserve?: number;      // settlement, never merge into personal inventory
    projectId?: string;
    projectComplete?: boolean;
  };
  threatFacts: Array<{ name: string; distance: number }>;
  directive?: { id: string; text?: string };
  activeGoal?: string;
  currentTask?: string;
  consecutiveFailures?: number;
  busy?: boolean;
  significantEventId?: string;
  memories?: never;            // retrieved by CitizenMind, not dumped by runtime
  lessons?: never;
  relationships?: never;
  affect?: never;              // from CitizenMind.snapshot
};
```

Runtime **must not** send: lifetime event logs, all citizens, recipe DB, path waypoints, block coordinates as “goals”.

Map this onto existing `CognitionService.decide(DecideRequest)`:

- `view` ← `verifiedObservation`
- `settlementNeeds` ← `settlementFacts.needs`
- `inventory` compact strings from `personalInventory`
- `currentGoal` / `currentTask` / `busy` / `consecutiveFailures` / `significantEventId`

## BoundedDecision (mind → runtime)

Preferred output (new):

```ts
type BoundedDecision = {
  decisionId: string;
  primaryGoal: Goal;          // one enum
  followUpGoals: Goal[];      // max 3, advisory, not a permanent queue
  priority: number;           // 0..1
  confidence: number;         // 0..1
  reason: string;             // ≤280 chars, observer-readable, no CoT
  createdAt: string;
  worldStateHash: string;     // compact facts only
  relevantMemoryIds: string[];
  relevantLessonIds: string[];
  targetCitizenId?: string;
  targetProjectId?: string;
  targetResource?: string;
  uncertainty?: number;
};
```

Legacy `CognitionDecision { goal, priority, reason, targets }` still exists. Adapter:

`primaryGoal = decision.goal`, `followUpGoals = []` until `assembleBoundedDecision` is called at the service boundary.

### Goals

Use real enums. Do not invent synonyms.

`gather_food` `gather_wood` `mine_stone` `craft_tools` `build_shelter` `contribute_to_project` `help_citizen` `assist_citizen` `deposit` `use_storage` `rest` `explore` `defend` `seek_safety` `return_to_settlement` `socialize` `transfer_item` `reconsider`

Aliases (input only): `deposit_items` / `withdraw_items` → `use_storage`; `idle` → `rest`; `gather_stone` → `mine_stone`.

### Rejections cognition may return instead of a goal

| Code | Meaning | Runtime action |
| --- | --- | --- |
| `NO_LLM` + reflex | Emergency. Do not wait for Ollama. | Execute body reflex (Agent #1 owns movement/eat). |
| `EXECUTION_LEVEL` | Model asked to walk/jump/break coords. | Discard. Keep current plan or heuristic. |
| `UNKNOWN_GOAL` | Unbounded / untranslatable text. | Heuristic fallback. |
| Fact-guard fail | Invented world claim. | Do not apply. Log observer debug snapshot. |

`followUpGoals` are discarded on: primary completion, stale world hash, danger, new directive, new personal need, project completion, failure.

## OutcomeInput (runtime → ledger)

```ts
type OutcomeInput = {
  decisionId: string;
  citizenId: string;
  goal: string;
  outcome: "success" | "failure" | "cancelled" | "stale";
  failure?: {
    errorCode?: string;
    errorMessage?: string;
    unreachable?: boolean;
    missingTool?: boolean;
  };
  verifiedWorldEffects?: string[]; // event ids only
};
```

Call `ExperienceLedger.recordAttempt` / `classifyFailure`.

Hard rules:

- `PATH_BLOCKED` / `PATH_FAILED` / moveTo timeout → `SKILL_EXECUTION`. Not “bad gather_wood decision”.
- Keepalive / `client timed out` / socket errors → `SYSTEM` / `NETWORK`. `citizenLearns = false`.
- Speech (`I'll give Maya food`) is **not** an outcome. Fulfill `ObligationBoard` only with `evt_*` / `verified:*` ids.

## NO_LLM reflexes (classification only)

`detectEmergencyReflex(view)` may return:

- drowning, fire, lethal_mob / creeper, critical_injury_threat
- `eat_available_food` when hunger ≤ 7 **and personal inventory already has food**

Cognition does **not** pathfind or eat. Agent #1 executes.

## World hash / duplicate suppression

`hashWorldState` compactly hashes hunger/health bands, personal food present, pickaxe, nearby threat, directive, project complete, settlement needs, current goal, urgent event id.

Same citizen + same hash + cooldown → do not re-ask the model. Irrelevant chat does not invalidate work.

## MindSnapshot (runtime-facing, compact)

`compactMindSnapshot(citizenMind.snapshot(id))`

Includes mood, top associations, habits, relevant relationships, recent meaningful memory ids. Not the whole DB.

## Observer debug snapshot

`observerDebugSnapshot(...)` — input facts, retrieved memory/lesson summaries, goal, short reason, validation, model, latency. **No chain-of-thought.**

## Persistence across restart

Persist via `CognitiveStore` (already SQLite): memories, beliefs, lessons, associations, habits, familiarity, mood, identity (including deceased flag).

Immediate emotion may decay across long downtime. Do not erase identity on body death.

`ObligationBoard` is currently in-memory. Agent #1 should persist it if promises must survive process restart.

## Config Agent #1 should honor

| Variable | Default | Owner |
| --- | --- | --- |
| `OLLAMA_FAST_MODEL` | `qwen3.5:4b` | Cognition (this branch) |
| `OLLAMA_ROUTINE_MODEL` | `qwen3.5:9b` | Cognition |
| `OLLAMA_REFLECTION_MODEL` | `gpt-oss:20b` | Cognition |
| `OLLAMA_MAX_CONCURRENCY` | `1` | Shared; keep 1 while Paper tests run |
| `LLM_COOLDOWN_MS` | `60000` | Cognition |
| `SIM_PERMADEATH_ENABLED` | `false` | Runtime; cognition keeps identity |

## What Agent #1 must not do

- Feed settlement chest contents as personal inventory
- Ask the model every tick
- Treat chat promises as item transfers
- Write citizen lessons from keepalive/network errors
- Merge this branch into the live integration branch until cognition tests are reviewed
- Expect this package to move the Mineflayer body

## Files this branch will not touch

AgentManager, Mineflayer adapters, pathfinding, executor, navigation, settlement runtime, construction/bed/storage execution, Paper plugin, dashboard runtime.

## Suggested wiring (Agent #1)

1. On meaningful trigger (not every tick): build `DecideRequest` from verified bot/world state.
2. If `result.mode === "NO_LLM"` and `reflex` present → body skill, skip LLM.
3. Else apply `primaryGoal` to the existing high-level planner.
4. After skill completion/failure → `OutcomeInput` into `ExperienceLedger`.
5. Ingest only verified `ObjectiveWorldEvent`s into `CitizenMind` (never model prose).
