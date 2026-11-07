# Make offline CI reject forged and contradictory evidence

Branch `fix/offline-ci-evidence-hardening`, stacked on PR #73 (`764436cb6a62882e1d631ed46cf31918e8d0fd92`). Closes the remaining CI evidence-integrity defects found by the independent audit in PR #72 (`ff268652a234e425959bfeaf0353f8e53d55755f`).

> **Offline-only verdict.** This strengthens *consistency* verification of locally generated, scripted offline evidence. It does **not** authenticate that evidence, create an external trust anchor, or touch Gemini's separate live-attestation vulnerabilities (PR #67). Genuine Paper execution is, and stays, **NOT PROVEN**. Offline structural checks passing is not live acceptance.

## 1. Codex's PR #73 fixes: inspected first, preserved, not weakened

Read from the actual #73 code before any edit. All still present and still exercised:

| #73 fix | Where | Status here |
| --- | --- | --- |
| Explicit experiment id passed as the 6th journal-CLI argument (from `manifest.configuration.experimentId`) | `checkJournalCliIntegration` | unchanged |
| Real journal subprocess (`node --import tsx tools/v1-integration/journal-cli-main.ts`, no `pnpm`, no shell) | same | unchanged |
| Missing-root and missing-journal controls (exit 2) | same | unchanged, kept as `exitCodes.missingRoot / missingJournal` |
| Real forged-receipt control (receipt rewritten *and re-pinned*, exit 1) | same | unchanged, kept as `exitCodes.forged` (now also `forgedReceipt`) |
| Journal failure propagates to CI failure | `verify-offline-acceptance.ts` | kept; generalised to both scenarios |
| Cross-platform subprocess handling | `process.execPath` | kept |
| `journal-execution.test.ts` (2 tests on the committed real 1v1 bundle) | `tools/ci/` | untouched; both pass |

Codex's 16 verifier regressions (`offline-acceptance.test.ts`) all still pass with their assertions intact. Two edits to that file were unavoidable and are called out here: (1) the hand-built fixture builder was made faithful to the recorder's real shape (event ids, journal coordinates, receipt SHA-256 pins, structured `acceptance.json`), because the stricter cross-checks correctly refuse a fixture that omits fields the recorder really writes; no tamper hook or assertion was changed; (2) one assertion encoded the exact headline this task forbids (`# ✅ Offline Acceptance Verification Report: PASSED`), so it now asserts the qualified headline and that the old one is absent.

## 2. What changed

| Area | Change |
| --- | --- |
| `tools/ci/evidence-consistency.ts` (new) | Cross-source agreement and authenticity-claim checks, using the fields the recorder actually wrote (below). |
| `tools/ci/offline-acceptance-verifier.ts` | Runs the cross-check; adds `contradictions` and parsed `acceptance` to each scenario result; `checkJournalCliIntegration` gains **missing-receipt** and **rehashed forged-journal** controls and reads the citizen / original attempt / observation counts from the journal itself (must be 2/6/6 or 4/12/12); `classifyOutcome()` and a new summary. |
| `tools/ci/verify-offline-acceptance.ts` | Verifies **and journal-cross-checks each scenario independently**; any status other than `OFFLINE_STRUCTURAL_PASS` exits **1**. |
| `qa/verify-ci-verifier/` | PR #72's adversarial suite imported; 13 `it.fails` reproductions converted to ordinary tests; a reproducible `outcome-table.ts`. |
| `tools/ci/evidence-hardening.test.ts` (new) | The T01-T26 matrix plus re-pinned-forgery, classification, headline and 2v2 control tests on the **committed real bundles**, so it runs in `pnpm test` / `pnpm test:v1` on every OS. |
| `.github/workflows/offline-acceptance.yml` | New step runs the adversarial suite on the freshly generated real bundles in both jobs (so ubuntu, macos **and windows**), triggers on `docs/evidence/offline-integration/**`. |
| `.gitattributes` | `docs/evidence/offline-integration/** -text`: the committed bundles are hashed byte-for-byte, so no platform may rewrite their line endings. |

### What is cross-checked (T01-T05, T07-T08, T10, T12, T14, T22-T24)

