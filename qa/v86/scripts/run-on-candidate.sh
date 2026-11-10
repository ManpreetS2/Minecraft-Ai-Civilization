#!/usr/bin/env bash
# Usage: qa/v86/scripts/run-on-candidate.sh <repo> <pr86-sha> <pr75-sha> <pr67-sha> <new-parent-dir>
# Creates THREE new detached worktrees (c86 = PR #86 candidate, p75 = PR #75, v67 = PR #67 vulnerable), generates the real offline 1v1/2v2 artifacts on
# each BEFORE any overlay (the CLI refuses a dirty tree), then overlays as UNTRACKED qa-independent/*:
#   v67orig / v75orig = my ORIGINAL QA67 and QA75 suites byte-for-byte from this branch (it.fails intact)
#   v67gem / v75gem   = the copies that PR #86 ships (git archive from the candidate SHA)
#   v86               = the new independent suites in this directory
# Safety: never deletes/overwrites; destinations must not exist; no Paper, no network (offline guard), no credentials, no paid calls.
# Ed25519 keys are generated in memory. The candidate source is never edited. A failing section does NOT abort the script.
set -uo pipefail
die() { echo "REFUSED: $*" >&2; exit 2; }
[ "$#" -eq 5 ] || die "usage: $0 <repo> <pr86-sha> <pr75-sha> <pr67-sha> <new-parent-dir>"
repo_in="$1"; s86="$2"; s75="$3"; s67="$4"; parent_in="$5"
src="$(cd "$(dirname "$0")/.." && pwd -P)"; qa="$(cd "$src/.." && pwd -P)"
for s in "$s86" "$s75" "$s67"; do [[ "$s" =~ ^[0-9a-f]{40}$ ]] || die "SHAs must be 40 hex characters"; done
repo="$(cd "$repo_in" && pwd -P)"
for s in "$s86" "$s75" "$s67"; do git -C "$repo" cat-file -e "$s^{commit}" 2>/dev/null || die "commit $s not in $repo"; done
[ -d "$qa/v67/test" ] && [ -d "$qa/v75/test" ] || die "original qa/v67 and qa/v75 must sit next to qa/v86"
[ ! -e "$parent_in" ] && [ ! -L "$parent_in" ] || die "parent dir exists; never overwritten"
[ -d "$(dirname "$parent_in")" ] || die "parent's parent missing"
mkdir "$parent_in"; parent="$(cd "$parent_in" && pwd -P)"
case "$parent/" in "$repo"/*|"$qa"/*) die "destination must be outside the candidate repo and the QA tree";; esac
find "$qa/v67" "$qa/v75" "$src" -type l | grep -q . && die "QA tree contains symlinks"
qa_repo="$(git -C "$src" rev-parse --show-toplevel)"
[ -z "$(git -C "$qa_repo" status --porcelain --untracked-files=all -- "$qa/v67" "$qa/v75" "$src")" ] || die "QA tree has uncommitted changes"
export QA_HARNESS_SHA="$(git -C "$qa_repo" rev-parse HEAD)"
echo "pr86=$s86 pr75=$s75 pr67=$s67 harness=$QA_HARNESS_SHA node=$(node -v) platform=$(node -p 'process.platform+"/"+process.arch')"
for pair in "c86:$s86" "p75:$s75" "v67:$s67"; do
  n="${pair%%:*}"; s="${pair##*:}"
  git -C "$repo" worktree add --detach "$parent/$n" "$s" >/dev/null
  [ "$(git -C "$parent/$n" rev-parse HEAD)" = "$s" ] || die "$n worktree not at $s"
  (cd "$parent/$n" && pnpm install --frozen-lockfile >/dev/null)
done
echo "=== SECTION 0: real offline 1v1 / 2v2 scenarios (clean trees) ==="
for n in c86 p75 v67; do (cd "$parent/$n" && pnpm v1:offline 2 && pnpm v1:offline 4) || echo "$n offline exit=$?"; done
echo "=== SECTION 1: implementation-author tests on the candidate (NOT independent proof) ==="
(cd "$parent/c86" && pnpm test:evidence-validator && pnpm test:v1) || echo "author tests exit=$?"
for n in c86 p75 v67; do
  d="$parent/$n/qa-independent"; mkdir -p "$d"
  cp -R "$qa/v67" "$d/v67orig"; cp -R "$qa/v75" "$d/v75orig"; cp -R "$src" "$d/v86"
  git -C "$repo" archive "$s86" qa/v67 qa/v75 | tar -x -C "$d/"; mv "$d/qa/v67" "$d/v67gem"; mv "$d/qa/v75" "$d/v75gem"; rmdir "$d/qa"
  for x in v67orig v75orig v67gem v75gem v86; do rm -rf "${d:?}/${x:?}/reports"; done
done
run() { # <tree> <overlay> <config>
  local art="$parent/$1/artifacts/v1"
  (cd "$parent/$1" && QA67_ART="$art" QA67_BASE_ART="$parent/v67/artifacts/v1" pnpm exec vitest run -c "qa-independent/$2/${3:-vitest.config.ts}") || echo "  -> $1/$2 exit=$?"
}
echo "=== SECTION 2: ORIGINAL QA67 (it.fails intact): vulnerable source 150/150; PR #86 must flip the 43 defect tests ==="
run v67 v67orig; run c86 v67orig
echo "=== SECTION 3: Gemini's QA67 copy: PR #86 150/150; vulnerable source must fail the 43 ==="
run c86 v67gem; run v67 v67gem
echo "=== SECTION 4: ORIGINAL QA75 (10 it.fails intact): PR #75 passes; PR #86 must flip the 10 ==="
run p75 v75orig; run c86 v75orig
echo "=== SECTION 5: Gemini's QA75 copy: PR #86 51/51; PR #75 must fail the 10 ==="
run c86 v75gem; run p75 v75gem
echo "=== SECTION 6: QA86 independent regression suite: must be GREEN on PR #86; differential on PR #75 ==="
run c86 v86; run p75 v86
echo "=== SECTION 7: QA86 defect demonstrations on PR #86 (ordinary assertions; RED = defect present) ==="
run c86 v86 vitest.defects.config.ts
