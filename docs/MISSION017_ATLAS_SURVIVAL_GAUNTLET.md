# Mission 017 — Atlas Survival Gauntlet & Offline Integration Hardening

**Status:** Offline skill truthfulness, cancellation, and gauntlet complete. Does **not** claim live Minecraft or Paper success.  
**Branch:** `mac/offline-reliability-20261028`  
**Private remote:** `ManpreetS2/Minecraft-Ai-Civilization-windows-backup`  
**Base (Mission 016):** `25f3c9a116c8173d333c3d21e1201c58536dd566`

Public `origin` was not updated. Windows `dev/demo-simplification-20261027` remains at `39e98a44` (Mission 013 still unpublished).

## Engineering summary

Mission 017 hardened existing survival skills so success means verified world/inventory evidence—not block dig alone or absolute inventory counts.

| Workstream | Defect | Fix |
| --- | --- | --- |
| A Mining | `mineKnownOre` could `ok` after excavating with `collected` all zeros | Fail `ITEM_NOT_FOUND` when excavated but no inventory gain; `mineBlock` now labels `excavated: true, resourceAcquired: false`; `collectResource` abort-before-dig |
| B Farming | `harvestPlot` used `Math.max(collected, countItem(...))` inventing yield from existing wheat | Sum only inventory **deltas** after `collectFarmDrops`; `harvestCropAt` exposes `cropBroken` / `acquisitionVerified` |
| C Eating | `eatFood` ignored `AbortSignal` during equip/consume/wait | Cancel before side effects; abortable wait; `INTERRUPTED` if food already consumed |
| D Crafting | Mid-loop cancel gap | Abort check before each recipe attempt; obtain/craft fail-closed paths already verified |
| E Navigation | No new Mac defect reproduced | `arrivalAccepted` + pathing CANCELLED handling intact; no second pathfinder |

**Windows integration blocker (read-only):** `packages/agent-core/src/executor.ts` `mineClaimedTarget` emits `ResourceCollected` after `mineBlock` success without inventory verification, then best-effort `collectItem`. Do **not** patch here (Mission 013 overlap). Proposed later fix: only emit after inventory delta, or route wood/stone through `collectResource` exclusively.

## Capability matrix

| Capability | Offline tested | Typecheck | Requires live | Known blockers |
| --- | --- | --- | --- | --- |
| Navigate safely | Yes (contract / arrivalAccepted) | `@civ/minecraft-adapter` PASS | Yes | Real pathfinder vs Paper UNVERIFIED |
| Gather wood/stone | Yes (`collectResource`, `mineBlock`) | `@civ/skills` PASS | Yes | Executor ResourceCollected false-positive (Windows) |
| Mine ores | Yes (gate + unit ore visibility) | PASS | Yes | Drop pickup timing on Paper |
| Craft / obtain | Yes (fail-closed + abort) | PASS | Yes | Real crafting window timing UNVERIFIED |
| Farm / harvest | Yes (yield delta + gauntlet) | PASS | Yes | Live drop entities |
| Eat food | Yes (verify + cancel) | PASS | Yes | Consume animation timing |
| Sleep / home bed | Yes (day/missing/hostile/ok) | PASS | Yes | Path to bed on Paper |
| Stuck recovery | Audit only | PASS | Yes | Live loops UNVERIFIED |

## Truthfulness review

| Skill | Physical completion | Inventory acquisition | Persisted / deposited |
| --- | --- | --- | --- |
| `mineBlock` | Block gone → success; `resourceAcquired: false` | Never claimed | N/A |
| `collectResource` | Dig verified | Success only if inventory delta | Caller deposit |
| `mineKnownOre` | `mined[]` | Success only if drop gain; else `ITEM_NOT_FOUND` | `deposited` after permitted storage |
| `harvestCropAt` | `cropBroken` | `collected` delta + `acquisitionVerified` | N/A |
| `harvestPlot` | `harvested[]` | Delta-only `collected` | N/A |
| `workFarmPlot` | till/plant/harvest lists | `wheatDelta` / `seedsDelta` | Optional crop chest |
| `eatFood` | consume ran | Count down or hunger up required | N/A |
| `craftItem` / `obtainItem` | craft API | Inventory must increase | N/A |
| `sleep` | `bot.isSleeping` | N/A | N/A |

## Atlas idle investigation

### Startup modes

