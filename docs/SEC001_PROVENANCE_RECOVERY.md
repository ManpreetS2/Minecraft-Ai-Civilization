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
    grant, // from signKnowledgeRelease in separate operator tooling
  },
);
```

The grant is an HMAC over one exact citizen, record, source and authorization reference, signed with `KNOWLEDGE_RELEASE_KEY` (at least 32 characters). Keep that key in the operator's environment, never in SQLite, config files or prompts. Without it every release is refused. An authorization reference releases at most one record, once. Refusals are audited and change no flags.

**Trust boundary:** the grant proves possession of the key, not a person's identity; `operatorId` is what the key holder wrote. Code running inside this process could read the key, so it is trusted by definition. Nothing in the simulation may call `review` or import `signKnowledgeRelease`, and a test enforces this. Whoever can write SQLite directly can also forge proof rows; hashes detect accidental or partial changes, not that attacker.

A grant is not sufficient by itself. Code independently verifies that the stored source existed by acquisition, the reader was in its audience when it happened and at acquisition, exact content derivation and current access. Joining a community today cannot authorize anything said before the citizen joined or while it was away.

Success releases only that original record's flag and adds proof/audit metadata. Content, timestamps, ownership and original metadata stay unchanged. Another record's key quarantine cannot be blanket-released. Failure preserves quarantine and audits rejection/evidence references. Read observer outcomes with `store.knowledge.listAudit()`; do not register recovery as a citizen/model tool.

No suitable evidence means **no recovery**, even if content sounds personal or an LLM considers a paraphrase plausible. Do not recreate/backdate events, rewrite records or grant teammates blanket access. Permanently uncertain history stays preserved behind retrieval restrictions.

No production operator command, live server action or production migration was executed in this mission.
