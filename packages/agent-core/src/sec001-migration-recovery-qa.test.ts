import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { copyFileSync, mkdirSync } from "node:fs";
import { CivilizationStore } from "./store.js";
import { auditSnapshot, legacyFixture } from "./sec001-migration-qa/fixture.js";
const fixtures: ReturnType<typeof legacyFixture>[] = [];
const failedHandles: Database.Database[] = [];
function fixture() {
  const f = legacyFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const h of failedHandles.splice(0)) if (h.open) h.close();
  for (const f of fixtures.splice(0)) f.cleanup();
});
function marker(db: Database.Database) {
  return db.prepare("SELECT value FROM sim_meta WHERE key='sec001_fact_flags_v1'").get();
}

describe("Independent SEC-001 migration fault/recovery QA", () => {
  it("fails closed when VACUUM backup encounters a real SQLite destination error; no quarantine marker or data loss", () => {
    const f = fixture();
    const exec = Database.prototype.exec;
    vi.spyOn(Database.prototype, "exec").mockImplementation(function (
      this: Database.Database,
      sql: string,
    ) {
      if (sql.startsWith("VACUUM INTO")) {
        failedHandles.push(this);
        return exec.call(
          this,
          `VACUUM INTO '${join(f.dir, "missing-parent", "backup.sqlite").replace(/'/g, "''")}'`,
        );
      }
      return exec.call(this, sql);
    });
    expect(() => f.open()).toThrow(/cannot back up the database first/);
    vi.restoreAllMocks();
    for (const h of failedHandles.splice(0)) if (h.open) h.close();
    const raw = new Database(f.path);
    expect(auditSnapshot(raw)).toEqual(f.before);
    expect(marker(raw)).toBeUndefined();
    expect(raw.prepare("SELECT * FROM citizen_persistent_fact_flags").all()).toEqual([]);
    raw.close();
    const recovered = f.open();
    expect(recovered.listQuarantinedFacts().map((f) => f.id)).toContain("f-poison");
  });

  it("rolls all flag inserts back on a SQLite trigger abort mid-transaction, then retries on reopen", () => {
    const f = fixture();
    const apply = CivilizationStore.prototype.applyLegacyFactMigration;
    vi.spyOn(CivilizationStore.prototype, "applyLegacyFactMigration").mockImplementationOnce(
      function (this: CivilizationStore, report, at) {
        failedHandles.push(this.db);
        this.db.exec(
          "CREATE TEMP TRIGGER qa_abort BEFORE INSERT ON citizen_persistent_fact_flags WHEN NEW.fact_id='f-poison' BEGIN SELECT RAISE(ABORT,'QA injected flag interruption'); END",
        );
        return apply.call(this, report, at);
      },
    );
    expect(() => f.open()).toThrow(/QA injected flag interruption/);
    for (const h of failedHandles.splice(0)) if (h.open) h.close();
    vi.restoreAllMocks();
    const raw = new Database(f.path);
    expect(marker(raw)).toBeUndefined();
    expect(raw.prepare("SELECT * FROM citizen_persistent_fact_flags").all()).toEqual([]);
    expect(auditSnapshot(raw)).toEqual(f.before);
    raw.close();
    const s = f.open();
    expect(s.listQuarantinedFacts()).toHaveLength(6);
    expect(s.listFlaggedMemoryIds()).toEqual(["m-exact", "m-other", "m-own", "m-paraphrase"]);
  });

  it("recovers idempotently after flags commit but before the completion marker is written", () => {
    const f = fixture();
    const apply = CivilizationStore.prototype.applyLegacyFactMigration;
    vi.spyOn(CivilizationStore.prototype, "applyLegacyFactMigration").mockImplementationOnce(
      function (this: CivilizationStore, report, at) {
        failedHandles.push(this.db);
        apply.call(this, report, at);
        throw new Error("QA interruption after committed flags");
      },
    );
    expect(() => f.open()).toThrow(/QA interruption/);
    for (const h of failedHandles.splice(0)) if (h.open) h.close();
    vi.restoreAllMocks();
    const raw = new Database(f.path);
    expect(marker(raw)).toBeUndefined();
    expect(raw.prepare("SELECT * FROM citizen_persistent_fact_flags").all()).toHaveLength(4);
    expect(auditSnapshot(raw)).toEqual(f.before);
    raw.close();
    const s = f.open();
    expect(s.listQuarantinedFacts()).toHaveLength(6);
    expect(s.listFlaggedMemoryIds()).toEqual(["m-exact", "m-other", "m-own", "m-paraphrase"]);
    expect(marker(s.db)).toBeDefined();
    s.close();
    const reopened = f.open();
    expect(reopened.listQuarantinedFacts()).toHaveLength(6);
    expect(auditSnapshot(reopened.db)).toEqual(f.before);
  });

  it("backup includes committed WAL rows even while another connection keeps the WAL open", () => {
    const f = fixture();
    const writer = new Database(f.path);
    failedHandles.push(writer);
    writer.pragma("journal_mode=WAL");
    writer.pragma("wal_autocheckpoint=0");
    writer
      .prepare(
        "INSERT INTO citizen_persistent_facts(id,citizen_id,fact_key,content,kind,created_at) VALUES('wal-poison','Claude-B','event:leaked-camp','WAL hidden camp content','observed_fact','2026-10-31')",
      )
      .run();
    const s = f.open();
    expect(s.listQuarantinedFacts().map((f) => f.id)).toContain("wal-poison");
    const backup = new Database(f.backups()[0]!, { readonly: true });
    expect(
      backup.prepare("SELECT content FROM citizen_persistent_facts WHERE id='wal-poison'").get(),
    ).toEqual({ content: "WAL hidden camp content" });
    backup.close();
  });

  it("aborts before flagging if the dry-run report cannot be written, retaining a usable backup", () => {
    const f = fixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date("2026-10-31T12:00:00.000Z");
    vi.setSystemTime(now);
    const backup = `${f.path}.pre-sec001-${now.toISOString().replace(/[:.]/g, "-")}.bak`;
    // A real filesystem error, not a mocked writeFileSync result.
    mkdirSync(`${backup}.dry-run-report.json`);
    const exec = Database.prototype.exec;
    vi.spyOn(Database.prototype, "exec").mockImplementation(function (
      this: Database.Database,
      sql: string,
    ) {
      if (sql.startsWith("VACUUM INTO")) failedHandles.push(this);
      return exec.call(this, sql);
    });
    expect(() => f.open()).toThrow(/EISDIR|illegal operation on a directory/);
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const h of failedHandles.splice(0)) if (h.open) h.close();
    const raw = new Database(f.path);
    try {
      expect(marker(raw)).toBeUndefined();
      expect(raw.prepare("SELECT * FROM citizen_persistent_fact_flags").all()).toEqual([]);
      expect(auditSnapshot(raw)).toEqual(f.before);
    } finally {
      raw.close();
    }
    const saved = new Database(backup, { readonly: true });
    try {
      expect(auditSnapshot(saved)).toEqual(f.before);
    } finally {
      saved.close();
    }
    expect(f.open().listQuarantinedFacts()).toHaveLength(6);
  });

  it("completes provenance backfill on reopen after the completion marker commits but backfill aborts", () => {
    const f = fixture();
    const apply = CivilizationStore.prototype.applyLegacyFactMigration;
    vi.spyOn(CivilizationStore.prototype, "applyLegacyFactMigration").mockImplementationOnce(
      function (this: CivilizationStore, report, at) {
        failedHandles.push(this.db);
        const result = apply.call(this, report, at);
        this.db.exec(
          "CREATE TEMP TRIGGER qa_backfill_abort BEFORE UPDATE OF source_event_id ON citizen_persistent_facts BEGIN SELECT RAISE(ABORT,'QA interrupted provenance backfill'); END",
        );
        return result;
      },
    );
    expect(() => f.open()).toThrow(/QA interrupted provenance backfill/);
    for (const h of failedHandles.splice(0)) if (h.open) h.close();
    vi.restoreAllMocks();
    const raw = new Database(f.path);
    try {
      expect(marker(raw)).toBeDefined();
      expect(raw.prepare("SELECT * FROM citizen_persistent_fact_flags").all()).toHaveLength(4);
      expect(
        raw
          .prepare("SELECT source_event_id FROM citizen_persistent_facts WHERE id='f-poison'")
          .get(),
      ).toEqual({ source_event_id: null });
      expect(auditSnapshot(raw)).toEqual(f.before);
    } finally {
      raw.close();
    }
    const reopened = f.open();
    expect(reopened.listQuarantinedFacts()).toHaveLength(6);
    expect(reopened.listFlaggedMemoryIds()).toEqual([
      "m-exact",
      "m-other",
      "m-own",
      "m-paraphrase",
    ]);
    expect(
      reopened.db
        .prepare(
          "SELECT source_event_id,audience FROM citizen_persistent_facts WHERE id='f-poison'",
        )
        .get(),
    ).toEqual({ source_event_id: "leaked-camp", audience: null });
    expect(
      reopened.listPersistentFacts("Claude-A").find((fact) => fact.id === "f-owner")?.sourceEventId,
    ).toBe("private-owner");
    expect(f.backups()).toHaveLength(1);
  });

  it("can restore a migration backup to another disposable database and reapply quarantine without losing audit content", () => {
    const f = fixture();
    const migrated = f.open();
    const backup = f.backups()[0]!;
    migrated.close();
    const restoredPath = join(f.dir, "restored-copy.sqlite");
    copyFileSync(backup, restoredPath);
    const restored = new CivilizationStore(restoredPath);
    try {
      expect(auditSnapshot(restored.db)).toEqual(f.before);
      expect(restored.listQuarantinedFacts().map((fact) => fact.id)).toEqual([
        "f-note",
        "f-observer",
        "f-orphan",
        "f-poison",
        "f-public",
        "f-suspicion",
      ]);
      expect(restored.listFlaggedMemoryIds()).toEqual([
        "m-exact",
        "m-other",
        "m-own",
        "m-paraphrase",
      ]);
      expect(restored.getDeliveredEventIds("Claude-A")).toEqual(
        new Set(["directed", "leaked-camp", "private-owner"]),
      );
      expect(restored.listPersistentFacts("Claude-A").map((fact) => fact.id)).not.toContain(
        "f-poison",
      );
      expect(restored.getMemories("Claude-A").map((memory) => memory.id)).not.toContain("m-exact");
    } finally {
      restored.close();
    }
    const original = new Database(f.original, { readonly: true });
    try {
      expect(auditSnapshot(original)).toEqual(f.before);
    } finally {
      original.close();
    }
  });
});
