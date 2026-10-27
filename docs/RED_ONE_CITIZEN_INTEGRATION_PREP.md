# RED → GREEN/BLUE one-citizen integration prep (read-only)

Date: 2026-09-20  
RED: fixture/permissions report only. **No blocks or items were placed, removed, moved, or refilled.** No bot was kicked. `pnpm sim:start` was **not** started. This is **not** a live integration PASS.

Paper **1.21.11-132** on **25567 / 25577** was started for RCON reads (`list` = 0 players). RED does **not** claim exclusive WORLD-LAB. Shared access is fine if tests do not overlap.

Companions: [RED_FISHING_TEST_HANDOFF.md](./RED_FISHING_TEST_HANDOFF.md), [RED_SITE_C_CHEST_INSTALLATION.md](./RED_SITE_C_CHEST_INSTALLATION.md), [BLUE_HOME_LIVE_TEST.md](./BLUE_HOME_LIVE_TEST.md), [GREEN_TWO_FISH_LIVE.md](./GREEN_TWO_FISH_LIVE.md), [GREEN_MINING_LIVE_RUN.md](./GREEN_MINING_LIVE_RUN.md)

---

## 1. Home claims (sqlite + code)

**No citizen currently has a legitimately persisted home or own-bed assignment.**

| Source | What it shows |
| --- | --- |
| `data/civilization.sqlite` | Five roster rows (Atlas/Maya/Theo/Ava/Kai). All `home_id` **NULL**. **No `homes` / `home_memberships` tables** (file last written **2026-09-17**, live-civ positions ~220–250, 72, 160s — **not** WORLD-LAB Site C). |
| HomeProbe live | Claimed `home_h1` as identity **`probe_home`** in a **temp** sqlite (`civ-home-live-*/homes.sqlite`). Explicitly **NOT** Atlas/Maya/Theo/Ava/Kai. Harness **`leaveHome(probe_home)`** on exit. |
| `claimHome(` call sites | Unit tests + HomeProbe / return-home / curfew harnesses only. **Planner never calls `claimHome`.** Night with no `home` → `seekSafety`, not H1 sleep. |

**H1 furniture is real. H1 is not Kai’s or Atlas’s home.** Yellow bed `-1097,69,728`, oak door `-1096,69,731`, personal chest `-1096,69,729` (`type=single`, **`Items: []`** this pass — HomeProbe paper was withdrawn and the harness `data merge`’d empty). Using H1 as a citizen home would be a **new** `claimHome` write. Ask before doing that.

H2 / H4 / H5 / H9 also have empty personal chests and **no** sqlite owner. H6 / H8 still have no interior chest.

---

## 2. Chests and fishing sites (ownership)

Do **not** treat fishing-test or mining-test chests as civilization `settlement.storage`. `knownChest()` adopts the first unclaimed chest it verifies. If a citizen walks the pond first, they can **wrongly remember** `-1042,63,980` or `-1042,63,982` as communal.

| Cell | Kind | Live RCON this pass | Owner in sqlite | Use |
| --- | --- | --- | --- | --- |
| **-1042, 63, 980** | **TEST FIXTURE** (Kai / FishProbe) | `chest[type=single]`, **cod ×2** | none | GREEN fishing only. Not public storage. |
| **-1042, 63, 982** | **TEST FIXTURE** (Atlas) | `chest[type=single]`, **cod ×1, salmon ×2, tropical_fish ×1** | none | GREEN fishing only. Not public storage. |
| **-954, 58, 944** | **TEST FIXTURE** (MineProbe) | `chest[type=single]`, **coal ×1** | none | GREEN mining only. Do not empty. |
| **-1038, 65, 839** | **Communal village** (tannery) | `chest[type=single]`, **bread ×1** slot 2, **leather_helmet ×1** slot 14 | none (`settlement.storage` in this sqlite is live-civ `244,74,164`) | BLUE intended `settlement.storage` for WORLD-LAB. |
| **-1096, 69, 729** | **Unclaimed house chest** (H1) | empty single | none (was `probe_home` in temp DB only) | Personal **if** a citizen later claims H1. |
| H2/H4/H5/H9 | Unclaimed house chests | all empty singles | none | Same as H1. |
| Farm `20,68,240` | BLUE farm pad ground | **grass_block** (no leftover farm chest this read) | — | Far from Site C (~1236 m). |

**Reachable fishing (existing shoreline, not new docks):**

| Stand | Water | Notes |
| --- | --- | --- |
| **-1043, 63, 980** (Kai) | west `-1044,62,980` | GREEN live fishing origin. Feet **air** this pass. |
| **-1044, 63, 981** (Atlas) | west `-1045,62,981` | Same pond. Feet **air**. xz ~1.4 m from Kai stand. |
| Near-village bank `-1025,63,928` | water east | **Illegal** for GREEN fish guards (`< 64 m` Site C). Do not use for FishProbe. |

Executor `fishShore` / `mineOre` need a **citizen-chosen** `plan.target`. Planner `LLM_MAP` has `mine_ore` → `mineOre` but **no `fishShore`**. `gatherFood` harvests crops / berries / leaves / animals / bread — **it does not fish**.

---

## 3. Named world state (confirmed, nothing cleared)

Seed **20260919**. `list` empty. Forceload leftover after this read: **0**.

| Fixture | Status |
| --- | --- |
| Kai fishing chest `-1042,63,980` | present, single, **cod ×2** |
| Atlas fishing chest `-1042,63,982` | present, single, **cod ×1 + salmon ×2 + tropical_fish ×1** |
| Mining chest `-954,58,944` | present, single, **coal ×1**; origin `-953,58,945` air; mined cell `-953,58,946` air |
| H1 bed / door / chest | yellow_bed, oak_door, empty chest |
| Tannery | bread + leather_helmet |
| Farm pad `20,68,240` | grass_block |

