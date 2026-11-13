# QA Round 5: independent security review (Claude 2)

QA-only. Every candidate was checked out at its **frozen exact SHA** in a clean detached worktree, installed with `--frozen-lockfile`, and my own earlier suites were **overlaid from their PR refs, never edited**, before new tests were added. Host: macOS (Darwin 25.6), Node 22.12.0, pnpm 10.16.0 (CI pins Node 22.17.1; not reproduced here). Offline only: no Paper, no paid request, no signer or key, no merge, no saved-world change, no acceptance-ledger change. Nothing here upgrades any acceptance status. Candidate production code was never modified; one throwaway local patch used to test a proposed fix is described under Mission 1 and was never pushed.

## Frozen identities

| Role | PR | Exact SHA | Notes |
| --- | --- | --- | --- |
| Validator candidate, as assigned | #131 | `e0d6540d351b5a82835642cdb64353f46fcd771e` | head confirmed unchanged at review time |
| **Newer validator descendant (published during the queue)** | #150 | `e31bcb4ec055bace24e29bb4d0346bc932057930` | descendant of #131; reviewed separately |
| Integration baseline, as assigned | #141 | `1ee155641636d13b172d2dad520280febecc4871` | production byte-identical to `a14113b` (verified) |
| **Newer integration candidate (published during the queue)** | #156 | `a99f6bf842cae9d5065b7cea1848f0368949d943` | descendant of #141; includes #154 and #155, **excludes #150** |
| Component of #156 | #154 | `3ddc5cdda6e7c309ddccac082cda4bbde6be5dc5` | chest pending-observation accounting |
| Component of #156 | #155 | `c620eb9a3bfe92c133ce00143c8806e176180992` | CI identity type/consistency |
| Earlier validator baseline | #94 | `da0e1ff9e7e84647467ac335a7ded698f5f8fdc3` | comparison column |
| Parent integration | #120 | `1d9967f0020840fe091cbbc77fe27234a577381f` | comparison for the routing change |
| Prior QA | #119 `c873180`, #137 `52d5543`, #138 `f1655a6`, #139 `719b038`, #142 `b4f7150` | | suites reused, unchanged |

Heads were re-fetched before writing: no newer commit exists on #131, #141, #150, #154, #155 or #156. Excluded as outside this assignment: #157 (Paper freeze, Claude 1) and #145 to #148 (provider stack; #152 already returned CHANGES REQUIRED).

## Verdicts

