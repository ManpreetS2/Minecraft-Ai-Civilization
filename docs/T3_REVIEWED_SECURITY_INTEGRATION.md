# Reviewed security integration and remaining privacy boundaries

Branch: `agents/t3-reviewed-security-integration`.
Base: preflight checkpoint `e3f65790ac093d3e4dfd6d3beac7063352065ad2` (draft PR #15).
Merged reviewed source: Claude `1f8e28681cc6f47ba2bac8d732559782b65cdf13`, parent `7c039ec`; local merge checkpoint `3608a76`.

## Independent corrections retained

Inspected Claude's source, report and tests before a clean merge. No file-level ours/theirs selection and no provider routing branch imported. Retains event-time community membership checks against both delivery and persisted provenance, prompt inclusion of persistent/heard facts, Unicode control sanitization, HMAC-bound per-record/citizen/source release grants with single-use audit, same-origin dashboard restrictions, healthy-record review refusal behavior and chronological membership-history replay. Full combined privacy selection after the merge: **298/298**. Cloud admission, holds, endpoint restrictions and strict schema remain in the tree.

HMAC grants authenticate key possession, not a person; there is no operator signing workflow/rotation/revocation tool and no model/tool/HTTP recovery endpoint. No real release key was configured. Tests use disposable keys/SQLite. Current dynamic read-time permissions after leaving a community are unchanged: Claude's O2 owner policy question remains open. Original records are preserved; no production migration occurred.

## T3 O1: implicit teammate site sharing

Root cause: sitesKnownTo treated current community affiliation as permission to read every teammate's discovery metadata, including private ore/farm/shore positions never communicated. The old manager test asserted that behavior. Changed the assertion to the actual privacy contract; it failed before the fix. Scoped planning now receives only the citizen's own observations. Model family never determines permission. Existing free-text communication still reaches authorized cognition as unverified speech; **automatic structured planner ingestion of communicated coordinates is not implemented**, and must not be substituted with blanket teammate access.

Also preserve separate citizens' observations of the same physical site instead of deduplicating away the first citizen's record. Validate all coordinates/stand positions and timestamp; malformed stored metadata is ignored, and invalid new writes refuse without changing existing metadata. Existing legacy metadata is not reassigned to communities.

## T3 O3: low-urgency delivery lost on inference failure

Root cause: buildCitizenContextPack marked bulletin IDs delivered before an inference response existed. Low-urgency lines have no persistent fact fallback, so a rejected request lost them permanently. Real manager regression reproduced this before the fix.

Manager now requests deferred delivery and calls the pack's bound acknowledgement only after a valid response. Acknowledgement reloads stored events and checks current audience plus event-time membership. No acknowledgement on provider refusal/timeout. Retry survives SQLite restart. Authorized urgent fact persistence remains unchanged. Default direct helper behavior is preserved for synchronous existing consumers; asynchronous consumers must request deferDelivery. The only manager diff is adding that option and replacing delivery IDs with the acknowledgement result (three changed lines); protected executor untouched.

## Evidence

Before O1/O3: **2 failing / 110 passing** in the real manager plus independent review suites. After fixes: **117/117** across those suites plus five new site/delivery boundaries. Expanded privacy/http selection: **299/299**. Full workspace: **1652 passed / 0 failed / 2 existing Windows skips / 1654**. Full pnpm typecheck, lint and build pass. Artifacts: artifacts/campaign/reviewed-security.json, o1-o3-before.log, site-delivery-focused.log, security-final.json and security-final*.log. No skipped assertions added or security checks relaxed.

This still is not independent approval of the final combined candidate. Request Claude's final replay. No live `/tell`, Paper connection, paid API call or survival trial took place. Community executor, provider registry/real manager integration, negotiated knowledge version and actual experiment instrumentation wiring remain incomplete.
