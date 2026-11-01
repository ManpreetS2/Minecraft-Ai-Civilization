import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  authorizeEventWithAudience,
  createCommunityDirectory,
  readEventAudience,
  readEventVisibility,
  summarizeBulletinEvent,
  type CommunityDirectory,
  type SimEvent,
} from "@civ/shared";
import {
  KNOWLEDGE_RELEASE_KEY_ENV,
  refuseKnowledgeRelease,
  type KnowledgeReleaseGrant,
} from "./knowledge-release-grant.js";

export type KnowledgeKind = "fact" | "memory";
type Row = {
  id: string;
  citizen_id: string;
  content: string;
  kind: string;
  created_at: string;
  fact_key?: string;
  source_event_id?: string | null;
};
type Evidence = {
  sourceEventId: string;
  sourceDigest: string;
  recordDigest: string;
  authorization: string;
};
type Decision = {
  kind: KnowledgeKind;
  id: string;
  citizenId: string;
  reason: string;
  evidence?: Evidence;
  evidenceRefs?: string[];
};
export type KnowledgeMigrationReport = {
  generatedAt: string;
  snapshotDigest: string;
  decisions: Decision[];
};
export type KnowledgeReviewAuthority = {
  actor: "orchestrator-review";
  reason: string;
  grant: KnowledgeReleaseGrant;
};
const KEY = "sec001_knowledge_provenance_v2";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Runtime/observer-only service. Never expose its write/review methods as model tools. */
export class KnowledgeProvenance {
  private ready = false;
  constructor(
    private readonly db: Database.Database,
    private readonly source: {
      getEventById(id: string): SimEvent | undefined;
      getCommunityDirectory(): CommunityDirectory;
    },
  ) {}

