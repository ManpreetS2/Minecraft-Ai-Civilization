#!/bin/bash
# usage: runval.sh <worktree> <label>  (QA-only overlay; candidate source never edited)
S=${QA_SCRATCH:?set QA_SCRATCH to a dir holding the "qa" clone and the frozen worktrees}
wt=$1; L=$2; cd $S/$wt || exit 1; Q=$S/qa
OUT=$S/out-$L; rm -rf $OUT; mkdir -p $OUT
rm -rf qa-indep; mkdir -p qa-indep
git status --porcelain > $OUT/status-before-gen.txt
pnpm v1:offline 2 > $OUT/gen2.log 2>&1; pnpm v1:offline 4 > $OUT/gen4.log 2>&1
(cd $Q && git archive pr/101 qa/v67 qa/v75 qa/v86 qa/v94) | tar -x -C qa-indep --strip-components=1
(cd $Q && git archive pr/113 qa/v94fc) | tar -x -C qa-indep --strip-components=1
(cd $Q && git archive pr/139 qa/provenance-controls) | tar -x -C qa-indep --strip-components=1
(cd $Q && git archive pr/142 qa/repair-reviews) | tar -x -C qa-indep --strip-components=1
rm -rf qa-indep/*/reports qa-indep/v94fc/red-before.txt
export QA67_ART=$PWD/artifacts/v1 QA67_BASE_ART=$PWD/artifacts/v1
ls artifacts/v1 > $OUT/artifacts.txt 2>&1
for t in "v94:vitest.config.ts" "v94:vitest.defects.config.ts" "v94fc:vitest.config.ts" "v86:vitest.config.ts" "v86:vitest.defects.config.ts" "v75:vitest.config.ts" "v67:vitest.config.ts" "provenance-controls:vitest.config.ts" "provenance-controls:vitest.defects.config.ts" "repair-reviews:vitest.config.ts"; do
  d=${t%%:*}; c=${t#*:}; f=$OUT/${d}-${c%.ts}.log
  pnpm exec vitest run -c qa-indep/$d/$c > $f 2>&1
done
echo done > $OUT/DONE
