#!/usr/bin/env bash
# Usage: qa/v94fc/scripts/run-on-candidate.sh <repo> <implementation-sha> <new-parent-dir>
# One NEW detached worktree at <implementation-sha> (PR #94's head da0e1ff9 for the baseline, or the repair SHA for acceptance). Generates the real offline artifacts BEFORE any
# overlay, overlays this suite untracked, runs it, and also runs the unchanged QA v94 / v86 / v75 / v67 suites that must stay green. No Paper, no network, no paid calls.
set -uo pipefail
die() { echo "REFUSED: $*" >&2; exit 2; }
[ "$#" -eq 3 ] || die "usage: $0 <repo> <sha> <new-parent-dir>"
repo_in="$1"; sha="$2"; parent_in="$3"; src="$(cd "$(dirname "$0")/.." && pwd -P)"; qa="$(cd "$src/.." && pwd -P)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "SHA must be 40 hex characters"; repo="$(cd "$repo_in" && pwd -P)"; git -C "$repo" cat-file -e "$sha^{commit}" 2>/dev/null || die "commit $sha not in $repo"
for d in v67 v75 v86 v94; do [ -d "$qa/$d/test" ] || die "qa/$d must sit next to qa/v94fc"; done
[ ! -e "$parent_in" ] && [ ! -L "$parent_in" ] || die "parent dir exists; never overwritten"; [ -d "$(dirname "$parent_in")" ] || die "parent's parent missing"
mkdir "$parent_in"; parent="$(cd "$parent_in" && pwd -P)"; case "$parent/" in "$repo"/*|"$qa"/*) die "destination must be outside the candidate repo and the QA tree";; esac
qa_repo="$(git -C "$src" rev-parse --show-toplevel)"; [ -z "$(git -C "$qa_repo" status --porcelain --untracked-files=all -- "$qa")" ] || die "QA tree has uncommitted changes"
git -C "$repo" worktree add --detach "$parent/c" "$sha" >/dev/null; (cd "$parent/c" && pnpm install --frozen-lockfile >/dev/null && pnpm v1:offline 2 >/dev/null && pnpm v1:offline 4 >/dev/null) || echo "offline artifacts exit=$?"
d="$parent/c/qa-independent"; mkdir -p "$d"; for x in v67 v75 v86 v94 v94fc; do cp -R "$qa/$x" "$d/$x"; rm -rf "${d:?}/${x:?}/reports"; done
run() { (cd "$parent/c" && QA67_ART="$parent/c/artifacts/v1" QA67_BASE_ART="$parent/c/artifacts/v1" pnpm exec vitest run -c "qa-independent/$1/${2:-vitest.config.ts}") || echo "  -> $1 exit=$?"; }
echo "=== forward-compatibility acceptance suite (red on PR #94 until the repair lands) ==="; run v94fc
echo "=== must stay green: QA94 canonical binding (27), QA86 (78 incl. defects 7), QA75 originals are NOT expected green (they encode the pre-repair behaviour) ==="; run v94; run v86
