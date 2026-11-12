# Round 4 provisional component provenance

Frozen parent: PR #120, 1d9967f0020840fe091cbbc77fe27234a577381f. Parent branch and PR untouched. This candidate is OFFLINE / PROVISIONAL / NOT_PROVEN. No acceptance ledger changes or merge authorization.

| Component | Exact source | Eligibility and staging decision |
| --- | --- | --- |
| #120 inherited integration | 1d9967f0020840fe091cbbc77fe27234a577381f | Frozen base; independent review pending. Includes unreviewed original-experiment/run-id wrapper and CI attribution glue. |
| #88 chest ownership | 6c70036bb63984a95b1a87ebaf9f616103625fa0 | Inherited reviewed offline content, replayed history. No duplicate cherry-pick. |
| #103 home storage | 4478c18410c08d11cc563d718636d89367afffd0 | Inherited content; claims.ts/home-ops.ts byte-identical before new repairs. Independently supported by #118 a3d3a7893719679ced404bc3e44c3bd4bfa49022; L1 repaired provisionally, L2/I1 open. |
| #94 validator | da0e1ff9e7e84647467ac335a7ded698f5f8fdc3 | Inherited source files byte-identical, independently supported by #101 ec87edd5f249cec400c7fdb6762383ee99bffc99 for current offline input only. |
| #133 lease repair | 3a9f744b09f332f9720ff71c418c5901ce3ae0d3 | PROVISIONAL UNREVIEWED production delta. QA103-L1 green, independent-authored runtime regressions 20/20 at source. Cherry-picked -x as c2fc731. No acceptance promotion. |
| #135 event repair | 20c57b0f35693ae2079a51bb3d0c2d026ba34424 | PROVISIONAL UNREVIEWED production delta. Desired contract 8/8 + 6 observation/partial tests. Cherry-picked -x as 375e0a3. Compatible merge preserves acquisition-token finally. |
| #131 validator compatibility | d4ea9ef324fbdde5c940536367d0084dbda0e805 | EXCLUDED. QA94FC 41/41, but old strict-schema/unsupported deposit controls and unknown-key-reporting expectations conflict. No known-field tamper weakening to force green. |
| Gemini #98 / #106 | 2b7f1e1dc4eb4f1b250f15b766f9da0b87d53f99 / e5c10c2 | EXCLUDED. Independent provider QA requires changes; no accepted corrected exact source found. |
| Gemini #114 / #117 | d76590738b8a2771dab1a2d4611cb811b6920420 / 33e43b196a299d9b55c701868b6626e419fe5664 | EXCLUDED. Independent audit 831f8ce reports inherited credentials/model/accounting failures plus readiness and receipt provenance gaps. |
| Cursor #130 operator stack | a87b1e6a85239480917523054fb83cd241a0be35 | PROVISIONAL source, EXCLUDED from runtime integration pending independent corrected-chain acceptance. |
| Cursor #132 latest X7 repair | 6ba7971d1e171767861eadc1df65d096590de303 | PROVISIONAL / UNREVIEWED, EXCLUDED. New evidence-destination precheck still disclaims TOCTOU closure; independent original CLI case pending. No Paper execution. |

Ancestry checked before replay: original #88/#103 commits are not ancestors of #120 because prior integration transplanted them; exact owned files matched their source before changes. Only the two new one-commit repair deltas were replayed, with -x provenance. No old runtime/provider tree or protected branch was merged. QA103 source tripwire is adapted to single physical event ownership; runtime assertions unchanged. Historical QA88 duplicate-event characterization remains unchanged and is obsolete under the desired contract.

Verification must bind original experimentId separately from recording runId; original journals, receipt IDs and CI source SHA remain authoritative. Scripted 1v1/2v2 runs cannot prove real survival, provider sessions, billing, Paper ticks or world identity. CI must keep both scenarios distinct and reject source/run/receipt forgeries. All output remains NOT_PROVEN for real-world acceptance even where a synthetic structural subcheck says VERIFIED.

Blocked dependencies: independent exact-SHA review of #120/#133/#135; validator QA contract reconciliation; provider fixes and independent acceptance; Paper identity/physical chain and concurrent path replacement work; a real signer/trust root if authenticity is claimed. No real Paper, paid inference, protected-world writes or acceptance-ledger modifications were performed.
