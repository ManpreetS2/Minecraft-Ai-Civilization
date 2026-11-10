# Independent re-review — PR #94 (bind validator outcomes to the complete signed journal)

| | |
|---|---|
| Reviewer | Claude Sonnet 5.5 (independent QA; did not author the code under review) |
| Repository | `ManpreetS2/Minecraft-Ai-Civilization-windows-backup` |
| **Candidate (exact)** | `da0e1ff9e7e84647467ac335a7ded698f5f8fdc3` (`fix/v86-signed-evidence-binding`, draft, base PR #86 `8e6ecdcc`) |
| My findings under review | PR #90, `2321a8f80f3eaad3fd28a589a5522327469c6637` |
| QA branch / harness SHA | `qa/verify-evidence-binding-pr94` / `ca6a857825455d7d01efaf509a1f099e047c49b5` |
| Platform | macOS darwin/x64, Node v22.12.0. Linux and Windows not tested; no CI. |
| Not done | No Paper, no paid APIs, no merge. No production or ledger file edited. Mutation checks ran only in a disposable worktree. |

## Verdict: **PASS — as an offline verifier only**

PR #94 closes all five QA86 defects and the TypeScript regression, and my independent canonicalization challenge found **no caller-side tampering bypass**. Three non-blocking items are recorded below (one forward-compatibility regression, two hardening items). **Live signing is a separate requirement and remains NOT PROVEN: there is no genuine Paper signer anywhere in the repository, and every signed fixture in every suite (mine and Codex's) is signed by a key generated inside the test.**

**Suitable for integration as an offline verifier: yes**, with the tracked items below. **Not** suitable to be described as a live Paper authenticity verifier.

## 1. The six checks

| # | Check | Result |
|---|---|---|
| 1 | The three failing typechecks | **PASS.** `typecheck`, `typecheck:tools`, `typecheck:evidence-validator` all exit **0** on a clean checkout (PR #86: 2 / 2 / 2). The fix is the one-line `WorldBlockChange` type import. |
| 2 | The five QA86 defect demonstrations | **PASS.** My original PR #90 suite, unmodified, on PR #94: defect file **7/7 pass** (5 safety assertions + 2 informational), regression **71/71**. On PR #86 the same defect file is 5 red / 2 green. |
| 3 | Canonical row binding rejects altered hunger, health, recipients, citizen IDs, start rosters | **PASS.** Each divergence (12 variants: hunger ±, health ±, recipients +/−, citizenId on attempt and on observation, roster −/+/deleted/reordered) is a `RAW_JOURNAL_ROW_MISMATCH`; none is VERIFIED or `real_minecraft`; an eat whose signed row has no hunger increase stays UNVERIFIED and per-citizen verified counts equal the honest run's. |
| 4 | Signed valid controls still accepted, including optional/default fields and ordering | **PASS** (with the compatibility caveat in QA94-M1). The 9-action rich run, the BigInt-signer run (PEM/hex/KeyObject), exact skew boundaries, allow-list matrix, key reordering of every row and nested object, absent-vs-empty defaults in both directions, and explicit `undefined` all accepted. |
| 5 | Independent canonicalization challenge | **PASS for tampering; see QA94-M1/L1/L2.** Details in section 2. |
| 6 | Offline 1v1/2v2 stay `NOT_PROVEN`; no test signer represented as authentic Paper | **PASS.** See section 4. |

## 2. Independent canonicalization challenge (`adv94-canonical`, 27 tests)

Genuinely signed raw lines; only the caller's parsed rows change.

* **1 338 exhaustive leaf mutations** (every populated value at every depth of every row of a 100-row signed journal: change and delete): every one is a `RAW_JOURNAL_ROW_MISMATCH` and never `real_minecraft`. The 10 survivors are exactly the documented empty-default deletes (`beforeInventory`/`afterInventory`/`worldChanges`/`authorizedRecipients` = empty ⇒ absent).
* An unexpected key added at **every object level** of every row: rejected. Array push / pop / reverse / duplicate of `authorizedRecipients` and `worldChanges`: rejected. Row swap, count change, duplicate, replace-with-neighbour, `seq` edit: rejected.
* **Root `hash`/`previousHash`** edits in the parsed row are ignored (the raw chain verifies them), and the same edits in the *raw* lines break the chain so the run is not `real_minecraft`. **Nested** fields named `hash`/`previousHash` **are** bound.
* **Exotic parsed values** (NaN, ±Infinity, Date, Map, Set, function, BigInt, Symbol, class instance, circular object, throwing getter, `[1, undefined]`, boxed Number, typed array) in a numeric field, a string field, an inventory leaf, an array element and the roster: each is rejected, **never throws**, never `real_minecraft`. `Object.create(null)` rows equal their plain twins. `__proto__`/`constructor`/`prototype` keys are data, no pollution. Depth-5 000 nesting fails closed.
* **Signed metadata present in both copies** (top-level and nested `meta.build.n`, `tags[]`): accepted and ignored; changing one nested leaf: rejected. A signed `decisionSource` outside the enum: `INVALID_ACTION_DECISION_SOURCE`, not verified.
* **Mutation check** (9 mutants of the canonicalization in a disposable worktree: ignore `citizenId`, ignore nested hash names, keep parsed rows, defaults for every kind, no key sort, no decisionSource enum, no count check, array order ignored, non-JSON normalised to null): **9/9 killed**.
* **Differential:** the same 27 tests: 17 fail on PR #86, all pass on PR #94.

## 3. Findings (none blocks offline integration)

| ID | Sev | Defect |
|---|---|---|
| **QA94-M1** | Medium for live/forward compatibility; none offline. **Fail-closed, not a bypass.** | The shipped `adaptRecorderJournal` strips recorder fields that are not in the strict validator schema ("future recorder additions") and `writeOfflineValidatorReport` passes those stripped rows next to the raw lines. Full-row binding therefore flags any genuinely signed row that carries an extra field. Example: a tick with `tickCpuMs: 3` is `VERIFIED` on PR #86 and `VIOLATIONS_DETECTED` (`RAW_JOURNAL_ROW_MISMATCH`) on PR #94. The current recorder emits only schema fields: the real scenario-2/4 journals pass with **zero violations**, so nothing offline is affected. Codex's "future signed metadata" test passes only when raw **and** parsed both carry the field, which the shipped adapter never produces. Fix: compare the raw row projected through the same adapter allow-list (or treat raw-only keys as ignorable signed metadata); keep nested/known fields strict. |
| QA94-L1 | Low (hardening; needs a malicious signer) | Raw rows are now authoritative but are not schema-validated on the library path; only the `decisionSource` enum is re-checked. A signed `tick.durationMs: []`, `start.runId: {}` or `verified: "yes"` (identical in raw and parsed) can yield `real_minecraft`/`VERIFIED`. (On PR #86 two of these were rejected only by accident of a reference comparison.) The CLI/adapter path is protected by the strict schema. Fix: run `journalRowSchema.safeParse` on each raw row and flag `RAW_JOURNAL_SCHEMA_VIOLATION`. |
| QA94-L2 | Low (availability; pre-existing from PR #86) | Malformed signed values crash the validator: `start.citizens` as a string (`startRoster.join is not a function`), `observation.worldChanges` as a non-array (`.some is not a function`). 11 of 4 740 hostile-typed signed-row probes throw, identically on PR #86 and PR #94. The same schema check removes it. |

## 4. Offline scenarios and signer provenance

* Fresh `pnpm v1:offline 2` and `4` on clean trees of PR #94, #86 and #67. Recomputed from `operator.jsonl`/`manifest.json`: 1v1 **6** distinct attempts, 2v2 **12**, each with a matching observation; exactly 3 `oak_log` per citizen three ways; 2 scripted + 1 planner per citizen, **0 model**; source SHA equals HEAD.
* Report: **`NOT_PROVEN`**, **`offline_simulated`**, 0 violations, `sourceAttestationAudit.sourceType = "missing"`, no server ticks. Through the shipped path, a bundle-supplied attestation is never honoured; a re-sealed phantom gather or scripted→model relabel never produces `VERIFIED` or `real_minecraft`.
* No signer material ships: the production sources contain no PEM private key and no hard-coded trust-root entry, `server/` holds only example configuration, and no code anywhere issues attestations. Every `paper_server_attested` object in any suite is built by the test with an in-memory key (node:crypto or my BigInt RFC 8032 signer). **No test-generated signer is, or can be, represented as authentic Paper by the shipped code.**

## 5. Legacy assertions Codex changed (verified, not weakened)

Diffed line by line against my originals. Two assertions were *strengthened*: QA67 "an omitted parsed start row cannot replace signed source identity" (was an informational test asserting the weakness) and QA75 "rewriting an attempt's citizenId is rejected by the raw-row binding" (was asserting the binding defect remained). Codex's QA86 copy differs from mine only by an unused import, `any`→`unknown`, and a `require`→`import`. No `skip`, `only`, `todo` or `it.fails` was added. My **unmodified originals** therefore show exactly **+1 red each**: QA67 44 red (the 43 defects + the rewritten informational test), QA75 11 red (the 10 + the citizenId test). Both are the intended behaviour change.

## 6. Counts (macOS, Node 22.12, exact SHA `da0e1ff`)

| Run | PR #94 | PR #86 |
|---|---|---|
| typecheck / tools / evidence-validator | **0 / 0 / 0** | 2 / 2 / 2 |
| lint / build | 0 / 0 | 0 / 0 |
| `pnpm test` | 199 files, 2264 | same |
| `test:security` / `test:ai` / `test:v1` / `test:evidence-validator` | 358 / 514 / 100 / 161 | same |
| Author QA67 / QA75 / QA86 (as shipped) | 150 / 51 / 78 | n/a |
| My original QA67 (150, `it.fails`) | 106 pass + **44 red** (vulnerable source: 150/150) | 107 + 43 red |
| My original QA75 (51, 10 `it.fails`) | 40 pass + **11 red** | 41 + 10 red |
| My original QA86 regression / defect file | **71/71** / **7/7** | 71/71 / 5 red + 2 |
| **QA94 regression suite** | **27 passed, 0 failed, 0 skipped**, no `it.fails` | 10 pass / 17 fail |
| **QA94 defect demonstrations** | **5 red** (M1 ×1, L1 ×3, L2 ×1), 2 green | 2 red |

Codex added no unit tests under `experiments/evidence-validator/test` (161 before and after); its new tests live in `qa/v86`. All gate counts are from a single clean checkout per SHA, run sequentially.

Reproduce: `qa/v94/scripts/run-on-candidate.sh <repo> da0e1ff9e7e84647467ac335a7ded698f5f8fdc3 8e6ecdcc9ef3b06ae2e96abe802da7650d194779 2baaf8a49806ae01d3bcc3e1c481b8479ccf77ed <new-empty-dir>`

## 7. Not proven
A genuine Paper signing authority, a signed live capture, key custody/rotation/distribution of a trust root, replay protection across sessions, behaviour with a recorder that emits additional fields (QA94-M1), Linux and Windows.
