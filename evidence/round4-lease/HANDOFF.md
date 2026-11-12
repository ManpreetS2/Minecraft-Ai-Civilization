# Round 4 container lease acquisition repair

Baseline PR #103: 4478c18410c08d11cc563d718636d89367afffd0. Independent QA source PR #118: a3d3a7893719679ced404bc3e44c3bd4bfa49022.

QA103-L1 red before (lease citizen_atlas after unwind), green after (none; another citizen immediately acquires). QA103 regression 20/20; claim identity unit tests 7/7. Covers same citizen refresh, legacy tryClaim refresh, another citizen after expiry, newer executePlan generation, deadline, caller abort/disconnect/death/shutdown signal, transfer and pre-aborted no-transfer. Physical conservation and pending observations preserved. No late success or rollback introduced.

ClaimBoard.acquire returns a fresh opaque identity; every tryClaim acquisition/refresh rotates it. Home-storage finally releases only that exact owner/identity, independent of action cancellation state. WeakMap tokens do not accumulate after claim deletion.

QA103-L2 remains RED (1 of 2 desired defect tests): no-transfer pending noise remains, as does duplicate pending characterization. Optional incident changes deliberately deferred to avoid widening lease ownership scope. Original QA103 source tripwire updated for identity-based finally, and Windows path separators normalized. Runtime assertions unchanged. QA fake fixture any annotations have local lint exemptions; no production lint exemption.

Workspace 2633 passed, 2 skipped; all three typechecks, lint and build pass. See logs. No real Paper, API, world writes or acceptance-ledger changes. Independent rerun of this implementation SHA remains required; production change is UNREVIEWED, offline evidence only.
