# RED first citizen-day checklist (WORLD-LAB Atlas)

Date: 2026-09-20  
Status: **PREP ONLY.** No bot connect, teleport, world edit, sqlite write, `time set`, or live harness this pass.  
Use later when the user says they can watch. GREEN body/mind, BLUE nav/curfew. RED does not run it.

Companions: [RED_ONE_CITIZEN_INTEGRATION_PREP.md](./RED_ONE_CITIZEN_INTEGRATION_PREP.md), [RED_PROPERTY_SAFETY.md](./RED_PROPERTY_SAFETY.md), [GREEN_WORLD_LAB_SQLITE_PLAN.md](./GREEN_WORLD_LAB_SQLITE_PLAN.md), [BLUE_CURFEW_RUNTIME.md](./BLUE_CURFEW_RUNTIME.md)

---

## Launch (guarded command)

```
pnpm world-lab:one-citizen -- --dry-run
# only after the user is present and dry-run is clean:
pnpm world-lab:one-citizen -- --live
```

Do **not** use `pnpm sim:start`, `mechanics:fish` / `two-fish` / `mine` / `home` / `farm`, or a second Paper.

| Check | Required |
| --- | --- |
| Host / game / RCON | `127.0.0.1` **25567** / **25577** (never 25565 live-civ, never 25566 Mindcraft) |
| Version | Paper **1.21.11** (world-lab jar, not `server/paper.jar`) |
| `DATABASE_PATH` | `./data/world-lab-civilization.sqlite` only |
| Bodies | **Atlas** (`citizen_atlas`) only. Maya/Theo/Ava/Kai offline |
| Pins | `AUTO_START_PAPER=false`, `SIM_CITIZEN_COUNT=1`, `SIM_ASSIGN_WORK_ROLES=false`, `MECHANICS_PROBE_ENABLED=false` |
| Guard | `evaluateWorldLabOneCitizenLaunch` must `allowed: true` after pin |

Dry-run already prints dotenv-before-pin vs pinned keys. If unpinned `.env` still says 25565 / `civilization.sqlite` / count 5, that is expected; the one-citizen entrypoint must pin before connect.

**Offline sqlite snapshot (read-only, 2026-09-20):** five roster rows offline, `home_id` NULL, `homes=0`, `memberships=0`, `settlement.storage` unset. Re-read at launch; do not reset the file to “help” the test.

---

## 1. Join position (citizen fact vs TEST_CONTROL)

**`/tp Atlas -1061 68 847` is NOT authorized.** Do not teleport unless the user later approves that cell in a new sentence. Do not invent a different stand to make `claimHome` fire on tick 1.

| Source | Last known | Meaning |
| --- | --- | --- |
| Offline `player.dat` `1d4a9c61-6828-3517-9704-a0518eccaaa5` | **-1043.5, 63.0, 981.5** | Leftover fishing-spit body (Kai stand `-1043,63,980` / Atlas stand `-1044,63,981`). **TEST_CONTROL leftover, not Atlas choosing to fish.** |
| World spawn | `-1017, 62, 831` | Used only if playerdata is missing. H9 origin is **~51 m** (outside `HOME_CLAIM_REACH` 48). |
| Proposed H9 street | `-1061, 68, 847` | In reach of H9 (~4 m). **Operator teleport only.** |
| Lab sqlite `last_x/y/z` | NULL | Must not copy live-civ coords |

**At connect:** log `bot.entity.position` immediately. Compare to player.dat. That logged cell is the actual join. If it is the pond spit, that is acceptable start-of-test state.

Walking from the spit toward Site C (~136 m to H9) is a **citizen** path. Teleporting to H9 is **TEST_CONTROL** and remains an approval gate. Do not request teleport merely so the first claim is faster.

---

## 2. Read-only safety of the proposed H9 street (only if live window opens)

If the user has still not approved teleport, **skip this as a setup step** and observe from the real join cell.

If they approve teleport later, or you are only surveying, **read-only** `if block` (no place/break):

| Cell | Why |
| --- | --- |
| `-1061,68,847` and `-1061,69,847` | Proposed feet / head |
| `-1061,67,847` | Support. If air/lava, the stand is not a floor |
| `-1062,68,847` → `-1062,66,847` | Documented dirt_path at **Y=66** (possible 2-block drop, same class as H1 stoop) |
| `-1063,68,847` oak_stairs, `-1064,68,847` oak_door | H9 access |
| `-1065,68,847` origin, `-1067,68,848` yellow bed, `-1066,68,847` chest | Catalog H9; unclaimed until Atlas claims |

**Unsafe stand ⇒ do not fill, scaffold, or flatten.** Report the drop and let Atlas walk. Do not create a new fixture so the test passes.

---

## 3. Preserve existing fixtures (read-only)

Confirm **presence**. Do not open, empty, refill, or `setblock`. Last RED item counts (2026-09-20) are a baseline, not a quota to restore.

| Cell | Kind | Last known |
| --- | --- | --- |
| `-1042,63,980` | TEST_CONTROL Kai pond chest | chest, cod ×2 |
| `-1042,63,982` | TEST_CONTROL Atlas pond chest | chest, cod ×1, salmon ×2, tropical_fish ×1 |
| `-954,58,944` | TEST_CONTROL mine chest | chest, coal ×1 |
| `-1038,65,839` | Village tannery (intended communal, **not** yet sqlite storage) | bread + leather_helmet |
| H1/H2/H4/H5/H9 personal chests | Unclaimed catalog | empty singles |
| H1–H9 beds/doors | Village structures | leave standing |

