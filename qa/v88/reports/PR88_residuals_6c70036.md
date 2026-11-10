# Residual action-lifecycle review after PR #88 / PR #92

| | |
|---|---|
| Reviewer | Claude Sonnet 5.5 (independent QA) |
| Repository | `ManpreetS2/Minecraft-Ai-Civilization-windows-backup` |
| **Production candidate (exact)** | `6c70036bb63984a95b1a87ebaf9f616103625fa0` (PR #88, `fix/staging-late-chest-completion`) |
| QA PR #92 | `5b665272fb64a59338fc40a72835f18239825f91` (`qa/chest-transfer-pr88-review`) |
| Earlier QA | QA78 (PR #85, `84d066d0`) |
| QA branch / harness SHA | `qa/lifecycle-residuals-pr88-review` / `583652d959cf2e4ebb60d28ddc858677b366cdc3` |
| Platform | macOS darwin/x64, Node v22.12.0. Linux and Windows not tested. |
| Not done | No Paper, no paid inference, no merge. No edit to PR #88 or any other agent's branch. No assertion weakened or deleted. |

**Disclosure.** I authored the QA78 assertions and the inherited PR #78 lifecycle code, including the `bread === 0` clause discussed in section 5. I agree with PR #92 that the clause encodes a wrong assumption, and say so plainly below.

## Bottom line

| Question | Answer |
|---|---|
| Does any remaining item **block the first controlled, disposable Paper smoke**? | **No.** None can harm the world or the inventory, none rewrites authoritative stock, and none is reachable by a production path unless a specific condition holds (below). |
| What must be fixed **before an evidence-grade run**? | **QA88-M1** (one small gate in `home-ops.executeStorage`). |
| Is `depositItem` returning `success` to a direct caller a live-safety problem? | **No.** The success is a physical-truth statement (items moved) that matches the chest and inventory exactly; no production caller outside `executePlan` exists. |
| Are QA78-L2 / L3 / L4 reachable? | L2a and L4 are reachable but Low and self-healing. L2b, L2d, L3a, L3b, L3c are **not reachable** in production (proved against the real libraries and the real source tree). L2c is an API looseness with one production caller. |

## 1. `depositItem` success to a direct caller (task 1)

Measured on isolated fake-body tests (`qa88-direct-callers`, 8 tests, all green on the candidate, 5 fail on PR #78 so they discriminate):

* An abandonment while the click is in flight: `depositItem` returns `success: true`, `deposited` equals the real delta, `citizenAfter`/`containerAfter` equal the actual inventory and chest, and `citizen + chest` is conserved. It emits **no** success event; the only event is a `SystemIncident` (`AbandonedTransferObservation`, `reconciliation: PENDING`) carrying the counts. Abandonment *before* the click: nothing moves, `CANCELLED`, no event.
* The wrapper `depositItems` stops after the first abandoned success and never starts a transfer for the next stack (one click, the other stack untouched).
* So the "success" cannot cause false completion or wrong stock accounting by itself: its meaning is *"the items physically moved"*, not *"the action completed"*.

**Production call sites** (a source tripwire test pins the exact set):

| Site | Reached through | Abandonment handling | Class |
|---|---|---|---|
| `executor.ts` settlement chest (`withdrawItemsNamed`, `depositToSettlement`) | `executePlan` | gated by PR #88 | **fixed** |
| `home-ops.ts` `executeStorage` (personal / household) | `executePlan` tasks `deposit_personal`, `withdraw_personal`, `deposit_household` | **no gate** (emits success event + releases claim after `success`) | **reachable defect, QA88-M1** |
| `farm.ts`, `fish.ts`, `mine.ts` | `executePlan` (`workFarmPlot`, `fishShore`/`gatherFood`, `mineBlock`) | tail gate suppresses `ActionCompleted`; skill returns the observation | reachable, effect contained (see note) |
| `fish-quota.ts` | only `apps/orchestrator/src/live-two-fish-test.ts` | n/a | **test/live-harness only** |
| `apps/orchestrator/src/live-*-test/demo.ts` | direct, no boundary | no abandonment exists there | **test/live-harness only** |

Note on `fishShore`: after an abandoned success the executor still calls `rememberDiscoveredSite` (a store write of a valid shore location) before the tail gate. It records true knowledge, so I classify it Info; I did not exercise it.

## 2. Findings

| ID | Sev | Reachable? | Defect |
|---|---|---|---|
| **QA88-M1** | **Medium** (evidence/event integrity; no world or stock harm) | **Yes**, production chain | `home-ops.executeStorage` is not covered by PR #88's gate. With the production chain (manager boundary defaults, `executePlan`) and a window that confirms after the 250 ms grace: manager records `TIMEOUT`, then `ItemDeposited` (or `ItemWithdrawn`) is emitted after it, for `deposit_personal`, `withdraw_personal` and `deposit_household`. `ActionCompleted` is correctly suppressed by the tail gate. In addition the abandoned executor's `finally` releases the container claim, dropping a lease that a newer action of the **same citizen** refreshed. No stock is rewritten (this path holds no ledger). 4 red tests. |
| QA88-I1 | Low (pre-existing) | Yes | Every chest transfer emits its success event **twice** (once in the skill, once in the executor / home-ops). Not caused by #88; any consumer that counts these events double-counts. |
| QA78-L2a | Low | Yes, only if an abort lands in the first ~2 s bind window of a fishing cast | The cast is not retrieved. Measured on a rod-toggle server model: the NEXT fishing action's first `use_item` reels in instead of casting, so that action returns `no-bobber`; the third attempt casts. One wasted action, self-healing. |
| QA78-L2b | n/a | **No** | A throwing `write` on a closed socket: the real `minecraft-protocol` `Client.write` silently returns after `end()` (no throw, no error event; tested on the real library). |
| QA78-L2c | Info | One production caller (fish) | `runBoundedCleanup` permit is not one-shot. Production calls it once. |
| QA78-L2d | n/a | **No** | `bot._client` is assigned only at bot creation in mineflayer's loader; no swap under a running cast. |
| QA78-L3a | n/a | **No** | No installed dependency uses `util.promisify(setTimeout/Interval/Immediate)` (full scan of `node_modules/.pnpm`). |
| QA78-L3b | n/a | **No** | The manager's action callback calls an `async` function, so it cannot throw synchronously past the boundary's `finally`. |
| QA78-L3c | n/a | **No** | No `process.nextTick`, `queueMicrotask`, floating `void bot.` call or timer-armed write exists in production source; `setImmediate` is a promise resolver. (Process-level handlers exist only in the live harnesses, so an escaped refusal *would* be fatal; hence the value of there being no such path.) |
| QA78-L4 | Low | Only for a **slow unwind** (> 250 ms after abort) | Listeners registered by `pathing.ts` (`end/kicked/death/respawn`) are removed in a `finally`. If an abandoned navigation unwinds after the grace, the raw `removeListener` cannot find the wrapped listener: one leaked listener per event per abandoned slow navigation. Control: a normal unwind leaks nothing. Harm: a Node `MaxListenersExceededWarning` after ~10 such abandonments; stale handlers only settle already-settled promises. |

## 3. Blocks the first controlled Paper smoke?

* **QA78-L2 / L3 / L4: do not block.** L2a/L4 are Low and self-healing; the rest are unreachable.
* **QA88-M1: does not block** a smoke whose success criteria are world and inventory behaviour. It **should be fixed before** any run whose evidence (event stream, `TaskFailed` ordering) is judged, or whose citizens use personal/household chests while actions can exceed their deadline. The condition to hit it: personal/household chest action, deadline fires, window confirmation arrives more than 250 ms later (a loaded Paper server) or the citizen disconnects mid-transfer.

## 4. Minimum recommended fixes

1. **QA88-M1:** in `home-ops.executeStorage`, after `depositItems`/`withdrawItems` return, `if (ctx.isActionCurrent?.() === false || ctx.signal?.aborted) return <AbandonedActionObservation / CANCELLED>` before emitting `ItemDeposited`/`ItemWithdrawn`; release the claim only if the generation is still current (or release by claim token, not by citizen). Reuse `abandonedObservation` by exporting it from the executor. Then move `defects/qa88-home-storage` into the default config.
2. **Hardening (optional):** give the chest skills' abandoned result an explicit marker (`data.observedAfterAbandonment: true`) so a future direct caller cannot confuse physical success with completion.
3. **QA78-I1/QA88-I1:** emit the success event in one place only.
4. **QA78-L4 (optional):** make `bindEmitter`'s `unwrap` survive restore (keep the wrapper map on the emitter for its lifetime).
5. **QA78-L2a (optional):** on cancel before bind, retrieve once the bobber appears or skip the cast.

## 5. The unchanged QA78 `bread === 0` assertion (task 5)

Scenario: deadline 60 ms, window 120 ms, production grace 250 ms. The `window_click` is on the wire **before** the deadline (measured), so the items move inside the grace and the executor correctly returns `CANCELLED`. Observed: bread `0 → 1`, chest `4 → 3`, no success event, ledger `{bread: 4}`, pending incidents.

The clause `if (!result.success) expect(bread).toBe(0)` is wrong, and it was my error: I assumed an unsuccessful result implied no transfer. A chest click that has been written cannot be un-sent; Minecraft does not roll it back because the action boundary later says "cancelled". Forcing `0` would require undoing a real transfer or hiding it. What *does* hold, and is tested (`qa88-contract`): **no window click is started after ownership ends** (deadline 5 ms: zero late clicks), and **`citizen + chest` is conserved** for every result code.

**Recommended contract wording**

> *A chest action's result code is not a statement about the world; the world is read from the inventory and the container. If a chest action ends unsuccessfully because its ownership ended: (1) no window click is started after ownership ends; (2) a click already written may complete, and its physical effect stays in the citizen's inventory and in the chest: it is neither rolled back nor concealed; (3) that effect is reported only as a PENDING `SystemIncident` (`AbandonedActionObservation` / `AbandonedTransferObservation`) with counts, and never as `ItemDeposited`, `ItemWithdrawn` or `ActionCompleted`; (4) authoritative stock (`storageContents`, observed container contents) and container claims are neither written nor released by the abandoned executor; they are reconciled only from a fresh observation by a current action. Invariant: for every result code, citizen count + container count of the item is conserved.*

**Replacement assertion** (ordinary, not weakened; it keeps the success-event and ledger prohibitions and adds conservation). It is exercised verbatim in `qa88-contract` and passes on the candidate:

```ts
else {
  expect(types).not.toContain("ItemWithdrawn");
  expect(types).not.toContain("ActionCompleted");
  expect(r.store.getSettlement().storageContents).toEqual({ bread: 4 });
  expect(r.bot.count("bread") + chest.stock).toBe(4);   // conservation, not rollback
  expect(r.bot.count("bread")).toBe(1);                 // the click landed before the deadline
  expect(types).toContain("SystemIncident");
}
```

(PR #92's proposed wording is equivalent on clauses 2-4; this adds the conservation invariant and the "no click started after ownership ends" requirement as the load-bearing safety properties.) Apply it in a follow-up on the QA78 branch, not by editing PR #88.

## 6. Counts (macOS, Node 22.12, exact SHA `6c70036`)

| Run | Result |
|---|---|
| typecheck / tools / evidence-validator / lint / build | all exit 0 |
| `pnpm test` | **219 files, 2627 passed, 1 skipped** (matches PR #92) |
| `test:security` / `test:ai` / `test:v1` / `test:evidence-validator` | 358 / 514 / 213 / 161 |
| Inherited QA78 regression / defects on the candidate | **50 pass, 1 red** (the `bread === 0` clause) / **2 pass, 12 red** (matches PR #92) |
| **QA88 regression suite** | **26 passed, 0 failed, 0 skipped** (no `it.fails`) |
| **QA88 defect demonstrations** | **4 red** (QA88-M1 ×3 events + 1 claim release) |
| QA88 regression on PR #78 (differential) | 6 of 26 fail: 5 need PR #88's gate; 1 is a source-text fact about `pathing.ts` that differs in the older tree |

Reproduce: `qa/v88/scripts/run-on-candidate.sh <repo> 6c70036bb63984a95b1a87ebaf9f616103625fa0 e99d5ef0b3d00dc9bfa43a3244c167f37ff404b7 <new-empty-dir>`

## 7. Not proven
Real Paper timing (whether a loaded server confirms windows later than 250 ms), real Mineflayer window objects, the first smoke's actual action mix, `fishShore`'s post-abandon `rememberDiscoveredSite`, Linux and Windows. PR #92's executor-level positive tests were not repeated except where used as controls.
