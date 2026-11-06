# Compare action receipts with the original experiment log

## Cursor integration API

Import `validateBundleWithJournal` from `tools/v1-integration/journal-cross-check.ts`:

```ts
const result = validateBundleWithJournal({
  expectedSourceSha: candidateSha, // full, lowercase 40-character SHA
  expectedRepository: "ManpreetS2/Minecraft-Ai-Civilization-windows-backup",
  evidenceRoot: absoluteEvidenceDirectory,
  operatorJournal: {
    reference: "operator.jsonl", // caller-selected original, root-relative
    runId: manifest.runId,
    sourceSha: candidateSha,
    repository: manifest.repository,
  },
  manifest,
});
```

The manifest supplies existing action receipt references and hashes. Each standalone `SourceReceipt` may now include:

```ts
journal: { attemptSequence: 2, observationSequence: 3 }
```

Cursor owns recording and CLI integration. At receipt creation, copy the original attempt/observation sequence numbers and attempt ID; use the observation's explicit `eventId` if present, otherwise its original journal `hash` as the event ID in both receipt and action. Keep action `sequence` as the one-based attempt ordinal, not the journal row number. Do not invent IDs or silently reconstruct missing journal events. Preserve the exact original before/after inventories, observation position, hunger, authorized recipients, world changes (including positions), and attempt target when available. `SourceReceipt.worldChanges[].position` is an additive optional field for this purpose.

Run this API over the completed original journal separately selected by the operator, not a journal path chosen inside a potentially modified receipt. Paths must be root-relative, canonicalize inside the explicit evidence root, and reference bounded regular files (16 MiB maximum per cross-check artifact). For a larger journal, this version fails closed rather than silently reading only a prefix. No file is created or changed by validation. Filesystem checks do not provide OS containment or eliminate concurrent mutation races; use stable operator-controlled snapshots.

## Results and compatibility

- `failures`: established contradictions, including wrong source/repository/run, duplicate IDs, wrong citizens/order/row references, bad hashes, claimed outcomes or physical effects differing from the original journal.
- `unproven`: missing journal, attempt, observation, receipt link or physical state; truncated/malformed tail; unknown completeness or external authenticity.
- `journalConsistent`: existing structural checks and supplied journal agree with no required journal evidence missing. This is **not execution authenticity**.
- `verdict`: FAIL on contradictions; otherwise NOT PROVEN. No code path promotes local agreement to authenticated Paper execution.

The old `validateBundle` signature/behavior and manifest version are unchanged. Older receipt files remain readable; the new API reports missing row references as NOT PROVEN. Existing callers do not automatically acquire journal checking: Cursor must explicitly adopt this entry point and treat failures as rejection and missing evidence as unproven. Do not use `journalConsistent` alone to publish acceptance or spending claims. No provider retry/accounting behavior changed.

The current runtime journal has no embedded repository/source SHA. The caller descriptor binds the selected artifact to the expected run/source but cannot independently prove that binding; the API explicitly reports this limitation. Optional embedded row source/repository fields are checked if present. A recomputable hash chain establishes internal consistency, not a trust anchor. If an attacker replaces journal, receipts and manifest consistently, the result remains NOT PROVEN without an externally verified signed anchor. This API does not verify external signatures, identify an authentic Paper process, or prove real-world effects.

## Provenance and validation

Base/owned PR #55: `4c65ce758ac4d042df63686a9e6e289fa481d952`.
Code commit: `33d42758932011bf4b8a0c954835fe4c4792713a`.
Integrated reference: `875ebf707b93a082a6423c9a3aecc7d00ae02e48`. Its `manifest.ts` and `evidence-contract.ts` match the owned base, so no Cursor runtime reconciliation was needed. The code commit can be applied independently to that reference. No Cursor scenario/runtime/CLI files changed.

Evidence: `docs/evidence/journal-cross-check/`.

| Command | Exit | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Red-before: `pnpm exec vitest run --config tools/vitest.config.ts tools/v1-integration/journal-cross-check.test.ts` | 1 | 0 | 1 | 0 |
| `pnpm test:v1 --maxWorkers=1 --no-file-parallelism` | 0 | 125 | 0 | 0 |
| `pnpm exec vitest run packages/agent-core/src/experiment-evidence.test.ts` | 0 | 10 | 0 | 0 |
| `pnpm typecheck:tools` | 0 | — | — | — |
| `pnpm exec eslint tools/v1-integration/journal-cross-check.ts tools/v1-integration/journal-cross-check.test.ts tools/v1-integration/evidence-contract.ts` | 0 | — | — | — |

The red test ran against old validation at the base, with the newly added assertion: the rehashed 30-log claim had no reported contradiction against the three-log journal. After implementation the ordinary test passes. Green V1 ran on the source committed verbatim as the code commit; typecheck/lint/source-journal regressions ran at that commit. This handoff/evidence follow-up changes no executable source. The 26 new tests cover coordinated forgery, all requested missing/replay/duplicate/sequence cases, positive consumption/movement/three gathers, and the all-artifacts-replaced limitation. An initial tools typecheck caught fixture typing/duplicate-property errors; both were corrected before the recorded successful check. No full unrelated workspace suite was rerun.

Environment: Windows x64, Node 22.17.1, pnpm 10.13.1. No live Paper, production worlds/databases or paid calls. These are author-run tests, not independent approval.

Claude QA: replay the new test file; independently alter receipt and manifest to 30, recompute receipt hashes while preserving the original three-log journal, and require FAIL for inventory contradiction. Then replace all artifacts consistently and require NOT PROVEN, never an authenticity PASS. Verify missing journal/rows stay unproven and legitimate consumption/movement still agree. Cursor should rerun affected checks at the final integrated SHA after wiring recording/CLI; no ledger upgrade is automatic.
