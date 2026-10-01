import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { applyBrainMigrations, listAppliedMigrations } from "./brain-migrations.js";
import {
  inspectSchemaCompatibility,
  snapshotSqliteSchema,
  type PreflightReport,
  type SchemaSnapshot,
} from "./schema-preflight.js";

export type DbPathKind = "production" | "world_lab_authoritative" | "copy_or_temp" | "unknown";

const PRODUCTION_BASENAMES = new Set(["civilization.sqlite"]);
const WORLD_LAB_MARKERS = ["world-lab", "world_lab", "WORLD-LAB"];

/**
 * Classify a sqlite path for safety. Production / WORLD-LAB authoritative paths
 * are refused unless the **basename** clearly marks a copy
 * (`.copy.` / `-copy-` / `_copy_` / `fixture` / `tmp-` prefix / `.migrated.`).
 * Being under /tmp alone does NOT make `civilization.sqlite` safe.
 */
export function classifyDbPath(filePath: string): {
  kind: DbPathKind;
  safeToMutate: boolean;
  reason: string;
} {
  const abs = resolve(filePath);
  const base = basename(abs).toLowerCase();
  const basenameLooksLikeCopy =
    base.includes(".copy.") ||
    base.includes("-copy-") ||
    base.includes("-copy.") ||
    base.includes("_copy_") ||
    base.includes("_copy.") ||
    /(?:^|[._-])copy(?:[._-]|$)/.test(base) ||
    base.includes(".migrated.") ||
    base.startsWith("tmp-") ||
    base.includes("fixture") ||
    (base.includes("test") && base.endsWith(".sqlite")) ||
    base.includes("replay");

  if (PRODUCTION_BASENAMES.has(base)) {
    return {
      kind: "production",
      safeToMutate: false,
      reason: "refusing production civilization.sqlite — operate on an explicit copy only",
    };
  }

  const worldLab = WORLD_LAB_MARKERS.some((m) => abs.toLowerCase().includes(m.toLowerCase()));
  if (worldLab && !basenameLooksLikeCopy) {
    return {
      kind: "world_lab_authoritative",
      safeToMutate: false,
      reason: "refusing WORLD-LAB authoritative DB — use a clearly named copy",
    };
  }

  if (basenameLooksLikeCopy) {
    return { kind: "copy_or_temp", safeToMutate: true, reason: "basename classified as copy/temp/fixture" };
  }

  return {
    kind: "unknown",
    safeToMutate: false,
    reason: "unknown path — require explicit .copy. / -copy- naming before mutation",
  };
}

export type TableRowCount = { table: string; count: number };

export type DbCopyReport = {
  path: string;
  classification: ReturnType<typeof classifyDbPath>;
  preflight: PreflightReport;
  schemaBefore: SchemaSnapshot;
  schemaAfter?: SchemaSnapshot;
  migrationsApplied?: string[];
  rowCountsBefore: TableRowCount[];
  rowCountsAfter?: TableRowCount[];
  mutated: boolean;
};

function openReadonly(path: string): Database.Database {
  return new Database(path, { readonly: true, fileMustExist: true });
}

function listUserTables(db: Database.Database): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function rowCounts(db: Database.Database): TableRowCount[] {
  const out: TableRowCount[] = [];
  for (const table of listUserTables(db)) {
    if (!/^[A-Za-z0-9_]+$/.test(table)) continue;
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    out.push({ table, count: row.n });
  }
  return out;
}

/**
 * Read-only preflight against a DB path. Never mutates.
 * Refuses to open missing files; does not apply migrations.
 */
export function inspectDbCopy(filePath: string): DbCopyReport {
  const abs = resolve(filePath);
  const classification = classifyDbPath(abs);
  if (!existsSync(abs)) {
    throw new Error(`DB path does not exist: ${abs}`);
  }
  if (!statSync(abs).isFile()) {
    throw new Error(`DB path is not a file: ${abs}`);
  }

  const db = openReadonly(abs);
  try {
    const schemaBefore = snapshotSqliteSchema(db);
    const preflight = inspectSchemaCompatibility(schemaBefore);
    return {
      path: abs,
      classification,
      preflight,
      schemaBefore,
      rowCountsBefore: rowCounts(db),
      mutated: false,
    };
  } finally {
    db.close();
  }
}

