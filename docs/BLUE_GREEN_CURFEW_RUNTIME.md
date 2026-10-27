# BLUE → GREEN: WAIT_INSIDE_HOME / curfew handoff contract

Date: 2026-09-20  
From: Agent BLUE  
Shared files touched this pass: `planner.ts` (curfew emit + skip corrective on handoff codes), `executor.ts` (**additive** `waitInsideHome` next to `sleep` only; `fishShore` / `claimHome` / `returnHome` left as GREEN walk-only), `manager.ts` (infra failure codes).  

Do **not** rewrite GREEN `fish.ts` / `fish-quota.ts` / `mine.ts` / `activity-choice.ts`. BLUE did not change verified two-bot fishing.

No `time set`, no `pnpm sim:start`, no live harness this pass.

---

## How planner/executor invokes WAIT_INSIDE_HOME → own-bed sleep

```
work (fishShore / mineOre / ...)
  → manager aborts THIS citizen's AbortSignal when shouldAbortActiveWorkForCurfew
  → skill returns CURFEW_STOP | CANCELLED | INTERRUPTED  (never ok())
  → next tick planCitizen:
        already inside claimed interior AND tick < 13000 (and not thundering)
          → action waitInsideHome, task WAIT_INSIDE_HOME, target = claimed bed
        else shouldLeaveWork and not vanilla morning
          → action sleep, task sleep_at_home, target = claimed bed
  → executor:
        waitInsideHome | sleep  → executeSleepAtHome
        returnHome              → executeReturnHome (GREEN walk only; no wait, no sleep)
  → executeSleepAtHome:
        walk if outside (PATH_BLOCKED / HAZARD_BLOCKED returned as-is, no teleport)
        enterClaimedHouse (skip extra nav if already inside; do not toggle an open door)
        waitInsideHomeUntilSleepTime  ← no bot.sleep() calls, poll ~500ms, bounded
        then ONE sleep() on the designated claimed bed
```

`chooseActivity` may still emit `returnHome`. BLUE `planCitizen` curfew runs **before** `autonomousWork`, so a claimed-home curfew tick emits `waitInsideHome` / `sleep`, not GREEN `returnHome`. If a tick still runs `returnHome`, it only walks; the following tick BLUE wait/sleep finishes bedtime.

Do **not** map `waitInsideHome` onto `returnHome`. Do **not** call `sleep()` from fish/mine.

---

## Failed / interrupted work → curfew manager

| Layer | Contract |
| --- | --- |
| Manager | If `citizen.busy` and `shouldAbortActiveWorkForCurfew`, abort **that** citizen's controller only. Never Atlas's abort for Maya. |
| Not aborted | `sleep`, `waitInsideHome`, `returnHome`, `flee`, `eatFood` (and their tasks). |
| Skill result | `curfewWorkInterrupted(...)` → `CURFEW_STOP`, or honor `ctx.signal` as `CANCELLED`. `workComplete: false`. Inventory snapshot only. |
| Classification | `CURFEW_STOP` / `CANCELLED` / `INTERRUPTED` are `INTERRUPTED` skills. `workHandoffToCurfew(code)` is true. |
| Next planner tick | Handoff codes do **not** run `correctiveFromFailure`. Curfew re-evaluates and emits wait/sleep. |

Helpers GREEN should keep using:

- `evaluateReturnHome({ position, home, timeOfDay })` — `shouldStopOptionalWork` means leave. `routeGuaranteed` is always `false` (straight-line + one recovery buffer, not a safe-path proof).
- `curfewWorkInterrupted({ plan, durationMs, inventory })`
- `ctx.signal`
- `resolveHomeSleepTarget(store, citizenId)` / claimed bed only. Never hardcode H1.

---

## WAIT_INSIDE_HOME rules

- Interruptible (`AbortSignal` → `CANCELLED`), stays inside, does not walk back out, does not reassign the bed.
- Missing/destroyed bed → `BED_MISSING`, claim marked displaced, not reassigned.
- Disconnect → `NOT_CONNECTED`.
- Daylight after a sunset/night wait → `NOT_SLEEP_TIME`, stay inside; next tick may resume work (vanilla morning does not keep waiting).
- Runtime never `time set`. One `sleep()` after the wait becomes legal (`>= 13000` or thunder).

---

## Known GREEN skill gap (still GREEN-owned)

`mine.ts` / `fish.ts` must not `ok()` after a bedtime `break`. Return `CURFEW_STOP`. BLUE did not edit those files.
