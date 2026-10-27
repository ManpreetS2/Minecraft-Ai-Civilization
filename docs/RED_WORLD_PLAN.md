# RED world plan

Date: 2026-09-19  
Companion audit: [RED_WORLD_AUDIT.md](./RED_WORLD_AUDIT.md)  
Design: Option A — five independent citizens in a small survival-capable settlement inside a large natural world. Citizens decide later construction. A human contractor may later instant-build and add physical automation.

## Exact next action (to get a playable isolated world)

Do this **once**, in order. Do not start live Paper on **25565** at the same time.

1. Confirm ports: nothing on **25565** (live) and **25567** (lab). 25566 is the Mindcraft 1.21.4 throwaway — leave it alone.
2. Open `<WORKSPACE>\world-lab`
3. Confirm `eula.txt` contains `eula=true` and `paper.jar` is present.
4. Run `start.bat`. Wait for `Done (` in the console.
5. Minecraft Java **1.21.11** → Multiplayer → Direct connect **`127.0.0.1:25567`**
6. In the **lab console**: `op <your-username>`
7. In-game: `/seed` (expect `20260919`), `/locate biome minecraft:plains`, `/locate biome minecraft:forest`, look for water and a cave opening near spawn.
8. **Stop here** if spawn is cliffs/ocean/badlands. Do not paste houses. Pick an origin with `/tp` onto plains **outside spawn-protection 16**, write the coordinates into this file, then continue construction on a later pass.

Until step 4, the lab has **no world folder**. That is expected.

## World-testing approach

| Environment | Path | Port | World |
| --- | --- | --- | --- |
| Live civilization | `server/` | 25565 | existing seed `-3807514935229766152`, already fixture-mutated |
| Isolated construction lab | `world-lab/` | 25567 | **new** vanilla world, seed `20260919`, not generated yet |
| Mindcraft body throwaway | `Desktop/paper_mindcraft_body_test` | 25566 | Paper **1.21.4**, unrelated |

Lab uses the **same Paper 1.21.11-132 jar** as live. Version is not upgraded. Plugins stay empty until biome inspection passes.

`pnpm sim:start` must keep `MINECRAFT_PORT=25565`. Never set it to 25567 while testing construction, and never run both Papers together.

## Selected world (lab)

**Seed `20260919`** (vanilla `minecraft:normal`).

Why this, not a downloaded map:

- Reproducible integer, no third-party world zip.
- Compatible with this Paper jar by definition (vanilla generator).
- Live seed is **already used** and the live overworld contains MechProbe RCON fixtures. Cloning it into lab would mix construction tests with production dirt.
- Third-party “perfect plains” listings were **not** treated as proven for this jar. One Java 1.19–1.21.11 listing (`-5311432810530077959`) is a **small river island** — poor Option A expansion land.

**Fallback if first-boot spawn fails the biome checklist:** keep the same jar, stop the lab, move `world-lab/world*` aside (do not delete live `server/world`), set `level-seed` to another vanilla integer, restart lab only. Candidate to try second: live seed `-3807514935229766152` **only** to compare terrain, not to become the settlement world.

Biome checklist (must observe in-game, not from this document):

- Large walkable plains or meadow for plots
- Surface water (river, lake, or ocean within a short walk)
- Forest or mixed trees for oak/birch
- Cave access (opening, ravine, or dig-down stone)
- Space for four empty expansion plots without flattening a mountain

## Construction tools (research only — not installed)

Do not install these on **live** `server/plugins`. After biome OK, install on **world-lab only**, one plugin family at a time.

### WorldEdit (EngineHub) — verified for this version range

