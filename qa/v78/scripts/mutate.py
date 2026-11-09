#!/usr/bin/env python3
"""Mutation check of the QA78 suites. Usage: mutate.py <scratch-worktree> <mutant-id>. Applies ONE textual mutation to a DISPOSABLE
worktree of PR #78 (never the audited tree, never committed), prints the files to run. Restore with `git checkout -- .` in that worktree."""
import sys, pathlib
wt = pathlib.Path(sys.argv[1]); mid = sys.argv[2]
M = {
 "A-permit-ignores-packet-list": ("packages/agent-core/src/action-boundary.ts", "!currentCleanupPermit()?.packets.has(name)", "!currentCleanupPermit()"),
 "B-permit-never-expires": ("packages/shared/src/action-cleanup.ts", "if (!permit || now > permit.until) return undefined;", "if (!permit) return undefined;"),
 "C-permit-uncapped": ("packages/shared/src/action-cleanup.ts", "until: Date.now() + Math.min(deadlineMs, MAX_CLEANUP_MS),", "until: Date.now() + deadlineMs,"),
 "D-bite-handlers-ignore-abort": ("packages/skills/src/mineflayer-fish-cycle.ts", "if (!stillThisCast() || opts.signal?.aborted || cancelReason) return;\n    if (!bound || reeled || (handle.phase !== \"WAIT_FOR_OWN_BITE\" && handle.phase !== \"CAST\")) return;\n    const packet = args[0] as { entityId?: number; metadata", "if (false) return;\n    if (!bound || reeled || (handle.phase !== \"WAIT_FOR_OWN_BITE\" && handle.phase !== \"CAST\")) return;\n    const packet = args[0] as { entityId?: number; metadata"),
 "D2-no-detach-on-abort-and-reelOwnBite-unguarded": ("packages/skills/src/mineflayer-fish-cycle.ts", "    cancelReason = cancelReason ?? \"abort\";\n    detachAll();", "    cancelReason = cancelReason ?? \"abort\";"),
 "E-timers-never-restored": ("packages/agent-core/src/action-boundary.ts", "      restoreTimers();\n", ""),
 "F-swallow-every-timer-error": ("packages/agent-core/src/action-boundary.ts", "if (isLateRefusal(error)) return undefined;", "return undefined;"),
 "G-construction-ignores-interruption": ("packages/skills/src/blueprint-build.ts", "  if (signal?.aborted) return \"CANCELLED\";\n  if (!result.success && (result.code", "  if (false) return \"CANCELLED\";\n  if (false && (result.code"),
 "H-furnace-no-abort-after-output": ("packages/skills/src/furnace.ts", "    if (ctx.signal?.aborted) {\n      furnace.close();\n      const taken = countItem(ctx, outName) - before;\n      if (taken >= 1) {\n        return ok({ input: inName, output: outName, produced: taken, workstation: block.name }, Date.now() - started);\n      }\n      return cancelledResult(started, \"smelting cancelled after the output was taken\");\n    }\n", ""),
 "I-withdraw-emits-event-after-abort": ("packages/skills/src/inventory-service.ts", "      if (gained > 0) {\n        return ok({ item: name, count: gained, citizenAfter, containerAfter }, Date.now() - started);", "      if (gained > 0) {\n        ctx.events?.emit(createEvent(\"ItemWithdrawn\", { item: name, count: gained }, ctx.citizenId));\n        return ok({ item: name, count: gained, citizenAfter, containerAfter }, Date.now() - started);"),
 "J-retrieve-without-permit": ("packages/skills/src/mineflayer-fish-cycle.ts", "runBoundedCleanup(() => activate(\"cancel-retrieve\", \"REEL\"), {\n          packets: [\"use_item\"],\n          deadlineMs: FISH_RETRIEVE_DEADLINE_MS,\n        });", "activate(\"cancel-retrieve\", \"REEL\");"),
}
if mid == "H2-furnace-no-abort-checks-at-all":
    p = wt / "packages/skills/src/furnace.ts"; t = p.read_text()
    a = t.index("    // The ingot is already in the inventory. Do not start another furnace click"); b = t.index("    furnace.close();\n  } catch (error) {")
    p.write_text(t[:a] + "    if (furnace.inputItem() && furnace.takeInput) await furnace.takeInput();\n    if (furnace.fuelItem() && furnace.takeFuel) await furnace.takeFuel();\n" + t[b:]); print("applied", mid); sys.exit(0)
if mid == "D3-all-fish-abort-defences-removed":
    p = wt / "packages/skills/src/mineflayer-fish-cycle.ts"; t = p.read_text(); n0 = t
    for old, new in [("if (!stillThisCast() || opts.signal?.aborted || cancelReason || reeled) return;", "if (reeled) return;"),
                     ("if (!stillThisCast() || opts.signal?.aborted || cancelReason) return;", "if (false) return;"),
                     ("    cancelReason = cancelReason ?? \"abort\";\n    detachAll();", "")]:
        assert old in t, old; t = t.replace(old, new)
    p.write_text(t); print("applied", mid); sys.exit(0)
f, old, new = M[mid]
p = wt / f; s = p.read_text()
assert s.count(old) == 1, f"mutant {mid}: expected exactly one match, found {s.count(old)}"
p.write_text(s.replace(old, new)); print("applied", mid, "->", f)
