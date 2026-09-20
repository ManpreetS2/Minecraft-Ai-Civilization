# GREEN mining audit and plan

Date: 2026-09-19  
Owner: Agent GREEN  
World: isolated WORLD-LAB Paper 1.21.11 is **not** used in this pass.

This document is the mining checkpoint. BLUE's home/farm work and RED's world files were not rewritten. Shared adapter/pathfinder files were not modified.

## 1. Existing capabilities (audit)

### What already works

| Capability | Where | Status |
| --- | --- | --- |
| SAFE navigation, doors, jump, stuck recovery | BLUE `@civ/minecraft-adapter` `pathing.ts` / `navigation.ts` / `local-escape.ts` / `step-jump.ts` | Production. `NORMAL_NAVIGATION_CAN_DIG=false`. |
| Approach a block then look/get-to | `MineflayerPathfinderBackend.navigateToInteractWithBlock` (GoalNear standing cells, then `GoalLookAtBlock` / `GoalGetToBlock`) | Production. This is the collectblock **pattern** without the plugin. |
| Equip a harvestable tool | `equipToolForBlock` wrapping **mineflayer-tool@1.2.0** (`requireHarvest: true`, `getFromChest: false`) | Production. Knowledge `equipForBlock` is the `MISSING_TOOL` fallback. |
| Surface gather (wood/stone) | `collectResource` + `bot.dig` + `pickupDroppedItem` | MechProbe historically live-verified wood/stone. Uses `findBlocks` without an exposure filter (acceptable for surface logs/stone; **not** used for citizen ore). |
| Craft missing wooden tools | `obtainItem` | Production. |
| Deposit/withdraw with inventory deltas | `depositItems` / `withdrawItems` | Production. BLUE homes add `ACCESS_DENIED` / personal vs communal chests. |
| Cancel | `ctx.signal` AbortController | Skills check it; dedicated five-bot cancel is still unverified. |
| Probe isolation | `isMechanicsProbeUsername` | MechProbe / FarmProbe / HomeProbe reserved. **MineProbe** added. |

`CONTROLLED_EXCAVATION` already exists on BLUE's `MovementProfile` and is the only profile with `canDig=true`. It is **not** used by normal navigation. GREEN did not enable it.

### What was missing

- Version-aware ore generation knowledge (elevations, biomes, tool tiers, hazards).
- A bounded **mine-known-ore** skill that refuses hidden blocks, straight-down digs, lava, and unpermitted chests.
- A separate **search plan** that does not leak ground-truth coordinates to the acting body.
- A MineProbe live harness with RED/BLUE/user guards.
- Citizen-level choice of *whether* and *what* to mine (still UNVERIFIED; API only).

### Upstream reuse (inspected, not duplicated)

Sources inspected 2026-09-19:

1. **mineflayer-collectblock** (MIT) — `CollectBlock.ts`  
   `collect()` sets pathfinder movements with `canDig` implied unsafe (`dontMineUnderFallingBlock=false`, `dontCreateFlow=false`), `equipForBlock(..., { getFromChest: true })`, and `GoalLookAtBlock` + `dig` + `itemDrop` queue. **Not installed. Not loaded.** Prior spike (`docs/BODY-ENGINE-BAKEOFF.md`) rejected it for settlement safety. GREEN does not reinstall it.

2. **mineflayer-tool** (MIT) — `Tool.ts` @ 1.2.0  
   **Already loaded.** Reused as-is: `equipForBlock(block, { requireHarvest: true, getFromChest: false })`.

3. **mineflayer-pathfinder** (MIT) 2.4.5  
   **Already BLUE's navigator.** Reused via `navigationBackend()`. No second pathfinder. No `canDig=true` for mining travel.

4. **cabaletta/baritone** (LGPL-3.0)  
   Reference only: bounded radius, stop on budget, do not infinite-mine. **Not a dependency.** `nuxdie/baritone-ts` (AGPL) remains banned.

## 2. Ore knowledge (1.21.11)

