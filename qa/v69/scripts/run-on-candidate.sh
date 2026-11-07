#!/usr/bin/env bash
# Usage: qa/v69/scripts/run-on-candidate.sh <candidate-repo> <candidate-sha> <base-sha> <audit66-sha> <new-parent-dir>
# Creates THREE new detached worktrees (cand, base = PR #69's base, a66 = the originally audited tree), overlays the original PR #66
# reproduction suite (read from the a66 tree, unmodified) and this PR #69 adversarial suite as UNTRACKED qa-independent/*, and runs them.
# Safety: never deletes or overwrites; destinations must not exist; no Paper, no network (offline guard active), no credentials, no paid
# calls. The mineflayer digging plugin is exercised in a child process against a stub bot only. The candidate source is never edited.
set -euo pipefail
die() { echo "REFUSED: $*" >&2; exit 2; }
[ "$#" -eq 5 ] || die "usage: $0 <candidate-repo> <candidate-sha> <base-sha> <audit66-sha> <new-parent-dir>"
cand_in="$1"; csha="$2"; bsha="$3"; asha="$4"; parent_in="$5"
src="$(cd "$(dirname "$0")/.." && pwd -P)"
for s in "$csha" "$bsha" "$asha"; do [[ "$s" =~ ^[0-9a-f]{40}$ ]] || die "SHAs must be 40 hex characters"; done
cand="$(cd "$cand_in" && pwd -P)"
for s in "$csha" "$bsha" "$asha"; do git -C "$cand" cat-file -e "$s^{commit}" 2>/dev/null || die "commit $s not in $cand"; done
[ ! -e "$parent_in" ] && [ ! -L "$parent_in" ] || die "parent dir exists; never overwritten"
[ -d "$(dirname "$parent_in")" ] || die "parent's parent missing"
mkdir "$parent_in"; parent="$(cd "$parent_in" && pwd -P)"
case "$parent/" in "$cand"/*|"$src"/*) die "destination must be outside the candidate and the QA tree";; esac
find "$src" -type l | grep -q . && die "QA tree contains symlinks"
qa_repo="$(git -C "$src" rev-parse --show-toplevel)"
[ -z "$(git -C "$qa_repo" status --porcelain --untracked-files=all -- "$src")" ] || die "QA tree has uncommitted changes"
export QA_HARNESS_SHA="$(git -C "$qa_repo" rev-parse HEAD)"
echo "candidate=$csha base=$bsha audit66=$asha harness=$QA_HARNESS_SHA node=$(node -v) platform=$(node -p 'process.platform+"/"+process.arch')"
for pair in "cand:$csha" "base:$bsha" "a66:$asha"; do
  name="${pair%%:*}"; sha="${pair##*:}"
  git -C "$cand" worktree add --detach "$parent/$name" "$sha" >/dev/null
  [ "$(git -C "$parent/$name" rev-parse HEAD)" = "$sha" ] || die "$name worktree not at $sha"
  (cd "$parent/$name" && pnpm install --frozen-lockfile >/dev/null)
done
echo "=== SECTION 1: the author's own PR #69 tests on the candidate ==="
(cd "$parent/cand" && pnpm exec vitest run packages/agent-core/src/action-boundary.test.ts && pnpm exec vitest run -c qa/action-audit/vitest.config.ts)
for name in cand base a66; do
  mkdir -p "$parent/$name/qa-independent" && cp -R "$src" "$parent/$name/qa-independent/v69" && rm -rf "$parent/$name/qa-independent/v69/reports"
  mkdir -p "$parent/$name/qa-independent/a66audit" && cp -R "$parent/a66/qa/action-audit/test" "$parent/a66/qa/action-audit/src" "$parent/$name/qa-independent/a66audit/"
  cp "$src/vitest.config.ts" "$parent/$name/qa-independent/a66audit/vitest.config.ts"
done
echo "=== SECTION 2: ORIGINAL PR #66 reproductions, unmodified: audited tree (expect all green = defects present), base, candidate ==="
for name in a66 base cand; do
  echo "--- $name"; (cd "$parent/$name" && pnpm exec vitest run -c qa-independent/a66audit/vitest.config.ts) || echo "$name original-suite exit=$?"
done
echo "=== SECTION 3: PR #69 adversarial suites on the CANDIDATE ==="
(cd "$parent/cand" && pnpm exec vitest run -c qa-independent/v69/vitest.config.ts)
echo "=== SECTION 4: same suites on BASE (differential; failures here are EXPECTED) ==="
(cd "$parent/base" && pnpm exec vitest run -c qa-independent/v69/vitest.config.ts) || echo "base differential exit=$? (expected non-zero)"
