#!/usr/bin/env bash
# Usage: qa/v1/scripts/run-on-candidate.sh <candidate-repo> <full-40-char-sha> <new-worktree-dir> [expected-branch]
#
# Tests an exact candidate commit in a NEW disposable worktree. Safety rules, each covered by test/wrapper-safety.test.ts:
#  * never deletes, overwrites or moves anything (no rm, no cp over existing files);
#  * <new-worktree-dir> must not exist, its parent must exist, no component of its path may be a symlink, and it must not
#    be inside the candidate repo or the QA harness checkout;
#  * the candidate repo must contain the SHA and have no tracked working-tree changes (it is not otherwise touched:
#    `git worktree add` only adds metadata under .git/worktrees);
#  * the QA harness checkout must be clean for qa/v1, and its commit is recorded next to the candidate SHA so executed test
#    code is always attributable (QA_HARNESS_SHA); symlinks inside qa/v1 are refused.
set -euo pipefail
die() { echo "REFUSED: $*" >&2; exit 2; }
[ "$#" -ge 3 ] || die "usage: $0 <candidate-repo> <full-sha> <new-worktree-dir> [expected-branch]"
cand_in="$1"; sha="$2"; dest_in="$3"; branch="${4:-}"
qa_src="$(cd "$(dirname "$0")/.." && pwd -P)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "SHA must be the full 40-character commit id"
[ -d "$cand_in" ] || die "candidate repo $cand_in is not a directory"
cand="$(cd "$cand_in" && pwd -P)"
git -C "$cand" rev-parse --git-dir >/dev/null 2>&1 || die "$cand is not a git repository"
git -C "$cand" cat-file -e "$sha^{commit}" 2>/dev/null || die "commit $sha is not in $cand"
[ -z "$(git -C "$cand" status --porcelain --untracked-files=no)" ] || die "unexpected tracked changes in $cand"
[ ! -e "$dest_in" ] && [ ! -L "$dest_in" ] || die "destination $dest_in already exists; it is never overwritten"
parent_in="$(dirname "$dest_in")"
[ -d "$parent_in" ] || die "destination parent $parent_in does not exist"
# no symlink anywhere along the destination path
p="$dest_in"; while [ "$p" != "/" ] && [ "$p" != "." ] && [ -n "$p" ]; do
  [ ! -L "$p" ] || die "destination path contains a symlink ($p)"
  next="$(dirname "$p")"; [ "$next" != "$p" ] || break; p="$next"
done
dest="$(cd "$parent_in" && pwd -P)/$(basename "$dest_in")"
case "$dest/" in "$cand"/*|"$qa_src"/*) die "destination must be outside the candidate repo and the QA harness";; esac
if find "$qa_src" -path "$qa_src/out" -prune -o -type l -print 2>/dev/null | grep -q .; then die "QA harness contains symlinks"; fi
qa_repo="$(git -C "$qa_src" rev-parse --show-toplevel)"
[ -z "$(git -C "$qa_repo" status --porcelain --untracked-files=all -- "$qa_src")" ] || die "QA harness has uncommitted changes; executed tests must match a commit"
export QA_HARNESS_SHA="$(git -C "$qa_repo" rev-parse HEAD)"

git -C "$cand" worktree add --detach "$dest" "$sha" >/dev/null
[ "$(git -C "$dest" rev-parse HEAD)" = "$sha" ] || die "worktree is not at $sha"
# Overlaid as UNTRACKED qa-independent/v1, never at qa/v1: a candidate may already track its own (older) qa/v1.
[ ! -e "$dest/qa-independent" ] || die "candidate already contains qa-independent/ (worktree left at $dest)"
mkdir "$dest/qa-independent" && cp -R "$qa_src" "$dest/qa-independent/v1"
cd "$dest"
pnpm install --offline --frozen-lockfile >/dev/null
npx tsc -p qa-independent/v1/tsconfig.json
args=(--expect-sha "$sha"); [ -n "$branch" ] && args+=(--expect-branch "$branch")
npx tsx qa-independent/v1/src/run.ts "${args[@]}"
