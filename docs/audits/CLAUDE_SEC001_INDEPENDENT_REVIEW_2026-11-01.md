# Independent SEC-001 security review (November 1, 2026)

**Recommendation for `2be4f4a`: CHANGES REQUIRED.** One high-severity leak was reproduced through the real manager. With the corrections on this branch, every tested attack is blocked offline. That is not acceptance of the combined tree: criterion 6 stays open until the corrections are replayed on T3's reconciled branch.

| Item | Value |
| --- | --- |
| Reviewed source | `agents/t3-sec001-integration-QA` at `2be4f4aa7ac13495c4c9c166f366faa803fe4c24` |
| Corrections branch | `agents/claude-sec001-independent-review` |
| Environment | Windows 11, Node 22.17.1, pnpm 10.13.1, `pnpm install --frozen-lockfile` |
| Data | In-memory or disposable SQLite only |
| Not done | No Minecraft, no paid or real provider call, no production database, no merge |
| Not evidence of | Live behavior. The body, provider and physical planner are stubbed |

## Acceptance matrix

| # | Criterion | At `2be4f4a` | With corrections | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Unauthorized settlement events are blocked | **Fail** for later joiners and returning members | Pass offline | Real manager ticks, inspected through `formatPrompt` |
| 2 | Same-community announcements work on a production path | Pass offline | Pass offline | `sec001-manager.test.ts`, plus a positive joiner test |
| 3 | A legitimate cross-community share path exists | Pass offline | Pass offline | `sec001-manager.test.ts`. Live `/tell` is unverified |
| 4 | Unauthorized events cannot be acknowledged or stored | **Fail** for later joiners: delivered, then stored with a valid proof | Pass offline | Delivery, fact and proof-table assertions |
| 5 | Contaminated facts cannot re-enter cognition | Pass offline, except proofs from S1 | Pass offline | Copy, import, tamper and restart attacks |
| 6 | Codex tests pass on the real integration | Pass on the source branch only | Pass on this branch only. **Not met on the combined tree** | PR #5 still conflicts |
| 7 | Independent QA of the full change | This review | Must repeat on the reconciled branch | Campaign C |

## Findings fixed on this branch

| ID | Severity | Finding | Affected files |
| --- | --- | --- | --- |
| S1 | **High** | Retroactive access through community membership | `knowledge-provenance.ts`, `citizen-context.ts` |
| S2 | Medium | Persistent facts and heard claims never reached the model | `cognition/src/ollama.ts` |
| S3 | Medium | Reported speech could carry control and format characters into prompts | `shared/src/bulletin.ts`, `cognition/src/ollama.ts` |
| S4 | Medium | `review()` accepted any nonempty string as authorization | `knowledge-provenance.ts`, new `knowledge-release-grant.ts` |
| S5 | Medium | Any web page could read private state and control citizens through the dashboard | `apps/orchestrator/src/http-server.ts` |
| S6 | Low | A failed review quarantined a healthy record | `knowledge-provenance.ts` |
| S7 | Low | An out-of-order membership history crashed memory and fact writes | `knowledge-provenance.ts` |

### S1: Retroactive access through community membership

Authorization checked membership now and at acquisition, never when the event happened.

To reproduce at `2be4f4a`:

1. Citizen `cal` announces to community `south`.
2. Citizen `dee` joins `south` afterwards.
3. On `dee`'s next tick the announcement is in the model's bulletin, marked delivered, and stored as a persistent fact with a valid provenance proof.

The same applies to a member who leaves and returns: what was said during the absence is delivered on return.

T3's test `a current teammate grant cannot authenticate a memory acquired before joining` encoded this as correct: an event in January, a join in March, and an April memory expected to be usable. That assertion was corrected. Its positive case now uses an event from after the join.

**Fix:** a community audience now covers who belonged when the event happened. This is checked at delivery, when a proof is created and on every read, so proofs already stamped by the old code stop working.

**Limit:** only community audiences are checked this way. World audiences are public by definition, and the one production world event is `SimulationStarted`.

