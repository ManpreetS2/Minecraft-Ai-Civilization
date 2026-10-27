# RED Site C starter housing preparation

Date: 2026-09-19  
Server: isolated WORLD-LAB Paper **1.21.11-132** `127.0.0.1:25567` RCON **25577** seed **20260919**  
Site C terrain rec: **-1032, 64, 888**  
World spawn: **-1017, 62, 831** (spawn-protection **16**; all nine houses and the tannery are outside it)

IDs **H1–H9** are physical labels only. Houses and chests are **not** assigned to Atlas, Maya, Theo, Ava, or Kai. Persistent-home behavior is **not** claimed until BLUE demonstrates it with Mineflayer bodies. Task 06 installed five empty personal chests; see [RED_SITE_C_CHEST_INSTALLATION.md](./RED_SITE_C_CHEST_INSTALLATION.md).

Companion: [RED_SETTLEMENT_HOUSING_AUDIT.md](./RED_SETTLEMENT_HOUSING_AUDIT.md)

## Phase 1 — Access, backup, change area

| Check | Result |
| --- | --- |
| Lab Paper | Started for this audit only; **0 players** on `list` while scanning |
| BLUE FarmProbe / citizens | Not connected. Farm pad was **read-only** (BLUE already restored grass; no water/chest left) |
| Live civ **25565** / Mindcraft **25566** | Not used |
| `pnpm sim:start` | Not started |
| User lighting / village buildings | Left in place (wall torches still at every sampled house) |
| Block edits | **None.** RCON `if block` / `data get` / temporary `forceload` (removed; leftover **0**) |
| `save-all flush` | Yes, after scans |

**Backup (no new copy this pass):**  
`<LOCAL_WORLD_BACKUPS>\2026-09-19_world-lab_site-c-pre-homes`  
`MANIFEST.txt` present; 17 overworld region `.mca`; 11 entity `.mca`; ~67 MB. Taken while Paper was **stopped**, after FarmProbe and after the user’s Site C villager kills. Older snapshot `2026-09-19_world-lab_site-c-pre-audit` is retained. Do **not** restore `2026-09-19_pre-red` (live civ) onto world-lab.

A newer backup was **not** required: nothing was placed. Forceload ticked entities in Site C and in the distant `-890` pocket; positions below are post-tick.

**Change area used Task 06:** five interior air cells in existing houses, X **-1097..-1055**, Y **65..69**, Z **728..848**.  
**Never:** BLUE farm rectangle X **20–23**, Y **68–72**, Z **238–242**.

## Phase 2 — Nine existing houses (RCON block states)

Method: POI/bed coordinates from the prior audit, then live `if block` on door, bed, 2-high air, floors, stairs, lights, and dirt_path. Paletted MCA expansion is still untrusted. A Mineflayer body did **not** walk these routes this pass.

Door `facing` on these vanilla houses points **into** the interior (toward the bed). The **approach / stoop** is the opposite cell (oak_stairs or cobblestone_stairs).

| ID | Bed head (usable) | Bed foot | Door (lower oak) | Approach (stoop) | Interior stand | Lights (r≈3) | Path | Personal container | Bot 2-high door? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H1 | **-1097, 69, 728** yellow | -1097, 69, 729 | -1096, 69, 731 face N closed | **-1096, 69, 732** on oak_stairs | -1096, 69, 730 oak_planks | 2 wall_torch | dirt_path **-1096, 67, 733** (1–2 block drop from stoop onto path; no water) | **-1096, 69, 729** empty chest south | yes | Medium house. Roof planks at bed **Y+4** |
| H2 | **-1056, 68, 756** white | -1057, 68, 756 | -1059, 68, 757 face E closed | **-1060, 68, 757** oak_stairs | -1058, 68, 757 | 3 wall_torch | dirt_path **-1061, 66, 757** | **-1057, 68, 757** empty chest west | yes | East row north. Roof Y+4 |
| H3 | **-1056, 67, 768** white | -1057, 67, 768 | -1059, 67, 769 face E **open** | **-1060, 67, 769** oak_stairs | -1058, 67, 769 | 5 wall_torch | dirt_path **-1061, 65, 769** | none | yes | East row middle. Door found open; left open |
| H4 | **-1055, 65, 779** white | -1056, 65, 779 | -1058, 65, 780 face E closed | **-1059, 65, 780** oak_stairs | -1057, 65, 780 | 2 wall_torch | dirt_path **-1060, 64, 780** (best street connection) | **-1056, 65, 780** empty chest west | yes | East row south, nearest the bell |
| H5 | **-1077, 69, 798** white | -1078, 69, 798 | -1080, 69, 799 face E closed | **-1081, 69, 799** oak_stairs | -1079, 69, 799 | 3 wall_torch | dirt_path **-1082, 67, 799** | **-1078, 69, 799** empty chest west | yes | West of bell. ~5 m from H6 |
| H6 | **-1072, 70, 798** white | -1071, 70, 798 | -1071, 70, 796 face S closed | **-1071, 70, 795** cobblestone_stairs | -1071, 70, 797 cobble floor | torch + wall_torch | grass, not path, immediately south | none | 2-high air yes; **cramped** | Small house. Only walkway cells; chest would sit in the door–bed lane. Roof air through Y+4 |
| H7 | **-1089, 68, 817** yellow | -1088, 68, 817 | -1086, 68, 816 face W closed | **-1085, 68, 816** oak_stairs | -1087, 68, 816 | 2 wall_torch | dirt_path **-1084, 66, 816** | none | yes | Usable spare, not in the five-option set |
| H8 | **-1051, 65, 841** white | -1050, 65, 841 | -1050, 65, 839 face S **open** | **-1050, 65, 838** cobblestone_stairs | -1050, 65, 840 cobble floor | torch + wall_torch | grass immediately south | none | 2-high air yes; **cramped** | Same small-house problem as H6. Near tannery |
| H9 | **-1067, 68, 848** yellow | -1066, 68, 848 | -1064, 68, 847 face W closed | **-1063, 68, 847** oak_stairs | -1065, 68, 847 | 2 wall_torch | dirt_path **-1062, 66, 847** | **-1066, 68, 847** empty chest east | yes | South cluster. Roof Y+4 |

