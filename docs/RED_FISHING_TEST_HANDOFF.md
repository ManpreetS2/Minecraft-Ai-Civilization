# RED → GREEN fishing-test handoff (world-lab)

Date: 2026-09-19  
RED: shore, bounds, storage options, and exclusive-access note. **FishProbe was not launched.** This is **not** a live fishing PASS.

## Fixture installation (2026-09-20)

**User chest approval: GIVEN.** Explicit approval to place one empty ordinary single `minecraft:chest` at **-1042, 63, 980**.

| Item | Status |
| --- | --- |
| Pre-read | **air**, air at Y+1, **grass_block** at Y−1; N/S/E/W neighbors **air** (no adjacent chest); origin `-1043,63,980` air/air/grass; access stand `-1041,63,980` air/air/grass; water `-1044,62,980` |
| Human at install | Shadowskiii1 at **~-1047, 79, 816** (outside X **-1051..-1035**, Z **972..988**) |
| BLUE/GREEN live harness | none on `list` (Shadowskiii1 only) |
| Command | `setblock -1042 63 980 minecraft:chest[facing=west] keep` |
| Installed BLOCK | **-1042, 63, 980** |
| State | `chest[facing=west,type=single]`, NBT `Items: []`, `components: {}`, no Lock/loot table |
| Origin stand `-1043,63,980` | still air / air (west of chest, facing the latch) |
| Access stand `-1041,63,980` | still air / air (east of chest) |
| Cast water `-1044,62,980` | still **water** |
| Mining chest `-954,58,944` | unchanged **coal ×1**; mined cell `-953,58,946` still air |
| Site C / farm / personal chests | not edited |
| `save-all flush` | completed |
| RED leftover forceload | fishing/mine adds **removed**. `forceload query` still shows **7** chunks RED did not add this pass: `[-64,60], [-60,60], [-59,60], [-64,61], [-66,62], [-65,62], [-64,62]` |
| FishProbe | **not started** |

GREEN may run `pnpm mechanics:fish` with `FISH_TEST_CHEST=-1042,63,980`. Do **not** set `FISH_TEST_PLACE_CHEST=true` (chest already exists). Installing this chest is **not** a fishing PASS. Do **not** refill salmon/cod; current NBT is `Items: []`.

## Atlas chest installation (2026-09-20)

**User chest approval: GIVEN.** Explicit approval to place one empty ordinary single `minecraft:chest` at **-1042, 63, 982** as Atlas’s designated fishing-test chest. Placement-only — **not** authorization for `pnpm mechanics:two-fish`.

| Item | Status |
| --- | --- |
| Pre-read | **air**, air at Y+1, **grass_block** at Y−1 |
| Neighbors | N `-1042,63,981` **air** (gap); S/E **grass_block** steps; W **air**. **No adjacent chest** (Kai is Z **980**, Manhattan 2) |
| Kai chest `-1042,63,980` | still `chest[facing=west,type=single]`, `Items: []` — **not edited**, missing salmon/cod **not replaced** |
| Human | Shadowskiii1 ~**-1045, 67, 970** (not in the target cell). Not kicked. |
| BLUE/GREEN bots | none on `list`. Nobody disconnected. |
| Command | `setblock -1042 63 982 minecraft:chest[facing=west] keep` |
| Installed BLOCK | **-1042, 63, 982** |
| State | `chest[facing=west,type=single]`, NBT `Items: []`, `components: {}` |
| Access stand (primary) | **-1043, 63, 982** air / air / grass (west, same Y) |
| Other safe approaches | `-1042,63,981` (gap); `-1041,64,982` and `-1042,64,983` (1-block grass steps) |
| Atlas origin (unchanged) | `-1044,63,981` air / air / grass; water `-1045,62,981` |
| Mining chest | still **coal ×1**; mined cell still air |
| Site C / farm / personal chests | not edited |
| `save-all flush` | completed |
| RED forceload leftover | **0** |
| `pnpm mechanics:two-fish` / `pnpm sim:start` | **not started** |

**GREEN:** `TWO_FISH_ATLAS_CHEST=-1042,63,982`. Do **not** `setblock` this cell again. Two-bot live run still needs **separate** user authorization plus `TWO_FISH_BLUE_SHARED=true`.

Companion: GREEN harness plan [GREEN_FISHING_LIVE_TEST_PLAN.md](./GREEN_FISHING_LIVE_TEST_PLAN.md)  
Mining preserve (do not reset): [GREEN_MINING_LIVE_RUN.md](./GREEN_MINING_LIVE_RUN.md), [RED_GREEN_MINING_TEST_HANDOFF.md](./RED_GREEN_MINING_TEST_HANDOFF.md)

