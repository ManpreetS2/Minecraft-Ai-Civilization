# OFF-13 / OFF-14 compatible integration handoff

## Source and ownership

- Integrated base: `875ebf707b93a082a6423c9a3aecc7d00ae02e48` (PR #56).
- Code patch: `b7842be4ec4d8057d5441f8ccd47c22b04f76830`.
- Movement source: PR #25, `bdfba7473d79487ffdcf467592e1f2328efabc4c`; comparison base `652fc605f1284b63e1b2e9ec963dcfc876bd958d`.
- Guard source: PR #14, `7cb4bf4725d8f944fe8fce4a979b4379fd28046b`.
- Independent QA assertions: PR #39, `991634be7fa4ead2dd5a050a82c40aaabb110f7a`.
- Worktree: `Minecraft-Ai-Civilization-off13-off14`; branch `agents/codex-off13-off14-integration`.

The user assigned CODEX 1.2 movement/guard ownership for this mission. **CODEX 1.2 explicitly authorizes Cursor to integrate this named patch and its handoff follow-up onto PR #56 after review.** This authorizes the scoped offline integration, not a protected merge or live launch. Preserve the current candidate's later changes if its head advances; do not merge the divergent historical PR histories.

## Reconciliation

Movement changes are the 22 changed adapter files from the published movement stack. Comparing the old movement base with the integrated candidate showed only the candidate's additional `VALID_USERNAME` export under adapter source. That export remains intact. The patch covers physical arrival/reach checks, home arrival, follow target validity, cancellation, finite coordinates, pathfinder readiness, death/despawn/reconnect lifecycle, retired callbacks, movement packet/client changes and whole-action deadlines across recovery phases.

The guard patch transfers only `construction-experiment-guard.ts`, its path-isolation regression expansion and live-boundary tests. The candidate already contained the same basic guard tests. It requires loopback IP literals, strict and separated non-production ports, protected world/database-directory isolation, ancestor identity checks, descendant symlink/hardlink checks and failure-closed read-only database handoff validation. No world or database is opened for mutation by these checks.

`off13-qa39-regressions.test.ts` preserves QA #39 assertions, changing the three historical `it.fails` cases to ordinary tests: remote host, shared Paper/RCON port and evidence beside the protected database must all be refused. Its source attribution remains explicit; this owner-run replay does not constitute a new independent review.

No manager, executor, provider, SQLite runtime or evidence-journal implementation was replaced. No transitive runtime branch is required beyond the named candidate base. Existing candidate aliases, network test guard and tooling inclusion remain intact. The native CI workflow is carried forward with the combined focused tests; its bounded CI timeouts are supplied as CLI options rather than replacing the candidate's Vitest configuration.

## Evidence and limits

See `evidence/off13-off14/results.json` and companion captured logs. Windows x64, Node 22.17.1, pnpm 10.13.1. Tests used controlled bodies, disposable paths and the existing offline harness; no Paper or paid inference.

The full suite includes the integrated scripted 1v1, four-citizen normal-manager startup, private-memory restart scenarios and evidence-journal tests. These pass with the changed movement adapter available, but simulated scenario bodies do not establish live Mineflayer travel or construction. Focused adapter tests establish the actual adapter contracts against controlled bot/pathfinder fixtures. Never infer arrival merely from a resolved pathfinder promise.

Native guard CI succeeded on Windows, Ubuntu and macOS at historical guard SHA `7cb4bf4725d8f944fe8fce4a979b4379fd28046b`: https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/actions/runs/41347400404 . The earlier macOS case-alias failure was corrected in `4c7556c`; it is included in this guard source. These historical results are not combined-candidate native evidence. The new PR workflow must establish that separately.

Two existing Windows skips in `ops-body-lock.test.ts` require POSIX execution. The QA #39 Windows 8.3 control returns without exercising an alias when the volume disables short names; its passing result must not be presented as proof that an 8.3 alias existed. Filesystem inspection is bounded and cannot eliminate hostile mutation races or provide OS containment. The verified database descriptor is read-only and single-use, not an atomic writable SQLite/Paper startup boundary. Executable JavaScript callbacks remain trusted code, not sandboxed code.

## Cursor / independent QA instructions

1. Review the 27-file code patch and small evidence/CI follow-up against the exact base. Apply those commits, not the historical branch merges. If the candidate changed, recheck overlaps before applying.
2. Independently replay the focused command and inspect all three QA #39 closure assertions. Review alias, symlink, hardlink, sidecar and read-only handoff failures without weakening them.
3. Confirm combined native Linux/macOS/Windows workflow results and the two POSIX controls. Investigate any native failure before accepting the corresponding platform claim.
4. Rerun affected single-source offline/security/provider suites after combination if any runtime changes intervene. Keep evidence tied to that final integration SHA.
5. Cursor owns ledger updates. OFF-13 and OFF-14 are **implementation-ready with passing Windows offline evidence**, pending independent patch acceptance and combined native evidence; this handoff does not silently turn either ledger row into an independently accepted PASS.

Remaining blockers: independent guard-child review and combined native verification. Live physical performance remains unproven. There are no known failing local focused or workspace checks at this handoff.
