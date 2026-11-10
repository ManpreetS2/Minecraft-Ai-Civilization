# Independent Security and Evidence Audit — PR #67

| | |
|---|---|
| Reviewer | Claude Sonnet 5.5 (independent QA; did not author the code under review) |
| Repository | `ManpreetS2/Minecraft-Ai-Civilization-windows-backup` |
| **Candidate (exact)** | `2baaf8a49806ae01d3bcc3e1c481b8479ccf77ed` (`fix/scripted-evidence-validation`, draft, no CI configured) |
| Base (exact) | `1d7170741bdebe04e1c7c59eb210c0a357d5b0ea` (PR #61, `work/runtime-action-recording`) |
| QA branch | `qa/evidence-validation-review` |
| QA harness SHA used for the formal run | `58117fb05369d4d847bfe68a8846a28553a35133` |
| Platform | macOS darwin/x64, Node v22.12.0, pnpm 10.16.0. **Nothing here is proven on Linux or Windows.** |
| Not used | live Paper, paid providers, production data, destructive Git, protected merges. Synthetic Ed25519 keys only, generated in memory. The implementation was never edited. |

## Verdict: **CHANGES REQUIRED**

* **Confirmed (scoped PASS).** The headline fix works. The false `SPONTANEOUS_GAIN` / `VIOLATIONS_DETECTED` defect is reproduced on base and closed on the candidate. `scripted` stays `scripted`, genuine `model` stays `model`, every observation maps to the right attempt, and simulated offline runs stay `NOT_PROVEN`.
* **Not accepted.** The assignment's identity and signed-evidence contract does not hold:
  * One **regression** introduced by this PR: the attestation is no longer bound to the manifest (QA67-R1).
  * Conflicting source, run, experiment and roster identities are silently resolved by precedence (QA67-M1).
  * Four more authenticity gaps (M2–M5), two provenance gaps (M6, M7) and five low items.
* **Exposure today.** No shipped production path loads a trust root or an attestation, and no live Paper capture exists. Nothing here is exploitable through a current runtime flow. The defects block treating the validator as a trustworthy *live* gate.
* **Integration.** Cursor may merge #67 for the offline scripted fix only after R1 is corrected. Its test suite must not be cited as proof of the signed-evidence contract.

## 1. Tests and counts (formal run, clean worktrees at the exact SHAs)

| Run | Files | Passed | Failed | Notes |
|---|---|---|---|---|
| Author's validator suite (`pnpm test:evidence-validator`) | 21 | **161** | 0 | base: 20 files / 149, so +12 and none removed |
| `pnpm test:v1` | 9 | 100 | 0 | same on base |
| Full `pnpm test` (candidate vs base) | 199 | 2264 | 0 | identical on both. This config does not include the validator or tools suites. |
| `test:security` / `test:ai` | | 358 / 514 | 0 | identical on base |
| typecheck, typecheck:tools, typecheck:evidence-validator, lint, build | | clean | | both SHAs |
| **QA67 adversarial suites (candidate)** | 6 | **150** | **0** | **43 of the 150 are expected-failure (`it.fails`) reproductions of defects** |
| Same QA67 suites on base (differential) | 6 | 106 | 44 | all 44 are base inability or old defects; **0 tests pass on base and fail on candidate** |

* The author's claim of 161 validator and 100 v1 tests passing is accurate. The `v1:offline 2` / `4` figures are also accurate.
* Because the defect reproductions are `it.fails`, they pass only while the defect exists. When a defect is fixed its test turns red and must be flipped to a normal `it`.

Reproduce (about 3 minutes, no network):
```
git fetch origin qa/evidence-validation-review
git checkout qa/evidence-validation-review
qa/v67/scripts/run-on-candidate.sh <repo> 2baaf8a49806ae01d3bcc3e1c481b8479ccf77ed 1d7170741bdebe04e1c7c59eb210c0a357d5b0ea <new-empty-parent-dir>
```

## 2. Scripted-decision provenance — confirmed

Real artifacts from `pnpm v1:offline 2|4` on both SHAs, run through the shipped integration path (`writeOfflineValidatorReport`).

| | base #61 | candidate #67 |
|---|---|---|
| 2 citizens: attempts / verified | 2 / 2 | **6 / 6** |
| 2 citizens: verdict | `VIOLATIONS_DETECTED`, `UNMATCHED_ACTION_OBSERVATION` ×4, `SPONTANEOUS_GAIN +2` per citizen | **`NOT_PROVEN`, 0 violations, 0 inventory discrepancies** |
| 4 citizens: attempts / verified | 4 / 4 | **12 / 12**, `NOT_PROVEN` |

* **The old false spontaneous-gain defect is reproduced on base and closed.** The `+2` per citizen equals exactly the two `scripted` attempts the old schema could not parse.
* **Not closed by hiding.** I independently recomputed attempt-to-observation mapping from the raw journal. Each observation has exactly one earlier attempt for the same citizen, and ids are unique. Each citizen has one `planner` and two `scripted` rows.
* **Inventory.** Every observation is +1 `oak_log`, and per-citizen continuity holds. The sum is 3 per citizen, equal to the physical final inventory and the validator ledger.
* **Source labels.** A test over every allowed source gives:
  * `scripted`, `model`, `planner` and `reflex` are preserved verbatim, including a mixed journal.
  * `llm`, `Model`, `SCRIPTED`, `"scripted "`, `""`, `human` and `__proto__` fail closed. The attempt is rejected, and its orphaned observation is `UNMATCHED_ACTION_OBSERVATION`.
  * Extra "provenance-looking" fields such as `isGenuineModel` are never promoted.
  * No `"decisionSource":"model"` appears in any scripted artifact, report or bundle.
* **Attacks correctly rejected** (hash chain re-sealed, since the chain is unkeyed):
  * deleted attempt
  * deleted observation
  * attempt with no observation
  * observation moved before its attempt
  * duplicate attempt (`DUPLICATE_ATTEMPT_ID`)
  * duplicate observation
  * cross-citizen observation (`CORRUPTED_ACTION_EVIDENCE`)
  * tail truncation
  * 6 un-re-sealed edits (all `CORRUPTED_HASH_CHAIN`)
* **Identity in the offline report.** `sourceSha` equals `HEAD`, the journal start row and the bundle. `runId` and the citizen list agree with the start row. Zero-SHA and `"unknown"` placeholders are gone when real identity is present.

## 3. Confirmed defects

All have a named reproduction test (`[QA67-xx]` in the test title).

| ID | Sev | Origin | Defect |
|---|---|---|---|
| **R1** | **Medium (regression)** | **introduced by #67** | The attestation's expected SHA and experiment now come from the **caller's input first**, then the manifest, then the start row. Base bound them to the manifest. A genuinely signed attestation for source X, with caller `sourceSha: X` while the manifest and journal say Y, reaches `real_minecraft` / `VERIFIED`, and the report states X. Same for `experimentId`. Base rejected both. |
| **M1** | Medium | new surface, no conflict detection | The PR adds resolution of identity from caller, manifest and start row but never compares them. Silently accepted (13 reproductions): bundle SHA ≠ journal SHA (either side edited), bundle runId ≠ start runId, rows with differing `experimentId` mid-stream, an injected second `start` row with another SHA, roster ghost/missing citizen, and the caller roster overriding the journal's. An invalid caller SHA (39 hex, uppercase, `"unknown"`) is silently dropped in favour of another source. |
| **M2** | Medium | pre-existing, not fixed by the "trust-root hardening" | `parseEd25519PublicKey` accepts degenerate small-order points: identity `0100…00`, order-2 `ecff…7f`, and all-zero. With the identity key as trust root, a signature of 64 fixed bytes **with no private key** gives `signatureValid=true`, `real_minecraft`, `VERIFIED`. The PR correctly rejects private, RSA, EC and secret keys but not these. |
| **M3** | Medium | pre-existing | Signed `startedAt`/`endedAt` are checked only for parseability and `end > start`. A signed 1-second window carrying 72,000 ticks, or a window a year earlier or in the future, is **proven**. It is never reconciled with journal timestamps, claimed duration, or the 20 TPS ceiling. |
| **M4** | Medium | pre-existing (library API) | `journalRows` are not bound to the signed `rawJournalLines`. Forged rows with a genuine chain give `VERIFIED` and 0 violations. A genuinely signed 2-minute tick-sprint capture (72,000 ticks, honest 2-minute signed window) with caller-stretched row timestamps reaches `real_minecraft`. The shipped CLI and pipeline derive both from one file, so this needs a caller that supplies them separately. |
| **M5** | Medium | pre-existing (identical on base) | Tick-progression requirements apply only when the claim is ≥ 60 minutes. A 59-minute claim with a **frozen** tick (one sample, total 0) is `real_minecraft`/`VERIFIED`. So is a 30-minute claim with 60 ticks of progress. |
| **M6** | Medium | pre-existing check, newly reachable | An attempt relabelled `scripted`→`model` while the start row says `decisionTransport: scripted-in-process` is accepted with no flag, and the report then shows `model`. |
| **M7** | Medium | pre-existing check, newly reachable | Inventory reconciliation is one-directional (only ledger < final inventory is flagged). Accepted silently: a forged self-consistent extra gather (ledger 4 vs physical 3), an observation whose `before` doesn't continue the previous `after` (40→41), and a fully forged attempt+observation for a citizen not in the roster (`PHANTOM_CITIZEN_ACTION` needs a manifest, absent in this pipeline). `verifiedActions` counts the forgeries. |
| L1 | Low | pre-existing | An observation timestamped before its attempt is only a `reason` string. The action is still `VERIFIED`. |
| **L2** | Low | see §4 | The signed `totalServerTicks` tolerance. |
| L3 | Low | pre-existing | `trustedAuthorities` is accepted, passed through, and **never enforced**. An authority outside the allow-list is still proven. |
| L4 | Low | new | The pipeline's report `experimentId` is the `runId` (`fixture-2-…`) while every journal row says `off2`. The CLI report for the same journal says `off2`. |
| L5 | Low | pre-existing | The validator CLI headline status for a simulated, unattested scripted journal is `VERIFIED` (the human note, `mode: offline_simulated`, attestation `missing` and `serverTickProven:false` all disclaim it). Base's CLI rejected such journals at parse. The shipped v1 pipeline separately caps it to `NOT_PROVEN`. |

## 4. The 1,200-tick tolerance — reproduced and evaluated

* **What the code enforces.** Signed `first`/`last` must equal the journal samples **exactly** (±1 tick fails). The signed `total` must satisfy `span ≤ total ≤ span + 1200`. Measured band, signed total minus sampled span:

  | Delta | −1 | 0 | +1 … +1200 | +1201 and up |
  |---|---|---|---|---|
  | Result | rejected | proven | proven | rejected |

* **Does it let a short run pass?** No. The duration audit uses the *journal* samples, not the signed total. A 66,000-tick journal with a signed total of 67,200 is still rejected.
* **Is it excessive or wrongly assumed?**
  * With `first`/`last` pinned to the samples, `total` has no independent freedom, so ≤ 1,200 ticks of unexplained inconsistency is accepted for no reason (**L2**). The "sampling difference" rationale cannot apply.
  * The constant matches nothing in the code: the tick-gap bound is 6,000 ticks and the wall-gap bound is 65 s.
  * It also rejects an honest wider window. A signed window covering one extra sample on each side (+2,400) is rejected.
  * Verdict on this question: a **Low** contract-definition defect, not an exploitable bypass.
* **Improvement over base.** Base had no check on `total` at all (absurd and understated totals were accepted).
* **Missing timestamps and gaps.**
  * Never create proof: missing `startedAt`/`endedAt`, an unparseable or missing journal `at`, no or only-null `serverGameTick`, no attestation, no TPS, a 10-minute wall hole, a >5-minute tick gap, tick regression or duplicate, 68,399 vs 68,400 elapsed ticks.
  * A null-tick filler variant (sampled for 6 minutes, then 54 minutes of filler) is also rejected.
  * The real gaps are M3 (signed window not reconciled) and M5 (short claims).

## 5. Signed evidence — what holds

* **Rejected or never proven:**
  * wrong key
  * private key (PEM and KeyObject)
  * RSA, P-256 and secret keys
  * empty, whitespace or malformed key strings
  * `__proto__`, `constructor`, `toString`, `hasOwnProperty` and `valueOf` as authority names
  * authority-name/key mismatch
  * non-canonical signature (S+L)
  * wrong-length, garbage and double-prefix signatures
  * every signed field flipped after signing (11 fields)
  * replay against an extended, dropped, swapped, CRLF or padded journal
  * a valid signature over the offline scripted journal (no server ticks, so never `real_minecraft`)
  * `offline_simulated`, `unverified_client` and unknown source types
* **Informational.** Control characters (a newline in `serverVersion`) are accepted in signed text fields. I found no reachable canonical-payload collision, because the payload ends in numeric fields.

## 6. Remaining unproven

* **Genuine Paper execution** — `NOT_PROVEN`, as required. There is no real signing authority, trust root or live capture to test against.
* **Real signer contract.** There is no signer implementation to test, so the meaning of `totalServerTicks` and the signing format remain a paper specification.
* **Linux and Windows.** No CI exists for #67 and I ran macOS only.
* **Live Minecraft physical evidence.** The inventory ledger comes from controlled offline bodies.

## 7. Correction instructions

1. **R1/M1 (blocking).**
   * Add one identity resolver.
   * Gather source SHA, experimentId, runId and roster from caller, manifest, **all** `start` rows, every row's `experimentId`, and the attestation.
   * Any two defined values that differ → an `ERROR` violation (for example `SOURCE_IDENTITY_CONFLICT`). An invalid caller value is a violation, not a silent skip.
   * The attestation's expected SHA/experiment must be the manifest's or the start row's value, **never the caller's alone**.
   * `report.experimentId` should be the journal's. Carry `runId` separately.
   * Check attempts against the start-row roster when no manifest exists.
2. **M2 (blocking before any trust root is shipped).** Reject small-order and non-canonical Ed25519 public keys in `parseEd25519PublicKey` (the 8-torsion encodings, including identity, order-2 and all-zero). Flip the four M2 tests.
3. **M3/M4.**
   * Verify the signed window against the journal's first and last `at`, the claimed duration, and ≤ 20 TPS (+ slack).
   * Make the validator take raw lines as the single source and derive rows from them (or assert equality).
4. **M5.** Apply the tick-floor and minimum-sample rules to every claimed duration (`ticks ≥ 0.95 × claimed × 1200`).
5. **M6/M7/L1.**
   * Flag `decisionSource` vs `decisionTransport` contradictions.
   * Reconcile in both directions with per-citizen `before`/`after` continuity.
   * Treat observation-before-attempt as `CORRUPTED`.
6. **L2.** Specify `total` as `last − first` (or a documented window) and delete the 1,200 constant.
7. **L3–L5.** Enforce or remove `trustedAuthorities`; keep one `experimentId`; cap CLI/library `overallStatus` at `NOT_PROVEN` for `offline_simulated`.
8. **Process.**
   * Add Linux and Windows CI for the validator.
   * As each defect is fixed, flip its `it.fails` test to a normal `it`.

## 8. Harness notes and disclosures

* Two of my own early probes were wrong and were corrected before any conclusion. A tick-floor probe built a non-monotone series, and a frozen-server probe used `null` filler, which base treats as a regression. The final M5 probe omits the key and behaves identically on both SHAs.
* The base differential is not apples-to-apples for pipeline tests. Base cannot parse `scripted` journals, so those 44 failures are base inability, not "fixed defects".
* The standard `pnpm test` config does not execute the validator suites, so use `pnpm test:evidence-validator`.
