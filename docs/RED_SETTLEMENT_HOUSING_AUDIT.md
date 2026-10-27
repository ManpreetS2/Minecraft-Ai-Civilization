# RED settlement housing audit (Site C village)

Date: 2026-09-19  
Server: world-lab Paper 1.21.11-132 `127.0.0.1:25567` seed `20260919`  
Settlement center (terrain rec): **-1032, 64, 888**  
Current world spawn: **-1017, 62, 831** (spawn-protection 16)

This audit does **not** assign houses to Atlas/Maya/Theo/Ava/Kai or any roster order. It does **not** place blocks, kill entities, or change the planner. Player lighting and retained village buildings were left as-is.

Backup taken immediately before this audit:  
`<LOCAL_WORLD_BACKUPS>\2026-09-19_world-lab_site-c-pre-audit`

## Method

| Source | Trusted for |
| --- | --- |
| `world/poi` `minecraft:home` records | Bed/home count and coordinates |
| Chunk `block_entities` | Bed pairs, surface chest, bell, blast furnace |
| Bounded RCON `if block` (forceload then remove) | Door, torch/lantern, dirt_path, job-site block names |
| Entity region + RCON `@e[type=villager]` | Remaining NPCs |

Paletted block-state expansion over-counted beds/doors (false grids). Those counts were **discarded**.

## What is already there (verified)

**Nine** villager-home beds remain, each with an **oak door** and **path** nearby, and **2–3 lights** in a 4-block radius (player-added and/or vanilla):

| ID | Bed (head) | Color | Door | Lights in r=4 | Dirt path nearby |
| --- | --- | --- | --- | --- | --- |
| H1 | -1097, 69, 728 | yellow | -1096, 69, 731 | 2 wall_torch | yes |
| H2 | -1056, 68, 756 | white | -1059, 68, 757 | 3 wall_torch | yes |
| H3 | -1056, 67, 768 | white | -1059, 67, 769 | 2 wall_torch | yes |
| H4 | -1055, 65, 779 | white | -1058, 65, 780 | 2 wall_torch | yes |
| H5 | -1077, 69, 798 | white | -1080, 69, 799 | 3 wall_torch | yes |
| H6 | -1072, 70, 798 | white | -1071, 70, 796 | torch + wall_torch | yes |
| H7 | -1089, 68, 817 | yellow | -1086, 68, 816 | 2 wall_torch | yes (dense) |
| H8 | -1051, 65, 841 | white | -1050, 65, 839 | torch + wall_torch | yes |
| H9 | -1067, 68, 848 | yellow | -1064, 68, 847 | 2 wall_torch | yes |

H5 and H6 share Z=798 about 5 blocks apart (two rooms / adjacent houses). Do not treat IDs as citizen names.

Village paths include **dirt_path** at world spawn `-1017, 62, 831`. Bell at **-1057, 69, 789**. Work blocks still present: blast furnace `-1092, 69, 793`, composter `-1090, 67, 805`, water cauldron `-1034, 64, 836`, smithing table `-1070, 67, 775`.

## What five citizens still lack (no builds this pass)

Five independent homes means five **claimable sleeping spots** plus **persistent personal storage**, with wooden-door access and a roof the body will accept as shelter. Roster assignment is out of scope.

| Need | Status | Gap |
| --- | --- | --- |
| ≥5 beds | **9 beds** VERIFIED | Surplus. Citizens can choose; do not pre-bind by join order |
| Wooden door per dwelling | **9 oak doors** VERIFIED | None for count. Iron doors: none sampled |
| Lighting | **2–3 lights** at each sampled home | Preserve; do not rip out. Whole-biome night-proofing was not measured |
| Dirt paths to doors | VERIFIED at all nine | None for connectivity at door-radius |
| Personal chest/barrel in the dwelling | **0** inside r=4 of any bed | **Missing.** One surface chest only: **-1038, 65, 839** (tannery, NBT `Items` length **3**, loot table none). Dungeon chests underground are not house storage |
| Shared settlement chest the planner can remember | 1 tannery chest, contents names **truncated / UNVERIFIED** | Not five personal inventories. Planner today uses a single `settlement.storage` |
| Crafting table in a house | **Not found** at spawn or job POIs | UNVERIFIED per interior. Farm bread recipe does not need a table; citizen tool craft does |
| Roof that `seekSafety` treats as solid at bed Y+2 | Sample H7 column: air at +1..+3, oak_planks at **+4** | May fail the current “block two above the bed” check. Other houses **UNVERIFIED** for that exact test |
| Uncontested beds | **8 villagers + 1 iron golem** still in the village | User removed some NPCs; leftovers remain (RCON names included Farmer, Nitwit×2, Leatherworker×2, Toolsmith, unnamed Villager). They can reclaim `minecraft:home` POIs at night. **Not killed this pass** |

## Not claimed

- House quality / interior size / Mineflayer path through each doorway: not walked by a bot.
- Exact tannery chest item IDs (RCON `data get` truncated).
- Ore, farms as food production, or expansion plots.

## Next construction (later, not now)

If the user wants five persistent personal homes **without** new buildings, the remaining work is interior fit-out and NPC policy, not a third house row:

1. User (or a later RED pass) finishes removing leftover villagers if beds must stay player-owned.
2. Place **five chests or barrels** in five chosen interiors (citizens pick which; no roster map).
3. Optionally add a sixth shared chest at the bell/yard, distinct from personal boxes.
4. Recheck bed Y+2 cover if bots fail `seekSafety`.
5. Still do not assign H1–H9 to named citizens in code.
