# RED → GREEN mining-test handoff (world-lab)

Date: 2026-09-19  
RED: natural-ore site, bounds, and exclusive-access note. **MineProbe was not launched.** This is **not** a live mining PASS.

## Task 08 — chest approval (2026-09-19 evening)

**User chest approval: GIVEN.** Explicit approval to place one empty ordinary single `minecraft:chest` at **-954, 58, 944**.

| Item | Status |
| --- | --- |
| Pre-read | air, air at Y+1, stone at Y−1; no adjacent chest |
| Command | `setblock -954 58 944 minecraft:chest[facing=east] keep` |
| Installed BLOCK | **-954, 58, 944** |
| State | `chest[facing=east,type=single]`, NBT `Items: []`, no Lock/loot table |
| Origin stand `-953,58,945` | still air / air (reachable diagonal to the chest) |
| Visible coal sample | still `coal_ore` (not edited) |
| GREEN/BLUE live harness | none at install; `list` was Shadowskiii1 only |
| MineProbe | **not started** |

GREEN may run `mechanics:mine` with `MINE_TEST_CHEST=-954,58,944`. Do **not** set `MINE_TEST_PLACE_CHEST=true` (chest already exists).

Harness (do not guess): `apps/orchestrator/src/live-mine-test.ts` via `pnpm mechanics:mine`, guards in `apps/orchestrator/src/mine-test-guard.ts`.

## Coordination

| Check | Result |
| --- | --- |
| BLUE HomeProbe | **Finished and disconnected.** `docs/BLUE_HOME_LIVE_TEST_RUN.log` ended with mixed PASS/FAIL (exit 1: one-block-rise FAIL, H1 sleep FAIL; navigation/storage/reconnect PASS). No `HomeProbe` on `list`. |
| `MINE_TEST_BLUE_IDLE` | GREEN may set **true** (bot exclusive window released). |
| WORLD-LAB | Paper **1.21.11-132** still listening **25567** / RCON **25577**. Player **Shadowskiii1** was online at the village during this scout. |
| Live civ **25565** / Mindcraft **25566** | Not used |
| `pnpm sim:start` / MineProbe | Not started |
| Site C five personal chests | Still present (H1 now contains HomeProbe **paper**; not empty) |
| Tannery **-1038, 65, 839** | Unchanged (`bread` + `leather_helmet`) |
| Farm pad **20,68,240** | grass_block / air above; no leftover water/chest |
| User lighting / buildings | Not edited this pass |
| RED leftover forceload | **0** |

Do not overlap this test with another `mechanics:home` / `mechanics:farm` run (`evaluateMineTestLaunch` refuses those flags).

## GREEN harness semantics (from code, not guessed)

Teleport: `tp MineProbe {origin.x+0.5} {origin.y} {origin.z+0.5}` then `mineKnownOre` with `searchOrigin=origin`, `searchRadius`, optional `minY`/`maxY`, `destinationStorage=chest`, `permittedStorage=chest`.

| Env | Meaning |
| --- | --- |
| `MINE_TEST_ORIGIN=x,y,z` | **Standing cell** (feet Y). Not the ore block. |
| `MINE_TEST_CHEST=x,y,z` | Deposit **block** cell. Must already be a chest/barrel/trapped_chest, **or** `MINE_TEST_PLACE_CHEST=true` (TEST_CONTROL `setblock chest`). |
| `MINE_TEST_RADIUS` | Integer **1–32**, XZ hypot from origin. Mutation bound = origin ± radius **and** the chest cell. |
| `MINE_TEST_RESOURCE` | `coal` (wooden pickaxe given) or `iron` (stone pickaxe given) |
| `MINE_TEST_MIN_Y` / `MINE_TEST_MAX_Y` | Optional Y clamp |
| `MINE_TEST_USERNAME` | `MineProbe` only |
| Port / RCON / version | **25567** / **25577** / **1.21.11** |
| `AUTO_START_PAPER` | Forced **false** |

Guard **refuses** origin or chest within **64 m** of Site C `(-1032, 888)`, **32 m** of farm `(20, 240)`, **48 m** of H1 `(-1097, 728)`. Never 25565/25566. Never `/setblock` ore. `SEARCH_EXHAUSTED` is **NOT FOUND**, not PASS. Ore coordinates are logged **only after** a successful dig.

Harness TEST_CONTROL (finite, logged): `op`, `tp`, `clear MineProbe`, `give` **one** `wooden_pickaxe` (coal) or `stone_pickaxe` (iron). Not citizen starter loot.

The probe must observe ore with Mineflayer `findBlocks` + exposed + LOS + reachable stand. Do **not** put the ground-truth ore cell into `MINE_TEST_ORIGIN`, citizen memory, or planner inputs.

## Approved standing origin

**Dimension:** `minecraft:overworld`  
**`MINE_TEST_ORIGIN=-953,58,945`**  
**`MINE_TEST_RESOURCE=coal`**  
**`MINE_TEST_RADIUS=8`**  
**`MINE_TEST_MIN_Y=56`**  
**`MINE_TEST_MAX_Y=62`**

Verified: feet **air**, head **air**, floor **stone** at `-953,57,945`. XZ distances: Site C **97.4 m**, H1 **~260 m**, farm **~1294 m**.

A 2-high cave pocket opens west/north of that stand (`-954/-955, 58–59, 943–945` air). No lava, water, or gravel in a 4-block radius of the stand (RCON).

