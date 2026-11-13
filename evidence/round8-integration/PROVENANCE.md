# Round 8 component provenance / eligibility

Runtime assembly tested at 5bf64334faf32cfe0d7ec82f3aab138568afdfc5. This branch descends from #141 via #156; it is a reviewed-foundation combination with a PROVISIONAL chest extension, not independently approved as a whole. All offline output is NOT_PROVEN.

| Component | Exact source | Eligibility / disposition |
|---|---|---|
| Reviewed foundation #141 | 1ee155641636d13b172d2dad520280febecc4871 | Independent #167 provisional offline PASS; inherited via #156 |
| Base #156 | a99f6bf842cae9d5065b7cea1848f0368949d943 | #167 changes required for chest receipt suppression; not blanket approval; superseded producer below |
| Lease #133 / physical event #135 | 3a9f744b09f332f9720ff71c418c5901ce3ae0d3 / 20c57b0f35693ae2079a51bb3d0c2d026ba34424 | Inherited, independent #142/#167 support for provisional use |
| Pending wrappers #154 | 3ddc5cdda6e7c309ddccac082cda4bbde6be5dc5 | Inherited wrapper removal; #167 found QA154-M1; surviving producer superseded below |
| CI #155 | c620eb9a3bfe92c133ce00143c8806e176180992 | Independent #167 PASS in exact #156; inherited tools/ci changes |
| Validator #150 | e31bcb4ec055bace24e29bb4d0346bc932057930 | Independent #167 provisional offline PASS; five owned files imported exactly; existing v1-bridge identity fix retained |
| Slot sync #170 | 2e7e860ee1d54db086e5d9c1008c754176d0f628 | Cherry-picked -x as 9421a23; provisional prerequisite to #173 |
| Withdrawal #172 | 8473127c02f9a30b1282f5bd3403fc70807d1e7e | Cherry-picked -x as 5e92acb; unresolved issued/resolved withdrawal retained |
| Correlation/parity #173 | e16e07e38137bacc97fc4e578aca5ecec02d16f4 | Four repair commits after #170 replayed exactly; latest three as f27cb20 / 384a668 / 5bf6433. PROVISIONAL until Claude 2 exact-source review |
| #168 comparison baseline | 146bdf44f40aed864b98bdbe38b501a8992d0d69 | Frozen and untouched. Not used as base because it contains unapproved #163 |
| #163 hash follow-up | 11dfd16fdf459d75b849328be17fbc7a829e8141 | EXCLUDED pending exact-source security review; hash-chain-verifier blob equals #150, not #163 |
| Provider #171 | 60a88239acf065153bafe70f65a65d5867c884ea | EXCLUDED; authored green tests are not independent acceptance |
| Paper #164 | 59adbac1c899983339f524e45c4c3addc8553ec1 | EXCLUDED; standalone smoke interfaces do not prove combined cognition trial |
| Mock witness #165 | 8b80f35a16cedaf1fdaaa4061337bdc049dc923f | EXCLUDED entirely; no authenticated world authority |
| Independent QA #167 | 7b63079a56ee613f8ed0a3afe97d2d52f965a914 | Receipt/accounting/knowledge suites copied; assertions unchanged, QA-only lint directives/global declarations disclosed |
| Proposed contract #162 | 0edf259e0f342c2973834e82427b8b8ee658b125 | QA/docs only, separate migration assertions; originals remain unchanged |

OWNED-BLOBS.json records actual git blob identities for chest/runtime owned files and hash verifier. Chest/runtime files exactly match #173. Cognition and Minecraft adapter trees are unchanged from #141; provider/Paper source was not silently transplanted. Validator projection/schema/adapter/action verifier files match #150; the independent integration run/experiment bridge is retained. No merge into protected branches occurred.

## Executed assembly gates

Workspace 2648 passed, 2 skipped (both Windows-inapplicable POSIX pid/kill lock tests in ops-body-lock.test.ts). Total 2650 equals #168's 2649+1 on another platform; this is not disappearance of a test. AI 514, security 358, V1 228, validator 167; all three typechecks, lint and build pass. All results are actually executed against the assembly, not copied predecessor counts.

Round 7 withdrawal 9/9; receipt contract 10/10; separate Round 6 migration contract 6/6; knowledge isolation 49/49; QA94/86/67/75 = 27/78/150/51; QA94FC 41/41 with the disclosed single-thread worker setting (original recursive fixture unchanged). Independent receipt accounting/knowledge = 13+10, receipt suppression/parity = 4/4. CI identity 93/93 and adversarial 100/100. Fresh source-bound 1v1/2v2 and actual journal/receipt CLI controls pass structurally, offline_simulated / NOT_PROVEN.

## Explicit non-green / setup records

Historical QA103 remains five red selectors/characterizations, QA78's selected rollback assertion remains red, and two Round 6 slot-sync no-effect assertions remain red under the new ZERO_OBSERVED/count:null contract. They are preserved/classified in the separate contract mission, not counted as passing.

Provenance characterization is 24/26 and desired defenses are 2 green/7 red. Both G8 greens arise from unknown join rows downgrading the run, not implemented UUID mapping. All nine real-evidence limitations remain unsupported. Coherent local forgeries cannot become real Paper proof.

Initial round6-contract invocation failed because its proposed QA config had not yet been overlaid; after importing exact #162 QA-only source it is 6/6. Initial lint after importing independent #167 snapshots found fixture-only any/unused imports and Node globals; QA-only directives/global declarations were corrected, without changing assertions or production. Original failed setup logs remain in the executed ledger. These setup failures are separate from production/contract failures. No test timeout or original independent assertion was weakened.

Pending receipt reconciliation remains a runtime gap: persisted PENDING/authoritativeStorageUpdated:false is not an applied stock update or durable exactly-once consumer. The interface mission must preserve this distinction. No paid requests, real Paper, real keys, protected-world writes, acceptance-ledger upgrades or protected merge.