### S2: Persistent facts and heard claims never reached the model

`formatPrompt` keeps the first 5 memories, and the manager lists human suggestions, then 5 retrieved memories, then persistent facts. Once a citizen had 5 relevant memories, every fact and heard claim was silently dropped. Each human suggestion displaced a memory too. T3's tests read `persistentFactsForCognition` and missed this because the loss happens one step later.

**Fix:** the prompt keeps 16 entries, enough for 5 memories, 8 facts and 3 suggestions. Prompts get larger, and the budget's byte-based bound on the cloud branch accounts for that.

### S3: Control and format characters in reported speech

Only `\r \n \t \f \v U+2028 U+2029` were stripped. NEL, the C0 separators, ESC, NUL, bidi overrides and isolates, and zero-width characters all reached the prompt. Bidi overrides can make text display differently from what the model reads, and NEL is a line break in some text handling.

**Fix:** all Unicode `Cc`, `Cf`, `Zl` and `Zp` characters become a space, in the bulletin and in every memory entry in the prompt.

### S4: `KnowledgeProvenance.review()` authorization

Evidence was always required, so a forged string could not release an unprovable record. The authorization itself proved nothing, though.

| Question | At `2be4f4a` | With corrections |
| --- | --- | --- |
| 1. Reachable from a citizen or model action? | **No.** No production caller, tool or HTTP route. A test now enforces this | Same |
| 2. Can an untrusted caller construct its authority? | Yes, it is a plain object with a literal actor | Needs the signing key |
| 3. What stops arbitrary strings? | Nothing | HMAC-SHA256 grant |
| 4. Is the operator independently authenticated? | No | Possession of the key only. Not a person's identity |
| 5. Does it apply to that exact citizen, record and source? | No | Yes, all are bound into the signature |
| 6. Can a reference be replayed? | Yes, unlimited | No, each reference releases once |
| 7. Are releases and refusals audited? | Releases and evidence failures yes. Invalid authority threw with **no audit** | All audited, without the key |
| 8. Can a direct import bypass review? | No: a raw row stays quarantined, and clearing a flag directly does not help | Same, now tested |
| 9. Safe under crash and concurrent writers? | Crash yes. Lock taken late, on first write | `IMMEDIATE`, tested with a simulated crash and a held write lock |

Severity is Medium, not High, because it is not reachable from a model and evidence is still required.

**Trust boundary:** code inside this process could read the key, so it is trusted by definition. Whoever can write SQLite directly can forge proof rows too. Hashes detect partial or accidental changes, not that attacker.

### S5: Dashboard cross-origin access

Beyond T3's scope, but found while auditing the observer surface. The server sent `access-control-allow-origin: *` and had no origin checks. Any web page open on the operator's machine could read `/api/snapshot`, which includes citizens' memories, and POST to `/api/directives` or `/api/citizens/:id/stop`. `HUMAN_DIRECTIVES_ENABLED` defaults to true, so a page could cause an unlogged-by-design intervention during a timed run. The WebSocket had the same exposure.

**Fix:** the dashboard is same-origin, so cross-origin browser requests to `/api/` and `/ws` are now refused. Non-browser tools still work. The WebSocket check has no direct test: only its shared origin function is tested.

**Not changed:** the API still has no authentication against other local processes.

### S6 and S7

- **S6:** `review()` flagged the record on any evidence failure, so an operator's typo in a source ID quarantined a healthy record. A refusal no longer changes a record that is still eligible.
- **S7:** `originalDirectory` threw `citizen is in two communities` when audit timestamps were out of order, failing the whole write. It now replays the history in time order and always yields one community per citizen.

## Open findings, not fixed here

Each is pinned by a test named `OPEN O…` that should be replaced when the decision is made.

