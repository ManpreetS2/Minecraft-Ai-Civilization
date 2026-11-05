# V1 Acceptance Ledger

**Issue:** [windows-backup #51](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/issues/51)  
**Charter:** `ManpreetS2/Minecraft-Ai-Civilization` `project.md` @ `63d1b97b188fb840db05c6baf60b549c476e508f`  
**Candidate branch:** `agents/cursor-v1-single-sha-integration` (PR [#56](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/pull/56))  
**Ledger updated:** 2026-11-05 (Mission 004)  
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
| Candidate SHA | *(filled at each publish; see latest PR #56 head)* |

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
| OFF-01 | Preserve Windows WIP / worktrees / DBs | `IMPLEMENTED_UNVERIFIED` (process) | Worktree inventory; no clean/reset | PR #56 heads | Local audit Mission 003/004 | Worktrees preserved | — | Ongoing discipline |
| OFF-02 | YC harness offline evaluation | `IMPLEMENTED_UNVERIFIED` | Harness eval docs/tests | `0a23306` (not this SHA) | PR #41 | Separate branch | Required | Not folded into #56 |
| OFF-03 | Per-citizen GPT/Claude routing + private context | `IMPLEMENTED_UNVERIFIED` | Scripted 1v1 offline runtime | PR #56 HEAD | `vitest … independent-offline-runtime.test.ts` | Self-green | Pending | Needs non-author |
| OFF-04 | Community physical isolation | `IMPLEMENTED_UNVERIFIED` | Community physical/storage suites | PR #56 HEAD | `community-physical-state` / `executor-community-storage` | Self-green | Pending | Needs non-author |
| OFF-05 | Per-community construction persistence | `IMPLEMENTED_UNVERIFIED` | Construction community tests | Ancestry on #56 | Partial via Mission 013 stack | Partial | Required | Full construction QA not re-run as Gate |
| OFF-06 | Owner/grantee chest contents isolation | `IMPLEMENTED_UNVERIFIED` | `community-container-contents` + QA chest | PR #56 HEAD | chest suites + integrated adapter | Self-green 3/3 adapter | Pending Claude | Independent re-QA |
| OFF-07 | Former owner loses old-community chest access | `IMPLEMENTED_UNVERIFIED` | QA / integrated chest former-owner | PR #56 HEAD | `integrated-chest-adapter.test.ts` | Self-green | Pending Claude | — |
| OFF-08 | Grantee loses access after community change | `IMPLEMENTED_UNVERIFIED` | QA / integrated former-grantee | PR #56 HEAD | same | Self-green | Pending Claude | — |
| OFF-09 | Failed withdraw invalidates stale positive observation | `IMPLEMENTED_UNVERIFIED` | QA / integrated failed-withdrawal | PR #56 HEAD | same | Self-green | Pending Claude | ADV-03 freshness metadata still BLOCKED |
| OFF-10 | Offline default-deny transports + body/credential guards | `IMPLEMENTED_UNVERIFIED` | default-deny + pr48 escapes | PR #56 HEAD (+ QA runner `f5e2228`) | deny + escape suites | Self-green | Pending Codex non-author on #53 | — |
| OFF-11 | GPT Retry-After / quota hardening | `IMPLEMENTED_UNVERIFIED` | Provider retry / ADV-10 | PR #56 HEAD | mixed-provider + ADV provider | Self-green ancestry | Pending non-author | — |
| OFF-12 | Cancelled retry wait not charged; mixed faults | `IMPLEMENTED_UNVERIFIED` | `mixed-provider-faults` + ADV-10 | PR #56 HEAD | `mixed-provider-faults.test.ts` 7/7 | Self-green | Pending; convert QA `it.fails` after confirm | Historical red preserved in comments |
| OFF-13 | Construction filesystem / host-port guard | `BLOCKED` | Guard QA | `7cb4bf4` | — | Not on #56 as required gate | CODEX 1.2 | Ownership / narrow reconcile |
| OFF-14 | Movement reliability | `BLOCKED` | Movement suite | `bdfba74` | — | Not folded | CODEX 1.2 | Ownership handoff |
| OFF-15 | Evidence validator correct base | `BLOCKED` | Validator suite | #43/#47 | — | Ancestry dispute | Gemini | Correct #47 base |
| OFF-16 | Full suite + security + AI + typecheck + lint + build | `IMPLEMENTED_UNVERIFIED` | Full workspace matrix | PR #56 HEAD after Mission 004 matrix | See matrix section below | Recorded on publish | Pending | Must match this SHA’s matrix log |
| OFF-17 | Deterministic scripted 1v1 offline integration | `IMPLEMENTED_UNVERIFIED` | Manager 1v1 scenario | PR #56 HEAD | `independent-offline-runtime` 1v1 case | Self-green | Pending | — |
| OFF-18 | No paid calls / no live Paper in offline phases | `IMPLEMENTED_UNVERIFIED` (process) | Network guard + audit | PR #56 sessions | Offline-only engineering | Observed | — | Ongoing |

---

## Gate A / Gate B (live)

All live rows remain `NOT_IMPLEMENTED` / unauthorized. Offline tests do **not** close Gate A or Gate B. **0/2**.

---

## Mission 004 matrix log

Filled when the full matrix finishes on the published HEAD (do not paste older SHAs’ logs here).

| Check | Command | Exit | Counts | SHA |
| --- | --- | --- | --- | --- |
| *(pending Mission 004 run)* | | | | |

---

## Provenance notes

- QA runner corrections integrated from Claude PR #54 head `f5e22288287214c99c15767856d8a3e2d4a21611` (verdict/run/tests). Destructive `run-on-candidate.sh` **not** imported; see `qa/v1/scripts/README-RUN-ON-CANDIDATE.md`.
- Independent acceptance still required before any `OFFLINE_PASS`.
