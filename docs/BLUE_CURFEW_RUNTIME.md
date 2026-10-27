# BLUE autonomous return-home and bedtime (runtime)

Date: 2026-09-20  
Owner: Agent BLUE  
Status: **WAIT_INSIDE_HOME integrated in unit tests.** No live one-citizen run. Not `pnpm sim:start`. Not a five-citizen PASS. Planner house-choice remains UNVERIFIED.

Live pad/H1 evidence is unchanged: one-block landing, two-block oak-log detour, lava/magma `HAZARD_BLOCKED`, work-to-H1 walk, H1 own-bed sleep.

---

## Runtime path (not a harness go-home)

1. `evaluateReturnHome` / `evaluateCitizenCurfew` — stop optional work when travel + stall recovery + 20s margin no longer fits before tick 12542, using the **claimed** interior, never a hardcoded H1. ETA is straight-line; `routeGuaranteed: false`.
2. Manager aborts **that** citizen’s `AbortSignal` if a long skill is still running. Sleep / `WAIT_INSIDE_HOME` / GREEN `returnHome` / flee / eat are not aborted. Other bots are not touched.
3. Planner emits `waitInsideHome` when already inside before vanilla 13000, otherwise `sleep` / `sleep_at_home`. Beats LLM/work; does not beat flee/eat or `ADMIN_OVERRIDE`. Vanilla morning does not keep the wait running.
4. Executor `waitInsideHome` and `sleep` both call `executeSleepAtHome`. GREEN `returnHome` remains walk-only.
5. `executeSleepAtHome` walks (`executeReturnHome`), enters (`enterClaimedHouse`, skip extra nav if already inside, do not toggle an open door), **waits inside without calling `sleep()`**, then sleeps the designated bed once. Doorway ≠ interior ≠ sleep.
6. Runtime does not `time set`. Early arrival is a bounded interruptible wait, not sleep spam.

---

## Tests

| File | Covers |
| --- | --- |
| `packages/agent-core/src/wait-inside-home.test.ts` | Wait until 13000, abort, missing bed, disconnect, daylight, per-citizen abort isolation |
| `packages/agent-core/src/curfew-runtime.test.ts` | Leave-early ETA, own claim not H1, no-home, interrupt ≠ complete, wait/returnHome not aborted |
| `packages/agent-core/src/planner.test.ts` | Early wait, night sleep, CURFEW_STOP handoff, Maya H4, sunrise does not wait |
| `packages/agent-core/src/home-ops.test.ts` | Wait → own bed; `PATH_BLOCKED` / `HAZARD_BLOCKED` no teleport; bed destroyed during wait; abort wait |
| `packages/minecraft-adapter/src/enter-home.test.ts` | Interior vs entrance; already-open door not toggled |
| `packages/minecraft-adapter/src/travel-home.test.ts` | `CURFEW_STOP`, `routeGuaranteed: false`, vanilla 13000 vs sunset |

---

## Navigation limitations (honest)

- Shared one-block jump (0–2 tick approach, two retries) and two-block side-cell detour are preserved. `pathing.ts` / `step-jump.ts` / `obstacle-detour.ts` were **not** rewritten for this task.
- Village **rooftop-drop** paths can still abort as retryable `HAZARD_BLOCKED` when the path includes an unverified fall. Recovery may replan (max 2); a route with no verified standing cell stays `HAZARD_BLOCKED` / `PATH_BLOCKED`. Do not teleport past it.
- `evaluateReturnHome` uses straight-line distance plus one stall-recovery buffer. It is not a pathfinder cost and is not a guaranteed safe return.

---

## Blockers before a one-citizen live run

1. GREEN must not report mine/fish **success** when stopping for curfew (`mine.ts` / `fish.ts` loop `break` → `ok`). See [BLUE_GREEN_CURFEW_RUNTIME.md](./BLUE_GREEN_CURFEW_RUNTIME.md).
2. `obtainItem` does not poll `AbortSignal`; a long craft may finish before curfew abort is noticed.
3. Rooftop-drop recovery is still a live risk on the village walk.
4. User/RED exclusive WORLD-LAB + one claimed home (not five citizens) still required. Do not start `pnpm sim:start` from this task.
5. Next uninterrupted WORLD-LAB run must verify early arrival wait (no `time set`), then own-bed sleep after 13000, with jump/detour still intact.
