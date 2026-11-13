# Proposed conservation contract migration — independent adjudication required

Original QA67/86/94/94FC and QA103 files remain unchanged.

Before: QA103-I1 characterizes two AbandonedActionObservation wrappers for one transfer. After: one physical AbandonedTransferObservation is the pending receipt; executor/home wrappers do not add countable transfers. A no-effect cancellation produces none. qa/round5/chest.test.ts asserts the proposed single-receipt contract and physical conservation.

QA103 tests requiring AbandonedActionObservation specifically may remain red because their event selector omits the authoritative skill receipt. This is an explicit proposed contract migration, not a green claim. Older QA78 bread-zero expectations also cannot justify undoing a physically completed withdrawal after timeout. Preserve actual inventory, cancellation result, ownership generations, newer claims and observation revision tokens. Independent reviewers must adjudicate these selectors before acceptance. No automatic inventory rollback is introduced.
