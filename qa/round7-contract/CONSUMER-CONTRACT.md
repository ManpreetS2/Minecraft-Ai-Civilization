# Proposed pending physical receipt contract — independent adjudication required

This separately reviewable successor preserves #162 and frozen independent assertions. It is not permission to replace them. A single SystemIncident/AbandonedTransferObservation is produced per resolved abandoned physical operation; command failures/wrappers are not extra transfers. authoritativeStorageUpdated:false and reconciliation:PENDING mean that no authoritative storage projection was applied.

Both directions have the same keys: direction, item, count, measurementStatus, citizenBefore/After, containerBefore/After, position, access, contents, runId, citizenId, actionId, transferId, correlationComplete, plus kind/reconciliation/authoritativeStorageUpdated. Null means unavailable or unproven; it must never be coerced to numeric zero. Position/access come from observed container location and authorized runtime storage context; they are not copied from model plan metadata.

| State | Producer evidence | Count / interpretation |
|---|---|---|
| CONFIRMED_MOVEMENT | Matching positive citizen and container deltas | Observed count; still pending and not a storage update or server-authenticated proof |
| ZERO_OBSERVED | A resolved operation's bounded observation window shows unchanged views | count:null; actual movement remains unresolved, including later slot sync |
| UNKNOWN | Missing, inconsistent, one-sided or unreadable views | count:null; missing snapshots/contents are explicit null |
| CONFIRMED_ZERO | Requires independent proof of no movement, or a producer's pre-issue cancellation guard | This producer never emits this as a physical receipt. Pre-issue cancellation emits no transfer receipt. A generic cancelled command is not proof of zero movement |

executePlan routes the mandatory runtime event bus into the skill context, so an omitted optional ctx.events cannot silently lose the receipt.

runId is supplied by AgentManager from its actual runtime run. Each executePlan creates a new actionId, ignoring plan-supplied spoofed IDs. Each physical operation creates transferId; multiple items in one deposit command therefore have distinct operation IDs under one action ID. These are runtime correlation IDs, not Paper/server transaction IDs. Direct calls lacking a run/action/citizen context retain null and correlationComplete:false; no run ID is invented. SimEvent.id remains the message ID persisted in SQLite.

A future consumer may deduplicate delivery by event ID and physical observations by transferId. It must not count command outcomes, null-count receipts or inferred time/citizen groupings as extra movements. No durable exactly-once transport, server attribution or automatic reconciliation service is implemented here. No acceptance ledger is updated.

Normal terminal ItemDeposited/ItemWithdrawn payloads are retained. Cancelled/inconclusive operations cannot emit terminal success. Receipts are retained before cleanup. No inventory rollback or newer-claim release is introduced. The original Round 6 post-confirmation no-receipt expectations are preserved and explicitly superseded only in this proposed contract; they are not silently rewritten. Fresh Claude 2 approval remains required. All evidence remains offline_simulated / NOT_PROVEN.