- **Original journal ↔ manifest actions:** same attempt ids and order; citizen; `decisionSource`; `eventId` = journal `decisionEventId`; `actionType`; `reportedSuccess` = `successReported`; `observedSuccess` = `verified`; `inventoryDelta` = journal after − before; `expectedDelta` vs `expectedItem`.
- **Receipts:** SHA-256 of the file bytes = the manifest pin (**every** pin, including persistent-fact receipts); pin identity fields; `runId`, `sourceSha`, `repository`, `eventId`, family/model/session vs the manifest citizen; receipt `journal.attemptSequence/observationSequence` = the original rows' `seq`; `inventoryBefore/After`, `worldChanges`, hunger, `targetPosition`, `positionAfter` = the original journal rows. Orphan pins and missing files are structural errors.
- **Citizen ownership and inventory continuity:** every row belongs to a manifest citizen; each citizen's `beforeInventory` equals their previous `afterInventory` (starting from `initialInventory`); validator `actionVerifications` and final inventories agree with the journal.
- **Identity:** journal `experimentId` on every row, `runId`, `sourceSha`, start-row citizen set, validator attribution.
- **Authenticity claims:** `acceptance.json` (live tally must be 0 and `NOT MEASURABLE`; no live criterion or milestone marked passed/accepted; offline tally must equal its own per-criterion verdicts; no top-level `outcome`/`status`/`accepted` success claim; `candidateSha` agrees); `gemini-validator-report.json` (`mode` = `offline_simulated`, `environment` must say offline simulation, `sourceAttestationAudit.proven` / server ticks not proven, **`UNPROVEN_PAPER_AUTHENTICITY` required**, so a missing gap code is a contradiction and never read as authenticity); `verdict.json` (no live/authenticated flags, `journalConsistent`, something unproven); manifest (`validator.verdict`, no paid inference); journal ticks (`tickProvenance` must be `unavailable`).

A journal rewritten with a **valid recomputed hash chain and digest** is not accepted for that reason alone: it is rejected where it disagrees with the manifest, receipts, pins or reports (`T01-T05`, `T12`).

## 3. Red before, green after

Test-first: the converted (ordinary) assertions were run against the **unmodified PR #73** code.

| | Result | Evidence |
| --- | --- | --- |
| PR #72 suite, unmodified, on #73 | 7 failed / 82 passed. The 7 failures are the characterisation / `[GAP]` tests for bugs Codex already fixed in #73 (they report "Expect test to fail"). The L1 tamper gaps are *hidden* here because `it.fails` keeps them green | `red-before/01-…` |
| Converted ordinary assertions on unmodified #73 | **31 failed** / 65 passed: 17 are the 13 tamper classes (incl. 2v2 instances), 14 are per-scenario control, exit-code and headline tests | `red-before/02-…` |
| Same suite on the hardened code | **100 / 100 passed, three consecutive runs**, exit 0, no unhandled errors | `green-after/pr72-adversarial-suite-…-run{1,2,3}.txt` |

## 4. Original T01-T26 versus now (measured on real bundles)

"Original" is the PR #72 audit's outcome for PR #70's verifier (13 of 26 classes **accepted**). "Now" is measured by `qa/verify-ci-verifier/scripts/outcome-table.ts` against freshly generated real 1v1 and 2v2 bundles. The journal-CLI column is PR #68's real CLI called correctly.

