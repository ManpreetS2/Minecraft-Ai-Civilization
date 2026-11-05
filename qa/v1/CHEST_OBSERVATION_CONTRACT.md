# Chest observation freshness contract (QA proposal for Cursor / CODEX 1)

Goal: tell apart verified live stock, previously observed stock, failed withdrawals, newer authoritative observations and
stale or concurrent ones, without a second chest store.

Already true on the candidate: `physical_asset_contents` persists `observed_by` and `observed_at`; they are only not exposed.
`community-physical-state.ts` already uses compare-and-swap for settlement snapshots, so the pattern exists.

Smallest additive contract (no change to `observedContainerContents`; no behaviour change when the new argument is omitted):

1. `observedContainerDetails(key)` returns `{ contents, observedAt (ISO), observedBy, revision, basis: "observed" }` or
   `undefined`, with exactly the authorization of `observedContainerContents`.
2. `revision`: an integer column on `physical_asset_contents`, +1 per accepted `recordContainerObservation` (migration: add
   the column, default 0).
3. `recordContainerObservation(key, observed, { expectedRevision? })`: when `expectedRevision` is given and differs from the
   stored revision, return `false` and change nothing. Omitted keeps today's behaviour.
4. Taxonomy: stored rows are only ever `observed` (adapter-reported, last seen). "Verified live" is a per-use check made by the
   adapter at withdrawal time, never a stored state. Unverified assumptions are never stored. A failed live check
   (`VERIFY_FAILED`) is recorded as a new observation of that item; `PATH_FAILED` and other transient failures record nothing.

Tests: `test/adv-chest-freshness.test.ts`. They are BLOCKED (skipped) until `observedContainerDetails` exists, and run as real
regressions as soon as it does. Nothing was faked to make them pass.
