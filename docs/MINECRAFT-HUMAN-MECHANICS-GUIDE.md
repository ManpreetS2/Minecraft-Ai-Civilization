# Minecraft Human Mechanics Guide

Target environment: **Paper / Minecraft Java 1.21.11**, Mineflayer body, `minecraft-data` for the bot version.

This is the mechanics contract. Cognition chooses *what*. This layer decides *whether Minecraft allows it* and *how the body must do it*.

Do not dump this document into an LLM prompt. Resolve facts first, then give cognition a short result.

## Layer

```
INTENTION
  → MECHANICS KNOWLEDGE (static: recipes, block types, tools, food)
  → PRECONDITIONS (inventory, workstation, time, reach)
  → TARGET SELECTION (score candidates; nearest is not always best)
  → VALID INTERACTION POSITION (stand beside the target, not on it)
  → PHYSICAL ACTION (Mineflayer)
  → WORLD
  → VERIFICATION (inventory/block/entity actually changed)
  → RESULT (structured ActionResult)
```

Authoritative packages:

| Layer | Package | Role |
| --- | --- | --- |
| Static + recipe planning | `@civ/minecraft-knowledge` | `MinecraftKnowledge` singleton |
| Body / path / standing cells | `@civ/minecraft-adapter` | Mineflayer + pathfinder |
| Verified skills | `@civ/skills` | obtain, craft, mine, place, doors, containers, eat, sleep |
| Planner/executor | `@civ/agent-core` | consumes knowledge; does not keep a second recipe book |
| Cognition | `@civ/cognition` | receives compact facts, not the recipe encyclopedia |

`packages/agent-core/src/recipes.ts` is a **thin wrapper** over `minecraftKnowledge()`. Do not add a second recipe dictionary.

## Coordinates

- Block targeting uses integer block coordinates.
- Movement uses continuous entity coordinates (feet).
- Do not treat the target block as the standing cell.
- Interaction standing cells are adjacent walkable cells with support and headroom (`findReachableInteractionPosition`).

## Navigation (no random mining)

Normal movement uses `MovementProfile = SAFE_NAVIGATION`:

- `canDig = false`
- `allow1by1towers = false`
- no pathfinder scaffolding
- protected blocks cannot be broken even if excavation is later enabled
- lava/fire are avoided

If the only route requires destroying terrain, pathfinder returns `PATH_BLOCKED` / no walkable path. That is **not** resource gathering.

Explicit mining is `collectResource` / `mineBlock` / a future `REMOVE_OBSTACLE` skill. Those dig one chosen block after approach, tool check, and verification.

## Body space

A valid standing cell needs:

- support below (`canStandOn`)
- feet space (`canOccupyFeet`)
- headroom (`hasHeadroom`)
- not a hazard (lava, fire, magma, cactus)

Classifications come from block `boundingBox` / `minecraft-data` where possible, not English names.

## Recipes

Two different facts:

1. **RECIPE EXISTS** — `recipeExists(item)` / `getRecipes(item)` from `minecraft-data` plus a small overlay for log→planks and `any_planks` grouping.
2. **CAN CRAFT NOW** — ingredients, counts across **all stacks**, 2x2 vs crafting table, reachable table block.

Never map "not craftable now" to `NO_RECIPE`.

| Situation | Code |
| --- | --- |
| Name not in registry | `UNKNOWN_ITEM` |
| Item exists, no recipe, not gatherable | `UNKNOWN_RECIPE` |
| Recipe exists, ingredients missing | `MISSING_INGREDIENT` |
| Intermediate craft required | `PREREQUISITE_MISSING` |
| 3x3 recipe, no reachable table | `NO_CRAFTING_TABLE` |
| Inventory did not increase after craft | `VERIFY_FAILED` |

Recursive obtain: `obtainItem(target, count)` with cycle detection and max depth 12.

Oak door from logs:

```
oak_log → oak_planks (2x2, 4 per log)
oak_planks → crafting_table if none reachable (2x2)
6 oak_planks + table → oak_door (result count 3 in 1.21.x)
```

Do not open the vanilla recipe book GUI. Use `bot.recipesFor` / `bot.recipesAll` / `bot.craft`.

Reuse a nearby real crafting table. Cached coordinates are re-checked in the world before use (`knownCraftingTable` forgets stale cells).

## Mining / placing

Mining:

1. score candidates (path cost, claims, hazards, interaction cell)
2. approach standing cell
3. equip best tool from actual inventory
4. refuse if harvest would yield nothing useful (`canHarvest`)
5. `INVENTORY_FULL` if there is no slot/stack room
6. look at block, dig, verify the block changed
7. collect drops; inventory delta is the success signal
8. if the target vanished, skip it and pick another — do not swing at air

Placing:

- item in inventory
- destination replaceable
- adjacent support
- within reach
- not inside the citizen
- verify the expected block exists
- occupying dirt is not success when the blueprint asked for planks

## Doors, gates, containers, beds

- Wooden doors and fence gates: approach, activate, verify `open` when the block exposes it.
- Iron / copper doors: cannot be opened by hand.
- Do not mine doors/gates to path through them.
- Chests/barrels: approach interaction cell, open the real window, deposit/withdraw, verify both sides, close.
- Beds: `sleepFacts` from world time. Failures: `NOT_SLEEP_TIME`, `NO_BED`, `BED_OCCUPIED`, `HOSTILE_NEARBY`.

## Inventory

Mineflayer inventory is physical truth. Database settlement counters are summaries, not carried items.

Helpers: `inventoryCount`, `listInventory`, `hasItem`, `inventorySpace`, `edibleItems`, `toolsOwned`, `buildingItems`.

Item IDs are registry names (`oak_log`, `cooked_beef`). Aliases such as `steak → cooked_beef` and `wooden_door → oak_door` live in `names.ts`.

## Claims / occupancy

Temporary TTL claims for trees, mine targets, containers, beds, construction cells. Occupancy is "I am standing here now", distinct from "I plan to use this".

## Failures and learning

Classify path failures: `PATH_BLOCKED`, `TIMEOUT`, `STUCK` (`PATH_FAILED`), `NO_INTERACTION_POSITION`, `WORLD_CHANGED`, `TARGET_UNREACHABLE`, `CANCELLED`.

Keepalive / timeout / disconnect are **infrastructure**. They must not become citizen lessons such as "I cannot gather wood".

If our parser is wrong but `recipeExists("oak_door")`, do not teach "doors cannot be crafted".

## Cognition input (example)

Bad: 8,000 recipes.

Good: "To make an oak door, 6 oak planks and a crafting table are required. You currently carry 2 oak logs and no planks. A crafting table is reachable 11 blocks away."

## Version

Load `minecraft-data(bot.version)` / `DEFAULT_MC_VERSION = 1.21.11`. If the installed dataset lacks a version, `resolveMinecraftVersion` selects the closest supported 1.21 family and the knowledge object records `knowledge.version`.
