# Mission 018M — Autonomous Survival Sprint (Mac)

**Branch:** `mac/offline-reliability-20261028`  
**Base:** `51b9e579367fe239e1eb48797da44b49578fd85a`  
**Private remote only.** No live Minecraft. No Windows Mission 013 reconstruction.

## Bugs reproduced

1. **Food-search backoff ignored new evidence.** After `FOOD_NOT_FOUND` streak ≥ 3, hunger reflex always `observeNearby` even when cows/farms/fish became available. Observing did not solve hunger and suppressed legitimate alternates.
2. **Activity choice idle after wood.** `chooseActivity` offered `gather_wood` only when *no* logs and no pickaxe. With logs present it fell through to observe-only options.
3. **Seek-shelter PATH_BLOCKED never reached corrective backoff.** `correctiveFromFailure` returned early on all `PATH_BLOCKED`, so the seek_shelter streak≥3 backoff branch was dead.

## Source changes

| File | Change |
| --- | --- |
| `failure-backoff.ts` | `foodSearchHasAlternateOpportunity` |
| `planner.ts` | Hunger/corrective food backoff unlocks animals → farm → fish; seek_shelter PATH_BLOCKED can backoff |
| `activity-choice.ts` | `obtain_tool` / `obtainItem` wooden_pickaxe when logs/planks held |
| `autonomous-survival-cycle.test.ts` | Multi-cycle scenarios + decision trace |
| `planner-food-backoff.test.ts` | Animals-after-backoff case |

## Decision paths

**Before:** hungry + exhausted search → observe forever (unless rod+shore). Logs held → activity-choice observe. Unreachable shelter PATH_BLOCKED → no corrective backoff.

**After:** exhausted search + animals/farm/fish → alternate acquisition; else honest observe. Logs/planks → craft pickaxe plan. Seek-shelter PATH_BLOCKED streak≥3 → observe/housing fallback without false arrival.

## Multi-cycle trace (test artifact shape)

```
t1 food=6 … → gatherFood
t2 … last=gatherFood:FOOD_NOT_FOUND#1 → gatherFood
t3 … #2 → gatherFood
t4 … #3 → observeNearby (exhausted; not inventing food)
t5 … animals in sight → gatherFood (animals now in sight)
```

## Windows blockers

- `gather_wood` still dispatches `mineBlock` (excavation). Inventory truthfulness needs executor/`collectResource` on Windows integration branch.
- Do not modify AgentManager/executor/bulletin here (Mission 013 overlap).

## Unverified live

Planner adaptations are offline-only. Paper/Mineflayer outcomes remain UNVERIFIED.
