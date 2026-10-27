# Isolated Live Construction Test Preparation

**Status: ISOLATED COPY PREPARED — NOT AUTHORIZED TO EXECUTE**  
Date: 2026-10-26  
Branch: `integration/reliability-pr7-windows` @ `019d26d` (+ Missions 005–006A WIP)

Offline / fake-Mineflayer green tests **do not** establish live placement success.

**Mission 006A:** disposable tree at `experiments/construction-006a/` (Paper **25568** / RCON **25578**). Original World-Lab remains **25567/25577**. See `CONSTRUCTION_MISSION006A_READINESS.md` and `experiments/construction-006a/OPERATOR_COMMANDS.md`.

## Safeguards (mandatory)

1. **Copy** World-Lab — never mutate the original H9 / Atlas / Day1–3 evidence world.
2. Preserve original `world-lab-civilization.sqlite` and experiment evidence directories.
3. Isolated ports (**25568/25578** on the copy; never retarget original 25567) and harness `.env` pins (`AUTO_START_PAPER=false`).
4. Confirm empty, loaded, unclaimed pad far from H9 / citizen furniture (proposed `(-900,70,700)` — verify in-game before use).
5. No teleport, creative give, `/setblock`, `/fill`, or time cheats.
6. Survival inventory only (documented starting counts).
7. Record start/end world + inventory snapshots before each stage (JSONL evidence logger).
8. **Operator must explicitly authorize** any Paper/Mineflayer launch — one stage at a time; no auto-advance.

## Staged sequence (abort on any failure)

| Stage | Action | Abort if |
| --- | --- | --- |
| 0 | Boot isolated Paper + Atlas only; dry-run connect | Wrong world / ports / H9 proximity |
| 1 | Place **one floor block** via production `placeBlock` | Nav fail, no neighbor, VERIFY_FAILED, wrong identity |
| 2 | Place **one supported wall** on that floor | Same |
| 3 | Place **door** in framed opening; verify lower+upper + facing/half | Upper missing, wrong facing, purposeless doorway |
| 4 | Small cabin (workshop footprint) via `executeBuildStructurePlan` | Site select fail, claim deny, shortfall, BLOCKED |
| 5 | Full world reconcile + property verify → COMPLETED | Any unknown / wrong / unverified / persist fail |

## Suggested operator commands (do not run until authorized)

```
# 1) Copy World-Lab + sqlite to a scratch directory
# 2) Point harness AUTO_START_PAPER / ports at the copy only
# 3) Launch Paper (isolated) — REQUIRES OPERATOR AUTH
# 4) Connect Atlas only — REQUIRES OPERATOR AUTH
# 5) Run staged construction script with evidence logging
```

Evidence dir should capture: timestamps, inventory diffs, blockAt samples at each stage, SQLite project rows, abort reason.

## GO criteria for later authorization

- Stages 1–3 succeed on the isolated copy with exact identity + door state.
- Stage 4–5 reach `worldVerifiedComplete` with persist OK.
- No damage to H9 / foreign furniture / roads.
- Original World-Lab untouched.
