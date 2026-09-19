# BLUE agriculture audit

Date: 2026-09-19  
Auditor: Agent BLUE  
Repo: `C:\Users\sh1ft\OneDrive\Desktop\minecraft_ai_sim`  
Production body: MechProbe / `@civ/minecraft-adapter` + `@civ/skills` on Paper **1.21.11**. Mindcraft/Astra were not restarted.

This is **not** a live farming PASS. A historical gauntlet “farm creation PASS” is **not** evidence that every agricultural operation works.

Working tree still contains Agent RED compact-hut / entity-target / blueprint-build WIP. BLUE did not revert, overwrite, or silently absorb that work. Farm edits stayed on `packages/skills/src/farm.ts` (committed skill file), planner/manager/config, and new farm-test files.

---

## Capability matrix

Statuses: **IMPLEMENTED** in production body code; **UNIT-TESTED** by Vitest; **HISTORICALLY LIVE-VERIFIED** only where `docs/MINECRAFT-BODY-CAPABILITY-MATRIX.md` / `docs/LIVE-MECHANICS-TEST.md` plus `live-mechanics-gauntlet.ts` recorded a Paper 1.21.11 result; **NOT VERIFIED** = code exists but that specific operation was not proven; **MISSING** / **BROKEN**.

| Capability | Status | Evidence |
| --- | --- | --- |
| Locate dirt/grass near water | **IMPLEMENTED** now + **UNIT-TESTED** geometry; **NOT VERIFIED** live | New `findTillablePlot` / `selectHydratedPlot` / `soilHydratedByWater` in `packages/skills/src/farm.ts`. Hydration is vanilla 4-block Chebyshev, same Y or one above. **No historical skill** scanned for a farm site. Gauntlet used RCON `setblock` water at 195,89,161. |
| Obtain and equip a hoe | **IMPLEMENTED** inventory-only; **NOT VERIFIED** as craft; historically **`/give` only** | `tillSoil` / `tillAndPlant` find `*_hoe` and `equipItem`. There is no farming obtain-hoe path. Gauntlet: `give MechProbe wooden_hoe 1`. Overlay recipes include wooden axe/shovel/pickaxe, **not** hoe. |
| Till dirt/grass into farmland | **IMPLEMENTED**; **UNIT-TESTED** tillable names only; **HISTORICALLY LIVE-VERIFIED one cell**; **NOT VERIFIED** 3×3 | `tillSoil` + `tillAndPlant` `activateBlock` then require `farmland`. Gauntlet `create tiny wheat farm plot` tills **one** grass cell at 194,89,163 next to RCON water. Not a 3×3. |
| Obtain, place, verify wheat seeds on farmland | **IMPLEMENTED**; **NOT UNIT-TESTED** against a bot; historically **one cell** + **`/give` seeds** | `plantCrop` requires farmland under the plant cell, seed in inventory, `activateBlock(soil)`, verifies block name `wheat`. Missing seeds → `ITEM_NOT_FOUND`. Occupied cell / no farmland → `PLACE_FAILED`. Gauntlet planted one cell; harvest fixture used RCON `wheat[age=7]`. |
| Recognize immature vs mature | **IMPLEMENTED** + **UNIT-TESTED**; **HISTORICALLY LIVE-VERIFIED** on two fixture cells | `isMatureCrop` wheat age ≥ 7. `gauntlet.test.ts` and `farm.test.ts` cover age 7 vs 3. Live: RCON age=7 harvested, age=3 left in place (`live-mechanics-gauntlet.ts`). |
| Harvest mature wheat and collect wheat + seed drops | **IMPLEMENTED**; **HISTORICALLY LIVE-VERIFIED** one mature fixture cell; **NOT VERIFIED** 3×3 or natural drops-from-growth | `harvestCrop` / new `harvestCropAt` dig mature only, `pickupDroppedItem`, inventory delta for wheat+seeds. Gauntlet used `setblock wheat[age=7]`, not grown wheat. |
| Replant harvested farmland when seeds exist | **IMPLEMENTED**; **HISTORICALLY LIVE-VERIFIED** on the harvested fixture cell | `harvestCrop` calls `plantCrop` if seeds remain; gauntlet asserted replanted `wheat` at that position. **NOT VERIFIED** across a 3×3 after a real growth cycle. |
| Recover from missing seeds / tools / blocked path / broken farmland / failed placement | **IMPLEMENTED** as ActionResult codes; **UNIT-TESTED** codes only; **NOT VERIFIED** live recovery | `MISSING_TOOL`, `ITEM_NOT_FOUND`, navigation failures, `PLACE_FAILED` (not farmland / occupied), `VERIFY_FAILED` (plant/till did not stick), `CROP_IMMATURE`. No live suite that breaks farmland then recovers. |
| Craft wheat → bread with real recipe + inventory | **IMPLEMENTED** generic craft; **UNIT-TESTED** recipe; **NOT VERIFIED** live from harvested wheat | `minecraft-knowledge` bread = 3 wheat, `needsTable: false` (`recipes-121.test.ts`, overlay in `crafting.ts`). `craftItem` / `obtainItem("bread")`. Gauntlet never crafted bread. A villager-trade case `/give wheat 32` is **not** bread craft. |
| Eat carried food | **IMPLEMENTED**; **UNIT-TESTED** food table; **HISTORICALLY LIVE-VERIFIED** eat, **not** bread-from-farm | `eatFood` in `inventory.ts` (equip + `consume`, hunger/count delta). Matrix eat PASS used `/give cooked_beef`, not farm bread. |
| Deposit / retrieve real food in a physical chest | **IMPLEMENTED**; **HISTORICALLY LIVE-VERIFIED** generic chest; **NOT VERIFIED** farm-food cycle | `depositItems` / `withdrawItems` verify container counts. Matrix chest PASS. No live “bread from this field into this chest then eat”. |

