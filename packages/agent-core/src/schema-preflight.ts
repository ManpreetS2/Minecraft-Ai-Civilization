/**
 * Read-only schema compatibility inspector for main-PC transplant preflight.
 * NEVER mutates the database.
 */

export type SchemaColumn = { name: string; type: string; pk: number; notnull: number };
export type SchemaTable = { name: string; columns: SchemaColumn[] };
export type SchemaSnapshot = {
  tables: SchemaTable[];
  migrations?: string[];
};

export type PreflightStatus = "COMPATIBLE" | "MANUAL_RECONCILE_REQUIRED" | "INCOMPATIBLE";

export type PreflightFinding = {
  severity: "info" | "warn" | "error";
  code: string;
  message: string;
};

export type PreflightReport = {
  status: PreflightStatus;
  findings: PreflightFinding[];
};

const REQUIRED_BASE_TABLES = ["citizens", "events", "memories", "relationships", "llm_calls"] as const;

const PASS4_TABLES = [
  "commitments",
  "relationship_beliefs",
  "relationship_belief_evidence",
  "learned_behavior_evidence",
  "cognition_state",
  "brain_applied_events",
] as const;

const PASS5_TABLES = ["commitment_progress_events", "pending_reconsideration"] as const;

const EXPECTED_PK: Record<string, string[]> = {
  events: ["id"],
  commitments: ["id"],
  cognition_state: ["citizen_id"],
  relationship_beliefs: ["observer_citizen_id", "subject_citizen_id"],
  relationships: ["citizen_id", "other_id"],
  llm_calls: ["id"],
  brain_applied_events: ["event_id", "effect_kind", "citizen_id"],
  commitment_progress_events: ["id"],
  pending_reconsideration: ["citizen_id", "signal"],
};

const EXPECTED_COLUMNS: Record<string, string[]> = {
  events: ["id", "type", "timestamp", "citizen_id", "payload"],
  relationships: ["citizen_id", "other_id", "trust", "familiarity"],
  commitments: ["id", "owner_citizen_id", "status", "payload", "goal"],
  cognition_state: ["citizen_id", "current_high_level_goal", "updated_at"],
  llm_calls: ["id", "citizen_id", "timestamp", "ok"],
};

/**
 * Inspect a schema snapshot (from PRAGMA / information_schema dump).
 * Does not open or mutate any database file.
 */
export function inspectSchemaCompatibility(schema: SchemaSnapshot): PreflightReport {
  const findings: PreflightFinding[] = [];
  const byName = new Map(schema.tables.map((t) => [t.name, t]));

  if (!schema.migrations || schema.migrations.length === 0) {
    findings.push({
      severity: "warn",
      code: "MISSING_SCHEMA_MIGRATIONS",
      message: "schema_migrations absent or empty — versioned brain migrations cannot be confirmed",
    });
  }

  for (const table of REQUIRED_BASE_TABLES) {
    if (!byName.has(table)) {
      findings.push({
        severity: "error",
        code: "MISSING_BASE_TABLE",
        message: `required base table missing: ${table}`,
      });
    }
  }

  for (const table of PASS4_TABLES) {
    if (!byName.has(table)) {
      findings.push({
        severity: "warn",
        code: "MISSING_PASS4_TABLE",
        message: `Pass-4 brain table missing (additive migration expected): ${table}`,
      });
    }
  }

  for (const table of PASS5_TABLES) {
    if (!byName.has(table)) {
      findings.push({
        severity: "warn",
        code: "MISSING_PASS5_TABLE",
        message: `Pass-5 integrity table missing (additive migration expected): ${table}`,
      });
    }
  }

  for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
    const t = byName.get(table);
    if (!t) continue;
    const names = new Set(t.columns.map((c) => c.name));
    for (const col of cols) {
      if (!names.has(col)) {
        findings.push({
          severity: "error",
          code: "MISSING_COLUMN",
          message: `${table} missing expected column ${col}`,
        });
      }
    }
    // Same table name with unexpected PK → incompatible
    const expectedPk = EXPECTED_PK[table];
    if (expectedPk) {
      const actualPk = t.columns
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      if (actualPk.length > 0 && actualPk.join(",") !== expectedPk.join(",")) {
        findings.push({
          severity: "error",
          code: "INCOMPATIBLE_PRIMARY_KEY",
          message: `${table} primary key is [${actualPk.join(",")}] expected [${expectedPk.join(",")}]`,
        });
      }
    }
  }

  // Richer compatible superset: extra columns on known tables → warn only
  for (const table of ["commitments", "llm_calls", "cognition_state", "events"]) {
    const t = byName.get(table);
    if (!t) continue;
    const expected = new Set(EXPECTED_COLUMNS[table] ?? []);
    const extras = t.columns.map((c) => c.name).filter((n) => !expected.has(n));
    if (extras.length > 0 && expected.size > 0) {
      findings.push({
        severity: "info",
        code: "RICHER_SUPERSET",
        message: `${table} has extra columns (${extras.join(", ")}) — may be compatible if PKs align`,
      });
    }
  }

  // llm_calls budget columns
  const llm = byName.get("llm_calls");
  if (llm) {
    const names = new Set(llm.columns.map((c) => c.name));
    for (const col of ["decision_category", "mc_day", "counts_toward_budget", "decision_id"]) {
      if (!names.has(col)) {
        findings.push({
          severity: "warn",
          code: "MISSING_BUDGET_COLUMN",
          message: `llm_calls missing durable budget column ${col} (Pass-5 additive)`,
        });
      }
    }
  }

  const hasError = findings.some((f) => f.severity === "error");
  const hasWarn = findings.some((f) => f.severity === "warn");
  const status: PreflightStatus = hasError
    ? "INCOMPATIBLE"
    : hasWarn
      ? "MANUAL_RECONCILE_REQUIRED"
      : "COMPATIBLE";

  return { status, findings };
}

/** Build a SchemaSnapshot from a better-sqlite3 connection without mutating it. */
export function snapshotSqliteSchema(db: {
  // better-sqlite3 Statement generics are invariant; keep this read-only-friendly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare: (sql: string) => { all: (...args: any[]) => any[] };
}): SchemaSnapshot {
  const tableRows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as Array<{ name: string }>;
  const tables: SchemaTable[] = tableRows.map((t) => {
    if (!/^[A-Za-z0-9_]+$/.test(t.name)) {
      throw new Error(`refusing to inspect unexpected table name: ${t.name}`);
    }
    const columns = (
      db.prepare(`PRAGMA table_info(${t.name})`).all() as Array<{
        name: string;
        type: string;
        pk: number;
        notnull: number;
      }>
    ).map((c) => ({ name: c.name, type: c.type, pk: c.pk, notnull: c.notnull }));
    return { name: t.name, columns };
  });

  let migrations: string[] | undefined;
  if (tables.some((t) => t.name === "schema_migrations")) {
    migrations = (
      db.prepare(`SELECT name FROM schema_migrations ORDER BY name`).all() as Array<{ name: string }>
    ).map((r) => r.name);
  }

  return { tables, migrations };
}
