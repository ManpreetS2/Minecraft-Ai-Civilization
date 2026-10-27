# RED settlement site analysis

Date: 2026-09-19  
Role: Agent RED (world / Paper / construction)  
Server: isolated **world-lab** at `127.0.0.1:25567` (RCON `25577`)  
This is a terrain recommendation for human inspection. It is not a decision about how the AI civilization must expand. Terrain was **not** modified. WorldEdit / BuildPaste were **not** installed. Live civ (`server/` on 25565) was **not** touched. Agent BLUE files were **not** edited. The lab world was **not** reset.

## How this was verified

| Source | Used for | Not used for |
| --- | --- | --- |
| `world-lab/server.properties`, `version_history.json`, `logs/latest.log`, gzip `world/level.dat` | Seed, version, generator, spawn, gamerules | Terrain quality |
| Existing `world/region/*.mca` (full chunks only) | Heightmaps, biome palettes, log/stone/cave_air presence, scoring | Final “flat / water / trees” claims |
| Bounded RCON (`forceload` ≤49 chunks, then `forceload remove`) | Surface Y, biome, ground block, water columns, oak logs/leaves, cave_air | Bulk worldgen |
| Seed-map websites / chat estimates | — | **Not used as results** |

Heightmaps: 1.18+ 9-bit `MOTION_BLOCKING_NO_LEAVES`, 7 values per long, `Y = packed + minY - 1` (`minY = -64`). Cross-checked against RCON `positioned over motion_blocking_no_leaves` marker Y at spawn-area plains (matches within ~2 blocks).

**MCA `has_water` / `has_cave` on a chunk is not surface water or a cave mouth.** Almost every full chunk contains underground aquifers or `cave_air`. Those flags are treated as **estimates** unless RCON `if block` confirmed surface water / surface `cave_air`.

Temporary markers tagged `red_site_probe` were summoned and killed. Final `forceload query`: none. Player `Shadowskiii1` was online in Creative and was **not** teleported by this pass.

## 1. Lab world metadata (verified)

| Item | Value | Evidence |
| --- | --- | --- |
| Process | Paper pid **19756**, listening `0.0.0.0:25567` and `0.0.0.0:25577`; client ESTABLISHED on 25567 | `netstat` |
| Live civ 25565 | **Not listening** | `netstat` |
| Jar / MC | Paper **1.21.11-132-c5eb079** (MC **1.21.11**), DataVersion **4671** | `logs/latest.log`, `version_history.json`, chunk NBT, `level.dat` `Name=1.21.11` |
| Java | 21 Temurin 21.0.10+7 | boot log |
| Seed | **`20260919`** | `server.properties` `level-seed`; RCON `seed` → `Seed: [20260919]`; `level.dat` dimension seed `0x01352837` |
| Level type | Vanilla overworld noise: `minecraft:overworld` + `multi_noise` preset `minecraft:overworld`, settings `minecraft:overworld` | `level.dat` `WorldGenSettings` |
| Structures / features | `generate-structures=true`; `generate_features=1`; `bonus_chest=0` | properties + `level.dat` |
| Packs | `vanilla`, `file/bukkit`, `paper` (built-in). **0 plugins** | RCON `datapack list`, `plugins` |
| Difficulty / mobs | Easy; `spawn-monsters=false`; bukkit monster spawn-limits **0** | properties, RCON `difficulty`, `bukkit.yml` |
| Spawn protection | **16** | `server.properties` |
| Online mode | `false` | properties / boot warn |
| View / sim distance | 10 / 10 | properties |
| Region compression | `deflate` | properties |
| Gameplay plugins | none (bundled spark profiler only) | boot log, `plugins` |

### Spawns (do not mix these up)

| Spawn | Coordinates | Status |
| --- | --- | --- |
| World-gen / first login | **X=-32, Y=75, Z=128** (login `-23.5, 76.0, 118.5`) | VERIFIED from first-join log + original `pos` parse |
| **Current** `/setworldspawn` (player, 10:16:59) | **-1017, 62, 831** | VERIFIED `level.dat` `pos` int-array + log |

Distances below use **world-gen spawn** unless labeled “current spawn”.

### Generated data (bounded; no full-world scan)

