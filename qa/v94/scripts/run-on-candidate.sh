#!/usr/bin/env bash
# Usage: qa/v94/scripts/run-on-candidate.sh <repo> <pr94-sha> <pr86-sha> <pr67-sha> <new-parent-dir>
# THREE new detached worktrees (c94 = PR #94 candidate, p86 = PR #86, v67 = PR #67 vulnerable); real offline 1v1/2v2 artifacts generated on each BEFORE any
# overlay; then UNTRACKED overlays: v67orig/v75orig/v86orig = my ORIGINAL suites byte-for-byte from this branch (it.fails intact for QA67/QA75),
# v67gem/v75gem/v86gem = the copies PR #94 ships (git archive from the candidate SHA), v94 = this directory.
# No Paper, no network (offline guard), no credentials, no paid calls. Keys are generated in memory by the tests. The candidate is never edited.
# A failing section does NOT abort the script.
set -uo pipefail
die() { echo "REFUSED: $*" >&2; exit 2; }
[ "$#" -eq 5 ] || die "usage: $0 <repo> <pr94-sha> <pr86-sha> <pr67-sha> <new-parent-dir>"
repo_in="$1"; s94="$2"; s86="$3"; s67="$4"; parent_in="$5"
src="$(cd "$(dirname "$0")/.." && pwd -P)"; qa="$(cd "$src/.." && pwd -P)"
for s in "$s94" "$s86" "$s67"; do [[ "$s" =~ ^[0-9a-f]{40}$ ]] || die "SHAs must be 40 hex characters"; done
repo="$(cd "$repo_in" && pwd -P)"
for s in "$s94" "$s86" "$s67"; do git -C "$repo" cat-file -e "$s^{commit}" 2>/dev/null || die "commit $s not in $repo"; done
for d in v67 v75 v86; do [ -d "$qa/$d/test" ] || die "original qa/$d must sit next to qa/v94"; done
[ ! -e "$parent_in" ] && [ ! -L "$parent_in" ] || die "parent dir exists; never overwritten"
[ -d "$(dirname "$parent_in")" ] || die "parent's parent missing"
mkdir "$parent_in"; parent="$(cd "$parent_in" && pwd -P)"
case "$parent/" in "$repo"/*|"$qa"/*) die "destination must be outside the candidate repo and the QA tree";; esac
find "$qa/v67" "$qa/v75" "$qa/v86" "$src" -type l | grep -q . && die "QA tree contains symlinks"
qa_repo="$(git -C "$src" rev-parse --show-toplevel)"
[ -z "$(git -C "$qa_repo" status --porcelain --untracked-files=all -- "$qa/v67" "$qa/v75" "$qa/v86" "$src")" ] || die "QA tree has uncommitted changes"
export QA_HARNESS_SHA="$(git -C "$qa_repo" rev-parse HEAD)"
echo "pr94=$s94 pr86=$s86 pr67=$s67 harness=$QA_HARNESS_SHA node=$(node -v) platform=$(node -p 'process.platform+"/"+process.arch')"
for pair in "c94:$s94" "p86:$s86" "v67:$s67"; do
  n="${pair%%:*}"; s="${pair##*:}"
  git -C "$repo" worktree add --detach "$parent/$n" "$s" >/dev/null
  [ "$(git -C "$parent/$n" rev-parse HEAD)" = "$s" ] || die "$n worktree not at $s"
  (cd "$parent/$n" && pnpm install --frozen-lockfile >/dev/null)
done
echo "=== SECTION 0: real offline 1v1 / 2v2 scenarios (clean trees) ==="
for n in c94 p86 v67; do (cd "$parent/$n" && pnpm v1:offline 2 && pnpm v1:offline 4) || echo "$n offline exit=$?"; done
echo "=== SECTION 1: implementation-author tests on the candidate (NOT independent proof) ==="
(cd "$parent/c94" && pnpm test:evidence-validator && pnpm test:v1) || echo "author tests exit=$?"
for n in c94 p86 v67; do
  d="$parent/$n/qa-independent"; mkdir -p "$d"
  cp -R "$qa/v67" "$d/v67orig"; cp -R "$qa/v75" "$d/v75orig"; cp -R "$qa/v86" "$d/v86orig"; cp -R "$src" "$d/v94"
  git -C "$repo" archive "$s94" qa/v67 qa/v75 qa/v86 | tar -x -C "$d/"; mv "$d/qa/v67" "$d/v67gem"; mv "$d/qa/v75" "$d/v75gem"; mv "$d/qa/v86" "$d/v86gem"; rmdir "$d/qa"
  for x in v67orig v75orig v86orig v67gem v75gem v86gem v94; do rm -rf "${d:?}/${x:?}/reports"; done
done
run() { # <tree> <overlay> [config]
  (cd "$parent/$1" && QA67_ART="$parent/$1/artifacts/v1" QA67_BASE_ART="$parent/v67/artifacts/v1" pnpm exec vitest run -c "qa-independent/$2/${3:-vitest.config.ts}") || echo "  -> $1/$2 ${3:-} exit=$?"
}
echo "=== SECTION 2: ORIGINAL QA67 (it.fails intact): vulnerable 150/150; PR #94 flips the 43 defect tests (+1 informational test Codex rewrote) ==="; run v67 v67orig; run c94 v67orig
echo "=== SECTION 3: Codex's QA67 copy: PR #94 150/150 ==="; run c94 v67gem
echo "=== SECTION 4: ORIGINAL QA75 (10 it.fails + 1 informational): PR #86 baseline; PR #94 flips them ==="; run p86 v75orig; run c94 v75orig
echo "=== SECTION 5: Codex's QA75 copy: PR #94 51/51 ==="; run c94 v75gem
echo "=== SECTION 6: my ORIGINAL QA86 (PR #90) suites on PR #94: regression 71/71 and the 5 defect demonstrations now passing ==="; run p86 v86orig vitest.defects.config.ts; run c94 v86orig; run c94 v86orig vitest.defects.config.ts
echo "=== SECTION 7: Codex's QA86 copy (+7 canonical tests) on PR #94 ==="; run c94 v86gem
echo "=== SECTION 8: QA94 independent canonical-binding suite: GREEN on PR #94; differential on PR #86 ==="; run c94 v94; run p86 v94
echo "=== SECTION 9: QA94 defect demonstrations (ordinary assertions; RED = weakness present) on PR #94 and PR #86 ==="; run c94 v94 vitest.defects.config.ts; run p86 v94 vitest.defects.config.ts
