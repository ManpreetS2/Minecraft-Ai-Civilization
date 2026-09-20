# GREEN Mindcraft resource-skill reuse review

Date: 2026-09-19  
Owner: Agent GREEN  
Upstream: https://github.com/mindcraft-bots/mindcraft  
Branch inspected: **develop**  
Exact commit: **`5f3acc87b479864124173de444f31fa5538f94a6`** (2026-06-09, merge PR #787)  
License: https://github.com/mindcraft-bots/mindcraft/blob/develop/LICENSE — **MIT**, Copyright (c) 2024 Kolby Nottingham  

This is a source review. No Mindcraft bot account was installed. No Mindcraft task loop was started. `allow_insecure_coding` / `!newAction` LLM code execution stays **disabled** in this project (we do not ship that feature).

BLUE shared navigator, doors, jumping, home claims, SQLite schema, and bedtime scheduler were **not** modified.

## Files studied (upstream)

| Path | Why |
| --- | --- |
| `LICENSE` | MIT terms |
| `src/agent/library/skills.js` | collect/pickup/chest/smelt/use-tool |
| `src/agent/library/world.js` | `getNearestBlock(s)`, `getInventoryCounts`, `isClearPath` (`canDig=false`) |
| `src/agent/library/skill_library.js` | skill docs wrapper |
| `src/agent/library/lockdown.js` | cheat/lock flags |
| `src/agent/library/full_state.js` | inventory/action snapshot |
| `src/agent/commands/actions.js` | `!collectBlocks`, `!putInChest`, `!smeltItem`, `!useOn`, `!newAction` |
| `src/agent/action_manager.js` | interrupt, timeout-minutes, resume |
| `src/agent/settings.js` | runtime settings object (insecure coding is a settings flag, not default-on here) |
| `src/utils/mcdata.js` | `getInventory`-adjacent helpers, `getSmeltingFuel`, `getFuelSmeltOutput`, **loads collectblock plugin** |

There is **no** dedicated `fish` / `fishing` skill in `skills.js` or `actions.js`. Closest hook is `useToolOn` → `bot.activateItem()` with no bobber wait and no catch inventory check.

## Comparison with GREEN / `@civ/skills`

### Mining / ore selection — do not adapt collectBlock

Mindcraft `collectBlock`:

- Aliases `coal` → `coal_ore` and `*_ore` → `deepslate_*`.
- Uses `bot.tool.equipForBlock` then **`bot.collectBlock.collect(block)`**.
- Sets pathfinder `dontMineUnderFallingBlock = false`.
- 64-block search, `safeToBreak` optional bypass for obsidian.

GREEN already has safer ore selection in `packages/skills/src/mine.ts`: exposed face + line of sight + reachable stand + radius/Y clamp + `UNSAFE_EXCAVATION` (no underfoot, no lava). Travel uses BLUE `navigationBackend()` with `NORMAL_NAVIGATION_CAN_DIG=false`. **Do not load mineflayer-collectblock.** Live coal PASS recorded in `docs/GREEN_MINING_LIVE_RUN.md`.

### Item pickup — keep existing skill

Mindcraft `pickupNearbyItems`: `canDig = false`, `GoalFollow` item entities, 8-block radius.

GREEN already has `pickupDroppedItem` (`packages/skills/src/inventory-service.ts`) walking via BLUE `moveTo` / SAFE nav and verifying inventory delta. **No duplicate pickup implementation.**

### Chests — designated cell, not nearest

Mindcraft `putInChest` / `takeFromChest` / `viewChest` always use **nearest chest within 32**. That would steal Site C / H1 / tannery.

GREEN mining already requires `destinationStorage` == `permittedStorage` (`assertPermittedStorage`). Fishing reuses that. Live coal went to **-954,58,944** only.

### Inventory quantity

Mindcraft `world.getInventoryCounts` sums every slot by name (includes armor). GREEN `countItem` / reservations already account storage-range stacks. No copy needed. Fishing catch verification uses named deltas (`cod` / junk / treasure).

### Smelting / fuel — vanilla table only

Mindcraft `smeltItem` + `getFuelSmeltOutput` computes `ceil(num / smeltsPerFuel)` and pulls leftover input/fuel. It also **places and later breaks furnaces** via collectBlock.

GREEN `packages/skills/src/furnace.ts` already opens an existing furnace through BLUE nav. This pass added **vanilla** `smeltsPerFuelUnit` / `fuelUnitsNeeded` and leftover take-input/take-fuel. Values match the game (coal=8, planks=1.5, …), not a pasted Mindcraft function.

### Fishing — implemented here, not copied

Upstream has no catch loop. GREEN added `packages/skills/src/fish.ts`:

- Shore-only (refuse standing in water/lava)
- Require `fishing_rod` in inventory (no auto-craft expedition)
- BLUE `navigateNear` to the stand
- Mineflayer `activateItem` cast/reel, bobber + splash wait
- Existing `pickupDroppedItem` + optional designated chest
- `ctx.signal` cancel + BLUE `evaluateReturnHome` before/between casts
- Executor `fishShore` only with a citizen-chosen shore origin; **no fisher occupation**

No FishProbe live run (RED fishing site and BLUE home/return live stability still outstanding).

### Cancellation / time budgets / return-home

Mindcraft `ActionManager`: interrupt_code polling, timeouts in **minutes**, `!stop`, infinite-loop kill, `!newAction` LLM codegen behind `allow_insecure_coding`.

GREEN skills already use `AbortSignal`, ms budgets, and `evaluateReturnHome` (BLUE `travel-home.ts`). Wired `returnHome` from `resolveHomeSleepTarget` into `mineOre` and `fishShore` in GREEN-owned `executor.ts` without editing homes/SQLite/bedtime.

**Keep insecure LLM-code-execution disabled.** Do not port `!newAction` / `coder.generateCode`.

## What was not reused

- collectblock plugin, `canDig` mining travel, furnace place-and-break
- nearest-chest semantics
- cheat `/setblock` in `breakBlockAt` / `placeBlock`
- Mindcraft pathfinder `goToGoal` (BLUE navigator stays the only mover)
- Self-prompter / `!goal` task loop
- Position-packet throttle from `mcdata.js` (adapter concern, not GREEN skills)

## License compliance

**No Mindcraft source was copied or substantially adapted into the repo.** Fishing, ore visibility, and fuel math are original GREEN code plus vanilla game facts and existing Mineflayer APIs.

Therefore MIT's "include the copyright and permission notice in all copies or substantial portions" **does not currently attach** to a GREEN file. If a later change pastes Mindcraft functions, add the notice beside those files **and** a Third-Party Credits README line.

### README coordination (not applied this pass)

BLUE also owns README edits. GREEN did **not** edit `README.md` to avoid a conflicting simultaneous credit block.

Proposed single README section for BLUE to merge when ready:

```
## Third-Party Credits

Mindcraft (https://github.com/mindcraft-bots/mindcraft) is MIT-licensed,
Copyright (c) 2024 Kolby Nottingham. This repository reviewed develop
commit 5f3acc87b479864124173de444f31fa5538f94a6 as a reference for
resource-handling patterns. No Mindcraft source is currently vendored.
Insecure LLM code-execution (`allow_insecure_coding` / !newAction) is not enabled.
```

A README line alone would still be insufficient if code is later copied; keep the license text with any copied files.

## Code changes this pass (GREEN-owned)

| File | Change |
| --- | --- |
| `packages/skills/src/fish.ts` | New bounded shore fishing skill |
| `packages/skills/src/fish.test.ts` | Unit tests |
| `packages/skills/src/furnace.ts` | Fuel-unit math + leftover input/fuel take |
| `packages/skills/src/furnace.test.ts` | Unit tests |
| `packages/skills/src/index.ts` | Exports |
| `packages/agent-core/src/executor.ts` | `fishShore`; pass claimed bed into mine/fish as `returnHome` |

Not modified: BLUE navigator, doors, jump, homes schema, bedtime, README.
