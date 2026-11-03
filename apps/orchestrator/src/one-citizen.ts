#!/usr/bin/env tsx
/**
 * One-citizen guarded launcher.
 *
 * Cloud-safe: default is --dry-run. Live mode refuses unsafe config and must
 * not be launched from cloud environments against production civilization ports.
 *
 * DO NOT use this to mutate a real Minecraft world from cloud.
 */

import { loadConfig, resolveLlmModel, type AppConfig } from "@civ/shared";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FORBIDDEN_PORTS = new Set([25565, 25566]);
const ALLOWED_PORT = 25567;
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);
const PROBE_IDENTITIES = new Set([
  "probe",
  "test",
  "tester",
  "bot_test",
  "worldlab",
  "world-lab",
  "fixture",
]);

export type OneCitizenArgs = {
  dryRun: boolean;
  citizen: string;
  host?: string;
  port?: number;
  databasePath?: string;
  autoStartPaper?: boolean;
  assignWorkRoles?: boolean;
  llmProvider?: string;
  llmModel?: string;
  /** Require 127.0.0.1/localhost (default true). */
  strictLocalhost?: boolean;
  /** When true, require DB file to exist (default false for dry-run path validation-only). */
  requireDbExists?: boolean;
};

export type LaunchGuardViolation = {
  code: string;
  message: string;
};

export type OneCitizenPlan = {
  mode: "dry-run" | "live";
  citizen: string;
  host: string;
  port: number;
  databasePath: string;
  modelProvider: string;
  modelName: string;
  willStartPaper: boolean;
  worldMutation: boolean;
  liveConnectAttempted: boolean;
  violations: LaunchGuardViolation[];
  safe: boolean;
};

