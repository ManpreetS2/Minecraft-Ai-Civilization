# Fishing cleanup and remaining lifecycle defects

Candidate before this change: `012b8e77eb54e01910e93cd2a31718623dc0ac08` (PR #74).
Independent QA source: `qa/skill-cancellation-lifecycle-review` at `05a5acf4c0309830ef402dc6bb34d3597bf242c0`.
Report: `qa/v69/reports/PR69_5ad304c.md`.
Red log: `qa/v69/evidence/red-before.txt`.
Green log: `qa/v69/evidence/green-after.txt`.

The QA suite was run on PR #74's tree before any production edit. `it.fails` passing means the defect was still present. Those cases are ordinary `it` assertions now.

## Red, before the change

Suite: 2 failed, 55 passed (57). The two failures were the dig child, which the suite spawned from `qa-independent/v69/scripts/dig-timer-child.ts`. That path is not in this tree. The script that is present, `qa/v69/scripts/dig-timer-child.ts`, was run directly:

- `abandon-with-stop` exited 0. Wire: `block_dig`, `arm_animation`, `block_dig`.
- `abandon-no-stop` exited 1. Uncaught `late arm_animation refused` from mineflayer `digging.js` `setInterval` via `swingArm`.

The `it.fails` reproductions passed, so the defects remained after PR #74:

- QA69-M2. `retrieveWritesReachedWire=0`, `cycleError=LATE_WRITE_REFUSED`. The cancel retrieve never reached the wire.
- QA69-M3. `lateUseItemOnWire=1`. A bite 5ms after abort still sent `use_item`. PR #74 wraps listeners only when `emittersOf` is passed. This reproduction calls `createActionBoundary(() => client)` and does not, so the wrapper did not cover it. The fish handler also did not check the signal.
- QA69-M1. Workstation-free `basic_shelter_v1`, navigation calls 1–4: session `BLOCKED` with `ENTRANCE_BLOCKED` or `INTERIOR_UNREACHABLE`, not `CANCELLED`. Workshop validation cancel was already `IN_PROGRESS`.
- QA69-L1. Abort at 480ms started `takeFuel` after the abort. Through the packet guard, abort at 480ms and 520ms left an iron ingot in inventory and reported `SMELT_FAILED`.
- QA69-L2. Boundary result `TIMEOUT` after 83ms, then `ItemWithdrawn`. Inventory count was 2.

## Disposition

- QA69-M2. Fixed. `runBoundedCleanup` allows only the named packets until an explicit deadline (fishing retrieve: `use_item` for 250ms, hard cap 500ms). The permit is not a global `use_item` exemption. `block_place` inside that callback is still refused, and a `use_item` after the deadline is refused. A second cycle on an already-aborted signal returns `cancelled` without casting.
- QA69-M3. Fixed. The fish abort handler detaches its listeners synchronously. Bite, particle, spawn, and destroy handlers return when the signal is aborted, the attempt token no longer matches, or the client object was replaced. The guarded client is also bound as an emitter, so a listener registered during the action re-enters that owner. Tests cover an external bite, a delayed bite, listener removal, a stale listener from an older action generation, and a callback after the bot's client is replaced.
- QA69-M1. Fixed. Final validation returns `CANCELLED` or `INTERRUPTED` when approach, the door, the interior move, the workstation probe, or the exit move is aborted. The session stays `IN_PROGRESS`. Covered for `basic_shelter_v1` and the workshop blueprint. A JSON reload of that session can finish under static validation. A real `PATH_BLOCKED` with no abort still sets `BLOCKED`. A structurally invalid building is not marked complete.
- QA69-L1. Fixed. After the ingot is in inventory, cancellation does not start `takeInput` or `takeFuel`. A later refused click does not turn a collected ingot into `SMELT_FAILED`. If no ingot was collected, the result stays cancelled.
- QA69-L2. Fixed. When the withdraw settles after the signal has aborted, the result still reports the count that moved, and `ItemWithdrawn` is not emitted. The manager-facing boundary result stays `TIMEOUT` when the skill misses the grace window. The inventory change that already happened is left in place.
- QA69-L3. Fixed. Timers scheduled while an action runs swallow only `LATE_WRITE_REFUSED`. The packet is not written, and the dig interval no longer exits the process. Both dig-child modes now exit 0. Other errors still propagate. The suite points at `qa/v69/scripts/dig-timer-child.ts`.

## Green

- `pnpm exec vitest run --config qa/v69/vitest.config.ts --testTimeout=30000`: 5 files, 62 passed. Exit 0. `qa/v69/evidence/green-after.txt`.
- `pnpm exec vitest run --config qa/action-audit/vitest.config.ts --testTimeout=25000`: 5 files, 67 passed. Exit 0. `qa/v69/evidence/action-audit.txt`.
- Focused fish, furnace, inventory, action-boundary, and construction-production tests: 5 files, 46 passed. Exit 0. `qa/v69/evidence/focused.txt`.
- `pnpm test`: 201 files, 2276 passed. Exit 0. `qa/v69/evidence/workspace-test.txt`.
- `pnpm test:security`: 21 files, 358 passed. Exit 0. `qa/v69/evidence/security.txt`.
- `pnpm test:v1`: 9 files, 100 passed. Exit 0. `qa/v69/evidence/v1.txt`.
- `pnpm typecheck`, `pnpm typecheck:tools`, `pnpm typecheck:evidence-validator`, `pnpm lint`, `pnpm build`: exit 0.

## Not proven

- A real Paper server, a real fishing bobber, and a real pathfinder tick. The dig check uses mineflayer's digging plugin on a stub bot.
- Linux and Windows. This run is macOS, Node v22.12.0.
- A 60-minute soak, live safety, and signing. Signing and live-authenticity certification stay disabled.
- Higher-level settlement recovery beyond the build session. The session stays `IN_PROGRESS` and is what `persistProject` stores. `INTERRUPTED` still emits `SettlementProjectBlocked`; that event does not itself flip the session to `BLOCKED`.
