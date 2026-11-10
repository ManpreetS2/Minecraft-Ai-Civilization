# Next offline integration rehearsal

This is a PROVISIONAL OFFLINE rehearsal, not an accepted release or live smoke authorization. The final tested SHA and command results are recorded in the draft PR. No official acceptance ledger or public charter changes.

| Component | Exact input | Status |
| --- | --- | --- |
| #84 foundation | e395f54d57c9da488df50a9f92e5cc5b2a6da326 | inherited offline candidate; #81 CI independently reviewed in #82 |
| #88 chest action ownership | 6c70036bb63984a95b1a87ebaf9f616103625fa0 | reviewed in #92/#95; residual home storage repaired below |
| Mission 2 / #103 | 4478c18410c08d11cc563d718636d89367afffd0 | PROVISIONAL implementation, Claude 2 re-review required |
| #94 validator | da0e1ff9e7e84647467ac335a7ded698f5f8fdc3 | independently supported for offline integration by #101 at ec87edd5f249cec400c7fdb6762383ee99bffc99 |
| Mission 3 / #104 | 709847bd6732ec521da2192eed5eecdb4fb776cb | QA analysis only; duplicates remain OPEN, no production fix imported |
| #80 provider readiness | 77b8b8ad7b65b8a6013b1a1e4297924e6ff4ac47 | inherited PROVISIONAL mock harness; not paid-provider readiness |
| #98 provider repair | 2b7f1e1dc4eb4f1b250f15b766f9da0b87d53f99 | EXCLUDED pending independent RR-1 through RR-5 review |
| #97 Paper repair, assigned source | f4c7241ade89f8ca3f4740d15b134f43d3ad8e16 | EXCLUDED: nine PR93 identity failures remain, including writes through a world-region symlink; later heads not approved by this audit |

Ancestry: #88 descends from #84. Only its four new commits and Mission 2's two new commits were replayed. #94 and #84 have an older common ancestor (#61), but #84's validator content matches #67 at 2baaf8a49806ae01d3bcc3e1c481b8479ccf77ed exactly. Applied only the cumulative owned validator/QA delta from that content base to #94, preserving #84's runtime, provider, CI and original-journal CLI. No older runtime ancestry was merged. All patches applied without production conflicts.

Independent tests copied: QA78 from #85 via #88, QA88 from #95 via Mission 2, QA67/75/86 via #94, QA94 canonical tests from #101, and Mission 3's desired-event reproduction. Original assertions remain intact except the two explicitly strengthened legacy identity assertions already reviewed in #101. Imported QA94 pipeline helper received type-only any-to-unknown cleanup matching QA86; no assertion changed.

Known test contracts: QA78 bread-zero assumption remains red and unchanged; QA88's conservation replacement is documented separately and green. Four desired exact-one-success assertions from Mission 3 remain red because duplicate events are not fixed. They are not counted as passing tests. Current QA88's two-event characterization passing does not establish correct event accounting.

Validator limits tracked by #101: future signed recorder metadata stripped by the adapter fails closed (QA94-M1); library raw rows are not fully schema-validated and malicious signed malformed values can be accepted or throw (QA94-L1/L2). These do not block the reviewed current offline use, but do block claims of general live authenticity. No genuine Paper signing authority exists.

Gate A blockers: all PR93 identity failures, separate PR99 physical/lifecycle findings awaiting corrected-source review, live-provider approval/revoke/accounting/model-contract RR reviews, real signer/trust-root work if authenticated evidence is claimed, and explicit owner approval for any disposable trial. Offline tests and correct protocol status do not bind a process to a world. Gate B remains unproven: no authenticated autonomous GPT/Claude 2v2 operation, genuine billing/session evidence, survival/reconnect/respawn or 60-minute observed trial.

After pending fixes: independently review exact SHAs, resolve event ownership/metadata with multi-stack and partial-transfer tests, incorporate only reviewed deltas, rerun the entire combined candidate from a clean committed SHA, then obtain explicit disposable-trial approval. GitHub billing failures are infrastructure blocks and never application pass/fail evidence.

Integration-specific correction: the V1 report wrapper conflated bundle runId with original journal experimentId. The stronger validator exposed EXPERIMENT_ID_CONFLICT on otherwise consistent recordings. The wrapper/bridge now carry the selected existing experiment identity separately, while runId and the original journal/receipts remain unchanged. Four tests demonstrate legitimate distinct identities and reject contradictory explicit experiment/run identities (2 red before, 4 green after). This new integration glue still requires independent review; the reviewed canonical security checks were not weakened.
