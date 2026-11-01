# T3 SEC-001 integration QA — 2026-11-01

**Offline privacy/provenance replay: PASS. Overall 2v2: NOT READY. Unmerged private checkpoint.**

## Authority and isolation

Read the public project charter, private Issue #2 and final switch comments, Claude's `docs/project-management/SEC-001-B_CONTINUATION.md`, and Codex's `docs/CODEX_SEC001_MIGRATION_QA.md` from its QA branch. The owner subsequently approved **fail-closed quarantine with evidence-based per-record recovery**, preserving originals and forbidding invented provenance.

Verified private remote tips before changes:

| Workstream | Revision |
| --- | --- |
| Claude manager, base of this proposal | `15804fab622f6d91d7ec28858560c75eab8d347a` |
| Codex migration QA | `5df239c36eaefdb8ca762036703ff209f88c53e2` |
| Weekly integration | `17bff2db5b0b2f29c4c0d1626d0b28f332653633` |
| Draft reliability PR #1 | `3e6c006527f448474461d63c45cd52cc8f4bd316` |
| PRIV-001 | `99c0e0055501b05fc5d2313edbefac867929ae9a` |
| PRIV-005 | `97d70b1d88de86c826b9b0f307250b365a4e87b7` |
| PRIV-007 | `1c258cefd49f2ad8712c83e73eb2f61f606c9794` |

Starting workspace: clean public `main@15c13c8`, `C:/Users/sh1ft/Minecraft-Ai-Civilization`, public `origin`. Added private `windows-backup` remote and created **`agents/t3-sec001-integration-QA`** at **`C:/Users/sh1ft/Minecraft-Ai-Civilization-t3-sec001`**, from Claude's verified tip. Original Claude/Codex/Grok/Mac/Windows branches were not changed or merged. Mission 013 trees/worlds/databases were not opened or overwritten. Weekly integration was inspected, not merged.

Environment: Windows, Node **v22.17.1**, pnpm **10.13.1**. `pnpm install --frozen-lockfile` succeeded with native SQLite and unchanged manifests/lockfile. Databases were in-memory or disposable synthetic files. PR #1's file list was inspected for ownership; its queue/budget/OpenAI production files, tests and audit report are untouched. Claude's review assignment was not duplicated.

## Baseline and replay

At untouched Claude tip, `pnpm typecheck` reproduced the three known agent-core fixture errors and stopped before orchestrator. `pnpm test` returned **950 pass / 1 fail / 951 assertions**, plus a round-2 cleanup-hook `EBUSY` failure. The assertion is the existing starter-hut crafting-table test. The Mac path-alias test passes on this Windows machine.

Only tests/support artifacts were imported from PRIV-001/005/007 and Codex QA; no whole branch or old production file was transplanted.

| Stage | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| Original unchanged replay | 72 | 40 | 112 |
| Compatible fixtures, before production repairs | 105 | 7 | 112 |
| Final privacy replay, existing SEC suites and new policy/boundaries | 220 | 0 | 220 |
| Final full workspace | 1091 | 1 | 1092 |

Security-negative assertions remain executable and now pass; no skips/expected-failure annotations were added. Compatibility changes:

- Supply directory/stored-event methods and explicit world audiences; seed historical poison through legacy SQL because the corrected writer no longer creates it.
- Assert retained poison through observer SQL while requiring citizen reads to exclude it.
- Replace the two obsolete PRIV-007 characterizations of raw speech trust/crowd-out with requirements for unverified attribution and preserved legitimate observed knowledge. Both original characterizations failed against Claude's fix as expected.
- Test effective speech trust at cognition without rewriting historical raw classification.
- Under the approved policy, personal-sounding source-free fixtures are now quarantined. Positive fixtures explicitly include actual sources, exact derivation and original authorization. Suspicion classification remains checked through raw SQL when the replacement itself is ineligible.
- Preserve original content/rollback/backup assertions. V1 backup enumeration is scoped to v1; v2 snapshots and additional unknown-origin flags have separate tests. Test-only community configuration stays in `.test.ts` files; architecture guards are unchanged.

