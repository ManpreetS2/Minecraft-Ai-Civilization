# V1 Acceptance Ledger

**Issue:** [windows-backup #51](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/issues/51)  
**Charter:** `ManpreetS2/Minecraft-Ai-Civilization` `project.md` @ `63d1b97b188fb840db05c6baf60b549c476e508f`  
**Candidate branch:** `agents/cursor-v1-single-sha-integration` (PR [#56](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/pull/56))  
**Ledger updated:** 2026-11-05 (Mission 007 offline release candidate + Gemini Ed25519)  
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

**Rules:** Author greens never increment independently supported or `OFFLINE_PASS`. Evidence does not transfer across SHAs. Official offline denominator is always **18**.

---

## Five separate measurements

### 1. Implemented code (present on tip)

| Metric | Value |
| --- | --- |
| Implemented | **16** |
| Denominator | **18** |
| Ratio | **16/18** |

OFF-02 / OFF-14 absent; OFF-01 process. OFF-15 includes Gemini Ed25519 verifier.

### 2. Author-tested code

| Metric | Value |
| --- | --- |
| Author-tested on matrix SHA | **14** |
| Denominator | **18** |
| Ratio | **14/18** |
| Matrix evidence SHA (Mission 007) | `a176fcaee0e4e72cf2d40a738d3bfcad5343cc80` |

### 3. Independently supported behavior

| Metric | Value |
| --- | --- |
| Independently supported on **this** tip | **0** |
| Prior Codex audit (not transferred) | **5/18** on `ea4ada9…` |
| Tip revalidation | Pending Claude QA (`docs/MISSION007_CLAUDE_QA_HANDOFF.md`) |

### 4. Formally accepted (`OFFLINE_PASS`)

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

Paper authenticity: **NOT proven**. Ed25519 verify exists; live Paper capture + production signing authority still absent. Synthetic test keypairs are **not** genuine Paper evidence.

---

## OFF-01 … OFF-18

| ID | Behavior | Status | Source SHA | Notes |
| --- | --- | --- | --- | --- |
| OFF-01 | Preserve WIP/worlds/DBs | `BLOCKED` | process | Owner confirmation |
| OFF-02 | YC harness | `BLOCKED` | not tip | |
| OFF-03 | GPT/Claude routing + sessions | `AUTHOR_TESTED` + prior independent | `a176fca` / `ea4ada9` | Tip needs Claude revalidation |
| OFF-04 | Community isolation | `AUTHOR_TESTED` | `a176fca` | |
| OFF-05 | Construction persistence | `AUTHOR_TESTED` | `a176fca` | |
| OFF-06 | Chest owner/grantee | `AUTHOR_TESTED` | `a176fca` | |
| OFF-07 | Former-owner denial | `AUTHOR_TESTED` | `a176fca` | |
| OFF-08 | Former-grantee denial | `AUTHOR_TESTED` | `a176fca` | |
| OFF-09 | Failed withdraw / freshness | `AUTHOR_TESTED` | `a176fca` | CAS present |
| OFF-10 | Offline deny / escapes | prior independent only | `ea4ada9` | Not transferred |
| OFF-11 | GPT retry | prior independent only | Codex prior | Not transferred |
| OFF-12 | Mixed faults | prior independent only | `ea4ada9` | Not transferred |
| OFF-13 | Construction guard | `BLOCKED` | CODEX 1.2 | See `MISSION007_OFF13_OFF14_HANDOFF.md` |
| OFF-14 | Movement reliability | `BLOCKED` | `bdfba74` remote only | Ownership handoff required |
| OFF-15 | Evidence validator + Ed25519 | `AUTHOR_TESTED` | `a176fca` ← `fad541f` | Live Paper still NOT_PROVEN |
| OFF-16 | Full matrix | `AUTHOR_TESTED` | `a176fca` | `MISSION007_MATRIX.md` |
| OFF-17 | Scripted offline 1v1/2v2 | `AUTHOR_TESTED` + prior limited | `a176fca` | Not autonomous models |
| OFF-18 | No paid/live offline | `AUTHOR_TESTED` (scoped) | `a176fca` | |

---

## Gate A

**Not ready.** `OFFLINE_PASS` **0/18**; live **0/2**; independent on this tip **0/18**. See `docs/MISSION007_CLAUDE_QA_HANDOFF.md`.

## Mission 007 author matrix (`a176fcaee0e4e72cf2d40a738d3bfcad5343cc80`)

| Check | Exit | Counts |
| --- | --- | --- |
| typecheck / tools / evidence-validator / lint / build | 0 | clean |
| `pnpm test` | 0 | 2257 passed; 2 skipped |
| test:security / test:ai / test:v1 / test:evidence-validator | 0 | 358 / 514 / 100 / **149** |
| qa/v1 | 0 | 91 passed |
| `pnpm v1:offline 2\|4` | 0 | NOT PROVEN / Gemini NOT_PROVEN |
| crypto + incomplete attestation + tamper | 0 / FAIL expected | fail-closed |

## Provenance

- Gemini `fad541f` Ed25519 integrated; Cursor completeness gates refuse incomplete Paper authenticity claims.
- Mission 005/006 offline civilization, Evidence V2, receipts, chest CAS preserved.
- OFF-13/OFF-14 not rewritten.