Matches GREEN’s post `TWO_FISH_TARGET=2` chest log. Missing historical salmon/cod on the Kai chest from the earlier FishProbe run were **not** restored (still not restored; current Kai contents are the later 2-cod deposit).

---

## 4. Routes (claimed home → work)

There is **no claimed citizen home**, so there is no legitimate “home → work” path for Kai/Atlas today.

**If** someone later claims **H1** (not recommended without asking; it is the HomeProbe fixture), overland distances (XZ):

| From H1 bed `(-1097, 728)` | To | Dist | Notes |
| --- | --- | --- | --- |
| Pond Kai stand | `(-1043, 980)` | **~258 m** | Do **not** walk north through the pond. RED land corridor: village grass → Site C `(-1032,888)` → **east to X=-996** → **south on X=-996** to Z=980 → west along Z=980 to the spit. Avoid drop **-1012,896** (air down to water Y 50). |
| Tannery | `(-1038, 839)` | **~126 m** | Village streets. Stand `-1037,65,839`. Cauldron `-1033,65,839`. |
| Mine origin | `(-953, 945)` | **~261 m** | Surface then into the cave pocket. Stay out of X **-961..-945**, Y **56–62**, Z **937–953** unless GREEN owns a mine window. |
| Farm pad | `(20, 240)` | **~1.2 km** | Separate BLUE fixture. |

H1 stoop still has a **1–2 block drop** onto dirt_path `-1096,67,733`. BLUE HomeProbe walked H1; five-citizen inheritance of that jump is not this report.

**Ownership conflicts**

- Fishing chests vs `knownChest` / tannery (above).
- H1 chest vs a future citizen claim vs leftover HomeProbe identity (cleared in temp DB only).
- `data/civilization.sqlite` last positions are **live-civ**, not Site C. Opening `pnpm sim:start` on WORLD-LAB with that file would teleport minds to the wrong world coordinates.

**Missing infrastructure (no world edit proposed unless asked)**

- Persistent `homes` rows for any citizen.
- Planner path that **chooses** a house (`claimHome`).
- Planner / LLM mapping for `fishShore`.
- Isolation so test chests cannot become `settlement.storage`.
- A fishing rod in any house chest (none of H1–H9/tannery hold a rod).

---

## 5. Minimal one-citizen scenario (do not script the task)

**Proposed body:** one roster citizen (RED does not pick Kai vs Atlas vs Maya). Spawn on WORLD-LAB **25567** only. **Do not** `tp` them onto the pond or into the mine (that scripts the job).

### Setup controls (operators / sqlite / flags — not the planner’s goal)

| Control | Required? | Notes |
| --- | --- | --- |
| Isolated Paper 1.21.11 **25567** | yes | Already up from this read. Not 25565/25566. |
| `SIM_ASSIGN_WORK_ROLES=false` | yes | Default. Do not roster-assign fisher/miner/farmer. |
| **New or WORLD-LAB sqlite** | yes, **ask first** | Do **not** reuse `data/civilization.sqlite` as-is (live-civ coords, no homes schema on disk). |
| `settlement.storage = tannery -1038,65,839` | recommended if they deposit | Sqlite only. Prevents adopting fishing/mining chests. |
| `claimHome` to H1/H2/… | **no** for this minimal run | Would script **home**, not task. Night = `seekSafety`. |
| Give rod / pickaxe / food | **no** | TEST_CONTROL would script capability. Bootstrap is the autonomous path. |
| Human / BLUE / GREEN on the same Paper | allowed | Do not kick. Keep others off the pond AABB and mine box if GREEN is not in a fish/mine window. |

### Must be autonomous (mind + body)

- Whether to gather wood, craft a pickaxe, seek food, deposit, or idle (`planCitizen` / LLM).
- Where to walk (BLUE navigator). Doors, 1-block steps.
- Whether to remember a chest (`rememberWorkstation` / `knownChest`).
- Night: `seekSafety` unless a real claim exists.

**This scenario will not fish or sleep in H1 by itself.** That is correct given current planner + sqlite. It **can** demonstrate one body surviving on Site C grass with communal tannery if storage is pointed there.

### Not this test

- `pnpm mechanics:two-fish` / `mechanics:fish` / `mechanics:mine` / `mechanics:home`
- Human `ADMIN_OVERRIDE` obtain_item (that **is** a scripted task; live-civ sqlite already has Atlas on that)
- Refilling fish or coal

---

## If a world or sqlite change is genuinely required — ASK first

RED will not do these unless the user approves a specific cell/file:

1. **Sqlite:** copy/reset `data/civilization.sqlite` for WORLD-LAB (homes migration, null last_x or spawn `-1017,62,831`).  
2. **Home:** `claimHome` for one named citizen to a named house (not H1 unless you want the HomeProbe bed).  
3. **Code (GREEN/BLUE, not RED world):** `LLM_MAP` `fishShore`; stop `knownChest` from eating test fixtures; optional `claimHome` from the mind.  
4. **Blocks:** none required for the minimal run. Do not add rods to chests or new docks.

---

## WORLD-LAB now

| | |
| --- | --- |
| Paper | **up** 25567 / 25577, seed 20260919, 0 players |
| Exclusive claim | **none** |
| RED edits this pass | forceload add/remove only; leftover **0** |
| Next | GREEN: do not treat pond chests as civ storage. BLUE: H1 remains unassigned. User: approve sqlite/home if the integration should include sleep-at-home. |
