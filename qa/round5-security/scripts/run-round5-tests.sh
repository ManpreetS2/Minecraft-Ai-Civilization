#!/bin/bash
# usage: runr5.sh <worktree> <label>   overlays QA suites (never edits candidate src) and runs round5 tests
S=${QA_SCRATCH:?set QA_SCRATCH to a dir holding the "qa" clone and the frozen worktrees}
cd $S/$1 || exit 1; mkdir -p qa-indep; rm -rf qa-indep/round5-security qa-indep/v94 qa-indep/v94fc
(cd $S/qa && git archive pr/101 qa/v94) | tar -x -C qa-indep --strip-components=1
(cd $S/qa && git archive qa/round5-security) | tar -x -C qa-indep --strip-components=1
OUT=$S/out-$2; mkdir -p $OUT
pnpm exec vitest run -c qa-indep/round5-security/vitest.config.ts ${3:-} > $OUT/round5.log 2>&1
sed 's/\x1b\[[0-9;]*m//g' $OUT/round5.log | grep -E "^\s*(Test Files|Tests) "
