# Combined offline civilization candidate

Executable integration source: `6aa953ddef3ffa7b7ef28a9f16eeb256d19727d4`. Rehearsals ran from that clean, committed revision. The publication follow-up adds documentation and recorded evidence only; its PR head must not be substituted for the source SHA embedded in these historical artifacts.

Base: PR #65 at `564d69c6ced1a7cf04fe074e25abafa0fd1d4554`, including PR #61 at `1d7170741bdebe04e1c7c59eb210c0a357d5b0ea`. PR #61's action-time recorder and chest revision checks remain intact. PR #65's construction completion, ownership and cancellation fixes remain intact. No main/protected branch merge, YC runner production code, live Paper or paid inference was used.

## Integration and provenance

The integration uses compatible code patches rather than divergent historical ancestry:

- PR #67 `2baaf8a49806ae01d3bcc3e1c481b8479ccf77ed` → `36cf445279083d2e2402b8f481acacdbece925aa`.
- PR #58's validator code `33d42758932011bf4b8a0c954835fe4c4792713a` (published as `5da9135`) → `fdc8081502116c91d78771a0a32b3441c01825e9`; CLI/handoff `cf639d16e5e85c03038e735563ca29510b9ee280` → `c28c54fc2e5c99b6aea72a816fcd4913e45a2ebf`.
- PR #57 `b7842be4ec4d8057d5441f8ccd47c22b04f76830` → `c782d762555a7719b7e998b9eeda6d386b6c7cc9`; handoff `41cd73e76ce52c4278e6a8530e041474b7afe12b` → `a5b43f203c572f8eea0c65188470dfda60216dce`.
- PR #64 `b43472b` → `94f4d2d7a8e860494e6f6d7ca31fceeeeafbbecb`; `5a95e892524814f7454553023302f5f4e4f63eb6` → `97dfa1de00ffa54c01bd1dfe3db2e71dc24c3c0e`.
- PR #60 `222c3c86ad9c813d5f649ce97b3122db5544ea99`: its QA directory copied unchanged in `8a0a256afbd8a697896528294bc7ec4d415ba79a`.
- Integration adapters and new combined-recorder regression tests: `4fd9ef2f98d9c94eadd6514a9993f3d74ff03ff6`.

The test-only follow-up `6aa953ddef3ffa7b7ef28a9f16eeb256d19727d4` gives the new scenario tests a bounded 60-second lifecycle timeout, matching the tooling runner; all assertions remain intact. The initial workspace run exposed the root runner's default five-second timeout (two new-test timeouts, 2525 passing and one platform skip). That diagnostic is preserved separately from final validation.

`docs/evidence/offline-integration/ancestry.json` records full source commit IDs and the complete candidate parent history. Independently authored construction QA from PR #63 (already carried in #65), provider QA from #60, movement/guard QA carried in #64, and QA #39 assertions carried in #57 are preserved. Their prior reports describe earlier sources; only new runs in this report count as combined-candidate evidence. Implementation-author tests from #58/#67 are regression evidence, not a new independent approval.

## Reconciliation

Git applied the CLI hunks without conflict markers, but `tools/v1-integration/cli.ts` was manually reviewed and reconciled. The #61 action-time begin/finish hook remains; the old aggregate recorder was not restored. The CLI keeps three independent attempts per citizen, first observed starting positions and honest `restarted: false` for an in-process SQLite reopen. It now invokes original-journal checking and prints JOURNAL CONSISTENT separately from authenticity.

The first combined 1v1 run at `8a0a256afbd8a697896528294bc7ec4d415ba79a` failed journal validation (exit 1), exposing interface differences. The final adapter reads the original writer's rows and copies their actual attempt/observation sequence numbers into receipts, including observed hunger, world changes and target fields. Missing or duplicate original rows throw; no IDs are generated from action order. Actions retain their original manager event IDs, also present as `decisionEventId` on original attempts. The validator accepts that explicit binding as well as the historical observation-event/hash binding. Action ordinal is sorted by original attempt sequence.

Some recordings intentionally distinguish experiment ID from run ID. An optional explicit expected experiment ID in the operator descriptor/CLI now handles this while retaining default run-ID matching and all foreign-run rejection tests. It is not inferred from potentially modified receipt metadata. The CLI records decisionSource additively, preserving planner/reflex provenance and marking scripted model decisions as scripted. Unknown source evidence stays missing.