| ID | Severity | Finding | Needs |
| --- | --- | --- | --- |
| O1 | **High for the 2v2 goal** | `sitesKnownTo` gives a citizen's planner every site its teammates discovered, with no communication. The charter rules out an omniscient team view and says team membership grants no access to private knowledge. It affects physical planning and does not appear in the prompt | T3, as part of per-community state: limit to the citizen's own discoveries and sites learned through speech |
| O2 | Medium | Leaving a community hides knowledge acquired legitimately while a member. The charter says changing affiliation does not erase memory, while the campaign lists retained access after leaving as an attack | **Owner decision**, see below |
| O3 | Medium | A bulletin line is marked delivered before the model answers. If the call fails or the provider refuses it, a line below urgency 70 is never seen, because only urgency 70 and above becomes a fact | Reliability fix by the manager owner |

**Owner decision for O2:** I recommend keeping knowledge legitimately acquired at the time, because it matches the charter's rule and S1 now blocks retroactive access. Under that rule, a leaver keeps what it heard while a member but receives nothing new. The current behavior stays in place until you decide.

## Attack coverage

Tests asserted on the text `formatPrompt` renders, unless noted.

| Scenario | Result at `2be4f4a` | Where |
| --- | --- | --- |
| Rival event marked visible | Blocked | Independent review |
| Forged ID with substituted text or actor | Blocked | T3 boundaries, helper level only. The manager never passes caller events |
| Stale permissions after leaving | Blocked | Independent review, `sec001-manager` |
| Joining after an event | **Leak** (S1) | Independent review |
| Leaving and rejoining | **Leak** (S1) | Independent review |
| Quarantined fact under a new key, or copied to memory | Blocked | Independent review |
| Contaminated imports after the marker, repeated restarts | Blocked and idempotent | Independent review |
| Hiding knowledge with retrieval limits | Store blocked by T3. **Prompt lost it** (S2) | Independent review, T3 boundaries |
| Untraceable paraphrase | Blocked | Independent review, `knowledge-provenance` |
| Fake provenance citing an unrelated event | Blocked | Independent review |
| Tampered source bytes | Blocked | Independent review |
| Concurrent SQLite reads and WAL updates | Blocked | T3 boundaries, Codex durability |
| Interrupted backups and migrations | Rolled back | `knowledge-provenance`, Codex recovery |
| Incorrect speech attribution | Blocked | Independent review, `sec001-manager` |
| Directed messages reaching nonparticipants | Blocked | Independent review |
| Server-wide chat | Not used by the manager | Independent review. `atlas-cli.ts` is a separate human tool |
| Prompt injection in speech | Labelled unverified | Independent review |
| Newline and control-character spoofing | Forged lines blocked; **other characters leaked** (S3) | Independent review |
| Unknown or malformed visibility classes | Blocked, 11 variants | Independent review |
| Observer-only events and private reasoning | Blocked | Independent review |
| Provider family used as authorization | Not used | Source scan of the authorization files |

**Behavior worth knowing:** speech is free text, so a citizen can retell what it learned, and that reaches listeners attributed and marked unverified. This is legitimate under the charter and is not treated as a leak.

## Test results

| Check | `2be4f4a` | Corrections | New failures |
| --- | --- | --- | --- |
| Focused privacy suite | 220 passed | 298 passed | none |
| `pnpm test` tests | 1 failed, 1091 passed | 1 failed, 1169 passed | none |
| `pnpm test` files | 1 failed, 130 passed | 1 failed, 132 passed | none |
| `pnpm -r --no-bail typecheck` | 10 errors | identical 10 | none |
| `pnpm lint` | 15 errors | identical 15 | none |

The one test failure is `agent-core/src/blueprint.test.ts`, `materials.crafting_table` undefined, the known baseline. Nothing was skipped or marked as an expected failure.

- **Red before the fix:** after correcting two bugs in my own fixtures, the first exploit run had 17 of 48 tests failing against unmodified code.
- **Can the tests fail?** 15 security properties were broken one at a time. The first run caught only 9, which exposed weak tests. After strengthening them, all 15 were caught. The dashboard check was tested separately and was not part of this run.

### Changes to existing tests

No security assertion was weakened.