---

## Coordination

| Check | Result |
| --- | --- |
| BLUE HomeProbe / FarmProbe | **Not on `list`.** No `live-home-test` / `live-farm-test` node. |
| GREEN MineProbe | **Finished.** Live coal PASS already recorded. Not on `list`. |
| WORLD-LAB Paper | **1.21.11-132** listening **25567** / RCON **25577** |
| Connected client | Human **Shadowskiii1** (not kicked). No HomeProbe / FishProbe / Kai / Atlas on `list` at Atlas install. |
| Live civ **25565** / Mindcraft **25566** | Not listening |
| `pnpm sim:start` / two-fish | **Not started** |
| RED leftover forceload | **0** after Atlas install |

Shared WORLD-LAB access is allowed when tests do not overlap the fishing AABB. **No agent may kick another agent’s bot** or change global time/weather/gamerules for someone else’s run. Atlas chest install is **not** a two-fish launch.

Do not overlap with `MECHANICS_HOME_TEST_ENABLED` / `FARM` / `MINE` / `TWO_PROBE` (GREEN `evaluateFishTestLaunch` refuses those).

---

## GREEN harness (from code, not guessed)

Launch: `apps/orchestrator/src/live-fish-test.ts` via `pnpm mechanics:fish`.  
Guards: `apps/orchestrator/src/fish-test-guard.ts`. Username **FishProbe** only (reserved). `AUTO_START_PAPER` is forced **false**.

Skill: `packages/skills/src/fish.ts` `fishAtShore` / `evaluateFishingRequest`.

| Env | Meaning |
| --- | --- |
| `FISH_TEST_ORIGIN=x,y,z` | **Standing shore cell** (feet Y). Not a water block. Skill `searchOrigin`. |
| `FISH_TEST_CHEST=x,y,z` | Deposit **block** cell. Must already be chest/barrel/trapped_chest, **or** `FISH_TEST_PLACE_CHEST=true` after **user** approval (`setblock chest replace`). |
| `FISH_TEST_RADIUS` | Integer **1–16** (skill cap 16; default **8**) |
| `FISH_TEST_CASTS` | Integer **1–4** (default 1) |
| `FISH_TEST_TIMEOUT_MS` | Integer **5000–90000** (default 60000) |
| `FISH_TEST_USERNAME` | `FishProbe` only |
| Port / RCON / version | **25567** / **25577** / **1.21.11** |
| `FISH_TEST_RETURN_HOME` / `FISH_TEST_HOME` | Optional second verdict. Omit for the first fishing PASS. Do not invent a bed. |

Guard **refuses** origin within **64 m** of Site C `(-1032, 888)`, **32 m** of farm `(20, 240)`, **48 m** of H1 `(-1097, 728)`, **24 m** of the coal pocket `(-953, 945)`. Chest refused if it is inside Site C 64 m, tannery `-1038,65,839`, H1 personal `-1096,69,729`, or mining chest **-954,58,944**.

TEST_CONTROL (finite, logged): `op`, `tp` onto origin, `clear FishProbe`, `give` **one** `fishing_rod`. Never `/give` fish. Never `/setblock` water. Never `/setblock` ore.

Shore rule (skill, not a dock): 2-high airish on a solid `boundingBox=block` (not water/lava underfoot), cardinal-adjacent `water`/`bubble_column` at the same Y **or** Y−1. Cast: `lookAt` water + `activateItem`. Standing in liquid → `HAZARD_BLOCKED`. No rod → `MISSING_TOOL`. No shore in radius → `SEARCH_EXHAUSTED` (**NOT FOUND**, not PASS).

Keep this survey, water cells, and mining ore history **out of citizen observations / planner memory**. FishProbe may receive only the standing origin and the designated chest.

---

## Server (verified this pass)

| | |
| --- | --- |
| Folder | `<WORKSPACE>\world-lab` |
| Paper | **1.21.11-132** (RCON `seed` **20260919**) |
| Listen | **127.0.0.1:25567** |
| RCON | **25577**, password `civ-world-lab-rcon` |
| Dimension | `minecraft:overworld` |
| Spawn protection | **16** around **-1017, 62, 831** |
| Plugins | 0 gameplay plugins |

**Do not use** live civ **25565** / RCON **25575**. **Do not use** Mindcraft **25566**. Do not run `pnpm sim:start`. Do not restore a backup over this world.

---

## Preserves (left as found)