| Entry | Autonomous planner ticks? | Notes |
| --- | --- | --- |
| `pnpm atlas` → `apps/orchestrator/src/atlas-cli.ts` | **No** | Interactive Mineflayer body only (`goto`, `follow`, `state`, …). Cloud AI never involved. |
| `pnpm sim:start` → `apps/orchestrator/src/index.ts` | **Yes** | `AgentManager.start()` arms ticks immediately. Heuristic planner runs when `LLM_ENABLED` is false. |
| `pnpm world-lab:one-citizen -- --live` | **Yes** after arm | `AgentManager.start(1, { deferTicks: true })` then `resumeTicks()`. Exactly one citizen (Atlas). |
| Dry-run world-lab | No | Disk/config only; no Paper connect. |

### Answers to mission questions

1. Atlas CLI does **not** run planner ticks.  
2. It is an interactive command-driven Mineflayer body.  
3. **AgentManager is required** for autonomous action.  
4. Safe one-citizen path: `pnpm world-lab:one-citizen -- --live` (after explicit approval; not run in this mission).  
5. Duplicate Atlas: world-lab pins `SIM_CITIZEN_COUNT=1` and refuses non-Atlas rosters; CLI reconnect can still collide with a live manager session on the same username.  
6. With cloud off (`LLM_ENABLED` false), `manager.ts` skips LLM and uses heuristic `planner` tasks each tick.  
7. Idle appearance causes: CLI without commands; deferred ticks never resumed; curfew/return-home; food/search backoff; outstanding blocked path; observe-only idle plan.  
8. Stalled action vs no planner: look for `[perf] tick=` / planner logs / skill ActionResults vs only Mineflayer spawn chat.  
9. Markers: AgentManager perf tick lines, skill events (`ResourceCollected`, `ItemCrafted`), dashboard citizen task fields, world-lab `[CITIZEN_OBSERVATION]` / integration traces.  
10. Next Windows viewing session: prefer **`pnpm world-lab:one-citizen -- --live`** on 25567 with Paper already up—not `pnpm atlas`.

### Likely explanation for prior inactive session

**Most probable:** Atlas was connected via a body-only path (CLI or manager before `resumeTicks`) or cloud-disabled sim was expected to “think” while the operator watched a client that never received planner-driven skills. Static analysis cannot prove which entry was used; confirmation requires startup command + tick logs.

## Windows observation plan (minimum evidence)

1. Confirm launch command is world-lab one-citizen live (or `sim:start`), **not** `pnpm atlas`.  
2. Log line proving `resumeTicks` / planner armed.  
3. At least one `[perf] tick=` (or equivalent) within ~10–20s.  
4. Citizen dashboard / events showing a non-observe task attempt.  
5. Inventory or world delta matching that skill (or honest failure code).  
6. If standing still with ticks firing: capture last ActionResult code (PATH_*, HOSTILE, FOOD_NOT_FOUND, backoff).

## Test evidence

| Gate | Phase 1 baseline (016) | After 017 |
| --- | --- | --- |
| Unit tests | 753 pass / 2 fail (755) | **779 pass / 2 fail (781)** |
| Known failures | `blueprint.test.ts` crafting_table; `construction-experiment-guard` path alias | **Same two** (frozen construction) |
| `@civ/skills` typecheck | PASS | PASS |
| `@civ/minecraft-adapter` typecheck | PASS | PASS |
| Workspace typecheck | 8/10 | 8/10 (`agent-core`, `orchestrator` still fail) |
| `git diff --check` | — | Clean |

New coverage: `collect.test.ts`, `harvest-truth.test.ts`, `survival-gauntlet.test.ts` (8 scenarios + UNVERIFIED note), eat cancel tests, mineBlock excavate contract.

## Cross-machine impact

Mac reliability files likely to conflict with unpublished Mission 013 if it also touched skills/adapter:

- `packages/skills/src/{farm,gather,collect,inventory,mine}.ts`
- `packages/skills/src/*test*`
- Prior 015/016: adapter nav/movement-sync, world sleep, combat, fish-cycle, task-recovery

**Do not merge against older published Windows tip** without reviewing unpublished 013 diffs for:

- `packages/agent-core/src/{manager,executor}.ts`
- Construction / directives / MinecraftBody / bulletin / shared contracts / orchestrator startup scripts

## Deferred work

**Essential before claiming live survival**

- Controlled Windows retest with world-lab one-citizen + tick evidence  
- Fix executor `ResourceCollected` false success on Windows branch  
- Live pickup/crafting window timing  

**Optional / later**

- Broader ore `mineKnownOre` offline integration fixture  
- Construction blueprint / path-alias Mac failures  
- agent-core / orchestrator type holes  

## GO / NO-GO

**NO-GO** for claiming live Atlas survival success.  
**GO** for a **controlled** Windows skill retest **only if** the operator uses AgentManager (`world-lab:one-citizen --live` or `sim:start`), confirms planner ticks, and treats skill outcomes as evidence—not mere spawn presence.