export type MigrateDbCopyOptions = {
  /** Required explicit opt-in. */
  applyMigrations: true;
  /** Destination path for a working copy if source is not already a copy. */
  workCopyPath?: string;
};

/**
 * Optionally apply brain migrations to a clearly named COPY only.
 * Never silently deletes/rebuilds legacy tables — migrations are additive.
 */
export function migrateDbCopy(filePath: string, options: MigrateDbCopyOptions): DbCopyReport {
  const abs = resolve(filePath);
  let target = abs;
  const classification = classifyDbPath(abs);

  if (!classification.safeToMutate) {
    if (!options.workCopyPath) {
      throw new Error(`${classification.reason}. Pass workCopyPath to create a mutable copy.`);
    }
    const work = resolve(options.workCopyPath);
    const workClass = classifyDbPath(work);
    if (!workClass.safeToMutate) {
      throw new Error(`workCopyPath is not safe to mutate: ${workClass.reason}`);
    }
    mkdirSync(dirname(work), { recursive: true });
    copyFileSync(abs, work);
    target = work;
  }

  const beforeDb = openReadonly(target);
  let schemaBefore: SchemaSnapshot;
  let rowCountsBefore: TableRowCount[];
  let preflight: PreflightReport;
  try {
    schemaBefore = snapshotSqliteSchema(beforeDb);
    rowCountsBefore = rowCounts(beforeDb);
    preflight = inspectSchemaCompatibility(schemaBefore);
  } finally {
    beforeDb.close();
  }

  if (preflight.status === "INCOMPATIBLE") {
    throw new Error("schema preflight INCOMPATIBLE — refusing to apply migrations");
  }

  const rw = new Database(target);
  let migrationsApplied: string[] = [];
  try {
    // Ensure schema_migrations exists for older copies.
    rw.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);
    migrationsApplied = applyBrainMigrations(rw);
    const schemaAfter = snapshotSqliteSchema(rw);
    const rowCountsAfter = rowCounts(rw);
    return {
      path: target,
      classification: classifyDbPath(target),
      preflight: inspectSchemaCompatibility(schemaAfter),
      schemaBefore,
      schemaAfter,
      migrationsApplied,
      rowCountsBefore,
      rowCountsAfter,
      mutated: true,
    };
  } finally {
    rw.close();
  }
}

export function formatDbCopyReport(report: DbCopyReport): string {
  const lines = [
    `DB_PATH=${report.path}`,
    `CLASSIFICATION=${report.classification.kind}`,
    `SAFE_TO_MUTATE=${report.classification.safeToMutate}`,
    `PREFLIGHT=${report.preflight.status}`,
    `MUTATED=${report.mutated}`,
    `MIGRATIONS_PRESENT=${(report.schemaBefore.migrations ?? []).join(",") || "(none)"}`,
  ];
  if (report.migrationsApplied) {
    lines.push(`MIGRATIONS_APPLIED_NOW=${report.migrationsApplied.join(",") || "(none)"}`);
  }
  lines.push("ROW_COUNTS_BEFORE=");
  for (const r of report.rowCountsBefore) lines.push(`  ${r.table}=${r.count}`);
  if (report.rowCountsAfter) {
    lines.push("ROW_COUNTS_AFTER=");
    for (const r of report.rowCountsAfter) lines.push(`  ${r.table}=${r.count}`);
  }
  return lines.join("\n");
}

/** Test helper: list applied migrations from an open path (read-only). */
export function listMigrationsAt(filePath: string): string[] {
  const db = openReadonly(resolve(filePath));
  try {
    return listAppliedMigrations(db);
  } finally {
    db.close();
  }
}
