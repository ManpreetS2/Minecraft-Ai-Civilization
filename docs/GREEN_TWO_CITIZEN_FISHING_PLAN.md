# GREEN two-citizen same-pond fishing

Date: 2026-09-20  
Owner: Agent GREEN  
Status: **Bounded 2-each live check PASS** (`TWO_FISH_TARGET=2`). See [GREEN_TWO_FISH_LIVE.md](./GREEN_TWO_FISH_LIVE.md) and [GREEN_TWO_FISH_CHECK2.log](./GREEN_TWO_FISH_CHECK2.log). Not a 5/5 quota PASS. Not a cognition PASS.

Original single-bot **FISHING_LIVE=PASS** in [GREEN_FISHING_LIVE_RUN.md](./GREEN_FISHING_LIVE_RUN.md) is unchanged. Visual replay PASS in [GREEN_FISHING_VISUAL_REPLAY.md](./GREEN_FISHING_VISUAL_REPLAY.md) is unchanged. Mining coal ×1 is unchanged.

`packages/agent-core/src/executor.ts` was **not** edited.

---

## MISSING_FISH_INVESTIGATION=INCONCLUSIVE

Target: FishProbe chest **`-1042,63,980`**, previously salmon ×1 + cod ×1, now **`Items: []`**. Mining chest **`-954,58,944`** still **coal ×1**. Nothing was replaced. World was not reset.

### What the evidence establishes

| Claim | Evidence |
| --- | --- |
| Chest still exists | RCON `execute if block -1042 63 980 minecraft:chest` → Test passed. Current `Items: []`. |
| Last known good contents | Visual replay after-state and the failed FishProbe **chest-before** line (~15:39:06) still showed salmon + slot 1 (cod). |
| FishProbe harness did **not** clear that chest | `live-fish-test.ts` only `clear FishProbe` (player inventory). `FISH_TEST_PLACE_CHEST` was unset, so no `setblock ... chest replace`. No `data merge` of this chest in GREEN fishing code. `world-lab/logs/latest.log` has **no** `[Rcon: Changed the block at -1042, 63, 980]` after RED’s original install at **15:21:31**. |
| HomeProbe did **not** RCON-edit this chest | HomeProbe RCON `Changed the block` lines are **203,67,400** / **203,68,400** (BLUE movement pad). Login/tp points: pad `202.5,67,400.5`, village street `-1082.5,68,799.5`, H1 `-1095.5,69,731.5`. **No** HomeProbe position at the pond. `live-home-test.ts` `data merge` is **`-1096,69,729`** (H1 personal), not `-1042`. `live-curfew-test.ts` only **reads** the fishing chest (`if items ... salmon/cod`). |
| BLUE kicked FishProbe during the failed watch | **15:39:16** `Kicked FishProbe: BLUE exclusive WORLD-LAB window after GREEN FishProbe release`. Kick/disconnect does not log a chest mutation. The 47s `SEARCH_EXHAUSTED` is a **missed bite plus disconnect**, not proof fishing is broken. |
| Human commands in the empty window | **15:38:43** `/clear @s` removed **166 items from Shadowskiii1** (player inventory, not a chest). **15:39:41** `/gamemode creative` while the player had just been at the fishing camera. Paper does **not** log chest loot. |

### What is not established

Who removed salmon/cod from `-1042,63,980` between ~15:39:06 and the empty read at **15:39:58**. No container-open log exists. Actor is **INCONCLUSIVE**. Do not `/give` those fish back.

---

## World-sharing policy (implemented)

The new two-fish guard does **not** refuse merely because HomeProbe is on `list`.

- Server lifecycle / time / weather / gamerules: not taken by GREEN. Two-fish harness does **not** `time set`, `weather`, restart Paper, or teleport the human.
- Fishing site owner: GREEN. BLUE movement pad (~200,67,400) and H1 are outside the fishing AABB.
- `TWO_FISH_BLUE_SHARED=true` required so BLUE will not kick fishing bodies and will not mutate the pond.
- Concurrent `MECHANICS_CURFEW` / `HOME` / `FISH` / `MINE` / `FARM` / `TWO_PROBE` env flags → refuse (those harnesses own global time/RCON).
- Live admission: read every occupant’s Pos. HomeProbe **outside** the fishing AABB is left connected. A body **inside** the AABB is **not kicked**; launch is refused. Human may spectate unless standing on a stand/chest cell.
- Single-probe `live-fish-test.ts` still refuses HomeProbe on `list`. That guard was **not** weakened.