## RED ground-truth (fixture verification only — do not feed to MineProbe)

Natural `minecraft:coal_ore` is **exposed** immediately east of the origin:

| Cell | Block | Exposure |
| --- | --- | --- |
| **-952, 58, 945** | `coal_ore` | west face **air** (the origin cell) |
| -952, 58, 946 | `coal_ore` | in the same pocket |
| -953, 58, 946 | `coal_ore` | in the same pocket |

From origin the bot’s eyes are in the air cell whose east neighbor is coal. Amount **1** is enough. Additional coal exists in the hillside alcove at **-924, 56, 976** (~50 m ESE); that alcove has a **west drop** (air down to ~Y49 at `-928,976`) and is **not** the approved bound.

Ore was found in the pre-homes region files then **live `if block` confirmed**. It was not `/setblock`. Hidden vein interiors were not used as the test target.

## Test chest (installed)

No village chest is used. H1 still holds HomeProbe paper and remains out of bounds.

**TEST chest BLOCK:** **`-954, 58, 944`**  
User-approved Task 08. Pre-read **air**, then `setblock … chest[facing=east] keep`. Verified `type=single`, `Items: []`, `components: {}`. Origin stand `-953,58,945` remains 2-high air (diagonal reach). Do not use tannery, H1–H9, or farm-pad chests.

## Approved mutation / excavation footprint

Permitted digs: visible `coal_ore` (and only that resource) whose XZ hypot from **(-953, 945)** is **≤ 8** and **Y 56–62**, plus the designated chest cell **-954, 58, 944**.

Integer box to stay out of (human + other agents):

- X **-961 .. -945**
- Y **56 .. 62**
- Z **937 .. 953**
- plus chest cell **-954, 58, 944** (installed)

Do not authorize unrestricted cave follow-up, strip mines, or the west drop under the other hillside (`-928, ~49–56, 976`).

Preserve: Site C village, five house chests, tannery contents, lighting, farm rectangle X **20–23**, Y **68–72**, Z **238–242**, HomeProbe H1 furniture.

## Route

Harness **teleports** MineProbe onto the origin stand. No overland walk from Site C is required. After mining, the bot should deposit to **-954, 58, 944** without leaving the radius.

Human return: fly/walk on the **surface grass** at **-948, 67, 938** (grass_block Y=66). Do not drop into the pocket while the probe is there.

## Watch from here

Surface perch (air above grass; outside the radius):

```
/execute in minecraft:overworld run tp @s -940 72 932 45 35
```

Looks southwest toward the cave. Stay off X **-961..-945**, Z **937..953**, Y **56–62**, and off the origin stand `-953.5, 58, 945.5`.

## Backup

`<LOCAL_WORLD_BACKUPS>\2026-09-19_world-lab_pre-mine`  
`MANIFEST.txt` present; 23 overworld region `.mca`; 16 entity `.mca`; ~97 MB; `save-all flush` before copy; `session.lock` omitted (Paper running).  

Older recovery points kept: `2026-09-19_world-lab_site-c-pre-homes`, `2026-09-19_world-lab_site-c-pre-audit`. Do **not** restore `2026-09-19_pre-red` onto world-lab.

## WORLD-LAB status / exclusive access

RED world-editing is **stopped** after the one approved chest. Forceload leftover **0**. `save-all flush` completed.

BLUE has released HomeProbe. GREEN has the exclusive MineProbe window on **25567 / 25577**.

Before launch GREEN should:

1. Confirm `list` has **no** HomeProbe / FarmProbe / MineProbe / MechProbe  
2. Keep the human player off X **-961..-945**, Z **937..953**, Y **56–62** (village watch is fine)  
3. Set `MINE_TEST_USER_APPROVED=true` (chest and bounds are user-approved)  
4. Use `MINE_TEST_CHEST=-954,58,944` — **do not** `MINE_TEST_PLACE_CHEST=true`

Paper is **up** on 25567. GREEN’s harness does not auto-start Paper. Do not start a second Paper on 25565. RED will not start MineProbe.

Paper is **currently up** on 25567 with the human player connected. GREEN’s harness does not auto-start Paper. Do not start a second Paper on 25565.

## Suggested GREEN launch

```
set MECHANICS_MINE_TEST_ENABLED=true
set MINE_TEST_ALLOW_WORLD_MUTATION=true
set MINE_TEST_RED_APPROVED=true
set MINE_TEST_BLUE_IDLE=true
set MINE_TEST_USER_APPROVED=true
set MINE_TEST_PORT=25567
set MINE_TEST_RCON_PORT=25577
set MINE_TEST_VERSION=1.21.11
set MINE_TEST_ORIGIN=-953,58,945
set MINE_TEST_CHEST=-954,58,944
set MINE_TEST_RADIUS=8
set MINE_TEST_RESOURCE=coal
set MINE_TEST_MIN_Y=56
set MINE_TEST_MAX_Y=62
set MINE_TEST_USERNAME=MineProbe
pnpm mechanics:mine
```

## Blockers

None for chest placement. GREEN still must not treat this as a live mining PASS until MineProbe actually mines, picks up, and stores coal.

Keep Shadowskiii1 out of the pocket during the test.

## World modifications

Task 07: none (scout + backup).  
Task 08: **one** `setblock keep` — `minecraft:chest[facing=east]` at **-954, 58, 944**. No other blocks, no ore edits, no village/farm edits, Mindcraft not installed.
