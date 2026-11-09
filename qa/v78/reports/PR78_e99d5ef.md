# Independent Lifecycle Re-Review — PR #78 (fishing cleanup and remaining lifecycle defects)

| | |
|---|---|
| Reviewer | Claude Sonnet 5.5 (independent QA; did not author the code under review) |
| Repository | `ManpreetS2/Minecraft-Ai-Civilization-windows-backup` |
| **Candidate (exact)** | `e99d5ef0b3d00dc9bfa43a3244c167f37ff404b7` (`fix/lifecycle-independent-qa-findings`, draft, base PR #74) |
| PR #74 head | `012b8e77eb54e01910e93cd2a31718623dc0ac08` |
| PR #69 head | `5ad304c0cbb624aca89ad265a0c9ba765f7c6bcd` |
| Prior QA | `qa/skill-cancellation-lifecycle-review` @ `05a5acf4` (harness `dcfc9743`) |
| QA branch / harness SHA | `qa/lifecycle-pr78-independent-review` / `bfe0150cca145d65c0a33fff929dcd02ac53e006` |
| Platform | macOS darwin/x64, Node v22.12.0. **Linux and Windows not tested; PR #78 has no CI.** |
| Not used | live Paper, paid calls, protected merges, destructive Git. No production file was edited. Mutation checks were applied only to a disposable worktree and discarded. |

## Verdict: **CHANGES REQUIRED** (narrow)

* **Closed (independently re-proven):** QA69-M1, M2, M3, L1 and L3. The 250 ms fishing cleanup is **not** a general late-write permission.
* **Not closed:** **QA69-L2.** The fix is only inside `withdrawItem`. The production call chain (`executePlan` → `withdrawItemsNamed`) still emits `ItemWithdrawn` and `ActionCompleted` and rewrites the settlement ledger *after* the boundary reported `TIMEOUT` (QA78-M1). `depositItem` has the same behaviour.
* **New hazards introduced by #78:** the global `setTimeout`/`setInterval` wrapper (QA78-L3) — all Low, latent, no production path demonstrated.
* **PR #74's crafting, door, hazard, sleep and packet-ownership protections remain effective** (12/12 differential, section 4).
* **Recommendation:** the lifecycle fixes may enter the combined **offline** candidate with QA78-M1 recorded as a known issue. Fix QA78-M1 before any live run. Do not cite #78 as live-safety evidence.

## 1. Original failures re-run (my QA69 suite, byte-for-byte, only the dig-child path rewritten to the overlay)

| Tree | Result | Meaning |
|---|---|---|
| PR #74 `012b8e7` | **57 / 57 pass** | every defect still reproduces (the `it.fails` ones pass) |
| PR #78 `e99d5ef` | 48 pass / **9 red** | M1 ×4, M2, L1 ×2, L2 (skill level) and the L3 crash characterisation flipped: defects gone |
| PR #78, M3 `it.fails` | still "passes" | my original assertion was *zero* late `use_item`. It still sees exactly **one**. See section 2: that one is the permitted retrieve. |

Cursor's edited copy under `qa/v69` was diffed line by line against my originals. The only changes are `it.fails`→`it`, the removal of the `qa-independent` path, new extra tests, and **one changed expectation** (M3: `late` 0 → 1). I verified that change is legitimate and not a weakening: a bite storm adds **0** `use_item` beyond the control without any bite (section 2).

## 2. The 250 ms exception, tested adversarially (`qa78-fishing-cleanup`, 17 tests, all green)

* One cancel with a bound bobber writes cast + **exactly one** retrieve; listeners are removed; the boundary returns in < 600 ms.
* 20-bite storms (metadata, splash, both) at 0–380 ms after abort: **+0** `use_item` vs the no-bite control. A bite in the same synchronous turn as `abort()`: still 2 total.
* Five repeated cycles on an aborted signal: 0 casts. Deadline abandonment (not a caller abort): one retrieve, no orphans.
* Two citizens: aborting A does not disturb B, A's stale bite does not reel B, B's own bite still reels B.
* A `use_item` permit refuses **every other** mutating packet (`block_dig` start, `block_place`, `window_click`, `use_entity`, `held_item_slot`, `arm_animation`). An empty packet list permits nothing. The permit does not leak out of its frame, is not inherited by a timer scheduled before the cleanup, expires on the real clock, is capped at 500 ms even when 10 s is requested, rejects 0/negative/NaN/Infinity/undefined deadlines, and does not cross to a different client's boundary.
* **Residual looseness (QA78-L2c, Low):** within the window the permit allows *any number* of `use_item` writes (25 of 25 succeeded). The retrieve is meant to be one. Production calls it once; the API does not enforce it.
* **Mutation check** (disposable worktree): dropping the packet list, expiry, cap, or the permit itself is caught (2/2/1/7 tests fail). Removing the fish handlers' abort guards is **not** caught: it is an equivalent mutant at the wire level, because the packet guard and the `reeled` flag back it up and a late bite can at most replace the retrieve, never add to it.

## 3. Findings

| ID | Sev | Origin | Defect | Evidence |
|---|---|---|---|---|
| **QA78-M1** | Medium | residual of QA69-L2 (claimed fixed) | `withdrawItem` suppresses `ItemWithdrawn` after abort, but `executePlan` → `withdrawItemsNamed` still emits `ItemWithdrawn`, then `ActionCompleted`, and writes `settlement.storageContents` after the manager recorded `TIMEOUT`. Needs the window to confirm later than the 250 ms default grace (measured: 450 ms window, 60 ms deadline). Result: manager `TIMEOUT`; ~390 ms later `ItemWithdrawn,ActionCompleted`; ledger `{"bread":4}`→`{"bread":3}`; inventory 1. | `defects/qa78-defects-lifecycle`, production defaults |
| QA78-M1b | Low–Med | pre-existing sibling | `depositItem` has no abort check after the transfer. `ItemDeposited` follows a `TIMEOUT`. | same file |
| QA78-L3a | Low | new in #78 | The global timer wrapper drops `util.promisify.custom`. `promisify(setTimeout)(…)` during any action throws `TypeError: fn.apply is not a function` as an uncaught exception. I found **no** such call in the repo, mineflayer, minecraft-protocol, pathfinder or prismarine-physics. | child process |
| QA78-L3b | Low | new in #78 | A skill that throws synchronously leaves `setTimeout`/`setInterval` wrapped for the rest of the process (restore sits in `finally`, after the throw point). The production skill callback is async, so this is latent. | child process |
| QA78-L3c | Low | scope of the L3 fix | Only `setTimeout`/`setInterval` callbacks swallow the refusal. A refused late write from `process.nextTick`, `setImmediate`, `queueMicrotask`, an unawaited promise, or a timer armed by an abandoned action *after* the boundary returned still kills the process. Both dig-child modes are fine; I found no production path using these. | 5 child-process tests |
| QA78-L2 | Low | residual | Abort **before** the bobber is bound: the cast is already out, the bobber is never retrieved (wire: `use_item` only). | `defects/qa78-defects-fishing` |
| QA78-L2b | Low, unproven | new | A throwing `write` during the cancel-retrieve turns a cancel into a rejected cycle. Whether real `minecraft-protocol` throws on a closed socket is not proven. | same |
| QA78-L2d | Info | new | The retrieve does not check `stillThisCast()`; if `bot._client` were swapped it would write to the new session. Mineflayer does not swap it. | same |
| QA78-L4 | Low | PR #74 origin | A listener registered during an action cannot be removed after the action ends (`off()` is restored to the unwrapped version). | same |
| — | Info | by design | Hazard: `runBoundedCleanup` is exported from `@civ/shared` and takes any packet list. Only fishing uses it. | source |

Not defects (hypotheses I tested and rejected): a lagging inventory sync after `withdraw()` returns is still reported as **success** (control test); a real `PATH_BLOCKED` still sets `BLOCKED` at each of the four navigation steps for both blueprints; the new global wrapper restores to the exact original functions after single, overlapping, rejecting, timed-out and aborted runs.

## 4. Confirmations

* **M1 (blocked construction):** `basic_shelter_v1` and the workshop cabin: an abort on every navigation call that exists leaves `IN_PROGRESS`, a JSON-reloaded session completes and its failure list is empty. A real failure followed by a cancel stays `IN_PROGRESS`; an `INTERRUPTED` navigation result without abort also stays `IN_PROGRESS`. **Limit:** on this harness a live validation of the workshop cabin fails even with no abort (`WORKSTATION_UNREACHABLE`, harness limitation), so the workshop's chest-step interruption and its live resume are **not** exercised; the resume there is checked with static validation.
* **L1 (furnace):** 18 abort offsets, direct and through the packet guard: no click starts after abort, the ingot ⇔ success invariant holds, no `SMELT_FAILED` surfaces. Input/fuel left in the furnace after a cancelled smelt are not recovered (by design).
* **L3 (dig timers):** real mineflayer `digging.js` with and without `stopDigging`: both exit 0, no `late arm_animation refused`. Any other error thrown in an action timer still reaches `uncaughtException`.
* **PR #74 protections** (own offset sweeps, 12 tests): craft (5 offsets), `openDoor` (5), `closeDoor`, sleep (5 + never-confirm), hazard bridge (5), listener ownership matrix (pre-action listener stays unowned, in-action listener refused after the action for `bot` and `client`, never inherits a later owner, `once`/`addListener` bound, unguarded packets pass). **#74 and #78: 12/12.** **#69 (no #74): 9 fail**, so the tests discriminate.
* **Reconnects:** old fish callbacks cannot write on a replaced client (Cursor's test plus my 2-citizen test); the QA69 manager suite (disconnect, kick, death, shutdown, reconnect) is unchanged and passes on #78.

## 5. Counts (macOS, Node 22.12)

| Run | Result |
|---|---|
| Author: `qa/v69` (5 files) / `qa/action-audit` (5 files) on #78 | 62 / 62 and 67 / 67 |
| `pnpm test` #78 / #74 | 201 files, 2276 tests, both. One #78 run had a 5 s timeout in `community-container-contents.test.ts` while two gate jobs shared the CPU; it passed 3/3 in isolation and the full suite passed on rerun. Reported as load-induced, not a defect. |
| `test:security` / `test:ai` / `test:v1` / `test:evidence-validator` | 358 / 514 / 100 / 149, identical on both |
| typecheck, typecheck:tools, typecheck:evidence-validator, lint, build | all exit 0 on #78 and #74 |
| **QA78 regression suite** (default config) on #78 | **51 passed, 0 failed, 0 skipped**, no `it.fails` |
| **QA78 defect demonstrations** on #78 | **14 red**, 0 green: ordinary assertions of the safe behaviour that currently fail |
| Mutation check (13 mutants, disposable worktree) | 9 killed, 4 survived; the survivors (3 fish-abort-guard variants, 1 redundant furnace check) are redundant-defence mutants, see section 2 |

**Formal run** (`run-on-candidate.sh` on three fresh worktrees at the exact SHAs, harness `bfe0150c`): section 1 (author tests) 62/62 and 67/67; section 2 (original QA69) #74 57/57, #78 48 pass / 9 red; section 3 QA78 regression suite **51/51**; section 4 defect demonstrations **14/14 red**; section 5 differential on #74: **12 of 34 fail** (the tests of #78-only fixes: construction ×4, furnace ×2, chest sweep, timers ×5; the fishing file cannot load because #74 has no cleanup module) while the 12 PR #74-protection tests pass. Disclosure: the script's first pass hit 60 s test timeouts in section 3 after the host stalled for ~30 min (three tests, none product-related); it aborted under `set -e`. I re-ran sections 3-5 by hand in the same worktrees on an idle machine; section 3 passed 51/51. Logs: not committed (scratchpad).

Reproduce: `qa/v78/scripts/run-on-candidate.sh <repo> e99d5ef0b3d00dc9bfa43a3244c167f37ff404b7 012b8e77eb54e01910e93cd2a31718623dc0ac08 5ad304c0cbb624aca89ad265a0c9ba765f7c6bcd <new-empty-dir>`

## 6. Correction instructions

1. **QA78-M1:** make the executor honour the abort. After `withdrawItems`/`depositItem`, check `ctx.signal?.aborted` before emitting `ItemWithdrawn`/`ItemDeposited`/`ActionCompleted` and before the ledger write, or have the boundary expose an `abandoned()` predicate. Then flip `defects/qa78-defects-lifecycle` to the default config.
2. **QA78-L3a/b/c:** do not patch globals. Wrap in the guard itself (return a rejected `AbortError` for late writes) or preserve `util.promisify.custom` and move `bindScheduledCallbacks` inside the `try`.
3. **QA78-L2:** on cancel before bind, retrieve once the bobber appears, or skip the cast when the signal is aborted. Make `runBoundedCleanup` one-shot per packet and check `stillThisCast()`.
4. Add Linux/Windows CI.

## 7. Not proven

Real Paper, a real fishing bobber, real `mineflayer-pathfinder` ticks, real `minecraft-protocol` write-after-end behaviour, the workshop cabin's live chest step, 60-minute soak, Linux and Windows, and any live safety claim.
