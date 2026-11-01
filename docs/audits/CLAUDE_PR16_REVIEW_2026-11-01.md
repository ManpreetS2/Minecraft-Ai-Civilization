# Independent review of PR #16 (November 1, 2026)

Reviewed: `agents/t3-reviewed-security-integration` at `e85d7f9f0ae393fdd80d8460178d31f3261cfebe`. Offline only: no Minecraft, no real provider call, no production database, nothing merged.

**Recommendation: GO for the security integration once the one correction here is taken and the two owner decisions below are made.** This is not a statement about 1v1 or 2v2 readiness. Neither has run.

## Acceptance matrix

| # | Criterion | Result on `e85d7f9` plus this correction | Evidence |
| --- | --- | --- | --- |
| 1 | Unauthorized settlement events are blocked | Pass offline | Real manager ticks |
| 2 | Same-community announcements work on a production path | Pass offline | `sec001-manager` |
| 3 | A legitimate cross-community share path exists | Pass offline, after S8 below | `sec001-manager`, `pr16-review` |
| 4 | Unauthorized events cannot be acknowledged or stored | Pass offline, including across deferred acknowledgement | `pr16-review` |
| 5 | Contaminated facts cannot re-enter cognition | Pass offline | Independent review suite |
| 6 | Codex tests pass on the real integration | Pass on this revision | All 299 security tests below |
| 7 | Independent QA of the full change | This review | **Live behavior is still unverified** |

## What I checked

- **My corrections survived.** `knowledge-provenance.ts`, `knowledge-release-grant.ts`, `community-config.ts`, `bulletin.ts`, `ollama.ts` and `http-server.ts` are byte-identical to `1f8e286`.
- **No assertion was weakened.** T3's only edits to my attack suite turn the `OPEN O1` and `OPEN O3` characterizations into secure assertions, which is what those tests asked for.
- **O1 fix:** a citizen's planner now gets only its own discovered sites. Attacks confirm that community membership alone grants nothing.
- **O3 fix:** provider refusal or invalid output leaves lines undelivered for retry, and success acknowledges once. Rival lines stay hidden across retries.
- **Strict schema and cloud controls:** the cognition suite passes, with 204 tests.

## New finding, fixed here

**S8, low severity: wrong bulletin line after a withdrawal** (`manager.ts`).

T3's O3 fix stored the list returned by `acknowledge()` as the model's line numbers. That list leaves out any line withdrawn while the model was thinking, so later lines shift down.

To reproduce on `e85d7f9`:

1. A citizen is shown `#1` a community line and `#2` a private line.
2. It moves to another community while the model is thinking, so `#1` can no longer be acknowledged.
3. If the model shares line 1, the share goes out citing the event from line 2, with false `sharedFromEventId` provenance.
4. If it shares line 2, the valid request is refused with `UNKNOWN_BULLETIN_LINE`.

Nothing unauthorized leaks, because the citizen could read the wrong event anyway and the words are its own. The harm is false provenance and a refused valid share.

**Fix:** keep the list as shown for numbering. The share path then re-authorizes the named event, so a withdrawn line is refused.

## Decisions for the owner

- **O2, what a leaver keeps.** Leaving a community hides knowledge legitimately acquired while a member. The charter says changing affiliation does not erase memory. I recommend keeping what was legitimately acquired, now that retroactive access is blocked.
- **O4, new: shared community state.** `scopeSettlementForCitizen` gives every member the community's physical state, including stocks and workstations, however it was learned. T3 removed implicit sharing for discovered sites, but this is the same kind of knowledge. It may be acceptable as what a settlement shares by living together, but the charter's "no omniscient default team bulletin" makes that your call. Offline tests do not settle it.

## Test results

| Check | `e85d7f9` | With correction | New failures |
| --- | --- | --- | --- |
| Security selection | 299 passed | 304 passed | none |
| `packages/cognition` | 204 passed | not rerun, no cognition change | none |
| `pnpm test` | 1652 passed, 2 skipped, 0 failed | 1657 passed, 2 skipped, 0 failed | none |
| Workspace typecheck | 0 errors | 0 errors | none |
| `pnpm lint` | 0 errors | 0 errors | none |

## Remaining risks

- **`read()` takes a write lock.** `CitizenPhysicalState.read` uses an `IMMEDIATE` transaction on every tick. Read paths will contend with writers, which was not measured.
- **Live paths are unverified.** Real `/tell` delivery, real model behavior under prompt injection and four live bodies have not been exercised.
- **Executor scope.** T3 reports that physical execution still awaits Mission 013 review, so offline planner scoping does not prove the executor is scoped.
- **Key tooling.** `review()` has no operator signing tool, rotation or revocation yet.
- **Clock dependence.** Event-time checks trust stored timestamps.
