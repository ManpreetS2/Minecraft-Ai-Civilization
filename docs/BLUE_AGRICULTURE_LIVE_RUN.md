# BLUE agriculture live run (world-lab)

Date: 2026-09-19  
Target: Paper **1.21.11-132** `127.0.0.1:25567` RCON `25577` seed `20260919`

## Later verified PASS (run 6)

Guarded rerun after fixture + harvest-skill fixes. Full physical cycle **PASS** for FarmProbe on the approved pad. Details: [BLUE_FARMING_REUSE_EVALUATION.md](./BLUE_FARMING_REUSE_EVALUATION.md). Log: `docs/BLUE_AGRICULTURE_LIVE_RUN_6.log`.

| Stage | Result |
| --- | --- |
| Fixtures water `23,68,241` chest `23,69,238` table `23,69,239` | PASS (RCON+bot read-back) |
| Till/plant 9/9 | PASS |
| Growth ages 7×9 under `random_tick_speed 300`, restored 3 before harvest | PASS |
| Harvest 9/9, replant 9/9, wheat 0→8 | PASS |
| Bread 0→1 from wheat 8→5 | PASS |
| Chest deposit/withdraw; eat hunger 0→5, bread 1→0 | PASS |
| Cleanup tick=3, snapshot restore, forceload empty | PASS |

This does **not** assign a farmer among the five citizens and was not run on 25565/25566.

---

## First live run (not a PASS; kept for audit)

This first run is **not** a full farming PASS.

## Command / configuration

```
MECHANICS_FARM_TEST_ENABLED=true
FARM_TEST_ALLOW_WORLD_MUTATION=true
FARM_TEST_HOST=127.0.0.1
FARM_TEST_PORT=25567
FARM_TEST_RCON_PORT=25577
FARM_TEST_VERSION=1.21.11
FARM_TEST_ORIGIN=20,68,240
FARM_TEST_RANDOM_TICK_SPEED=300
FARM_TEST_GROWTH_MS=180000
FARM_TEST_USERNAME=FarmProbe
pnpm --filter @civ/orchestrator mechanics:farm
```

Guards refused 25565/25566. `AUTO_START_PAPER` was not used. Live civ 25565 and Mindcraft 25566 were **not listening**. Human `Shadowskiii1` stayed near settlement C (~1.2 km from the pad). Compact-hut WIP was not edited.

Harness fix during this run: 1.21.11 gamerule id is `random_tick_speed`, not `randomTickSpeed`. Without that, TEST_CONTROL acceleration would have been a no-op.

## TEST_CONTROL vs emergent

| Action | Class | Notes |
| --- | --- | --- |
| `fill` 3×3 grass + air | TEST_CONTROL fixture | Logged |
| `setblock` water `23,68,241` and chest `23,69,240` | TEST_CONTROL attempted | Post-test RCON: **no water, no chest**. Commands were sent; blocks did not persist as water/chest |
| `/clear` + `/give wooden_hoe 1` + `/give wheat_seeds 16` | TEST_CONTROL finite | Inventory after give: hoe=1 seeds=16. **Not** citizen starter food |
| `gamerule random_tick_speed 300` for 180 s then restore **3** | TEST_CONTROL growth accel | Restored. **Not** `setblock wheat[age=7]` |
| Tilling, planting, observed ages, 2-cell harvest, +1 wheat | Emergent body/world | Partial |

No RCON-placed age-7 wheat was used as growth proof.

## Stage scorecard

| Stage | Result | Live evidence |
| --- | --- | --- |
| Fixture hoe/seeds/land | **PASS** (fixture only) | hoe=1 seeds=16 after `/give` |
| Locate dirt/grass near water | **FAIL** | `SITE_UNSUITABLE No water nearby` in 26 ms |
| Till + plant 3×3 | **FAIL** | 8/9. `(22,68,240)` `PLACE_FAILED` still dirt |
| Grow under Minecraft ticks | **UNVERIFIED** as a complete 3×3 | After 180595 ms at tick speed 300, ages `3,7,7,7,7,7,1,7,7`. **Seven cells reached age 7. Two did not.** Not a 9/9 PASS. Not faked with setblock |
| Harvest + pickup + replant | **FAIL** | 2/9 harvested. Wheat inventory **0→1**. Failures: `CROP_IMMATURE`, five `PATH_FAILED`, one `BLOCK_NOT_FOUND` |
| Craft bread from harvested wheat | **UNVERIFIED** | Need 3 wheat; held **1** |
| Chest deposit / withdraw / eat | **UNVERIFIED** | No bread. Chest block was not present after the run |
| Missing-seed / no fabricate | **PASS** (narrow) | No extra `/give` wheat/bread |

Elapsed **229325 ms**. Process exit 1.

FarmProbe spawned at **-1024.5, 64.0, 838.5** (current world-spawn neighborhood, ~59 m from settlement C) then teleported to **20.5, 69, 238.5**. Settlement C was not used as the farm pad.

## Post-run world (before cleanup)

RCON `execute if block` after disconnect:

- Farmland: `20,68,240` `21,68,240` `21,68,241` `22,68,241` `21,68,242` `22,68,242`
- Dirt: `22,68,240` `20,68,241` `20,68,242` `23,68,241` (intended water)
- Wheat still at several Y69 cells; `22,69,240` was `grass_block` (never a crop)
- Intended chest `23,69,240`: **grass_block**
- `random_tick_speed`: **3** (restored)
- FarmProbe offline; only `Shadowskiii1` on the list

## Cleanup done

Owned rectangle only (`20..23`, `Y68–72`, `Z238..242`):

- `fill ... air` then `grass_block` at Y68
- killed 14 leftover item entities
- `forceload` cleared
- `random_tick_speed` confirmed 3

This flattened the original 1-block rise at x=22,z=240 (was grass Y69). Settlement C and Candidate A center were not filled.

## Full farming complete?

**No.** Required stages without direct live PASS: locate-near-water, full 3×3 till/plant, full natural/accelerated 9/9 mature, harvest+pickup+replant of the field, bread from harvested wheat, chest food cycle, eat bread.
