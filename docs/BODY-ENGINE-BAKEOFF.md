# Body-engine bakeoff

Live comparison of three physical Minecraft bodies against the same Paper 1.21.11 server (`127.0.0.1:25565`, offline). Civilization brain (identity, memory, psychology, settlement, ExperienceLedger, directives, PlacementIntent, LLM cognition, dashboard) is out of scope. Atlas/Maya/Theo/Ava/Kai stayed offline.

Known-good branch at start: `integration/first-settlement-v2` @ `1a5bc0ea82f6df52fa1d7b174dc89f5c83d1c192`. This document records what actually ran, what won, and what was integrated.

## Upstream versions tested

| Project | Clone | Commit | License | Connects to Paper 1.21.11? |
| --- | --- | --- | --- | --- |
| Mindcraft | `C:\Users\sh1ft\OneDrive\Desktop\mindcraft_upstream_test` | `5f3acc87b479864124173de444f31fa5538f94a6` | MIT | Yes. Username `MindcraftProbe`. `allow_insecure_coding` was not enabled. Body skills were called directly (no purchased API, no generated-code execution). npm resolved mineflayer 4.39.0; their mineflayer 4.33.0 patch did **not** apply. Pathfinder 2.4.5 patch **did** apply. |
| Phoenix | `C:\Users\sh1ft\OneDrive\Desktop\phoenix_upstream_test` | `91618523f3eb7ea76ae1aedd659ad6e74a1ce38f` | MIT | Yes, it logs in. Username `PhoenixProbe`. Framework is not a competent 1.21.11 body. |
| MechProbe (ours) | this repo | live `pnpm --filter @civ/orchestrator mechanics` | — | Yes. Username `MechProbe`. |

Neither upstream tree was copied into the production repo.

## Live Mindcraft results (skills.js, isolated sky pad 174–190, y89–93, z134–156)

| Test | Result | Notes |
| --- | --- | --- |
| A walk 15–30 | PASS | Displacement 14.5. No unrelated breaks recorded. `goToGoal` tries a non-destructive path first (`canDig=false`), then may enable digging. |
| B oak logs | PASS | `collectBlock` + collectblock/tool. Inventory `oak_log +2` in ~14s. |
| C planks/sticks/table/wooden_pickaxe | FAIL | Planks/sticks/table were produced, then `Crafting wooden_pickaxe requires a crafting table` (table inventory/place/pickup desync). |
| D cobblestone | FAIL | Cascaded from C (no pickaxe). |
| E stone_pickaxe | FAIL | Cascaded from C. |
| F chest | PASS | `putInChest` |
| G door | PASS | `useDoor` |
| H tiny place | PASS | 3 planks placed. `getNearestFreeSpace` is **not** acceptable as civilization site policy. |

## Live Phoenix results (`createPhoenix`, same pad)

| Test | Result | Notes |
| --- | --- | --- |
| A walk 15–30 `digIfNeeded:false` | FAIL | World-absolute snapshot still showed `cherry_leaves@172,92,137` replaced with air. `NavigationSystem.setup()` sets `canDig=true` by default. |
| B `goals.obtainItem("oak_log")` | FAIL (fake PASS) | 421ms, `status=completed`, inventory delta `logs=+0`. First attempt timed out at 40s (`Task timeout` / Recovery). Completed without the item is a fake success. |
| C `crafting.craft("wooden_pickaxe")` | FAIL | `wooden_pickaxe failed` in 428ms with a nearby RCON table. `CraftingManager` uses `recipesFor(...)[0]` and dumps a table at `position.offset(1,0,0)`. |
| D `goals.obtainItem("cobblestone")` | FAIL (fake PASS) | `status` treated completed, `cobble=+0`. |
| E `goals.craftItem("stone_pickaxe")` | FAIL | Executor: `CraftingError`; recovery classified `missing_tool`. |
| Chest / door / shelter | not run | Obtain/craft already failed; do not spend hours porting Phoenix. |

