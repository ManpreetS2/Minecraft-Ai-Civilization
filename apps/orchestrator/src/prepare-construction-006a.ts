/**
 * Mission 006A — prepare isolated World-Lab copy for construction experiments.
 *
 * Default: dry-run validation + write manifest (no copy, no Paper).
 * Copy only with:  pnpm construction:prepare-006a -- --execute-copy
 *
 * Never starts Paper / Mineflayer / RCON.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { workspaceRoot } from "@civ/shared";
import {
  CONSTRUCTION_EXPERIMENT_ENV_PINS,
  ISOLATED_EVIDENCE_REL,
  ISOLATED_PAPER_PORT,
  ISOLATED_ROOT_REL,
  ISOLATED_RCON_PORT,
  ISOLATED_SQLITE_REL,
  ISOLATED_WORLD_LAB_REL,
  ORIGINAL_WORLD_LAB_DIR,
  ORIGINAL_WORLD_LAB_SQLITE,
  assertIsolatedNotOriginal,
  originalWorldLabFingerprint,
  padSafeFromSettlementHomes,
  PROPOSED_CONSTRUCTION_PAD,
  validatePathExists,
} from "./construction-experiment-guard.js";

function sha256File(path: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function parseArgs(argv: string[]): { executeCopy: boolean } {
  return { executeCopy: argv.includes("--execute-copy") };
}

function patchIsolatedServerProperties(isolatedRoot: string): void {
  const propsPath = join(isolatedRoot, "server.properties");
  if (!existsSync(propsPath)) {
    throw new Error(`Missing server.properties in isolated copy: ${propsPath}`);
  }
  let text = readFileSync(propsPath, "utf8");
  text = text.replace(/^server-port=\d+/m, `server-port=${ISOLATED_PAPER_PORT}`);
  text = text.replace(/^rcon\.port=\d+/m, `rcon.port=${ISOLATED_RCON_PORT}`);
  writeFileSync(propsPath, text, "utf8");
}

function robocopyWorldLab(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  // Exclude logs / cache noise; copy world + jar + config.
  const result = spawnSync(
    "robocopy",
    [
      src,
      dest,
      "/E",
      "/XD",
      "logs",
      "cache",
      ".git",
      "/NFL",
      "/NDL",
      "/NJH",
      "/NJS",
      "/nc",
      "/ns",
      "/np",
    ],
    { encoding: "utf8" },
  );
  // robocopy exit codes 0–7 are success-ish
  const code = result.status ?? 1;
  if (code >= 8) {
    throw new Error(`robocopy failed code=${code}: ${result.stderr || result.stdout}`);
  }
}

function writeEnvPins(root: string): void {
  const lines = Object.entries({
    ...CONSTRUCTION_EXPERIMENT_ENV_PINS,
    CONSTRUCTION_EXPERIMENT_WORLD_LAB: ISOLATED_WORLD_LAB_REL,
    CONSTRUCTION_EXPERIMENT_EVIDENCE_DIR: ISOLATED_EVIDENCE_REL,
    CONSTRUCTION_EXPERIMENT_RCON_PORT: String(ISOLATED_RCON_PORT),
  }).map(([k, v]) => `${k}=${v}`);
  writeFileSync(join(root, ".env.construction-006a"), `${lines.join("\n")}\n`, "utf8");
}

function writeRollback(root: string, manifest: Record<string, unknown>): void {
  const md = `# Construction 006A — Rollback

## Sacred originals (never delete / overwrite)

- World-Lab: \`${manifest.originalWorldLab}\`
- SQLite: \`${manifest.originalSqlite}\`
- server.properties SHA256: \`${manifest.originalServerPropertiesSha256}\`
- sqlite SHA256: \`${manifest.originalSqliteSha256}\`

## Disposable isolated tree

- Root: \`${manifest.isolatedRoot}\`
- World-Lab copy: \`${manifest.isolatedWorldLab}\`
- SQLite copy: \`${manifest.isolatedSqlite}\`

## Rollback

1. Stop any Paper on ports **${ISOLATED_PAPER_PORT}** / RCON **${ISOLATED_RCON_PORT}** (if ever started).
2. Delete only the disposable tree:
   \`\`\`
   Remove-Item -Recurse -Force "${manifest.isolatedRoot}"
   \`\`\`
3. Confirm originals still match recorded SHA256 hashes.
4. Do **not** restore by copying isolated → original.

## Emergency stop (if live ever authorized later)

1. Disconnect Atlas / kill Mineflayer process.
2. \`stop\` on Paper console (isolated only).
3. Do not run commands against 25567 / original world-lab.
`;
  writeFileSync(join(root, "ROLLBACK.md"), md, "utf8");
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = workspaceRoot();
  const isolatedRoot = join(root, ISOLATED_ROOT_REL);
  const isolatedWl = join(root, ISOLATED_WORLD_LAB_REL);
  const isolatedDb = join(root, ISOLATED_SQLITE_REL);

  console.log("=== Mission 006A prepare (NO Paper / NO Mineflayer) ===");
  console.log(`workspace: ${root}`);
  console.log(`executeCopy: ${args.executeCopy}`);

  const srcWl = validatePathExists(ORIGINAL_WORLD_LAB_DIR, "original world-lab");
  const srcDb = validatePathExists(ORIGINAL_WORLD_LAB_SQLITE, "original sqlite");
  if (!srcWl.ok) {
    console.error(srcWl.error);
    process.exit(1);
  }
  if (!srcDb.ok) {
    console.error(srcDb.error);
    process.exit(1);
  }

  const originalProps = join(srcWl.resolved, "server.properties");
  const propsSha = sha256File(originalProps);
  const dbSha = sha256File(srcDb.resolved);
  const fp = originalWorldLabFingerprint();
  const pad = padSafeFromSettlementHomes(PROPOSED_CONSTRUCTION_PAD);

  const isolationCheck = assertIsolatedNotOriginal({
    isolatedWorldLab: ISOLATED_WORLD_LAB_REL,
    isolatedSqlite: ISOLATED_SQLITE_REL,
  });
  // Before copy, isolated paths may not exist — only check they don't alias when they resolve
  if (existsSync(isolatedWl) || existsSync(isolatedDb)) {
    if (!isolationCheck.ok) {
      console.error(isolationCheck.error);
      process.exit(1);
    }
  }

  const manifest: Record<string, unknown> = {
    mission: "006A",
    preparedAt: new Date().toISOString(),
    executeCopy: args.executeCopy,
    liveMinecraftAuthorized: false,
    autoStartPaper: false,
    originalWorldLab: srcWl.real,
    originalSqlite: srcDb.real,
    originalServerPropertiesSha256: propsSha,
    originalSqliteSha256: dbSha,
    originalFingerprint: fp,
    isolatedRoot,
    isolatedWorldLab: isolatedWl,
    isolatedSqlite: isolatedDb,
    isolatedPaperPort: ISOLATED_PAPER_PORT,
    isolatedRconPort: ISOLATED_RCON_PORT,
    proposedPad: PROPOSED_CONSTRUCTION_PAD,
    padSafety: pad,
    envPins: CONSTRUCTION_EXPERIMENT_ENV_PINS,
    note: "Offline preparation only. Physical stages require separate operator authorization.",
  };

  mkdirSync(isolatedRoot, { recursive: true });
  mkdirSync(join(root, ISOLATED_EVIDENCE_REL), { recursive: true });
  writeEnvPins(isolatedRoot);
  writeRollback(isolatedRoot, manifest);

  if (!args.executeCopy) {
    console.log("Dry-run complete. Manifest written. No world files copied.");
    console.log(`To create disposable copy: pnpm construction:prepare-006a -- --execute-copy`);
    console.log(JSON.stringify({ ok: true, copied: false, manifestPath: join(isolatedRoot, "manifest.json") }, null, 2));
    return;
  }

  if (existsSync(isolatedWl) && readdirSync(isolatedWl).length > 0) {
    console.error(`Refusing overwrite of existing isolated world-lab: ${isolatedWl}`);
    console.error("Delete the disposable tree first (see ROLLBACK.md) or choose a new destination.");
    process.exit(1);
  }

  console.log("Copying World-Lab → isolated (this does not start Paper)...");
  robocopyWorldLab(srcWl.resolved, isolatedWl);
  mkdirSync(join(root, ISOLATED_ROOT_REL), { recursive: true });
  copyFileSync(srcDb.resolved, isolatedDb);
  // Also copy wal/shm if present (read consistency); safe for offline prep
  for (const suffix of ["-wal", "-shm"]) {
    const side = `${srcDb.resolved}${suffix}`;
    if (existsSync(side)) copyFileSync(side, `${isolatedDb}${suffix}`);
  }
  patchIsolatedServerProperties(isolatedWl);

  const postIsolation = assertIsolatedNotOriginal({
    isolatedWorldLab: ISOLATED_WORLD_LAB_REL,
    isolatedSqlite: ISOLATED_SQLITE_REL,
  });
  if (!postIsolation.ok) {
    console.error(postIsolation.error);
    process.exit(1);
  }

  // Re-hash originals to prove they were not modified by the copy
  const propsShaAfter = sha256File(originalProps);
  const dbShaAfter = sha256File(srcDb.resolved);
  if (propsShaAfter !== propsSha || dbShaAfter !== dbSha) {
    console.error("CRITICAL: original World-Lab fingerprints changed during copy — abort and investigate");
    process.exit(1);
  }

  manifest.copied = true;
  manifest.isolatedServerPropertiesSha256 = sha256File(join(isolatedWl, "server.properties"));
  manifest.isolatedSqliteSha256 = sha256File(isolatedDb);
  manifest.originalUnchangedAfterCopy = true;
  writeRollback(isolatedRoot, manifest);

  console.log("Isolated copy ready. Original fingerprints unchanged.");
  console.log(JSON.stringify({ ok: true, copied: true, isolatedWl, isolatedDb, ports: { paper: ISOLATED_PAPER_PORT, rcon: ISOLATED_RCON_PORT } }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
