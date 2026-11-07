import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The audit's coverage table in executable form. `scanMutatingCallSites()` re-derives the call sites from source, and
 * coverage.test.ts fails if the scan and this table disagree, so a new mutating call cannot appear unaudited.
 *
 * Verdicts (kept separate on purpose):
 *   protected     checks the signal before the mutation and bounds its awaits, or races the signal.
 *   partial       checks the signal at the start but a mutation can still follow an unguarded await.
 *   defect        reproduced with the real function in test/defects.test.ts.
 *   hypothetical  a pattern worth fixing or watching, NOT reproduced here.
 *   body-owned    lives in MinecraftBody (connection lifecycle), not in a skill.
 *   operator      developer/operator script, not reachable from the manager loop.
 *   not-a-bot     matched the pattern but is not a Mineflayer call.
 */
export type Verdict =
  "protected" | "partial" | "defect" | "hypothetical" | "body-owned" | "operator" | "not-a-bot";

export interface CoverageRow {
  readonly file: string;
  readonly calls: number;
  readonly reachedFrom: string;
  readonly cancellation: string;
  readonly verdict: Verdict;
  readonly finding?: string;
}

export const COVERAGE: readonly CoverageRow[] = [
  {
    file: "packages/skills/src/dig-abort.ts",
    calls: 2,
    reachedFrom: "executePlan -> collect/farm/blueprint-build",
    cancellation: "listener installed before bot.dig; race against abort; stopDigging on abort",
    verdict: "protected",
  },
  {
    file: "packages/skills/src/inventory.ts",
    calls: 6,
    reachedFrom: "executePlan eatFood / craftItem",
    cancellation:
      "eatFood checks signal before equip and before consume and uses waitAbortable; consume is bounded by mineflayer's CONSUME_TIMEOUT. craft checks before emptyHand and lookAt, races each recipe against abort and a 6 s deadline, and does not start another recipe while the first is in flight. A late activateBlock is refused after cancel or timeout. An inventory increase is reported.",
    verdict: "protected",
    finding: "AUD-X1 fixed",
  },
  {
    file: "packages/skills/src/inventory-service.ts",
    calls: 11,
    reachedFrom: "executePlan deposit/withdraw/share/craft; equip, toss",
    cancellation:
      "depositItem/withdrawItem check the signal after the window opens and immediately before the transfer. openWindowBounded races the remaining timeout. dropItem, equip, unequip: no check; short",
    verdict: "partial",
    finding: "AUD-C1 and AUD-C2 fixed. dropItem/equip remain unguarded",
  },
  {
    file: "packages/skills/src/furnace.ts",
    calls: 6,
    reachedFrom: "executePlan craftItem (smelt step)",
    cancellation:
      "signal checked before each furnace mutation; polling wait wakes on abort; takeOutput that already completed is reported as a real result",
    verdict: "protected",
    finding: "AUD-F1 fixed",
  },
  {
    file: "packages/skills/src/world.ts",
    calls: 5,
    reachedFrom: "executePlan sleep / attack / buildShelter / buildStructure / workstation",
    cancellation:
      "placeBlock checks the signal after equip and lookAt and immediately before each place. sleep races bot.sleep against the signal and the remaining deadline; a bot already in bed is woken and reported as INTERRUPTED. attack: single hit, no check",
    verdict: "partial",
    finding: "AUD-P1 fixed. sleep is bounded. the single attack remains unguarded",
  },
  {
    file: "packages/skills/src/combat.ts",
    calls: 5,
    reachedFrom: "executePlan attack / gatherFood (huntAnimal) / flee",
    cancellation:
      "attackHostile and huntAnimal check the signal before each attack. creeper flee holds controls for 1.4 s with no check, then clears them",
    verdict: "partial",
    finding: "AUD-H1 fixed. creeper flee remains unguarded",
  },
  {
    file: "packages/skills/src/obtain.ts",
    calls: 2,
    reachedFrom: "executePlan obtainItem",
    cancellation:
      "signal checked at entry, between steps, and before each crafting-table equip, look, and place. A place that already produced a crafting table is reported.",
    verdict: "protected",
    finding: "AUD-X2 fixed",
  },
  {
    file: "packages/skills/src/farm.ts",
    calls: 2,
    reachedFrom: "executePlan workFarmPlot",
    cancellation:
      "digUnlessAborted for digs; signal checked before each till/plant stage (354, 371, 533, 551, 690)",
    verdict: "protected",
  },
  {
    file: "packages/skills/src/doors.ts",
    calls: 1,
    reachedFrom: "executePlan returnHome / enter-home path",
    cancellation:
      "navigation takes the signal; the signal is checked again after lookAt and immediately before activateBlock. A toggle that already changed the door is reported.",
    verdict: "protected",
    finding: "AUD-X3 fixed",
  },
  {
    file: "packages/skills/src/library.ts",
    calls: 1,
    reachedFrom: "skills library openDoor",
    cancellation:
      "closeDoor does not toggle the door a second time after cancellation. If openDoor already changed the door, the result is INTERRUPTED with the observed open state.",
    verdict: "protected",
    finding: "AUD-X3 fixed",
  },
  {
    file: "packages/skills/src/mineflayer-fish-cycle.ts",
    calls: 1,
    reachedFrom: "executePlan fishShore",
    cancellation:
      "signal or cancelReason checked every 50 ms; cancel-retrieve on abort; listeners detached in finally",
    verdict: "protected",
  },
  {
    file: "packages/skills/src/fish-quota.ts",
    calls: 1,
    reachedFrom: "executePlan fishShore",
    cancellation: "matched `.deposit(` is an injected callback, not a bot method",
    verdict: "not-a-bot",
  },
  {
    file: "packages/skills/src/blueprint-build.ts",
    calls: 1,
    reachedFrom: "advanceBlueprintBuild final validation probes the workstation chest",
    cancellation: "openWindowBounded uses the build's remaining deadline; a late or cancelled window is closed and does not block the session",
    verdict: "protected",
  },
  {
    file: "packages/skills/src/climb.ts",
    calls: 6,
    reachedFrom: "executePlan (ladder)",
    cancellation:
      "loop checks the signal and clears controls; initial approach loop (8 x 2 ticks) has no check",
    verdict: "protected",
  },
  {
    file: "packages/minecraft-adapter/src/pathing.ts",
    calls: 4,
    reachedFrom: "every navigation call",
    cancellation:
      "signal checked per slice, stall watch takes the signal, haltPathfinder on abort. QA57-M1 (known): a raw bot.lookAt in detour recovery can hang the call",
    verdict: "protected",
    finding: "QA57-M1 (known, not re-reported)",
  },
  {
    file: "packages/minecraft-adapter/src/step-jump.ts",
    calls: 11,
    reachedFrom: "pathing recovery",
    cancellation: "signal checked at entry and between phases; QA57 audited these primitives",
    verdict: "protected",
  },
  {
    file: "packages/minecraft-adapter/src/local-escape.ts",
    calls: 14,
    reachedFrom: "pathing recovery",
    cancellation: "signal checked at entry; control holds are tick-bounded and cleared",
    verdict: "protected",
  },
  {
    file: "packages/minecraft-adapter/src/hazard-nav.ts",
    calls: 4,
    reachedFrom: "pathing hazard bridge",
    cancellation:
      "signal checked at entry, after equip, and immediately before placeBlock. lookAt is raced against the signal and a 1 s deadline. A placeBlock that already returned is verified and reported. retreat checks the signal before its bounded 8-tick walk; the walk itself still runs to completion.",
    verdict: "protected",
    finding: "AUD-X4 fixed",
  },
  {
    file: "packages/minecraft-adapter/src/minecraft-body.ts",
    calls: 4,
    reachedFrom: "body event handlers and body.chat/whisper",
    cancellation:
      "not skills: chat and whisper are explicit calls, respawn is the death handler, setControlState is stopPathfinding cleanup",
    verdict: "body-owned",
  },
  {
    file: "apps/orchestrator/src/atlas-cli.ts",
    calls: 1,
    reachedFrom: "operator CLI",
    cancellation: "no signal; interactive",
    verdict: "operator",
  },
  {
    file: "apps/orchestrator/src/live-curfew-test.ts",
    calls: 1,
    reachedFrom: "operator live test",
    cancellation: "no signal; interactive",
    verdict: "operator",
  },
  {
    file: "apps/orchestrator/src/live-home-test.ts",
    calls: 1,
    reachedFrom: "operator live test",
    cancellation: "no signal; interactive",
    verdict: "operator",
  },
  {
    file: "apps/orchestrator/src/live-mechanics-demo.ts",
    calls: 7,
    reachedFrom: "operator live demo (also calls transferItemToCitizen on two bodies)",
    cancellation: "no signal; interactive",
    verdict: "operator",
  },
  {
    file: "apps/orchestrator/src/live-mechanics-gauntlet.ts",
    calls: 5,
    reachedFrom: "operator live test",
    cancellation: "no signal; interactive",
    verdict: "operator",
  },
  {
    file: "apps/orchestrator/src/live-mechanics-test.ts",
    calls: 1,
    reachedFrom: "operator live test (also calls transferItemToCitizen on two bodies)",
    cancellation: "no signal; interactive",
    verdict: "operator",
  },
  {
    file: "apps/orchestrator/src/live-smoke.ts",
    calls: 1,
    reachedFrom: "operator smoke test",
    cancellation: "no signal; interactive",
    verdict: "operator",
  },
  {
    file: "apps/orchestrator/src/terrain-test.ts",
    calls: 2,
    reachedFrom: "operator live test",
    cancellation: "no signal; interactive",
    verdict: "operator",
  },
];

