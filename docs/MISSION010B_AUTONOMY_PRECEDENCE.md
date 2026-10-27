# Mission 010B — Citizen Autonomy & Planner Priority Repair

**Date:** 2026-10-27  
**Workspace:** Windows `minecraft_ai_sim` @ `1a0756c` + Missions 009/010/010B WIP  
**Scope:** Narrow planner precedence so valid model survival choices are not starved by routine housing. Construction frozen. No live Minecraft.

## Previous precedence problem

After Mission 010, allowlisted LLM goals were mapped correctly, but `planCitizen` still ran **daytime `planHomelessHousing` before the LLM branch**.

Effect: a homeless citizen with `llmGoal: gather_food` (from async `pendingLlm`) received `source: "planner"`, `travelTowardHousing` — a deterministic preference labeled as if the model never chose food.

Root cause: routine catalog housing was treated like a safety reflex, not a fallback.

## Priority rules — before vs after

### Before (starving)

1. Lethal / hunger reflexes  
2. Admin / construction / curfew / directives / corrective  
3. Night housing / shelter defaults  
4. **Daytime homeless housing** ← blocked LLM  
5. Inventory deposit  
6. LLM proposal  
7. Bootstrap / roles / autonomous  

### After (Mission 010B)

1. Lethal / hunger reflexes (**A** — unchanged)  
2. Admin override, construction resume, curfew, human directives, corrective (**B** — unchanged)  
3. Model proposal backoff if the same mapped action failed ≥3 times  
4. **Allowlisted model proposal accepted** when no immediate hostile threat  
5. Immediate hostile → flee / night seekSafety with `overridden_safety` provenance  
6. Night exposure housing/shelter **only when no accepted model plan** (or after safety override)  
7. Daytime homeless housing **only when no model candidate** (fallback)  
8. Inventory / bootstrap / roles / autonomous  

**Not automatic overrides:** daytime homelessness alone; night without hostiles when a valid model plan exists.

## Safety intervention rules

| Condition | Behavior |
| --- | --- |
| Critical health / hunger | Existing reflexes (before model) |
| Hostile distance &lt; 8 | Existing flee reflex |
| Hostile within 10 + model plan | Override model (`flee` day / `seekSafety` night); provenance `overridden_safety` |
| Night + no hostile + model plan | **Accept** model (citizen may gather/explore) |
| Unsupported model goal | `deferCapability` + `rejected_unsupported` |
| Model action failed streak ≥ 3 | `observeNearby` planner backoff + `backoff_fallback` |

Emergency shelter remains a last-resort path via seekSafety/flee — not a daytime food-vs-housing script.

## Multi-tick LLM timing

`AgentManager` sets `pendingLlm` asynchronously and clears it when consumed as `llmGoal`/`llmReason` on a later tick.

Offline trace: tick without proposal → housing fallback; tick with `gather_food` → `llm`/`gatherFood`; next tick without proposal → fallback again. **One consumption ⇒ one model-sourced plan** (no duplicate execution of the same pending decision).

## Model-versus-planner provenance

`PlannedTask.modelProvenance` (also on `ActionStarted` when present):

| kind | Meaning |
| --- | --- |
| `accepted` | Model proposal became the selected action (`source: "llm"`) |
| `overridden_safety` | Model existed; safety action won (reason recorded) |
| `rejected_unsupported` | Fail closed via dispatch integrity |
| `backoff_fallback` | Repeated model failure; deterministic observe |
| `absent_fallback` | No proposal this tick; planner/reflex chose |

Never label `source: "planner"` / `reflex` choices as independent LLM strategy.

Explore enrichment: `attachDiscoveredTarget` no longer rewrites **LLM** `observeNearby` into `travelTowardHousing`.

## Tests and evidence

`packages/agent-core/src/autonomy-precedence.test.ts` — scenarios 1–13 including multi-tick pendingLlm.

Focused suite with Mission 009/010 tests: **111 passed** (2026-10-27).

## Remaining autonomy limitations

1. Curfew / construction / admin directives still precede model (intentional).  
2. Night + homeless **without** a model proposal still forces housing/shelter (fallback).  
3. Work roles / settlement assignment after model can still shape ticks with no proposal.  
4. Manager `llmDue` gate still limits how often proposals appear — separate from precedence.  
5. Offline proof ≠ live three-citizen demo.

## Files changed

- `packages/agent-core/src/planner.ts` — precedence + provenance helpers  
- `packages/agent-core/src/executor.ts` — emit `modelProvenance`  
- `packages/agent-core/src/index.ts` — exports  
- `packages/agent-core/src/autonomy-precedence.test.ts` — new  
- `packages/agent-core/src/planner.test.ts` / `dispatch-integrity.test.ts` — expectations  
- `docs/MISSION010B_AUTONOMY_PRECEDENCE.md` — this file  
- `docs/ARCHITECTURE.md` — note
