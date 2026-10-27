# Atlas Day 3 — Live Readiness (World-Lab)

Date: 2026-10-26  
Branch: `integration/reliability-pr7-windows`  
HEAD: `019d26d`  
Status: **READY FOR AUTHORIZED LIVE RUN** — Paper/Atlas not started until the operator explicitly authorizes.

Final-product direction (locked in the master Google Doc) remains longer-term. This document covers only Atlas’s autonomous survival milestone.

---

## What Day 2 proved vs what Day 3 must prove

| Area | Day 2 live (PARTIAL) | Day 3 offline gate | Day 3 live goal |
| --- | --- | --- | --- |
| Gather / craft | PASS (wood, pickaxe) | Regression tests PASS | Reconfirm without drowning |
| Food | FAIL (`FOOD_NOT_FOUND` ×362) | Food backoff + fishing fallback coded | Acquire real inventory food |
| Water | FAIL (one drown while gathering) | Dig refused in liquid | No drown |
| Navigate to Site C | PASS (walk, no teleport) | — | Walk again if needed |
| Reach H9 / bed | FAIL (crafting_table STUCK) | Lateral bypass, no furniture dig | Enter home, use bed |
| Curfew | NOT TESTED (sequence missing claim seed) | Seed `home_h9` membership | Observe real curfew |
| Sleep | FAIL (19× STUCK/TIMEOUT) | Sleep-route backoff | One legal bed sleep |
| Morning resume | BLOCKED by food spin | Food backoff | Meaningful daytime activity |
| Clean shutdown | PASS (Node); Paper RCON stop | — | Clean Node stop + evidence |

Offline tests do **not** prove autonomous gameplay. They only show the intended failure modes are bounded and honest.

---

## Isolation (hard rules)

| Item | Required |
| --- | --- |
| Paper | `world-lab/start.bat` → `127.0.0.1:25567` (jar in `world-lab/`, not `server/`) |
| RCON | `25577` |
| Database | `./data/world-lab-civilization.sqlite` |
| Bodies | Atlas only |
| Pins | Harness forces `AUTO_START_PAPER=false`, `SIM_CITIZEN_COUNT=1`, no work-role assignment, no mechanics probe |
| Forbidden | `pnpm sim:start`, port 25565/25566, teleport, `/time set`, free items, extra citizens, Cloud Brain V2, resetting world/DB |

Root `.env` still targets live-civ `25565` / `civilization.sqlite`. That is expected. `world-lab:one-citizen` **pins** World-Lab after dotenv.

---

## Starting state (recorded at Day 3 gate; re-check at launch)

| Field | Value |
| --- | --- |
| playerdata Pos | `-1035.68, 64, 836.63` (Site C / near H9 street — **not** pond) |
| SQLite | `citizen_atlas` → `home_h9`, hunger 8, health 20, last_* matches playerdata this time |
| Membership | active; bed `-1067,68,848` |
| Last Day 2 inventory | wooden_pickaxe×1, oak_planks×3, stick×2 — **no food, no fishing_rod** |
| World `DayTime` (offline parse) | mod 24000 ≈ **11980** (late day) when last gated |
| Observation window | default **25 min** wall clock ≈ one MC day @ 20 TPS — covers night→morning **without** time cheat |

Fishing fallback requires rod + visible shore + authorized storage. Without a rod, Atlas must obtain food another honest way (or craft/find a rod). Do not inject items.

---

## Launch sequence (operator)

1. Confirm ports **25565 / 25567 / 25577 idle** and no unintended `java`.
2. Start World-Lab Paper only:

```bat
cd <WORKSPACE>\world-lab
start.bat
```

3. Wait until `Done` / listening on **25567**.
4. Dry-run (must exit 0; pins World-Lab; no connect):

```bat
cd <WORKSPACE>
pnpm world-lab:one-citizen -- --dry-run
```

5. **Only after explicit human authorization**, live:

```bat
pnpm world-lab:one-citizen -- --live
```

Optional bound: `--max-ms=1500000` (default is already 25 minutes).

6. Watch Atlas. Do not teleport, give items, or set time.
7. Stop: Ctrl+C / harness time limit. Prefer orderly Paper stop via RCON only when the operator owns the window (`stop` after `save-all`).

Evidence directory pattern (create at launch): `artifacts/atlas-day3-live-YYYYMMDD-HHMMSS/`.

---

## Safety status (2026-10-26)

| Check | Result |
| --- | --- |
| Branch / HEAD | `integration/reliability-pr7-windows` @ `019d26d` |
| Day2 behavioral WIP vs freeze SHA256 | 8/8 match |
| Targeted vitest | **86/86** (planner, recovery, backoff, gather, return-home, sequence, fish, guard) |
| Dry-run guard | pins 25567 + world-lab sqlite; `wouldConnectCitizen=true` |
| Paper / Atlas this session | **not started** |
| World / DB / prior evidence | preserved |

### Known live risks (honest)

- No fishing_rod in last recorded inventory → fishing path may not arm until a rod exists.
- Communal/settlement storage unset → fishing that requires authorized chest may `ACCESS_DENIED` even with a rod/shore.
- Village furniture / crafting_table still a navigation hazard; bypass is coded but unproven live.
- Atlas SQLite status may still say `online` from an unclean prior stop; reconnect should normalize.

---

## LinkedIn-ready summary (draft — do not publish without owner approval)

> Building an AI citizen that must *survive* Minecraft for real — not scripted cutscenes. After Day 2, Atlas could gather and craft but drowned once, spun on food search hundreds of times, and could not reach his bed past a crafting table. We shipped bounded failure handling, a fishing fallback that only counts inventory gains, water-safe digging, and alternate home routing that refuses to break furniture. Day 3 is the live proof: one citizen, frozen survival world, no teleports, no free food, no time cheats.

---

## Next after Day 3 live

1. Score actual milestones from evidence (food, drown, H9, curfew, sleep, morning, SQLite, shutdown).
2. Smallest regression fixes only for confirmed live failures.
3. Then: document pass/fail and choose the next coding milestone toward a full independent citizen-day before scaling society.
