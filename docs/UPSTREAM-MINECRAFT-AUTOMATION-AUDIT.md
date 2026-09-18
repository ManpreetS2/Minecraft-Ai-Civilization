# Upstream Minecraft automation audit

Classification of custom Minecraft runtime subsystems versus mature libraries.

Decisions:

- **KEEP** — civilization-specific logic that is stronger than a generic bot library
- **WRAP** — mature library handles generic mechanics; our claims, verification, and events surround it
- **REPLACE** — custom code unnecessarily duplicates a mature library
- **DELETE** — obsolete or duplicate code

This project stays on **Paper 1.21.11** with Mineflayer bodies. Do not move to Forge/Fabric. Do not enable arbitrary LLM-generated code execution.

## Subsystems

### Navigation / pathfinding

| | |
| --- | --- |
| Current implementation | `MineflayerPathfinderBackend` in `@civ/minecraft-adapter`. Movement profiles: `SAFE_NAVIGATION`, `RESOURCE_APPROACH`, `CONTROLLED_EXCAVATION`. Normal navigation `canDig=false`. Interaction path: ranked standing cells → `GoalNear` → `GoalLookAtBlock` → `GoalGetToBlock`, then y±1 recovery / temporary blacklist. |
| Upstream equivalent | [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) (MIT). Optional experimental Baritone adapter. |
| Decision | **WRAP** pathfinder. **KEEP** profiles, protected-block lists, occupancy, interaction standing cells, recovery/blacklist. |
| Reason | Pathfinder is the navigation backend. Digging during ordinary walks is a civilization bug, not a library default we want. |
| License | MIT |
| Integration risks | Pathfinder `canDig=true` silently mines terrain. We force it off except controlled excavation. Never restore random mining to unstick a citizen. |

### Interaction standing cells

| | |
| --- | --- |
| Current implementation | `interactionCandidates` / `findReachableInteractionPosition` — target block ≠ standing cell. |
| Upstream equivalent | Mindcraft nearest-block + path-to; Phoenix NavigationSystem. |
| Decision | **KEEP** |
| Reason | Civilization occupancy, claims, and hazards are not in generic path-to-block helpers. |
| License | n/a (ours) |
| Integration risks | Empty chunks make `blockAt` null; we treat that as unreachable, not stand-inside-the-log. |

### Mining / collection

