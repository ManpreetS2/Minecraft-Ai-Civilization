# Live mechanics test

Do **not** reset the world. Use the TEST-ONLY mechanics probe (`MechProbe`) against the running Paper 1.21.11 server.

MechProbe is **not** a citizen. It must never enter cognition, relationships, settlement population, or citizen memories.

## Identity

| | |
| --- | --- |
| Username | `MechProbe` (`MECHANICS_PROBE_USERNAME`) |
| Source file | `apps/orchestrator/src/live-mechanics-test.ts` |
| Command | `pnpm --filter @civ/orchestrator mechanics` |
| Purpose | Disposable crash-test dummy for physical Minecraft mechanics |
| Default flags | `MECHANICS_PROBE_ENABLED=false`, `MECHANICS_PROBE_KEEP_ALIVE=false` |
| Disconnect | Disconnects after the suite unless `MECHANICS_PROBE_KEEP_ALIVE=true` |
| World mutation | Yes (give/setblock via RCON, obtain/mine/place/eat). Prefer this over Atlas/Maya/Theo/Ava/Kai |
| Persistence | Block/item changes persist in the live world. Probe is not stored as a citizen |

`pnpm sim:start` does **not** spawn MechProbe. Reserved names (`MechProbe`, `CivPathProbe`) are filtered out of `DEFAULT_CITIZENS`.

When `MECHANICS_PROBE_KEEP_ALIVE=true`, the probe stays connected, logs the active test, idles, and does not run citizen tasks so a human can watch it in-game.

## Command

```
pnpm --filter @civ/orchestrator mechanics
```

Requires Paper reachable at `MINECRAFT_HOST:MINECRAFT_PORT`. Does not start settlement citizens.

```
MECHANICS_PROBE_KEEP_ALIVE=true pnpm --filter @civ/orchestrator mechanics
```

## Sequence

1. Walk 15–25 blocks on ordinary terrain. Snapshot solids. **PASS** if unrelated blocks were not replaced with air.
2. Reject open-field bed / freestanding door / purposeless crafting table (semantic placement).
3. Provision fixtures via RCON (stone, table, chest, door, bed). Reuse the existing table.
4. Confirm standing cell ≠ target stone block.
5. Open a wooden door and walk through.
6. Inspect inventory (Mineflayer is source of truth).
7. log → planks → sticks → table → wooden pickaxe via `obtainItem`.
8. Mine the intended stone only; collect cobblestone.
9. Craft a stone pickaxe.
10. Logs → oak door (must not report `NO_RECIPE` / `UNKNOWN_RECIPE` if data has the recipe). Open-terrain door place must fail; doorway place only with `purpose: "doorway"`.
11. Chest deposit/withdraw. New chest only with `household_storage` and interior context.
12. Eat if hunger < 20 and food is held (food decreases, hunger increases).
13. Sleep only if valid sleep time and a bed is reachable.
14. Pickup a dropped item (inventory delta).

Each step records PASS / FAIL / SKIP with the ActionResult code. SKIP means the world did not contain the fixture. FAIL is a mechanics bug.

Never mark LIVE VERIFIED from a unit test.

## Regression cases

| Bug | Expected |
| --- | --- |
| Kai `NO_RECIPE oak_door` | `recipeExists("oak_door")`; obtain chain from logs |
| Missing ingredients | `MISSING_INGREDIENT` / `NEED_WORKSTATION`, not `UNKNOWN_RECIPE` |
| Navigation breaking dirt/stone | `SAFE_NAVIGATION` `canDig=false` |
| Same vanished log retried | `TARGET_GONE` / `TARGET_CHANGED`; blacklist |
| Beds in open field | `PURPOSELESS_PLACEMENT`; not citizen learning |
| Freestanding door | rejected unless a real doorway |
| Table dumped on a path | rejected; reuse existing table |
| Standing inside the target block | interaction cell is adjacent and walkable |
| Seek shelter near origin | village/human bed or interior standing cell, currently safe |

## Live Paper results

Run: `pnpm --filter @civ/orchestrator mechanics` on 2026-09-17 against Paper 1.21.11 at 127.0.0.1:25565. Probe `MechProbe`. RCON connected. Dashboard/sim not running. World was **not** reset.

Spawn `229.7 65.0 195.7`. Several RCON `setblock` calls returned "Could not set the block" (cells occupied). An existing crafting table at `227,65,195` was reused.

```
- PASS walk 15-25 blocks without mining (21993ms)
      no unrelated solids became air; pathfinder reported PATH_FAILED/stuck and displacement was 0
- PASS reject open-field bed/door/table without valid context
- PASS reuse existing crafting table instead of dumping another
- PASS standing cell differs from target stone block
- PASS open wooden door
- PASS inspect inventory
- FAIL log -> planks -> sticks -> table -> wooden pickaxe
      PREREQUISITE_MISSING Need to craft oak planks before wooden pickaxe
- SKIP mine intended stone and collect cobble
      no pickaxe
- FAIL craft stone pickaxe
      VERIFY_FAILED inventory count did not increase (3x3 GUI / updateSlot still unreliable)
- PASS logs -> oak_door (no NO_RECIPE)
      oak_door obtained; open-terrain door place blocked as PURPOSELESS_PLACEMENT;
      RCON doorway walls were not enough for isDoorwayOpening (still PURPOSELESS_PLACEMENT)
- PASS chest deposit/withdraw
- PASS eat if hungry
- FAIL sleep if valid time
      SLEEP_FAILED bot is not sleeping (bed fixture setblock failed)
- PASS pickup nearby drop if present
```

**Not LIVE VERIFIED overall.** Citizens are not mechanically competent yet.

Known live blockers:

1. 3x3 crafting table window (`stone_pickaxe` inventory delta) still fails on 1.21.11 even when `oak_door` succeeded in this run.
2. `obtainItem(wooden_pickaxe)` still surfaced `PREREQUISITE_MISSING` instead of finishing the plank step (recovery tightened after this run; not re-verified live).
3. Normal navigation `canDig=false` did not break terrain, but also failed to walk (`PATH_FAILED` stuck).
4. Freestanding door rejection works; placing into a real doorway still needs a verified two-block wall opening.

Do not mark LIVE PAPER VERIFIED in the capability matrix from unit tests.
