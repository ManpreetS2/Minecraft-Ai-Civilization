# RED Site C personal-chest installation

Date: 2026-09-19  
Task: RED 06  
Server: isolated WORLD-LAB Paper **1.21.11-132** `127.0.0.1:25567` RCON **25577** seed **20260919**

Houses and chests remain **unassigned**. IDs H1–H9 are physical labels only. HomeProbe was **not** started. Persistent homes are **not** live-tested.

Pre-homes recovery point (not restored):  
`<LOCAL_WORLD_BACKUPS>\2026-09-19_world-lab_site-c-pre-homes`

Companion plan: [RED_SITE_C_HOME_PREPARATION.md](./RED_SITE_C_HOME_PREPARATION.md)

## Access

| Check | Result |
| --- | --- |
| Players on WORLD-LAB | **0** (`list`) |
| Seed | **20260919** |
| Live civ **25565** / Mindcraft **25566** | Not started |
| `pnpm sim:start` / HomeProbe | Not started |
| Farm pad X 20–23, Y 68–72, Z 238–242 | Not forceloaded, not edited |
| `save-all flush` | Yes, after the five placements |
| Forceload leftover | **0** |
| WORLD-LAB after this pass | **Stopped** |

BLUE confirmed: one ordinary empty `minecraft:chest` per house; API stores the **block** cell, not the stand cell; no Lock, loot table, barrel, trapped chest, double chest, or second household chest.

## Placements

Each approved cell was **air** with **oak_planks** below and **air** above, and had **no adjacent chest**. Placement used `setblock … minecraft:chest[facing=…] keep` (not a blind `replace`).

| House | Chest BLOCK | Facing | type | Empty | Lock / loot table | Result |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | **-1096, 69, 729** | south | single | `Items: []` | none | **installed** |
| H2 | **-1057, 68, 757** | west | single | `Items: []` | none | **installed** |
| H4 | **-1056, 65, 780** | west | single | `Items: []` | none | **installed** |
| H5 | **-1078, 69, 799** | west | single | `Items: []` | none | **installed** |
| H9 | **-1066, 68, 847** | east | single | `Items: []` | none | **installed** |

**5 / 5** ordinary single chests. NBT example: `{id:"minecraft:chest", Items:[], components:{}}`. No extra chests in H6 or H8 (interior walkway cells still air).

## Access after placement

RCON 2-high air at the audited approach and interior stand; door still oak; bed still present. A Mineflayer body did **not** walk these routes this pass.

| House | Door | Bed head | Approach 2-high | Interior stand 2-high | Chest reachable from stand |
| --- | --- | --- | --- | --- | --- |
| H1 | oak -1096,69,731 | yellow **-1097, 69, 728** | **-1096, 69, 732** yes | -1096, 69, 730 yes | yes |
| H2 | oak -1059,68,757 | white -1056, 68, 756 | -1060, 68, 757 yes | -1058, 68, 757 yes | yes |
| H4 | oak -1058,65,780 | white **-1055, 65, 779** | **-1059, 65, 780** yes | -1057, 65, 780 yes | yes |
| H5 | oak -1080,69,799 | white -1077, 69, 798 | -1081, 69, 799 yes | -1079, 69, 799 yes | yes |
| H9 | oak -1064,68,847 | yellow -1067, 68, 848 | -1063, 68, 847 yes | -1065, 68, 847 yes | yes |

Sample wall torches still present at H1 `(-1096, 71, 732)`, H4 `(-1059, 67, 780)`, H9 `(-1063, 70, 847)`. Doors, paths, and buildings were not otherwise edited.

## Communal tannery chest (unchanged)

**-1038, 65, 839** still `chest[facing=east]`. Items before and after matched: `bread`×1 slot 2, `leather_helmet`×1 slot 14. Standing cell **-1037, 65, 839** was not modified.

## BLUE HomeProbe fixtures (ready)

H1 is a **temporary HomeProbe claim only**, not a citizen assignment. H4 stays a closer unclaimed option.

| Role | Approach | Bed HEAD | Chest BLOCK |
| --- | --- | --- | --- |
| H1 (far / probe claim) | **-1096, 69, 732** | **-1097, 69, 728** | **-1096, 69, 729** |
| H4 (nearer home option) | **-1059, 65, 780** | **-1055, 65, 779** | **-1056, 65, 780** |
| Communal | stand **-1037, 65, 839** | — | **-1038, 65, 839** |

From the bell `(-1057, 789)`, H4 is ~10 m and the tannery is ~53 m; H1 is ~73 m. Success is using the **claimed** H1 bed/chest, not the nearest ones.

**Exclusive window:** RED world-editing and scouting are **stopped**. BLUE may start `world-lab\start.bat` after confirming nobody else is modifying the lab. Do not use **25565** or **25566**. Do not run `pnpm sim:start`.

## World modifications this pass

Exactly five `setblock keep` chest placements listed above. No farm-pad writes, no H6/H8 chests, no villager/golem kills, no roster claims.