Join on the spit is a **property-safety** trial: Atlas may see pond chests. Using them as work storage is a **FAIL**. Breaking them for ore/path is a **FAIL**. Walking past them is **PASS**.

---

## 4. Observation timeline (no `time set`)

Query once at start: `time query daytime` / `list` (read-only). One Minecraft day = 24000 ticks ≈ **20 min** real. Launcher bound: **25 min** wall clock or first claimed-bed sleep, then stop.

Vanilla ticks (BLUE `travel-home.ts`): sunset travel **11000**, curfew **12542**, sleep legal **13000–23000**, morning **≥23000**.

| If clock at join is… | Expect (citizen, not scripted) |
| --- | --- |
| Night, **no** claim | `seekSafety` / observe. **Not** H1 sleep. No house assigned by roster. |
| Night, claim already exists | Return to **that** bed only. Wait if before 13000; one `sleep()` after. |
| Day | Observe, gather, maybe `claimHome` on the **nearest in-reach catalog house** (often H9 from village, **not** default H1). Work only with authorized storage. |
| Tick ≥12542 with a claim | Stop optional work (`CURFEW_STOP`, not `ok()`). Walk home. |
| Inside before 13000 | `WAIT_INSIDE_HOME` (no sleep spam). |
| ≥13000 in claimed bed | One sleep on the designated bed. |
| Morning | Wait must end; daytime activity may resume. Next dusk repeats curfew. |

Do not `/time set`, `gamerule doDaylightCycle false`, or speed the day. Early arrival is a wait, not a clock cheat.

Fishing/mining are **not** required for this day. Planner still needs citizen-chosen targets; pond/mine fixtures are not jobs. No rod in house chests last audit.

---

## 5. PASS / PARTIAL / FAIL

**Citizen decisions** (score these): which house if any, whether to walk from the spit, gather/craft, ignore fixture chests, when to go home, wait vs sleep.

**TEST_CONTROL setup** (do not score as citizen): leftover pond spawn, unapproved teleport, `time set`, pre-`claimHome`, filling chests, kicking others, `sim:start`.

### PASS

- Guarded live run on **25567** + **world-lab-civilization.sqlite**, Atlas only.
- Actual join position logged; no teleport unless newly approved.
- Fixture chests and village furniture still present at stop; not adopted as `settlement.storage`.
- If a home is claimed: catalog id in reach, persisted as **citizen_atlas**, not H1-by-roster, not `probe_home`.
- If claimed before/during night: curfew leaves work, return to **claimed** interior, wait if early, one own-bed sleep, **no** `time set`.
- Stop via launcher SIGINT / 25 min bound / `manager.stop`. Nobody else kicked.

### PARTIAL

- Atlas connected and moved, fixtures intact, but **no claim** (still >48 m from houses, or chose not to). Night `seekSafety` without a bed is honest, not a hidden FAIL.
- Claim succeeded, but rooftop-drop / `HAZARD_BLOCKED` prevented return (BLUE known village risk). No teleport past it.
- Daytime work idle because communal storage is unset (tannery not in sqlite). Do not write storage just to force fish/mine.
- Clock never reached a second sleep before the 25 min bound.

### FAIL

- Port 25565/25566, live-civ sqlite, `AUTO_START_PAPER`, five-citizen `sim:start`, or extra roster bodies.
- Teleport / `claimHome` inject / `time set` / chest refill / block place to force a claim or sleep.
- Atlas uses or breaks pond/mine chests; tannery looted as if personal.
- H1 (or any house) assigned without reach + citizen `claimHome`.
- Other players/bots kicked, Paper restarted, difficulty/gamerules flipped, world-lab sqlite reset.
- Fish/mine reported **success** when stopping for curfew (`ok()` after bedtime `break` — GREEN gap).
- Unilateral exclusive lock that boots a human or GREEN/BLUE already on 25567.

---

## 6. Safe stop and sharing

| Rule | |
| --- | --- |
| Stop | Ctrl+C / SIGTERM on `world-lab:one-citizen`, or 25 min timer. `manager.stop()` only. |
| Kick | **Never** `kick` Atlas, probes, or humans. Operator-only if they ask. |
| Paper | Leave 25567 up if it was up. Do not start 25565. Do not `stop` the jar unless the user owns that restart. |
| Clock / weather / gamerules | Operator only. GREEN/BLUE must not. |
| Overlap | Human spectator OK. Do not start FishProbe/MineProbe/HomeProbe in the same window. Shared non-interfering bots may stay. |
| After stop | `save-all flush` is operator/RED if they take the window. No chest “cleanup.” |

---

## Remaining approval gates (do not do these to make the test pass)

1. **Teleport** `/tp Atlas -1061 68 847` (or any other stand).
2. **Sqlite `settlement.storage`** → tannery `-1038,65,839`.
3. **Pre-claim** any house for Atlas.
4. **Give** rod / pickaxe / food / refill fixtures.
5. **`time set`** or daylight freeze.
6. **Reset** `world-lab-civilization.sqlite` or live-civ sqlite.
7. **World edit** of the H9 drop or pond spit.

Offline snapshot is not a live PASS. Re-check join Pos, clock, `list`, and chest **presence** when the user is available.
