#!/usr/bin/env tsx
/**
 * DB copy inspect / optional migrate harness CLI.
 * Default: read-only preflight. Migrations require --apply-migrations and a safe copy path.
 */
import { resolve } from "node:path";
import {
  classifyDbPath,
  formatDbCopyReport,
  inspectDbCopy,
  migrateDbCopy,
} from "../packages/agent-core/src/db-copy-harness.js";

function usage(): never {
  console.error(`Usage:
  pnpm cloud:db-copy-check -- <path-to-sqlite> [--apply-migrations --work-copy <safe-copy-path>]

Default is READ-ONLY preflight.
Refuses production civilization.sqlite and WORLD-LAB authoritative paths for mutation.
`);
  process.exit(2);
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) usage();

  const apply = args.includes("--apply-migrations");
  const pathArg = args.find((a) => !a.startsWith("--"));
  if (!pathArg) usage();

  const workIdx = args.indexOf("--work-copy");
  const workCopy = workIdx >= 0 ? args[workIdx + 1] : undefined;

  const abs = resolve(pathArg!);
  const classification = classifyDbPath(abs);
  console.log(`CLASSIFY=${classification.kind}`);
  console.log(`REASON=${classification.reason}`);

  if (!apply) {
    const report = inspectDbCopy(abs);
    console.log(formatDbCopyReport(report));
    console.log(`PREFLIGHT_FINDINGS=${report.preflight.findings.length}`);
    for (const f of report.preflight.findings) {
      console.log(`  [${f.severity}] ${f.code}: ${f.message}`);
    }
    return report.preflight.status === "INCOMPATIBLE" ? 1 : 0;
  }

  if (!workCopy && !classification.safeToMutate) {
    console.error("Refusing --apply-migrations on unsafe path without --work-copy");
    return 2;
  }

  const report = migrateDbCopy(abs, {
    applyMigrations: true,
    workCopyPath: workCopy,
  });
  console.log(formatDbCopyReport(report));
  return 0;
}

process.exit(main());
