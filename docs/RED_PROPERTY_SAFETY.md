# RED property safety (coding-only)

Date: 2026-09-20  
Scope: documentation, permission APIs, and automated tests. No Paper, bots, teleports, chests, blocks, time, or SQLite writes on the live or world-lab databases.

GREEN coordination: `mine.ts`, `gather.ts`, `collect.ts`, `placement.ts`, and `world.ts` now call shared furniture guards. Mining search, ore profiles, and harvest logic were not retuned.  
BLUE coordination: `pathing.ts` was **not** edited. Ordinary walking already uses `canDig=false` and `isProtectedFromPathfinder`.

## How citizens learn about places

| Kind | Genuine observation | Catalog option | TEST_CONTROL fixture |
| --- | --- | --- | --- |
| Houses / beds / doors | A bed or door in `findBlock` / nearby blocks | `WORLD_LAB_CLAIMABLE_HOMES` and `WORLD_LAB_AUDITED_FURNITURE` | None. Probe identities cannot claim |
| Personal chests | Block in world | Catalog `personalChest` until `claimHome` persists | Kai `-1042,63,980`, Atlas `-1042,63,982`, mine `-954,58,944` |
| Communal storage | Only after `settlement.storage` is a usable chest | Tannery `-1038,65,839` is the intended WORLD-LAB communal chest | Fixtures must never become `settlement.storage` |
| Fishing shores | `visibleShoresFromWorld` / `findShoreCasts`, then `rememberDiscoveredSite` | Not injected by harness | Pond chests are fixtures, not shores |
| Ore / farm sites | `rememberDiscoveredSite` after the citizen sees them | Not auto-assigned by roster | Mine chest is a fixture, not a work site |

`H1` is one catalog option. It is not Atlas's house and is not assigned by roster. Knowing a coordinate from a RED handoff is not a citizen observation.

## Ownership / access rules

| Property | Use | Break / overwrite |
| --- | --- | --- |
| Personal chest/bed of a claimed home | Owner only (`assertMayUseChest` / `assertChestAccess`) | Never |
| Household chest | Active household members only | Never |
| Designated communal (`settlement.storage` that passes `usableSettlementChest`) | Any citizen may deposit/withdraw | Never. Use is not permission to destroy |
| Unclaimed catalog house | `claimHome` when in reach. Not communal storage | Never break bed/door/chest |
| TEST_CONTROL fixture | Always `ACCESS_DENIED` | Always `ACCESS_DENIED` |
| Unknown observed chest | Not usable until designated communal | Furniture names still cannot be broken |

Discovery ≠ permission. `classifyChestKnowledge` records *how* the coordinate is known; `assertMayUseChest` / `assertMayBreakBlock` decide whether an action is allowed.

## Ordinary mine / path / place paths

| Path | Owner | Property effect |
| --- | --- | --- |
| SAFE_NAVIGATION / RESOURCE_APPROACH | BLUE | `canDig=false`. `blocksCantBreak` includes chests, beds, doors, planks, farmland |
| `CONTROLLED_EXCAVATION` | BLUE | Defined, unused in production skills |
| `evaluateExcavation` / `mineKnownOre` | GREEN | Refuses `targetName` furniture (`ACCESS_DENIED`) |
| `mineBlock` / `collectResource` | GREEN | Refuses furniture before `bot.dig` |
| `placeBlock` / `evaluateFunctionalPlacement` | GREEN | Refuses placing over furniture |
| Blueprint site clear | GREEN | Only grass/flowers/leaves |
| `executePlan` `skipBlock` | RED executor | Skips fixture + catalog furniture + claimed personal chests/beds |
| `depositItems` without a preferred chest | GREEN | Still finds the nearest chest if `skipBlock` is unset (**remaining leak**) |

## Implemented vs proposed

**Implemented**

- `packages/minecraft-knowledge/src/property.ts` — name-level furniture break/replace refusal
- `packages/agent-core/src/property-safety.ts` — knowledge vs permission, use/break/place, skip cells
- `assertChestAccess` communal no longer treats every chest as public
- Executor skip + communal deposit/withdraw permission checks
- GREEN hooks listed above (no BLUE pathing edits)

**Proposed (not wired)**

- House AABB: do not mine `oak_planks` / stairs of a building just because they are solid
- `openContainer` / `resolveContainer` should require `assertMayUseChest` even when `skipBlock` is missing
- Non-claimable H3/H6/H7/H8 chests that are not in the catalog can still be the nearest `findBlock` chest
- Newly placed player chests becoming communal vs remaining personal
- Sleeping in an unclaimed village bed without `claimHome` (seekSafety used to reuse any nearby bed; `skipBlock` now skips catalog beds during `executePlan`)

## Tests

- `packages/agent-core/src/property-safety.test.ts` — other-citizen chest, break chest for ore, unclaimed catalog, shared tannery, fixture denial, place-over
- `packages/minecraft-knowledge/src/property.test.ts` — furniture names
- `packages/skills/src/mine.test.ts` — excavation refuses a chest target
- `packages/skills/src/placement.test.ts` — place over chest
- Existing `homes.test.ts` / `workstations.test.ts` / `activity-choice.test.ts` keep claim and storage gates

## Conflicts with existing citizen behavior

- Communal `assertChestAccess` used to succeed for any non-personal chest. It now requires designated `settlement.storage`.
- `seekSafety` / unplanned `sleep` will no longer pick Site C catalog beds through `executePlan` `findBlock`.
- Planner can still emit roster `gather_wood` / `mine_stone`; those digs now bounce off furniture names but can still break unmarked house planks.
- `depositItems()` with no chest argument can still open a nearby unknown chest unless the executor `skipBlock` is installed.

WORLD-LAB fixture contents were not read, moved, or rewritten.
