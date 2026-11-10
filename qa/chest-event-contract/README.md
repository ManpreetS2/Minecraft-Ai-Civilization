# Chest event duplication: focused contract handoff

Production source: 4478c18410c08d11cc563d718636d89367afffd0 (Mission 2 atop exact PR88). QA-only analysis; no production event change.

Existing QA88 home controls: 5 passed, including the explicit two-event characterization. New desired-contract file: 4 passed, 4 failed, no skips, exit 1. Four normal personal/household deposit/withdraw cases emit two success events where one is desired. Cancellation and timeout cases emit zero success events, preserve pending incidents and conserve citizen plus chest items. Unchanged QA88-M1: 4 passed. QA-only lint: exit 0.

Run pnpm exec vitest run -c qa/chest-event-contract/vitest.config.ts and pnpm exec vitest run -c qa/v88/vitest.defects.config.ts. Raw evidence is captured here. All assertions are ordinary. No Paper or paid calls were used.

## Ownership and consumers

The inventory-service skill owns physical per-item observations with item/count and citizen/container counts. Executor and home-ops own logical action completion and emit a second Item event with aggregate contents/position and home access metadata. ActionCompleted already has a clear executor owner. The duplicate Item events have different ids and payloads, with no stable shared transfer id.

Inspected consumers: shared format-event formats every ItemDeposited/ItemWithdrawn using item/count; world-lab-one-citizen-sequence classifies each as INVENTORY_DELTA; general bus/store/presentation pipelines ingest both. No production source intentionally requiring two events was found. Removing the skill event loses named-item physical details; removing the upper event loses contents/access context. Suppressing per-item events in favor of an upper aggregate also needs multi-stack and partial-failure rules so physical transfers are not lost when a later step fails.

## Recommended bounded follow-up

Define one authoritative per-physical-transfer Item event at the skill/observation layer, carry required access/correlation metadata into it, and retain ActionCompleted as the upper logical outcome. If an aggregate event remains necessary, give it a distinct contract. Add multi-stack, partial-failure, consumer and visibility tests before changing production. Preserve distinct pending observations rather than blindly coalescing their event types.

The work order permits analysis/reproduction when correction risks an event-contract migration. That path was chosen. QA88-I1 remains OPEN (Low); no duplication fix or evidence-grade acceptance is claimed. Original QA88 and QA78 assertions remain intact. Proceeding to offline integration does not promote this defect as accepted.