export function parseArgs(argv: string[]): OneCitizenArgs {
  const args: OneCitizenArgs = {
    dryRun: argv.includes("--dry-run") || !argv.includes("--live"),
    citizen: "Atlas",
    strictLocalhost: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--citizen" && next) {
      args.citizen = next;
      i += 1;
    } else if (a === "--host" && next) {
      args.host = next;
      i += 1;
    } else if (a === "--port" && next) {
      args.port = Number(next);
      i += 1;
    } else if (a === "--db" && next) {
      args.databasePath = next;
      i += 1;
    } else if (a === "--live") {
      args.dryRun = false;
    } else if (a === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

function isForbiddenDb(databasePath: string): boolean {
  const dbNorm = databasePath.replace(/\\/g, "/").toLowerCase();
  const base = basename(dbNorm);
  // Production civilization DB — never allowed.
  if (base === "civilization.sqlite") return true;
  if (dbNorm.includes("/data/civilization.sqlite")) return true;
  return false;
}

function isWorldLabDb(databasePath: string): boolean {
  const base = basename(databasePath.replace(/\\/g, "/")).toLowerCase();
  return base.includes("world-lab") && base.endsWith(".sqlite");
}

export function evaluateOneCitizenLaunch(
  args: OneCitizenArgs,
  config: AppConfig = loadConfig(),
): OneCitizenPlan {
  const host = args.host ?? config.MINECRAFT_HOST;
  const port = args.port ?? config.MINECRAFT_PORT;
  const databasePath = resolve(args.databasePath ?? config.DATABASE_PATH);
  const citizenCount = config.SIM_CITIZEN_COUNT;
  const autoStartPaper = args.autoStartPaper ?? config.AUTO_START_PAPER;
  const assignWorkRoles = args.assignWorkRoles ?? config.SIM_ASSIGN_WORK_ROLES;
  const modelProvider = args.llmProvider ?? (config.LLM_ENABLED ? config.LLM_PROVIDER : "heuristic");
  const modelName = args.llmModel ?? (config.LLM_ENABLED ? resolveLlmModel(config) : "heuristic");
  const strictLocalhost = args.strictLocalhost !== false;

  const violations: LaunchGuardViolation[] = [];

  if (FORBIDDEN_PORTS.has(port)) {
    violations.push({
      code: "FORBIDDEN_PORT",
      message: `Port ${port} is forbidden for one-citizen world-lab (blocks 25565/25566)`,
    });
  } else if (port !== ALLOWED_PORT) {
    violations.push({
      code: "UNEXPECTED_PORT",
      message: `Port ${port} is not the world-lab port ${ALLOWED_PORT}`,
    });
  }

  if (strictLocalhost && !ALLOWED_HOSTS.has(host)) {
    violations.push({
      code: "UNEXPECTED_HOST",
      message: `Host ${host} rejected; strict localhost required (127.0.0.1)`,
    });
  }

  if (isForbiddenDb(databasePath)) {
    violations.push({
      code: "FORBIDDEN_DB",
      message: `Database path ${databasePath} looks like production civilization.sqlite`,
    });
  } else if (!isWorldLabDb(databasePath)) {
    violations.push({
      code: "MISSING_WORLD_LAB_DB",
      message: `Database path must be a world-lab *.sqlite file (got ${databasePath})`,
    });
  }

  if (args.requireDbExists && !existsSync(databasePath)) {
    violations.push({
      code: "DB_NOT_FOUND",
      message: `WORLD-LAB DB does not exist: ${databasePath}`,
    });
  }

  if (citizenCount !== 1) {
    violations.push({
      code: "CITIZEN_COUNT",
      message: `SIM_CITIZEN_COUNT must be 1 for one-citizen launcher (got ${citizenCount})`,
    });
  }

  if (autoStartPaper) {
    violations.push({
      code: "AUTO_START_PAPER",
      message: "AUTO_START_PAPER=true is forbidden for one-citizen launcher",
    });
  }

  if (assignWorkRoles) {
    violations.push({
      code: "ASSIGN_WORK_ROLES",
      message: "SIM_ASSIGN_WORK_ROLES=true is forbidden for one-citizen launcher",
    });
  }

  const identity = args.citizen.trim().toLowerCase();
  if (
    !identity ||
    PROBE_IDENTITIES.has(identity) ||
    identity.startsWith("probe") ||
    identity.startsWith("test_")
  ) {
    violations.push({
      code: "PROBE_IDENTITY",
      message: `Citizen identity "${args.citizen}" looks like a probe/test identity`,
    });
  }

  const mode = args.dryRun ? "dry-run" : "live";
  const safe = violations.length === 0;
  const worldMutation = false; // cloud entrypoint never mutates
  const liveConnectAttempted = false;

  return {
    mode,
    citizen: args.citizen,
    host,
    port,
    databasePath,
    modelProvider,
    modelName,
    willStartPaper: false,
    worldMutation,
    liveConnectAttempted,
    violations,
    safe,
  };
}

export function formatDryRunReport(plan: OneCitizenPlan): string {
  const lines = [
    "=== world-lab:one-citizen ===",
    `state:              ${plan.mode}`,
    `citizen:            ${plan.citizen}`,
    `host/port:          ${plan.host}:${plan.port}`,
    `DB path:            ${plan.databasePath}`,
    `model provider:     ${plan.modelProvider}`,
    `model:              ${plan.modelName}`,
    `Paper will start:   ${plan.willStartPaper ? "YES" : "NO"}`,
    `world mutation:     ${plan.worldMutation ? "YES" : "NO"}`,
    `live connect:       ${plan.liveConnectAttempted ? "YES" : "NO"}`,
    `guards:             ${plan.safe ? "PASS" : "FAIL"}`,
  ];
  if (plan.violations.length > 0) {
    lines.push("violations:");
    for (const v of plan.violations) {
      lines.push(`  - [${v.code}] ${v.message}`);
    }
  }
  if (plan.mode === "live" && !plan.safe) {
    lines.push("LIVE MODE REFUSED: unsafe configuration.");
  }
  if (plan.mode === "live" && plan.safe) {
    lines.push("LIVE MODE: guards passed, but this cloud entrypoint will not connect.");
    lines.push("Run live only on the main gaming PC against an isolated world-lab server.");
  }
  return lines.join("\n");
}

export function main(argv = process.argv.slice(2)): number {
  const args = parseArgs(argv);
  const config = loadConfig(process.env);
  const plan = evaluateOneCitizenLaunch(args, config);
  console.log(formatDryRunReport(plan));

  if (args.dryRun) {
    return 0;
  }
  if (!plan.safe) {
    console.error("Refusing live one-citizen launch due to guard violations.");
    return 2;
  }
  console.error("Live one-citizen launch is disabled in this cloud-safe entrypoint (no Mineflayer connect).");
  return 3;
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  process.exitCode = main();
}
