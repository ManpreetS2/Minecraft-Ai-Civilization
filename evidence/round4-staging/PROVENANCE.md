# Round 4 provisional component provenance

Frozen parent: PR #120, 1d9967f0020840fe091cbbc77fe27234a577381f. Parent branch and PR untouched. Independent PR #137 subsequently supported this exact frozen base for provisional offline integration. This candidate is OFFLINE / PROVISIONAL / NOT_PROVEN. No acceptance ledger changes or merge authorization.

| Component | Exact source | Eligibility and staging decision |
| --- | --- | --- |
| #120 inherited integration | 1d9967f0020840fe091cbbc77fe27234a577381f | Frozen base; independently supported by #137 52d554323f57676d90355cf022002fc21f65c4b1 for provisional offline integration. Low run-id coercion findings QA120-L1/L2 remain open. |
| #88 chest ownership | 6c70036bb63984a95b1a87ebaf9f616103625fa0 | Inherited reviewed offline content, replayed history. No duplicate cherry-pick. |
| #103 home storage | 4478c18410c08d11cc563d718636d89367afffd0 | Inherited content; claims.ts/home-ops.ts byte-identical before new repairs. Independently supported by #118 a3d3a7893719679ced404bc3e44c3bd4bfa49022; L1 repaired provisionally, L2/I1 open. |
| #94 validator | da0e1ff9e7e84647467ac335a7ded698f5f8fdc3 | Inherited source files byte-identical, independently supported by #101 ec87edd5f249cec400c7fdb6762383ee99bffc99 for current offline input only. |
| #133 lease repair | 3a9f744b09f332f9720ff71c418c5901ce3ae0d3 | PROVISIONAL UNREVIEWED production delta. QA103-L1 green, independent-authored runtime regressions 20/20 at source. Cherry-picked -x as c2fc73139b0cea6e8b767383b926b9ae255490ff. No acceptance promotion. |
| #135 event repair | 20c57b0f35693ae2079a51bb3d0c2d026ba34424 | PROVISIONAL UNREVIEWED production delta. Desired contract 8/8 + 6 observation/partial tests. Cherry-picked -x as 375e0a32cc51e0eb2a0cac20f76350a7564ab8cb. Compatible merge preserves acquisition-token finally. |
| #131 validator compatibility | e0d6540d351b5a82835642cdb64353f46fcd771e | EXCLUDED. QA94FC 41/41, but old strict-schema/unsupported deposit controls and unknown-key-reporting expectations conflict. No known-field tamper weakening to force green. |
| Gemini #98 / #106 | 2b7f1e1dc4eb4f1b250f15b766f9da0b87d53f99 / e5c10c27079026b3b4d9e46f91e58fcae8e6c154 | EXCLUDED. Independent provider QA requires changes; no accepted corrected exact source found. |
| Gemini #114 / #117 | d76590738b8a2771dab1a2d4611cb811b6920420 / 33e43b196a299d9b55c701868b6626e419fe5664 | EXCLUDED. Independent audit 831f8ce96ac2f85c887f899fe7743e0c0215802a reports inherited credentials/model/accounting failures plus readiness and receipt provenance gaps. |
| Cursor #130 operator stack | a87b1e6a85239480917523054fb83cd241a0be35 | PROVISIONAL source, EXCLUDED from runtime integration pending independent corrected-chain acceptance. |
| Cursor #132 X7 repair | 6ba7971d1e171767861eadc1df65d096590de303 | PROVISIONAL / UNREVIEWED, EXCLUDED. New evidence-destination precheck still disclaims TOCTOU closure; independent original CLI case pending. No Paper execution. |
| Cursor #134 / #136 latest Paper stack | b95fed7c3a646b66d22d406ea33a5f125e980715 / 8164ab12e1d18a2ca12b9213eedda5ddd79b3e00 | PROVISIONAL / UNREVIEWED, EXCLUDED pending independent acceptance. Listener ownership precheck still disclaims the OS-to-login race; Windows execute remains refused. |
| Independent #137 integration QA | 52d554323f57676d90355cf022002fc21f65c4b1 | QA-only suite imported unchanged except helper any-to-unknown and unused-variable lint cleanup. Independent acceptance applies to #120, not this new combination. |
| Independent #138 P0 isolation QA | f1655a6d1010f5e28df8629cc84e04c790f51ba8 | QA-only suite imported; no independently confirmed leak on frozen base; run again on this candidate. No live independence claim. |
| Independent #139 provenance controls | 719b03807d3c88c3e9313b53341852ea9c7fcb05 | QA-only suite imported. Nine desired defenses remain unimplemented (replay/session, world/witness, model receipts, UUID mapping, seals/checkpoints). Not an authenticity upgrade. |

Ancestry checked before replay: original #88/#103 commits are not ancestors of #120 because prior integration transplanted them; exact owned files matched their source before changes. Only the two new one-commit repair deltas were replayed, with -x provenance. No old runtime/provider tree or protected branch was merged. QA103 source tripwire is adapted to single physical event ownership; runtime assertions unchanged. Historical QA88 duplicate-event characterization remains unchanged and is obsolete under the desired contract.

Verification must bind original experimentId separately from recording runId; original journals, receipt IDs and CI source SHA remain authoritative. Scripted 1v1/2v2 runs cannot prove real survival, provider sessions, billing, Paper ticks or world identity. CI must keep both scenarios distinct and reject source/run/receipt forgeries. All output remains NOT_PROVEN for real-world acceptance even where a synthetic structural subcheck says VERIFIED.

Blocked dependencies: independent exact-SHA review of the new #133/#135 repair combination; validator QA contract reconciliation; provider fixes and independent acceptance; Paper identity/physical chain and concurrent path replacement work; a real signer/trust root if authenticity is claimed. No real Paper, paid inference, protected-world writes or acceptance-ledger modifications were performed.
