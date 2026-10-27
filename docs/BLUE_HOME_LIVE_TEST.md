# BLUE HomeProbe live test (TASK 05)

Date: 2026-09-19 / 2026-09-20  
World: isolated WORLD-LAB Paper **1.21.11-132**, seed `20260919`, `127.0.0.1:25567`, RCON `25577`  
Probe: **HomeProbe** only (not Atlas/Maya/Theo/Ava/Kai)  
Farming checkpoint preserved: `7d3e645`  
This is **not** a five-citizen civilization PASS. Planner house-choice remains UNVERIFIED.

## WORLD-LAB / fixtures

- Pre-homes backup was **not** restored.
- Site C fixtures used as RED installed them: H1 claim/stoop/bed/chest, H4 distractor, tannery communal chest with bread×1 + leather_helmet×1 (preserved).
- Human `Shadowskiii1` was online during runs; not treated as a citizen.
- Ports **25565** / **25566** were not used. `pnpm sim:start` was not run.

## HomeProbe live results (run 380271, after door/interact/jump work)

| Stage | Result | Evidence |
| --- | --- | --- |
| Preflight H1/H4/tannery | **PASS** | yellow_bed + chest + oak_door; H4 white_bed+chest; tannery bread+helmet |
| Disposable 1-block rise at 200,400 | **FAIL** | STUCK at `200.7,67.0,400.5`; recoveries=2; jump eligible but did not land on dirt. Isolated pad, not Site C. |
| Start near village; H4/tannery closer | **PASS** | H5 dirt_path `-1082,68,799` |
| Navigate to claimed H1, not H4 | **PASS** | real walk to stoop `-1095.6,69.0,732.5`; dH1=4.7 dH4=61.7 |
| Sleep on H1 HEAD `-1097,69,728` | **PASS** | already-open oak_door not toggled; enter nudge `-1095.5,69.0,730.2`; slept designated `yellow_bed` at `-1097,69,728` |
| Personal H1 chest, not tannery | **PASS** | paper in/out of H1 `-1096,69,729`; tannery bread+helmet unchanged; no paper in tannery |
| ACCESS_DENIED other claim | **PASS** | H4 claimed by `probe_home_b` |
| Persist across disconnect | **PASS** | sqlite `home_h1`; walked back to interior `-1095.5,69.0,730.2` |
| Missing designated bed | **PASS** | `BED_MISSING`; furniture not destroyed |

Overall harness exit is 1 only because the disposable 1-block pad stage failed. **Home claim / sleep / storage / persist are PASS.**

Earlier run 380263 had sleep FAIL on the stoop because an already-open door was toggled shut. That is fixed.

Logged initial spectator/`tp` is TEST_CONTROL only. Navigation PASS is a real walk, not a teleport claim.

## Movement add-on (same WORLD-LAB, disposable pad ~200,67,400 — not Site C)

No lava was placed in Site C. Village blocks were not used as lava/magma fixtures.

### Implemented (shared adapter; BLUE-owned)

- Stall watch ~1.0s after progress / 1.5s with no progress; skip sleep/chest/idle/chunk/busy; max 2 recoveries; recovery lock.
- Halt pathfinder (`stop` + `setGoal(null)` + release controls) before a controlled forward+jump.
- Observable `LocalTerrainMemory` (radius 4, max 256 cells, blocked-edge TTL 20s); trees are trunk/leaf coordinates.
- Lava/magma/fire: stop, retreat, bypass, else `HAZARD_BLOCKED`. Authorized bridge is `evaluateHazardBridge` / `attemptHazardBridge` (real inventory, no step-into-lava). Default nav does **not** place blocks (`allowHazardBridge` opt-in).
- Return-home ETA: `evaluateReturnHome` includes an 8s recovery buffer; mining `returnHome` stops optional work and reports actual position + delay (no teleport).
- 1.21.11 `player_input` bitset merge (sneak-only packets no longer clear jump) and `tick_end` after position packets.

### Unit-tested (PASS)

One-block jump eligibility, two-block/tree refusal, stall vs waiting, already-open door no toggle, closed wooden door once, lava halt/retreat/bypass plan, cobble cover plan when construction+inventory allowed, lava no-crossing fail, magma not a landing, cancel/exhaustion releases controls, return-home ETA, terrain memory edges.

