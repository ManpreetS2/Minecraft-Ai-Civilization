#!/usr/bin/env bash
# Usage: qa/v57/scripts/run-on-candidate.sh <candidate-repo> <full-40-char-sha> <new-worktree-dir>
# Overlays the PR #57 adversarial suites as UNTRACKED qa-independent/v57 on a NEW detached worktree at the exact SHA and runs them.
# Safety: never deletes/overwrites; destination must not exist; no Paper, no network (the `mineflayer` package is stubbed at config level
# so a test cannot open a socket), no credentials. The candidate source is never edited.
set -euo pipefail
die() { echo "REFUSED: $*" >&2; exit 2; }
[ "$#" -eq 3 ] || die "usage: $0 <candidate-repo> <full-sha> <new-worktree-dir>"
cand_in="$1"; sha="$2"; dest_in="$3"
src="$(cd "$(dirname "$0")/.." && pwd -P)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "SHA must be 40 hex characters"
cand="$(cd "$cand_in" && pwd -P)"
git -C "$cand" cat-file -e "$sha^{commit}" 2>/dev/null || die "commit $sha not in $cand"
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
(cd "$dest" && pnpm install --frozen-lockfile >/dev/null)
mkdir -p "$dest/qa-independent" && cp -R "$src" "$dest/qa-independent/v57" && rm -rf "$dest/qa-independent/v57/reports"
cd "$dest"
echo "candidate=$sha harness=$QA_HARNESS_SHA node=$(node -v) platform=$(node -p 'process.platform+"/"+process.arch')"
# Section 1: this PR's own focused command (what CI runs first), then the adversarial suites.
pnpm exec vitest run apps/orchestrator/src/construction-path-isolation.test.ts apps/orchestrator/src/construction-experiment-guard.test.ts apps/orchestrator/src/construction-live-boundaries.test.ts apps/orchestrator/src/off13-qa39-regressions.test.ts packages/minecraft-adapter/src --testTimeout=60000 --hookTimeout=60000
pnpm exec vitest run -c qa-independent/v57/vitest.config.ts --testTimeout=60000
