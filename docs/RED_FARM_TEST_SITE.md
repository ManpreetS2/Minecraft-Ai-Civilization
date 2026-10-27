# RED farm-test site (world-lab)

Date: 2026-09-19  
Server: Paper 1.21.11-132 `127.0.0.1:25567` RCON `25577` seed `20260919`  
This is a **disposable 3×3 agriculture pad**, not a settlement plot.

## Preserve

| Area | Coordinates | Rule |
| --- | --- | --- |
| Proposed settlement | **-1032, 64, 888** | Do not fixture, till, or path through |
| Current `/setworldspawn` | **-1017, 62, 831** | Spawn-protection 16; FarmProbe may appear here for ~2 s on connect then teleport away |
| Candidate A center (alternate pad) | **8, 66, 216** | Keep; farm scar is ~28 m NE |

## Approved origin (RCON-verified, not invented)

**`FARM_TEST_ORIGIN=20,68,240`**

Re-checked 2026-09-19 after BLUE's prior cleanup: every cell `20..23`, `Z 238..242` is **grass_block at Y68** with **air at Y69**. Flat enough for the harness fill.

## Spectator (watch without standing on the pad)

Ground (Creative/Survival walk): **16, 68, 232** (grass underfoot at Y67).  
Fly/Spectator perch: **16, 73, 232** looking toward the plot (yaw **-27**, pitch **20**).

```
/execute in minecraft:overworld run tp @s 16 73 232 -27 20
```

Stay off `20..23, Y68–72, Z238..242` and off the bot stand `20.5, 69, 238.5`.

| Cell | Y68 | Y69 | Notes |
| --- | --- | --- | --- |
| 20..23, 238..242 | grass_block | air | Re-checked after BLUE cleanup; the old 1-block rise at x=22 is gone |

Biome: **plains**. Bot stand: `20.5, 69, 238.5`. Water fixture: `23, 68, 241`. Chest fixture: `23, 69, 240`.

Distances (XZ hypot):

- Settlement C `(-1032, 888)`: **~1236 m**
- Current spawn `(-1017, 831)`: **~1195 m**
- Candidate A `(8, 216)`: **~27 m**
- Human at last RED sample: village `~-1091, 69, 806` (Creative), not on this pad

Village at Site C is **verified** (see housing audit). This pad has no village chests.

## Harness mutation footprint (this origin)

- `fill 20 68 240 22 68 242 grass_block`
- `fill 20 69 240 22 70 242 air`
- `setblock 23 68 241 water`
- `setblock 23 69 240 chest`
- `/give FarmProbe wooden_hoe 1` and `wheat_seeds 16` after `clear` (TEST_CONTROL, finite)
- Optional `gamerule random_tick_speed` TEST_CONTROL during growth, restore **3**

## Hazards

- World spawn is next to settlement C; FarmProbe connects there first (~2 s) then teleports here.
- Do not expand west into Candidate A center or 1 km west into C.
- Human was at Site C in Creative at handoff. Do not run if they move onto X≈20, Z≈240.

## Coordinate ownership

BLUE agriculture test owns **20..23, Y 68–70, Z 238..242** for the duration of `mechanics:farm`. Settlement C and Candidate A center remain RED/human.