| ID | Tamper (real bundle) | Original verifier (PR #70 audit) | Now | Status | First reason | Journal CLI (PR #68) |
| --- | --- | --- | --- | --- | --- | --- |
| T01 [1v1] | rehashed journal: observation worldChanges position moved | **ACCEPTED** | **rejected** | contradiction | Receipt receipt-31dbcc3e-db58-4e14-99d4-12090fbdb149: worldChanges disagree with the original journal observat | rejects (exit 1) |
| T01 [2v2] | rehashed journal: observation worldChanges position moved | **ACCEPTED** | **rejected** | contradiction | Receipt receipt-6851021b-9e51-47b9-b56f-5c88abc535fb: worldChanges disagree with the original journal observat | rejects (exit 1) |
| T02 | rehashed journal: attempt target changed | **ACCEPTED** | **rejected** | contradiction | Receipt receipt-31dbcc3e-db58-4e14-99d4-12090fbdb149: targetPosition disagrees with the original journal | rejects (exit 1) |
| T03 | rehashed journal: observation flipped to successReported=false, verified=false | **ACCEPTED** | **rejected** | contradiction | Manifest action 31dbcc3e-db58-4e14-99d4-12090fbdb149 (gpt-a): reportedSuccess true disagrees with journal succ | rejects (exit 1) |
| T04 [1v1] | rehashed journal: citizen identities swapped between gpt-a#1 and claude-a#1 (attempt and observation) | **ACCEPTED** | **rejected** | contradiction | Manifest action 31dbcc3e-db58-4e14-99d4-12090fbdb149 (gpt-a): citizen 'gpt-a' disagrees with original journal  | rejects (exit 1) |
| T04 [2v2] | rehashed journal: citizen identities swapped between gpt-a#1 and claude-a#1 (attempt and observation) | **ACCEPTED** | **rejected** | contradiction | Manifest action 6851021b-9e51-47b9-b56f-5c88abc535fb (gpt-a): citizen 'gpt-a' disagrees with original journal  | rejects (exit 1) |
| T05 [1v1] | manifest + receipt citizenIds swapped between two actions (journal untouched) | **ACCEPTED** | **rejected** | contradiction | Manifest action 31dbcc3e-db58-4e14-99d4-12090fbdb149 (claude-a): citizen 'claude-a' disagrees with original jo | rejects (exit 1) |
| T05 [2v2] | manifest + receipt citizenIds swapped between two actions (journal untouched) | **ACCEPTED** | **rejected** | contradiction | Manifest action 6851021b-9e51-47b9-b56f-5c88abc535fb (gpt-b): citizen 'gpt-b' disagrees with original journal  | rejects (exit 1) |
| T06 | receipt reference replaced with another existing receipt | rejected | **rejected** | contradiction | Receipt receipt-a112f115-16ca-49d9-ac17-82468ffa2dfa attemptId mismatch: expected '31dbcc3e-db58-4e14-99d4-120 | rejects (exit 1) |
| T07 [1v1] | receipt CONTENT forged (ids kept; inventoryAfter=9, worldChanges emptied) | **ACCEPTED** | **rejected** | contradiction | Receipt receipt-31dbcc3e-db58-4e14-99d4-12090fbdb149: file SHA-256 9cb2ec1cfd17c610a0aa9ea0fe644c0211c47a9ff44 | rejects (exit 1) |
| T07 [2v2] | receipt CONTENT forged (ids kept; inventoryAfter=9, worldChanges emptied) | **ACCEPTED** | **rejected** | contradiction | Receipt receipt-6851021b-9e51-47b9-b56f-5c88abc535fb: file SHA-256 4604879c4c79329424cdba1759e0e72c4d5cbd3ab6f | rejects (exit 1) |
| T08 | receipt sourceSha changed to a different SHA | **ACCEPTED** | **rejected** | contradiction | Receipt receipt-31dbcc3e-db58-4e14-99d4-12090fbdb149: file SHA-256 d94becfc01792f2d2e8beddc0947e32c45311ac8d45 | rejects (exit 1) |
| T09 | referenced receipt file deleted | rejected | **rejected** | error | Referenced receipt file does not exist: receipt-31dbcc3e-db58-4e14-99d4-12090fbdb149.json | rejects (exit 2) |
| T10 | manifest.sourceReceipts[0].sha256 altered | **ACCEPTED** | **rejected** | contradiction | Receipt receipt-31dbcc3e-db58-4e14-99d4-12090fbdb149: file SHA-256 e89677034ac477d0bdb660cfec6350570f427be09d4 | rejects (exit 1) |
| T11 | manifest action duplicated over another (new attemptId, same receipt) | rejected | **rejected** | contradiction | Receipt receipt-31dbcc3e-db58-4e14-99d4-12090fbdb149 attemptId mismatch: expected 'dup-31dbcc3e-db58-4e14-99d4 | rejects (exit 1) |
| T12 | rehashed journal: gpt-a#3 replaced by a clone of #1 (fresh attemptId, inventory 0->1) | **ACCEPTED** | **rejected** | contradiction | Manifest action 76d46067-8031-4611-aede-a5ce401b4d19 has no original journal attempt | rejects (exit 2) |
| T13 [1v1] | one action removed everywhere (manifest + journal pair) | rejected | **rejected** | contradiction | Receipt receipt-76d46067-8031-4611-aede-a5ce401b4d19: journal coordinates {"attemptSequence":13,"observationSe | rejects (exit 1) |
| T13 [2v2] | one action removed everywhere (manifest + journal pair) | rejected | **rejected** | contradiction | Receipt receipt-8aefd4a1-3ac3-45ea-b18b-63408868b840: journal coordinates {"attemptSequence":21,"observationSe | rejects (exit 1) |
| T14 | evidence sources disagree: manifest says delta=9, observedSuccess=false; journal says otherwise | **ACCEPTED** | **rejected** | contradiction | Manifest action 31dbcc3e-db58-4e14-99d4-12090fbdb149 (gpt-a): reportedSuccess false disagrees with journal suc | rejects (exit 1) |
| T15 [1v1] | source SHA differs: manifest only | rejected | **rejected** | contradiction | Wrong source SHA: expected bdd454d04cb14a37db052d685ebc791ab20461db, got 0123456789abcdef0123456789abcdef01234 | rejects (exit 1) |
| T15 [2v2] | source SHA differs: manifest only | rejected | **rejected** | contradiction | Wrong source SHA: expected bdd454d04cb14a37db052d685ebc791ab20461db, got 0123456789abcdef0123456789abcdef01234 | rejects (exit 1) |
| T16 | source SHA differs: original journal start row (rehashed) vs manifest | rejected | **rejected** | contradiction | Journal start row sourceSha mismatch: expected 'bdd454d04cb14a37db052d685ebc791ab20461db', got '0123456789abcd | rejects (exit 1) |
| T17 | source SHA differs: validator report only | rejected | **rejected** | contradiction | gemini-validator-report sourceSha mismatch: expected 'bdd454d04cb14a37db052d685ebc791ab20461db', got '01234567 | consistent |
| T18 [1v1] | simulated presented as authenticated: verdict.json = PASS | rejected | **rejected** | contradiction | Simulated report promoted to authenticated Paper evidence: verdict is 'PASS', must remain 'NOT PROVEN' for off | consistent |
| T18 [2v2] | simulated presented as authenticated: verdict.json = PASS | rejected | **rejected** | contradiction | Simulated report promoted to authenticated Paper evidence: verdict is 'PASS', must remain 'NOT PROVEN' for off | consistent |
| T19 | simulated presented as authenticated: validator overallStatus = VERIFIED | rejected | **rejected** | contradiction | Simulated report promoted to authenticated Paper evidence: overallStatus is 'VERIFIED' | consistent |
| T20 | simulated presented as authenticated: manifest.mode = paper-live | rejected | **rejected** | contradiction | manifest mode must be 'offline-fixture', got 'paper-live' | rejects (exit 1) |
| T21 | simulated presented as authenticated: citizen authentication = microsoft | rejected | **rejected** | contradiction | Citizen gpt-a authentication must be 'synthetic', got 'microsoft' | consistent |
| T22 | simulated presented as authenticated: acceptance.json claims live 37/37 VERIFIED (a published artifact) | **ACCEPTED** | **rejected** | contradiction | acceptance.json claims live acceptance (37/37, measurement 'VERIFIED') from a scripted offline fixture | consistent |
| T23 | simulated presented as authenticated: validator environment = 'Authenticated Paper live server' | **ACCEPTED** | **rejected** | contradiction | Validator report environment 'Authenticated Paper live server (microsoft login)' presents a scripted fixture a | consistent |
| T24 | UNPROVEN_PAPER_AUTHENTICITY gap code silently removed from the validator report | **ACCEPTED** | **rejected** | contradiction | Validator report omits UNPROVEN_PAPER_AUTHENTICITY; absence of the gap code is not evidence of authenticity | consistent |
| T25 [1v1] | journal row tampered WITHOUT recomputing the hash chain | rejected | **rejected** | contradiction | verdict.json evidenceJournalSha256 mismatch: recorded 'ac839beb6847a26df14ee6b8fdb62720ee38d8b99cecd8cc7a557ca | rejects (exit 1) |
| T25 [2v2] | journal row tampered WITHOUT recomputing the hash chain | rejected | **rejected** | contradiction | verdict.json evidenceJournalSha256 mismatch: recorded '714f67aa0f411f0ad855d2fda67d41d239fc7fae22d5058d895c793 | rejects (exit 1) |
| T26 | COHERENT forgery: journal + receipt worldChanges edited, journal rehashed, receipt sha256 re-pinned | passes (by design) | passes (by design) | - | - | consistent |


Summary: **13 classes accepted before → 0 now**, on both real bundles. T26, a fully coherent forgery of every local artifact, still passes **by design** (see §7). The journal CLI is a second, independent layer; for T17-T19 and T21 it is irrelevant (those are claims in files it does not read).

## 5. Per-scenario journal controls and process exit codes

Each scenario gets its own real-subprocess controls. A pass in one cannot excuse the other. Measured at the code SHA (`green-after/…`, `journal-controls/per-scenario-controls.md`):

| Scenario | Citizens / original attempts / observations | consistent | missing root | missing journal | missing receipt | forged receipt (re-pinned) | forged journal (valid rehashed chain) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1v1 | 2 / 6 / 6 | exit 0 | exit 2 | exit 2 | exit 2 | exit 1 | exit 1 |
| 2v2 | 4 / 12 / 12 | exit 0 | exit 2 | exit 2 | exit 2 | exit 1 | exit 1 |

CI wrapper process exit codes (real `node --import tsx tools/ci/verify-offline-acceptance.ts`):

| Input | Status | Exit |
| --- | --- | --- |
| both real scenarios, untouched | `OFFLINE_STRUCTURAL_PASS` | **0** |
| 1v1 receipt forged and re-pinned; 2v2 untouched (2v2 stays `READY`) | `CONTRADICTORY_EVIDENCE_REJECTED` | **1** |
| 1v1 untouched; 2v2 receipt forged and re-pinned (1v1 stays `READY`) | `CONTRADICTORY_EVIDENCE_REJECTED` | **1** |
| 2v2 evidence directory missing | `VERIFICATION_INCOMPLETE` | **1** |

## 6. The summary no longer reads as live acceptance

The headline and a four-line status block now state exactly which of these happened, and "Genuine Paper execution: NOT PROVEN" is in every state:

| Status | Headline |
| --- | --- |
| `OFFLINE_STRUCTURAL_PASS` | `# ✅ Offline structural checks PASSED — genuine Paper execution NOT PROVEN` |
| `VERIFICATION_INCOMPLETE` | `# ⚠️ Required verification incomplete — genuine Paper execution NOT PROVEN` |
| `CONTRADICTORY_EVIDENCE_REJECTED` | `# ❌ Contradictory evidence rejected — genuine Paper execution NOT PROVEN` |
| `VERIFICATION_FAILED` | `# ❌ Offline verification failed — genuine Paper execution NOT PROVEN` |

Precedence is contradiction > incomplete > failed. A section lists criteria that remain **NOT MEASURABLE** (`offline 0/30`, `live 0/37`) and names the failing criteria (`A-IDENTITY, A-SESSION, A-MEMORY, A-ACTIONS`); `acceptance.json` is explicitly described as not an acceptance verdict.

## 7. Remaining limitations (not claimed away)

1. **A fully coherent forgery is undetectable offline.** If every local artifact (journal, receipts, pins, validator report, verdict, acceptance) is regenerated consistently, nothing here can tell it from a real run: a digest computed from locally generated files cannot authenticate those files. T26 demonstrates it and is kept as an explicit `[LIMITATION BY DESIGN]` test. Closing it needs an external trust anchor (signed server attestation), which is out of scope.
2. **No genuine Paper or real-model evidence exists here.** Bundles are scripted in-process fixtures (`synthetic` authentication). This work does not repair Gemini's separate live-attestation vulnerabilities.
3. **Some cross-checks depend on recorder fields.** If the recorder stops writing e.g. receipt journal coordinates, bundles are rejected (fail-closed) rather than accepted.
4. **The journal CLI and the verifier are separate implementations with overlapping checks.** Neither is a superset of the other (e.g. only the verifier reads `acceptance.json` and the validator report; only the CLI replays the original journal's events), so both stay required and a recorder change should re-run both.
5. **The adversarial suite adds ~2 minutes of CI time per job** (more on Windows); each subprocess is asynchronous so a slow runner cannot starve vitest's worker RPC.
6. **Platform claims:** local runs here are macOS only (arm64 hardware, x64 Node 22.12 under Rosetta). Ubuntu / macOS / Windows results are recorded from the actual GitHub Actions jobs in the PR description, not assumed.

## 8. Independent QA handoff

Re-run on the final integrated SHA (do not rely on this author's runs):

```sh
pnpm install --frozen-lockfile
pnpm v1:offline 2 artifacts/v1/scenario-2 && pnpm v1:offline 4 artifacts/v1/scenario-4
pnpm exec tsx tools/ci/verify-offline-acceptance.ts --scenario2 artifacts/v1/scenario-2 --scenario4 artifacts/v1/scenario-4 --sha "$(git rev-parse HEAD)"; echo "exit=$?"
CI_QA_BUNDLE_ROOT="$PWD/artifacts/v1" CI_QA_SHA="$(git rev-parse HEAD)" pnpm exec vitest run -c qa/verify-ci-verifier/vitest.config.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run --config tools/vitest.config.ts tools/ci
```

Suggested independent attacks beyond T01-T26: forge fields that no check reads yet (`tickSource`, `command`, `exitCode`, `startedAt/endedAt`, `providerUsage.sha256`/`provider-usage.json` contents, `preflight.json`, `scenario.json`, `A-*.json`, the published `acceptance.md`/`gemini-validator-summary.md` text); reorder or interleave rows while keeping per-citizen continuity; swap *whole* citizens' histories consistently across journal+manifest+receipts (should still need the validator report and session ids to agree); and an attempt to craft a coherent forgery that the journal CLI and the verifier disagree on.
