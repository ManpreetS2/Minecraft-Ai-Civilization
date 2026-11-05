# Intentionally not imported into PR #56 from Claude QA head f5e22288287214c99c15767856d8a3e2d4a21611.
# That script runs `rm -rf "$cand/qa/v1"` then copies a replacement tree. Mission 004 forbids executing it;
# Claude owns a non-destructive replacement. To evaluate this candidate, run from this checkout:
#   npx tsx qa/v1/src/run.ts --expect-sha <40-char-HEAD> --expect-branch agents/cursor-v1-single-sha-integration
