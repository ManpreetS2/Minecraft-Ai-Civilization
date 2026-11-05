# V1 foundation handoff

This is offline supporting infrastructure, stacked on Windows backup PR #48. It does not certify Gate A, Gate B, live survival or a public demonstration. Coordination: https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/issues/51.

## Source and ownership

- Mission worktree: `C:/Users/sh1ft/Minecraft-Ai-Civilization-v1-foundation`.
- Branch: `agents/codex-v1-integration-foundation`.
- Base: `ae784fdcd41f00be4dc09f08e75bfaf02b9156df` (#48); ancestor #37: `9945f02f38e14a7d63b3eed66279d191ad06ad3d`.
- Charter read from original `main`: `63d1b97b188fb840db05c6baf60b549c476e508f`, `project.md`.
- Existing root was clean on local `main` at `15c13c885a825deb0f83a9386f2270fb05711689`; it and all other worktrees were preserved. World/database contents were not opened. No Paper or provider was started.
- Changes are limited to `tools/`, `.codex/`, package scripts and Vitest inclusion. No protected runtime implementation was edited. Dependencies were restored with `pnpm install --offline --frozen-lockfile` (284 cached packages, zero downloads, lockfile unchanged).

## Executable entry points

Run from this worktree with Node >=22 and the existing pnpm toolchain:

```powershell
pnpm test:v1
pnpm typecheck:tools
pnpm v1:offline 2
pnpm v1:offline 4
pnpm v1:branches artifacts/v1/branch-contract.json
pnpm v1:acceptance artifacts/v1/scenario-2/acceptance-input.json artifacts/v1/reviewed-acceptance
# Explicit read-only GitHub metadata refresh; updates the owned snapshot only:
pnpm exec tsx tools/v1-integration/refresh-refs.ts
```

The offline CLI refuses a dirty tree, preflights before importing runtime code, installs the existing network guard, constructs only internal fake bodies, supplies synthetic credentials, and allocates/deletes its own temporary SQLite directory. It accepts only citizen count and an output directory contained under this worktree's `artifacts/v1`. There is no host, body factory, provider transport or database path input. Any Minecraft port is forbidden by preflight. The guard is defense in depth, not a sandbox for arbitrary code.

`v1:offline` exits zero only when its four executed offline assertions succeed. It still emits an experiment verdict of **NOT PROVEN** because the aggregate scenario is not a complete recorded experiment and has no independent validator. `v1:acceptance` exits one for incomplete/unreviewed acceptance; that expected refusal is distinct from a unit test failure.

## Delivered packages and limits

| Package | Working code | Remaining boundary |
| --- | --- | --- |
| A | `v1-acceptance/engine.ts`, catalog, CLI: SHA/repository/command/result/artifact digest/reviewer checks, separate offline/live denominator review, JSON/Markdown, gate counts | Seed catalog requires Cursor/charter review; no production ledger replacement. Hashes prove integrity, not authenticity. Operator-controlled reviewer allowlist is a trust boundary. Live claims additionally require a matching validator receipt; public duration requires public-live mode. |
| B | `scenario.ts` + `fixtures.ts`: actual manager/registry, two/four citizens, three ticks, scripted GPT/Claude requests, per-citizen prompt memory checks, empty-start observed wood deltas, bounded requests, repeated stop, SQLite reopen identity/memory | Session store persists only in memory. Integrated provider faults, respawn and process-restart session durability remain unproven. Existing component cases are indexed in `scenario-library.json`; listing them is not a pass claim. |
| C | `branches.ts`, branch CLI, published-ref refresh, ownership manifest: full refs, ancestry, parents, ahead/behind, paths/overlaps, dependency order, unknown ownership | Direct merge conflict simulation is NOT CHECKED. Shared paths indicate review risk, not compatibility. No merge/rebase/cherry-pick/reset automation. Unknown ownership defaults to no modification. |
| D | `runChestRegressions(adapter)`: executable former-owner, former-grantee and stale-stock assertions, legitimate access controls; controlled doubles prove defect detection | Real integrated adapter is BLOCKED pending construction-stack reconciliation. Controlled doubles do not fix or verify runtime. |
| E | `manifest.ts`: versioned bundle, explicit unknowns, nested field whitelist, secret-key rejection, negative evidence checks; `validator-adapter.ts` maps Antigravity Phase 1/2 report attribution and modes | Full recorder journal/action history is not fabricated from aggregate deltas. Structural checks cannot establish live authenticity and keep claimed PASS unproven. External validator implementation is not copied or run. |
| F | `preflight.ts`: exact SHA/worktree, dirty-tree record, Node version, fixed offline mode/body/provider, no Minecraft ports or database paths, canonical contained output/fixtures including symlink ancestors | Future live preflight is deliberately not authorized or implemented by this offline CLI. |

## Recorded validation

Committed historical evidence is in `evidence/f6cd7b9/`: both scenario results and command exit records with full-log digests. At source `f6cd7b9a8aaaeb9f77588c1f6a595e08f1e57da4`:

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm typecheck` | 0 | workspace and tools |
| `pnpm lint` | 0 | repository |
| `pnpm build` | 0 | workspace |
| `pnpm test` | 0 | 2,146 passed, 2 skipped, 0 failed; 187 files |
| `pnpm test:security` | 0 | 358 passed, 0 skipped/failed |
| `pnpm test:ai` | 0 | 505 passed, 0 skipped/failed |
| `pnpm v1:offline 2` / `4` | 0 / 0 | actual offline assertions, experiment NOT PROVEN |
| `pnpm v1:branches ...` | 0 | read-only report generated; compatibility NOT PROVEN |

Final-candidate checks are recorded separately under ignored `artifacts/v1/validation/final-*.json` and `.txt`, with actual source SHA, exit code and tree status. The draft PR records final results. Historical evidence must not be reused against the final head; the acceptance engine rejects different SHAs. No independent development-branch pass was counted toward this candidate. No checks required paid access or production data.

The seed catalog declares **30 offline-applicable** and **37 live-applicable** requirements. Accepted evidence is **0/30 offline**, **0/37 live**, and **0/2 gates**. Both denominators remain unreviewed: **NOT MEASURABLE**. Four executed fixture assertions await independent review; their pending evidence does not increase accepted progress. These counts are not Cursor's separately owned ledger denominator.

## Cursor integration order and P0 handoffs

1. Review/scopingly integrate this tooling after the #37 → #48 provider/runtime base. Resolve shared `package.json`/Vitest configuration deliberately. Do not transplant the broad original stack merely to run tools.
2. Independently review #48's lower `createBody` boundary. Its root accepts arbitrary callbacks; our regression demonstrates invocation without network, while our public tooling wrapper rejects that input. The root is **not** an arbitrary-code sandbox. Source owners: Claude 2 / Cursor; independent QA required.
3. Reconcile original #12 → #13 → #14 with CODEX 1/Cursor. Supply a real `ChestRegressionAdapter` using the integrated store/executor. Reproduce PR #50 at `f443bb386c1adfc5ce6f9d7c3d69de14c3a58aa1`, `packages/agent-core/src/independent-qa-chest-contents.test.ts`. Revoke implicit stale membership/ownership; preserve legitimate grants and historical data. Failed ITEM_NOT_FOUND/VERIFY_FAILED withdrawals must not leave the observed item as current positive stock. Do not erase unrelated item observations. Explicit future cross-community grants require separate policy review.
4. Provider retry #32/#42 needs nonauthor review. Movement #25 and construction guard work need CODEX 1.2 ownership handoff. Antigravity #43/#47 needs owner scoping/adapter review; Phase 2's broad base comparison is not compatibility proof.
5. Add integrated provider timeout/cancellation, pending shutdown/no post-close writes, respawn and durable session restart scenarios. Extend the existing runner rather than another engine. Rerun security/AI/physical tests on one candidate.

The three chest defects remain P0 pending integrated reproduction/correction. No live gate is closed. The next assignment should wire the chest adapter and expand fault/restart scenarios on Cursor's reconciled candidate.

## Development model allocation

Parent harness reports GPT-6.1 Sol Low. Native spawn requests explicitly selected Luna Low (read-only scout), Sol Low (bounded architecture and one trust-boundary review), and Terra Low (builder, most scenario/acceptance implementation). At most three children were open; no higher model/effort was requested. Native tools accepted these settings but expose no independent resolved-model telemetry, so routing enforcement is **not independently verified**. Project custom-agent files use the documented standalone schema; defaults are Luna Low and concurrency three. Codex CLI 0.161.0 loaded the project configuration without an error via `codex features list`. No existing global config existed at the inspected user path; no unrelated settings were overwritten.
