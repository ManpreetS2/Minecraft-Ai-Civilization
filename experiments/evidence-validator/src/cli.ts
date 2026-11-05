#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateExperimentEvidence, type ValidatorInput } from "./validator.js";
import { formatHumanReport, formatJsonReport } from "./report.js";
import {
  experimentManifestSchema,
  journalRowSchema,
  eventStreamItemSchema,
  persistentFactItemSchema,
  type JournalRow,
  type EventStreamItem,
  type PersistentFactItem,
} from "./schemas.js";

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "strict") {
        result[key] = true;
      } else if (i + 1 < args.length && !args[i + 1]!.startsWith("--")) {
        result[key] = args[i + 1]!;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

export function runCli(argv: string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv);

  if (args.help || argv.length === 0) {
    console.log(`
Antigravity Experiment Evidence Validator CLI

Usage:
  pnpm exec tsx experiments/evidence-validator/src/cli.ts [options]

Options:
  --manifest <path>      Path to experiment manifest JSON
  --journal <path>       Path to operator evidence journal JSONL
  --events <path>        Path to events stream JSON or JSONL
  --facts <path>         Path to citizen persistent facts JSON
  --deliveries <path>    Path to citizen event deliveries JSON
  --inventories <path>   Path to final inventories JSON
  --output <path>        Output file for machine-readable JSON report
  --summary <path>       Output file for human-readable Markdown summary
  --strict               Exit with code 2 if overall status is NOT_PROVEN or VIOLATIONS_DETECTED
  --help                 Show this help message
`);
    return 0;
  }

  const input: ValidatorInput = {};

  // 1. Manifest
  if (typeof args.manifest === "string") {
    try {
      const content = readFileSync(resolve(args.manifest), "utf8");
      input.manifest = experimentManifestSchema.parse(JSON.parse(content));
    } catch (err) {
      console.error(`[validator] Failed to read or parse manifest: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
  }

  // 2. Journal
  if (typeof args.journal === "string") {
    try {
      const content = readFileSync(resolve(args.journal), "utf8");
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      input.rawJournalLines = lines;
      input.journalRows = lines.map((l) => journalRowSchema.parse(JSON.parse(l))) as JournalRow[];
    } catch (err) {
      console.error(`[validator] Failed to read or parse journal: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
  }

  // 3. Events
  if (typeof args.events === "string") {
    try {
      const content = readFileSync(resolve(args.events), "utf8");
      if (content.trim().startsWith("[")) {
        input.events = JSON.parse(content) as EventStreamItem[];
      } else {
        input.events = content
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0)
          .map((l) => eventStreamItemSchema.parse(JSON.parse(l)));
      }
    } catch (err) {
      console.error(`[validator] Failed to read or parse events: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
  }

  // 4. Facts
  if (typeof args.facts === "string") {
    try {
      const content = readFileSync(resolve(args.facts), "utf8");
      if (content.trim().startsWith("[")) {
        input.facts = JSON.parse(content) as PersistentFactItem[];
      } else {
        input.facts = content
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0)
          .map((l) => persistentFactItemSchema.parse(JSON.parse(l)));
      }
    } catch (err) {
      console.error(`[validator] Failed to read or parse facts: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
  }

  // 5. Deliveries
  if (typeof args.deliveries === "string") {
    try {
      const content = readFileSync(resolve(args.deliveries), "utf8");
      input.deliveries = JSON.parse(content);
    } catch (err) {
      console.error(`[validator] Failed to read deliveries: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
  }

  // 6. Inventories
  if (typeof args.inventories === "string") {
    try {
      const content = readFileSync(resolve(args.inventories), "utf8");
      input.finalInventories = JSON.parse(content);
    } catch (err) {
      console.error(`[validator] Failed to read inventories: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
  }

  // Run validation
  const report = validateExperimentEvidence(input);
  const jsonReport = formatJsonReport(report);
  const humanReport = formatHumanReport(report);

  if (typeof args.output === "string") {
    writeFileSync(resolve(args.output), jsonReport, "utf8");
    console.log(`[validator] JSON report written to: ${args.output}`);
  }

  if (typeof args.summary === "string") {
    writeFileSync(resolve(args.summary), humanReport, "utf8");
    console.log(`[validator] Markdown summary written to: ${args.summary}`);
  }

  // Always output concise human summary to stdout if no explicit summary file requested
  if (!args.summary && !args.output) {
    console.log(humanReport);
  } else {
    console.log(`[validator] Result: ${report.overallStatus} (Verified: ${report.summary.verifiedActions}, Violations: ${report.violations.length})`);
  }

  if (args.strict && report.overallStatus !== "VERIFIED") {
    return 2;
  }

  return 0;
}

const entry = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (
  /experiments\/evidence-validator\/src\/cli\.(ts|js)$/.test(entry) ||
  entry.endsWith("/civ-evidence-validator")
) {
  const code = runCli();
  process.exitCode = code;
}
