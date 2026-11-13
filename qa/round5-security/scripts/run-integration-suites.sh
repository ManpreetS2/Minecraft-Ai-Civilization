#!/bin/bash
# usage: runint.sh <worktree> <label>  -- overlay QA-authored suites from their PR refs into qa-indep (candidate untouched) and run each config
S=${QA_SCRATCH:?set QA_SCRATCH to a dir holding the "qa" clone and the frozen worktrees}
cd $S/$1 || exit 1; Q=$S/qa; OUT=$S/out-$2; rm -rf $OUT qa-indep; mkdir -p $OUT qa-indep
git status --porcelain > $OUT/status-before.txt
pnpm v1:offline 2 > $OUT/gen2.log 2>&1; pnpm v1:offline 4 > $OUT/gen4.log 2>&1
ov(){ (cd $Q && git archive $1 "${@:2}") | tar -x -C qa-indep --strip-components=1; }
ov pr/137 qa/v120; ov pr/138 qa/p0-isolation; ov pr/139 qa/provenance-controls; ov pr/142 qa/repair-reviews
ov pr/104 qa/chest-event-contract; ov pr/118 qa/v103 qa/v88 qa/v78; ov pr/101 qa/v67 qa/v75 qa/v86 qa/v94
rm -rf qa-indep/*/reports
export QA67_ART=$PWD/artifacts/v1 QA67_BASE_ART=$PWD/artifacts/v1
for d in v120 p0-isolation provenance-controls repair-reviews chest-event-contract v103 v88 v78 v67 v75 v86 v94; do
  for c in $(ls qa-indep/$d/vitest*.config.ts 2>/dev/null | xargs -n1 basename); do
    pnpm exec vitest run -c qa-indep/$d/$c > $OUT/${d}-${c%.ts}.log 2>&1
  done
done
echo done > $OUT/DONE
