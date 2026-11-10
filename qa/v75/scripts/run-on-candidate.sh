#!/usr/bin/env bash
# Usage: qa/v75/scripts/run-on-candidate.sh <candidate-repo> <candidate-sha> <vulnerable-sha> <new-parent-dir>
# Creates two NEW detached worktrees (cand at PR #75, vuln at PR #67), generates the real offline 1v1/2v2 artifacts on each BEFORE any
# overlay (the CLI refuses a dirty tree), then overlays as UNTRACKED qa-independent/*:
#   v67orig = my ORIGINAL PR #67 adversarial suite, byte-for-byte from this branch (qa/v67, it.fails intact)
#   v67gem  = the copy of that suite that PR #75 ships (extracted with git archive from the candidate SHA)
#   v75     = the new independent suites in this directory
# Safety: never deletes/overwrites; destinations must not exist; no Paper, no network (offline guard), no credentials, no paid calls.
# Ed25519 keys are generated in memory. The candidate source is never edited.
set -euo pipefail
die() { echo "REFUSED: $*" >&2; exit 2; }
[ "$#" -eq 4 ] || die "usage: $0 <candidate-repo> <candidate-sha> <vulnerable-sha> <new-parent-dir>"
cand_in="$1"; csha="$2"; vsha="$3"; parent_in="$4"
src="$(cd "$(dirname "$0")/.." && pwd -P)"; orig="$src/../v67"
for s in "$csha" "$vsha"; do [[ "$s" =~ ^[0-9a-f]{40}$ ]] || die "SHAs must be 40 hex characters"; done
cand="$(cd "$cand_in" && pwd -P)"
for s in "$csha" "$vsha"; do git -C "$cand" cat-file -e "$s^{commit}" 2>/dev/null || die "commit $s not in $cand"; done
[ -d "$orig/test" ] || die "original qa/v67 suite not found next to qa/v75"
[ ! -e "$parent_in" ] && [ ! -L "$parent_in" ] || die "parent dir exists; never overwritten"
[ -d "$(dirname "$parent_in")" ] || die "parent's parent missing"
mkdir "$parent_in"; parent="$(cd "$parent_in" && pwd -P)"
case "$parent/" in "$cand"/*|"$src"/*) die "destination must be outside the candidate and the QA tree";; esac
find "$src" "$orig" -type l | grep -q . && die "QA tree contains symlinks"
qa_repo="$(git -C "$src" rev-parse --show-toplevel)"
[ -z "$(git -C "$qa_repo" status --porcelain --untracked-files=all -- "$src" "$orig")" ] || die "QA tree has uncommitted changes"
export QA_HARNESS_SHA="$(git -C "$qa_repo" rev-parse HEAD)"
echo "candidate=$csha vulnerable=$vsha harness=$QA_HARNESS_SHA node=$(node -v) platform=$(node -p 'process.platform+"/"+process.arch')"
for pair in "cand:$csha" "vuln:$vsha"; do
  n="${pair%%:*}"; sha="${pair##*:}"
  git -C "$cand" worktree add --detach "$parent/$n" "$sha" >/dev/null
  [ "$(git -C "$parent/$n" rev-parse HEAD)" = "$sha" ] || die "$n worktree not at $sha"
  (cd "$parent/$n" && pnpm install --frozen-lockfile >/dev/null)
done
echo "=== SECTION 0: real offline 1v1 / 2v2 scenarios (clean trees) ==="
for n in cand vuln; do (cd "$parent/$n" && pnpm v1:offline 2 && pnpm v1:offline 4); done
echo "=== SECTION 1: implementation-author tests on the candidate (NOT independent proof) ==="
(cd "$parent/cand" && pnpm test:evidence-validator && pnpm test:v1)
for n in cand vuln; do
  mkdir -p "$parent/$n/qa-independent"
  cp -R "$orig" "$parent/$n/qa-independent/v67orig"; rm -rf "$parent/$n/qa-independent/v67orig/reports"
  git -C "$cand" archive "$csha" qa/v67 | tar -x -C "$parent/$n/qa-independent/" && mv "$parent/$n/qa-independent/qa/v67" "$parent/$n/qa-independent/v67gem" && rmdir "$parent/$n/qa-independent/qa" && rm -rf "$parent/$n/qa-independent/v67gem/reports"
  cp -R "$src" "$parent/$n/qa-independent/v75"; rm -rf "$parent/$n/qa-independent/v75/reports"
done
run() { # <tree> <overlay>
  (cd "$parent/$1" && QA67_ART="$parent/$1/artifacts/v1" QA67_BASE_ART="$parent/vuln/artifacts/v1" pnpm exec vitest run -c "qa-independent/$2/vitest.config.ts")
}
echo "=== SECTION 2: my ORIGINAL QA67 suite (it.fails intact): vulnerable source must pass 150/150, candidate must flip the 43 defect tests ==="
run vuln v67orig || echo "orig-on-vuln exit=$?"; run cand v67orig || echo "orig-on-cand exit=$? (43 failures = 43 closed defects)"
echo "=== SECTION 3: Gemini's updated copy: candidate must pass 150/150, vulnerable source must fail the 43 ==="
run cand v67gem || echo "gem-on-cand exit=$?"; run vuln v67gem || echo "gem-on-vuln exit=$? (43 failures expected)"
echo "=== SECTION 4: new independent QA75 suites ==="
run cand v75 || echo "v75-on-cand exit=$?"; run vuln v75 || echo "v75-on-vuln exit=$? (differential; failures expected)"
