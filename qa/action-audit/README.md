# Audit: Minecraft actions, cancellation and shutdown safety

**Audited source:** `1d7170741bdebe04e1c7c59eb210c0a357d5b0ea` (PR #61 head, on top of `875ebf7`). Date: 2026-11-05.
**Related:** PR #62 `45a1387b4a04a6de113be217cebca403582eccd0` (YC runner experiment, synthetic skills). Known issue **QA57-M1** is cross-referenced, not re-reported.
**Changes to production code:** none. Everything is under `qa/action-audit/`.

## Recommendation

**Add a small native boundary, and fix the confirmed skills directly. Do not import the YC runner.**

1. Fix the six confirmed skill defects (below) with ordinary signal checks and one bounded `openContainer` wrapper. That is the primary fix.
2. Add a native, proxy-free task boundary around `executePlan` in `manager.ts`: hard deadline, an ownership guard on mutating packets, and `busy` released only when the task settles or is abandoned. A prototype of about 160 lines (about 135 of code) (`src/native-boundary.ts`) fixed all five reproduced late-action defects against the real skills, and kept `bot._client` and bot-keyed state working, which the YC proxy did not.
3. Not recommended: importing YC's 729-line runner. Its extra value over (2) did not show up in this audit, and its proxy breaks fishing and per-bot state (PR #62).

Confidence: the defects are reproduced with real production functions on an offline body. Whether they bite in a live run is not measured. The boundary is a prototype, not tested on Paper.

## What "real" means here

- **Real:** `smeltItem`, `depositItem`, `placeBlock`, `huntAnimal`, `executeStructure`, `digUnlessAborted`, the `MinecraftBody` class and its event handlers, `OperationTracker`, and `terrainMemory`, all imported from the audited tree.
- **Controlled:** the Mineflayer bot, world and furnace/chest windows are offline doubles (`test/support/offline-body.ts`). Every world-affecting call writes a packet first and is timestamped, so a test can ask "did anything mutate after the abort?". Navigation is stubbed to succeed immediately unless the signal is already aborted (what the real backend does at entry); that is the exact interleaving under test.
- **Library behaviour copied, with its source cited:** mineflayer@4.39.0 `openBlock` is `activateBlock` then an unbounded `once(bot,'windowOpen')` (`lib/plugins/inventory.js:405-410`). A test reads that file and fails if it ever gains a timeout.
- **No skills were invented or broken** to make a point. Each uncooperative behaviour below is read from production source and then reproduced.

## Coverage of mutating call sites

`src/coverage.ts` is the table in executable form; `test/coverage.test.ts` re-scans `packages/` and `apps/` (tests and `testing/` helpers excluded, comment lines excluded) and fails if a call site is added or removed without updating it. 105 call sites in 26 files:

| Verdict                                                | Files | Calls | Meaning                                                             |
| ------------------------------------------------------ | ----- | ----- | ------------------------------------------------------------------- |
| protected                                              | 7     | 40    | signal checked before mutation, awaits bounded or raced             |
| **defect** (reproduced)                                | 4     | 27    | real function, offline body, reproduction in `test/defects.test.ts` |
| hypothetical (source pattern, **not** reproduced)      | 5     | 14    | worth fixing or watching; no test claims they misbehave             |
| body-owned                                             | 1     | 4     | `MinecraftBody` chat, whisper, respawn, stop cleanup                |
| operator scripts (`apps/orchestrator/src/live-*`, CLI) | 8     | 19    | no signal by design; not reachable from the manager loop            |
| not a bot call                                         | 1     | 1     | `input.deposit` callback in `fish-quota.ts`                         |

"Contains the word `signal`" was **not** used as evidence. Every production skill file with a mutating call references the signal somewhere, and four of them still have confirmed defects.

| File                                                    | Calls   | Reached from                                | Cancellation behaviour                                                                                              | Verdict      | Finding         |
| ------------------------------------------------------- | ------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------ | --------------- |
| `skills/src/dig-abort.ts`                               | 2       | collect, farm, blueprint-build              | listener installed before `bot.dig`; race against abort; `stopDigging`                                              | protected    |                 |
| `skills/src/inventory.ts`                               | 6       | eatFood, craftItem                          | eat checks before equip and consume, `waitAbortable`; craft checks per recipe, 6 s race, then tries the next recipe | hypothetical | AUD-X1          |
| `skills/src/inventory-service.ts`                       | 11      | deposit, withdraw, share, craft             | signal reaches navigation only; `openContainer` unbounded; `dropItem`, `equip` unchecked                            | **defect**   | AUD-C1, AUD-C2  |
| `skills/src/furnace.ts`                                 | 6       | craftItem (smelt)                           | signal reaches navigation only; `openFurnace` unbounded; polling loop and `takeOutput` unchecked                    | **defect**   | AUD-F1          |
| `skills/src/world.ts`                                   | 5       | sleep, attack, buildShelter, buildStructure | `placeBlock`: signal reaches navigation only; then equip, lookAt, placeBlock                                        | **defect**   | AUD-P1          |
| `skills/src/combat.ts`                                  | 5       | attack, gatherFood (`huntAnimal`), flee     | `attackHostile` loop checks; `huntAnimal` never mentions the signal                                                 | **defect**   | AUD-H1          |
| `skills/src/obtain.ts`                                  | 2       | obtainItem                                  | checked at entry and between steps; crafting-table placement loop unchecked                                         | hypothetical | AUD-X2          |
| `skills/src/farm.ts`                                    | 2       | workFarmPlot                                | `digUnlessAborted`; signal checked before each stage                                                                | protected    |                 |
| `skills/src/doors.ts`, `library.ts`                     | 1 + 1   | return home, openDoor                       | navigation takes the signal; one unguarded `activateBlock` after it                                                 | hypothetical | AUD-X3          |
| `skills/src/mineflayer-fish-cycle.ts`                   | 1       | fishShore                                   | checked every 50 ms, cancel-retrieve, listeners detached                                                            | protected    |                 |
| `skills/src/climb.ts`                                   | 6       | ladders                                     | loop checks and clears controls                                                                                     | protected    |                 |
| `minecraft-adapter/src/pathing.ts`                      | 4       | every navigation call                       | signal per slice, stall watch, halt on abort. **QA57-M1** (known) can hang a call via a raw `bot.lookAt`            | protected    | QA57-M1 (known) |
| `minecraft-adapter/src/step-jump.ts`, `local-escape.ts` | 11 + 14 | pathing recovery                            | signal checked, controls tick-bounded and cleared (QA57 audited these primitives)                                   | protected    |                 |
| `minecraft-adapter/src/hazard-nav.ts`                   | 4       | hazard bridge                               | signal at entry only; then equip, raw `lookAt`, `placeBlock`                                                        | hypothetical | AUD-X4          |
| `minecraft-adapter/src/minecraft-body.ts`               | 4       | body handlers, `chat`, `whisper`            | not skills                                                                                                          | body-owned   |                 |

Entry points: `bodyContext()` is created in exactly one production place (`manager.ts:730`), and the manager sets `ctx.signal` from a per-citizen `AbortController` (`:728-729`). `executePlan` is the only dispatcher. Actions started outside it are operator scripts.

## Confirmed defects (reproduced with real functions)

Measured by `test/defects.test.ts` (a plain `it` pins the number, an `it.fails` encodes the desired behaviour; each `it.fails` starts failing when the skill is fixed and must then be made a plain `it`).

| ID         | Skill                                                       | What happens after `AbortSignal` fires                                                                                                    | Measured                                                                     |
| ---------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **AUD-F1** | `smeltItem`                                                 | keeps polling, then `takeOutput` runs and the skill returns success                                                                       | `takeOutput` at +687 ms; returned after 989 ms (production polls up to 25 s) |
| **AUD-C1** | `depositItem` / `withdrawItem`                              | signal reaches navigation only; the transfer still lands                                                                                  | `chest.deposit` at +141 ms                                                   |
| **AUD-C2** | `depositItem` / `withdrawItem`                              | `openContainer` has no timeout in mineflayer 4.39.0, so a window that never opens hangs the skill past abort and past its own `timeoutMs` | still pending 900 ms after abort with `timeoutMs=300`                        |
| **AUD-P1** | `placeBlock`                                                | signal reaches navigation only; equip, look and the placement follow                                                                      | `placeBlock` at +91 ms (abort during a 150 ms equip)                         |
| **AUD-P2** | `executeStructure` (and `advanceBlueprintBuild`, by source) | a cancelled placement is reported as `BUILD_BLOCKED`; blueprint-build also sets `session.status = "BLOCKED"`                              | `code=BUILD_BLOCKED` for a pre-aborted signal                                |
| **AUD-H1** | `huntAnimal`                                                | the loop never reads the signal; attacks continue to the skill's own deadline (16 s default)                                              | 2 attacks after abort, returned 1,111 ms later                               |

AUD-P2 reproduces `executeStructure` only; the `advanceBlueprintBuild` part is source-confirmed (`blueprint-build.ts` sets `BLOCKED` on any `!placed.success`) and not run.

### Lifecycle facts that make these matter (source-backed, `test/source-facts.test.ts`)

- **No task-level deadline.** `executePlan` is awaited with no race or timeout (`manager.ts` task work block). A skill that never settles keeps `citizen.busy = true`.
- **`busy` is freed while work may still run.** Death (`lifecycle.ts`), `stopCitizen` and admin override set `busy = false` right after `abort()`. A skill that ignores the signal (AUD-F1, AUD-H1, AUD-C1) keeps acting while the next task starts on the same body, so two actions can overlap on one body.
- **Disconnect and kick cancel cognition only** (`manager.ts:184`). The in-flight action is not aborted; it relies on failing against the dead socket, which the unbounded `openContainer` and QA57-M1 do not.
- **Curfew** aborts through `cancelCitizenWork`, which only calls `abort()`. A skill that ignores the signal (AUD-F1, AUD-H1) is not stopped by it, so the citizen keeps working until the skill's own deadline. The curfew effect follows from the source; I did not run the curfew path.

## Not confirmed (kept separate on purpose)

- **AUD-X1 craft retry.** `craftItem` times out a craft at 6 s, then tries the next recipe while the first craft may still complete. Plausible double consumption; **not reproduced**.
- **AUD-X2** crafting-table placement loop, **AUD-X3** door toggle after navigation, **AUD-X4** hazard-bridge placement after an unguarded raw `lookAt` (same class as QA57-M1), `bot.sleep` unbounded. Source patterns only.
- **Ownership across bodies.** The only skill that drives a second citizen's body, `transferItemToCitizen`, is reached only from `live-mechanics-test.ts` and `live-mechanics-demo.ts`. Production sharing (`shareFoodNearby`) drops from one body. **No cross-body mutation was found in the manager loop.**
- **Likelihood.** I did not measure how often a window fails to open, how long real smelts take relative to cancellations, or how often a citizen is cancelled mid-hunt in a real run.

## Native boundary vs the YC runner

`src/native-boundary.ts` (about 160 lines, about 135 of code; QA-only, imported by nothing else) has three parts: an `AsyncLocalStorage` owner per action that is deactivated on abort, deadline or completion; a `bot._client.write` guard that refuses mutating packets from a deactivated owner (cleanup packets such as dig-cancel are allowed; writes with **no** owner are allowed); and a hard deadline plus serialisation. It gives skills the real bot.

| Question                                      | Native prototype (tested here)                                                                      | YC runner + proxy (PR #62, synthetic skills; **not re-run on these defects**) |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Fixes AUD-F1, C1, C2, P1, H1                  | **Yes**, 5 of 5 (`test/native-boundary.test.ts`); control run with the guard disabled fails 6 tests | Same mechanism (packet guard + deadline); expected to, but not run here       |
| Fishing `bot._client`                         | Works (real bot)                                                                                    | Breaks under the proxy                                                        |
| WeakMap state (`terrainMemory`, reservations) | Preserved (same bot object)                                                                         | Reset every action under the proxy                                            |
| Incremental adoption                          | Yes: unowned writes pass                                                                            | No: every unscoped mutation is refused once armed                             |
| Serial execution on one body                  | Yes                                                                                                 | Yes                                                                           |
| Hard deadline on a hung skill                 | `TIMEOUT` at the deadline, orphan cannot mutate, next action runs                                   | `TIMEOUT`, then the bot is quit until reconnect                               |
| Recovery after fail-closed                    | No quit; the abandoned action is counted as an orphan                                               | Quit and wait for reconnect (reconnect-loop risk unmeasured)                  |
| Plugin compatibility (pathfinder `Movements`) | **Unproven** (no real Bot)                                                                          | **Unproven**                                                                  |
| Added code                                    | about 160 lines with comments, ours                                                                 | 729 vendored lines + proxy                                                    |

**Limits of the native prototype (tested so they stay stated):** a write triggered by an event emitted outside any action (for example the bot's own `physicsTick`) has no owner and is not refused; the pathfinder keeps its own timers, so the existing `stopPathfinding` on cancel is still needed; ALS context propagation through every Mineflayer callback style is unproven on a real bot. The guard's packet names (`block_dig`, `block_place`, `use_item`, `use_entity`, `window_click`, `held_item_slot`, `arm_animation`) were checked against the serverbound protocol for the configured version 1.21.11; on protocol 26.1 and later attacks use a separate `attack` packet, which is not on the list.

## Reproduce

```sh
git checkout qa/minecraft-action-cancellation-audit        # based on 1d71707
pnpm install --frozen-lockfile                              # our own lockfile only
pnpm exec vitest run --config qa/action-audit/vitest.config.ts
pnpm exec tsc -p qa/action-audit/tsconfig.json
pnpm exec eslint qa/action-audit
```

Actual results: `Test Files 4 passed | Tests 39 passed` (stable over 5 consecutive runs), `tsc` clean, `eslint` clean, root `pnpm lint` clean. The suite prints the `AUD-*` measurements above. The control experiment: comment out `installPacketGuard(client);` in `src/native-boundary.ts` and `native-boundary.test.ts` fails 6 tests.

## Minimal engineering handoff

In this order, each as its own small change with its test flipped from `it.fails` to `it`:

1. `furnace.ts` `smeltItem`: check `ctx.signal?.aborted` in the polling loop and before `putInput`, `putFuel`, `takeOutput`, `takeInput`, `takeFuel`; close the window and return `CANCELLED`. (AUD-F1)
2. `combat.ts` `huntAnimal`: `if (ctx.signal?.aborted) return CANCELLED` at the top of the loop and clear the tracked entity. (AUD-H1)
3. `inventory-service.ts`: add a small `openWindowBounded(ctx, open)` that races the open against the signal and `ctx.timeoutMs`, use it for `openContainer` and `openFurnace`, and check the signal before `deposit` / `withdraw`. (AUD-C1, AUD-C2)
4. `world.ts` `placeBlock`: re-check the signal after navigation and after `equip` and `lookAt`, immediately before `bot.placeBlock`. (AUD-P1)
5. `structure.ts` and `blueprint-build.ts`: pass `CANCELLED` through instead of `BUILD_BLOCKED`, and do not set `session.status = "BLOCKED"` on a cancellation. (AUD-P2)
6. Task boundary in `manager.ts` around `executePlan`: a hard task deadline, release `busy` only when the task settles or is abandoned (not on `abort()`), and abort the in-flight action on disconnect and kick. Start from `src/native-boundary.ts`; put the guard on the bot's client once at body creation.
7. Not now: AUD-X1..X4 (watch), and QA57-M1 stays with its own fix.

Before shipping any of it: re-run the scenarios on a real Mineflayer bot against a local Paper server, including pathfinder `Movements`, real packet ordering and a 60-minute run. None of that was possible here.
