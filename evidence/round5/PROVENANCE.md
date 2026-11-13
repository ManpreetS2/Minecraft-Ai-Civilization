# Round 5 provisional offline candidate

NOT_PROVEN / offline_simulated. No acceptance-ledger upgrade. No live Paper, inference, protected-world writes or merges.

| Component | Exact source | Status |
|---|---|---|
| Frozen staging #141 | 1ee155641636d13b172d2dad520280febecc4871 | Baseline; prior evidence is author evidence |
| Lease #133 | 3a9f744b09f332f9720ff71c418c5901ce3ae0d3 | Independent provisional support in #142; inherited via staging |
| Chest #135 | 20c57b0f35693ae2079a51bb3d0c2d026ba34424 | Independent provisional support in #142; inherited via staging |
| New chest #154 | 3ddc5cdda6e7c309ddccac082cda4bbde6be5dc5 | UNREVIEWED; provisionally rehearsed, explicit QA103 contract migration |
| CI #155 | c620eb9a3bfe92c133ce00143c8806e176180992 | UNREVIEWED; 91 local verifier tests pass |
| Validator #150 | e31bcb4ec055bace24e29bb4d0346bc932057930 | EXCLUDED pending fresh Claude 2 exact-source QA |
| Paper chain | 8164ab12e1d18a2ca12b9213eedda5ddd79b3e00 | PROVISIONAL; excluded |
| Gemini #148 | f1a213075c41e502954106b755211aa0c9e34c01 | EXCLUDED; no Claude 1 exact-source PASS observed |

Cherry-picks use -x and preserve security changes. No conflicts occurred. #133/#135 already existed in frozen staging and were not reapplied. No independent approval of this combination is claimed.

Original assertions remain intact. qa/round5/CONTRACT-MIGRATION.md proposes singleton physical pending receipts instead of legacy wrapper counts. Review must adjudicate older QA103 selectors and QA78 rollback assumptions; physical inventory must never be fabricated to satisfy them.

Validation ledger will be published in the draft PR with exact tested source and command outcomes. Earlier tests during assembly are rehearsal only. Only the final frozen head's reruns qualify as final local evidence. Offline journals remain forgeable local artifacts and cannot authenticate Paper execution.
