# Mission 006: additive evidence contract revision 2

Codex owns these tooling changes; no SQLite, provider, chest-ordering or other runtime implementation changes. Base #55: `6f354472d2232695da17c542eb6bb9e479f483f4`. Claude QA source: `e7e08e7a0977fe812cc38a77e6653cf6d9b35ef0`, `qa/v1/test/adv-e2e-evidence.test.ts`. Cursor candidate: `5ec19e53faa18c90f67200b500bcdbe9e763d09d`.

## API and migration

```ts
validateBundle(bundle, expectedFullSourceSha, { evidenceRoot });
```

`schemaVersion: 1` is preserved. `evidenceContractVersion: 2` declares the additive contract. Old one-argument callers and old bundles remain readable; missing candidate SHA and new evidence fields produce explicit NOT PROVEN reasons. Unknown contract revisions are refused. No missing metadata is generated or inferred.

- Action fields: `actionType`, signed `expectedDelta` (the complete expected item delta), `inventoryScope` (`citizen`, default, or `container`), `runId`, full `sourceSha`, `eventId`, `attemptId`, `receiptId`, optional `sourceEventId`.
- Types: `gather`, `eat`, `craft`, `place`, `withdraw`, `deposit`, `move`, `speech`. Missing type is unproven. Inventory quantities are safe integers. Negative counts are valid deltas; negative resulting stock is a contradiction. Container withdrawals may have negative deltas. Moves/speech need no inventory delta, but any claimed inventory change still needs inventory receipts.
- `sourceReceipts`: whitelisted `ReceiptReference` entries. Each binds ID/event/attempt/run/repository/SHA/citizen to a JSON file reference and SHA256. Only canonical files below explicit `evidenceRoot` are read; missing root/files are unproven, path escapes/hash or attribution mismatches fail.
- JSON receipt contents follow exported `SourceReceipt`: the same attribution plus family/model/session, and action observations. Inventory actions need before/after snapshots. Eating needs hunger recovery; placement needs a block-change observation; movement needs observed/target position; speech needs recorded authorized recipients. A fact-only event receipt need not claim action semantics.
- `providerUsage`: additive `paidRequests`, `inputTokens`, `outputTokens`, `usageComplete`, `sha256`, `perCitizen` (citizen/family/model/session/requests/retries). Positive requests require a usage JSON receipt with matching run/repository/SHA and accounting fields. Null is missing, zero is explicit. Synthetic fixtures can explicitly report zero paid requests/cost without inventing token measurements. Incomplete paid/subscription usage cannot substantiate spending.
- `persistentFacts`: IDs and attribution only, no private fact text. Fields: `id`, `citizenId`, `runId`, `sourceSha`, `sourceEventId`, `receiptId`, `authorizedKnowledge`. Source events must match same-citizen receipts. A runtime without this link remains NOT PROVEN with a `sourceEventId/receiptId` reason. Cross-citizen communicated facts need an authorized recipient-observation event; a rival's private event is not a substitute.

Model/family checks reuse the existing provider allowlists. A missing/unknown model is unproven; a known opposite-family model, conflicting session/model receipt or inconsistent request totals fails. This is a local attribution check, not proof that a real provider served that model.

## Five defect closures and red-before evidence

`evidence/mission006/red-before.json` and `.txt` retain the five ordinary assertions failing on the unchanged #55 base. The base and Cursor candidate have identical manifest Git blob `90c2465eefc8ce7445d73bb8377e2592299a3ee6`. The regression file now contains ordinary assertions plus positive/negative contract cases; no `it.fails` hides these defects.

1. Empty successful inventory production: missing legacy semantics/delta is unproven; an explicit gather with no expected physical gain is a contradiction.
2. Missing request usage: explicit usage reasons; unknown accounting is not zero. Receipt and per-citizen totals must agree.
3. Missing model: explicit unproven reason; known family/session contradictions fail.
4. Negative inventory: underflow, malformed quantities or receipt/expected-effect contradictions fail. Legitimate consumption, crafting, placing and transfers remain valid.
5. Foreign-run replay: run/source attribution survives serialization and is checked against both action and receipt. Duplicate event/attempt IDs and dangling references fail.

Missing evidence is NOT PROVEN; contradictory supplied evidence is FAIL. Structural success alone never yields experiment PASS. Self-declared validator PASS remains unverified even with a matching local receipt. Hashes prove local integrity, not Paper authenticity or external signatures; Gemini owns that boundary.

## Cursor and Claude handoff

Cursor: integrate only this Codex tooling delta, call validation with the expected candidate SHA and an isolated evidence directory, and emit real source receipts from the existing recorder. Do not manufacture IDs from aggregate scenario deltas. The updated CLI emits a source-bound synthetic usage receipt, but its aggregate scenario still lacks a full action journal and runtime persistent-fact export; those remain unproven. The acceptance engine must not turn this bundle's NOT PROVEN into accepted progress.

Claude: on the combined candidate, convert the five `[DEFECT]`/`it.fails` probes in `adv-e2e-evidence.test.ts` to ordinary assertions and remove the defect markers. Keep the negative empty-start inventory check. For legitimate negative-action tests, seed available inventory and supply action type/expected effects and receipts. The old baseline remains structurally consistent but explicitly unproven. Update the blocked expected-SHA/action-schema/fact-link tests to call the new API and exercise these interfaces. Keep external validator authenticity and uninterrupted Paper-time obligations blocked pending Gemini evidence.

Run focused tests with `pnpm test:v1 --maxWorkers=1 --no-file-parallelism`; typecheck with `pnpm typecheck`. Provider implementation is untouched. This branch's #48 base does not include #42; source-specific provider acceptance from another branch must not be relabeled as a result on this source. Cursor must retain #42 when applying this tooling update.