At scan time: **~5500** region-indexed overworld chunks on disk, **~1350** `minecraft:full` with usable heightmaps. Coverage is **west / south-west heavy** (player travel + `/locate`). Positive-X land past ~+200 is mostly **not fully generated** — not searched in detail. Search stayed inside existing regions plus ≤49-chunk forceload windows. Chunk count grew during the session from player movement and these bounded loads; the world was not replaced.

Player `/locate structure minecraft:village_plains` returned in 947 ms. **Coordinates were not in the log → village location UNVERIFIED.**

## 2. Three candidate sites

All three are **plains**, inside ~1,300 blocks of world-gen spawn, on already-generated full chunks. RCON samples stood on **grass_block**, not water, except where a water feature is called out.

Height-grid legend (MCA, 8-block step vs window median): `.` ≈ median, `o` lower, `n` higher, `v` much lower, `^` much higher.

---

### Candidate A — inland plains near original spawn

| | |
| --- | --- |
| **Center (proposed pad)** | **8, 66, 216** |
| Teleport | `/execute in minecraft:overworld run tp @s 8 66 216` |
| 80×80 window | X **-32..48**, Z **176..256** |
| Dist. to world-gen spawn `(-32, 128)` | **97 m** VERIFIED (XZ hypot) |
| Dist. to current spawn `(-1017, 831)` | **1195 m** VERIFIED |

**Terrain (MCA 4 m grid, 400 samples, 0 missing)**

- Y **57..73**, median **68**, mean **67.7**, range **16**
- Largest contiguous “buildable” (`|dY|≤3`, not water-majority chunk): **~6080 m²**
- Max 4 m step: **12** (3 pairs) — **only at the NW corner** `(-32, 176)`
- 5×5 chunk biome palette: **100% `minecraft:plains`** (no river biome inside this window)

**RCON surface samples (VERIFIED)**

| XZ | Marker Y | Biome | Ground |
| --- | --- | --- | --- |
| 8, 216 | 66 | plains | grass_block |
| -16, 192 | 68 | plains | grass_block |
| 32, 192 | 72 | plains | grass_block |
| -16, 240 | 70 | plains | grass_block |
| 32, 240 | 71 | plains | grass_block |
| -32, 176 (NW dip) | 58 | plains | **stone** |

**Water**

- River **~68 m** WNW at **(-40, 264)**: biome `minecraft:river`, water blocks Y **54–62**, surface on water at Y **63**. VERIFIED.
- Cold ocean **~90 m** SE at **(72, 152)**: biome `minecraft:cold_ocean`, water Y **50–61+**. VERIFIED.
- No river biome inside the 80×80. VERIFIED (MCA palettes + RCON samples dry).

**Trees**

- Oak **leaves** VERIFIED at **(-80, 71, 208)** and neighbors (chunk with MCA `_log` palette). **~88 m** west of center.
- Additional leaves VERIFIED near original spawn **(-52, 68, 96)** (~134 m from A).
- `minecraft:forest` biome adjacent to A: **not found** in the 80×80. ESTIMATE: scattered plains oaks, not a forest stand.

**Stone / cave**

- Surface **stone** VERIFIED at NW dip `(-32, 176)` Y 58 and at **(8, 264)** Y 68.
- Surface **`cave_air`** VERIFIED at **(8, 264)** Y **69–71** and neighbors (6–12, 262–268). This is a stone knob with exposed cave_air **48 m north** of center — treat as a walkable opening, not a mapped cave network.
- Underground stone palettes in all 25 window chunks (MCA). VERIFIED as “stone exists in column,” not as ore.

**Obstacles / terraforming**

- Keep houses **off the NW corner** (12-block drop onto stone). Rest of pad is 1–2 block plains ripple.
- Coast is close: ocean ~90 m. Fine for a starter, weaker for huge inland expansion than C.
- Spawn-protection 16 around **current** spawn does not affect A. Original spawn protection around `(-32, 128)` also does not reach `(8, 216)`.

MCA height grid (80×80, 8 m step):

```
v.....nnnn
.......nn.
.o.....nnn
oo.......n
ooo.......
.ooooo....
....oo....
..........
.........n
o........n
```

---

### Candidate B — west rolling plains

| | |
| --- | --- |
| **Center** | **-1032, 77, 40** |
| Teleport | `/execute in minecraft:overworld run tp @s -1032 77 40` |
| 80×80 window | X **-1072..-992**, Z **0..80** |
| Dist. to world-gen spawn | **1004 m** VERIFIED |
| Dist. to current spawn | **~791 m** VERIFIED |

