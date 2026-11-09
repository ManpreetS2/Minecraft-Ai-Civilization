#!/usr/bin/env bash
# Usage: qa/v78/scripts/run-on-candidate.sh <candidate-repo> <pr78-sha> <pr74-sha> <pr69-sha> <new-parent-dir>
# Creates THREE new detached worktrees (c78 = PR #78 candidate, p74 = PR #74, p69 = PR #69 head) in a NEW directory, installs deps,
# and overlays the ORIGINAL QA69 suite (qa/v69, byte-for-byte as authored before the fixes) and this QA78 suite as UNTRACKED
# qa-independent/* trees. The implementation is never edited. No Paper, no network (offline guard), no credentials, no paid calls.
# Never deletes or overwrites: the destination must not exist.
set -euo pipefail
die() { echo "REFUSED: $*" >&2; exit 2; }
[ "$#" -eq 5 ] || die "usage: $0 <candidate-repo> <pr78-sha> <pr74-sha> <pr69-sha> <new-parent-dir>"
repo_in="$1"; s78="$2"; s74="$3"; s69="$4"; parent_in="$5"
src="$(cd "$(dirname "$0")/.." && pwd -P)"; v69src="$(cd "$src/../v69" && pwd -P)"
for s in "$s78" "$s74" "$s69"; do [[ "$s" =~ ^[0-9a-f]{40}$ ]] || die "SHAs must be 40 hex characters"; done
repo="$(cd "$repo_in" && pwd -P)"
for s in "$s78" "$s74" "$s69"; do git -C "$repo" cat-file -e "$s^{commit}" 2>/dev/null || die "commit $s not in $repo"; done
[ ! -e "$parent_in" ] && [ ! -L "$parent_in" ] || die "parent dir exists; never overwritten"
[ -d "$(dirname "$parent_in")" ] || die "parent's parent missing"
mkdir "$parent_in"; parent="$(cd "$parent_in" && pwd -P)"
case "$parent/" in "$repo"/*|"$src"/*) die "destination must be outside the candidate repo and the QA tree";; esac
find "$src" "$v69src" -type l | grep -q . && die "QA tree contains symlinks"
qa_repo="$(git -C "$src" rev-parse --show-toplevel)"
[ -z "$(git -C "$qa_repo" status --porcelain --untracked-files=all -- "$src" "$v69src")" ] || die "QA tree has uncommitted changes"
export QA_HARNESS_SHA="$(git -C "$qa_repo" rev-parse HEAD)"
echo "pr78=$s78 pr74=$s74 pr69=$s69 harness=$QA_HARNESS_SHA node=$(node -v) platform=$(node -p 'process.platform+"/"+process.arch')"
for pair in "c78:$s78" "p74:$s74" "p69:$s69"; do
  n="${pair%%:*}"; s="${pair##*:}"
  git -C "$repo" worktree add --detach "$parent/$n" "$s" >/dev/null
  [ "$(git -C "$parent/$n" rev-parse HEAD)" = "$s" ] || die "$n worktree not at $s"
  (cd "$parent/$n" && pnpm install --frozen-lockfile >/dev/null)
  mkdir -p "$parent/$n/qa-independent"
  cp -R "$src" "$parent/$n/qa-independent/v78"; rm -rf "$parent/$n/qa-independent/v78/reports"
  cp -R "$v69src" "$parent/$n/qa-independent/v69orig"; rm -rf "$parent/$n/qa-independent/v69orig/reports"
  sed -i.bak 's#qa-independent/v69/scripts#qa-independent/v69orig/scripts#' "$parent/$n/qa-independent/v69orig/test/adv69-production-callbacks.test.ts"; rm -f "$parent/$n/qa-independent/v69orig/test/"*.bak
done
echo "=== SECTION 1: PR #78's own tests on the candidate (author evidence) ==="
(cd "$parent/c78" && pnpm exec vitest run -c qa/v69/vitest.config.ts --testTimeout=30000 && pnpm exec vitest run -c qa/action-audit/vitest.config.ts) || echo "author tests exit=$?"
echo "=== SECTION 2: ORIGINAL QA69 suite, unmodified. PR #74 head: defects reproduce (all pass because the it.fails ones pass). PR #78: it.fails flip red = defect gone ==="
for n in p74 c78; do echo "--- $n"; (cd "$parent/$n" && pnpm exec vitest run -c qa-independent/v69orig/vitest.config.ts) || echo "$n original-QA69 exit=$? (expected non-zero on c78: closed defects)"; done
echo "=== SECTION 3: QA78 regression suite (must be GREEN on the candidate) ==="
(cd "$parent/c78" && pnpm exec vitest run -c qa-independent/v78/vitest.config.ts)
echo "=== SECTION 4: QA78 defect demonstrations (ordinary assertions; RED = defect present) ==="
(cd "$parent/c78" && pnpm exec vitest run -c qa-independent/v78/vitest.defects.config.ts) || echo "defect demonstrations exit=$? (expected non-zero until fixed)"
echo "=== SECTION 5: differential: PR #74 and PR #69 on the QA78 regression suite (failures here are EXPECTED where a fix is absent) ==="
for n in p74 p69; do echo "--- $n"; (cd "$parent/$n" && pnpm exec vitest run -c qa-independent/v78/vitest.config.ts) || echo "$n exit=$?"; done