  initialize(filePath: string): void {
    const schema = `
      CREATE TABLE IF NOT EXISTS knowledge_provenance (
        record_kind TEXT NOT NULL, record_id TEXT NOT NULL, citizen_id TEXT NOT NULL,
        source_event_id TEXT NOT NULL, source_digest TEXT NOT NULL, record_digest TEXT NOT NULL,
        authorization TEXT NOT NULL, verified_at TEXT NOT NULL,
        PRIMARY KEY(record_kind, record_id)
      );
      CREATE TABLE IF NOT EXISTS knowledge_review_audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, record_kind TEXT NOT NULL,
        record_id TEXT NOT NULL, citizen_id TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT NOT NULL,
        evidence_refs TEXT NOT NULL, actor TEXT NOT NULL, release_authorization TEXT
      );
    `;
    const existingSchema = Boolean(
      this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='knowledge_provenance'").get(),
    );
    this.ready = existingSchema;
    const at = new Date().toISOString();
    const pending = existingSchema ? this.dryRun(at) : undefined;
    const marker = this.db.prepare("SELECT value FROM sim_meta WHERE key=?").get(KEY);
    if (marker && pending?.decisions.length === 0) return;
    const rows = this.db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM memories)+(SELECT COUNT(*) FROM citizen_persistent_facts) AS n",
      )
      .get() as { n: number };
    let backup: string | undefined;
    if (
      (pending ? pending.decisions.length > 0 : rows.n > 0) &&
      filePath !== ":memory:" &&
      !filePath.startsWith("file::memory:")
    ) {
      backup = `${resolve(filePath)}.pre-provenance-v2-${at.replace(/[:.]/g, "-")}.bak`;
      for (let i = 1; existsSync(backup); i++)
        backup = `${resolve(filePath)}.pre-provenance-v2-${at.replace(/[:.]/g, "-")}-${i}.bak`;
      this.db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
      const saved = new Database(backup, { readonly: true });
      try {
        if (saved.pragma("quick_check", { simple: true }) !== "ok")
          throw new Error("provenance backup integrity check failed");
        for (const table of ["memories", "citizen_persistent_facts"]) {
          const count = `SELECT COUNT(*) AS n FROM ${table}`;
          if (hash(saved.prepare(count).get()) !== hash(this.db.prepare(count).get()))
            throw new Error("provenance backup count mismatch");
        }
      } finally {
        saved.close();
      }
    }
    try {
      this.db.transaction(() => {
        this.db.exec(schema);
        this.ready = true;
        const report = this.dryRun(at);
        if (backup) writeFileSync(`${backup}.dry-run-report.json`, JSON.stringify(report, null, 2));
        this.apply(report);
        this.db.prepare("INSERT OR REPLACE INTO sim_meta(key,value) VALUES(?,?)").run(KEY, at);
      })();
    } catch (error) {
      this.ready = existingSchema;
      throw error;
    }
  }

  private row(kind: KnowledgeKind, id: string): Row | undefined {
    return this.db
      .prepare(
        `SELECT * FROM ${kind === "fact" ? "citizen_persistent_facts" : "memories"} WHERE id=?`,
      )
      .get(id) as Row | undefined;
  }

  private flagged(kind: KnowledgeKind, row: Row): boolean {
    if (kind === "memory")
      return Boolean(
        this.db
          .prepare("SELECT 1 FROM citizen_memory_flags WHERE memory_id=? AND released_at IS NULL")
          .get(row.id),
      );
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM citizen_persistent_fact_flags WHERE released_at IS NULL
      AND (fact_id=? OR (citizen_id=? AND fact_key=?))`,
        )
        .get(row.id, row.citizen_id, row.fact_key),
    );
  }

  private originalDirectory(at: string): CommunityDirectory {
    const communities = new Set<string>();
    const owner = new Map<string, string>();
    const actions = this.db
      .prepare(
        "SELECT action, community_id, citizen_id FROM community_audit WHERE at <= ? ORDER BY at, seq",
      )
      .all(at) as Array<{ action: string; community_id: string; citizen_id: string | null }>;
    for (const action of actions) {
      communities.add(action.community_id);
      if (!action.citizen_id) continue;
      if (action.action === "add_member") owner.set(action.citizen_id, action.community_id);
      // A removal only ends the membership it names, so an out-of-order history can never yield two communities.
      if (action.action === "remove_member" && owner.get(action.citizen_id) === action.community_id)
        owner.delete(action.citizen_id);
    }
    return createCommunityDirectory(
      [...communities].map((id) => ({
        id,
        memberIds: [...owner].filter(([, community]) => community === id).map(([citizen]) => citizen),
      })),
    );
  }

  /**
   * A community audience covers who belonged when the event happened. Joining later, or rejoining after an absence,
   * grants no access to what was said without the reader. Other classes name their readers on the event itself.
   */
  wasInAudienceAtEvent(citizenId: string, event: SimEvent): boolean {
    const audience = readEventAudience(event.payload);
    if (audience?.scope !== "community") return true;
    return this.originalDirectory(event.timestamp).communityOf(citizenId) === audience.communityId;
  }

  private evidence(
    _kind: KnowledgeKind,
    row: Row,
    sourceId: string | undefined,
    acquisition: "historical" | "runtime",
    replacement = false,
  ): Evidence | undefined {
    if (!sourceId) return undefined;
    const event = this.source.getEventById(sourceId);
    if (!event) return undefined;
    const at = acquisition === "runtime" && replacement ? new Date().toISOString() : row.created_at;
    if (
      !Number.isFinite(Date.parse(at)) ||
      !Number.isFinite(Date.parse(event.timestamp)) ||
      Date.parse(event.timestamp) > Date.parse(at) ||
      Date.parse(at) > Date.now()
    )
      return undefined;
    const directory = this.originalDirectory(at);
    if (
      !authorizeEventWithAudience(row.citizen_id, event.payload, directory, event.citizenId)
        .allowed ||
      !this.wasInAudienceAtEvent(row.citizen_id, event)
    )
      return undefined;
    // A key, label or prose justification does not prove derivation. Only reproducible source text qualifies.
    const text = [
      summarizeBulletinEvent(event),
      event.payload.message,
      event.payload.summary,
      event.payload.announcement,
    ];
    if (!text.some((content) => typeof content === "string" && content === row.content))
      return undefined;
    return {
      sourceEventId: sourceId,
      sourceDigest: hash(event),
      recordDigest: hash(row),
      authorization: JSON.stringify({
        acquiredAt: at,
        visibilityClass: readEventVisibility(event.payload).class,
        audience: readEventAudience(event.payload),
        audienceIds: readEventVisibility(event.payload).audienceIds,
        actorCitizenId: event.citizenId,
        readerCitizenId: row.citizen_id,
        communityId: directory.communityOf(row.citizen_id),
        basis: acquisition,
      }),
    };
  }

  isEligible(kind: KnowledgeKind, id: string): boolean {
    return this.withSnapshot(() => {
      if (!this.ready) return false;
      const row = this.row(kind, id);
      if (!row || this.flagged(kind, row)) return false;
      const proof = this.db
        .prepare("SELECT * FROM knowledge_provenance WHERE record_kind=? AND record_id=?")
        .get(kind, id) as
        | {
            citizen_id: string;
            source_event_id: string;
            source_digest: string;
            record_digest: string;
          }
        | undefined;
      if (!proof || proof.citizen_id !== row.citizen_id || proof.record_digest !== hash(row))
        return false;
      const event = this.source.getEventById(proof.source_event_id);
      return Boolean(
        event &&
        hash(event) === proof.source_digest &&
        this.wasInAudienceAtEvent(row.citizen_id, event) &&
        authorizeEventWithAudience(
          row.citizen_id,
          event.payload,
          this.source.getCommunityDirectory(),
          event.citizenId,
        ).allowed,
      );
    });
  }

  sourceFor(kind: KnowledgeKind, id: string): SimEvent | undefined {
    return this.withSnapshot(() => {
      if (!this.isEligible(kind, id)) return undefined;
      const proof = this.db
        .prepare(
          "SELECT source_event_id FROM knowledge_provenance WHERE record_kind=? AND record_id=?",
        )
        .get(kind, id) as { source_event_id: string };
      return this.source.getEventById(proof.source_event_id);
    });
  }

  /** Keep source, row, flags and membership checks in one WAL read snapshot. */
  withSnapshot<T>(read: () => T): T {
    return this.db.inTransaction ? read() : this.db.transaction(read)();
  }

  private audit(
    decision: Decision,
    outcome: string,
    actor: string,
    authorizationId?: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO knowledge_review_audit
      (at,record_kind,record_id,citizen_id,outcome,reason,evidence_refs,actor,release_authorization) VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        new Date().toISOString(),
        decision.kind,
        decision.id,
        decision.citizenId,
        outcome,
        decision.reason,
        JSON.stringify(
          decision.evidence
            ? [decision.evidence.sourceEventId, decision.evidence.sourceDigest]
            : (decision.evidenceRefs ?? []),
        ),
        actor,
        authorizationId ?? null,
      );
  }

  private flag(decision: Decision): void {
    const row = this.row(decision.kind, decision.id)!;
    if (decision.kind === "fact")
      this.db
        .prepare(
          `INSERT OR IGNORE INTO citizen_persistent_fact_flags
      (fact_id,citizen_id,fact_key,reason,source,flagged_at) VALUES(?,?,?,?,'provenance-v2',?)`,
        )
        .run(row.id, row.citizen_id, row.fact_key, decision.reason, new Date().toISOString());
    else
      this.db
        .prepare(
          `INSERT OR IGNORE INTO citizen_memory_flags(memory_id,citizen_id,reason,flagged_at) VALUES(?,?,?,?)`,
        )
        .run(row.id, row.citizen_id, decision.reason, new Date().toISOString());
    // Re-quarantine a previously released record if its authenticated bytes/source have changed.
    if (decision.kind === "fact")
      this.db
        .prepare("UPDATE citizen_persistent_fact_flags SET released_at=NULL WHERE fact_id=?")
        .run(row.id);
    else
      this.db
        .prepare("UPDATE citizen_memory_flags SET released_at=NULL WHERE memory_id=?")
        .run(row.id);
  }

  private stamp(decision: Decision): void {
    const proof = decision.evidence!;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO knowledge_provenance
      (record_kind,record_id,citizen_id,source_event_id,source_digest,record_digest,authorization,verified_at) VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        decision.kind,
        decision.id,
        decision.citizenId,
        proof.sourceEventId,
        proof.sourceDigest,
        proof.recordDigest,
        proof.authorization,
        new Date().toISOString(),
      );
  }

  /** Only CivilizationStore's trusted runtime writers call this; missing/invalid evidence preserves but quarantines. */
  recordWrite(kind: KnowledgeKind, id: string, sourceId?: string, replacement = false): void {
    const row = this.row(kind, id)!;
    const proof = this.evidence(kind, row, sourceId, "runtime", replacement);
    const decision: Decision = {
      kind,
      id,
      citizenId: row.citizen_id,
      evidence: proof,
      evidenceRefs: sourceId ? [sourceId] : [],
      reason: proof
        ? "authenticated runtime source and derivation"
        : "unknown or invalid source/authorization/derivation",
    };
    if (proof && !this.flagged(kind, row)) {
      this.stamp(decision);
      this.audit(decision, "verified", "runtime");
    } else {
      this.flag(decision);
      this.audit(decision, "quarantined", "runtime");
    }
  }

  dryRun(at = new Date().toISOString()): KnowledgeMigrationReport {
    const decisions: Decision[] = [];
    const snapshot: unknown[] = [];
    for (const kind of ["fact", "memory"] as const) {
      const rows = this.db
        .prepare(
          `SELECT * FROM ${kind === "fact" ? "citizen_persistent_facts" : "memories"} ORDER BY id`,
        )
        .all() as Row[];
      for (const row of rows) {
        const flagged = this.flagged(kind, row);
        const previous = this.db
          .prepare(
            "SELECT outcome FROM knowledge_review_audit WHERE record_kind=? AND record_id=? ORDER BY seq DESC LIMIT 1",
          )
          .get(kind, row.id) as { outcome: string } | undefined;
        const sourceId =
          row.source_event_id ??
          (row.fact_key?.startsWith("event:") ? row.fact_key.slice(6) : undefined);
        const source = sourceId ? this.source.getEventById(sourceId) : undefined;
        snapshot.push([kind, row, flagged, source]);
        if (
          this.isEligible(kind, row.id) ||
          (flagged && (previous?.outcome === "quarantined" || previous?.outcome === "rejected"))
        )
          continue;
        const proof = flagged ? undefined : this.evidence(kind, row, sourceId, "historical");
        decisions.push({
          kind,
          id: row.id,
          citizenId: row.citizen_id,
          evidence: proof,
          evidenceRefs: sourceId ? [sourceId] : [],
          reason: proof
            ? "historical source, original authorization and exact derivation verified"
            : "unknown origin or unverifiable original authorization/derivation; evidence-based review required",
        });
      }
    }
    // Include directory history: a stale report must not authenticate data after membership/evidence changes.
    snapshot.push(this.db.prepare("SELECT * FROM community_audit ORDER BY seq").all());
    return { generatedAt: at, snapshotDigest: hash(snapshot), decisions };
  }

  apply(report: KnowledgeMigrationReport): void {
    this.db.transaction(() => {
      const current = this.dryRun(report.generatedAt);
      if (
        current.snapshotDigest !== report.snapshotDigest ||
        hash(current.decisions) !== hash(report.decisions)
      )
        throw new Error("stale or modified provenance migration report");
      for (const decision of current.decisions) {
        if (decision.evidence) {
          this.stamp(decision);
          this.audit(decision, "verified", "provenance-migration");
        } else {
          this.flag(decision);
          this.audit(decision, "quarantined", "provenance-migration");
        }
      }
    })();
  }

  /**
   * Single-record observer recovery. Needs both an authenticated operator grant for this exact record and source, and
   * independently verified evidence. Neither alone releases anything. Refusals are audited and change no flags, so a
   * mistaken review cannot quarantine a healthy record. Reachable only from operator code; never expose it as a tool.
   */
  review(
    kind: KnowledgeKind,
    id: string,
    sourceId: string,
    authority: KnowledgeReviewAuthority,
  ): { ok: boolean; reason: string } {
    if (kind !== "fact" && kind !== "memory") throw new Error("unknown knowledge record kind");
    // IMMEDIATE takes the write lock before reading, so no concurrent writer can change what was checked.
    return this.db
      .transaction(() => {
        const row = this.row(kind, id);
        const citizenId = row?.citizen_id ?? "unknown";
        const grant = authority?.grant;
        const reference =
          typeof grant?.authorizationId === "string" ? grant.authorizationId.slice(0, 200) : undefined;
        const refuse = (reason: string) => {
          this.audit(
            { kind, id, citizenId, reason, evidenceRefs: [sourceId] },
            "refused",
            typeof authority?.actor === "string" ? authority.actor.slice(0, 80) : "unknown",
            reference,
          );
          return { ok: false, reason };
        };
        if (authority?.actor !== "orchestrator-review" || !authority.reason?.trim())
          return refuse("explicit orchestrator review authorization required");
        if (!row) return refuse("record not found");
        const refusal = refuseKnowledgeRelease(
          grant,
          { kind, recordId: id, citizenId, sourceEventId: sourceId },
          process.env[KNOWLEDGE_RELEASE_KEY_ENV],
        );
        if (refusal) return refuse(refusal);
        const replayed = this.db
          .prepare("SELECT 1 FROM knowledge_review_audit WHERE outcome='released' AND release_authorization=?")
          .get(grant.authorizationId);
        if (replayed) return refuse("release authorization was already used");
        const proof = this.evidence(kind, row, sourceId, "historical");
        const source = this.source.getEventById(sourceId);
        const current =
          source &&
          authorizeEventWithAudience(
            row.citizen_id,
            source.payload,
            this.source.getCommunityDirectory(),
            source.citizenId,
          ).allowed;
        const keyConflict =
          kind === "fact" &&
          this.db
            .prepare(
              `SELECT 1 FROM citizen_persistent_fact_flags
        WHERE citizen_id=? AND fact_key=? AND fact_id<>? AND released_at IS NULL`,
            )
            .get(row.citizen_id, row.fact_key, row.id);
        const verified = proof && current && !keyConflict;
        const decision: Decision = {
          kind,
          id,
          citizenId: row.citizen_id,
          evidence: proof,
          evidenceRefs: [sourceId],
          reason: `${authority.reason}: ${verified ? "original evidence verified" : "original evidence/authorization not established or another record's key quarantine remains"} (operator ${grant.operatorId})`,
        };
        if (!verified) {
          if (!this.isEligible(kind, id)) this.flag(decision);
          this.audit(decision, "rejected", authority.actor, grant.authorizationId);
          return { ok: false, reason: decision.reason };
        }
        if (kind === "fact")
          this.db
            .prepare("UPDATE citizen_persistent_fact_flags SET released_at=? WHERE fact_id=?")
            .run(new Date().toISOString(), row.id);
        else
          this.db
            .prepare("UPDATE citizen_memory_flags SET released_at=? WHERE memory_id=?")
            .run(new Date().toISOString(), row.id);
        this.stamp(decision);
        this.audit(decision, "released", authority.actor, grant.authorizationId);
        return { ok: true, reason: decision.reason };
      })
      .immediate();
  }

  listAudit(): Array<Record<string, unknown>> {
    return this.db.prepare("SELECT * FROM knowledge_review_audit ORDER BY seq").all() as Array<
      Record<string, unknown>
    >;
  }
}
