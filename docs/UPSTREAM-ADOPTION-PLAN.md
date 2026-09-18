# Upstream Minecraft automation — adoption plan

For `integration/first-settlement-v2`. Source research branch: `research/upstream-minecraft-automation`. **Do not merge that branch as a runtime change.** Do not install libraries just because they exist.

## Live baseline

The wooden_pickaxe plank miss and stone_pickaxe VERIFY_FAILED were introduced on **`94aeff7`** and already fixed on **`2f2e176`** (named-recipe scoring, recursive `obtainItem`, bound `_syncWindow`). Remaining live holes: pit **PATH_FAILED** with `canDig=false` (fail without mining), sleep standing cell, doorway **geometry** (policy rejects purposeless doors; live fixture now waits for a two-high wall + approach floor).

## Install decisions

| Package | Decision | When to revisit |
| --- | --- | --- |
| `mineflayer-collectblock` | **Do not install as a plugin.** Optional later: copy `GoalLookAtBlock` usage into our adapter (MIT). | If we still write a second miner after wrapping LookAt. |
| `mineflayer-tool` | **Do not install.** Use prismarine-block `digTime`/`canHarvest` via `@civ/minecraft-knowledge`. | If harvest tables drift from 1.21.11 data. |
| `mineflayer-auto-eat` (linkle69, MIT, 5.0.3, ESM) | **Do not install.** `eatFood` is live-verified. | If we need offhand/timeout events only. Never `enableAuto()`. |
| `mineflayer-statemachine` | **Do not convert orchestrator.** | Never as the citizen planner. |
| `mineflayer-pvp` | **Later.** MIT. Never overrides creeper flee. | After flee is live-tested. |
| Minecraft MCP servers | **No.** MechProbe CLI is enough. | Never as citizen control. |
| Mindcraft | **Reference / physical action ideas only.** MIT. Do not copy LLM `eval` of generated JS. | Never as skill source. |
| Phoenix (CybersharpX, MIT) | **Patterns only:** stuck class, missing-ingredient list, task timeout. Do not `createPhoenix`. Do not dump tables at feet. | Recovery classification only. |
| MineColonies / Fabric / Forge / minemind | **Do not install.** | Never. |

One physical path per capability. After any wrap, delete or redirect the duplicate custom miner/eater.

## Ranked work for Cursor 1

### 1. Keep 3x3 semantics (no new dependency)

See `docs/CRAFTING-3X3-UPSTREAM-RESEARCH.md`.

- Named recipe filter + recursive obtain (**already landed**).
- Bound `_syncWindow` only (**already landed**).
- Inventory-delta verify; timeout ≠ fail if count rose.
- Re-run MechProbe wooden_pickaxe + stone_pickaxe after any mineflayer bump.

### 2. Keep recursive obtain (no Phoenix import)

Phoenix `CraftingManager` still uses `recipesFor(...)[0]` and naive table dump. Ours is stricter. Optional: batch leftover accounting like Mindcraft `calculateLimitingResource` **inside** `obtainItem` if we start over-crafting sticks.

### 3. Safe navigation recovery

See `docs/SAFE-NAVIGATION-UPSTREAM-RESEARCH.md`.

- Interaction: ranked standing cells, then `GoalLookAtBlock` / `GoalGetToBlock`.
- Hole recovery: y±1 candidates, larger `GoalNear`.
- Watchdog + cell blacklist.
- `canDig` remains false except `CONTROLLED_EXCAVATION`.

### 4. Do not wrap collectblock as a plugin

If Cursor 1 wants less custom dig glue: take **only** LookAt + tool-equip sequence, still through claims, protected blocks, verification, ExperienceLedger.

### 5. Do not wrap mineflayer-tool as a plugin

Optional: `block.digTime(heldItem)` in knowledge instead of a handwritten mill-time table **if** tests prove 1.21.11 parity.

### 6. Keep `eatFood`

Personal hunger vs settlement food stays ours.

### 7. Workstations / containers

Keep chest deposit/withdraw (live PASS). Furnace/smelt is **not** live; Phoenix SmeltingManager is MIT but also naive. Implement furnace **after** 3x3 stays green, using our workstation registry (not dump-furnace-on-dirt).

### 8. Task recovery patterns

Port **ideas** from Phoenix RecoverySystem / AltoClef (unreachable, retry, replan, abort). Do not replace `@civ/agent-core` planner.

### 9. Combat helpers later

Creeper flee stays deterministic.

### 10. MCP

Skip. See `docs/MECHPROBE-UPSTREAM-INTEGRATION.md`.

## Placement (do not adopt upstream)

Mindcraft `getNearestFreeSpace` and Phoenix `entity.position.offset(1,0,0)` are **illegal** as citizen policy.

Keep `evaluateFunctionalPlacement`. Next geometry work:

- Door: two-block opening in a **wall**, not “nearby building blocks”.
- Bed: interior with roof (already).
- Table: registered worksite or explicit temporary workstation.
- Chest/furnace: storage/worksite context.

Physical `placeBlock` may look like Mindcraft’s place helper; **site choice** stays ours.

## Tests required for any adoption

| Change | Unit | Integration | Live Paper |
| --- | --- | --- | --- |
| Craft | recipe scoring + oak_door exists | obtain plan next=planks | MechProbe wooden + stone pickaxe |
| Nav | canDig false | recoveryAttempts includes y offset | walk displaces, no air holes |
| Mine | protected names | collect skips nav if in reach | mine stone, drop pickup |
| Place | door PURPOSELESS without opening | — | fixture wall + opening |

## What must stay ours

PlacementIntent, settlement sites, protected structures, claims, preemption, human directives, verification, ExperienceLedger, identity, memory, psychology, relationships, civilization behavior.

## Custom code to remove later (only after replacement is live)

- Duplicate mill-time tables **if** prismarine-block is wired and tested.
- Any leftover “pattern wrap” comments that imply collectblock is loaded (it is not).

## Custom code that stays

`obtainItem`, `craftItem`, `eatFood`, `evaluateFunctionalPlacement`, `SAFE_NAVIGATION`, MechProbe isolation, knowledge as minecraft-data façade.
