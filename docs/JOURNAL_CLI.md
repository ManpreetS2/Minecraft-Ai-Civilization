The offline runner now calls validateBundleWithJournal. To check an existing recording independently:

```sh
pnpm v1:journal artifacts/v1/scenario-2/manifest.json FULL_40_CHARACTER_SHA ManpreetS2/Minecraft-Ai-Civilization-windows-backup artifacts/v1/scenario-2 operator.jsonl
```

The operator selects the original journal relative to the explicit evidence root. Existing manifest receipt references are used unchanged. JSON output distinguishes FAIL (exit 1), NOT PROVEN (exit 2), and JOURNAL CONSISTENT (exit 0). Invalid invocation/unreadable manifest exits 1. Exit 0 means local consistency only: verdict remains NOT PROVEN and authenticatedLiveExecution is always false. Missing root or journal is supported and reports NOT PROVEN. Legacy validateBundle remains unchanged; old receipts remain readable but lack sufficient journal links.

Cursor must record each receipt's journal.attemptSequence and journal.observationSequence using original row sequences; preserve attemptId, observation eventId (or original hash fallback), action sequence as one-based attempt ordinal, receipt references and hashes, run/source identity, inventories, observation position/hunger, authorized recipients, world changes including positions, and attempt target. See JOURNAL_CROSS_CHECK_HANDOFF.md for the full API. No missing identifiers are synthesized. Current recordings missing those references remain unproven. Runtime and chest code were not changed.

Tests and machine output are in docs/evidence/journal-cli. Red-before captures imported tests failing against current writer defaults plus the initial CLI fixture wiring error; it is integration regression evidence, not a claim that the completed validator was absent. Green-after covers the imported negative/positive matrix and CLI status/exit semantics. No genuine Paper activity, external authenticity, paid usage or live acceptance is established.
