# Unified offline engineering resume - 2026-11-01

## Authoritative checkout

Active worktree: C:/Users/sh1ft/Minecraft-Ai-Civilization-t3-campaign. Branch: agents/t3-claude-transport-reconciliation. Behavior/test source checkpoint: 9d0370688a8b1750f8d926978614bfe95be0dee7; documentation may advance HEAD. Always verify actual git status/HEAD and remote before continuing. Base for this child: f25c6f0ca11f0c2b38bfe9e3479905d53c528df9 (#31). Completed Claude transport source: fa13d3b8c090e4c8ebd8b9f2eb38183c00e88c51 (#28); clean local merge 2e2cec479ac7d9f7d40d66137e0e3275a173d6e9. Native SQLite 12.11.1; Node22.17.1/pnpm10.13.1; frozen offline install passed including pinned @anthropic-ai/sdk1.3.0.

Original C:/Users/sh1ft/Minecraft-Ai-Civilization public main and C:/Users/sh1ft/Minecraft-Ai-Civilization-t3-sec001 (2be4f4a) were checked clean and remain untouched. No live Minecraft/Paper, paid provider requests, production data/world operations, merges into protected branches or force pushes. API cost incurred: $0. A read-only process/selected-port query returned no matching Java/listener entries; no server processes were started/stopped. Historical PIDs are not authority.

## Published stack before this transport child

All private draft proposals; none merged automatically. Base staging/weekly fafc93dce2f4e878b6d2dce93cbfe7d6644f1f5c.

| PR | Branch / checkpoint | Implemented behavior | Full workspace at checkpoint |
| --- | --- | --- | --- |
| #7 | agents/t3-sec001-cloud-reconciliation / 7c039eca | SEC + cost-control/schema reconciliation; later security corrections required | 1491 pass, 1 old blueprint fail, 2 skip |
| #8 | agents/t3-community-physical-state / fc6f9fc2 | Authenticated community state, claims, CAS holds, explicit assets; scoped planner reads | 1513 pass, 1 old fail, 2 skip |
| #9 | agents/t3-survival-offline-readiness / 2983c172 | Recheck resource targets across navigation/look; seeded empty-start capability chains | Focused skills 210 pass |
| #10 | agents/t3-offline-baseline-cleanup / 980ea688 | Actual blueprint feature mapping + all ten TS/fifteen lint baseline repairs | 1523 pass, 2 skip; types/lint/build pass |
| #15 | agents/t3-experiment-offline-preflight / e3f65790 | Strict manifest, live-ready always false, operator evidence hashing/witness checks, offline version audit | 1568 pass, 2 skip |
| #16 | agents/t3-reviewed-security-integration / e85d7f9f | Claude S1-S7 security/recovery, own site knowledge, deferred delivery | 1652 pass, 2 skip |
| #21 | agents/t3-independent-manager-integration / 5d0268f6 | Registry/manager routing lifecycle; original cost restart reproducer | 1757 pass, 2 skip; known budget defect at that historical source |
| #26 | agents/t3-safe-sqlite-launch / d11fe0a3 | Startup refusal before Paper/RCON/SQLite filenames; S8, durable budget closure/admission and stale decision corrections | 1901 pass, 2 skip |
| #27 | agents/t3-manager-physical-acceptance / 4da60f0d | Real manager tick/planner/executor/skills/SQLite shared simulated world; preserved failing isolation assertion | 1906 pass, 2 skip |
| #29 | agents/t3-independent-runtime-startup / 6f402f79 | Normal start with explicit roster/run ID/body seam, distinct persisted personalities, offline composition root | 1921 pass, 2 skip |
| #30 | agents/t3-private-workstation-boundaries / 70eafaef | Owned/explicitly granted workstation metadata, dimension/block verification, refuse actor-free global cache mutation | 1930 pass, 2 skip |
| #31 | agents/t3-scoped-storage-authorization / f25c6f0c | Actor/grant/dimension chest access; active personal homes; no rival owner metadata in denials | 1938 pass, 2 skip |

See each docs/T3_*.md package report and its draft PR for precise files and earlier red/green evidence. Historical reports are not current acceptance claims.

## Current transport reconciliation and evidence

Only the completed #28 source was merged, not Claude 2's unfinished provider-hardening branch. No direct provider implementation changes by CODEX 1. SDK transport has default-deny per-attempt gate, fixed endpoint/options, no SDK retries/logging/telemetry, sanitized error fields, and injected HTTP contract fixtures. No API acceptance, credentials or live transport run is proven. Its transport is not wired into a live CLI. The offline composition explicitly rejects a paid transport and keeps allowPaidRequests false.

Current default workspace: 2032 passed / 0 failed / 2 skipped across177 files, actual Vitest process exit0. Focused security: 358 passed across21 files (includes new workstation/storage cases). Published-source provider/manager physical focused replay: 451 pass; normal-runtime paid-refusal suite9 pass. Expanded test:ai selection459 passed across18 files, including the added paid-refusal case; process exit0. Typecheck, lint, build, frozen offline install and diff check pass. Both scripts/repro-routing-budget-restart.ts and scripts/repro-routing-persist-admission.ts PASS. Logs live in ignored artifacts/campaign/ (final-unified-*, claude-transport-* and prior package prefixes).

PowerShell expected stderr can mark redirected native calls as shell errors even with passing test output. Final full command explicitly captures LASTEXITCODE and exits with it. The executor reproducer initially hit a missing undeclared root @civ/shared link after clean install; its import now uses the package source path. Assertions remain intact and rerun reaches the actual security failure below.

## Honest acceptance and remaining defects

Overall: NOT READY. Live Gate A: not run/verified in this offline campaign. Default green tests are capability/regression evidence, not overall isolation acceptance.

1. P0, CODEX 1 + Mission013 review dependency: scripts/repro-manager-executor-isolation.ts STILL FAILS on the combined tree. Two real manager/planner/executor food actions cause settlement_first.food0->2. Exact path: manager tick -> executePlan -> updateSettlementFromInventory -> global getSettlement/saveSettlement. Protected executor.ts blob db9170536075212338d883643eb914d6cf0bb834 is unchanged. Private inventory must not be promoted automatically to any communal pool. Other global executor/project/runtime reads remain. Reproduce with pnpm exec tsx scripts/repro-manager-executor-isolation.ts; expected current exit1 with the food diff, not an import error.
2. P0, runtime/OS containment: main, World-Lab and construction live paths in #26 intentionally refuse. better-sqlite3's filename/sidecars are not bound by a checked read-only FD. No verified OS containment or immutable protected-root boundary exists. Implicit manager stores accept only exact :memory:; explicitly injected disposable offline stores remain available. Other historical mechanics tools were not turned into a universal sandbox. Do not enable live by deleting a guard.
3. P0, protected executor bridges: community-mode actor-free workstation writes/deletes now throw; old communal chest calls lacking dimension now deny. docs/patches/executor-community-boundary.patch and executor-storage-dimension.patch are REVIEW ONLY, NOT APPLIED. The dimension patch passes git apply --check and only adds dimension to two calls; it does not fix the aggregate, ownership provenance, community runtime or Mission013 conflicts. Complete supporting APIs first, then precise reviewed source patch.
4. P1, guard integration: current combined tree includes CODEX3's older7ba269c source only. Latest #14 exact652fc605f1284b63e1b2e9ec963dcfc876bd958d passed native Windows/Linux/macOS CI but required independent QA remains pending. Ten false acceptances on the old checkpoint were already reported by CODEX3; do not describe it as current accepted guard. Integrate the accepted interface only after required review. Runtime refusal remains mandatory regardless.
5. P1, owner policy O2/O4: retention of legitimately learned communal knowledge after departure and automatic community-state sharing remain unresolved decisions. Current revocation behavior and scoped state semantics are not silently changed. Personal memory is not reset; new workstation metadata requires explicit grant, not mere membership.
6. P1, actual provider readiness: #28 SDK source exists, but live API/schema/model availability and paid smoke are UNVERIFIED. Paid transport needs explicit owner credentials/spending approval and OS/runtime readiness; never assume subscription credits. File-backed budget state cannot promise crash-proof recovery of a charge if a post-send persistence failure survives until crash. Test cost ledgers are simulated.
7. P1, physical survival/readiness: tests model natural bushes/trees, empty inventories, actual simulated drops/recipes/placement and verified food7->9. Model replies/navigation/world physics are simulated. No hostiles/night/starvation duration/full shelter survival or 60-minute Paper demo proven. Manager start is exercised via injected bodies; periodic full live tick/server connection remains unverified. The legacy CLI's colony mode purges hostiles and must not be reused unchanged for ordinary-survival experiments.
8. P1, instrumentation/version: operator recorder/preflight are executable and tested but recorder is not fully wired to manager live actions. Knowledge singleton still defaults1.21.11 while target is Paper1.21.6#48; do not switch active versions automatically or claim parity. Prepared checklist only; live evidence unavailable.

## Coordination and exact next work

Issue #6 is the ledger. CODEX 3 owns construction guard/tests and adapter navigation/movement/connection modules (Issue23); do not edit them. Guard handoff acknowledged at comment6562245289. CLAUDE2 now owns provider hardening from #28; do not duplicate/merge unfinished work. CLAUDE1 is scheduled by the owner to resume independent QA at/after13:20 Pacific, beginning #29 and current descendants/#14. Do not schedule or claim to wake CLI sessions. Existing file ownership and all no-live/no-paid/no-production rules remain.

Next engineering action: finish publishing this exact combined transport child and ledger update, then inspect the protected executor/global runtime dependency map and prepare the smallest complete, testable scoped execution proposal using the intact failing reproducer. Direct executor source changes still require Mission013 conflict resolution; do not bypass with Proxy stores or silently turn personal inventories into shared state. Safe supporting APIs/fixtures/instrumentation may continue offline. A further concrete harness issue worth checking is partial pickup under nearly full inventory: the shared fixture must conserve the uncollected remainder, not remove the entire dropped entity.

Continue through safe work after checkpointing. Do not treat these drafts or mock green counts as live readiness, and do not claim background work after a session ends.
