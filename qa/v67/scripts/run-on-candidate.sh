#!/usr/bin/env bash
# Usage: qa/v67/scripts/run-on-candidate.sh <candidate-repo> <candidate-sha> <base-sha> <new-parent-dir>
# Creates TWO new detached worktrees (<parent>/cand at the candidate SHA, <parent>/base at the base SHA), generates the real offline
# 2- and 4-citizen scenario artifacts on each BEFORE any overlay (the CLI refuses a dirty tree), then overlays the PR #67 adversarial
# suites as UNTRACKED qa-independent/v67 and runs them. The base run is a differential: it is EXPECTED to fail where #67 improved things.
# Safety: never deletes or overwrites; destinations must not exist; no Paper, no network (offline guard active), no credentials, no paid calls.
# Synthetic Ed25519 keys are generated in-memory per run. The candidate source is never edited.
set -euo pipefail
die() { echo "REFUSED: $*" >&2; exit 2; }
[ "$#" -eq 4 ] || die "usage: $0 <candidate-repo> <candidate-sha> <base-sha> <new-parent-dir>"
cand_in="$1"; csha="$2"; bsha="$3"; parent_in="$4"
src="$(cd "$(dirname "$0")/.." && pwd -P)"
[[ "$csha" =~ ^[0-9a-f]{40}$ && "$bsha" =~ ^[0-9a-f]{40}$ ]] || die "SHAs must be 40 hex characters"
cand="$(cd "$cand_in" && pwd -P)"
git -C "$cand" cat-file -e "$csha^{commit}" 2>/dev/null || die "commit $csha not in $cand"
git -C "$cand" cat-file -e "$bsha^{commit}" 2>/dev/null || die "commit $bsha not in $cand"
[ ! -e "$parent_in" ] && [ ! -L "$parent_in" ] || die "parent dir exists; never overwritten"
[ -d "$(dirname "$parent_in")" ] || die "parent's parent missing"
mkdir "$parent_in"; parent="$(cd "$parent_in" && pwd -P)"
case "$parent/" in "$cand"/*|"$src"/*) die "destination must be outside the candidate and the QA tree";; esac
find "$src" -type l | grep -q . && die "QA tree contains symlinks"
qa_repo="$(git -C "$src" rev-parse --show-toplevel)"
[ -z "$(git -C "$qa_repo" status --porcelain --untracked-files=all -- "$src")" ] || die "QA tree has uncommitted changes"
export QA_HARNESS_SHA="$(git -C "$qa_repo" rev-parse HEAD)"
echo "candidate=$csha base=$bsha harness=$QA_HARNESS_SHA node=$(node -v) platform=$(node -p 'process.platform+"/"+process.arch')"
for pair in "cand:$csha" "base:$bsha"; do
  name="${pair%%:*}"; sha="${pair##*:}"
  git -C "$cand" worktree add --detach "$parent/$name" "$sha" >/dev/null
  [ "$(git -C "$parent/$name" rev-parse HEAD)" = "$sha" ] || die "$name worktree not at $sha"
  (cd "$parent/$name" && pnpm install --frozen-lockfile >/dev/null)
done
echo "=== SECTION 0: real offline scenarios (clean trees) ==="
for name in cand base; do
  (cd "$parent/$name" && pnpm v1:offline 2 && pnpm v1:offline 4)
done
echo "=== SECTION 1: the author's own validator + v1 tests on the candidate ==="
(cd "$parent/cand" && pnpm test:evidence-validator && pnpm test:v1)
for name in cand base; do
  mkdir -p "$parent/$name/qa-independent" && cp -R "$src" "$parent/$name/qa-independent/v67" && rm -rf "$parent/$name/qa-independent/v67/reports"
done
echo "=== SECTION 2: adversarial suites on the CANDIDATE ==="
(cd "$parent/cand" && QA67_ART="$parent/cand/artifacts/v1" QA67_BASE_ART="$parent/base/artifacts/v1" pnpm exec vitest run -c qa-independent/v67/vitest.config.ts)
echo "=== SECTION 3: same suites on BASE (differential; failures here are EXPECTED) ==="
(cd "$parent/base" && QA67_ART="$parent/base/artifacts/v1" QA67_BASE_ART="$parent/base/artifacts/v1" pnpm exec vitest run -c qa-independent/v67/vitest.config.ts) || echo "base differential exit=$? (expected non-zero)"