const PATTERN =
  /\.(dig|placeBlock|activateBlock|activateEntity|activateItem|deactivateItem|useOn|consume|craft|equip|unequip|toss|tossStack|openContainer|openChest|openFurnace|openBlock|clickWindow|putSelectedItemRange|moveSlotItem|transfer|deposit|withdraw|putInput|putFuel|takeInput|takeFuel|takeOutput|attack|sleep|wake|fish|setQuickBarSlot|respawn|chat|whisper|collectBlock|goto|setGoal|stopDigging|setControlState)\(/;

/** Canonical repository spelling for both Windows and POSIX audit paths. */
export function normalizeAuditPath(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Scans production TypeScript (tests and `testing/` helpers excluded; comment lines excluded). Keys are repo-relative. */
export function scanMutatingCallSites(
  repoRoot = fileURLToPath(new URL("../../../", import.meta.url)),
): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist") continue;
      const path = join(dir, name);
      const repositoryPath = normalizeAuditPath(relative(repoRoot, path));
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts") && !path.endsWith(".test.ts") && !repositoryPath.includes("/testing/")) {
        let n = 0;
        for (const line of readFileSync(path, "utf8").split("\n")) {
          const t = line.trim();
          if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) continue;
          if (PATTERN.test(line)) n += 1;
        }
        if (n > 0) counts[repositoryPath] = n;
      }
    }
  };
  for (const root of ["packages", "apps"]) walk(join(repoRoot, root));
  return counts;
}
