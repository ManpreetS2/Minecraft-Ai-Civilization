#!/usr/bin/env bash
# Usage: qa/v88/scripts/run-on-candidate.sh <repo> <pr88-sha> <pr78-sha> <new-parent-dir>
# Creates TWO new detached worktrees (c88 = PR #88 candidate, p78 = PR #78 reference) in a NEW directory, installs deps, overlays this suite as the
# UNTRACKED qa-independent/v88 tree and runs: (1) the inherited QA78 suites from the candidate's own qa/v78 (to re-observe Cursor's 50/1 and 2/12),
# (2) the QA88 regression suite (must be green on the candidate), (3) the QA88 defect demonstrations (ordinary assertions; RED = defect present),
# (4) the QA88 regression suite on PR #78 as a differential. No Paper, no network (offline guard), no credentials, no paid calls. Never edits the candidate.
# A failing section does NOT abort the script.
set -uo pipefail
die() { echo "REFUSED: $*" >&2; exit 2; }
[ "$#" -eq 4 ] || die "usage: $0 <repo> <pr88-sha> <pr78-sha> <new-parent-dir>"
repo_in="$1"; s88="$2"; s78="$3"; parent_in="$4"
src="$(cd "$(dirname "$0")/.." && pwd -P)"
for s in "$s88" "$s78"; do [[ "$s" =~ ^[0-9a-f]{40}$ ]] || die "SHAs must be 40 hex characters"; done
repo="$(cd "$repo_in" && pwd -P)"
for s in "$s88" "$s78"; do git -C "$repo" cat-file -e "$s^{commit}" 2>/dev/null || die "commit $s not in $repo"; done
[ ! -e "$parent_in" ] && [ ! -L "$parent_in" ] || die "parent dir exists; never overwritten"
[ -d "$(dirname "$parent_in")" ] || die "parent's parent missing"
mkdir "$parent_in"; parent="$(cd "$parent_in" && pwd -P)"
case "$parent/" in "$repo"/*|"$src"/*) die "destination must be outside the candidate repo and the QA tree";; esac
find "$src" -type l | grep -q . && die "QA tree contains symlinks"
qa_repo="$(git -C "$src" rev-parse --show-toplevel)"
[ -z "$(git -C "$qa_repo" status --porcelain --untracked-files=all -- "$src")" ] || die "QA tree has uncommitted changes"
export QA_HARNESS_SHA="$(git -C "$qa_repo" rev-parse HEAD)"
echo "pr88=$s88 pr78=$s78 harness=$QA_HARNESS_SHA node=$(node -v) platform=$(node -p 'process.platform+"/"+process.arch')"
for pair in "c88:$s88" "p78:$s78"; do
  n="${pair%%:*}"; s="${pair##*:}"
  git -C "$repo" worktree add --detach "$parent/$n" "$s" >/dev/null
  [ "$(git -C "$parent/$n" rev-parse HEAD)" = "$s" ] || die "$n worktree not at $s"
  (cd "$parent/$n" && pnpm install --frozen-lockfile >/dev/null)
done
run() { (cd "$parent/$1" && pnpm exec vitest run -c "$2") || echo "  -> $1 $2 exit=$?"; }
echo "=== SECTION 1: inherited QA78 suites from the candidate's own qa/v78 (author-side evidence; expected 50 pass/1 red and 2 pass/12 red) ==="
run c88 qa/v78/vitest.config.ts; run c88 qa/v78/vitest.defects.config.ts
for n in c88 p78; do d="$parent/$n/qa-independent"; mkdir -p "$d"; cp -R "$src" "$d/v88"; rm -rf "${d:?}/v88/reports"; done
echo "=== SECTION 2: QA88 regression suite: must be GREEN on the candidate ==="
run c88 qa-independent/v88/vitest.config.ts
echo "=== SECTION 3: QA88 defect demonstrations on the candidate (RED = defect present) ==="
run c88 qa-independent/v88/vitest.defects.config.ts
echo "=== SECTION 4: differential: QA88 regression suite on PR #78 (failures expected where PR #88 added the gate) ==="
run p78 qa-independent/v88/vitest.config.ts