| Fixture | Status |
| --- | --- |
| Mining chest **-954, 58, 944** | still `chest`; NBT **coal ×1** |
| Mine origin **-953, 58, 945** | still **air** |
| Naturally mined cell **-953, 58, 946** | still **air** (not `coal_ore`) — **do not restore** |
| Farm pad **20, 68, 240** | still `grass_block` |
| Tannery **-1038, 65, 839** | still `chest` (`bread` + `leather_helmet`) |
| Site C houses / H1–H9 personal chests | not edited |
| Lighting / village buildings | not edited |

Do not reuse the mining chest for fishing. Do not use H1 / H2 / H4 / H5 / H9 personal chests (GREEN’s guard hard-refuses H1 + tannery only; RED still forbids the other house chests).

---

## Rejected near shore (do not use)

Site C’s south pond has a walkable 1-block bank at **-1025, 63, 928** (grass underfoot, water east at `-1024,62,928`, 40.6 m from Site C). GREEN `parseApprovedFishArea` **refuses** it (`< 64 m` of Site C). Direct north from that cell also crosses pond water. Documented only so nobody “fixes” the test by moving closer to the village.

The spawn-side river around `(-1016, 824)` is inside spawn-protection **16**. Not used.

---

## Approved standing origin

**Dimension:** `minecraft:overworld`  
**`FISH_TEST_ORIGIN=-1043,63,980`**  
**`FISH_TEST_RADIUS=8`**  
**`FISH_TEST_CASTS=1`**  
**`FISH_TEST_TIMEOUT_MS=90000`** (vanilla bite can exceed 60 s; skill cap is 90 s)

Verified (RCON `if-block`):

| Cell | Block |
| --- | --- |
| Feet `-1043,63,980` | **air** |
| Head `-1043,64,980` | **air** |
| Floor `-1043,62,980` | **grass_block** |
| Cast water `-1044,62,980` | **water** (cardinal west, Y−1 — matches `adjacentWater`) |
| Air above that water | **air** |
| Cast lane west `-1045` / `-1046` / `-1047`, Y=62 | **water**, air at Y=63 |
| Depth under the first water | **dirt** at Y=61 (1-block-deep fringe; skill does not require open-water) |
| Lily pads on the cast lane | **none** |
| Lava in r=4 of the stand | **none** |

XZ distances: Site C **92.7 m**, coal pocket **96.6 m**, spawn **151.3 m**, H1 **~258 m**, farm **~1295 m**. Outside spawn-protection 16.

Within radius 8 of this origin the south-west pond has additional 1-block banks (including `-1044,63,981`). The probe must discover water with Mineflayer after teleport — do **not** put the water cell into `FISH_TEST_ORIGIN`.

---

## Storage (installed)

**`FISH_TEST_CHEST=-1042,63,980`** — ordinary single `minecraft:chest[facing=west]`, `Items: []`.

| Option | Cell | Verdict |
| --- | --- | --- |
| **Kai / FishProbe test chest** | **-1042, 63, 980** | Installed. Empty (`Items: []`). Do not refill salmon/cod. Stand `-1041,63,980` or origin `-1043,63,980`. |
| **Atlas test chest** | **-1042, 63, 982** | **Installed** 2026-09-20. Empty single, facing west. Access **-1043, 63, 982**. |
| Tannery | `-1038,65,839` | Communal. **Harness refuses.** Do not use. |
| Mining test chest | `-954,58,944` | Has **coal ×1**. **Harness refuses.** Preserve it. |
| H1–H9 personal | (installed house chests) | **Forbidden.** |

Do **not** set `FISH_TEST_PLACE_CHEST=true`. Do not place a third pond chest.

---

## Test bounds (human + other agents stay out)

Integer box around the origin at radius 8, plus the proposed chest:

- X **-1051 .. -1035**
- Y **61 .. 65**
- Z **972 .. 988**
- plus Kai chest **-1042, 63, 980** and Atlas chest **-1042, 63, 982**
- Atlas access **-1043, 63, 982**; Atlas origin **-1044, 63, 981** (GREEN geometry, not a chest)

Stay out of the mining pocket X **-961..-945**, Y **56–62**, Z **937–953** and chest **-954,58,944**. Stay off Site C interiors, farm rectangle X **20–23**, Y **68–72**, Z **238–242**, and H1 furniture.

Fishing itself does not break blocks. Approved mutations on this pond are **only** the two user-approved single chests.

---

## Route (land, toward Site C)

Harness **teleports** FishProbe onto the origin. Overland walk is for a later `FISH_TEST_RETURN_HOME` or a human. Do **not** walk north into the pond.

Verified grass corridor (2-high air on `grass_block`; samples every ~8–16 m):

