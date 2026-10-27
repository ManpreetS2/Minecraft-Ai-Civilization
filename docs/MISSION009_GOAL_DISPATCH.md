# Mission 009 — Single Citizen Goal Dispatch

**Date:** 2026-10-27  
**Workspace:** Windows `minecraft_ai_sim` @ private backup tip `1a0756c` (+ local Mission 009 edits)  
**Scope:** Offline source simplification — unify model-goal → action mapping. Construction remains frozen. No live Minecraft.

## Goal

Remove duplicate allowlists so production execution has **one** authoritative cognition goal → executor action contract.

## Duplicate-dispatch problems found

| Location | Behavior |
| --- | --- |
| `planner.ts` `LLM_MAP` | Separate map; fallback `action = llmGoal` for unknown strings |
| `goal-dispatch.ts` `GOAL_ACTION_MAP` | Cognition allowlist used by tests / exports, **not** by planner LLM path |
| `help_citizen` / `assist_citizen` | Planner → `shareItem` (false “help”); dispatch → `deferCapability` |
| `rest` | Planner → `seekSafety`; dispatch → deferred |
| `mine_ore`, `fish_shore`, `work_farm`, `claim_home`, `build_structure`, `obtain_item` | In planner `LLM_MAP` only — **not** in cognition `GOALS` |

## Classification of former `LLM_MAP` entries

### 1. Legitimate model-selectable (cognition `GOALS`)

`gather_food`, `gather_wood`, `mine_stone`, `craft_tools`, `build_shelter`, `contribute_to_project`, `help_citizen`, `assist_citizen`, `deposit`, `use_storage`, `rest`, `explore`, `defend`, `seek_safety`, `socialize`, `reconsider`  
(+ aliases via `@civ/cognition` `GOAL_ALIASES`, e.g. `survive` → `seek_safety`)

### 2. Internal planner / activity-choice (outside LLM contract)

| Name | Executor action | Notes |
| --- | --- | --- |
| `fish_shore` | `fishShore` | Reflex / activity-choice |
| `mine_ore` | `mineOre` | Discovered-site mining |
| `work_farm` | `workFarmPlot` | Farm plots |
| `claim_home` | `claimHome` | Housing claim / travel |
| `build_structure` | `buildStructure` | Model uses `contribute_to_project` |
| `obtain_item` | `obtainItem` | Bootstrap recipe chain; model uses `craft_tools` |

Model output naming these **fail closed** (`deferCapability` / `unsupported_goal`). Deterministic planner paths unchanged.

### 3. Deferred / unsupported capabilities

`help_citizen`, `assist_citizen`, `rest`, `socialize`, `reconsider` → `deferCapability` (never success).  
Unknown / malformed goals → same fail-closed path.  
`shareItem` remains an executor action for non-LLM deterministic use but is **unreachable** from `GOAL_ACTION_MAP`.

## Design decisions

1. **`resolveModelGoalForPlanner`** wraps `dispatchCognitionGoal` for the planner LLM branch.
2. **Deleted** production `LLM_MAP` and the `?? { task: llmGoal, action: llmGoal }` fallback.
3. **Preserved** reflex priorities, housing, curfew, construction resume, work roles, activity-choice.
4. **Charter import:** `project.md` + `docs/master-design-google-doc-mirror.md` from public commit `284066f` (PR #8) — docs only, no code merge.
5. Physical skill success and SQLite persistence remain distinct (`persistConfirmed` / completion memory unchanged).

## Architecture (before → after)

**Before:** LLM decision → planner `LLM_MAP` (or raw string as action) → executor  

**After:** LLM decision (validated `GOALS`) → `resolveModelGoalForPlanner` / `GOAL_ACTION_MAP` → allowlisted action or `deferCapability` → executor  

Deterministic planner (no `llmGoal`) unchanged.

## Relationship to the first three-citizen demo

The demo needs citizens that can gather, build, and deposit under a clear contract. Help/social goals must not fake success via `shareItem`. Ore/fish/farm/home remain body skills driven by planner discovery — not free-form model verbs — until explicitly added to `GOALS` with verified skills.

## Files changed

- `packages/agent-core/src/goal-dispatch.ts` — authoritative map + internal classification + `resolveModelGoalForPlanner`
- `packages/agent-core/src/planner.ts` — remove `LLM_MAP`; use unified resolver
- `packages/agent-core/src/goal-dispatch.test.ts` — full cognition/alias/defer/unknown coverage
- `packages/agent-core/src/planner.test.ts` — LLM path + fail-closed internal names
- `packages/agent-core/src/index.ts` — exports
- `docs/ARCHITECTURE.md` — pointer to single contract
- `docs/MISSION009_GOAL_DISPATCH.md` — this file
- `project.md`, `docs/master-design-google-doc-mirror.md` — imported charter (PR #8)

## Tests

- Every `GOALS` entry and every `GOAL_ALIASES` entry
- Unknown / malformed / arbitrary action-name goals
- `help_citizen` ≠ `shareItem`
- Deferred results `success: false`
- Planner LLM uses unified map; internal actions still plan without LLM
- Construction intention path unchanged (resume before LLM)
- LLM-disabled deterministic `buildShelter` path

## Compatibility / risks

- Injected test `llmGoal: "mine_ore" | "claim_home"` no longer executes those skills via the LLM branch (by design).
- If a future demo needs model-selectable mining/fishing/housing, add them to `GOALS` + `GOAL_ACTION_MAP` explicitly — do not revive a second planner map.
- `craft_tools` still maps to `craftItem` (not full `obtainItem` recipe chain); bootstrap `obtainItem` remains planner-internal.
- Construction engine still frozen; this mission does not prove live builds.

## Mission 010 recommendation

Next simplification: inventory **executor** action surface vs planner task vocabulary (document which actions are reflex-only vs cognition-reachable), or wire a single offline “decision trace” assertion that `source === "llm"` always has `action` ∈ allowlist from `GOAL_ACTION_MAP` / `deferCapability`. Do not expand cognition `GOALS` until the three-citizen demo needs a new verified capability.