Module: `packages/minecraft-knowledge/src/ores.ts`  
Sources:

- [Minecraft Wiki Ore](https://minecraft.wiki/w/Ore) Java 1.18+ distribution table (still the 1.21.11 table; 1.20.2 added extra diamond below Y=0).
- [Ore (feature)](https://minecraft.wiki/w/Ore_(feature)) blob / air-exposure notes.
- `minecraft-data` harvestTools for the loaded 1.21 family (unit-tested).

| Resource | Pickaxe | Generation range (not a deposit) | Preferred search band | Notes |
| --- | --- | --- | --- | --- |
| coal | wooden | Y 0–320 | 32–96 | None below Y=0. Mountain batch above 136. |
| iron | stone | −64–72 and 80–320 | 8–24 | Second peak on mountain cliffs. |
| copper | stone | −16–112 | 32–64 | Dripstone caves bonus. |
| gold | iron | −64–32 (Badlands to 256) | −32–0 | Badlands surface bonus. |
| redstone | iron | −64–16 | −64–−48 | Shares diamond floor. Lava. |
| lapis | stone | −64–64 | −16–16 | Buried batch often air-culled. |
| diamond | iron | −64–16 | −64–−48 | Extra buried batch since 1.20.2. |
| emerald | iron | −16–320 | 64–256 | Mountain / windswept biomes only. |

Approximate peak Y values are **search hints**. A citizen can exhaust the budget and must report `SEARCH_EXHAUSTED`, not invent a vein.

Hidden ore is not part of this API. A test harness may RCON-identify a block **after** the probe mined it.

## 3. Code changes (GREEN)

New:

- `packages/minecraft-knowledge/src/ores.ts` + `ores.test.ts`
- `packages/skills/src/mine.ts` — `mineKnownOre` / `evaluateMiningRequest` / visibility / safety / storage
- `packages/skills/src/ore-search.ts` — search bands, cardinal tunnel proposal, strip-mine refusal
- `packages/skills/src/mine.test.ts`
- `apps/orchestrator/src/mine-test-guard.ts` + tests
- `apps/orchestrator/src/live-mine-test.ts` (guarded; default exit 2)
- `apps/orchestrator/src/two-probe-test-guard.ts` + tests
- `apps/orchestrator/src/live-two-probe-test.ts` (always blocked until independent live PASSes exist)

Touched (additive):

- Knowledge exports + compact ore facts in `getRelevantRules`
- `PICKAXE_BLOCKS` deepslate / emerald / lapis variants (harvest fallback completeness)
- Error codes `UNSAFE_EXCAVATION`, `SEARCH_EXHAUSTED`
- Reserved username `MineProbe` / `MineProbeB`
- Planner `LLM_MAP.mine_ore` → `mineOre` (no roster miner)
- Executor `mineOre` only if the mind supplied **resource + search origin**
- Root / orchestrator scripts `mechanics:mine`, `mechanics:two-probe`
- `.env.example` comments, `THIRD_PARTY_NOTICES.md` Baritone reference

Not touched:

- BLUE `pathing.ts`, `minecraft-body.ts`, `navigation.ts`, `local-escape.ts`
- RED `world-lab/world/**`
- Farm checkpoint / Site C / H1 fixtures
- `pnpm sim:start` / five citizens

### mine-known-ore behavior

Inputs: resource, search origin/radius, Y band, amount, action/time caps, permitted chest.

1. Tool tier vs `minecraft-data` harvest. Wooden pickaxe may be crafted via existing `obtainItem`. Iron-tier tools are an explicit `MISSING_TOOL` unless already held (no recursive iron mining).
2. Travel with BLUE `navigateNear` / `navigateToInteractWithBlock` (`canDig=false`).
3. `findBlocks` is filtered: must be in bounds, **exposed** (air/cave_air/water/etc. face), **line of sight**, and a walkable standing cell within reach. Fully enclosed ore is counted as `hiddenIgnored` and never mined.
4. Safety: refuse straight down, lava-adjacent, gravel that would land on the bot, out-of-bounds.
5. Equip with mineflayer-tool, `bot.dig`, `pickupDroppedItem`, inventory delta, deposit only to the permitted chest (`ACCESS_DENIED` otherwise).
6. Stop on cancel, timeout, full inventory, hazard, failed path, or exhausted budget. Caps: radius 32, actions 48, amount 8, 120s.

`collectResource` is **not** the ore path (it would treat buried chunk blocks as targets).

### Search (separate)

`planOreSearch` returns a Y band, approach (`cave_explore` / `mountain_cliffs` / …), biome warning, and hazards. It does not return ore coordinates. Bounded 2-high cardinal tunnels are **designed** (`proposeBoundedTunnel`, max length 8) and not run as an auto-mining daemon. Infinite strip mining is refused.

## 4. Mind vs body

The **body** executes `mineKnownOre`. The **mind** must choose whether to mine, which resource, how long, and whether to keep/store/trade.

Planner does **not** assign a miner by roster (`SIM_ASSIGN_WORK_ROLES` stays false; new test asserts idle citizens do not `mineOre`).

If the LLM emits `mine_ore` without a search origin and resource, executor returns `INVALID_ARGUMENT`. Independent citizen resource selection is **UNVERIFIED**.

## 5. Tests

Unit (this pass):

- Ore bands, biome restriction, harvest tiers vs minecraft-data 1.21.x (wood vs stone vs iron; golden pickaxe is wood-tier; deepslate variants).
- Visible vs hidden; LOS through stone; reachable vs lava-floor obstructed.
- Drop name accounting; unpermitted chest `ACCESS_DENIED`.
- Straight-down / lava / gravel / OOB refusal.
- Cancel, inventory full, hostile, `SEARCH_EXHAUSTED` when only buried ore exists.
- Search planner does not mention RCON/x-ray; strip-mine refusal.

Live MineProbe: **not run**. Guard requires RED location, BLUE idle, user-approved bounds, port 25567 / RCON 25577 / 1.21.11. It will not `/setblock` ore. `SEARCH_EXHAUSTED` is **NOT FOUND**, not PASS. Coordinates are logged only after a successful dig.

## 6. WORLD-LAB

**Not used this pass.** No excavation, no chest fixture, no RCON mutation.

When approved, mutation bound = `MINE_TEST_ORIGIN` ± `MINE_TEST_RADIUS` (max 32) and the designated chest cell. Preserve:

- Site C `−1032, 888` (64 m)
- Farm pad `20, 240` (32 m)
- HomeProbe H1 `−1097, 728` (48 m)

## 7. BLUE coordination

No shared adapter change was required or made.

If a later tunnel stage needs pathfinder digging, GREEN must ask BLUE before calling `configureMovements(..., "CONTROLLED_EXCAVATION")`. Current mining digs **only** the chosen visible ore with `bot.dig`.

Do not overlap WORLD-LAB with HomeProbe. `MINE_TEST_BLUE_IDLE=true` is mandatory.

## 8. Two-bot test blockers

`pnpm mechanics:two-probe` is prepared and **blocked**. Remaining:

1. HomeProbe independent live PASS (BLUE).
2. MineProbe independent live PASS on a RED-approved natural coal/iron site.
3. RED + BLUE + user flags for concurrent WORLD-LAB use.
4. Distinct identities (`HomeProbe`, `MineProbe`), distinct chests, distinct mutation boxes.
5. Separate sqlite/body locks; no shared citizen DB; no `pnpm sim:start`.
6. Confirm BLUE is not mid-edit on `pathing.ts` / body lock.
7. Probe cleanup must not restore/fill the other bot's area.

Until those happen, two-bot is **not ready**.

## 9. 1.21.11 compatibility

- Knowledge loader already pins 1.21 family; unit tests assert `version.startsWith("1.21")` and harvestTools for the eight ores.
- Live Paper 1.21.11 mining: **not demonstrated** (harness not launched).