1. From origin **east along Z=980**: `-1040` → `-1032` → `-1020` → `-1012` → `-1008` → `-1000` → `-996` (bump at `-1004,980` is dirt/grass hill, not water — path over or around).
2. **North on X=-996**: Z `980 → 956 → 940 → 924 → 908 → 896 → 888` (all dry grass). This line is **east** of the 16-block drop at **-1012,896** (air Y 56–66 over water Y 50–55). Do not cut west onto that drop.
3. **West on Z=888** toward Site C: `-996 → -1012 → -1020 → -1028 → -1032`. Skip `-1004,888` (air column). Village grass at Site C latitude is dry.

Do not send FishProbe through house interiors. First fishing run: **omit** `FISH_TEST_RETURN_HOME` (H1 bed is BLUE’s fixture; do not invent it as a fishing shore).

---

## Hazards

| Hazard | Where | Action |
| --- | --- | --- |
| Pond water | West of origin; inlets north of the spit at ~Z 948–940 | Cast west; do not path north/west into water |
| 1-block-deep fringe | Dirt under water at `-1044,61,980` | Allowed by the skill; not an open-water farm |
| Cliff drop | `-1012, 896`, air down to water Y **50** | Stay on X=-996 for the north leg |
| Spawn protection | 16 around `-1017, 62, 831` | Origin is 151 m away; do not test on the north river |
| Tannery cauldron | `-1033, 65, 839` `water_cauldron` | Off this route unless someone walks to the forbidden tannery |

`spawn-monsters=false` on this Paper. Still treat `HOSTILE_NEARBY` as a real skill fail if anything is in range 8.

---

## Watch from here

Spectator perch (air VERIFIED):

```
/execute in minecraft:overworld run tp @s -1028 74 992 129 30
```

Looks northwest at the origin. Stay off X **-1051..-1035**, Z **972..988**, Y **61–65**, and off the origin stand `-1043.5, 63, 980.5`.

---

## Backup (do not restore over the live lab)

Latest mining-era copy: `<LOCAL_WORLD_BACKUPS>\2026-09-19_world-lab_pre-mine`  
Older: `2026-09-19_world-lab_site-c-pre-homes`, `2026-09-19_world-lab_site-c-pre-audit`.

Do **not** restore `2026-09-19_pre-red` (live civ) onto world-lab. This fishing scout did not take a new backup (read-only).

---

## Suggested launch (after chest approval + exclusive window)

Do not fill `FISH_TEST_PLACE_CHEST` — the chest is already there.

```
set MECHANICS_FISH_TEST_ENABLED=true
set FISH_TEST_ALLOW_WORLD_MUTATION=true
set FISH_TEST_RED_APPROVED=true
set FISH_TEST_BLUE_IDLE=true
set FISH_TEST_USER_APPROVED=true
set FISH_TEST_PORT=25567
set FISH_TEST_RCON_PORT=25577
set FISH_TEST_VERSION=1.21.11
set FISH_TEST_ORIGIN=-1043,63,980
set FISH_TEST_CHEST=-1042,63,980
set FISH_TEST_RADIUS=8
set FISH_TEST_CASTS=1
set FISH_TEST_TIMEOUT_MS=90000
set FISH_TEST_USERNAME=FishProbe
set AUTO_START_PAPER=false
pnpm mechanics:fish
```

`SEARCH_EXHAUSTED` / no catch in budget → `FISHING_LIVE=NOT FOUND` or FAIL, not PASS. Cancel stage is harness-internal (`FISH_TEST_VERIFY_CANCEL`, default on).

---

## WORLD-LAB ownership

RED world-editing is **stopped** after the Atlas chest. Installing chests does **not** prove two-bot fishing works. `pnpm mechanics:two-fish`, `pnpm mechanics:fish`, and `pnpm sim:start` were **not** started.

**Shared server.** BLUE (HomeProbe / movement pad / H1) and GREEN (pond) may be connected at the same time if their AABBs do not interfere. **No agent may unilaterally kick another agent’s bot** or change global time/weather/gamerules during the other’s test.

**GREEN** owns the fishing-site fixtures:

| Role | Origin | Chest | Access stand |
| --- | --- | --- | --- |
| Kai | `-1043,63,980` | `-1042,63,980` | `-1041,63,980` / origin |
| Atlas | `-1044,63,981` (GREEN; unchanged) | **`-1042,63,982`** | **`-1043,63,982`** |

GREEN must request **separate** user authorization before a live two-fish run. Suggested env **after** that approval (do not run now):

```
TWO_FISH_KAI_ORIGIN=-1043,63,980
TWO_FISH_KAI_CHEST=-1042,63,980
TWO_FISH_ATLAS_ORIGIN=-1044,63,981
TWO_FISH_ATLAS_CHEST=-1042,63,982
```

Paper is **up** on 25567 / 25577. RED will not start two-fish or a second Paper.