- Hangar: [EngineHub/WorldEdit versions](https://hangar.papermc.io/EngineHub/WorldEdit/versions)
- **7.4.2** (2026-04-01): Paper **1.21.4–1.21.11**
- **7.4.5** (2026-08-09): Paper **1.21.4–26.2** (includes 1.21.11)
- Dependency: Java 21 (already installed). No WorldGuard required for paste.
- Install (lab only, later): drop the Hangar Paper jar into `world-lab/plugins`, restart lab.
- Usage: `//wand` wooden axe = **selection**, not place. `//copy` / `//schem load <name>` / `//paste` / `//undo`.
- **Click-to-place structures: no.** Left/right click set pos1/pos2.

Recommended first construction tool for the contractor.

### FastAsyncWorldEdit (IntellectualSites)

- GitHub releases include **1.21.11** work; CurseForge lists **FAWE 2.15.0** for 1.21.11 (2026-01-09).
- Hangar project page is **stale** (latest Hangar release **2.8.1** targets 1.17.1–1.20.2). **Do not install Hangar 2.8.1 on 1.21.11.**
- FAWE **replaces** WorldEdit. Do not run both.
- Better for large pastes; overkill for three oak houses. Optional later, lab-only, after WorldEdit is proven.

### BuildPaste

- Client mods (Fabric/NeoForge/Forge) are **not** Paper plugins. Do not mix loaders into this server.
- Separate **Paper/Bukkit plugin 2.02** is **listed** as covering up to **1.21.11** on third-party catalogs. RED did **not** download the jar.
- Click-to-place: catalog/UI driven, pulls structures from **buildpaste.net** (external network). Unverified binary + external catalog = **not approved** until you fetch the jar from the vendor yourself and test in world-lab.
- Do not install on live.

### InstaSchem

- Pitch: bind a schematic to an item, **right-click to paste**, left-click rotate. Depends on **FAWE**.
- Public listings mix **1.18** stables and **1.20.5–1.21.x betas**. **1.21.11 is not independently verified here.**
- Treat as **unproven**. If click-to-place is required later: test InstaSchem **only** on world-lab after FAWE 1.21.11 is proven.

### Click-to-place summary (Paper)

| Tool | Click-to-place houses on Paper 1.21.11 |
| --- | --- |
| WorldEdit | No (command paste) |
| FAWE | No (same WE commands; faster) |
| InstaSchem | Intended yes; **version unverified** |
| BuildPaste plugin | Listed yes; **jar not fetched / not tested** |

Human contractor path for now: **WorldEdit 7.4.2+ on world-lab**, `//schem load` + `//paste`.

## Starter settlement (design only — not built)

Keep it small. Citizens decide farms, walls, industry later. No iron farm, no castle, no auto generators.

Place the origin **at least 20 blocks** from world spawn (spawn-protection is 16). After lab boot, stand on plains and record `ORIGIN = (ox, oy, oz)` (block under feet + 1 y for floor).

Relative layout, +X east, +Z south:

| Piece | Footprint (relative) | Contents |
| --- | --- | --- |
| House A | x 0–6, z 0–6, y 0–4 | Oak planks, oak door south, **2 beds**, 1 crafting leftover chest empty |
| House B | x 10–16, z 0–6 | Same, **2 beds** |
| House C | x 20–26, z 0–6 | Same, **1 bed** (five beds total) |
| Shared yard | x 8–18, z 10–16 | 2 double chests, 1 crafting table, 1 furnace, 1 oak log pile (decorative, not a generator) |
| Farm | x 0–8, z 10–14 | Hydrated 9×4 farmland, wheat, water trough in the middle. No villager crop farm machines |
| Paths | 3-wide dirt/gravel | Connect doors → yard → farm; stop at plot edges |
| Plot N | x −16–−4, z 0–12 | Fence posts at corners only, empty |
| Plot E | x 30–42, z 0–12 | Empty |
| Plot S | x 8–20, z 20–32 | Empty |
| Plot W | x −16–−4, z 20–32 | Empty |

Rules:

- Oak / cobble / dirt / glass / doors / beds / chests / farmland / water / torches only.
- Light the interior and paths. Do not night-proof the entire biome.
- Do not flatten more than the footprints plus 1-block eaves.
- Do not pre-place villager workstations beyond the one crafting table / furnace.
- Do not claim mines, nether portals, or roads to monuments.

Build method (later, lab only): hand-place **or** WorldEdit after you save a schematic from a hand-built first house. Do not download a village schematic from an unvetted site.

## Rollback

Live backup: `Desktop\minecraft_ai_sim_world_backups\2026-09-19_pre-red\MANIFEST.txt`

Lab mistakes: stop lab, rename `world-lab/world*` to `world-lab/world*.bad`, restart lab to regenerate seed `20260919`. Live `server/world` stays untouched.

## Proposed work (explicitly not done)

- First boot of world-lab
- Biome sign-off and ORIGIN coordinates
- WorldEdit jar in `world-lab/plugins`
- Building the three houses
- Any change to live Paper, live world, or AI packages
- Pointing citizens at 25567
