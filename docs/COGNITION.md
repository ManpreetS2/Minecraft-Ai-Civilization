# Cognition V2

High-level deliberation sits **between** emergency reflex and the deterministic planner.

```
TRUE EMERGENCY REFLEX
        ↓
HIGH-LEVEL DELIBERATION   ← qwen3.5:9b (configurable)
        ↓
DETERMINISTIC TASK PLANNER
        ↓
VERIFIED MINECRAFT SKILLS
```

The model never chooses trees, jumps, or block breaks. It never chooses its own privilege level.

This branch exposes `CognitionService` / `ModelRouter` / `CognitionContextBuilder`. It is **not** wired into `AgentManager` while settlement/project work is in flight.

## Config

| Variable | Default | Role |
| --- | --- | --- |
| `LLM_ENABLED` / `OLLAMA_ENABLED` | false | Master switch. Either may enable cognition. |
| `LLM_PROVIDER` | ollama | `ollama` or `none` |
| `OLLAMA_HOST` | http://127.0.0.1:11434 | |
| `OLLAMA_FAST_MODEL` | qwen3.5:4b | Cheap normalize/classify if used |
| `OLLAMA_ROUTINE_MODEL` | qwen3.5:9b | Routine deliberation |
| `OLLAMA_REFLECTION_MODEL` | gpt-oss:20b | Rare deep reflection; not required to be loaded |
| `OLLAMA_MODEL` | qwen3.5:9b | Legacy fallback if routine model unset |
| `OLLAMA_CONTEXT_SIZE` | 8192 | Prompt budget |
| `OLLAMA_MAX_CONCURRENCY` | 1 | Start at 1 on an RTX 4080 Super; try 2 only after measuring |
| `OLLAMA_TIMEOUT_MS` | 45000 | Per request |
| `OLLAMA_REFLECTION_ENABLED` | false | Deep reflection stays off until you opt in |
| `LLM_COOLDOWN_MS` | 60000 | Idle/routine re-ask cooldown |

Model names belong in config, not routers or prompt builders.

## Modes

| Mode | When |
| --- | --- |
| `NO_LLM` | Emergency reflex, LLM disabled, cooldown, or busy executing a plan |
| `ROUTINE_DELIBERATION` | Meaningful trigger + qwen3.5:9b |
| `DEEP_REFLECTION` | Rare `ReflectionTrigger` and reflection enabled |

Reflex only:

- drowning
- fire
- hunger ≤ 7 **and food already in inventory**
- critical health with a nearby threat
- creeper / lethal mob in immediate range

Not reflex: night, low wood, full inventory, missing tool, generic shelter need.

## Decision schema

Preferred runtime-facing contract:

```
BoundedDecision {
  decisionId, primaryGoal, followUpGoals,
  priority, confidence, reason, createdAt,
  worldStateHash, relevantMemoryIds, relevantLessonIds
}
```

Legacy planner-facing `CognitionDecision { goal, priority, reason, targetCitizenId?, targetProjectId?, targetResource?, uncertainty? }` is still emitted by `CognitionService`.

Allowed goals include existing planner names plus `contribute_to_project`, `seek_safety`, `socialize`, `assist_citizen`, `use_storage`, `return_to_settlement`, `transfer_item`, `reconsider`.

Related phrasing may normalize (`Gather wood` → `gather_wood`). Unrelated names are rejected. Execution-level commands (`walk west`, block coordinates) are rejected as `EXECUTION_LEVEL`. `socialize` / `assist_citizen` require a real `targetCitizenId`. Privileged fields such as `thinking` / `chain_of_thought` are rejected.

LLM output is a **proposal**. It does not create item transfers, deaths, or other objective world facts.

See `docs/COGNITION-INTEGRATION-CONTRACT.md` and `docs/COGNITION-V2-AUDIT.md`.

## Frequency and queue

Deliberate on: goal completed, repeated failure, major need change, significant event, idle with no goal, settlement shift, reflection that asks for reconsideration.

Do not ask every tick. In-flight results are dropped if hunger was resolved, food appeared, a new threat arrived, or a significant event landed while waiting.

Concurrency defaults to **1**. Five citizens share the queue.

## Reflection

Uses existing psychology `ReflectionTrigger`. Call `CognitionService.reflect(...)` for that path (`decide()` returns `use_reflect` instead of applying a routine goal). If `gpt-oss:20b` is missing or times out, fall back to the routine model, then deterministic `prepareReflection`. The simulation must not freeze waiting on the large model. Proposals are applied through bounded code (`applyReflectionProposal`).

## Benchmark

```bat
pnpm --filter @civ/cognition bench
```

Writes gitignored:

- `artifacts/cognition-benchmark.json`
- `artifacts/cognition-benchmark.md`

Measures schema validity, goal validity, latency, unknown-goal rate — not hidden reasoning.

Live fixture run on this machine (2026-09-16, Ollama `/api/chat`, `format=json`, concurrency 1):

| Model | Schema valid | Fixture pass | Mean latency |
| --- | --- | --- | --- |
| qwen3.5:9b | 5/5 | 5/5 | ~2.0 s |
| qwen3.5:4b | 5/5 | 4/5 | ~0.3 s |

9B is the intended routine default: schema compliance was acceptable, latency was reasonable, and it beat 4B on these fixtures (5/5 vs 4/5). 4B remains a faster bring-up option. `gpt-oss:20b` is not required for normal simulation. GPU memory was not instrumented; do not treat this as a VRAM study.

Re-run with `pnpm --filter @civ/cognition bench`.

## Experience ledger (V3 foundation)

Failures are classified before anything is learned.

- Citizen experience (`ExperienceLedger.recordAttempt`) may create a bounded `LearningLesson`.
- System incidents (keepalive, SQLite, Paper) never become citizen beliefs.
- Lessons persist in SQLite, retrieve by goal/error, strengthen or weaken from later outcomes.
- `renderLearningJournal` writes gitignored `artifacts/learning-journal.md`.
- `@civ/minecraft-knowledge` is consumed through `GameKnowledgeProvider` / `adaptMinecraftKnowledge` — do not duplicate mechanics tables here.

A heavier-model bake-off is not claimed yet. Keep `OLLAMA_ROUTINE_MODEL=qwen3.5:9b` until a live 20–30 fixture report beats it on quality then latency.

## Integration after the other branch lands

```ts
const service = CognitionService.fromAppConfig(config, mind);
const routed = service.router.route(...);
const result = await service.decide({ citizenId, view, settlementNeeds, trigger: "idle" });
if (result.accepted) planner.use(result.decision.goal);
```
