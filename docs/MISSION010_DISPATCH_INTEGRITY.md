# Mission 010 — Goal Dispatch Enforcement and Runtime Truth

**Date:** 2026-10-27  
**Workspace:** Windows `minecraft_ai_sim` @ `1a0756c` + Mission 009/010 local WIP  
**Scope:** Offline enforcement that model-originated actions stay on the Mission 009 allowlist. Construction frozen. No live Minecraft.

## Verified production call graph

```
createCognition(config)                    # @civ/cognition (heuristic | ollama)
  └─ CognitionProvider.decide(...)         # HighLevelDecision.goal ∈ GOALS (schema)
       └─ AgentManager tick
            ├─ pendingLlm ← decision       # next tick consumption
            ├─ planCitizen({ llmGoal, llmReason, ... })
            │    ├─ reflexes / directives / construction / curfew / housing / …
            │    ├─ resolveModelGoalForPlanner(llmGoal)   # GOAL_ACTION_MAP only
            │    ├─ attachDiscoveredTarget(...)           # enrichment (housing/blocked)
            │    └─ enforceModelOriginatedPlan(...)       # integrity rewrite if needed
            └─ executePlan(ctx, plan, ...)
                 ├─ enforceModelOriginatedPlan if source === "llm"
                 ├─ ActionStarted { source, goal, action, dispatchIntegrity }
                 ├─ switch(gated.action) → skills | deferCapability
                 └─ ActionCompleted/Failed { source, goal, action, dispatchIntegrity }
```

Manager does **not** map goals itself; it passes `llmDecision.goal` into the planner.  
There is **no** second production `LLM_MAP`. Unknown model goals never become `action === goal` strings.

## Goal dispatch enforcement

| Gate | Role |
| --- | --- |
| `@civ/cognition` `GOALS` / `normalizeGoal` / `validateDecision` | Schema + aliases before pending LLM |
| `resolveModelGoalForPlanner` | Authoritative map; unsupported → `deferCapability` |
| `enforceModelOriginatedPlan` (planner exit) | Closed set after enrichment |
| `enforceModelOriginatedPlan` (`executePlan` entry) | Shared runtime boundary; forges fail closed |
| `deferredCapabilityResult` | Honest `success: false` for deferred/unsupported |

`dispatchIntegrity` on action events:

- `allowlisted` — model action was cognition-reachable (or approved enrichment)
- `rewritten_fail_closed` — unsafe model action rewritten to `deferCapability` (never substituted with gather/build)

Deterministic `source` values (`reflex`, `planner`) and human directives are **not** rewritten by this gate.

## Cognition-reachable executor actions

Derived from `GOAL_ACTION_MAP` via `cognitionReachableActions()`:

`gatherFood`, `mineBlock`, `craftItem`, `buildShelter`, `buildStructure`, `deferCapability`, `depositItems`, `observeNearby`, `attack`, `seekSafety`

## Approved model-plan enrichments

Closed set `MODEL_PLAN_ENRICHMENT_ACTIONS` (still executor-allowlisted; not raw model verbs):

- `blocked` — honest blockage after a dispatched model goal
- `travelTowardHousing` / `claimHome` — `attachDiscoveredTarget` housing assist after explore/observe

## Internal-only executor actions (not cognition-reachable)

Examples: `flee`, `eatFood`, `shareItem`, `obtainItem`, `mineOre`, `fishShore`, `workFarmPlot`, `sleep`, `waitInsideHome`, `returnHome`, `withdrawItems`, …  

These remain valid for reflex/planner/directive paths. Model `source: "llm"` cannot execute them through the integrity gate.

## Deferred capabilities

`help_citizen`, `assist_citizen`, `rest`, `socialize`, `reconsider` → `deferCapability` → `UNSUPPORTED_ACTION`, `success: false`.  
Unknown / forged model actions → same outcome (no silent wood mining).

## Planner precedence findings

Order in `planCitizen` (simplified):

1. Lethal / critical hunger **reflex** — **A** safety-essential  
2. Human **ADMIN_OVERRIDE** — operator intervention (logged via directive)  
3. **Construction session** resume — **B** mechanically necessary  
4. **Curfew** bedtime — **B** (demo day/night realism)  
5. Other human directives — operator  
6. **Corrective** from last failure — **B**  
7. Night housing / shelter heuristics — **B/C** (can override model shelter/food choices)  
8. Day **homeless housing** travel/claim — **C** autonomy risk for three-citizen demo (starves `gather_food` / `build_shelter` LLM proposals while homeless)  
9. Inventory-full deposit — **B**  
10. **LLM** proposal (allowlisted) — citizen autonomy path  
11. Bootstrap tools / work roles / autonomous activity — **C/D** (work roles especially **D** for demo if `SIM_ASSIGN_WORK_ROLES=false`)

**Starvation evidence (offline):** with `availableHomes` and no claimed home, `llmGoal: gather_food` yields `source: "planner"`, `travelTowardHousing` — not an autonomous AI food decision. With a claimed home and no emergency, the same proposal yields `source: "llm"`, `gatherFood`.

Do **not** label deterministic housing/curfew/reflex wins as model autonomy.

## Test evidence

Focused suite (Mission 009 + 010):

- `goal-dispatch.test.ts`
- `planner.test.ts`
- `build-structure-intention.test.ts`
- `dispatch-integrity.test.ts` (new)

**84 passed** in the focused run (2026-10-27).

Coverage includes: every `GOALS` entry, aliases, unknown goals, forged `shareItem` at `executePlan`, deferred help/rest, reflexes, human directives, construction resume, LLM-disabled planner, precedence/starvation traces, event provenance (`dispatchIntegrity`).

## Remaining gaps for the three-citizen demo

1. Homeless housing precedence can starve food/shelter LLM proposals until a home is claimed — revisit for demo autonomy without removing safety.  
2. Cloud model provider adapter not started (Mission 010 **NO-GO** until integrity lands in committed baseline).  
3. LLM trigger conditions in `AgentManager` (`llmDue`) are still narrow — separate from allowlist integrity.  
4. Pre-existing WIP typecheck failures in adapter/skills remain unrelated.  
5. Physical success still requires live Minecraft verification — offline integrity ≠ demo proof.

## Files changed (Mission 010)

- `packages/agent-core/src/goal-dispatch.ts` — validate/enforce + reachable-action helpers  
- `packages/agent-core/src/planner.ts` — enforce after LLM dispatch  
- `packages/agent-core/src/executor.ts` — shared boundary + event provenance  
- `packages/agent-core/src/index.ts` — exports  
- `packages/agent-core/src/dispatch-integrity.test.ts` — new  
- `docs/MISSION010_DISPATCH_INTEGRITY.md` — this file  
- `docs/ARCHITECTURE.md` — enforcement note
