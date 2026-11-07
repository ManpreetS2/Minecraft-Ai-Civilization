# Remaining action-lifecycle gaps

Source SHA: `5ad304c0cbb624aca89ad265a0c9ba765f7c6bcd` (PR #69).
Branch: `fix/remaining-action-lifecycle-gaps`.
Reproduction: `qa/action-audit/evidence/red-before-gaps.txt`.
After the fix: `qa/action-audit/evidence/green-after-gaps.txt`.

## Confirmed before the change

Offline calls to the production functions, with the assertions that describe the desired behavior:

- AUD-X1. `craftItem` started a second `craft` about 6.2s after the first when the 6s race timed out (`calls` length 2). Cancellation did not return for 6213ms, because the race ignored the abort.
- AUD-X2. Aborting during the crafting-table look still recorded `placeBlock` after the abort. `ensureCraftingTable` also relabelled a later `CANCELLED` from that loop as `PLACE_FAILED`.
- AUD-X3. `openDoor` returned success after the signal aborted during look. `closeDoor` toggled the door a second time after the first toggle had already aborted the signal (2 toggles).
- AUD-X4. `attemptHazardBridge` returned success and placed cobblestone when the signal aborted during equip.
- Sleep. Cancellation during `bot.sleep` did not return within 250ms. A sleep that never resolves stayed pending past 800ms. A deadline that arrived after `isSleeping` was already true still reported success.
- Unowned writes. A `windowOpen` listener registered inside `createActionBoundary().run` could `write("window_click")` after the run had been cancelled, because the emit had no AsyncLocalStorage owner.

Success paths that already worked, and still work: one craft when the recipe finishes, a crafting table placed when nobody cancels, a door opened when nobody cancels, a bridge placed when nobody cancels, a bridge reported when `placeBlock` itself aborts and then completes, sleep-and-wake, a physics listener registered before the action, and a listener that writes while its action is still active.

## Fixed behavior

- Craft races each recipe against the abort signal and a 6s deadline. Timeout or cancellation does not start another recipe. If the inventory already increased, the result is success. Otherwise the result is `TIMEOUT` (retryable) or `CANCELLED` (not retryable). A late `activateBlock` for that attempt throws and does not change the inventory. The guard stays installed until that craft promise settles, and a newer craft replaces it by generation.
- The crafting-table loop checks the signal before equip, each cell, after look, and before `placeBlock`. A cell that is already a crafting table is reported as placed. `CANCELLED` and `INTERRUPTED` pass through `ensureCraftingTable`.
- Door activation checks the signal after look and immediately before `activateBlock`. `closeDoor` does not toggle again after cancellation. If the door already changed, the result is `INTERRUPTED` with the observed open state.
- The hazard bridge checks the signal after equip and immediately before `placeBlock`. `lookAt` is raced against the signal and a 1s deadline. A `placeBlock` that already returned is verified and reported, including when the signal aborted inside that call. Retreat checks the signal before the 8-tick walk.
- `bot.sleep` is raced against the signal and the remaining `timeoutMs`. Not yet sleeping and aborted is `CANCELLED`. Already sleeping is woken and reported as `INTERRUPTED`. No confirmation before the deadline is `TIMEOUT` and does not call `quit`. A sleep request that was already sent can still be accepted; the skill then wakes.
- Listeners registered on the bot or client during an action re-enter that action's owner. After the owner is deactivated, their mutating packet writes are refused. Listeners registered before the action stay unowned and are still allowed.

Death, disconnect, and kick already abort the citizen signal in the manager from PR #69. These tests drive that same signal. Shutdown is the skill deadline. None of these paths call `bot.quit`. Inventory counts are left as they were when a craft is cancelled. Item reservations, fishing, pathfinder plugin hooks, terrain memory, construction, and chest transfers were not rewritten.

## Not confirmed, and not changed

- Refusing every mutating write that has no owner. Pathfinder and physics listeners registered before an action must keep working. The new test locks that in.
- A live Paper server, a real pathfinder tick, and AsyncLocalStorage across every Mineflayer callback. The packet guard and the listener rebinding are offline.
- A craft or sleep packet that a real server has already accepted can still complete. The local skill refuses a later `activateBlock`, does not start another recipe, and wakes if sleep is confirmed after cancellation.
- The 8-tick hazard retreat, once started, still runs to completion. Creeper flee, the single `world.attack`, and unguarded `dropItem` / `equip` remain as recorded in the coverage table.
- Process restart of memories and construction sessions. This change does not touch the store. The existing manager tests still show disconnect and kick abort the physical action without dropping stored memory.
- Two actions overlapping on one shared emitter. Runs on one body are serialized. `off` unwraps listeners for the generation that wrapped them.

## Checks

- `pnpm exec vitest run --config qa/action-audit/vitest.config.ts --testTimeout=25000`: 5 files, 67 passed.
- Focused skills, hazard-nav, and action-boundary: 30 files, 235 passed.
- `pnpm test`: 201 files, 2276 passed. This does not include `qa/action-audit`.
- `pnpm test:security`: 21 files, 358 passed.
- `pnpm typecheck`: exit 0.
- `pnpm typecheck:tools`: exit 0.
- `pnpm typecheck:evidence-validator`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm build`: exit 0.

No Paper server, paid API call, or production world was used.