Phoenix is version-compatible enough to connect. It is not a body we can wrap.

## Capability table

| CAPABILITY | OUR MECHPROBE RESULT | MINDCRAFT RESULT | PHOENIX RESULT | WINNING IMPLEMENTATION | WHY | WHAT TO INTEGRATE | WHAT TO DELETE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Navigation on uneven terrain with `canDig=false` | PASS after local-escape (1-deep pit + slab, GoalNear, no village mining) | PASS on sky pad; `goToGoal` may fall back to destructive path | FAIL: default `canDig=true`; leaf broken with `digIfNeeded:false` | **Ours** (`SAFE_NAVIGATION` + local-escape) | Phoenix mines. Mindcraft's non-destructive-then-destructive path is unsafe for a settlement. Our 0-displacement class was pits, not Mindcraft's lava/door patch. | Keep `pathing.ts` / `local-escape.ts`. Keep `canOpenDoors=true` (Mindcraft pathfinder patch idea). | Do not vendor `patches/mineflayer-pathfinder+2.4.5.patch`. Do not set global `canDig=true`. |
| Gather wood / mine stone / pickup | PASS (custom approach + dig + pickup; now tool-plugin equip) | PASS oak_log via collectblock | Fake complete with 0 items | **Ours + mineflayer-tool wrap** | Mindcraft gather works because collectblock paths with `canDig=true`. Unwrapped collectblock also `getFromChest:true` and mutates movements every `collect()`. Isolated spike mined adjacent stone in 2.6s — not a clear win, not safe for settlements. Phoenix reports success without inventory. | `equipToolForBlock` (`mineflayer-tool@1.2.0`, `requireHarvest:true`, `getFromChest:false`). | collectblock production path / extra gather engine. |
| Craft 2x2 / 3x3 (planks, sticks, table, wooden/stone pickaxe) | PASS (named recipe, `_syncWindow`, recursive obtain) | FAIL wooden_pickaxe (lost table) | FAIL wooden/stone pickaxe | **Ours** | Mindcraft and Phoenix both lose the table / pick the wrong `recipesFor()[0]`. | Keep `@civ/skills` obtain/craft. | Do not import Phoenix `CraftingManager` or Mindcraft `craftRecipe`. |
| Chest deposit/withdraw | PASS | PASS | not cleanly runnable | **Ours** | Same mechanic; ours already verifies inventory. | Keep chest skills. | Nothing. |
| Door open/walk | PASS | PASS | not run | **Ours** (already `canOpenDoors=true`) | Mindcraft patch is the door idea we already adapted. | Keep `openDoor` + pathfinder `canOpenDoors`. | Do not copy remainder of Mindcraft pathfinder patch. |
| Eat | PASS live-verified `eatFood` | not required | not run | **Ours** | User: do not replace working eating. | Keep `eatFood`. | Do not load `mineflayer-auto-eat`. |
| Sleep | PASS (`isSleeping` verify) | not run | not run | **Ours** | Already live-verified. | Keep `sleep`. | Nothing. |
| Construct approved simple shelter | MechProbe 3-plank `shelter_blueprint` wall (this bakeoff) | H PASS 3 planks via unconstrained `placeBlock` / `getNearestFreeSpace` | not run | **Ours** (semantic site + `placeBlock` with `purpose: "shelter_blueprint"`) | Mindcraft physical place works; it must not choose where/why. Phoenix has no safe blueprint executor worth wrapping. | Keep `assistProject` / `placeBlock` + our blueprint/site. | Do not adopt Mindcraft `BuildGoal` or `getNearestFreeSpace` as policy. |
| Recovery / no fake success | ActionResult codes + inventory/world verify | Task fail is explicit on craft | Fake `completed` with 0 items; concurrent goals blocked | **Ours** | Phoenix `ObtainItemGoal` completed without the item. | Keep verification wrappers. | Do not `createPhoenix` in production. |
| Version compatibility | mineflayer 4.39 / 1.21.11 | Connects; mineflayer 4.33 patch skipped | Connects; body APIs fail | **Ours** | — | Stay Paper 1.21.11 + Mineflayer + TypeScript + Ollama. | No Forge/Fabric/MineColonies/Baritone/Voyager/CurseForge. |
| Maintenance | One verified skill tree | LLM agent + patches against pinned mineflayer | Separate framework, `canDig=true`, naive craft | **Ours + mineflayer-tool** | Wrapping Phoenix/Mindcraft wholesale would duplicate a body next to citizens. | `mineflayer-tool@1.2.0`. | collectblock; Phoenix; Mindcraft runtime. |

