# GREEN fishing live-test plan (FishProbe)

Date: 2026-09-19  
Owner: Agent GREEN  
Status: **Harness prepared. FishProbe not launched.** Physical fishing live = **UNVERIFIED**. Return-home live = **UNVERIFIED**.

Mining live PASS is preserved in `docs/GREEN_MINING_LIVE_RUN.md`. Do **not** re-mine **-953,58,946**. Do **not** reset WORLD-LAB. Do **not** reuse chest **-954,58,944**.

## Readiness

| Item | Status |
| --- | --- |
| Skill `fishAtShore` + 10 unit tests (rod, shore, cancel, chest, curfew stop) | Ready |
| Guarded harness `pnpm mechanics:fish` | Ready, **blocked by flags** |
| RED shore + chest | **Blocker** — not supplied |
| BLUE exclusive WORLD-LAB release | **Blocker** — confirm idle before launch |
| User `FISH_TEST_USER_APPROVED` | **Blocker** |
| `FISH_TEST_ORIGIN` / `FISH_TEST_CHEST` | **Blocker** — do not invent |
| Return-home `FISH_TEST_HOME` | Optional; SKIP return-home if omitted |
| Two-bot / five citizens | **Not this test** |

Default `pnpm mechanics:fish` without flags exits **2** and prints the needs list. That is not a live FAIL.

## Exact approval and port controls

Launch is refused unless **all** of:

- `MECHANICS_FISH_TEST_ENABLED=true`
- `FISH_TEST_ALLOW_WORLD_MUTATION=true`
- `FISH_TEST_RED_APPROVED=true`
- `FISH_TEST_BLUE_IDLE=true`
- `FISH_TEST_USER_APPROVED=true`
- `FISH_TEST_PORT=25567` (never 25565 / 25566)
- `FISH_TEST_RCON_PORT=25577` (never 25575)
- `FISH_TEST_VERSION=1.21.11`
- `FISH_TEST_ORIGIN=x,y,z` standing shore cell
- `FISH_TEST_CHEST=x,y,z` designated deposit only
- `FISH_TEST_RADIUS` 1–16, `FISH_TEST_CASTS` 1–4, `FISH_TEST_TIMEOUT_MS` 5000–90000

Concurrent `MECHANICS_HOME_TEST_ENABLED` / `FARM` / `MINE` / `TWO_PROBE` → refuse.

Username **FishProbe** only (reserved). Not HomeProbe / MineProbe / FarmProbe / MechProbe / citizens.

## Preserve / refuse

Origin refused within:

- 64 m of Site C `(-1032, 888)`
- 32 m of farm pad `(20, 240)`
- 48 m of H1 `(-1097, 728)`
- 24 m of the **coal pocket** `(-953, 945)`

Chest refused if it is Site C, tannery `-1038,65,839`, H1 personal `-1096,69,729`, or the mining chest **-954,58,944**.

## What the harness does (when approved)

TEST_CONTROL only: `op`, `tp` to origin, `clear`, **one** `fishing_rod`. Never `/give` fish. Never `/setblock` water. Chest `setblock` only if `FISH_TEST_PLACE_CHEST=true` after user approval.

Stages (each labeled; fishing vs return-home stay separate):

1. Paper 1.21.11
2. No other probes on `list`
3. **Rod prerequisite** — inventory has `fishing_rod`
4. **Cancel before cast** — aborted `AbortSignal` must return `CANCELLED` (not a catch)
5. Record **inventory before**, **chest NBT before**, **tick**, **position**
6. `fishAtShore` via BLUE `navigateNear`, dry shore only, bounded casts/time
7. Record **catch type**, **inventory after**, **chest after**, tick, position
8. **FISHING_LIVE=PASS** only if a real catch appears in inventory and/or the designated chest
9. If `FISH_TEST_RETURN_HOME=true` and `FISH_TEST_HOME` set: record **departTick / departPos**, walk with BLUE `navigationBackend().navigateNear` (no teleport), record **arriveTick / arrivePos**. **RETURN_HOME_LIVE=PASS** only if distance to home ≤ 6. Failure here does **not** rewrite a fishing PASS into a fishing FAIL in the log lines; overall process still exits 1 if return-home failed.
10. `deop FishProbe`, disconnect

`SEARCH_EXHAUSTED` → `FISHING_LIVE=NOT FOUND` (exit 3), not PASS.  
Curfew stop during a cast (`TIMEOUT` / return-home request before a catch) → fishing FAIL at stage **fish from shore** (`RETURN_HOME_REQUEST`), not a fishing PASS.

## Skill audit (GREEN files only)

| Requirement | Where | Live |
| --- | --- | --- |
| Real rod | `evaluateFishingRequest` `MISSING_TOOL`; harness give + count | UNVERIFIED |
| Safe shore, no swim | dry stand + adjacent water; `HAZARD_BLOCKED` in liquid | UNVERIFIED |
| Catch / inventory delta | `snapshotCatchCounts` + chest NBT before/after | UNVERIFIED |
| Authorized container | `assertPermittedStorage` | UNVERIFIED |
| Cancel | `ctx.signal` + harness abort stage | unit PASS, live UNVERIFIED |
| Early return-home request | `fishingHomeStop` / `evaluateReturnHome` during casts and bite wait | unit PASS, live UNVERIFIED |
| Physical walk home | harness stage only, BLUE navigator | UNVERIFIED |

`packages/agent-core/src/executor.ts`: GREEN previously wired `fishShore` + `claimedBed` → `returnHome`. **No further executor edits this pass.** BLUE owns homes schema / bed logic; GREEN will not touch those. Coordinate before mixing more executor changes.

## Suggested launch (after RED site + BLUE idle + user)

```
set MECHANICS_FISH_TEST_ENABLED=true
set FISH_TEST_ALLOW_WORLD_MUTATION=true
set FISH_TEST_RED_APPROVED=true
set FISH_TEST_BLUE_IDLE=true
set FISH_TEST_USER_APPROVED=true
set FISH_TEST_PORT=25567
set FISH_TEST_RCON_PORT=25577
set FISH_TEST_VERSION=1.21.11
set FISH_TEST_ORIGIN=x,y,z
set FISH_TEST_CHEST=x,y,z
set FISH_TEST_RADIUS=8
set FISH_TEST_CASTS=1
set FISH_TEST_TIMEOUT_MS=60000
set FISH_TEST_USERNAME=FishProbe
rem optional:
set FISH_TEST_PLACE_CHEST=true
set FISH_TEST_RETURN_HOME=true
set FISH_TEST_HOME=x,y,z
pnpm mechanics:fish
```

Do not fill origin/chest until RED publishes them.

## Blockers

1. RED has not approved a shore (water + dry stand + empty test chest, away from preserves and the coal pocket).
2. BLUE has not confirmed WORLD-LAB is idle for FishProbe (movement/home work may still need the lab).
3. User has not set `FISH_TEST_USER_APPROVED` or approved a chest cell.
4. Return-home live needs BLUE-stable navigator plus an approved `FISH_TEST_HOME` (H1 bed is BLUE’s fixture; do not invent it as a fishing shore).
5. Two-bot and five-citizen runs stay blocked; this harness is FishProbe only.

## Files

- `apps/orchestrator/src/fish-test-guard.ts` + `.test.ts`
- `apps/orchestrator/src/live-fish-test.ts`
- `packages/skills/src/fish.ts` + `fish.test.ts`
- Script: `pnpm mechanics:fish`
