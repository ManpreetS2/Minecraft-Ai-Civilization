# Round 4 staging verification handoff

PROVISIONAL OFFLINE ONLY. Frozen parent #120 remains 1d9967f0020840fe091cbbc77fe27234a577381f, unchanged. New production changes are only #133 lease identity and #135 single physical event ownership; both remain UNREVIEWED. See PROVENANCE.md for full source SHAs, exclusions and independent QA sources.

Runtime verification revision: a14113b2dfe80a39ec35e77a7a5627e25d0b6ddb. The final freeze adds only this documentation, logs and independent QA suites; production sources do not change. Final source-bound 1v1/2v2 artifacts are regenerated after committing the freeze, with the exact SHA recorded in the draft PR and ignored artifacts/v1 output. No report or receipt is edited to re-pin a different source SHA.

Passing checks:
- Workspace: 2639 passed, 2 skipped (221 files).
- V1: 219/219; AI: 514/514; security: 358/358; validator: 161/161.
- QA94: 27/27 (1338-mutation canonical binding preserved); QA86: 78/78; QA75: 51/51; QA67: 150/150.
- QA103: 20/20; desired chest event contract: 14/14; QA88 abandonment defects: 4/4.
- QA69: 62/62; action audit: 68/68; provider safety: 10/10; construction persistence: 12/12.
- Newly published independent QA137: 81/81; P0 isolation QA138: 49/49; provenance controls QA139: 26/26.
- CI adversarial: 100/100; CI artifact structural verification passed.
- All three typechecks, lint, build: exit 0. Late QA lint rerun also passes; changes are type-only or underscore unused helper names, no assertions changed.

Open desired-contract tests (not counted as passing):
- QA120 defects: 4 red / 2 green. Both duplicate physical-event tests now pass; CI run-id String coercion / malformed object handling remain open (independently classified Low).
- QA139 desired provenance defenses: 9 red, unchanged inherited gaps (replay/session, world and witness binding, provider receipts, UUID mapping, checkpoints/seals).
- QA103 defects: L1 green, L2 red (no-transfer pending noise); duplicate pending observations preserved.
- Historical QA78: 49/51; rollback/bread-zero requirement contradicts physical conservation, and Windows timer granularity fails the tight interval assumption.
- Historical QA88: 22/26; one obsolete two-event assertion and three Windows/build/source tripwires. Assertions preserved.

The new validator repair #131 has QA94FC 41/41 and own validator 167/167, but is EXCLUDED because its strict raw-schema validation conflicts with older rich controls using unsupported action=deposit (QA94 22/27, QA86 68/78), and unknown-key audit reporting conflicts with one QA67 assertion (149/150). QA75 remains 51/51. No known-field tampering protection was weakened to force acceptance.

1v1/2v2 artifact checks: original experimentIds off2/off4 remain separate from fixture runIds, six/twelve attempts and observations match, receipt references and hash chain valid, zero validator violations, mode offline_simulated, overallStatus NOT_PROVEN. These are controlled fixture observations, not real physical Minecraft outcomes. T26 coherent fabrication can still appear structurally consistent; no independent server signer/witness exists.

Blocked dependencies: independent exact-SHA review of new production repairs/combined candidate; validator QA contract reconciliation; provider corrections with accepted independent exact-source QA; provisional Cursor Paper stack through #136 requires independent acceptance; real witness/session/world/provider provenance if evidence-grade claims are desired. No Paper, paid API, protected-world or acceptance-ledger writes, no protected branch merge.

The two top-level scenario-*.txt files record initial dirty-tree refusals when logs were first placed in a tracked location. Corrected clean-checkout scenario logs and verifier output are in checks/. Failures are retained as evidence; refused attempts did not start a scenario.