| | |
| --- | --- |
| Current implementation | `collectResource` + `equipForBlock` + world verify + `TargetBlacklist`. |
| Upstream equivalent | [mineflayer-collectblock](https://github.com/PrismarineJS/mineflayer-collectblock) (MIT) + [mineflayer-tool](https://github.com/PrismarineJS/mineflayer-tool) (MIT). |
| Decision | **WRAP** pattern, **KEEP** our skill. Do **not** load collectblock as a plugin that owns the queue. |
| Reason | Collectblock’s path → tool → dig → pickup sequence is correct. Loading it as a plugin bypasses claims, protected blocks, cancellation, ExperienceLedger, and structured events. |
| License | MIT (evaluated, not loaded) |
| Integration risks | Plugin-owned collect queues ignore settlement reservations and can mine village structures. |

### Tool selection

| | |
| --- | --- |
| Current implementation | `@civ/skills` `equipForBlock` using `minecraft-knowledge` harvest tables. |
| Upstream equivalent | mineflayer-tool |
| Decision | **KEEP** local ranking; **WRAP** conceptually (same ranking rules). |
| Reason | Missing-tool failures must stay `MISSING_TOOL` ActionResults. |
| License | MIT pattern |
| Integration risks | Plugin equip can succeed without our verifier noticing a wrong tool. |

### Eating

| | |
| --- | --- |
| Current implementation | `eatFood` — physical consume + hunger/food delta verify. Planner decides WHEN. |
| Upstream equivalent | [mineflayer-auto-eat](https://github.com/PrismarineJS/mineflayer-auto-eat) (MIT) |
| Decision | **KEEP** planner timing. **WRAP** later only for food-item selection if auto-eat is isolated behind `eatFood`. |
| Reason | Auto-eat must not fire during flee, sleep, or construction. |
| License | MIT |
| Integration risks | Plugin auto-eat can consume village food stores without a plan. |

### Recipes / items / blocks

| | |
| --- | --- |
| Current implementation | `@civ/minecraft-knowledge` over installed `minecraft-data` 1.21.11. `agent-core/recipes.ts` is a thin wrapper. |
| Upstream equivalent | [minecraft-data](https://github.com/PrismarineJS/minecraft-data) (MIT), [prismarine-recipe](https://github.com/PrismarineJS/prismarine-recipe), [prismarine-block](https://github.com/PrismarineJS/prismarine-block) |
| Decision | **WRAP** minecraft-data / prismarine-block facts. **DELETE** competing recipe dictionaries (agent-core no longer has its own list). |
| Reason | Recipe existence ≠ craftable now. One authoritative parser for shaped/shapeless/alternates/output counts/2x2 vs 3x3. |
| License | MIT |
| Integration risks | 1.21.11 recipe cells are `number \| null`; older dumps use `{id}` / arrays. Parser must accept all three. |

### Crafting execution

| | |
| --- | --- |
| Current implementation | `craftItem` uses `recipesAll(..., true)` for existence, `recipesFor` with a real crafting-table `Block` for craftability, then `bot.craft`. `patchMineflayerCrafting` bounds 1.21.x `updateSlot` hangs. |
| Upstream equivalent | Mineflayer `lib/plugins/craft.js`; Mindcraft craft-recipe skill; Phoenix CraftingManager |
| Decision | **WRAP** Mineflayer craft. **KEEP** obtain-item recursion, table reuse, and verification. |
| Reason | The 3x3 GUI on 1.21.11 is still fragile (`windowOpen` / `updateSlot:0`). That is a Mineflayer protocol issue, not an LLM recipe issue. |
| License | MIT |
| Integration risks | Opening a table by activating the top face can miss LOS. Craft may time out even when the recipe is valid. |

### Recursive obtain-item

| | |
| --- | --- |
| Current implementation | `obtainItem(item, count)` with depth 12, cycle stack, gather vs craft vs ensure table. |
| Upstream equivalent | Phoenix `obtainItem` / TaskTree; Mindcraft collect+craft loops |
| Decision | **KEEP** (civilization wrapper). Phoenix/Mindcraft are **reference only** (no AGPL copy; Phoenix not vendored). |
| Reason | Need structured codes: `UNKNOWN_ITEM`, `UNKNOWN_RECIPE`, `MISSING_INGREDIENTS`, `NEED_WORKSTATION`, `CRAFT_FAILED`, `VERIFY_FAILED`. |
| License | Ours; Phoenix/Mindcraft not copied into this tree |
| Integration risks | Nested plank counts must request `already + crafts * output` or the chain skips. |

### Functional block placement

| | |
| --- | --- |
| Current implementation | `PlacementIntent` + `evaluateFunctionalPlacement`. Beds/doors/tables/chests/furnaces cannot be dumped because they are in inventory. |
| Upstream equivalent | None adequate. Generic `placeBlock` only checks physics. |
| Decision | **KEEP** |
| Reason | Mechanically valid ≠ sensible. `FunctionalBlockPlacedWithoutPurpose` is a system incident, not citizen learning. |
| License | n/a |
| Integration risks | Temporary worksite tables are allowed with explicit intent and must be tracked for cleanup. |

### Shelter / village reuse

| | |
| --- | --- |
| Current implementation | `seekSafety` now tries known project interiors **and** discovered village/human beds with roof (KNOWN / REACHABLE / USABLE / CURRENTLY_SAFE). |
| Upstream equivalent | Phoenix WorldModel; Mindcraft NPC houses |
| Decision | **KEEP** |
| Reason | World is authoritative. Structures need not originate in our database. |
| License | n/a |
| Integration risks | A bed without a roof is not shelter. Near stored origin is not enough. |

### World verification / ExperienceLedger

| | |
| --- | --- |
| Current implementation | ActionResult verify + ledger `citizenLearns=false` for infrastructure/system codes including `PURPOSELESS_PLACEMENT`. |
| Upstream equivalent | Phoenix RecoverySystem (reference) |
| Decision | **KEEP** |
| Reason | Memory/psychology must not learn mechanics bugs. |
| License | n/a |
| Integration risks | Fake success is worse than a classified failure. |

## Reference-only (not adopted)

| Project | Why reference only |
| --- | --- |
| [MINDcraft](https://github.com/mindcraft-bots/mindcraft) | MIT skill patterns studied. We do **not** import unconstrained LLM code execution. |
| [Phoenix](https://github.com/CybersharpX/Phoenix) | WorldModel / TaskTree / obtainItem / recovery studied. Not vendored. |
| MineMind / AltoClef | Reference only. |
| nuxdie/baritone-ts | **AGPL-3.0 — not copied.** |

## Actually adopted this pass

- mineflayer-pathfinder (already wrapped; `canDig=false` for normal nav)
- minecraft-data 1.21.11 (authoritative recipes)
- prismarine-block harvest facts via minecraft-knowledge
- Mineflayer `craft` / `dig` / `placeBlock` / `activateBlock`
- mineflayer-collectblock / mineflayer-tool / mineflayer-auto-eat: **pattern WRAP, packages not loaded**

## Custom code removed or redirected

- Duplicate recipe dictionary in `agent-core` → thin wrapper over `@civ/minecraft-knowledge`
- `placeWorkstation` feet+1 dump → semantic `PlacementIntent`
- Pathfinder digging during ordinary walks → `SAFE_NAVIGATION` `canDig=false`
- `NO_RECIPE` when ingredients were merely missing → `MISSING_INGREDIENT` / `NEED_WORKSTATION` / `UNKNOWN_RECIPE` only when no recipe exists
