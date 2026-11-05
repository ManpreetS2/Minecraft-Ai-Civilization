# V1 Acceptance Ledger

**Issue:** [windows-backup #51](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/issues/51)  
**Charter:** `ManpreetS2/Minecraft-Ai-Civilization` `project.md` @ `63d1b97b188fb840db05c6baf60b549c476e508f`  
**Candidate branch:** `agents/cursor-v1-single-sha-integration` (PR [#56](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/pull/56))  
**Ledger updated:** 2026-11-05 (Mission 004 priority — Claude CHANGES REQUIRED / shared Vitest aliases / QA `53602ba`)  
**Authority:** Offline measurement only. Does **not** authorize live Paper, paid calls, production data, or protected merges.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `NOT_IMPLEMENTED` | Behavior absent on the tip |
| `IMPLEMENTED` | Code present on tip (may lack tests) |
| `AUTHOR_TESTED` | Author/Cursor suites green on a cited tip/matrix SHA — **not** independent acceptance |
| `INDEPENDENT_ON_PRIOR_SHA` | Non-author evidenced on a cited prior SHA; **not** transferred to tip without revalidation |
| `OFFLINE_PASS` | Tip evidence **and** recorded independent acceptance on that tip |
| `LIVE_PASS` | Owner-authorized live Paper / real provider evidence |
| `BLOCKED` | Ownership, missing confirmation, or review gate |

**Rules:** Author greens never increment independently supported or `OFFLINE_PASS`. Evidence does not transfer across SHAs. Official offline denominator is always **18**. No invented completion percentage.

---

## Five separate measurements

### 1. Implemented code (present on tip)

| Metric | Value |
| --- | --- |
| Implemented (non-`NOT_IMPLEMENTED` / non-absent) | **15** |
| Denominator | **18** |
| Ratio | **15/18** |

Counts rows with code on tip including `BLOCKED` rows that still have partial local code (e.g. local guards) only when the requirement itself is present. OFF-02 / OFF-14 remain absent on tip; OFF-01 is process.

### 2. Author-tested code

| Metric | Value |
| --- | --- |
| Author-tested on matrix SHA | **13** |
| Denominator | **18** |
| Ratio | **13/18** |
| Matrix evidence SHA | `38f61ce1b2986e7bd16c38e3953dcbfb15548e71` |

### 3. Independently supported behavior (Codex audit)

| Metric | Value |
| --- | --- |
| Independently supported | **5** |
| Denominator | **18** |
| Ratio | **5/18** |
| Audit SHA | `ea4ada9ba3baa750cc3c1dec330e4918bb47ef49` |
| Criteria | OFF-03, OFF-10, OFF-11, OFF-12, OFF-17 (limited scripted 1v1) |

Claude adversarial QA harness `53602ba…` against `ea4ada9…`: **CHANGES REQUIRED** (root Vitest load failure for integrated chest adapter — fixed on tip via shared aliases).

### 4. Accepted criteria (`OFFLINE_PASS` on tip)

| Metric | Value |
| --- | --- |
| Accepted on tip | **0** |
| Denominator | **18** |
| Ratio | **0/18** |

### 5. Blocked criteria

| Metric | Value |
| --- | --- |
| Blocked | **5** |
| IDs | OFF-01, OFF-02, OFF-13, OFF-14, OFF-15 |

### Live gates

| Metric | Value |
| --- | --- |
| Completed | **0/2** |

---

## OFF-01 … OFF-18

| ID | Implemented behavior | Status | Source SHA | Test command | Evidence | Class | Reviewer | Blocker | Dependencies |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OFF-01 | Preserve unpublished WIP/worlds/DBs | `BLOCKED` | tip process | Owner inventory | — | process | — | Owner confirmation required | Owner |
| OFF-02 | YC harness on this candidate | `BLOCKED` | not tip | — | — | none | — | Candidate-bound evidence missing | PR #41 |
| OFF-03 | GPT/Claude routing + private sessions | `INDEPENDENT_ON_PRIOR_SHA` + author tip | Codex `ea4ada9`; author matrix | `independent-offline-runtime` | Codex audit | independent prior | Codex | Tip revalidation | — |
| OFF-04 | Community physical/executor/storage/workstation isolation | `AUTHOR_TESTED` | matrix | isolation vitest set | matrix log | author | — | Independent review | — |
| OFF-05 | Per-community construction persistence | `AUTHOR_TESTED` | matrix | construction vitest set | matrix log | author | — | Independent review | — |
| OFF-06 | Owner/grantee chest isolation | `AUTHOR_TESTED` | matrix | separate chest suites (packages + tools + ADV) | matrix log | author | Pending Claude tip re-QA | — | — |
| OFF-07 | Former-owner chest denial | `AUTHOR_TESTED` | matrix | same family | matrix log | author | Pending Claude | — | OFF-06 |
| OFF-08 | Former-grantee denial | `AUTHOR_TESTED` | matrix | same family | matrix log | author | Pending Claude | — | OFF-06 |
| OFF-09 | Failed withdraw / freshness | `AUTHOR_TESTED` | matrix | ADV-03 freshness now **executes** via `observedContainerDetails` + `expectedRevision` | matrix + adv-chest-freshness | author | Pending Claude | Tip independent review | CHEST_OBSERVATION_CONTRACT |
| OFF-10 | Offline deny / escapes | `INDEPENDENT_ON_PRIOR_SHA` | Codex `ea4ada9` | deny + escapes | Codex | independent prior | Codex | Tip revalidation | — |
| OFF-11 | GPT retry hardening | `INDEPENDENT_ON_PRIOR_SHA` | Codex prior | provider/ADV-10 | Codex | independent prior | Codex | Tip revalidation | — |
| OFF-12 | Cancelled retry / mixed faults | `INDEPENDENT_ON_PRIOR_SHA` | Codex `ea4ada9` | mixed-provider + ADV-10 probe | Codex | independent prior | Codex | Tip revalidation | PR #42 |
| OFF-13 | Construction/host-port guard integrated | `BLOCKED` | local ≠ owned tip | local guard tests only | author local | author local | CODEX 1.2 | Ownership integrate | CODEX 1.2 |
| OFF-14 | Movement reliability integrated | `BLOCKED` | `bdfba74` absent | — | — | none | CODEX 1.2 | Ownership | CODEX 1.2 |
| OFF-15 | Evidence validator / recorder | `BLOCKED` | #47 `60ed5ca` not folded | — | PR #47 branch | none on tip | Gemini | Workspace/Phase-1 readiness | #47 |
| OFF-16 | Full typecheck/lint/build/test/security/ai/v1 | `AUTHOR_TESTED` | matrix | full matrix commands | matrix log | author | — | Independent review; root suite must include tools aliases | — |
| OFF-17 | Scripted offline 1v1 (limited) | `INDEPENDENT_ON_PRIOR_SHA` | Codex `ea4ada9` limited | independent-offline-runtime | Codex limited | independent prior | Codex | Not crash recovery; peer OFF-03…16 | Distinct from ADV-07 author/QA shutdown |
| OFF-18 | No paid/live in Mission 004 offline sessions | `AUTHOR_TESTED` (scoped process) | sessions | network stubs | process | author process | — | Not repo-wide negative proof | Ongoing |

---

## Gate A

**Not ready.** Tip `OFFLINE_PASS` **0/18**; blockers remain; Codex/Claude prior findings require tip revalidation.

---

## Mission 004 priority matrix

**Platform:** win32 / node v22.17.1 / pnpm 10.13.1  
**Matrix evidence SHA:** `38f61ce1b2986e7bd16c38e3953dcbfb15548e71`  
**Log:** local `artifacts/v1/mission004-priority-matrix.log` (author-reported)

| Check | Command | Exit | Counts |
| --- | --- | --- | --- |
| chest under root config | `pnpm exec vitest run tools/v1-integration/integrated-chest-adapter.test.ts` | 0 | 1 file; 1 passed |
| typecheck | `pnpm typecheck` | 0 | workspace Done |
| typecheck:tools | `pnpm typecheck:tools` | 0 | clean |
| lint | `pnpm lint` | 0 | clean |
| build | `pnpm build` | 0 | workspace build |
| test (root) | `pnpm test` | 0 | 197 files; **2205 passed**; 2 skipped |
| test:security | `pnpm test:security` | 0 | 21 files; 358 passed |
| test:ai | `pnpm test:ai` | 0 | 20 files; 514 passed |
| test:v1 | `pnpm test:v1` | 0 | 8 files; 50 passed |
| Independent QA | vitest `qa/v1/test` | 0 | 10 files; **91 passed** |
| Offline 1v1/2v2 + late shutdown | independent-offline-runtime | 0 | 1 file; 11 passed |
| Provider faults | mixed-provider-faults | 0 | 1 file; 7 passed |

Author-reported only. Does not move any row to `OFFLINE_PASS`.

---

## Provenance

- Shared Vitest aliases: `test-support/civ-package-aliases.mjs` used by root + `tools/vitest.config.ts` (fixes Claude’s `@civ/shared` load failure).
- QA tip `53602ba03c6d24e60537a81207720a64d82cfc55`: false-PASS fix retained; disposable worktree wrapper; ADV-10 behavioural probe; ADV-07 shutdown; chest freshness tests/contract. Historical red remains auditable via `it.fails` path when probe detects unfixed sources.
- Chest contract implemented additively: `observedContainerDetails`, `revision`, `expectedRevision` CAS. `observedContainerContents` unchanged when options omitted.