**Beds:** 9 usable (one double-block bed each). **Doors:** 9 oak, all 2-high with air through the opening. **No water** in sampled rings. Task 06 added **five** empty single chests (H1, H2, H4, H5, H9). H6/H8 still have no interior chest.

**Roof / `seekSafety`:** at every medium-house bed, Y+1..Y+3 is air and oak_planks sit at **Y+4**. `seekSafety` currently requires `boundingBox === "block"` at **bed Y+2**; that cell is **air** here. `placement.hasRoof` (Y+2 **or** Y+3) also fails at the bed head. Do **not** lower vanilla ceilings this pass. BLUE should navigate by claimed bed coordinates, not by that Y+2 cover test.

**Nearby non-house storage**

| Location | Block | Role |
| --- | --- | --- |
| **-1038, 65, 839** | `chest` facing **east** | Existing **communal / tannery** chest (not inside a dwelling). Approach air **-1037, 65, 839** and **-1037, 66, 839**. Confirmed items: `bread`×1 (slot 2), `leather_helmet`×1 (slot 14). Not filled further. |
| Dungeon / underground chests | — | Not house storage |

Village fixtures unchanged: bell **-1057, 69, 789**; blast furnace **-1092, 69, 793**; composter **-1090, 67, 805**; water cauldron **-1034, 64, 836**; smithing table **-1070, 67, 775**. Crop plots, paths, and open land were not rebuilt.

## Phase 3 — Five unassigned home OPTIONS (plan only)

BLUE’s home API (`packages/agent-core/src/home-types.ts`) stores `personalChest` / `householdChest` as **coordinates**. Skills accept `chest` | `barrel` | `trapped_chest` with purpose `household_storage`. There is **no** BLUE spec for:

- which block to place (chest vs barrel vs trapped chest)
- facing
- empty NBT vs leftover loot
- whether each house also needs a **household** chest in addition to a **personal** chest (these interiors fit **one** container without blocking the door)

**Installed 2026-09-19 (Task 06):** five ordinary empty single chests at the planned cells. Record: [RED_SITE_C_CHEST_INSTALLATION.md](./RED_SITE_C_CHEST_INSTALLATION.md). Houses remain unassigned.

### Proposed options (citizens choose later; no roster map)

Each recommended chest cell is **air**, **oak_planks or cobble under it**, **air above**, not the door column, and not the interior stand cell immediately inside the door. The bot can stand on the interior stand cell to open both the bed and the chest.

| Option | House | Entrance / approach | Designated bed (head) | Planned personal container | Stand to use chest | Planned chest facing |
| --- | --- | --- | --- | --- | --- | --- |
| A | H1 | -1096, 69, 732 | -1097, 69, 728 | **-1096, 69, 729** (installed, face south, empty single) | -1096, 69, 730 | south |
| B | H2 | -1060, 68, 757 | -1056, 68, 756 | **-1057, 68, 757** (installed, face west, empty single) | -1058, 68, 757 | west |
| C | H4 | -1059, 65, 780 | -1055, 65, 779 | **-1056, 65, 780** (installed, face west, empty single) | -1057, 65, 780 | west |
| D | H5 | -1081, 69, 799 | -1077, 69, 798 | **-1078, 69, 799** (installed, face west, empty single) | -1079, 69, 799 | west |
| E | H9 | -1063, 68, 847 | -1067, 68, 848 | **-1066, 68, 847** (installed, face east, empty single) | -1065, 68, 847 | east |

H3, H7 remain extra unassigned beds. **H6 and H8 are not starter options:** a chest in the only walkway would block door or bed approach. Do not force a container there.

If BLUE requires **two** containers per house (personal + household), say so before placement; these rooms cannot take a second chest without a tiny layout change (or using H3/H7 as single-occupancy only).

## Phase 4 — Keep the village small

