#!/usr/bin/env bash
# Usage: qa/v103/scripts/run-on-candidate.sh <repo> <pr103-sha> <pr88-sha> <new-parent-dir>
# NEW detached worktrees: c103 (PR #103) and c88 (PR #88, the unchanged base, as a differential). Overlays this suite untracked. No Paper, no network, no paid calls. Never edits the candidate.
set -uo pipefail
die() { echo "REFUSED: $*" >&2; exit 2; }
[ "$#" -eq 4 ] || die "usage: $0 <repo> <pr103-sha> <pr88-sha> <new-parent-dir>"
repo_in="$1"; s103="$2"; s88="$3"; parent_in="$4"; src="$(cd "$(dirname "$0")/.." && pwd -P)"
for s in "$s103" "$s88"; do [[ "$s" =~ ^[0-9a-f]{40}$ ]] || die "SHAs must be 40 hex characters"; done
repo="$(cd "$repo_in" && pwd -P)"; for s in "$s103" "$s88"; do git -C "$repo" cat-file -e "$s^{commit}" 2>/dev/null || die "commit $s not in $repo"; done
[ ! -e "$parent_in" ] && [ ! -L "$parent_in" ] || die "parent dir exists; never overwritten"; [ -d "$(dirname "$parent_in")" ] || die "parent's parent missing"
mkdir "$parent_in"; parent="$(cd "$parent_in" && pwd -P)"; case "$parent/" in "$repo"/*|"$src"/*) die "destination must be outside the candidate repo and the QA tree";; esac
find "$src" -type l | grep -q . && die "QA tree has symlinks"; qa_repo="$(git -C "$src" rev-parse --show-toplevel)"; [ -z "$(git -C "$qa_repo" status --porcelain --untracked-files=all -- "$src")" ] || die "QA tree has uncommitted changes"
echo "pr103=$s103 pr88=$s88 harness=$(git -C "$qa_repo" rev-parse HEAD) node=$(node -v) platform=$(node -p 'process.platform+"/"+process.arch')"
for pair in "c103:$s103" "c88:$s88"; do n="${pair%%:*}"; s="${pair##*:}"; git -C "$repo" worktree add --detach "$parent/$n" "$s" >/dev/null; [ "$(git -C "$parent/$n" rev-parse HEAD)" = "$s" ] || die "$n not at $s"; (cd "$parent/$n" && pnpm install --frozen-lockfile >/dev/null); done
run() { (cd "$parent/$1" && pnpm exec vitest run -c "$2") || echo "  -> $1 $2 exit=$?"; }
echo "=== 1. unchanged author suites on PR #103 (QA88 regression runs BEFORE any build so its source tripwire sees no dist/) ==="; run c103 qa/v88/vitest.config.ts; run c103 qa/v88/vitest.defects.config.ts; run c103 qa/v78/vitest.config.ts
for n in c103 c88; do d="$parent/$n/qa-independent"; mkdir -p "$d"; cp -R "$src" "$d/v103"; rm -rf "${d:?}/v103/reports"; done
echo "=== 2. QA103 regression suite (GREEN on PR #103) ==="; run c103 qa-independent/v103/vitest.config.ts
echo "=== 3. QA103 defect demonstrations (RED = weakness present) ==="; run c103 qa-independent/v103/vitest.defects.config.ts
echo "=== 4. differential on PR #88 (the base): the abandonment tests must fail there; QA103-L1 must NOT be red there (it is a regression introduced by #103) ==="; run c88 qa-independent/v103/vitest.config.ts; run c88 qa-independent/v103/vitest.defects.config.ts