- **Fixtures:** events were dated October 31 while membership was seeded at the current time, which S1 now correctly refuses. Six fixtures now seed membership on January 1 through a new optional `at` argument on `applyCommunityConfig`. Their assertions are unchanged.
- **Fake store:** the PRIV-005 fake gained a permissive `wasInAudienceAtEvent`, because it has no membership history. Timing is tested on the real store.
- **`knowledge-provenance.test.ts`:** review calls now use signed grants. One assertion changed from "throws" to "refused and audited", and the join test was corrected as described in S1.

## Remaining risks

- **Combined tree:** none of this has run on the cloud-reconciled branch. These commits touch `citizen-context.ts`, `knowledge-provenance.ts`, `ollama.ts` and `bulletin.ts`, and T3 must carry them over.
- **Legacy databases:** community knowledge needs audited membership from before the event. Rows without that history stay quarantined, which is the approved policy but may hide more than expected.
- **Clock dependence:** event-time checks trust stored timestamps, including `community_audit.at`. A large clock change during a run could misjudge membership, failing closed or open depending on direction.
- **Other local processes** can still use the dashboard API, and an operator exposing `DASHBOARD_HOST` beyond loopback is exposing it to the network.
- **Key management:** there is no operator signing tool, rotation or revocation yet, so `review()` cannot be used in practice until a tool exists.
- **Not exercised:** real `/tell` delivery, real model behavior under prompt injection, and four live bodies.

## Next action

T3 ports the seven fixes to the reconciled branch, or merges this branch into it. Then run the commands below on that exact revision. Claude then repeats this review on it as Campaign C.

```bash
pnpm exec vitest run sec001 knowledge-provenance downstream-prompt-isolation persistent-fact-provenance citizen-context-2v2 bulletin-2v2 visibility-2v2 http-server-origin
pnpm test
pnpm -r --no-bail --if-present typecheck
pnpm lint
```

## Combined-tree replay of PR #7 (`7c039ec`)

**Recommendation for `7c039ec` as published: NO-GO.** With the corrections applied it has no new failures, so it can become a merge candidate after the conditions below.

S1, S2 and S3 reproduce on `7c039ec`, which still passes T3's 220 security tests. S4 to S7 are unchanged because that code was merged unchanged. The corrections cherry-picked with no conflicts.

| Check | `7c039ec` | With corrections | New failures |
| --- | --- | --- | --- |
| `pnpm test` tests | 1 failed, 1491 passed, 2 skipped | 1 failed, 1569 passed, 2 skipped | none |
| `pnpm test` files | 1 failed, 156 passed | 1 failed, 158 passed | none |
| Workspace typecheck | 10 errors | identical 10 | none |
| `pnpm lint` | 15 errors | identical 15 | none |

**Integration inspection of `fafc93d..7c039ec`:**

- **Cost controls preserved:** admission bound, retry charging, unknown-usage holds, redirect refusal and endpoint restrictions are all present.
- **Strict schema:** `required` matches `properties` at both levels, including the nested nullable `communication` object. Null fields are removed before validation, so null reaches neither attribution nor audience.
- **New producers:** the only production writers of memories and facts are still `manager.ts` and `citizen-context.ts`, both with source references.
- **Direct provider calls:** the manager has one call site, `this.cognition.decide`, fed by the gated store reads. It cannot bypass provenance, but it is also one shared provider, which Campaign B addresses.
- **Fallback:** the prompt given to the fallback is the same citizen's own prompt, so it cannot leak across citizens, and only heuristic or loopback Ollama are constructible.

**New risk from the combined schema:** the reply can now hold a reason plus up to 200 characters of speech, inside the default `CLOUD_MAX_OUTPUT_TOKENS` of 128. A long reply would be cut off, producing invalid JSON. That is charged and fails safely, but loses the decision. This was not measured, because no real model ran.

**Conditions before merge:** T3 takes these corrections, O1 is resolved or explicitly deferred, the owner decides O2, and this replay is repeated on the final revision.
