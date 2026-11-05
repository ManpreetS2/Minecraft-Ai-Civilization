# V1 Acceptance Ledger

**Issue:** [windows-backup #51](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/issues/51)  
**Charter:** `ManpreetS2/Minecraft-Ai-Civilization` `project.md` @ `63d1b97b188fb840db05c6baf60b549c476e508f`  
**Candidate branch:** `agents/cursor-v1-single-sha-integration` (PR [#56](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/pull/56))  
**Ledger updated:** 2026-11-05 (Mission 006 Evidence V2 + Gemini validator single-SHA)  
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
| Implemented (non-`NOT_IMPLEMENTED` / non-absent) | **16** |
| Denominator | **18** |
| Ratio | **16/18** |

OFF-02 / OFF-14 remain absent on tip; OFF-01 is process. OFF-15 now present via Gemini validator package.

### 2. Author-tested code

| Metric | Value |
| --- | --- |
| Author-tested on matrix SHA | **14** |
| Denominator | **18** |
| Ratio | **14/18** |
| Matrix evidence SHA (Mission 006) | `90c3ba41000bacd2977ea0135585391e2c275f3d` |

### 3. Independently supported behavior (Codex audit)

| Metric | Value |
| --- | --- |
| Independently supported | **5** |
| Denominator | **18** |
| Ratio | **5/18** |
| Audit SHA | `ea4ada9ba3baa750cc3c1dec330e4918bb47ef49` |
| Criteria | OFF-03, OFF-10, OFF-11, OFF-12, OFF-17 (limited scripted 1v1) |

**Not transferred** to Mission 006 tip `90c3ba4…`. Tip requires fresh independent QA (see `docs/MISSION006_CLAUDE_QA_HANDOFF.md`).

### 4. Accepted criteria (`OFFLINE_PASS` on tip)

| Metric | Value |
| --- | --- |
| Accepted on tip | **0** |
| Denominator | **18** |
| Ratio | **0/18** |

### 5. Blocked criteria

| Metric | Value |
| --- | --- |
| Blocked | **4** |
| IDs | OFF-01, OFF-02, OFF-13, OFF-14 |

### Live gates

| Metric | Value |
| --- | --- |
| Completed | **0/2** |

Paper authenticity: **NOT verified**. Gemini source authenticator remains fail-closed until real signature verification and trustworthy Paper capture exist.

---

## OFF-01 … OFF-18

| ID | Implemented behavior | Status | Source SHA | Test command | Evidence | Class | Reviewer | Blocker | Dependencies |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OFF-01 | Preserve unpublished WIP/worlds/DBs | `BLOCKED` | tip process | Owner inventory | — | process | — | Owner confirmation required | Owner |
| OFF-02 | YC harness on this candidate | `BLOCKED` | not tip | — | — | none | — | Candidate-bound evidence missing | PR #41 |
| OFF-03 | GPT/Claude routing + private sessions | `INDEPENDENT_ON_PRIOR_SHA` + author tip | Codex `ea4ada9`; author `90c3ba4` | independent-offline-runtime + `v1:offline` | Codex audit; Mission 006 matrix | independent prior | Codex | Tip independent revalidation | — |
| OFF-04 | Community physical/executor/storage/workstation isolation | `AUTHOR_TESTED` | `90c3ba4` | isolation vitest set | matrix | author | — | Independent review | — |
| OFF-05 | Per-community construction persistence | `AUTHOR_TESTED` | `90c3ba4` | construction vitest set | matrix | author | — | Independent review | — |
| OFF-06 | Owner/grantee chest isolation | `AUTHOR_TESTED` | `90c3ba4` | separate chest suites | matrix | author | Pending Claude tip QA | — | — |
| OFF-07 | Former-owner chest denial | `AUTHOR_TESTED` | `90c3ba4` | same family | matrix | author | Pending Claude | — | OFF-06 |
| OFF-08 | Former-grantee denial | `AUTHOR_TESTED` | `90c3ba4` | same family | matrix | author | Pending Claude | — | OFF-06 |
| OFF-09 | Failed withdraw / freshness | `AUTHOR_TESTED` | `90c3ba4` | ADV-03 + integrated chest | matrix | author | Pending Claude | Tip independent review | CHEST_OBSERVATION_CONTRACT |
| OFF-10 | Offline deny / escapes | `INDEPENDENT_ON_PRIOR_SHA` | Codex `ea4ada9` | deny + escapes | Codex | independent prior | Codex | Tip revalidation | — |
| OFF-11 | GPT retry hardening | `INDEPENDENT_ON_PRIOR_SHA` | Codex prior | provider/ADV-10 | Codex | independent prior | Codex | Tip revalidation | — |
| OFF-12 | Cancelled retry / mixed faults | `INDEPENDENT_ON_PRIOR_SHA` | Codex `ea4ada9` | mixed-provider + ADV-10 | Codex | independent prior | Codex | Tip revalidation | PR #42 |
| OFF-13 | Construction/host-port guard integrated | `BLOCKED` | local ≠ owned tip | local guard tests only | author local | author local | CODEX 1.2 | Ownership integrate; no rewrite this mission | CODEX 1.2 |
| OFF-14 | Movement reliability integrated | `BLOCKED` | `bdfba74` absent | — | — | none | CODEX 1.2 | Ownership handoff required | CODEX 1.2 |
| OFF-15 | Evidence validator / recorder | `AUTHOR_TESTED` | `90c3ba4` (from #47 `2156a0d`) | `pnpm test:evidence-validator`; `v1:offline` Gemini report | matrix + gemini-validator-report.json | author | Gemini owns live Paper auth | Live signature verification still missing | #47 |
| OFF-16 | Full typecheck/lint/build/test/security/ai/v1 | `AUTHOR_TESTED` | `90c3ba4` | full matrix | `artifacts/v1/mission006-90c3ba41000b/MATRIX.md` | author | — | Independent review | — |
| OFF-17 | Scripted offline 1v1 (limited) | `INDEPENDENT_ON_PRIOR_SHA` + author tip e2e | Codex `ea4ada9`; author `90c3ba4` | `pnpm v1:offline 2\|4` | Mission 006 bundles | independent prior + author | Codex / Cursor | Not autonomous models; peer OFF-03…16 | Distinct from ADV-07 |
| OFF-18 | No paid/live in offline sessions | `AUTHOR_TESTED` (scoped process) | `90c3ba4` | network stubs | process | author process | — | Not repo-wide negative proof | Ongoing |

---

## Gate A

**Not ready.** Tip `OFFLINE_PASS` **0/18**; live **0/2**. See `docs/MISSION005_GATE_A_READINESS.md` and `docs/MISSION006_INTEGRATION_MAP.md`. Offline `pnpm v1:offline 2|4` rehearsals are scripted evidence only (`NOT PROVEN` for Paper ticks / live models). Gemini reports `NOT_PROVEN` with `UNPROVEN_PAPER_AUTHENTICITY`.

## Mission 006 author matrix (`90c3ba41000bacd2977ea0135585391e2c275f3d`)

| Check | Exit | Counts |
| --- | --- | --- |
| typecheck / typecheck:tools / typecheck:evidence-validator / lint / build | 0 | clean |
| `pnpm test` | 0 | 198 files; 2257 passed; 2 skipped |
| test:security / test:ai / test:v1 / test:evidence-validator | 0 | 358 / 514 / 100 / 127 |
| qa/v1 adversarial | 0 | 91 passed |
| independent-offline-runtime / experiment-evidence | 0 | 11 / 11 |
| `pnpm v1:offline 2` / `4` | 0 | `artifacts/v1/mission006-90c3ba41000b/scenario-{2,4}`; structural **NOT PROVEN**; Gemini **NOT_PROVEN** |
| negative receipt tamper | FAIL expected | digest mismatch |

## Mission 005 author matrix (`c13567f4ab8d253480c18423d5908cafbe750455`)

Historical. Superseded for tip measurement by Mission 006 matrix above. Do not inherit PASS counts onto `90c3ba4…`.

---

## Provenance

- Mission 006 sources: Codex #55 `4c65ce7…` (Evidence V2), Gemini #47 `2156a0d…` (validator), base #56 Mission 005 tip `502ed59…`.
- Shared Vitest aliases retained; PR #42 mixed-fault runtime preserved.
- OFF-13/OFF-14: CODEX 1.2 ownership unresolved — blocker preserved; no movement/guard rewrite.