No new houses, farms, warehouses, or pens. Lighting, paths, crops, water access, and expansion land were not altered.

**Communal starter storage:** existing tannery chest **-1038, 65, 839**. Do not fill it with unlogged stacks. BLUE should register it as `settlement.storage` (communal), **not** as a citizen `personalChest`.

## Phase 5 — Vanilla villagers and iron golems

### Site C village (loaded bbox X -1110..-990, Z 720..880)

| Entity | Count | Position |
| --- | --- | --- |
| Villager | **0** | — |
| Iron golem | **1** | **-1116.86, 66, 808** (west of the houses, not in a doorway) |

They are **not** occupying sampled beds. The golem was **not** removed.

### Not Site C (first-exploration pocket, loaded on purpose)

**7** plains villagers, profession **`minecraft:none`**, level 1, plus **1** iron golem:

| # | Approx. position |
| --- | --- |
| 1 | -903.14, 72, 191.50 |
| 2 | -903.47, 80, 187.00 |
| 3 | -903.21, 80, 186.13 |
| 4 | -887.87, 94.94, 180.51 |
| 5 | -882.48, 96, 186.70 |
| 6 | -882.21, 97, 176.30 |
| 7 | -853.79, 93, 196.21 |
| Golem | -889.52, 95, 171.53 |

### Classification (evidence, not a respawn claim)

- `latest.log` from the **prior** lab session: three villagers **tried to swim in lava** ~10:36 near **-1214, 824**; seven Site C-named villagers **was killed** ~10:48 (player). No `/summon villager` in that log.
- After those kills, Site C entity files and this RCON pass both show **zero** villagers in the village bbox.
- The seven unemployed villagers sit ~**700 m east-southeast** of Site C, around the early `/tp -896, 176` lookout. They are **surviving unloaded entities**, not a Site C breed/respawn event.
- A RED probe used `execute as @e[type=villager] run say villager` in that distant pocket (six chat lines at 16:52). That is a log artifact, not new spawns.

### Proposed Site-C-only clear (needs user approval; **do not run yet**)

Site C currently has **no villagers to clear**. If any reappear in the village only:

```
# one-shot, Site C houses only — not repeating, not @e, not the golem
/execute in minecraft:overworld run kill @e[type=minecraft:villager,x=-1110,y=50,z=720,dx=120,dy=40,dz=160]
```

Do **not** run that against the `-890` pocket unless separately approved. Do **not** auto-kill either iron golem.

## Phase 6 — BLUE home-test handoff

**Exclusive window:** RED world-editing is **stopped** after Task 06. BLUE may start `world-lab\start.bat` after confirming nobody else is on the lab. Do not run RED `setblock`/forceload during BLUE’s test. Do not start `pnpm sim:start` or bind **25565**.

Personal chests are **installed**. HomeProbe may begin; RED will not start it.

### First one- or two-bot test geometry

Start / spectator near the bell: `/tp @s -1057 71 789`

XZ distances from the bell **(-1057, 789)**:

| Target | Dist (approx.) | Role |
| --- | --- | --- |
| H4 bed -1055, 65, 779 | **10 m** | nearer unassigned bed (if the claimed home is H1) |
| H3 bed -1056, 67, 768 | **21 m** | extra nearer unassigned bed |
| H5 bed -1077, 69, 798 | **22 m** | option D |
| Tannery chest -1038, 65, 839 | **53 m** | nearer **communal** chest vs H1 |
| H1 bed -1097, 69, 728 | **73 m** | claimed far home |

**Test house 1 (near, option C) — do not pre-bind a citizen name**

- Entrance / approach: **-1059, 65, 780**
- Door: -1058, 65, 780
- Bed head: **-1055, 65, 779**
- Personal chest BLOCK: **-1056, 65, 780** (installed, face west, empty single)

**Test house 2 (far, option A)**

- Entrance / approach: **-1096, 69, 732**
- Door: -1096, 69, 731
- Bed head: **-1097, 69, 728**
- Personal chest BLOCK: **-1096, 69, 729** (installed, face south, empty single)

**Communal chest (installed, vanilla):** **-1038, 65, 839** facing east; stand **-1037, 65, 839**.

**Choice proof:** claim **H1** (or H9) for the probe. From the bell the closest bed is **H4** and the closest existing chest is the **tannery**. Success is walking to the **claimed** bed/chest, not the nearest ones. H4/H3 must stay unclaimed during that trial.

Farm pad **20,68,240** is out of scope for this test.

## Blockers

1. BLUE container requirements — **resolved** Task 06 (ordinary empty single `chest`, block coordinates).
2. **User approval** if vanilla villagers appear again inside Site C, or to remove the Site C iron golem.
3. **`seekSafety` Y+2 cover** — BLUE body issue; not a world rebuild this pass.

## World modifications

Task 05: none.  
Task 06: five `setblock keep` personal chests (H1, H2, H4, H5, H9). See [RED_SITE_C_CHEST_INSTALLATION.md](./RED_SITE_C_CHEST_INSTALLATION.md).
