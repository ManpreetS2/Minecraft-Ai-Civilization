# Final Evidence-Security Re-Audit — PR #86 (QA75 residuals)

| | |
|---|---|
| Reviewer | Claude Sonnet 5.5 (independent QA; did not author the code under review) |
| Repository | `ManpreetS2/Minecraft-Ai-Civilization-windows-backup` |
| **Candidate (exact)** | `8e6ecdcc9ef3b06ae2e96abe802da7650d194779` (`fix/evidence-authenticity-residuals`, draft, base PR #75) |
| PR #75 | `014804fbc6a2a1e1b74940b235dc8ff0a0fd884a` |
| PR #67 (original vulnerable) | `2baaf8a49806ae01d3bcc3e1c481b8479ccf77ed` |
| Prior QA | PR #77, `qa/verify-evidence-security-fixes` @ `5c545d25` |
| QA branch / harness SHA | `qa/verify-evidence-authenticity-pr86` / `5704ae49cca165e9f80db1abfd306178e1089494` |
| Platform | macOS darwin/x64, Node v22.12.0. **Linux and Windows not tested; no CI.** |
| Not used | Paper, paid calls, network, protected merges. No implementation or ledger file was edited. Mutation checks ran only in a disposable worktree. |

## Verdict: **CHANGES REQUIRED**

**Two separate questions, two separate answers.**

1. *Is the validator implementation secure?* **Not yet.** PR #86 closes QA75-M1, the QA75-M2 omissions and the L1–L5 items I reproduced, and every one of the ten QA75 `it.fails` conversions is faithful. But it (a) **breaks `pnpm typecheck`, `typecheck:tools` and `typecheck:evidence-validator`** with a missing type import (`validator.ts:509`), contradicting the PR's "0 errors"; and (b) leaves QA75-M3 only **partly** closed: `hungerBefore/After`, `healthBefore/After` and `authorizedRecipients` are still read from the caller-supplied row, so an *unverified* eat or speech action becomes `VERIFIED` inside a `real_minecraft` / `VERIFIED` report with zero violations. `citizenId` and the start-row roster are not bound either.
2. *Is there a trustworthy real-world signing authority?* **No, and nothing here shows one.** The repository contains no signer, no Paper plugin, no key issuance and no trust-root distribution: `server/` holds only example config files, and every signed fixture in every suite (mine and Gemini's) is signed by a key generated in the test. A passing synthetic signed control proves the verifier's logic, not that a genuine Paper signer exists. **Live Paper authenticity remains NOT PROVEN.**

* **Recommendation:** the repaired verifier must **not** enter the combined offline candidate until the typecheck regression is fixed (it breaks three gates that the combined candidate must pass). After that it may enter for **offline-only** use, with QA86-M1 recorded as a known issue. It must not be described as a trustworthy live Paper verifier.

## 1. Original defects replayed against both sources

| Suite | Vulnerable source | PR #75 | **PR #86** |
|---|---|---|---|
| My original QA67 (150, `it.fails` intact) | 150 / 150 | 107 pass / 43 red | 107 pass / **43 red** (all 43 closed) |
| Gemini's QA67 copy | 107 / 43 red | 150 / 150 | **150 / 150** |
| My original QA75 (51, 10 `it.fails`) | n/a | 51 / 51 (defects present) | 41 pass / **10 red** (all 10 closed) |
| Gemini's QA75 copy | n/a | 41 pass / 10 red | **51 / 51** |

**Did Gemini weaken the ten conversions?** No. The diff between my QA75 files and the copy PR #86 ships is exactly: ten `it.fails` → `it` (same names, same bodies, same assertions), one unused import removed, and `any` → `unknown` typing. Test names are identical; nothing is skipped, deleted or loosened. They are not vacuous: the converted copy fails 10 tests on PR #75. The converted copy does not exercise the CLI vacuously either (the CLI test asserts the report exists).

Note, however, that two of my QA75 probes were deliberately *narrow*: the M3 probes edited tick, position and inventory fields only. Fixing exactly those fields is what PR #86 did. My new field-by-field mutation (below) shows the same class survives in other fields.

## 2. Independent adversarial verification

All inputs are **genuinely signed** (node:crypto keys, and a QA-owned RFC 8032 BigInt signer that shares no code with node:crypto or the validator) with **raw journal lines untouched**; only caller-supplied parsed rows, windows and options change.

* **A. Valid signed controls accepted (27 tests):** a rich 60-minute journal with gather, craft, place, move, eat, speech and deposit across two citizens is `real_minecraft` / `VERIFIED` (9/9 actions, 0 violations), signed by both signers and via PEM, hex and KeyObject keys; TPS jitter; windows padded by 10 min or written with +00:00; exact skew boundaries (5.000 s accepted, 5.001 s rejected, at both ends).
* **B. Replay of every QA75 defect (24 tests):** shifted/partial/disjoint windows (8 variants), omitted ghost rows, omitted observation/attempt/tick/shutdown rows, omitted conflicting start rows (sourceSha, runId, experimentId), injected and duplicated rows, empty or missing `journalRows`, smoothed tick regression (also with every parsed tick rewritten), compressed timestamps, forged position, forged worldChanges, and per-field edits of before/after inventories, `verified`, `successReported`, `expectedItem`, `target`, `range`, `decisionSource` (scripted→planner/model/reflex), `decisionEventId`, `action`, `failureCode`, plus L1, L2, L3 and L5 (real CLI processes).
* **C. Legitimate physical losses:** with attributable evidence (a verified deposit / craft / place / eat whose observed before/after shows the loss) the ledger balances and **no** `UNEXPLAINED_LOSS` is raised. Without evidence the loss is a hard `UNEXPLAINED_LOSS` and the run is neither VERIFIED nor `real_minecraft`. This is correct fail-closed behaviour; the PR does not add a way to record a loss other than an action observation (documented limit).
* **D. Mutation fuzz of every parsed-row field** (1 600 mutations of a 100-row signed journal). 350 were not detected; they are all of three kinds: `hash`/`previousHash` (verified from the raw lines, harmless), no-op deletions of empty defaults, and the fields listed in section 3.
* **E. Differential:** my 71 QA86 tests: **49 pass on PR #75 and 22 fail** (windows, omissions, per-field edits, empty allow-list, mode, CLI), **all pass on PR #86**. Mutation check (12 mutants in a disposable worktree): 8 killed; the rest are redundant-defence mutants (two independent checks cover the same attack).

## 3. Findings

| ID | Sev | Defect |
|---|---|---|
| **QA86-G1** | **High (gate)** | `experiments/evidence-validator/src/validator.ts:509`: `error TS2304: Cannot find name 'WorldBlockChange'`. `pnpm typecheck`, `typecheck:tools` and `typecheck:evidence-validator` all **exit 2** on a clean checkout of `8e6ecdc`. On PR #75 only `typecheck:tools` failed (the original QA75-G1). The PR fixed that one line, introduced this one, and reports "0 errors". Lint and build still pass. Fix: `import type { WorldBlockChange }`. |
| **QA86-M1** | **Medium** | QA75-M3 only partly closed. Edited in the parsed row only (raw signed and untouched): an eat observation with no hunger increase (honestly `UNVERIFIED`) → `hungerBefore:10, hungerAfter:16` gives 9/9 verified, `real_minecraft` / `VERIFIED`, **0 violations**. Same for a speech observation with no authorized recipients → add one recipient. `healthBefore/After` also diverge unflagged. The bound-field list in `validator.ts` omits `hunger*`, `health*`, `authorizedRecipients`. |
| QA86-L1 | Low–Med | `citizenId` is not in the raw-row binding. Re-attributing a signed *move* (attempt and observation) from one registered citizen to another: atlas 1→0, maya 1→2 verified, `VERIFIED`, 0 violations (only detected incidentally when inventories differ). |
| QA86-L2 | Low | The parsed start row's `citizens` is not bound to the signed start row: deleting it hides a `ROSTER_CONFLICT` that the signed start row carries (report: `real_minecraft` with `NOT_PROVEN`). |
| — | Info | Raw-row binding is O(n²): 2 000 rows 175 ms, 10 000 rows 2.4 s. Acceptable for a 60-minute run. |
| — | Info | A malicious *signer* (or a trusted key in the caller's own trust root) can still sign anything; the verifier then checks internal consistency only. By design. |

Suggested fix for M1/L1/L2: compare the **whole** parsed row to the raw row (every key except `hash`/`previousHash`) instead of an allow-list of fields, and bind `citizens` and `citizenId`. My mutation fuzz is the regression test for it: after the fix the undetected set should shrink to the three harmless kinds above.

## 4. 1v1 and 2v2 from the original journal artifacts (exact SHA)

Generated with `pnpm v1:offline 2` and `pnpm v1:offline 4` on clean trees (PR #86, PR #75, PR #67) and recomputed from `operator.jsonl` / `manifest.json` without calling the validator, then again through the shipped report path.
* 1v1: **6** distinct attempts, 6 matching observations; 2v2: **12** and 12. Every citizen holds exactly 3 `oak_log`, derived three independent ways (observations, bundle actions, physical finals).
* Labels: 2 `scripted` + 1 `planner` per citizen, **0 `model`**, `decisionTransport = scripted-in-process`.
* Source SHA is the exact candidate HEAD in the journal start, bundle and report; the report's experimentId equals the journal's.
* Status **NOT_PROVEN**, mode **`offline_simulated`**, 0 violations, no attestation, no server ticks. Re-sealed tampering (a phantom gather, a scripted→model relabel, a bundle-supplied attestation) never yields a VERIFIED headline or `real_minecraft`.

## 5. Counts (macOS, Node 22.12)

| Run | PR #86 | PR #75 |
|---|---|---|
| `pnpm typecheck` / `typecheck:tools` / `typecheck:evidence-validator` | **exit 2 / 2 / 2** | 0 / **2** / 0 |
| `pnpm lint` / `pnpm build` | 0 / 0 | 0 / 0 |
| `pnpm test` | 199 files, 2264 | 199 files, 2264 |
| `test:security` / `test:ai` / `test:v1` / `test:evidence-validator` | 358 / 514 / 100 / 161 | same |
| Author QA67 / QA75 (as shipped) | 150 / 51 | 150 / n/a |
| **QA86 regression suite** | **71 passed, 0 failed, 0 skipped**, no `it.fails` | 49 of 71 pass, 22 fail |
| **QA86 defect demonstrations** | **5 red**, 2 green informational | |

`test:ai` had one unrelated 5 s timeout (`manager-citizen-routing`) in the first gate pass; it passed 3/3 in isolation and the full `test:ai` rerun passed 514/514 (load-induced, reported not hidden).

Reproduce: `qa/v86/scripts/run-on-candidate.sh <repo> 8e6ecdcc9ef3b06ae2e96abe802da7650d194779 014804fbc6a2a1e1b74940b235dc8ff0a0fd884a 2baaf8a49806ae01d3bcc3e1c481b8479ccf77ed <new-empty-dir>`

## 6. Not proven
A genuine Paper signing authority, a signed live capture, trust-root distribution, key custody and rotation, replay protection across sessions, Linux and Windows, and any live-safety claim. Everything above is the verifier's logic on synthetic signed fixtures.
