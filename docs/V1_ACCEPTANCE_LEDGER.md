# V1 Acceptance Ledger

**Issue:** [windows-backup #51](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/issues/51)  
**Charter:** `ManpreetS2/Minecraft-Ai-Civilization` root `project.md` on `origin/main` @ `63d1b97b188fb840db05c6baf60b549c476e508f`  
**Ledger branch:** `agents/cursor-v1-acceptance-ledger` (worktree `Minecraft-Ai-Civilization-cursor-v1-integration`)  
**Ledger created:** 2026-11-05  
**Authority:** Measurement and offline engineering only. This document does **not** authorize live Paper, paid model calls, production data access, or protected-branch merges.

## How to read statuses

| Status | Meaning |
| --- | --- |
| `NOT_IMPLEMENTED` | No integrated source implements the behavior |
| `IMPLEMENTED_UNVERIFIED` | Code exists on some branch; no accepted evidence on a single integrated SHA |
| `OFFLINE_PASS` | Deterministic offline test evidence on **one** integrated source SHA |
| `LIVE_PASS` | Authentic disposable Paper / real provider evidence (owner-authorized) |
| `BLOCKED` | Known defect, missing dependency, or ownership/review gate |

**Rules:** Never count tests on independent unreconciled branches as combined-source pass. Never treat simulated 60-minute fixtures as Paper success. Percentages use explicit numerator/denominator only from rows below.

---

## Completion metrics (explicit)

### Offline / integrated-code acceptance

Criteria with IDs `OFF-*` that are currently `OFFLINE_PASS` on a **single** integrated SHA / all `OFF-*` criteria.

| Metric | Value |
| --- | --- |
| Passed | **0** |
| Total offline criteria | **18** |
| Ratio | **0/18** |
| Integrated candidate SHA | *none yet* (best raw baseline heads listed in reconciliation plan; not combined) |

> Chest P0 fixes in this branch close three QA defects on the Mission 013 chest head (`dbbb7c4` + QA `f443bb3`), but that head is **not** the reconciled 1v1 integrated candidate. Do not promote these three rows to overall offline completion until they land on the future combined SHA.

### Live Gate A / Gate B acceptance

| Metric | Value |
| --- | --- |
| Live gates completed | **0** |
| Live gates declared | **2** (Gate A, Gate B) |
| Ratio | **0/2** |
| Notes | Live criteria remain `NOT_IMPLEMENTED` / unauthorized. Offline unit tests do not close Gate A or Gate B. |

---

## Gate A — Solo survival + 1v1 GPT/Claude technical verification

Source: `project.md` § Gate A (lines ~248–249 on `origin/main` @ `63d1b97b`).

| ID | Requirement | Source | Status | Acceptance test | Evidence | Independent review | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GA-01 | One citizen connects on an isolated engine | Gate A | `IMPLEMENTED_UNVERIFIED` | Disposable Paper connect + spawn identity | Scattered Windows/live docs; no single integrated SHA | Required | Live unauthorized; integrate runtime first |
| GA-02 | Gather food with physical inventory evidence | Gate A + research differentiator #2 | `IMPLEMENTED_UNVERIFIED` | Offline gather/food inventory proofs; later live hunger delta | Branches: survival readiness `2983c17`, manager physical `4da60f0` | Required | Not on one integrated SHA; live unverified |
| GA-03 | Navigate / avoid drowning | Gate A | `IMPLEMENTED_UNVERIFIED` | Movement reliability suite; live path evidence | `agents/codex-movement-reliability` @ `bdfba74` | CODEX 1.2 owns | Not integrated |
| GA-04 | Find/use shelter/bed when possible | Gate A | `IMPLEMENTED_UNVERIFIED` | Sleep/shelter offline + live | Homes/sleep paths exist across WIP | Required | Unreconciled |
| GA-05 | Preserve identity across reconnect/respawn | Gate A | `IMPLEMENTED_UNVERIFIED` | Restart SQLite identity/memory suite | Manager restart isolation `5d0268f` | Required | Not integrated candidate |
| GA-06 | Stop safely (no closed-SQLite writes) | Gate A + original issue #6 | `IMPLEMENTED_UNVERIFIED` | Deferred-promise shutdown test | Original PR #7 draft; Windows reliability paths | Required | Shutdown lifecycle still tracked as open risk |
| GA-07 | One GPT + one Claude independent sessions | Gate A / milestones (1) | `IMPLEMENTED_UNVERIFIED` | Scripted dual-provider offline 1v1; no cross session | Candidate `9945f02` + provider PRs #32/#42/#48 | Non-author review required | Not reconciled; paid/live forbidden |
| GA-08 | Independent memories / no private leakage | Gate A + differentiator #1 | `IMPLEMENTED_UNVERIFIED` | Negative privacy suite (unobserved chest, DM, rival site) | SEC-001 / reviewed security branches | Independent SEC review | Reconciliation + review open |
| GA-09 | Accurate subscription/API cost attribution | Gate A | `IMPLEMENTED_UNVERIFIED` | Offline accounting fixtures; live cost ledger later | Provider retry/fault PRs #32/#42 | Non-author | Live cost proof unauthorized |
| GA-10 | Offline unit tests alone do **not** close Gate A | Gate A explicit | `OFFLINE_PASS` (meta) | Ledger rule: Gate A live rows stay open | This ledger | N/A | N/A — measurement rule |

Live Gate A criteria: GA-01…GA-09 → **0/9 LIVE_PASS**.

---

## Gate B — 2v2 / 60 continuous real-world minutes

Source: `project.md` § Gate B (lines ~251–252) + public acceptance target.

| ID | Requirement | Source | Status | Acceptance test | Evidence | Independent review | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GB-01 | Two GPT + two Claude independent citizens | Gate B | `NOT_IMPLEMENTED` | Live 2v2 roster with separate sessions | None on integrated SHA | Required | Depends on Gate A |
| GB-02 | Two comparable natural start sites, empty inventories | Gate B | `NOT_IMPLEMENTED` | Preflight inventory/world witnesses | Experiment preflight `e3f6579` (offline only) | Required | Live unauthorized |
| GB-03 | Real food/shelter pressure; no gifted setup | Gate B | `NOT_IMPLEMENTED` | Empty-start + natural pressure check | Design only | Required | Live unauthorized |
| GB-04 | Neutral prompts; no forced rivalry/leader/outcome | Gate B / Option A | `NOT_IMPLEMENTED` | Prompt/fixture audit + run log | Design only | Required | Live unauthorized |
| GB-05 | Authorized information exchange only | Gate B + differentiator #1 | `IMPLEMENTED_UNVERIFIED` | Cross-community negative privacy tests | Community isolation stack #12–#14 + QA | Required | Defects/integration open |
| GB-06 | Log inventory/block/health/death/model/cost | Gate B | `IMPLEMENTED_UNVERIFIED` | Evidence validator + operator journal | Validator PRs #43/#47 | Gemini/validator review | Base ancestry of #47 disputed |
| GB-07 | 60 continuous real-world minutes, normal speed | Gate B | `NOT_IMPLEMENTED` | Timed Paper run with TPS/ticks | None — simulations ≠ LIVE_PASS | Required | Unauthorized |
| GB-08 | Normal respawn; keepInventory=false; memory preserved | Gate B + death-policy phases | `NOT_IMPLEMENTED` | Live death/drop/respawn evidence | Design locked | Required | Unauthorized |
| GB-09 | No operator resources / human construction during run | Gate B | `NOT_IMPLEMENTED` | Intervention log empty (or recorded invalidation) | None | Required | Unauthorized |

Live Gate B criteria: **0/9 LIVE_PASS**.

---

## Offline integration prerequisites (`OFF-*`)

These must reach `OFFLINE_PASS` on **one** reconciled candidate SHA before requesting live authorization.

| ID | Requirement | Source | Status | Acceptance test | Evidence | Independent review | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OFF-01 | Preserve Windows WIP / worlds / DBs / unpublished Mission 013 | Issue #51; milestones (0) | `BLOCKED` (process) | Inventory worktrees; no clean/reset/force-push | Local audit 2026-11-05: 20+ worktrees preserved; root `main` clean @ `15c13c8` (behind origin by docs commits) | Owner | Unpublished Mission 013 may exist outside git |
| OFF-02 | YC harness offline feasibility evaluation | project.md YC section; PR #41 | `IMPLEMENTED_UNVERIFIED` | Offline harness eval docs/tests only | `agents/claude2-yc-harness-eval` @ `0a23306` / PR #41 | Required | No adoption decision yet |
| OFF-03 | Per-citizen GPT/Claude routing + private context (scripted) | Issue #51 §5; Gate A | `IMPLEMENTED_UNVERIFIED` | Deterministic dual-citizen offline suite | Candidate `9945f02` PR #37 | Non-author | Needs reconcile + QA |
| OFF-04 | Community physical isolation (executor/storage/workstations) | Mission 013; origin PR #12 | `IMPLEMENTED_UNVERIFIED` | `repro-manager-executor-isolation` + QA #38/#44 | `55d5a86` | Claude2 QA done | Stacked; not on combined SHA |
| OFF-05 | Per-community construction persistence | origin PR #13 | `IMPLEMENTED_UNVERIFIED` | Construction community tests + QA #49 | `7b1bd98` | QA #49 | Stacked on #12 |
| OFF-06 | Owner/grantee chest contents; no community snapshot leak | origin PR #14 | `IMPLEMENTED_UNVERIFIED` | `community-container-contents` + QA #50 | Source `dbbb7c4`; QA `f443bb3` | QA #50 CHANGES REQUIRED → fix in progress on this branch | Three P0 defects (see OFF-07…09) |
| OFF-07 | Former community owner loses old-community chest access | Issue #51 P0; QA #50 DEFECT 1 | `IMPLEMENTED_UNVERIFIED` | QA: owner change → `observedContainerContents` undefined | Branch `agents/cursor-v1-acceptance-ledger` @ `581759ccaec6da0b829c35ed2658dd1c0598c641`; `pnpm exec vitest run packages/agent-core/src/independent-qa-chest-contents.test.ts` → 7/7 pass (2026-11-05) | Needs non-author re-check | Not on reconciled 1v1 integrate SHA |
| OFF-08 | Grantee loses access after changing community | Issue #51 P0; QA #50 DEFECT 2 | `IMPLEMENTED_UNVERIFIED` | QA: grantee change → undefined | Same SHA; same command | Same | Same |
| OFF-09 | Failed live withdraw proving absence invalidates stale positive observation | Issue #51 P0; QA #50 DEFECT 3 | `IMPLEMENTED_UNVERIFIED` | QA: VERIFY_FAILED → `{}` / cleared item | Same SHA; related suite 59/59 pass across 6 community files | Same | Same |
| OFF-10 | Offline default-deny transports (no injectable network) | windows-backup PR #48 | `IMPLEMENTED_UNVERIFIED` | Security/offline deny suite | `ae784fd` | **Must be non-Claude2** | Self-approval forbidden |
| OFF-11 | GPT retry / quota / Retry-After hardening | PR #32 | `IMPLEMENTED_UNVERIFIED` | Provider retry tests | `8bd0941` | Non-author | Not integrated |
| OFF-12 | Mixed GPT/Claude fault accounting (no charge on cancelled wait) | PR #42 | `IMPLEMENTED_UNVERIFIED` | Mixed fault suite | `1a690f6` | Non-author | Not integrated |
| OFF-13 | Construction filesystem / host-port guard | CODEX cross-platform PR #14 (backup) | `IMPLEMENTED_UNVERIFIED` | Guard QA #39/#45 | `7cb4bf4` | Claude2 QA | Integrate carefully; CODEX owns |
| OFF-14 | Movement reliability truthful results | backup PR #25 | `IMPLEMENTED_UNVERIFIED` | Movement suite | `bdfba74` | CODEX 1.2 | Ownership reserved |
| OFF-15 | Evidence validator compares correct base | Issue #51 §7; PRs #43/#47 | `BLOCKED` | Validator suite vs Phase1 `f8f4506` (11 files), not 342-file Windows WIP base | PR #47 ancestry dispute | Gemini | Correct base or clean stacked PR |
| OFF-16 | Full suite + security + AI + typecheck + lint + build on candidate | Issue #51 §5 | `NOT_IMPLEMENTED` | Single SHA matrix | None combined | Required | Needs integration branch |
| OFF-17 | Deterministic 1v1 offline integration (scripted models, restart, no network) | Issue #51 §5 / Phase 4 | `NOT_IMPLEMENTED` | Scripted 1v1 harness on combined SHA | None | Required | Depends OFF-03…16 |
| OFF-18 | No paid calls / no live Paper during offline phases | Working rules | `OFFLINE_PASS` (process) | Audit: no live/paid in this engagement | This Cursor session: offline only | N/A | Ongoing discipline |

**Offline score today: 0/18 OFFLINE_PASS on a single integrated SHA** (OFF-18 is process-only and is excluded from the integrated-code numerator until a candidate SHA exists; if counted as process gate alone it does not certify product readiness).

Practical numerator used for Issue #51 reporting: **0/18** integrated offline criteria with single-SHA evidence.

---

## P0 chest defect closure log (this branch)

**Policy (explicit, V1):** Owner access requires current membership in the asset’s community. Same-community grants (`cross_community=0`) require the grantee to still belong to that community. Grants issued to a citizen already outside the owner’s community are stored with `cross_community=1` (explicit diplomacy) and remain until revoked. Stale same-community membership must not imply continued access. Failed live withdraw with `ITEM_NOT_FOUND` / `VERIFY_FAILED` clears only that item’s observed count (no fabricated full stock). Legacy single-settlement mode is unchanged.

**Ownership check (2026-11-05):**

| Path | Latest published head | Active unpublished owner? | Action |
| --- | --- | --- | --- |
| `community-physical-state.ts` | `dbbb7c4` (origin PR #14 / Mission 013) | No newer commits; campaign worktree parked at `dbbb7c4` | Cursor scoped fix on isolated branch per Issue #51 |
| `executor.ts` withdraw observation | `dbbb7c4` | Same | Narrow invalidation only |
| QA file | `f443bb3` (PR #50, test-only) | Claude2 QA complete | Convert `it.fails` → `it` after green |

**Reproduction:** On `f443bb3`, vitest reported all three `it.fails` as expected failures (suite green while assertions failed). After fix, markers converted to ordinary `it`.

**Commands (to be filled with SHAs after commit):**

```text
pnpm exec vitest run packages/agent-core/src/independent-qa-chest-contents.test.ts
pnpm exec vitest run packages/agent-core/src/community-container-contents.test.ts
```

---

## Best existing baselines (do not treat as integrated success)

| Role | Repo | Ref | SHA | Notes |
| --- | --- | --- | --- | --- |
| Public charter / docs main | origin | `main` | `63d1b97b188fb840db05c6baf60b549c476e508f` | Docs only; not runtime |
| Local checkout main | local | `main` | `15c13c8` | Behind origin docs; clean WT |
| Offline network-guarded candidate | windows-backup | `agents/t3-provider-hardening-integration` | `9945f02f38e14a7d63b3eed66279d191ad06ad3d` | PR #37; QA #46 found GPT fetch gap |
| Mission 013 stack tip | origin | `agents/t3-community-chest-contents` | `dbbb7c4fde2d809bf259dc5452133507717b9453` | PR #14; ancestry #12→#13→#14 |
| Chest QA (test-only) | windows-backup | `agents/claude2-qa-chest-contents` | `f443bb386c1adfc5ce6f9d7c3d69de14c3a58aa1` | PR #50 |
| This integration worktree | windows-backup draft PR [#52](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/pull/52) | `agents/cursor-v1-acceptance-ledger` | `8bb2c731ae24b364de7d434f67209f3c5e63bf1a` (fix `581759ccaec6da0b829c35ed2658dd1c0598c641`) | Ledger + P0 chest fixes (not yet a full 1v1 integrate SHA) |

---

## Independent review queue (non-negotiable)

1. Re-check chest P0 fix (someone other than this Cursor session / CODEX1 author of `dbbb7c4`).  
2. Non-Claude2 review of PR #48 (`ae784fd`).  
3. Non-author reviews of provider #32 and #42.  
4. Guard/movement ownership retained by CODEX 1.2; integrate only after review.  
5. Validator #47 base correction (Gemini).  
6. Combined 1v1 candidate security + offline QA before any live request.

---

## Remaining blockers (ordered)

1. Finish/publish chest P0 fix + independent re-QA.  
2. File-by-file reconcile origin #12–#14 with backup candidate `#37`/`9945f02` and reviewed safety/adapters (see `docs/V1_BRANCH_RECONCILIATION_PLAN.md`).  
3. Close OFF-10…OFF-14 reviews and fold into one isolated candidate.  
4. Produce Phase 4 scripted 1v1 evidence on that single SHA (0 paid / 0 Paper).  
5. Only then request owner authorization for live Gate A.
