#!/usr/bin/env python3
"""Mutation check of the QA103 suite: ONE textual mutation of PR #103's home-ops.ts in a DISPOSABLE worktree. Usage: mutate.py <wt> <id>"""
import sys, pathlib
wt = pathlib.Path(sys.argv[1]); mid = sys.argv[2]; F = "packages/agent-core/src/home-ops.ts"
M = {
 "A-no-deposit-gate": ('if (!storageActionCurrent(ctx)) return abandonedStorage(ctx, events, "depositItems", result);', ""),
 "B-no-withdraw-gate": ('if (!storageActionCurrent(ctx)) return abandonedStorage(ctx, events, "withdrawItems", result);', ""),
 "C-release-unconditional": ("    if (storageActionCurrent(ctx)) {\n      runtime.claims.release", "    if (true) {\n      runtime.claims.release"),
 "D-ignore-signal": ("return !ctx.signal?.aborted && ctx.isActionCurrent?.() !== false;", "return ctx.isActionCurrent?.() !== false;"),
 "E-ignore-generation": ("return !ctx.signal?.aborted && ctx.isActionCurrent?.() !== false;", "return !ctx.signal?.aborted;"),
 "F-incident-says-storage-updated": ("authoritativeStorageUpdated: false,", "authoritativeStorageUpdated: true,"),
 "G-incident-drops-observed-result": ("observedResult: result, authoritativeStorageUpdated", "observedResult: undefined, authoritativeStorageUpdated"),
}
old, new = M[mid]; p = wt / F; s = p.read_text(); assert s.count(old) == 1, f"{mid}: {s.count(old)} matches"; p.write_text(s.replace(old, new)); print("applied", mid)
