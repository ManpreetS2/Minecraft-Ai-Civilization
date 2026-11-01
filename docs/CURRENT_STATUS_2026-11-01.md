# Engineering status — November 1, 2026

> **Point-in-time snapshot; not a live dashboard.** This document tracks *published Git revisions and reported test evidence*, not undocumented local edits or automatically updated readiness. Verify fresh refs and findings before starting a new task.

## Product truth

- [Authoritative public `project.md`](https://github.com/ManpreetS2/Minecraft-Ai-Civilization/blob/main/project.md): **first 1v1 GPT/Claude trial, then 2v2 for 60 uninterrupted real-world minutes**; two initially separate natural starting sites, empty inventory, citizen-directed food/shelter, neutral prompts and honest observation.
- **Not a completed demo:** the older five-citizen starter village is code/history for legacy flows, not the next acceptance milestone. No public 1v1 or 2v2 survival run has been verified.
- **Human interventions:** no rescue, teleportation, supplies, prebuilt structures, contracted building or accelerated time during the initial 60-minute run. Normal survival respawn with inventory drops is the chosen first-demo death policy.
- **Privacy:** a citizen's private notes and memories remain owner-only, including against teammates. Hearing, contact and sharing follow verified source/recipient rules. Invalid or unverifiable-origin legacy memory must be preserved in audit storage but quarantined from cognition unless authorized provenance is independently established.

## Repository/source checkpoints

| Workstream | Source branch | Verified remote SHA at snapshot | Maturity |
| --- | --- | --- | --- |
| Offline integration (F1 + BASE-003 + OPS-002 + CRAFT-001 + AI-001) | `integration/weekly-2026-10-31` | `17bff2db5b0b2f29c4c0d1626d0b28f332653633` | integration checkpoint; mocked session isolation, not live |
| SEC-001-A library / quarantine | `agents/proposal-SEC-001-A` | `c2ce3aca16e74d0eacd3d69d663fbe654ccbf51c` | unmerged security proposal |
| SEC-001-B manager routing and fact trust | `agents/claude-sec001-manager` | `15804fab622f6d91d7ec28858560c75eab8d347a` | isolated production proposal; offline checks only |
| Codex independent legacy SQLite/restart QA | `agents/codex-sec001-migration-QA` | `5df239c36eaefdb8ca762036703ff209f88c53e2` | tests and unresolved negative security assertions |
| QA-001 1v1 offline harness | `agents/qa-QA-001` | `f0f278766d13aefa94e60d4dbaace16c663f9b0b` | unfinished, unreviewed WIP snapshot |
| Original cognition reliability proposal | `agents/chatgpt-reliability-20261031` | `3e6c006527f448474461d63c45cd52cc8f4bd316` | draft PR #1; not merged |
| Claude review corrections to PR #1 | `agents/claude-pr1-review` | `77b9a9b5951945129dceadbcb4c6273807fa4700` | independent offline tests, further budget-cap work requested; not merged |

**Do not treat SHA appearances in this table as permission to merge.** See [GitHub Issue #2](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/issues/2) and these source-authored handoffs:

- `docs/project-management/HANDOFF_2026-10-31.md` on `integration/weekly-2026-10-31`
- `docs/project-management/SEC-001-B_CONTINUATION.md` on `agents/claude-sec001-manager`
- `docs/CODEX_SEC001_MIGRATION_QA.md` on `agents/codex-sec001-migration-QA`
- `docs/audits/CLAUDE_PR1_REVIEW_2026-11-01.md` on `agents/claude-pr1-review`

These paths do not necessarily exist on this one branch: use the **named source branch** for each document.

## Reported validation: do not mix baselines

| Test environment | Snapshot | Reported result | Limit |
| --- | --- | --- | --- |
| Grok weekly integration | `17bff2d` | **1,062 pass / 2 fail**; 10 prior type errors | offline, prior run |
| Claude SEC-001-B proposal | `15804fa` | **949 pass / 2 fail**; 53 new manager/command tests passed; 10 prior type errors | real manager with stubs, no live `/tell` |
| Codex migration QA pinned to SEC-001-A | `5df239c` | **22 pass / 10 intentionally red** security assertions; recovery 7/7 pass; full 918 pass / 12 fail | old proposal revision, real disposable SQLite; not replayed on Claude's manager |
| Claude cognition review on Windows | `77b9a9b` | **1,107 pass / 1 fail / 2 skipped**; cognition 107 pass; same prior typecheck/lint issues | different baseline/environment; all mock API calls |

**Known baseline inconsistencies:** Grok reported two pre-existing failures (starter-hut blueprint and path-alias construction experiment), while Claude's Windows checkout reproduced one (starter-hut blueprint). Do not claim this discrepancy is resolved without a same-commit/same-environment rerun. The code has no verified, branch-independent “fully green” status.

## Blocking work and responsibilities

| Priority | Work | Acceptance |
| --- | --- | --- |
| P0 | SEC-001 independently tested end to end | Re-run PRIV-001/005/007 and Codex SQLite tests against Claude manager revision; prove no unauthorized event/fact/memory enters downstream cognition, and authorized speech/sharing still succeeds |
| P0 | Provenance policy for legacy unverified notes | Keep original rows, quarantine model-facing use by default, restore individually only with authentic evidence and audited release; no blanket trust |
| P0 | Real per-community physical state | Separate settlement rows, claims, housing/workstations/project/storage access without invisible world ownership; assess unpublished Windows Mission 013 conflicts |
| P0 | Safe cloud budget/accounting | Reject unknown use, price-bound requests conservatively, record retries, prevent redirects or credential leakage; no metered API calls during review |
| P1 | QA-001 harness and session isolation | Integrate tests without using mocked GPT/Claude adapters as evidence of paid/live behavior |
| P1 | First live 1v1 gate | Separate authorization needed; verify actual Paper, Mineflayer, providers, food/shelter, memory, permission and observability |
| P1 | First real 2v2 gate | Complete 60 minutes without human rescue; preserve TPS, costs, outcomes, deaths and error logs |

**Paper version transition:** 1.21.11 build 132 is recorded as an *older local setup*, not the target demo. New owner direction calls for offline parity evaluation of **1.21.6 build #48**; do not assert it is already installed or migrate/overwrite a live world. Consult `server/README.md` before any authorized server work.

## Boundaries

- Offline tests, documentation, branch pushes and disposable SQLite fixtures are allowed within assigned scope.
- No live Minecraft/Paper test, no metered provider request, no production database mutation, no protected-branch merge and no force push without explicit approval.
- Unpublished Windows Mission 013 content may not be represented by published Git commits; review it with the Windows owner before combining production branches.
- A client application subscription does **not** cover real inference API charges. Exact GPT/Claude model variants, pricing and protocol readiness must be verified before running a live comparison.

**Next responsible action:** independent security QA against the published Claude revision, then a controlled integration review; not a claim that the 2v2 is “almost finished.”