| # | Candidate | Verdict |
| --- | --- | --- |
| 1a | #131 `e0d6540` validator | **CHANGES REQUIRED** (one blocking defect: signed `withdraw`/`deposit` rejected) |
| 1b | #150 `e31bcb4` validator | **PASS FOR PROVISIONAL OFFLINE INTEGRATION** (no blocking finding; three Low items) |
| 2a | #141 `1ee1556` integration | **PASS FOR PROVISIONAL OFFLINE INTEGRATION** (Low/Medium items tracked; not evidence-grade) |
| 2b | #156 `a99f6bf` integration | **CHANGES REQUIRED, narrow**: component #154 regresses receipt completeness (QA154-M1). #155 passes. #141 remains the reviewed base |
| 3 | Knowledge and memory isolation (#141 and #156) | **No confirmed unauthorized disclosure.** Nothing blocks the locked independent 2v2 on this axis |
| 4 | Evidence-grade readiness | **NOT READY.** All nine provenance limitations remain; no authentic witness exists |

A passing verdict here is for **provisional offline integration only**. It does not authorize Paper evidence, an acceptance upgrade, public deployment or company integration. `NOT_PROVEN` is never treated as genuine Paper evidence anywhere in this report.

---

## Mission 1: validator re-review

### #131 `e0d6540`: CHANGES REQUIRED

The one new commit since my earlier review (`d4ea9ef`) only adjusts metadata byte accounting; it does not touch the action enum. `experiments/evidence-validator/src/schemas.ts:55` still lists `["gather","craft","place","eat","move","speech"]`, while `tools/v1-integration/evidence-contract.ts:11` defines `withdraw` and `deposit` as valid production action kinds.

| Suite (unchanged overlays) | #94 baseline | **#131 `e0d6540`** | **#150 `e31bcb4`** |
| --- | --- | --- | --- |
| QA94FC forward-compat (41) | 15/41 | 40/41 | 40/41 default launch, **41/41** with the author's stack qualification (see L1) |
| QA94 canonical (27) | 27/27 | **22/27** | **27/27** |
| QA94 defects (7) | 2/7 | 7/7 | 7/7 |
| QA86 (71) / defects (7) | 71/71, 7/7 | **65/71, 5/7** | 71/71, 7/7 |
| QA75 (51) | 40/51 | 40/51 | 40/51 (same reds as baseline) |
| QA67 original overlay (150, uses `it.fails`) | 106/150 | 105/150 | 106/150; **in-tree QA67 150/150** |
| Provenance controls (26) | 26/26 | **16/26** | 24/26 |
| `action-kinds` (5, #142) | 5/5 | **3/5 (`withdraw`, `deposit` fail)** | **5/5** |
| deep-metadata text-built (6, #142) | 3/6 | 6/6 | 6/6 |
| Round 5 boundary + malformed (26, new) | 16/26 | **26/26** | **26/26** |

**R5-M1-B1 (High, blocking for #131).** A genuinely signed `withdraw` or `deposit` action fails with `RAW_JOURNAL_SCHEMA_VIOLATION`, then `UNMATCHED_ACTION_OBSERVATION` and `SPONTANEOUS_GAIN`. It fails closed (never `VERIFIED`), but any real run containing one chest transfer is quarantined. The old canonical suites regressed with it (QA94 22/27, QA86 65/71), so 41/41 on the new tests was not a sufficient approval signal. Reproduce: `test/action-kinds.test.ts` (#142). **Fix verified in a throwaway scratch worktree (never pushed):** adding `"withdraw"` and `"deposit"` to that enum alone restores QA86 71/71 and 7/7, `action-kinds` 5/5, QA94 26/27. #150 contains the equivalent repair and also closes the last QA94 red (below).

**Malformed signed input (all three heads).** 20 hostile-line cases built as text with correct hashes (non-JSON, null/array rows, bad `kind`, bad `seq`, duplicate keys, `__proto__`/`constructor`/`prototype`, BOM, lone surrogates, 10 000 sibling keys, 20 000-deep array and object metadata, 2 MB string, wrong/missing hash, non-array `rawJournalLines`, caller rows that disagree with signed lines): **0 throws and 0 `VERIFIED` on #131 and #150**. The same suite throws on the #94 baseline (4 red), so it is sensitive.

**Exact-boundary metadata limit (new in `e0d6540`).** A seeded differential test (300 random shapes, multi-byte and escaped characters, depth ≤ 8) compares the validator's resource limit to `Buffer.byteLength(JSON.stringify(unknownKeys)) > 4096`: **agrees on every case on #131 and #150**; key-count (32/33) and depth (8/9) limits agree.

### #150 `e31bcb4`: PASS FOR PROVISIONAL OFFLINE INTEGRATION

Diff against #131 is 3 source files; **the QA suites are byte-identical to #131's** (`git diff e0d6540 e31bcb4 -- qa` is empty). The change makes unknown-metadata comparison stricter, not looser: the old `suppliedExtras ||` escape was removed, so every unknown signed key must now be present and equal. A WeakMap retains the adapter's raw projection so library callers who omit unknown metadata are no longer treated as a mismatch.

Checked: deposit/withdraw schema ✓; QA94 canonical 27/27 ✓; QA86 71/71 and 7/7 ✓; QA67 unknown-metadata compatibility ✓ (in-tree 150/150); QA94FC ✓ (qualified); malformed input and invalid-row acceptance ✓ (0/26 failures); all security checks preserved (no QA assertion changed, no `expect` removed).

Low items, none blocking:

- **R5-M1-L1 (Low, process).** QA94FC FC-3 builds a 5000-deep value with `JSON.stringify` inside the QA helper, which overflows the stack at that depth on this Node build, so the default launch is **40/41**. I reproduced the author's qualification exactly (programmatic `startVitest` with fork `execArgv: ["--stack-size=8192"]`): **41/41 on my unchanged overlay and on the in-tree copy.** The validator itself never overflows (text-built depths up to 100 000, 6/6, default stack). The CLI-flag form of the same option **hung at 0% CPU** for me, so the qualification is launcher-specific. Fix: replace FC-3 with the text-built form (`test/deep-metadata.test.ts`) or set `execArgv` in the suite's config.
- **R5-M1-L2 (Low).** Authority-looking unknown names are fingerprinted by a keyword denylist (`/provider|genuine|auth|model|provenance/i`), so other authority-flavoured names (`verified`, `real_minecraft`, `paper_attested`, `trusted_by_server`, `signature_valid`, `witnessed`, `PASSED`) are still echoed verbatim into `notProven` (7/7 red in `defects/echo-denylist.test.ts`). They are inert: verdict and decision source are unchanged, and the rendered summaries do not embed these descriptions. Fix: fingerprint every unknown name, or report only a count.
- **R5-M1-L3 (Info, do not over-credit).** On #150 two provenance G8 defect tests turn green only because a `join` row is an unknown row kind and the run is downgraded to `offline_simulated`. G8 is **not** implemented. Likewise on #131, 8 of 9 provenance "desired rejections" were hollow greens (everything quarantined by the deposit schema bug).

Inherited, previously reviewed: 33 `it.fails` markers in the in-tree QA67 were flipped to `it` in earlier commits `014804f`/`da0e1ff` as defects were fixed; `expect(` counts are preserved (26/26, 22→23, 60/60, 38/38, 28/28). Not a #131-to-#150 change.

---

## Mission 2: integrated candidates

### #141 `1ee1556`: PASS FOR PROVISIONAL OFFLINE INTEGRATION

Verified rather than taken from the PR text: `packages/apps/tools/experiments` are **byte-identical to `a14113b`**; the only production delta over the #120 tree is #133 and #135 cherry-picks (`claims.ts` equals #133, `executor.ts`/`inventory-service.ts` equal #135). The one genuinely **new composite** is `home-ops.ts` (a merge of both). **#131 is excluded**, so the validator is the pre-#131 chain.

Independent reruns on this exact head: workspace **2640 passed, 1 skipped** (PR: 2639/2 skipped); security 358; AI 514; validator 161; V1 219; typecheck 0; my P0 isolation 49/49; provenance 26 pass/9 red; QA120 39/39; chest contract 8/8; #142 chest-ownership 9/9 and lease-ownership 11/11. Regenerated 1v1/2v2 bundles at the exact SHA: `sourceSha` = head, `runId` `fixture-{2,4}-1ee155641636`, `experimentId` `off2`/`off4` distinct and consistent, validator `offline_simulated` / `NOT_PROVEN`, 0 violations.

New combination tests (`qa/round5-security`, run through the real `executePlan` and action boundary): **15/15** on #141 (13 of these 15 are red on the #120 tree, so they are sensitive):

- `withdraw_household` was **undeclared in the PR text**: before, it fell through to the settlement chest. Now an owner's call moves items from the household chest only (settlement stock untouched, one event labelled `household`); cross-purpose and stranger citizens are denied with no transfer and no event.
- `access` on physical events is set by the executor: hostile `storageAccess`/`access`/`purpose` in the plan or the context never override it.
- Terminal-event payload integrity: `count` equals both container and inventory deltas and the physical movement; `contents[item]` equals `containerAfter` (4 operation shapes).
- Receipt completeness on every abandonment signal (deadline, caller abort, pre-abort) for all four home operations: **receipts = (moved ? 1 : 0)**, deltas equal the physical movement, no terminal event (13/13 on #141 and #156).

Findings on #141:

| ID | Sev | Finding | State |
| --- | --- | --- | --- |
| R5-M2-L1 | Low | One abandoned transfer produces **3** PENDING records (1 physical, 2 action wrappers) with no correlation id (`defects/abandoned-observations.test.ts` QA141-L1) | **Fixed in #154** |
| R5-M2-L2 | Low | The abandoned-**withdraw** observation lacks `count`, `position`, `access`, `contents`, which the deposit one carries (QA141-L2) | **Open on #156** |
| R5-M2-M1 | Medium (design) | Nothing in production consumes `reconciliation: "PENDING"` (grep: emit-only). `authoritativeStorageUpdated:false` is never reconciled, so after an abandoned transfer the store's recorded contents stay stale. Restart persistence of the pending record is **source-inspection only**, not runtime-proven | Open; not a confidentiality issue |
| R5-M2-L4 | Low | Because #131/#150 are excluded, signed metadata nested 5 000+ levels deep on this host (2 500+ on the earlier Windows host) makes the validator throw `RangeError` (fail-closed crash; 3 of 6 deep-metadata cases red) | Fixed in #150 |
| R5-M2-L5 | Low | QA120-L1 (array `runId` coerced by `String()`) and L2 (hostile `toString` object) are unmet at `offline-acceptance-verifier.ts:729`. **Not exploitable end to end**: through the real CLI both mutations still fail closed (array rejected by a separate contradiction check; object yields a structured failure) | **Fixed in #155** |

Known QA78/QA88/QA103 contract failures, accounted for on the exact head (identical on #120 where applicable, so not regressions): QA78 default **50/51**. The single red is the old "a failed result means nothing moved" expectation; it is deterministic on both #120 and #141 and conflicts with the abandoned-transfer design. QA78 defects 12 red/2 (fishing cleanup, timer wrapper, listener removal, unrelated to chests, unchanged). QA88 **25/26** (I1 is a characterization of a bug that #135 fixed) and defects 4/4. QA103 **19/20** (stale source-text tripwire) and L2 red (no-op cancel recorded as PENDING).

CI and receipts (CLI-level, copies of freshly generated bundles, `scripts/cli-tamper.sh`): untouched control exit 0 (`NOT_PROVEN` honest); wrong `--sha`, truncated journal, half-written last line and a deleted receipt each exit 1; regenerating into an existing directory is **refused with all files byte-identical**; the generator also refuses a dirty tree, untracked files included. Structural facts worth knowing: the workflow checks out `pull_request.head.sha` explicitly and uses SHA-pinned actions with `contents: read`; but the SHA and `runId` are derived from the same checkout on both generator and verifier side, so consistency is **partly tautological**, and the "independent adversarial suite" step runs a **candidate-controlled** in-tree directory. A coherent local forgery (journal, receipts, pins, reports regenerated together) remains indistinguishable offline, as the verifier itself states.

### #156 `a99f6bf`: CHANGES REQUIRED (narrow)

Production delta over #141 is 5 files: #154 (`executor.ts`, `home-ops.ts`, `inventory-service.ts`) and #155 (`tools/ci`). Exact-head reruns: security 358, validator 161, typecheck 0, in-tree CI verifier **100/100**, in-tree QA120 defects **6/6**, my 25 combination and knowledge tests 25/25, receipts 13/13, QA103 defects 2/2 (L2 fixed), QA141-L1 fixed. Full workspace: 2645 passed, 4 failed, 1 skipped. **The 4 failures are timeouts** of the heavy 4-citizen offline tests under machine load (load average 9 to 20 while I ran suites in parallel; one reported 432 s). All four **pass in isolation on both #156 and #141** (7/7, 11/11, 6/6). That is a fragility, not a regression (R5-M2-L6, Low: the tests take 20 to 46 s against 30/60 s limits).

**R5-M2-M2 (Medium, regression versus #141): QA154-M1.** #154 emits the abandoned-withdraw receipt only if `gained !== 0 || containerAfter !== containerBefore`. That branch measures immediately after `chest.withdraw()` resolves, with none of the `waitForCount` the normal path uses. Where inventory and container views update after the confirmation, a transfer that does happen is recorded with **no receipt at all** (the executor and home wrappers were also silenced for chest actions). Reproduced in a controlled fake whose container and inventory both sync 150 ms after confirmation: **#141 emits a receipt; #156 emits none while the item moves** (`defects/receipt-suppression.test.ts`, red on #156, green on #141). Whether a real Paper server syncs this way is **not proven here**; the risk is in the very conservation evidence #154 is meant to protect.
Required fix: suppress only when no movement is observed after the same bounded sync wait the normal path uses, or emit whenever the signal was aborted after `withdraw()` resolved and mark `noEffectObserved`.

**Adjudication of the proposed contract migration (`qa/round5/CONTRACT-MIGRATION.md`).** Five QA103 assertions and two QA88 assertions turn red on #156 because they select `AbandonedActionObservation` records that #154 deliberately removed. I accept the selector migration **conditionally**: the surviving physical receipt must carry what the old wrapper carried, namely `authoritativeStorageUpdated:false` (currently absent from it) and the L2 field parity. My 13 receipt-accounting tests already assert the single-receipt contract on every abandonment signal, so the intent holds; the QA103/QA88 text selectors should be updated, not the production code. The old QA78 "bread is 0 after a timeout" expectation cannot justify un-doing a completed withdrawal (agreed).

**#155 CI identity repair: PASS.** Coerced `runId`/`sourceSha`, missing and contradictory report identities, non-object roots and hostile `toString` are rejected without invoking coercion hooks. CLI tamper matrix on the exact head: control 0; wrong SHA, array `runId`, hostile object, truncated and half-written journal, deleted receipt all exit 1; overwrite refused with files unchanged. Cosmetic: an array `runId` renders as `expected 'X', got 'X'`. I did not run #155 standalone; its diff is confined to `tools/ci`.

Recommended assembly: **#141 + #155 + #150** is the clean PASS path; #154 should return with the fix above and field parity.

---

## Mission 3: knowledge and memory isolation

No confirmed unauthorized information disclosure on #141 or #156. Nothing here blocks the locked independent 2v2.

- My PR #138 suite: **49/49** on both heads (hidden rival coordinates, unobserved chest transfers, private speech and recipients, allegations vs verified truth, cross-citizen memory, restart, observer knowledge).
- New for the changed boundaries (10/10 on both; `test/knowledge-141.test.ts`), driven through the real `AgentManager` tick and file-backed SQLite: the six production-shaped payloads of #135/#154 (new `access`, `citizenBefore/After`, `containerBefore/After`, `contents`, `position`, and both abandoned `SystemIncident` kinds with `observedResult`) never reach a rival or the actor's teammate in any prompt, persistent fact store or rendered headline; unchanged after a restart; a plan-supplied item name carrying a fake `visibility`/`[SYSTEM] OBSERVED FACT` cannot start a prompt line. **Positive control:** the identical event labelled for the actor's own community does reach the teammate and only that community.
- **A gap in my own earlier test, now closed:** P0-1 payloads had no `item`, so the rendered headline ("X stored N item in the shared chest") was never exercised. The new sentinel test asserts the item, coordinates, headline text and incident kinds are absent.
- Mechanism: events without a `visibility` class are `unknown` and reach no citizen; `ItemDeposited`, `ItemWithdrawn` and `SystemIncident` are not adapted into beliefs or memory at all (`adaptSimEvent` handles only transfers, injuries, deaths, tasks, resources, construction, conversation). Repo security suite 358/358 on both.
- **R5-M3-I1 (Info).** `format-event.ts` renders every chest deposit as "in the shared chest" regardless of `access`; a personal-chest deposit is mislabelled for any observer view. Not a leak (unlabelled events are invisible to citizens), but fix before any observer-facing UI.

Limits: body and provider are stubbed offline; this is not evidence of live model independence.

---

## Mission 4: evidence-grade integration readiness

Evaluated at #141, #156 (identical result: provenance controls **26 pass / 9 red**), #150 and #131 (hollow, see L3). A grep of the exact #156 tree for eight witness primitives (`challenge_nonce`, `session_seal`, `world_fingerprint`, `join` rows, provider receipts, a used-session ledger, `expectedWorldFingerprint/UuidMap/ProviderReceipts`, checkpoint/witness stream) returns **0 hits**. `expectedCaptureSessionId` exists only inside `source-authenticator.ts`; `ValidatorInput` cannot carry it. The `usedSession` hits in `packages/session-isolation` are an unrelated runtime concept.

### The nine known limitations (all remain unimplemented)

| # | Limitation (PR #119 ID) | Test | #141 / #156 |
| --- | --- | --- | --- |
| 1 | Plausible harness-fabricated journal accepted (G1) | `provenance-desired` G1 | red |
| 2 | Genuine attestation replayed as a second run (G2) | G2 replay | red |
| 3 | Caller cannot state the expected session (G2) | G2 session | red |
| 4 | Right key, wrong world (G3) | G3 | red |
| 5 | No seal; crash-truncated journal re-signed (G4) | G4 seal | red |
| 6 | Single end-of-run signature, no checkpoints (G4) | G4 checkpoints | red |
| 7 | Model claims without provider receipts (G6) | G6 | red |
| 8 | Two citizens under one UUID (G8) | G8 a | red |
| 9 | Citizen ids swapped against join UUIDs (G8) | G8 b | red |

G5 (key readable by the harness) and G7 (modified binary) cannot be tested offline and remain documented limits.

### Minimum dependency matrix for a future authentic server-side witness (no signer built)

| Capability | Must exist | Depends on | Exists now | Turns green | Needed for |
| --- | --- | --- | --- | --- | --- |
| **Session and world binding** | Provision record `{session id, challenge nonce, world fingerprint, server-root hash, plugin hash, key id}`; validator input carries the *expected* values; payload V2 must equal them; unknown input keys rejected | none (first dependency) | No (0 hits; V1 payload binds no world) | G3, G2 (state) | Gate A, B |
| **Genuine Paper observations** | In-process plugin witness stream (`session_start`, `tick`, `join`, `inventory_snapshot`, `block_change`, `chat`, `session_seal`); validator rule "VERIFIED only if the witness shows the outcome"; harness claims can only agree or disagree; validator must learn the new row kinds (today any unknown kind forces `NOT_PROVEN`) | provision record, key custody | No | G1 | Gate A, B |
| **Server-controlled signing keys** | Per-session Ed25519 key unreadable by the harness (separate OS user, mode 0400); public key placed in the trust file out of band before the run | provision record | No (synthetic test keys only; G5 not testable offline) | none offline | Gate A (adversary-proof), B |
| **Replay rejection** | Nonce signed into every checkpoint; used-session ledger `{session, key id, digest}` checked by the wrapper; ordering rule provision < start < witness < harness < seal | provision record, ledger owner (acceptance ledger) | No | G2 | Gate A, B |
| **Continuous checkpoints** | Chained signed checkpoints every ≤ 60 s plus seal; absence of seal is `NOT_PROVEN` for completeness | witness stream | No | G4 (both) | runs > 5 min; B (60 min) |
| **Citizen identity mapping** | Witness-signed `join` records (UUID, name, tick) joined to `citizenId`; per-citizen empty spawn inventory proven by the witness | witness stream, validator join rule | No | G8 (both) | Gate A 2 citizens, B 4 |
| **Provider-decision receipts** | Receipts (response id, model id, authenticated access mode, usage) hash-chained by the provider adapter and joined by `decisionEventId`; a missing receipt keeps the claim at scripted/NOT_PROVEN | provider adapter (independent of the server) | No (grep 0 hits) | G6 | Gate A 1v1 claim, B |

Suggested order (smallest unlocking first): provision record and expected-value plumbing, then used-session ledger, then witness plus validator V2 (new row kinds, agree/disagree rule), then checkpoints and seal, then join mapping, then provider receipts, then an independent verifier run with a second witness used only as a cross-check.

### First scripted smoke versus evidence-grade acceptance

| | First disposable scripted Paper smoke | Evidence-grade Gate A / B |
| --- | --- | --- |
| Authenticity claim | **None.** Report stays `NOT_PROVEN`, `signing.enabled=false`, `liveAuthenticity.certified=false` | Required, adversary-proof |
| Needs | Process and world identity checks (PR #97 chain), operator-collected corroboration labelled human-corroborated | The whole matrix above |
| Witness, signer, key custody, ledger | Do **not** build for the smoke | Required |
| Provider receipts | Not needed (scripted) | Required for any model claim |
| Result may feed an acceptance ledger | **Never** | Only after independent verification of the exact artifact set |

Nothing in #141, #150, #156 satisfies any evidence-grade row. I did not review the Paper smoke stack (#157 and Claude 1's chain); this section covers only the evidence side.

### Remaining risk ledger

| ID | Sev | Item | Owner/next |
| --- | --- | --- | --- |
| R5-M1-B1 | High | #131 rejects signed `withdraw`/`deposit` | Closed by #150; do not integrate #131 |
| R5-M2-M2 | Medium | #154 can leave a real transfer without a receipt under sync lag (fake-proven; real timing unproven) | Fix required before #156 |
| R5-M2-M1 | Medium | `PENDING` observations have no consumer; stale store contents | Design decision |
| R5-M1-L1 | Low | QA94FC default launch 40/41 (QA helper stack), qualification launcher-specific | Replace FC-3 with text-built form |
| R5-M1-L2 | Low | Denylist fingerprinting echoes other authority-flavoured names | Fingerprint all unknown names |
| R5-M2-L2 | Low | Abandoned-withdraw receipt lacks fields the deposit one has; missing `authoritativeStorageUpdated` on the surviving receipt | Before accepting #154 |
| R5-M2-L6 | Low | Heavy offline tests time out under load | Raise limits or reduce work |
| R5-M3-I1 | Info | Personal-chest event rendered as "shared chest" | Before observer UI |
| (standing) | Info | Coherent local forgery of offline bundles is undetectable; CI SHA consistency is self-referential; "independent" CI suite is candidate-controlled | Documented limit |
| (standing) | High for acceptance | All nine provenance limitations; no authentic witness | Mission 4 matrix |

## Reproduction

`scripts/` holds the harness (set `QA_SCRATCH` to a directory containing a clone named `qa` and the frozen worktrees): `run-validator-suites.sh <worktree> <label>`, `run-integration-suites.sh`, `run-round5-tests.sh <worktree> <label> [filter]`, `cli-tamper.sh <clean worktree> <scratch>`, `run-qualified.mjs <vitest config>` (the author's stack qualification). Default tests are in `test/` (67), desired-contract tests that are red by design are in `defects/` (11: QA141-L1/L2 3, QA154-M1 1, QA150-L1 7). The generator refuses to run when `git status --porcelain` is non-empty, so park the overlay directory outside the worktree before generating bundles.

Limits of this review: offline fakes, not a live server (the lag scenario and the overlapping same-owner frames are fake-world behaviours); macOS only; Node 22.12.0 rather than CI's 22.17.1; synthetic keys prove verifier logic only; I did not run the Paper smoke stack.
