# BLUE farming reuse evaluation

Date: 2026-09-19  
Project: `minecraft_ai_sim`  
Body: existing MechProbe / `@civ/minecraft-adapter` + `@civ/skills`  
Server: Paper **1.21.11-132**, `127.0.0.1:25567`, RCON `25577`, seed `20260919`  
Pad: `FARM_TEST_ORIGIN=20,68,240` (approved disposable WORLD-LAB rectangle X 20–23, Y 68–72, Z 238–242)  
Site C `(-1032,64,888)` was not modified. Ports **25565** and **25566** were not used.

This document reviews three public Mineflayer farming repos, records what was safe to adapt, and reports the guarded live farm-to-food rerun. External code is **UNVERIFIED** on Paper 1.21.11 and was **not** installed into the live simulation.

---

## Repositories and licenses

| Repo | Language / deps | License | Identity model | Verdict |
| --- | --- | --- | --- | --- |
| [JagritThukral/mineflayer-farmbot](https://github.com/JagritThukral/mineflayer-farmbot) | `index.js` + `utils/{blockChecker,item,produceManager}.js`. `mineflayer` ^4.20.0, `mineflayer-pathfinder` ^2.4.5, `mineflayer-blockfinder` | GitHub SPDX **MIT**; `package.json` says **ISC** | Dedicated `Farmbot` account, 10 s permanent `startFarming` loop, chat `!enable`/`!set` | Ideas only. Permissive. Do not copy the loop or nearest-chest search. |
| [kxnqss/sprout](https://github.com/kxnqss/sprout) | single `index.js`. `mineflayer` ^4.37.1, `mineflayer-pathfinder` ^2.4.5. README targets **1.20.6** | **ISC** (`package.json`; GitHub license field null) | Dedicated `Sprout` account, 500–2000 ms `farmTick` daemon, HTTP dashboard | Ideas only. **Do not copy** `bot._client.write('block_dig'|'block_place')`. Do not `/op` citizens for chest packets. |
| [maximmasiutin/Minecraft-Bot](https://github.com/maximmasiutin/Minecraft-Bot) | `minecraft-bot.js`. `mineflayer` + `mineflayer-pathfinder` | **GPL-3.0** | Dedicated bot, whisper `farm` starts a permanent state machine | **No source copied.** GPL would infect this tree. Independent reimplementation of the *idea* “if already within reach, dig; do not GoalNear onto the crop.” |

None of these projects are citizen planners. All three spawn a **separate farmer identity** and run until stopped. That is incompatible with five independent citizens who decide whether, when, and how much to farm.

---

## Code compared (not READMEs)

### mineflayer-farmbot (MIT/ISC)

Inspected: `index.js` `startFarming`, `utils/blockChecker.js`, `utils/produceManager.js`.

Relevant routines:

- Iterate a **caller-set** AABB (`!set start end dustbin`), not “nearest dirt.”
- `wheatBlock.metadata === 7` for mature wheat.
- `GoalNear` / `GoalGetToBlock`, then `lookAt` + `activateBlock` (till/plant) or `dig` (harvest).
- `delay(1000)` after harvest so vanilla pickup can occur.
- Dig non-air above soil before tilling (lip / farmland-revert).
- Chest: `findNearestChest` from the farm start, `openContainer` + `deposit` wheat. Stops if the chest is full.

Not used: reconnect-every-20s, tossing extra seeds at a “dustbin,” permanent interval, nearest-chest as the only store.

### sprout (ISC)

Inspected: `index.js` `scanFarm`, `scanChests`, `farmTick`, `manageInventory`, `placeSeed`.

Relevant routines:

- Scan known farmland and `crop.getProperties().age` (stage 0–7, empty = `null`).
- Plant empty plots, wait while growing, harvest mature, replant. Inventory targets = plot count.
- Chests discovered by **item-frame labels** (seeds vs wheat). Seed restock / wheat deposit to those labeled chests.
- README documents harvest `GoalNear(..., 4)`; the checked `index.js` uses `reach = 1` plus raw packets.

Rejected:

- `bot._client.write('block_dig', { status: 0 then 2 })` and raw `block_place` (version-fragile; bypasses our action results).
- Paper 1.20.4+ “`/op Sprout` because of chest packet validation” ([mineflayer#3459](https://github.com/PrismarineJS/mineflayer/issues/3459)). FarmProbe is op only as TEST_CONTROL on WORLD-LAB. Citizens do not get op.
- Permanent `farmTick` and dashboard.

### Minecraft-Bot (GPL-3.0)

Inspected: `minecraft-bot.js` farming state machine. **No lines copied.**

Observed ideas (reimplemented independently):

- `CMaxFarmDistanceToHarvest = 2`: if already that close, `dig` without a new path.
- Treat wheat as a walk-through plant so pathfinder does not treat the crop as a wall (`movements.carpets` in that repo). We instead **refuse farmland/wheat as ranked standing cells** and skip pathing when `isWithinBlockReach` (4.5).
- Collect nearby wheat/seed *item entities* after a harvest batch, not by standing on each crop cell.

---

## Observed failures vs skill vs harness

Evidence from the first WORLD-LAB run (`docs/BLUE_AGRICULTURE_LIVE_RUN.md`) and later guarded reruns.

| Failure | Class | Confirmed cause | What an external farm loop would / would not fix |
| --- | --- | --- | --- |
| Water/chest missing after run 1 | **Harness fixture** | Un-namespaced `setblock` produced no Paper “Changed the block” line. No RCON+bot read-back. Test continued past `SITE_UNSUITABLE`. | None of the three repos place water or flatten lips. They assume a pre-built farm. |
| 8/9 planted; `(22,68,240)` stayed dirt | **Harness + vanilla** | One-block grass lip at Y69; farmland with a solid block above reverts. | Farmbot’s “dig above then hoe” helps grass, not a solid lip. Flattening the approved pad and fail-fast lip checks fixed 9/9 till/plant. |
| Harvest 2/9 then 8/9 `PATH_FAILED` | **Skill** | `navigateToInteractWithBlock` ranked standing **on farmland** (15/16 block). Pickup used `GoalNear` range 0.8, walking the bot onto the plot. Later cells “path interrupted heading to …”. | Reach-first harvest (Masiutin idea; Sprout README reach=4) plus “do not chase drops onto farmland mid-harvest” (farmbot delay, then one collect pass). |
| Only +1 wheat from 2 harvests | **Skill** | Drops not collected; bot left the stand to stand on items. | Batch collect after all digs. Live later: wheat **0→8** and **0→11** / **0→18** on 9/9 harvests. |
| Bread/chest/eat never reached | **Consequence** | Run 1: no wheat, no chest. Later: harvest pathing, then chest pathing from the field, then eat while hunger effect still drained food. | External loops do not craft bread or eat. Chest deposit exists in farmbot/sprout but not as citizen-designated storage. |

`findTillablePlot` on run 2 reported origin `20,68,237` (outside the approved Z 238–242). Locate now **inspects the caller’s origin**, not an arbitrary nearby 3×3.

---

## What was implemented (compatible skill)

All farming still runs on the **existing citizen/probe body**. No second bot account. No raw protocol. No GPL source.

New/changed surfaces:

- `inspectFarm` / `evaluateFarmPreconditions` / `workFarmPlot` in `packages/skills/src/farm.ts`
- Reach-first approach: `isWithinBlockReach` + skip pathing; if pathing fails but the block is still in 4.5 reach, interact anyway (`packages/minecraft-adapter/src/navigation.ts`, `interaction.ts`)
- Ranked standing cells **exclude farmland and crop feet** so pathfinder is not asked to stand on the wheat
- Harvest: dig/replant in reach, **one** `collectFarmDrops` after the plot, then optional deposit to the **caller-supplied** chest
- Pickup range for item entities 0.8 → 2.0 (do not require standing on the item)
- Till: dig replaceable plants above soil; still fail if a solid lip would revert farmland
- `eatFood` waits 800 ms after `consume()` for 1.21.11 inventory/hunger sync
- Executor case `workFarmPlot` **only if** `plan.target` is set. Planner still does **not** emit this action from settlement `NEED_FOOD` or roster order (`planner.test.ts`)

`workFarmPlot` contract:

- Caller passes `origin`, optional `water`, `seedStorage`, `cropStorage`, `maxHarvest`
- Fails `SITE_UNSUITABLE` without hydrating water, `MISSING_TOOL` if tilling without a hoe, `ITEM_NOT_FOUND` if seeds and seed storage are both missing, `CONTAINER_NOT_FOUND` if designated storage is not a chest
- One bounded pass. Honors `ctx.signal`. Returns tilled/planted/harvested/replanted counts, wheat/seed deltas, deposited/withdrawn
- Does **not** choose a nearest chest, nearest farm, or how many crops unless `maxHarvest` is provided

TEST_CONTROL vs production:

- Dual flags `MECHANICS_FARM_TEST_ENABLED` and `FARM_TEST_ALLOW_WORLD_MUTATION` unchanged
- Finite `/give wooden_hoe 1` + `wheat_seeds 16` after `/clear`; **no** `/give wheat` or `/give bread`
- `gamerule random_tick_speed 300` during growth only, restored to **3** before harvest (and again in cleanup)
- Hunger effect then `effect clear` so bread can actually be eaten; reported as TEST_CONTROL
- If walk-back to the stand fails, harness may `tp` FarmProbe to `20.5,69,238.5` before chest (logged)

---

## Tests run

Unit (vitest):

- `packages/skills/src/farm.test.ts` — geometry, hydration (including water-below rejection), inspect/precondition fail-closed without water/seeds/storage
- `packages/minecraft-adapter/src/interaction.test.ts` — farmland/wheat are not harvest standing cells
- `packages/agent-core/src/planner.test.ts` — unassigned citizens do **not** get `gatherFood` or `workFarmPlot`
- `apps/orchestrator/src/farm-test-guard.test.ts` — 25565/25566 refuse, dual flags

Live (Paper 1.21.11 WORLD-LAB, FarmProbe, origin `20,68,240`):

Spectator command printed before actions:

```
/execute in minecraft:overworld run tp @s 16 73 232 -27 20
```

Human `Shadowskiii1` watched from `22.1,71.5,237.2` (off pad). Exclusive-control check allows that perch and refuses only if the human stands on X 20–23, Z 238–242.

### Live scorecard (run 6, log `docs/BLUE_AGRICULTURE_LIVE_RUN_6.log`)

| Stage | Result | Evidence |
| --- | --- | --- |
| Fixture preflight | **PASS** | RCON+bot read-back `water=water` at `23,68,241`, `chest=chest` at `23,69,238`, `table=crafting_table` at `23,69,239`, hoe=1 seeds=16 wheat=0 bread=0 |
| Locate hydrated 3×3 | **PASS** | origin `20,68,240` water `23,68,241` (not a drifted plot) |
| Till + plant | **PASS** | tilled=9 planted=9; seeds 16→12 |
| Grow (Minecraft ticks) | **PASS** | polls to ages `7,7,7,7,7,7,7,7,7`; `random_tick_speed 300` then restored **3** before harvest. No `setblock wheat[age=7]` |
| Harvest + collect + replant | **PASS** | harvested=9 replanted=9; wheat **0→8**; seeds 12→23 |
| Craft bread | **PASS** | bread **0→1**, wheat **8→5** (three harvested wheat consumed). Recipe `needsTable=true`; used the pad table |
| Chest + eat | **PASS** | deposit/withdraw bread; TEST_CONTROL hunger then clear; eat hunger **0→5**, bread **1→0** |
| Restore | **PASS** | tick 3; snapshot restore of the approved rectangle; `forceload leftover: none` |

Elapsed **146468 ms**. Process exit 0.

This is a **live physical farm-to-food PASS** for FarmProbe on the approved pad. It is **not** proof that the five-citizen civilization already farms autonomously on 25565.

---

## Remaining limits (not claimed)

- Citizens still need a **chosen farm origin** (`plan.target`) and designated storage. The planner will not silently pick a farmer or a nearest chest.
- `gatherFood` may still harvest a single nearby mature crop opportunistically; it is not a farm loop.
- Sprout-style item-frame chest labels and raw packets were not adopted.
- Chest pathing from the middle of farmland remains brittle; the skill now prefers reach-first, and the harness returns to `20.5,69,238.5` before chest ops.
- World-lab FarmProbe is op for TEST_CONTROL only. Do not grant op to Atlas/Maya/Theo/Ava/Kai for farming.

---

## Full physical farm-to-food cycle

**Yes, on WORLD-LAB with FarmProbe, 2026-09-19 run 6.** Direct live evidence for till 9/9, natural/accelerated growth 9/9, harvest 9/9, replant 9/9, collected wheat, bread crafted from that wheat, chest deposit/withdraw, and eating. No `/give wheat`, `/give bread`, or RCON-mature crops.
