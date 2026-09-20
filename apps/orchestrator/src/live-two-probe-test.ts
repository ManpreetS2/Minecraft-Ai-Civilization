import { loadEnv } from "./env.js";
import { evaluateTwoProbeTestLaunch } from "./two-probe-test-guard.js";

function printNeeds(): void {
  console.log("");
  console.log("Two-probe harness is prepared only.");
  console.log("Remaining blockers until an actual concurrent live run:");
  console.log("- HomeProbe independent live mechanics PASS on WORLD-LAB");
  console.log("- MineProbe independent live mechanics PASS (natural coal/iron, not manufactured)");
  console.log("- RED exclusive WORLD-LAB approval and non-overlapping mutation bounds");
  console.log("- BLUE confirmation that shared pathfinder/adapter work is idle");
  console.log("- Distinct identities HomeProbe + MineProbe, distinct permitted chests");
  console.log("- Separate sqlite/body locks; do not share citizen civilization.sqlite");
  console.log("- Explicit TWO_PROBE_* approval flags");
  console.log("- Never pnpm sim:start; never five real citizens");
}

async function main(): Promise<void> {
  loadEnv();
  const target = evaluateTwoProbeTestLaunch(process.env);
  if (!target.allowed) {
    console.error(target.error);
    printNeeds();
    process.exit(2);
    return;
  }
  console.error("Two-probe live run is still blocked: independent HomeProbe and MineProbe live PASSes have not both been recorded in this workspace.");
  printNeeds();
  process.exit(2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  printNeeds();
  process.exit(1);
});
