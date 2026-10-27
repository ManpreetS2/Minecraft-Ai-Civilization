# RED → BLUE farm-test handoff (world-lab)

Date: 2026-09-19  
RED: site approval and exclusive-access note only. **BLUE has not been launched from this pass.** This is **not** a live agriculture PASS.

Companion site notes: [RED_FARM_TEST_SITE.md](./RED_FARM_TEST_SITE.md)  
Housing (separate, no planner edits): [RED_SETTLEMENT_HOUSING_AUDIT.md](./RED_SETTLEMENT_HOUSING_AUDIT.md)

---

## Server (verified)

| | |
| --- | --- |
| Folder | `<WORKSPACE>\world-lab` |
| Paper | **1.21.11-132-c5eb079** (MC 1.21.11) |
| Listen | **127.0.0.1:25567** (pid listening; one lab Paper) |
| RCON | **25577**, password `civ-world-lab-rcon` (from `world-lab/server.properties`) |
| Seed | **20260919** (RCON `seed`) |
| Dimension | `minecraft:overworld` |
| Difficulty | Easy; `random_tick_speed` **3** at handoff |
| Spawn protection | **16** around current spawn **-1017, 62, 831** |
| Plugins | 0 gameplay plugins |

**Do not use** live civ **25565** / RCON **25575**. **Do not use** Mindcraft **25566**. Neither was listening at handoff. Do not run `pnpm sim:start` or connect the five citizens during the farm test.

Harness: `apps/orchestrator/src/live-farm-test.ts` via `pnpm --filter @civ/orchestrator mechanics:farm`. Guards require both flags. `AUTO_START_PAPER` is forced off. If `FARM_TEST_ORIGIN` is omitted, the harness uses **probe spawn +20 X** — that would land next to Site C. **Origin is mandatory.**

---

## Backup (do not restore over the live lab unless rolling back)

`<LOCAL_WORLD_BACKUPS>\2026-09-19_world-lab_site-c-pre-audit`

Verified: `MANIFEST.txt` present; 17 overworld region files; 11 entity `.mca`; 7 poi `.mca`; `level.dat` seed **20260919**; spawn **(-1017, 62, 831)**. Taken after `save-all flush`, before this housing/farm probe. Includes the user’s kept village buildings, lighting, and villager removals **as of that save**. Lab `session.lock` was busy (Paper running) and was omitted on purpose.

Do **not** restore `2026-09-19_pre-red` (that is the **live civ** backup) onto world-lab.

---

## Approved `FARM_TEST_ORIGIN`

**`20, 68, 240`** overworld  
Ground: **grass_block Y=68**, air Y=69 (RCON, chunks force-loaded then unmarked).

```
FARM_TEST_ORIGIN=20,68,240
```

Distance to Site C `(-1032, 888)`: **~1236 m** XZ.  
Distance to current spawn `(-1017, 831)`: **~1195 m** XZ.  
Outside spawn-protection 16.

### Harness mutation footprint (from `live-farm-test.ts`, not guessed)

Soil origin `(ox,oy,oz)=(20,68,240)`:

| Command | Cells |
| --- | --- |
| `fill` grass_block | `20..22, 68, 240..242` (3×3) |
| `fill` air | `20..22, 69..70, 240..242` |
| `setblock` water | `23, 68, 241` |
| `setblock` chest | `23, 69, 240` |
| `tp FarmProbe` | `20.5, 69, 238.5` |
| `/clear` + `/give wooden_hoe 1` + `/give wheat_seeds 16` | inventory TEST_CONTROL |
| optional `gamerule random_tick_speed` | restore **3** after |
| `effect hunger` | eat stage only |

No crafting-table fixture (bread `needsTable=false`). **No cleanup** in the harness; leftover farmland/water/chest/drops are expected unless BLUE clears the same rectangle afterward.

**Approved mutation rectangle:** X **20..23**, Y **68..72**, Z **238..242** (includes bot stand just south of the plot). Do not till, fill, or path west into Candidate A `(8, 216)` (~27 m) or anywhere near Site C.

### Watch from here

Fly/spectator perch (air VERIFIED):

```
/execute in minecraft:overworld run tp @s 16 73 232 -27 20
```

Ground alternative: **16, 68, 232** (grass at Y67). Stay off the mutation rectangle. Creative/spectator is fine. Do not stand on the 3×3, water, chest, or `20.5, 69, 238.5`.

FarmProbe still **logs in at world spawn** `(-1017, 831)` for ~2 s (inside the village / protection square) then teleports to the pad. That flash is expected; it is not farming the village.

---

## Site C — excluded

Village buildings, dirt paths, player lighting, pond/lakefront, and proposed expansion around **-1032, 64, 888** are **out of test bounds**. Do not `fill`/`setblock` west of X≈-100.

Human `Shadowskiii1` was online in **Creative** at about **-1091, 69, 806** (village, not the farm pad) when RED stopped scanning. Remaining villagers/golem were **not** removed by RED.

---

## Exclusive access

| Check | Status |
| --- | --- |
| RED forceload leftover | **None** (`forceload query` empty) |
| RED housing/farm probes | **Finished**; no further world edits from RED |
| Lab Paper instances | **One** on 25567 |
| Five-citizen sim | **Must stay off** |
| Human on farm pad | **No** at handoff (they were at Site C) |

BLUE may run `mechanics:farm` when the human is either at Site C or on the spectator perch and is not building at X≈20, Z≈240.

### BLUE command (BLUE runs this, not RED)

```
MECHANICS_FARM_TEST_ENABLED=true
FARM_TEST_ALLOW_WORLD_MUTATION=true
FARM_TEST_HOST=127.0.0.1
FARM_TEST_PORT=25567
FARM_TEST_RCON_PORT=25577
FARM_TEST_VERSION=1.21.11
FARM_TEST_ORIGIN=20,68,240
FARM_TEST_USERNAME=FarmProbe
pnpm --filter @civ/orchestrator mechanics:farm
```

Optional: `FARM_TEST_RANDOM_TICK_SPEED` / `FARM_TEST_GROWTH_MS` as labeled TEST_CONTROL. A prior BLUE run on this pad did **not** complete 3×3 grow→harvest→bread→chest→eat. Do not copy that scorecard as a PASS.

---

## Explicit handoff

World-lab is **idle for BLUE’s exclusive farming test** on the approved rectangle only. Site C is excluded. RED will not continue village construction or further world scans while that test owns 25567.