**Terrain (MCA 400 samples)**

- Y **68..79**, median **74**, mean **73.6**, range **11**
- Contiguous buildable: **~5168 m²**
- Max 4 m step: **5**; ravine-like pairs (dY≥12): **0**
- Biome palette: **100% plains** in window

**RCON surface samples (VERIFIED)**

| XZ | Marker Y | Biome | Ground |
| --- | --- | --- | --- |
| -1032, 40 | 77 | plains | grass_block |
| -1056, 16 | 77 | plains | grass_block |
| -1008, 16 | 74 | plains | grass_block |
| -1056, 64 | 71 | plains | grass_block |
| -1008, 64 | 75 | plains | grass_block |

**Water**

- River **~96 m** west at **(-1128, 40)**: `minecraft:river`, water Y **50–61**. VERIFIED.
- Beach **~107 m** SSE: `minecraft:beach` at **(-984, -56)**; water at **(-952, -72)**. VERIFIED. Point `(-1016, -56)` is still plains grass (MCA “ocean 97 m” was the chunk mix, not that column).

**Trees**

- Oak leaves/log **VERIFIED at (-976, 76, 16)** — **~61 m** east of center.
- MCA `_log` in chunk `(-1032, 56)` (16 m north). RCON 8 m grid on that chunk did **not** hit a log/leaf column → **on-pad tree density UNVERIFIED** (present in chunk NBT, exact trunks not pinned).

**Stone / cave**

- `cave_air` VERIFIED at **(-1048, 40)** Y **47–48** (~27 below grass Y 75). That is **underground**, not a mouth. Surface cave entrance: **UNVERIFIED**.
- Stone in all 25 window chunk palettes (MCA). VERIFIED underground stone, not surface outcrop.

**Obstacles / terraforming**

- Gently rolling (≈11 m over 80 m). Starter houses need little flattening; long streets will step 1 block often.
- No ravine through the pad (MCA).
- Far from both spawns — more walk / boat from current spawn than C.

MCA height grid:

```
o.....n..o
o....nnn.o
o...nnn..o
.o...nn..o
voo..nn..o
ovo...n..o
oooo...n..
oooo..n...
ooo.......
oo....nn..
```

---

### Candidate C — plains south of current world spawn (**proposed FIRST SITE**)

| | |
| --- | --- |
| **Center** | **-1032, 64, 888** |
| Teleport | `/execute in minecraft:overworld run tp @s -1032 64 888` |
| 80×80 window | X **-1072..-992**, Z **848..928** |
| Dist. to world-gen spawn | **1256 m** VERIFIED |
| Dist. to **current** spawn `(-1017, 831)` | **~59 m** VERIFIED (dx=15, dz=57) |

Spawn-protection square around `(-1017, 831)` is `|dx|≤16` **and** `|dz|≤16`. Center C is **outside** it (dz=57). Do not place protected blocks north of about **Z=847** on this X.

**Terrain**

- MCA 80×80: Y **55..76**, median **64**, mean **64.1**, range **21**. The low values are the **pond** on the south edge, not a mountain.
- RCON grass samples: Y **64–68** only. VERIFIED flat pad.
- Contiguous buildable: **~6224 m²**
- Max 4 m step **11**; 14 pairs with dY≥8 — **concentrated at pond banks**, not a ravine through the grass.
- Biome palette: **100% plains** in window (no river biome inside)

**RCON surface samples (VERIFIED)**

| XZ | Marker Y | Biome | Ground |
| --- | --- | --- | --- |
| -1032, 888 | 64 | plains | grass_block |
| -1056, 864 | 68 | plains | grass_block |
| -1008, 864 | 64 | plains | grass_block |
| -1056, 912 | 67 | plains | grass_block |
| -1008, 912 | 64 | plains | grass_block |
| -1032, 920 (south) | 63 | plains | **water** |

**Water**

- **Plains pond/lake** starting ~16–32 m south of center: water at `(-1032, 920)` Y **50–61**, 8 m grid shows water cells from about Z **904–944**. VERIFIED. Place the five houses **north of Z≈900**.
- River **~66 m** north at **(-1016, 824)**: `minecraft:river`, water Y **60–62** (shallower than A/B). VERIFIED.
- Does **not** cut the grass samples at the center.