### Live-tested on pad (HomeProbe, WORLD-LAB)

| Behavior | Live | Notes |
| --- | --- | --- |
| 1-block dirt hop | **FAIL / partial** | Jump is eligible. After 1.21 input fix, body reached **y=67.3** (jump started) but did not finish on the dirt (ended ~`200.7,67.3,400.5`). Earlier false arrivals at y=67 were caused by GoalNear range 4 swallowing a 1-block Y miss. |
| Two-block oak_log go-around | **FAIL** | Did not pass x≥203.6; stayed ~`202.7,67,400.7`. |
| Lava ahead | **mixed** | Contained/pit tests: one bypass beside lava without entering; one walk/fall into a y=66 lava pit (probe died, later connect TIMEOUT). Not Site C. |
| Magma standing | **PASS (weak)** | Did not stand on magma; `chooseStandingDestination` refused the magma cell. |
| H1 already-open door | **LIVE PASS** | `handled=true toggled=false open=true`; sleep and storage entered z=730.2 |
| H1 sleep on HEAD | **LIVE PASS** | designated `yellow_bed` `-1097,69,728` |

### Still unverified live

- Reliable 1-block landing on Paper 1.21.11 (jump initiates, landing not consistent).
- Tree/wall replan that actually passes the trunk.
- Authorized real cobble bridge over lava.
- GREEN mining return-home on a live MineProbe (interface is in `mine.ts`; not exercised here).

## GREEN interface (do not fork nav)

- `evaluateReturnHome`, `HAZARD_BLOCKED`, `MiningRequest.returnHome?: Vec3`.
- Shared navigator remains `@civ/minecraft-adapter` only.

## Cleanup / ownership

- Pad dirt/logs restored to air when stages finished; leftover magma/lava at 200,400 was cleared when chunks were loaded.
- Tannery loot and five Site C chests were not the movement fixtures.
- WORLD-LAB Paper was left running. HomeProbe disconnected after the harness. Pre-homes backup must not be restored over the chests.

## 2026-09-20 addendum — shared auto-jump / two-block / lifecycle / curfew

Preserved live evidence (not re-run this window; GREEN owns exclusive FishProbe WORLD-LAB):

| Gate | Live status | Evidence |
| --- | --- | --- |
| One-block landing | **PASS** | disposable pad `200,67,400`; landed ~`201.2,68.0,400.4` (also `201.4` / `201.5`). 0–2 tick approach, not the old four-forward-tick jump. |
| Lava / magma | **PASS** | `HAZARD_BLOCKED` lava 404ms at `207.5,67.0,400.5`; magma at `203.5,67.0,402.5`. |
| Work to H1 walk | **PASS** | `executeReturnHome` `-1082.5,68,799.5` → `-1095.5,69.0,731.5`. Early-day clock; **not** a bedtime/sleep PASS. |
| H1 sleep / storage / persist | **PASS** | run 380271 designated yellow_bed `-1097,69,728`; paper in H1 not tannery. |
| Two-block oak_log | **FAIL live** / **unit detour PASS** | last live TIMEOUT at ~`202.7,67.0,400.7` heading `204 67 401`. Navigator now side-steps observed cells or `PATH_BLOCKED`; physical pad rerun requested after GREEN FishProbe. |

Human Minecraft Auto-Jump does not affect Mineflayer. Atlas/Maya/Theo/Ava/Kai inherit `moveToPosition` / `installSharedNavigator` on spawn. Five-body inheritance is a unit regression, not `pnpm sim:start`.

## 2026-09-20 exclusive window (after GREEN FishProbe)

See [BLUE_OAK_LOG_AND_CURFEW_LIVE.md](./BLUE_OAK_LOG_AND_CURFEW_LIVE.md).

- **TWO_BLOCK_DETOUR_LIVE=PASS** — `202.5,67.0,400.5` → `204.6,67.0,400.7` around oak_log, no clip, exit 0.
- **HOME_WALK_LIVE=PASS** / **H1_SLEEP_LIVE=PASS** / **CURFEW_LIVE=PASS** — work `-1082.5,67.9,799.5` t=11990 → interior `-1095.5,69.0,730.2` t=12766; own `yellow_bed` `-1097,69,728` at tick 18000; door not toggled; harness exit 0.


