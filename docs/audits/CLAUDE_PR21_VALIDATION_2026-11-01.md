# Independent validation of PR #21 and Campaign D results (November 1, 2026)

Reviewed: `agents/t3-independent-manager-integration` at `5d0268f67a97dc5cd3901e6616345cf898802ec0`, merged with the registry fix `7a32605`. Offline only: no Minecraft, no real provider call, no production database, nothing merged.

**Recommendation: NO-GO for PR #21 as published, because the restart blocker and S8 are both open on it. GO for this branch as an offline integration candidate, subject to T3 taking the changes and the open owner decisions.** Nothing here shows the first real 1v1 is ready. See "What this does not show".

## Results

| Check | PR #21 `5d0268f` | This branch | New failures |
| --- | --- | --- | --- |
| T3's restart reproducer | **fails** | passes | none |
| `pnpm test` | 1757 passed, 2 skipped | 1832 passed, 2 skipped | none |
| `pnpm test:security`, new command | n/a | 341 passed | none |
| `packages/cognition` | 291 passed | 324 passed | none |
| Workspace typecheck | 0 errors | 0 errors | none |
| `pnpm lint` | 0 errors | 0 errors | none |
| `pnpm build` | pass | pass | none |

Deliberately breaking 28 properties across this work was caught by the tests every time, after strengthening the tests that first let 3 through: 14 Campaign D properties, 6 restart properties, and 8 manager properties.

## T3's five manager repairs

Reviewed by reading the diff and running T3's tests with my attacks. All five are correct, and they found real defects in my proposal:

1. Router mode no longer builds an unused global provider, which would have needed a global paid credential.
2. A decision already queued before death is discarded.
3. Disconnect and kick suspend only that citizen, and spawn resumes the same session.
4. A context error no longer strands thinking flags.
5. A provider throwing synchronously is handled like a rejection.

## Defects found and fixed

| ID | Severity | Finding | Fixed in |
| --- | --- | --- | --- |
| R1 | **High** | A same-run restart reopened a budget closed by unknown or over-bound usage. **My defect, reported by T3** | `7a32605`, #17 |
| R2 | Medium | A failed session save could break accounting mid-call | `7a32605`, #17 |
| D1 | Medium | A decision overtaken by a new threat, critical injury or solved hunger was still acted on. `isDecisionStale` existed but only unused code called it | `manager.ts`, this branch |
| D2 | Medium | In single-provider mode, a reply arriving after death still steered the respawned body. Routed mode was already protected | `manager.ts`, this branch |
| S8 | Low | A withdrawn bulletin line shifted the model's line numbers, also fixed in #19 | `manager.ts`, this branch |

**R1 details:** the closure reason is now stored in every citizen's record and restored on start. A normal shutdown is not recorded, so a run can continue after one, and an earlier run's fault does not carry into a new run. If the closure itself cannot be saved, it is lost on restart, and nothing can prevent that.

`manager.ts` changes here are **proposals for T3**, who owns that file. I did not edit T3's worktree.

## Campaign D

| Item | Result |
| --- | --- |
| 1. Offline 1v1 lifecycle and restart | Covered by T3's manager tests and the restart tests in #17 |
| 2. QA-001 harness | **Not recommended for porting.** See below |
| 3. Evidence recorder | `DecisionEvidence` in the registry: one attributed record per decision, with no prompt text, replies or credentials. T3's PR #15 adds a separate physical-outcome journal, and the two are not yet joined |
| 4. Memory isolation across reconnect, respawn and community change | `untrusted-model-output.test.ts`, through real ticks. A teammate's private memory never reaches another member |
| 5. Stale and late reasoning | D1 and D2 above. **Position is not checked**, so a citizen that has walked away can still act on a goal chosen elsewhere. The planner chooses the physical target, so this is narrower than it sounds, but it was not tested |
| 6. Untrusted model output | Shell, command, teleport, SQL, tool-call and world-fact fields reject the decision. Commands in speech go out only as `/tell` text, and selectors are neutralized. **No defect found**, through mocks only |
| 7. Configuration preflight | `preflightCitizenAssignments`, `parseCitizenAssignments`. The default outcome is "not ready, paid requests disabled". A credential value is rejected where a variable name belongs |
| 8. CI commands | `pnpm test:security`, `pnpm test:ai`. No CI workflow was added, because PR #14 owns that area |
| 9. Real-provider smoke interface | `runLiveSmoke`: one decision per citizen under a $0.25 maximum, needing an owner approval reference tied to one run, on an unused registry. **Nothing calls it with real credentials, and the reference is recorded, not authenticated** |
| 10. Failure injection | Save failure, corrupt session files, malformed closures, synchronous throws and crashes during release are covered. Broader partial-restart cases are not |

### QA-001 harness

Reviewed by reading `agents/qa-QA-001` at `f0f2787`. **It was not run**, and it contains no test files, so it has never produced a result.

Its ideas are sound: positive controls that prove the scanner can see a marker, and token scans across every citizen-reachable surface. But it has false-negative risks that would make a green result misleading:

- **It bypasses `AgentManager`.** It calls `buildCitizenContextPack`, `planCitizen` and `executePlan` itself, so it would have missed S2, which appears only when the manager assembles the prompt.
- **It predates SEC-001.** It plants memories through `createMemory` with no source event, which are now quarantined, so its controls would need rewriting.
- **Its speech model is out of date.** It uses a 24-block public-chat radius, while production uses 8-block `/tell`.

The real-manager tests in #18 and #21 already cover this ground better. If a soak harness is wanted, its deterministic clock and seeded random generator are the parts worth reusing.

## What this does not show

- **No real provider has accepted any of these requests.** Mocks follow documented shapes.
- **No live Claude transport exists.** A real Claude citizen cannot run until one is written and paid requests are approved.
- **The default orchestrator does not build a registry.** Nothing outside tests supplies `cognitionRouter`, so normal startup still uses the single provider. The assignment format exists, but it is not wired to startup or config.
- **Planner and bodies are stubbed** in these manager tests, so they do not show survival. `executor.ts` physical scoping still awaits Mission 013 review.
- **Real `/tell`, four live bodies, Paper and 60-minute behavior** are all unverified.

## Decisions for the owner

- **O2:** should a citizen keep knowledge legitimately acquired before leaving a community? I recommend yes, per the charter.
- **O4:** is implicit shared community physical state acceptable?
- **Models:** which GPT and Claude models the citizens use.
- **Paid smoke test:** when, and with what ceiling. Needed before any real 1v1.