**Do not read the gauntlet farm PASS as till+plant+grow+harvest+replant+bread+chest.** It was: (1) harvest RCON-mature wheat and replant that cell, (2) tillAndPlant **one** grass cell after `/give` hoe and seeds. No wait for Minecraft growth. No 3×3. No bread. No farm chest. No site selection.

---

## Citizen food path vs body skills

`gatherFood` (`packages/agent-core/src/executor.ts`) previously `mineBlock`’d any wheat it treated as mature. `findMatureCrop` defaulted missing age to **7**, which could break immature crops. BLUE replaced crop breaking with `harvestCrop` (mature-only, can replant). Berries/leaves/hunt/bread-from-carried-wheat remain. That executor change is not a live PASS.

Planner hunger reflex still eats or `gatherFood`s when personal hunger is low. That is survival, not a job assignment.

---

## Food management (physical vs decision)

### A. Physical capability

Eat, craft bread, transfer, inspect inventories, harvest, plant, chest deposit/withdraw: body skills above. No auto-eat plugin.

### B. Citizen decision-making

| Mechanism | What it does | Allowed for Experiment 1? |
| --- | --- | --- |
| `computeNeeds` food &lt; 16 → `NEED_FOOD` | Shared **fact** | Yes, as an indicator only |
| `assignWorkRoles` roster index → wood/food/stone/tools/build | Permanent-style jobs by join order | **Disabled** by default (`SIM_ASSIGN_WORK_ROLES=false`) |
| `assignSettlementNeeds` round-robin `NEED_FOOD` → first citizen | Forces a farmer | **Disabled** with the same flag |
| Hunger ≤ 8 + no personal food → `gatherFood` | Personal survival | Yes |
| `HeuristicProvider` `NEED_FOOD` → `gather_food` | Shortage dictates a goal | Only if `LLM_ENABLED` (default **false**). Remaining gap if LLM is turned on |
| `shareFoodNearby` | Drops food to a nearby player when action is `shareItem` | Capability; planner does not auto-ration |
| Starter food grant | **None** in sim spawn | Inventories start empty. Origin: **no sim-created food**. MechProbe eat used RCON `cooked_beef` (test control, not a citizen starter pack) |

Shortage must not mint wheat, assign a farmer, or equalize rations. BLUE did not add auto-distribution.

---

## Task 4 — predetermined jobs

**Caller of `assignWorkRoles`:** only `packages/agent-core/src/manager.ts` (plus unit tests). `planCitizen` still *honors* `workRole` / `assignedNeeds` when provided.

**Change:** `experimentWorkAssignment(..., assignRoles)` in `planner.ts`. Manager uses `this.config.SIM_ASSIGN_WORK_ROLES` (default **false**). Legacy tests that pass `workRole` explicitly still pass. `SIM_ASSIGN_WORK_ROLES=true` restores roster jobs.

All five citizens keep the same skill library. Nobody is assigned a permanent farmer/miner job in Experiment 1.

Remaining non-job heuristics (unchanged): bootstrap pickaxe from wood, opportunistic shelter if wood ≥ 16 and no shelter, deposit if carrying ≥ 4 food and a chest exists.

---

## Isolated 1.21.11 lab (do not confuse servers)

| Port | What | BLUE action |
| --- | --- | --- |
| **25565** | Live civilization Paper 1.21.11 | Not used. Not started/stopped. Farm harness refuses this port. |
| **25566** | MindcraftProbe Paper **1.21.4** | Not a 1.21.11 farm lab. Harness refuses. |
| **25567** | RED `world-lab/` Paper 1.21.11-132, seed `20260919`, RCON **25577** | Live `mechanics:farm` on disposable pad `20,68,240`. Settlement C not used as the farm. See [BLUE_AGRICULTURE_LIVE_RUN.md](./BLUE_AGRICULTURE_LIVE_RUN.md). |

Harness: `apps/orchestrator/src/live-farm-test.ts`, guard `farm-test-guard.ts`. Requires `MECHANICS_FARM_TEST_ENABLED=true` **and** `FARM_TEST_ALLOW_WORLD_MUTATION=true`. Default port 25567. Does not call `ensurePaper` / `AUTO_START_PAPER`.

---

## Unit tests this pass

BLUE ran Vitest on the dirty tree after these changes:

```
Test Files  3 failed | 42 passed (45)
Tests       4 failed | 245 passed (249)
```

The **same 4 failures** as the prior compact-hut / entity-target WIP (not agriculture). New farm/planner/guard tests passed. Live 3×3 on world-lab **25567** (2026-09-19): **not a full PASS**. Scorecard and command: [BLUE_AGRICULTURE_LIVE_RUN.md](./BLUE_AGRICULTURE_LIVE_RUN.md). Seven wheat cells reached age 7 under TEST_CONTROL `random_tick_speed 300`; harvest/bread/chest/eat did not complete. Compact-hut WIP was not edited.
