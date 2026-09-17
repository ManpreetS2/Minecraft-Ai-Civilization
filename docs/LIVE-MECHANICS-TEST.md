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

Latest green run: `pnpm --filter @civ/orchestrator mechanics` on 2026-09-17 against Paper 1.21.11 at 127.0.0.1:25565. Probe `MechProbe`. RCON connected. World was **not** reset. Exit code 0.

Spawn `223.7 61.0 184.3` (hole / tight pad). `NORMAL_NAVIGATION_CAN_DIG=false`. `oak_door recipe exists: true` (minecraft-data 1.21.11).

```
- PASS walk 15-25 blocks without mining (73186ms)
      no unrelated solids became air; this spawn was stuck (0.0 blocks, PATH_FAILED)
- PASS reject open-field bed/door/table without valid context
- PASS reuse existing crafting table instead of dumping another
- PASS standing cell differs from target stone block
- PASS open wooden door
- PASS inspect inventory
- PASS log -> planks -> sticks -> table -> wooden pickaxe (14566ms)
- PASS mine intended stone and collect cobble (38699ms)
- PASS craft stone pickaxe (12053ms)
- PASS logs -> oak_door (no NO_RECIPE) (13031ms)
- PASS chest deposit/withdraw (22752ms)
- PASS eat if hungry (9597ms)
- SKIP sleep if valid time (1509ms) SKIP NO_INTERACTION_POSITION
- PASS pickup nearby drop if present (885ms)
```

Same-day supporting runs (same Paper world, not reset):

- Walk 14.1 blocks with solids broken=0 (better spawn at `229.5 65.0 195.5`).
- Sleep PASS (2549ms) when a reachable bed existed.
- Wooden pickaxe originally failed `PREREQUISITE_MISSING` / cherry_planks-first recipes; fixed then re-verified PASS.
- Stone pickaxe originally hung on Mineflayer `_syncWindow` / `updateSlot:0`; bounded sync then re-verified PASS.

**Not a claim of general “Minecraft capable.”** These are specific verified actions on one probe body.

Remaining live gaps:

1. Hole/tight-pad navigation: `canDig=false` correctly refuses to mine out, so walk distance can be 0.
2. Sleep needs a reachable standing cell beside the bed; SKIP is not a PASS.
3. Freestanding door rejection works; placing into a constructed doorway still often returns `PURPOSELESS_PLACEMENT`.
4. Fence gates, furnace, attack/flee, swim, climb were not live-tested in this suite.

Do not mark LIVE PAPER VERIFIED from unit tests alone.
