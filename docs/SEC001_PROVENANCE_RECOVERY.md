# SEC-001 provenance quarantine and recovery

Owner policy: **unknown origin stays quarantined; preserve originals; recover one record only from verified evidence.** This is an unmerged proposal tested on disposable SQLite, not authorization to open production data.

Original memory/fact rows remain in place. `knowledge_provenance` holds source/record hashes and original authorization; flag tables restrict retrieval. `knowledge_review_audit` records citizen/original ID, reason, evidence, outcome and release authorization. Gated store reads must precede relevance selection, prompts, summaries and embedding jobs. Observer SQL must never bypass that boundary.

Each retrieval uses one SQLite read snapshot for original rows, proof, source, flags and audience. Concurrent WAL updates cannot pair previously checked authorization with newly substituted text; the next retrieval revalidates the changed evidence.

The v2 constructor migration verifies a `VACUUM INTO` snapshot and writes a content-free dry-run report, then atomically commits v2 schema, flags, proof, audit and marker. Snapshot/report errors abort before application; interrupted application rolls back. A completed marker never authorizes future imports.

## New records

Persist the actual runtime observation/outcome/communication event first:

```ts
store.addMemory(memory, { sourceEventId: storedEvent.id });
store.upsertPersistentFact({ ...fact, sourceEventId: storedEvent.id });
```

The store checks the persisted source, reproducible content derivation and entitlement at acquisition. Missing/invalid evidence preserves the inserted original behind quarantine. A fresh write cannot silently release flagged history. Task/social producers are integrated in `manager.ts`; source-backed speech remains attributed and unverified.

## Per-record observer recovery

Use an authorized **disposable copy** during engineering. Constructor opening already performs its backed-up migration. Explicit inspection/application handles subsequently imported or changed records:

```ts
const report = store.knowledge.dryRun(); // read-only, no contents in report
store.knowledge.apply(report); // rejects stale/modified reports; transactional

const result = store.knowledge.review(
  "memory", // or "fact"
  originalRecordId,
  existingSourceEventId,
  {
    actor: "orchestrator-review",
    reason: "Verify original acquisition against stored evidence",
    authorizationId: operatorReleaseAuthorizationReference,
  },
);
```

The authorization reference must refer to an actual operator release decision, never invented or supplied by model output. Authorization/prose alone cannot release a record. Code independently verifies that the stored source existed by acquisition, its original audience/actor entitlement, exact content derivation and current access. Community evidence needs audited original membership; joining today cannot retroactively authorize an older acquisition.

Success releases only that original record's flag and adds proof/audit metadata. Content, timestamps, ownership and original metadata stay unchanged. Another record's key quarantine cannot be blanket-released. Failure preserves quarantine and audits rejection/evidence references. Read observer outcomes with `store.knowledge.listAudit()`; do not register recovery as a citizen/model tool.

No suitable evidence means **no recovery**, even if content sounds personal or an LLM considers a paraphrase plausible. Do not recreate/backdate events, rewrite records or grant teammates blanket access. Permanently uncertain history stays preserved behind retrieval restrictions.

No production operator command, live server action or production migration was executed in this mission.