The selected original still has a complete verified hash chain. Rehashable artifacts and caller descriptors provide local consistency, not an external trust anchor.

## Rehearsals and CLI

```sh
pnpm v1:offline 2 artifacts/v1/integration-final-1v1
pnpm v1:offline 4 artifacts/v1/integration-final-2v2
pnpm v1:journal artifacts/v1/integration-final-1v1/manifest.json 6aa953ddef3ffa7b7ef28a9f16eeb256d19727d4 ManpreetS2/Minecraft-Ai-Civilization-windows-backup artifacts/v1/integration-final-1v1 operator.jsonl off2
pnpm v1:journal artifacts/v1/integration-final-2v2/manifest.json 6aa953ddef3ffa7b7ef28a9f16eeb256d19727d4 ManpreetS2/Minecraft-Ai-Civilization-windows-backup artifacts/v1/integration-final-2v2 operator.jsonl off4
```

Both scenario commands exit 0. 1v1: six actions, six attempts, six observations, 18 journal rows. 2v2: twelve actions, twelve attempts, twelve observations, 30 rows. The decision sources are four scripted/two planner continuations for 1v1 and eight scripted/four planner continuations for 2v2; there are no genuine model decisions. Each gather has planned and observed delta `{oak_log: 1}`. Each receipt uses its actual original row IDs. Private memory/session checks pass. Both reports verify all actions and the full chain, report no violations, and remain NOT_PROVEN for authenticity/duration. Both journal CLI checks exit 0 with `status: JOURNAL CONSISTENT`, `verdict: NOT PROVEN`, `authenticatedLiveExecution: false`. Missing root or journal exits 2. Rehashed forged 30-log claims and wrong source SHA exit 1. `docs/evidence/offline-integration/artifact-audit.json` contains exact commands/results; saved scenario directories contain the original complete artifacts.

A zero journal CLI exit means local consistency only, never live acceptance. Older V1 bundles/receipts remain readable; missing journal references remain NOT PROVEN. The optional final experiment-ID argument is required only when the recording's experiment ID differs from its expected run ID.

## Limits and handoffs

Cursor's late-action skill cancellation/late-mutation work is a separate dependency. This integration does not rewrite those Cursor-owned skill implementations or claim that work is complete. Passing controlled tests cannot prove every shutdown race. No YC runner research was promoted into runtime code.

Remaining unproven evidence includes genuine Paper activity/signing authority, real server ticks and 60-minute duration, full process/playerdata restart, tool durability, and missing live server/site/personality metadata. Validator gaps stay explicit rather than being filled with synthetic success. Hostile JavaScript is not sandboxed; filesystem checks are not OS containment. Native Windows/Linux/macOS combined guard acceptance still requires its own CI/independent process.

A different reviewer must rerun the construction, movement/guard, provider, journal-forgery and integration suites on the final integrated source SHA. This PR is a coherent offline candidate, not an official OFFLINE_PASS or acceptance-ledger upgrade. Historical copied reports are not transferred acceptance. See the check table and raw command logs for actual candidate results.


## Final command results

All commands below ran against `6aa953ddef3ffa7b7ef28a9f16eeb256d19727d4`. Node v22.12.0, pnpm 10.16.0, macOS x64. Exact arguments, exits and raw logs are under `docs/evidence/offline-integration/`. The clean git status captured there is empty. The completed workspace retry supersedes an interrupted validation attempt (exit 143), retained under `development/`; it is not counted as a passing test run.

| Check | Passed | Failed | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: |
| pnpm test | 2527 | 0 | 1 | 0 |
| pnpm test:security | 358 | 0 | 0 | 0 |
| pnpm test:ai | 514 | 0 | 0 | 0 |
| pnpm test:v1 (includes 27 journal forgery/compatibility regressions and two combined recorder cases) | 129 | 0 | 0 | 0 |
| pnpm test:evidence-validator | 161 | 0 | 0 | 0 |
| Construction QA #63/#65 | 12 | 0 | 0 | 0 |
| Movement/guard QA #64 | 204 | 0 | 0 | 0 |
| Provider QA #60 | 10 | 0 | 0 | 0 |

Typecheck, tools typecheck, validator typecheck, lint and build all exit 0. The only skipped test is the Windows-only 8.3 short-path case in off13-qa39-regressions.test.ts; this macOS run establishes no Windows short-name result. There are no remaining failures in the executed final checks. Tests overlap across commands; their counts must not be added as unique coverage.
