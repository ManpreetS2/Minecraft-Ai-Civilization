# V1 Acceptance Ledger

**Issue:** [windows-backup #51](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/issues/51)  
**Charter:** `ManpreetS2/Minecraft-Ai-Civilization` `project.md` @ `63d1b97b188fb840db05c6baf60b549c476e508f`  
**Candidate branch:** `agents/cursor-v1-single-sha-integration` (PR [#56](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/pull/56))  
**Ledger updated:** 2026-11-05 (Mission 004 publish)  
**Authority:** Offline measurement only. Does **not** authorize live Paper, paid calls, production data, or protected merges.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `NOT_IMPLEMENTED` | Behavior absent on the candidate |
| `IMPLEMENTED_UNVERIFIED` | Present on the candidate SHA; Cursor/self tests only — **not** independently accepted |
| `OFFLINE_PASS` | Deterministic offline evidence on the candidate SHA **and** independent reviewer acceptance recorded |
| `LIVE_PASS` | Authentic disposable Paper / real provider evidence (owner-authorized) |
| `BLOCKED` | Ownership, missing interface, or review gate |

**Implementation coverage** ≠ **independently accepted offline evidence**. Self-green tests raise a row at most to `IMPLEMENTED_UNVERIFIED` until a non-author records acceptance.

Codex unreviewed catalogs (30 offline / 37 live) are **separate** and do not replace the 18-item official denominator.

---

## Completion metrics (explicit)

### A. Implementation coverage on the candidate (self-verified, not independent acceptance)

Count of `OFF-*` rows that are at least `IMPLEMENTED_UNVERIFIED` or `OFFLINE_PASS` on the published candidate SHA.

| Metric | Value |
| --- | --- |
| Implemented (self-verified) | **11** |
| Total offline criteria | **18** |
| Ratio | **11/18** |
| Full-matrix code SHA | `43c02cb8ab9cc06d83c08143d7e574e1f65ed79f` |
| Publish HEAD | PR #56 tip (docs-only after matrix SHA `43c02cb8ab9cc06d83c08143d7e574e1f65ed79f`) |

### B. Independently accepted offline evidence

| Metric | Value |
| --- | --- |
| Independently accepted (`OFFLINE_PASS`) | **0** |
| Total offline criteria | **18** |
| Ratio | **0/18** |

> No OFF row is `OFFLINE_PASS` until Claude/Codex/other non-author acceptance is recorded for that criterion on this SHA.

### C. Live Gate A / Gate B

| Metric | Value |
| --- | --- |
| Live gates completed | **0** |
| Live gates declared | **2** |
| Ratio | **0/2** |

---

## OFF-01 … OFF-18

| ID | Requirement | Status | Required test | Tested SHA | Evidence command | Result | Independent reviewer | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OFF-01 | Preserve Windows WIP / worktrees / DBs | `IMPLEMENTED_UNVERIFIED` (process) | Worktree inventory; no clean/reset | Mission 004 sessions | Local audit | Worktrees preserved | — | Ongoing discipline |
| OFF-02 | YC harness offline evaluation | `IMPLEMENTED_UNVERIFIED` | Harness eval docs/tests | `0a23306` (not this SHA) | PR #41 | Separate branch | Required | Not folded into #56 |
| OFF-03 | Per-citizen GPT/Claude routing + private context | `IMPLEMENTED_UNVERIFIED` | Scripted 1v1 offline runtime | `43c02cb…` | `vitest … independent-offline-runtime.test.ts` | 11/11 self-green | Pending | Needs non-author |
| OFF-04 | Community physical isolation | `IMPLEMENTED_UNVERIFIED` | Community physical/storage suites | `43c02cb…` | `community-physical-state` / `executor-community-storage` | Self-green in `pnpm test` | Pending | Needs non-author |
| OFF-05 | Per-community construction persistence | `IMPLEMENTED_UNVERIFIED` | Construction community tests | Ancestry on #56 | Partial via Mission 013 stack | Partial | Required | Full construction QA not re-run as Gate |
| OFF-06 | Owner/grantee chest contents isolation | `IMPLEMENTED_UNVERIFIED` | `community-container-contents` + QA chest | `43c02cb…` | chest suites + integrated adapter | Self-green | Pending Claude | Independent re-QA |
| OFF-07 | Former owner loses old-community chest access | `IMPLEMENTED_UNVERIFIED` | QA / integrated chest former-owner | `43c02cb…` | `integrated-chest-adapter.test.ts` | Self-green | Pending Claude | — |
| OFF-08 | Grantee loses access after community change | `IMPLEMENTED_UNVERIFIED` | QA / integrated former-grantee | `43c02cb…` | same | Self-green | Pending Claude | — |
| OFF-09 | Failed withdraw invalidates stale positive observation | `IMPLEMENTED_UNVERIFIED` | QA / integrated failed-withdrawal | `43c02cb…` | same | Self-green | Pending Claude | ADV-03 verifiedLive + ordering still BLOCKED; `observedContainerProvenance` additive read only |
| OFF-10 | Offline default-deny transports + body/credential guards | `IMPLEMENTED_UNVERIFIED` | default-deny + pr48 escapes | `43c02cb…` (+ QA runner `f5e2228`) | deny + escape suites | 23/23 self-green | Pending Codex non-author on #53 | — |
| OFF-11 | GPT Retry-After / quota hardening | `IMPLEMENTED_UNVERIFIED` | Provider retry / ADV-10 | `43c02cb…` | mixed-provider + ADV provider | Self-green | Pending non-author | — |
| OFF-12 | Cancelled retry wait not charged; mixed faults | `IMPLEMENTED_UNVERIFIED` | `mixed-provider-faults` + ADV-10 | `43c02cb…` | `mixed-provider-faults` 7/7; ADV-10 ordinary assertions | Self-green | Pending | Historical red preserved in comments (`it.fails` era) |
| OFF-13 | Construction filesystem / host-port guard | `BLOCKED` | Guard QA | `7cb4bf4` | — | Not on #56 as required gate | CODEX 1.2 | Ownership / narrow reconcile |
| OFF-14 | Movement reliability | `BLOCKED` | Movement suite | `bdfba7473d79487ffdcf467592e1f2328efabc4c` | — | Not folded | CODEX 1.2 | Ownership handoff (see below) |
| OFF-15 | Evidence validator correct base | `BLOCKED` | Validator suite | #43/#47 | — | Ancestry dispute | Gemini | Correct #47 base |
| OFF-16 | Full suite + security + AI + typecheck + lint + build | `IMPLEMENTED_UNVERIFIED` | Full workspace matrix | `43c02cb8ab9cc06d83c08143d7e574e1f65ed79f` | See matrix section | All exits 0 | Pending | Must match this SHA’s matrix log |
| OFF-17 | Deterministic scripted 1v1 offline integration | `IMPLEMENTED_UNVERIFIED` | Manager 1v1 (+ 2v2 composition) | `43c02cb…` | independent-offline-runtime 1v1+2v2 cases | Self-green | Pending | — |
| OFF-18 | No paid calls / no live Paper in offline phases | `IMPLEMENTED_UNVERIFIED` (process) | Network guard + audit | Mission 004 sessions | Offline-only engineering | Observed | — | Ongoing |

---

## Gate A / Gate B (live)

All live rows remain `NOT_IMPLEMENTED` / unauthorized. Offline tests do **not** close Gate A or Gate B. **0/2**.

---

## Mission 004 matrix log

**Platform:** win32 Microsoft Windows NT 10.0.26300.0; node v22.17.1; pnpm 10.13.1  
**Source SHA:** `43c02cb8ab9cc06d83c08143d7e574e1f65ed79f`  
**Log file:** `artifacts/v1/mission004-matrix.log` (local worktree; not authority for independent acceptance)

| Check | Command | Exit | Counts |
| --- | --- | --- | --- |
| typecheck | `pnpm typecheck` | 0 | workspace packages Done |
| typecheck:tools | `pnpm typecheck:tools` | 0 | tools tsconfig with `@civ/*` paths |
| lint | `pnpm lint` | 0 | clean |
| build | `pnpm build` | 0 | workspace build |
| test | `pnpm test` | 0 | 197 files; 2205 passed; 2 skipped |
| test:security | `pnpm test:security` | 0 | 21 files; 358 passed |
| test:ai | `pnpm test:ai` | 0 | 20 files; 514 passed |
| test:v1 | `pnpm test:v1` | 0 | 8 files; 50 passed |
| Independent QA adversarial | `pnpm exec vitest run --config qa/v1/vitest.config.ts qa/v1/test` | 0 | 7 files; 75 passed; 3 skipped (ADV-03 interface gaps) |
| Scripted offline 1v1 (+2v2 + late shutdown) | `pnpm exec vitest run apps/orchestrator/src/independent-offline-runtime.test.ts` | 0 | 1 file; 11 passed |
| Integrated chest regressions | `pnpm exec vitest run --config tools/vitest.config.ts tools/v1-integration/regressions.test.ts tools/v1-integration/integrated-chest-adapter.test.ts` | 0 | 2 files; 6 passed |
| Offline startup refusal / escapes | `pnpm exec vitest run apps/orchestrator/src/independent-offline-default-deny.test.ts apps/orchestrator/src/pr48-review-escapes.test.ts` | 0 | 2 files; 23 passed |
| Provider cancelled-retry / mixed faults | `pnpm exec vitest run packages/cognition/src/routing/mixed-provider-faults.test.ts` | 0 | 1 file; 7 passed |

Shutdown / persistence notes covered inside the offline runtime suite: drain fully, late cognition after `stop()` cannot write closed SQLite, restart reopens SQLite memories/community/identity while in-memory provider session text is restored only via the explicit session store (not claimed as automatic process-session durability).

---

## Movement / guard handoff (CODEX 1.2)

Not integrated into #56. Reviewed tips in tooling refs:

- Movement: `agents/codex-movement-reliability` @ `bdfba7473d79487ffdcf467592e1f2328efabc4c`
- Guard / filesystem-host work remains under CODEX 1.2 ownership (`7cb4bf4` lineage for OFF-13)

**Ask:** authorize narrow cherry-pick or leave BLOCKED until CODEX 1.2 lands reviewed commits onto this candidate.

---

## Provenance notes

- QA runner corrections integrated from Claude PR #54 head `f5e22288287214c99c15767856d8a3e2d4a21611` (verdict/run/tests). Destructive `run-on-candidate.sh` **not** imported; see `qa/v1/scripts/README-RUN-ON-CANDIDATE.md`.
- ADV-10 cancelled-retry cases converted from historical `it.fails` to ordinary assertions on the integrated PR #42 source; comment preserves historical red.
- Additive `observedContainerProvenance()` exposes existing `observed_at` / `observed_by` without changing write merge semantics. ADV-03 `verifiedLive` + concurrent ordering token remain BLOCKED for Claude to wire.
- Independent acceptance still required before any `OFFLINE_PASS`.
