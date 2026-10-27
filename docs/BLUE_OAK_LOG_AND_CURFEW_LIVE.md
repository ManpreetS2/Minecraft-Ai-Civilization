# BLUE oak-log detour + curfew live (2026-09-20)

Exclusive WORLD-LAB Paper **1.21.11-132** `127.0.0.1:25567` / RCON `25577`. HomeProbe only. Not `pnpm sim:start`. GREEN `mine.ts`/`fish.ts` not edited.

`list` at claim: **Shadowskiii1** only. A leftover **FishProbe** at `-1042.5,63.0,980.5` was kicked before the last curfew attempt (`TEST_CONTROL` after GREEN's reported disconnect).

## TWO_BLOCK_DETOUR_LIVE=PASS

Harness exit **0**. Disposable pad, not Site C.

| | |
| --- | --- |
| Start | `202.5,67.0,400.5` |
| Obstacle | `oak_log` at `203,67,400` and `203,68,400` (client-seen) |
| Jump | refused: `obstacle is taller than one block` |
| Detour | side cell `202,67,401` |
| Route | `202.5,400.5` → stall `202.7,400.6` → `202.6,402.1` → `203.7,401.3` → `204.5,401.5` → **`204.6,67.0,400.7`** |
| Clip log column | **false** |
| Elapsed | **5286ms** (confirm run after stall-only detour) |
| First live run | also PASS, `204.6,67.0,400.5` in 3324ms |

One-block jump and lava/magma checks were not rerun; prior pad PASSes preserved.

## HOME_WALK_LIVE=PASS / H1_SLEEP_LIVE=PASS / CURFEW_LIVE=PASS

Harness exit **0**. Claimed `home_h1` bed HEAD **`-1097,69,728`**.

| | |
| --- | --- |
| Work TEST_CONTROL | `tp` `-1082.5,68,799.5` (not counted as travel) |
| Departure clock | `time set 11990` (12000 too late: estimateMs=30472, remaining to 12542=27600, plus 20s margin) |
| Decision | `shouldStop=true` |
| Walk | **38.8s** ` -1082.5,67.9,799.5 t=11990` → **`-1095.5,69.0,730.2` t=12766** (interior stand, dStand=0.3; entrance z=732 is **not** sleep) |
| Door | already-open `oak_door`; **toggled=false** |
| Night TEST_CONTROL | `time set 18000` after arrival (12766 < 13000) |
| Sleep | **yellow_bed** HEAD `-1097,69,728` `rested=true designated=true` at tick **18000**, body still `-1095.5,69.0,730.2` |

Early-day H1 entrance walk is still not this bedtime PASS. This run is late-day leave, physical arrival, then own-bed sleep at a valid night tick.

## TEST_LIFECYCLE

Oak-log and curfew both **exit 0** after `stopPathfinding` + raced disconnect. No active-task keepalive failure.

## Cleanup / GREEN chests

HomeProbe disconnected and deopped. `save-all flush`. `forceload query` none. Paper left on 25567.

| Chest | Result |
| --- | --- |
| Mining `-954,58,944` | **coal ×1** preserved |
| Fishing `-1042,63,980` | chest still present; **Items: []** — salmon/cod **not** present after this window |

BLUE did not open the fishing chest. A leftover FishProbe was standing on that origin before kick. Do not treat empty fish loot as a fishing rerun; do not `/give` fish.

## Integration blockers

1. Fishing chest catch evidence is gone; GREEN should re-verify `-1042,63,980` without BLUE restoring items.
2. Five-citizen / two-bot / `pnpm sim:start` still not claimed.
3. Planner house-choice still UNVERIFIED.
4. Village rooftop drops still make pathfinder abort unless recovery replans; curfew walk needed that replan.
