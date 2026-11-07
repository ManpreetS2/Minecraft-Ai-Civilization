#!/usr/bin/env bash
# Usage: qa/verify-ci-verifier/scripts/run-on-candidate.sh <candidate-repo> <full-sha> <new-worktree-dir> [overlay-ci-from-sha]
#  - Creates a NEW detached worktree at <full-sha>, installs from the lockfile, generates REAL bundles with the candidate's own
#    `pnpm v1:offline 2|4` (before any overlay: that CLI refuses a dirty tree), then overlays this QA suite UNTRACKED and runs it.
#  - With [overlay-ci-from-sha] (e.g. PR #70's head) the three tools/ci/*.ts verifier files are copied untracked from that commit into
#    the candidate, so PR #70's verifier can be exercised against another PR's (e.g. #68's) real outputs. Neither PR is modified.
# Safety: never deletes or overwrites; no Paper, no network at test time, no model or paid calls, no credentials.
set -euo pipefail
die() { echo "REFUSED: $*" >&2; exit 2; }
[ "$#" -ge 3 ] && [ "$#" -le 4 ] || die "usage: $0 <candidate-repo> <full-sha> <new-worktree-dir> [overlay-ci-from-sha]"
cand_in="$1"; sha="$2"; dest_in="$3"; overlay="${4:-}"
src="$(cd "$(dirname "$0")/.." && pwd -P)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "SHA must be 40 hex characters"
[ -z "$overlay" ] || [[ "$overlay" =~ ^[0-9a-f]{40}$ ]] || die "overlay SHA must be 40 hex characters"
cand="$(cd "$cand_in" && pwd -P)"
git -C "$cand" cat-file -e "$sha^{commit}" 2>/dev/null || die "commit $sha not in $cand"
[ -z "$overlay" ] || git -C "$cand" cat-file -e "$overlay^{commit}" 2>/dev/null || die "overlay commit $overlay not in $cand"
[ ! -e "$dest_in" ] && [ ! -L "$dest_in" ] || die "destination exists; never overwritten"
[ -d "$(dirname "$dest_in")" ] || die "destination parent missing"
dest="$(cd "$(dirname "$dest_in")" && pwd -P)/$(basename "$dest_in")"
case "$dest/" in "$cand"/*|"$src"/*) die "destination must be outside the candidate and the QA tree";; esac
find "$src" -type l | grep -q . && die "QA tree contains symlinks"
qa_repo="$(git -C "$src" rev-parse --show-toplevel)"
[ -z "$(git -C "$qa_repo" status --porcelain --untracked-files=all -- "$src")" ] || die "QA tree has uncommitted changes"
export QA_HARNESS_SHA="$(git -C "$qa_repo" rev-parse HEAD)"
git -C "$cand" worktree add --detach "$dest" "$sha" >/dev/null
[ "$(git -C "$dest" rev-parse HEAD)" = "$sha" ] || die "worktree not at $sha"
cd "$dest"
pnpm install --frozen-lockfile >/dev/null
# The candidate refuses evidence directories outside artifacts/v1 inside its own worktree (same as CI), so generate there.
bundles="$dest/artifacts/v1"
for n in 2 4; do pnpm v1:offline "$n" "$bundles/scenario-$n" >/dev/null; done
if [ -n "$overlay" ]; then
  mkdir -p tools/ci
  for f in offline-acceptance-verifier.ts verify-offline-acceptance.ts; do git show "$overlay:tools/ci/$f" > "tools/ci/$f"; done
fi
mkdir -p qa-independent && cp -R "$src" qa-independent/verify-ci-verifier && rm -rf qa-independent/verify-ci-verifier/evidence qa-independent/verify-ci-verifier/scripts
echo "candidate=$sha overlay=${overlay:-none} harness=$QA_HARNESS_SHA node=$(node -v) platform=$(node -p 'process.platform+"/"+process.arch') bundles=$bundles"
CI_QA_BUNDLE_ROOT="$bundles" CI_QA_SHA="$sha" pnpm exec vitest run -c qa-independent/verify-ci-verifier/vitest.config.ts --maxWorkers=1 --no-file-parallelism