**Trees**

- Oak **leaves** VERIFIED on the pad at **(-1044, 71, 908)** / **(-1040, 71, 912)** (~20 m from center).
- `minecraft:forest` VERIFIED at **(-920, 792)** with oak **log** at **(-928, 68, 796)** and many oak leaves. **~148 m** ESE of center.

**Stone / cave**

- RCON column at MCA cave chunk `(-1016, 904)`: **no `cave_air` Y 32–72**. Surface cave mouth at C: **UNVERIFIED**.
- Stone palettes in all 25 window chunks (MCA). Dig-down mining is available; opening not pinned.
- Nearby dripstone_caves biome in this window: **not present** (MCA).

**Obstacles / terraforming**

- Keep the village on the northern ~48×48 of the pad (verified grass at Z 864–888). Use the pond as the water source; do not build across it.
- Pond banks need stairs or a 1–2 block dock; no major cliff through the house plots.
- Current spawn is a short walk north — convenient for the inspecting player, irrelevant to bots if spawn-protection is respected.

MCA height grid (includes pond dip `v` on the south):

```
.^........
..n.......
..n..nn...
..........
..........
.........v
........v.
..........
..........
n.n.......
```

---

## 3. Comparison (what is actually supported)

| Need | A `(8, 216)` | B `(-1032, 40)` | C `(-1032, 888)` |
| --- | --- | --- | --- |
| Large reasonably flat pad | Yes (range 16; one stone dip) | Yes, rolling (range 11) | Yes on grass (RCON 64–68); pond to south |
| Nearby natural water | River 68 m + ocean 90 m **VERIFIED** | River 96 m + beach/water ~107–122 m **VERIFIED** | Pond 16–32 m + river 66 m **VERIFIED** |
| Trees | Oak leaves ~88 m **VERIFIED**; forest biome **no** | Oak ~61 m **VERIFIED**; on-pad trunks **UNVERIFIED** | Leaves on pad + forest 148 m with oak log **VERIFIED** |
| Stone / cave | Surface stone + surface cave_air 48 m **VERIFIED** | Underground cave_air 27 m down **VERIFIED**; mouth **UNVERIFIED** | Underground stone **VERIFIED**; mouth **UNVERIFIED** |
| Ravine / cliff through pad | NW 12-block stone dip | None measured | Pond banks only |
| Bot pathing | Good except NW corner | Good (max 4 m step 5) | Good on grass; avoid pond |
| Dist. gen-spawn | 97 m | 1004 m | 1256 m |
| Dist. current spawn | 1195 m | 791 m | **59 m** |

Ores, mob farms, “resource-rich,” and unexplored +X land: **UNVERIFIED**.

## 4. Proposed FIRST SITE

**Inspect C first: `-1032, 64, 888`**

```
/execute in minecraft:overworld run tp @s -1032 64 888
```

**Proposed starter settlement center (same point):** **X=-1032, Y=64, Z=888** (overworld).

Why C, as terrain only:

1. RCON-confirmed grass plains with almost no relief on the house plots.
2. Verified **two** water sources (pond immediately south, river north) that do **not** bisect the sampled grass.
3. Verified trees **on the pad** and a real `minecraft:forest` with oak log ~148 m away.
4. Already next to the spawn the inspecting player set, while remaining outside spawn-protection 16 if construction stays south of Z≈847.
5. ~6200 m² contiguous near-median land in the 80×80 — enough for three oak houses, farm, chests, paths, and four empty plots, with room left if the pond is treated as the south boundary.

**Build note:** origin should stay **≥20 blocks** from current spawn `(-1017, 831)` (plan already uses spawn-protection 16). C’s center already is. Prefer plots toward **(-1056, 864)** / **(-1008, 864)** (verified grass) rather than toward Z≥904 (water).

If C’s pond is larger than wanted in person, walk north to **Candidate A** (`8 66 216`) for a coastal plains pad with a verified cave_air opening, or west-roll **B** (`-1032 77 40`) for inland hills without a pond.

## 5. What this pass did not do

- No `/locate` from RCON (player already ran one; we did not generate a search fan).
- No scan of ungenerated chunks inside the 2000-block circle (especially +X).
- No ore, village, or mineshaft mapping.
- No buildings, `/setblock`, `/fill`, or plugin installs.
- No edits to the live civilization world.