## Fixes, files and evidence

**Stored-event substitution — `packages/agent-core/src/citizen-context.ts`.** Previously, a stored ID's audience was checked but caller-supplied text/type/actor was summarized. IDs now resolve to complete stored events before authorization, bulletin delivery and fact persistence. Message/actor/type substitution tests failed before repair and pass afterward; forged-audience tests require no disclosure, acknowledgment or fact.

**Continuing quarantine — `packages/agent-core/src/store.ts`.** Rescans previously omitted already-flagged facts; late copies escaped. Active flags now remain taint sources. Memory insert/provenance/quarantine commit together. Retrieval applies authorization/provenance before limits, so post-marker imports cannot crowd out valid older knowledge. Original late-copy and close/reopen regressions pass; new tests cover raw late copies, recipient isolation, 25 unauthorized imports ahead of a retrieval limit and rollback on flag failure.

**Owner provenance policy — new `packages/agent-core/src/knowledge-provenance.ts`, integrated through `store.ts`.** Source-free notes/paraphrases and unrelated content under an authorized key previously reached actual manager cognition. The new service:

- Stores source/record hashes, original authorization/audience basis and citizen identity alongside original rows in `knowledge_provenance`.
- Verifies persisted source text/canonical derivation and entitlement at acquisition; labels/keys/current teammate status are insufficient. Community evidence needs audited original membership. Future evidence and unverifiable derivations fail closed.
- Flags unknown facts/memories in place, and requires valid proof at every read. Raw late imports and changed source/record bytes remain ineligible even before explicit scans.
- Verifies a `VACUUM INTO` backup and writes an ID/reason/evidence-reference dry-run report. V2 schema, proof, flags, decision audit and marker commit transactionally; failure closes the constructor handle and permits restart-safe retry.
- Audits citizen/original ID, reason, evidence, outcome, actor and release authorization. Recovery is explicit per record; prose/model judgment cannot supply evidence. Other records' key quarantine cannot be blanket-released.
- Preserves original fact/memory contents, ownership, timestamps and metadata during quarantine/recovery. Unprovable paraphrases remain historical evidence indefinitely.

All five formerly red legacy assertions now pass, including captured actual-manager inputs. **19 policy tests** cover denial and legitimate experience/recovery across restart, original community timing, forged evidence, unchanged originals, record/source tampering, stale reports, transaction/constructor interruption, real report-write error, backup failure, handle closure and attributed unverified speech. **10 additional T3 boundary tests** cover earlier defects. Retrieval validates record, source, flags and audience within one SQLite read snapshot; a second WAL connection changing the source during a read cannot mix old authorization with new text. The next read observes the change and excludes it.

**Authenticated new producers — `packages/agent-core/src/manager.ts`.** Task memories reference the persisted actor-private task outcome with its deterministic summary; social memory references successful speech. `addMemory` verifies source references rather than trusting caller audiences. Unsupported writes are preserved behind quarantine.

**Source summaries/trust — `packages/shared/src/bulletin.ts` and `citizen-context.ts`.** Canonical summaries are reusable; source-backed speech remains attributed/unverified, and suspicion replacements stay out of factual cognition. Provenance rejects unrelated fact content entirely instead of trusting its source key.

**Windows cleanup — `sec001-round2.test.ts`.** A read-only PRAGMA connection was never closed, explaining baseline `EBUSY`. It now closes in `finally`; no retry inflation, suppressed cleanup or weakened assertion. Final full run has no hook failure.

## Exact changed-file inventory

Production: `packages/agent-core/src/{knowledge-provenance,store,citizen-context,manager}.ts`; `packages/shared/src/bulletin.ts`.

New/imported tests/support:

- `packages/agent-core/src/{knowledge-provenance,t3-sec001-boundaries,citizen-context-2v2,downstream-prompt-isolation,persistent-fact-provenance}.test.ts`; `priv007/fixture.ts`.
- `packages/agent-core/src/{sec001-migration-qa,sec001-migration-manager-qa,sec001-migration-recovery-qa,sec001-quarantine-durability-qa}.test.ts`; `sec001-migration-qa/{fixture.ts,legacy-schema.sql}`.
- `packages/shared/src/{bulletin-2v2-contract,visibility-2v2-contract}.test.ts`.