## mineflayer-collectblock spike

Package: `mineflayer-collectblock@1.4.1` (MIT). Isolated live run:

`MECHANICS_COLLECT_BACKEND=collectblock MECHANICS_TEST_FILTER=collectblock`

- log → wooden pickaxe: PASS (3435ms) — this path is obtain/craft, not collectblock
- mine intended stone: PASS (2615ms) — plugin `collect()` on an adjacent sky-pad stone

**Not adopted.** It did not clearly beat our gather (same success class, similar time). Unwrapped `collect()` sets `canDig=true`, `dontCreateFlow=false`, `dontMineUnderFallingBlock=false`, and `mineBlock` always `getFromChest: true`. Constructor still uses `new Movements(bot, minecraft-data(version))`. Production gather is SAFE approach + `mineflayer-tool` + dig + pickup. Dependency removed after the spike.

## mineflayer-tool spike

Package: `mineflayer-tool@1.2.0`. `equipForBlock(block, { requireHarvest: true, getFromChest: false })` is the production equip path inside `collectResource`. Knowledge-layer `equipForBlock` remains the structured `MISSING_TOOL` fallback.

## Mindcraft pathfinder patch vs our PATH_FAILED / 0 displacement

Inspected `patches/mineflayer-pathfinder+2.4.5.patch`. It is **not** a fix for `canDig=false` pit walks. It adds:

- `canOpenDoors=true` and doors/gates/trapdoors as openable
- arrival radius 0.175
- lava escape / vines / trapdoor climb
- place-block sneak/jump cleanup

We already set `canOpenDoors=true` in `configureMovements`. We do **not** vendor the rest of the node_modules patch. Pit 0-displacement is handled by `local-escape.ts` without mining.

## Body Engine V1 contract

One production body stack:

```
civilization goal
  -> our policy / claims / PlacementIntent
  -> physical skill (nav / collect / craft / place / eat / sleep)
       nav: mineflayer-pathfinder SAFE_NAVIGATION (canDig=false)
       gather: mineflayer-tool equip + our approach/dig/pickup + verify
       craft: our named-recipe obtain
       build: our blueprint + placeBlock(purpose=shelter_blueprint)
  -> world/inventory verification
  -> ExperienceLedger
```

## Body Engine V1 live (MechProbe)

`pnpm --filter @civ/orchestrator mechanics` after adopting `mineflayer-tool` and keeping our craft/nav/place/eat/sleep.

19 PASS / 2 SKIP (inventory-transfer suite is `MECHANICS_TEST_FILTER=inventory`, not V1).

| Acceptance item | Result |
| --- | --- |
| Walk uneven terrain (`canDig=false`, 0 unrelated breaks) | PASS (open 15.6, uneven 9.9, long 11.0) |
| 1-block pit escape without mining | PASS (3.15) |
| Collect wood / craft planks, sticks, table, wooden pickaxe | PASS |
| Mine + collect stone | PASS |
| Craft stone pickaxe | PASS |
| Chest | PASS |
| Door | PASS |
| Eat | PASS |
| Sleep (`isSleeping`) | PASS |
| Pickup drop | PASS |
| Construct approved 3-plank `shelter_blueprint` wall | PASS (world verified oak_planks) |

**BODY ENGINE V1.** Citizens stay offline until a later reconnect.

Citizens stay offline until this stack live-passes the acceptance list on MechProbe.
