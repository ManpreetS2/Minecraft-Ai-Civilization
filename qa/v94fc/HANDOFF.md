# Validator forward-compatibility: implementation handoff (QA-only; I do not implement the repair)

| | |
|---|---|
| Author | Claude Sonnet 5.5 (independent QA) |
| Accepted baseline | PR #94 `da0e1ff9e7e84647467ac335a7ded698f5f8fdc3` (accepted for **offline** verification in PR #101, `ec87edd5`) |
| Findings addressed | **QA94-M1** adapter strips genuinely signed extra fields, so complete-row binding flags valid rows; **QA94-L1** malformed signed raw rows are accepted on the library path; **QA94-L2** malformed signed values crash the validator |
| Deliverable | Reproduction and **acceptance** tests in `qa/v94fc/test/` (red on PR #94 today), the minimal safe rules below, and the order of work |

## 1. The three problems, as one design error

PR #94 made the **raw signed lines** authoritative (`journalRows = rawParsed`) and compares the caller's parsed rows to them with a canonical, whole-row equality. That closed the QA86 bypasses and must not be weakened. But two things were left as they were:

1. The shipped adapter (`adaptRecorderJournal`) builds parsed rows by **projecting onto a per-kind allow-list** and passing them through the strict zod schema. Any extra field in a raw row therefore makes `parsed != raw` (QA94-M1), although both copies are covered by the same signature.
2. Nothing runs the validator's own strict schema over the **raw** rows that now drive every decision. On the adapter path the schema ran on the parsed copy; on the library path (parsed == raw) it runs nowhere (QA94-L1), and untyped values reach code that assumes types and throws (QA94-L2).

## 2. Minimal safe rules

**Rule A. One projection, shared.** Export a single `projectKnownFields(kind, rawRow)` from the schema module (the exact allow-list the adapter uses today) and make the adapter call it. Do not keep two copies: drift between them is how this regressed. Prefer explicit property reads (`row.hungerBefore`), never object spread, so an extra key can never shadow or reach logic (`__proto__`, `constructor`).

**Rule B. Binding compares known fields only, and compares them completely.** For every raw row: `canonical(project(raw)) === canonical(parsed)` using the existing PR #94 canonicalisation (sorted keys, defaults only for the four observation collections, `null` != absent, no non-JSON values). Everything the PR #94 suite asserts about known fields must stay true (QA94 canonical suite 27/27, QA86 78/78 and the 1 338-mutation fuzz).

**Rule C. Unknown top-level keys in a signed raw row are allowed, inert and reported.** They are authenticated by the hash chain and the signature, they are never read by any decision, and the report lists them once per distinct key (with a count) in `notProven` or an `unknownSignedFields` section so an auditor sees them. They do **not** downgrade `mode` and are **not** an ERROR. Limits: at most 32 extra keys per row, 4 KiB serialised and depth 8 per row; beyond that an ERROR `RAW_JOURNAL_RESOURCE_LIMIT` (resource safety; also bounds the 10 000-key and 5 000-deep cases in the tests).

**Rule D. Unknown nested keys stay strict.** A new key *inside* a known structured value (`position`, a `worldChanges` entry, `target`, `originPosition`) is **not** inert metadata: those objects are consumed whole. Keep the current behaviour (row quarantined, surfaced). Inventory maps keep accepting arbitrary item-name keys (they are data). This preserves the strictness the schema was written for while allowing recorder evolution at the top level.

**Rule E. Unknown row kinds are a note, not an error.** A signed row whose `kind` is not known is counted in neither the parsed list nor the binding comparison, stays in the hash chain and the digest, and is reported as `UNKNOWN_ROW_KIND` in `notProven`. Known rows still verify.

**Rule F. Schema validation of raw rows is part of the validator, not only of the adapter.** For each raw row, run `journalRowSchema.safeParse(project(raw))`. A failure is an ERROR `RAW_JOURNAL_SCHEMA_VIOLATION` whose description contains the row's `seq` and `kind`; the row is **quarantined** (not turned into an attempt, observation, tick or roster entry), so a schema-invalid observation is never counted as a verified action. Values the schema accepts must stay accepted: `null` `serverGameTick`/`measuredTps`, `durationMs: 0`, empty inventories and `worldChanges`, hunger 0 and 20, absent optionals (test FC-6b).

**Rule G. Never throw on signed input.** Wrap per-row processing and the whole `validateExperimentEvidence` in a guard: any internal exception becomes an ERROR `VALIDATOR_INTERNAL_ERROR` on the affected row (or on the report) with `mode = offline_simulated` and `overallStatus = VIOLATIONS_DETECTED`. Fix the two known type assumptions at source as well (`startRoster.join`, `worldChanges.some`) with `Array.isArray` checks; Rule F removes most others upstream.

**Non-goals.** Do not loosen the canonical comparison (no per-field allow-list of "ignorable" known fields); do not accept parsed rows that carry fields the raw row lacks; do not skip the binding when `journalRows` is empty; do not make `mode` depend on extras.

## 3. Order of work (smallest safe steps)

1. Rule G (never throw): no behaviour change except crash to report. Tests: FC-7.
2. Rule F (raw schema validation + quarantine). Tests: FC-6, FC-6b.
3. Rule A + B + C (shared projection, extras reported, limits). Tests: FC-1, FC-2, FC-3.
4. Rule D + E (nested strictness guard, unknown kinds). Tests: FC-4, FC-5.
5. Run the full acceptance list below. Do not edit any assertion in `qa/v67`, `qa/v75`, `qa/v86`, `qa/v94`; if one seems wrong, stop and report.

## 4. Acceptance (all must hold on the implementation SHA)

* `pnpm exec vitest run -c qa/v94fc/vitest.config.ts` (`QA67_ART=<artifacts/v1>` as in the QA harness): **0 failed** (today: red as listed in the PR).
* Unchanged: `qa/v94` 27/27, `qa/v86` 78/78, QA67 150/150, QA75 51/51, `pnpm test:evidence-validator`, `test:v1`, `pnpm test`, the three typechecks, lint, build.
* The real scenario-2 and scenario-4 journals through the shipped adapter: 0 violations, `NOT_PROVEN`/`offline_simulated`, 6 and 12 verified actions.
* A new unit test file in `experiments/evidence-validator/test` for each rule (the implementation adds none today).
* Independent QA re-runs the exact SHA; the implementation does not approve itself.

## 5. Why this is safe

An extra field in a signed raw row cannot change a decision (Rule A/C: never read), cannot be introduced by a caller (the raw lines are what the signature covers), and cannot hide a known-field edit (Rule B compares every known field completely). Rejecting nothing that the signature authenticates but the schema does not know keeps recorder evolution possible; rejecting everything the schema *does* know and the raw row violates (Rule F) removes the library-path hole without a second parser.

## 6. Open question for the owner (not blocking)

Whether recorder additions should be **namespaced** (for example under a `meta` object) as a convention. Rule C works without it; a namespace would let Rule D stay fully strict at the top level too.