Existing compatibility tests: `packages/agent-core/src/{sec001-audience,sec001-manager,sec001-round2,sec001-round3}.test.ts`.

Documentation: this report and `docs/SEC001_PROVENANCE_RECOVERY.md`. No PR #1 file, dependency, lockfile, root configuration or important source was deleted.

## Final checks and limitations

- Full tests: **1091 pass / 1 fail / 1092**, 130 passing files, one failing file. Only `blueprint.test.ts:12`: `materials.crafting_table` undefined, expected 1.
- `pnpm -r --no-bail --if-present typecheck`: **10 existing diagnostics**, none new:
  - `build-structure-intention.test.ts:221` TS2322 (ActionResult/BuildAdvance), `:321` TS2739 (settlement id/name/needs).
  - `dispatch-integrity.test.ts:166` TS2820 (`OBTAIN_ITEM`).
  - `apps/orchestrator/src/construction-experiment-guard.ts:219,222,224` TS2322 (`ok` vs `allowed`).
  - `live-fish-test.ts:345` TS2367 (`UNVERIFIED` comparison).
  - `live-home-test.ts:471` TS2339 (`Time.isNight`), `:490,645` TS2345 (undefined position).
- `pnpm build`: same three agent-core fixture errors after upstream packages build.
- Changed-file ESLint: **PASS**. Full `pnpm lint`: **15 errors in untouched files** (unused imports/locals, two prefer-const errors, planner self-assignment).
- Whitespace check: PASS before checkpoint.

Reproduce the privacy replay with `pnpm exec vitest run sec001 knowledge-provenance downstream-prompt-isolation persistent-fact-provenance citizen-context-2v2 bulletin-2v2 visibility-2v2`. Run `pnpm test`, recursive no-bail typecheck, lint and build for workspace evidence. Locked installation is `pnpm install --frozen-lockfile`.

Ignored local evidence: `artifacts/t3-sec001/` includes baseline, original/compatible replay, failing-before tests, `policy-replay.json`, `final-policy-tests.json`/`.log`, typecheck/build and changed-file ESLint logs. Tests and findings are committed; generated logs/native dependencies are machine-local.

## Remaining 2v2 blockers and next action

- Store/executor/workstations use `settlement_first`; construction project, claims and reservations remain manager-wide. Neutral cognition does not partition physical state.
- Homes use the World-Lab catalog without reader/community discovery; communal storage uses the global chest with personal ownership checks but no community grant. Planner inputs remain affected.
- One `createCognition(config)` provider is constructed per manager. This line supports OpenAI/Ollama/heuristic, not independent GPT/Claude provider/session routing per citizen.
- Live `/tell`, survival, four-body concurrency, Paper independence and 60-minute operation remain unverified. Offline executor/ownership/lifecycle tests do not establish live success.
- Exact reproducible evidence is required for recovery. Current community revocation retains the prior SEC behavior. Unknown semantic paraphrases are never restored automatically.
- The experimental CognitiveStore/embedding system is not wired into this manager. Active relevance/context paths use gated store reads; future integration must preserve that boundary. No migration of unused cognitive schemas is claimed.
- Hashes detect changed evidence, not an adversary who controls SQLite and can forge all audit/provenance tables. Review is observer/orchestrator code, not a model tool or HTTP endpoint.
- This is an **unmerged constructor migration** tested only on disposable databases. Review and owner authorization are required before production adoption.

Next: independent review of this checkpoint, then separately owned per-community physical-state/knowledge and cross-provider routing work. Resolve baseline compiler/blueprint failures before real technical trials. PR #1 remains reserved for Claude.

No Minecraft/Paper was launched, stopped or controlled; no production world/SQLite access; **paid API cost $0**. No automatic merge, force push, public posting or message to another agent.