---

## Same-pond geometry (read-only; not placed)

RED’s approved pond around **`-1043,63,980`**. GREEN read-only RCON (no `setblock`):

| Role | Proposed stand | Floor / water | Status |
| --- | --- | --- | --- |
| **Kai** | **`-1043,63,980`** | grass; water west **`-1044,62,980`** | RED-verified dry origin |
| **Atlas** | **`-1044,63,981`** | grass; water west **`-1045,62,981`** | Adjacent bank on the **same** water; xz dist **1.4** (min 1, max 8) |

They are next to each other, not the same block, not two distant fisheries.

| Role | Chest | Status |
| --- | --- | --- |
| **Kai** | **`-1042,63,980`** | Existing FishProbe chest, currently **empty**. Reuse. Do **not** replace or fill. |
| **Atlas** | **`-1042,63,982`** | Read-only: **air** / air / grass. **Not adjacent** to Kai’s chest (Z differs by 2), so it will not become a double chest. **Not installed.** |

**User approval required before placing** one empty ordinary single `minecraft:chest` at **`-1042, 63, 982`**. GREEN will not place it until that sentence exists. RED should re-read both stands after approval.

Do not use mining `-954,58,944`, tannery `-1038,65,839`, H1 personal `-1096,69,729`, or any claimed home chest. Do not claim homes for this test.

---

## Harness (gated; not launched)

- Skill: `packages/skills/src/fish-quota.ts` `fishQuotaAtShore` — per-owner ledger, 5 real fish (cod/salmon/tropical_fish/pufferfish), exact deposit of **new** catches only, PARTIAL x/5 on timeout, no duplicate event credit.
- Guard: `apps/orchestrator/src/two-fish-test-guard.ts`
- Live: `pnpm mechanics:two-fish` → `live-two-fish-test.ts`
- Identities: **Kai** and **Atlas** (offline WORLD-LAB usernames). Not `pnpm sim:start`. No sqlite home claim. No fisher occupation.
- TEST_CONTROL per body: `op`, `tp` onto **that** stand, `clear` **that** player, one `fishing_rod`. Never `/give` fish.
- Timeout budget: **420000 ms** per citizen (30s–600s allowed). A 47s empty cast is **0/5 or SEARCH_EXHAUSTED**, not a permanent fishing FAIL.
- One body failing does not write the other ledger.
- Return-home: **SKIP** (no claimed beds in this harness).

Without flags, `pnpm mechanics:two-fish` exits **2**.

Suggested launch **after** Atlas chest install + RED confirm + BLUE share + user ready:

```
set MECHANICS_TWO_FISH_TEST_ENABLED=true
set TWO_FISH_ALLOW_WORLD_MUTATION=true
set TWO_FISH_RED_APPROVED=true
set TWO_FISH_BLUE_SHARED=true
set TWO_FISH_USER_APPROVED=true
set TWO_FISH_KAI_ORIGIN=-1043,63,980
set TWO_FISH_ATLAS_ORIGIN=-1044,63,981
set TWO_FISH_KAI_CHEST=-1042,63,980
set TWO_FISH_ATLAS_CHEST=-1042,63,982
set TWO_FISH_TIMEOUT_MS=420000
set TWO_FISH_MAX_ATTEMPTS=12
set AUTO_START_PAPER=false
pnpm mechanics:two-fish
```

---

## Live verdicts (not yet run)

```
KAI_CATCHES=n/a
ATLAS_CATCHES=n/a
KAI_DEPOSIT=n/a
ATLAS_DEPOSIT=n/a
TWO_BOT_CONCURRENCY=n/a
STORAGE_ISOLATION=n/a
MISSING_FISH_INVESTIGATION=INCONCLUSIVE
RETURN_HOME=SKIP
```

---

## Blockers before launch

1. **User** explicitly approves placing one empty single chest at **`-1042,63,982`** (or names another legal cell that will not merge with `-1042,63,980`).
2. **RED** re-reads both stands and both chests after that placement.
3. **BLUE** sets `TWO_FISH_BLUE_SHARED` (no kick of Kai/Atlas; no pond/`time set` during the run). HomeProbe may remain at H1/pad.
4. Human not standing in the four stand/chest cells (spectator perch **`-1034.5,70,984.5`** is outside those cells).
5. Do not start `pnpm sim:start` or five citizens.
