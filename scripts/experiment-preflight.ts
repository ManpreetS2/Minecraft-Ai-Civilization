/** Offline only: reads a JSON manifest, validates paths, never opens a world/database or a provider. */
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { validateExperimentPreflight } from "../packages/agent-core/src/experiment-preflight.js";

const [manifestPath, authoritativeRoot] = process.argv.slice(2);
if (
  !manifestPath ||
  !authoritativeRoot ||
  !isAbsolute(authoritativeRoot) ||
  !manifestPath.endsWith(".json")
) {
  console.error(
    "Usage: pnpm experiment:preflight <manifest.json> <absolute-authoritative-checkout-root>",
  );
  process.exitCode = 2;
} else {
  try {
    const file = resolve(manifestPath);
    if (statSync(file).size > 1_048_576) throw new Error("oversized manifest");
    const manifest: unknown = JSON.parse(readFileSync(file, "utf8"));
    const report = validateExperimentPreflight(manifest, [authoritativeRoot]);
    console.log(JSON.stringify(report, null, 2));
    // This candidate deliberately cannot pass a live readiness gate.
    process.exitCode = report.readyForLive ? 0 : 2;
  } catch {
    // Do not echo raw manifest data, exception source text, or secrets.
    console.error(
      JSON.stringify({
        status: "NOT_READY",
        readyForLive: false,
        configurationErrors: ["MANIFEST_READ_FAILED"],
      }),
    );
    process.exitCode = 2;
  }
}
