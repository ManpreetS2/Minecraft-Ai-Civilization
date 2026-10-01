#!/usr/bin/env tsx
/**
 * READ-ONLY cloud integration check.
 * Does not modify DB, git, env files, start Paper, or connect bots.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { loadConfig } from "../packages/shared/src/config.js";
import { workspaceRoot } from "../packages/shared/src/paths.js";

type CheckResult = {
  CURRENT_SHA: string;
  CURRENT_BRANCH: string;
  CLOUD_COMMITS_PRESENT: string;
  TYPECHECK_READY: string;
  TEST_READY: string;
  BRAIN_FLAG_DEFAULT: string;
  DB_PATH: string;
  DB_PATH_SAFE: string;
  MINECRAFT_PORT: string;
  LIVE_PORT_SAFE: string;
  SCHEMA_PREFLIGHT_AVAILABLE: string;
  WARNINGS: string[];
};

const CLOUD_MARKERS = [
  "packages/agent-core/src/brain-persistence.ts",
  "packages/agent-core/src/citizen-brain-adapter.ts",
  "packages/agent-core/src/schema-preflight.ts",
  "packages/cognition/src/router.ts",
  "docs/CLOUD_TO_MAIN_TRANSPLANT.md",
];

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function main(): number {
  const root = workspaceRoot(dirname(fileURLToPath(import.meta.url)));
  process.chdir(root);
  const warnings: string[] = [];

  const sha = git("rev-parse HEAD") || "unknown";
  const branch = git("rev-parse --abbrev-ref HEAD") || "unknown";

  const present = CLOUD_MARKERS.filter((f) => existsSync(resolve(root, f)));
  const missing = CLOUD_MARKERS.filter((f) => !existsSync(resolve(root, f)));
  if (missing.length) warnings.push(`missing cloud marker files: ${missing.join(", ")}`);

  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
    packageManager?: string;
  };
  const typecheckReady = Boolean(pkg.scripts?.typecheck);
  const testReady = Boolean(pkg.scripts?.test);
  if (!typecheckReady) warnings.push("package.json missing typecheck script");
  if (!testReady) warnings.push("package.json missing test script");

  const cfg = loadConfig({
    ...process.env,
  });

  const brainFlagDefault =
    cfg.CITIZEN_BRAIN_V2_ENABLED === false ? "false" : String(cfg.CITIZEN_BRAIN_V2_ENABLED);
  if (cfg.CITIZEN_BRAIN_V2_ENABLED) {
    warnings.push("CITIZEN_BRAIN_V2_ENABLED is true — unexpected for cloud default / transplant safety");
  }

  const dbPath = cfg.DATABASE_PATH;
  const dbBase = dbPath.replace(/\\/g, "/").split("/").pop() ?? dbPath;
  const dbLooksProduction = dbBase === "civilization.sqlite";
  const dbPathSafe = !dbLooksProduction || dbPath.includes("copy") || dbPath.includes("tmp");
  if (dbLooksProduction) {
    warnings.push("DATABASE_PATH points at civilization.sqlite — never migrate the only copy");
  }

  const port = cfg.MINECRAFT_PORT;
  const livePortSafe = port !== 25565 || cfg.AUTO_START_PAPER === false;
  if (port === 25565 && cfg.AUTO_START_PAPER) {
    warnings.push("MINECRAFT_PORT=25565 with AUTO_START_PAPER=true — dangerous for accidental live bind");
  }

  const schemaPreflightAvailable = existsSync(
    resolve(root, "packages/agent-core/src/schema-preflight.ts"),
  );

  if (process.env.NVIDIA_API_KEY) warnings.push("NVIDIA_API_KEY is set in environment (CI should unset)");
  if (process.env.GEMINI_API_KEY) warnings.push("GEMINI_API_KEY is set in environment (CI should unset)");

  const result: CheckResult = {
    CURRENT_SHA: sha,
    CURRENT_BRANCH: branch,
    CLOUD_COMMITS_PRESENT: `${present.length}/${CLOUD_MARKERS.length}`,
    TYPECHECK_READY: typecheckReady ? "YES" : "NO",
    TEST_READY: testReady ? "YES" : "NO",
    BRAIN_FLAG_DEFAULT: brainFlagDefault,
    DB_PATH: dbPath,
    DB_PATH_SAFE: dbPathSafe ? "YES" : "CAUTION",
    MINECRAFT_PORT: String(port),
    LIVE_PORT_SAFE: livePortSafe ? "YES" : "CAUTION",
    SCHEMA_PREFLIGHT_AVAILABLE: schemaPreflightAvailable ? "YES" : "NO",
    WARNINGS: warnings,
  };

  for (const [k, v] of Object.entries(result)) {
    if (k === "WARNINGS") {
      console.log(`WARNINGS=${warnings.length ? warnings.join(" | ") : "(none)"}`);
    } else {
      console.log(`${k}=${v}`);
    }
  }

  if (cfg.CITIZEN_BRAIN_V2_ENABLED === true) {
    console.error("integration-check: DANGEROUS_CONFIG (CITIZEN_BRAIN_V2_ENABLED=true)");
    return 2;
  }
  if (!typecheckReady || !testReady || !schemaPreflightAvailable) {
    console.error("integration-check: NOT_READY");
    return 1;
  }
  return 0;
}

process.exit(main());
