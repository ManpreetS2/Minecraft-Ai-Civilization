# V1 Acceptance Ledger

**Issue:** [windows-backup #51](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/issues/51)  
**Charter:** `ManpreetS2/Minecraft-Ai-Civilization` `project.md` @ `63d1b97b188fb840db05c6baf60b549c476e508f`  
**Candidate branch:** `agents/cursor-v1-single-sha-integration` (PR [#56](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/pull/56))  
**Ledger updated:** 2026-11-05 (Mission 004 — Codex CHANGES REQUIRED corrections)  
**Authority:** Offline measurement only. Does **not** authorize live Paper, paid calls, production data, or protected merges.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `NOT_IMPLEMENTED` | Behavior absent on the candidate tip |
| `IMPLEMENTED_AUTHOR` | Present on tip; author/Cursor tests only — **not** independent acceptance |
| `INDEPENDENT_ON_PRIOR_SHA` | Codex (or other non-author) evidenced the behavior on a cited prior SHA; **not** transferred to tip without revalidation |
| `OFFLINE_PASS` | Deterministic offline evidence **on this tip SHA** **and** recorded independent reviewer acceptance |
| `LIVE_PASS` | Authentic disposable Paper / real provider evidence (owner-authorized) |
| `BLOCKED` | Ownership, missing interface, missing owner confirmation, or review gate |

**Validation rules**

1. Author-reported green tests never increment independently supported or `OFFLINE_PASS` counts.
2. Evidence bound to SHA A does **not** automatically apply to SHA B.
3. Official offline denominator is always **18**. Do not invent completion percentages.
4. Codex unreviewed catalogs (30 offline / 37 live) are separate and do not replace this ledger.

---

## Four explicit measurements

### 1. Implementation coverage (author-reported on tip)

Rows whose status is `IMPLEMENTED_AUTHOR`, `INDEPENDENT_ON_PRIOR_SHA`, or `OFFLINE_PASS`.

| Metric | Value |
| --- | --- |
| Covered | **13** |
| Denominator | **18** |
| Ratio | **13/18** |
| Matrix evidence SHA | `2384766185398cadb14f40f4b72ca4ab9d003b97` |

Includes behaviors with author suites even when independent acceptance is absent. Does **not** mean Gate A ready.

### 2. Independently supported offline behavior (Codex audit)

Codex independent acceptance-ledger audit of reviewed SHA `ea4ada9ba3baa750cc3c1dec330e4918bb47ef49` — **CHANGES REQUIRED**.

| Metric | Value |
| --- | --- |
| Independently evidenced by Codex | **5** |
| Denominator | **18** |
| Ratio | **5/18** |
| Audit SHA | `ea4ada9ba3baa750cc3c1dec330e4918bb47ef49` |
| Criteria | OFF-03, OFF-10, OFF-11, OFF-12, OFF-17 (limited scripted 1v1 scope) |

This is **not** overall project completion. It is **not** transferred onto later tip commits until those criteria are revalidated by a non-author on the tip.

### 3. Fully accepted offline prerequisites (`OFFLINE_PASS` on tip)

| Metric | Value |
| --- | --- |
| `OFFLINE_PASS` on tip | **0** |
| Denominator | **18** |
| Ratio | **0/18** |

### 4. Completed live gates

| Metric | Value |
| --- | --- |
| Live gates completed | **0** |
| Declared live gates | **2** |
| Ratio | **0/2** |

---

## OFF-01 … OFF-18 (authoritative)

| ID | Implemented behavior | Status | Source SHA | Executed test command | Evidence | Evidence class | Reviewer | Outstanding blocker | Dependencies |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OFF-01 | Preserve unpublished Windows WIP / worktrees / worlds / DBs | `BLOCKED` | tip process | Owner inventory of worktrees + world/DB paths (not Git alone) | Process note only | author process | — | Needs **owner-confirmed** preservation of unpublished artifacts; Git inspection insufficient | Owner |
| OFF-02 | YC harness offline feasibility on **this** candidate | `BLOCKED` | `0a23306` (not tip) | PR #41 harness (not bound to #56 tip) | Separate branch | none on tip | — | Candidate-bound YC evidence missing | PR #41 fold or re-run on tip |
| OFF-03 | Per-citizen GPT/Claude routing + private sessions | `INDEPENDENT_ON_PRIOR_SHA` | Codex: `ea4ada9…`; author tip matrix: see `2384766185398cadb14f40f4b72ca4ab9d003b97` | `pnpm exec vitest run apps/orchestrator/src/independent-offline-runtime.test.ts` (+ routing suites) | Codex audit; author re-run on tip | independent prior; author tip | Codex (prior SHA) | Tip revalidation by non-author | — |
| OFF-04 | Community physical / executor / storage / workstation isolation | `IMPLEMENTED_AUTHOR` | `2384766185398cadb14f40f4b72ca4ab9d003b97` | `pnpm exec vitest run packages/agent-core/src/community-physical-state.test.ts packages/agent-core/src/executor-community-storage.test.ts packages/agent-core/src/workstations-community.test.ts packages/agent-core/src/storage-community-access.test.ts packages/agent-core/src/independent-qa-community-isolation.test.ts` | `artifacts/v1/mission004-audit-matrix.log` §off04 | author | — | Independent review of full isolation suite | — |
| OFF-05 | Per-community construction persistence | `IMPLEMENTED_AUTHOR` | `2384766185398cadb14f40f4b72ca4ab9d003b97` | `pnpm exec vitest run packages/agent-core/src/community-construction-runtime.test.ts packages/agent-core/src/executor-community-construction.test.ts` | matrix log §off05 | author | — | Independent review | — |
| OFF-06 | Owner/grantee chest contents isolation | `IMPLEMENTED_AUTHOR` | `2384766185398cadb14f40f4b72ca4ab9d003b97` | Separate commands: `community-container-contents.test.ts`; `independent-qa-chest-contents.test.ts`; `adv-chest-access.test.ts`; tools regressions + integrated adapter (**do not** count 3 logical cases inside one Vitest as 3 independent tests) | matrix log §off0609* | author | Pending Claude | Independent chest re-QA on tip | ADV-03 policy |
| OFF-07 | Former owner loses old-community chest access | `IMPLEMENTED_AUTHOR` | `2384766185398cadb14f40f4b72ca4ab9d003b97` | Same chest suite family; former-owner cases in independent-qa + ADV-03 + adapter | matrix log | author | Pending Claude | Independent review | OFF-06 |
| OFF-08 | Grantee loses access after community change | `IMPLEMENTED_AUTHOR` | `2384766185398cadb14f40f4b72ca4ab9d003b97` | Same chest suite family; former-grantee cases | matrix log | author | Pending Claude | Independent review | OFF-06 |
| OFF-09 | Failed withdraw invalidates stale positive observation | `IMPLEMENTED_AUTHOR` | `2384766185398cadb14f40f4b72ca4ab9d003b97` | failed-withdrawal cases + ADV-03 stock tests | matrix log | author | Pending Claude | `verifiedLive` + ordering token still BLOCKED for ADV-03; provenance read is additive only | OFF-06; Claude ADV-03 |
| OFF-10 | Offline default-deny transports + body/credential guards | `INDEPENDENT_ON_PRIOR_SHA` | Codex: `ea4ada9…` | `pnpm exec vitest run apps/orchestrator/src/independent-offline-default-deny.test.ts apps/orchestrator/src/pr48-review-escapes.test.ts` | Codex audit | independent prior | Codex (prior SHA) | Tip revalidation | — |
| OFF-11 | GPT Retry-After / quota hardening | `INDEPENDENT_ON_PRIOR_SHA` | Codex prior retry evidence + audit `ea4ada9…` | Provider retry / ADV-10 / mixed-provider suites | Codex independent retry evidence (historical) + audit | independent prior | Codex | Tip revalidation; historical red preserved in ADV-10 comments | OFF-12 related |
| OFF-12 | Cancelled retry not charged; mixed GPT+Claude faults | `INDEPENDENT_ON_PRIOR_SHA` | Codex: `ea4ada9…` | `pnpm exec vitest run packages/cognition/src/routing/mixed-provider-faults.test.ts` + ADV-10 | Codex audit | independent prior | Codex (prior SHA) | Tip revalidation | PR #42 folded |
| OFF-13 | Construction filesystem / host-port guard (integrated gate) | `BLOCKED` | local guard tests ≠ accepted integrate SHA `7cb4bf4` | Local only: `construction-experiment-guard.test.ts` + `construction-path-isolation.test.ts` | matrix log §off13_local (author) | author local ≠ integrated ownership evidence | CODEX 1.2 | Do not treat historical branch results as integrated; need verified owned source | CODEX 1.2 |
| OFF-14 | Movement reliability (integrated) | `BLOCKED` | `bdfba747…` not on tip | Movement suite paths from published-refs — **absent** on tip | — | none on tip | CODEX 1.2 | Ownership + verified integrate | CODEX 1.2 |
| OFF-15 | Evidence validator correct base / recorder bridge | `BLOCKED` | Gemini PR #47 tip `60ed5cabe1d66a75d4a04a86399bb57de73424c7` (stacked on Phase 1) | Validator package not in tip workspace (`experiments/evidence-validator` absent; workspace is `apps/*`+`packages/*` only) | PR #47 reports 78/78 on its branch | none on tip | Gemini | Scoped integrate when Phase 1 base + workspace membership + ownership ready; inspected 2026-11-05, **not** folded | PR #47 / Phase 1 |
| OFF-16 | Full candidate typecheck/lint/build/test/security/ai/v1 | `IMPLEMENTED_AUTHOR` | `2384766185398cadb14f40f4b72ca4ab9d003b97` | `pnpm typecheck`; `pnpm typecheck:tools`; `pnpm lint`; `pnpm build`; `pnpm test`; `pnpm test:security`; `pnpm test:ai`; `pnpm test:v1` | matrix log | author | — | Focused 82+25 is **not** sufficient; full matrix required per tip; independent review | — |
| OFF-17 | Deterministic scripted offline 1v1 | `INDEPENDENT_ON_PRIOR_SHA` | Codex: `ea4ada9…` (limited scope) | `independent-offline-runtime.test.ts` 1v1 case | Codex: limited scripted 1v1 only | independent prior (limited) | Codex | Does **not** prove process-crash recovery or pending-callback shutdown; those are separate author tests / gaps. OFF-03…OFF-16 are **peer ledger criteria**, not strict prerequisites of OFF-17 | Distinct from crash/shutdown/live survival |
| OFF-18 | No paid calls / no live Paper **in Mission 004 offline engineering sessions** | `IMPLEMENTED_AUTHOR` (process, scoped) | Mission 004 sessions | Network stubs in offline suites; engineering policy audit | Session process notes; test `fetch` stubs | author process | — | Scoped claim only — **not** a repository-wide negative proof for all history/branches | Ongoing discipline |

---

## Gate A / Gate B (live)

All live rows remain unauthorized / incomplete. Offline author greens and Codex’s 5/18 prior-SHA support do **not** close Gate A or Gate B. **0/2**.

**Gate A authorization decision:** **Not ready.** Independently accepted tip prerequisites are 0/18; movement/guard/validator blocked; owner OFF-01 confirmation pending.

---

## Mission 004 audit-correction matrix

**Platform:** win32 Microsoft Windows NT 10.0.26300.0; node v22.17.1; pnpm 10.13.1  
**Matrix evidence SHA:** `2384766185398cadb14f40f4b72ca4ab9d003b97`  
**Log:** local `artifacts/v1/mission004-audit-matrix.log` (gitignored; author-reported)

| Check | Command | Exit | Counts |
| --- | --- | --- | --- |
| OFF-04 isolation | vitest community-physical + executor-storage + workstations + storage-access + independent-qa-isolation | 0 | 5 files; 53 passed |
| OFF-05 construction | vitest community-construction-runtime + executor-community-construction | 0 | 2 files; 8 passed |
| OFF-06…09 chest (packages) | vitest community-container-contents + independent-qa-chest-contents | 0 | 2 files; 15 passed |
| OFF-06…09 chest (tools) | vitest tools regressions + integrated-chest-adapter | 0 | 2 files; 6 passed |
| OFF-06…09 chest (ADV-03) | vitest qa adv-chest-access | 0 | 1 file; 8 passed; 3 skipped (BLOCKED gaps) |
| Respawn / identity (author) | vitest ops-cancellation + citizen-routing + demo-identity + untrusted-model-output | 0 | 4 files; 159 passed |
| Physical truthfulness (author) | vitest craft-e2e + eat-food + collect-inventory-delta + manager-physical-integration | 0 | 4 files; 30 passed |
| OFF-13 local guards only | vitest construction-experiment-guard + construction-path-isolation | 0 | 2 files; 65 passed (**not** integrated ownership evidence) |
| typecheck | `pnpm typecheck` | 0 | workspace Done |
| typecheck:tools | `pnpm typecheck:tools` | 0 | clean |
| lint | `pnpm lint` | 0 | clean |
| build | `pnpm build` | 0 | workspace build |
| test | `pnpm test` | 0 | 197 files; 2205 passed; 2 skipped |
| test:security | `pnpm test:security` | 0 | 21 files; 358 passed |
| test:ai | `pnpm test:ai` | 0 | 20 files; 514 passed |
| test:v1 | `pnpm test:v1` | 0 | 8 files; 50 passed |
| Independent QA adversarial | vitest qa/v1/test | 0 | 8 files; 83 passed; 3 skipped |
| Offline 1v1/2v2 + late shutdown | vitest independent-offline-runtime | 0 | 1 file; 11 passed |
| Deny / escapes | vitest independent-offline-default-deny + pr48-review-escapes | 0 | 2 files; 23 passed |
| Provider faults | vitest mixed-provider-faults | 0 | 1 file; 7 passed |

All listed exits are **author-reported** on the `2384766185398cadb14f40f4b72ca4ab9d003b97`. They do **not** move any row to `OFFLINE_PASS`.

---

## OFF-17 scope clarification

OFF-17 is an **independent ledger criterion**. OFF-03…OFF-16 are sibling requirements, not automatic gates that OFF-17 inherits.

Codex’s independent OFF-17 support covers **limited scripted offline 1v1** only. Separately tracked (author tip evidence, not Codex OFF-17):

- Late cognition callback after shutdown started (no closed-SQLite write) — author test on tip.
- Controlled restart with SQLite memory/community/identity restore — author test; in-memory provider session text requires explicit session store (not automatic process-session durability).
- Process-crash recovery — **not** established.
- Live survival — **not** offline OFF-17.

---

## Provenance / integration notes

- QA harness: Claude PR #54 tip `150008775d174fd6844e069dcf4eda72b9fbc512` integrated (non-destructive `run-on-candidate.sh` + `wrapper-safety` + harness-path `run.ts`). Overlay uses `qa-independent/v1`; does not replace tracked `qa/v1` via destructive copy.
- Chest: additive `observedContainerProvenance()` exposes existing `observed_at`/`observed_by`. ADV-03 `verifiedLive` + concurrent ordering remain BLOCKED.
- Gemini #47 `60ed5ca`: inspected; validator tree not on tip; **not** integrated this pass.
- Movement/guard: CODEX 1.2 ownership; historical branch tips are not tip evidence.
