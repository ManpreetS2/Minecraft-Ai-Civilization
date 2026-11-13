#!/bin/bash
# Round 5 / Mission 2 reproduction: drive the REAL CI verifier CLI on mutated COPIES of a freshly generated bundle (never the candidate sources).
# usage: cli-tamper.sh <clean-frozen-worktree> <scratch-dir>
# The worktree must be clean (`git status --porcelain` empty: the generator refuses a dirty tree, untracked files included).
set -u; WT=${1:?worktree}; T=${2:?scratch}; cd "$WT" || exit 1
SHA=$(git rev-parse HEAD); pnpm v1:offline 2 >/dev/null 2>&1; pnpm v1:offline 4 >/dev/null 2>&1
ver(){ n=$1; s2=$2; sha=${3:-$SHA}; mkdir -p "$T/$n"; pnpm exec tsx tools/ci/verify-offline-acceptance.ts --scenario2 "$s2" --scenario4 artifacts/v1/scenario-4 --sha "$sha" --output "$T/$n/out" >"$T/$n.log" 2>&1; echo "$n exit=$? $(grep -E 'structural checks:\*\* ' "$T/$n.log" | head -1)"; }
cp_s2(){ rm -rf "${T:?}/${1:?}.s2"; mkdir -p "$T"; cp -R artifacts/v1/scenario-2 "$T/$1.s2"; }
ver control artifacts/v1/scenario-2                                    # expect exit 0, structural PASSED, Paper NOT PROVEN
ver wrongsha artifacts/v1/scenario-2 0000000000000000000000000000000000000000   # expect exit 1
cp_s2 arr;  node -e 'const f=process.argv[1],fs=require("fs"),r=JSON.parse(fs.readFileSync(f));r.runId=[r.attribution.runId];fs.writeFileSync(f,JSON.stringify(r))' "$T/arr.s2/gemini-validator-report.json"; ver arr "$T/arr.s2"   # QA120-L1: expect exit 1 (rejected by the contradiction check, not by type check)
cp_s2 obj;  node -e 'const f=process.argv[1],fs=require("fs"),r=JSON.parse(fs.readFileSync(f));r.runId={toString:"x"};fs.writeFileSync(f,JSON.stringify(r))' "$T/obj.s2/gemini-validator-report.json"; ver obj "$T/obj.s2" # QA120-L2: expect exit 1, structured failure
cp_s2 trunc; python3 -c 'import sys;L=open("artifacts/v1/scenario-2/operator.jsonl").read().splitlines(True);open(sys.argv[1],"w").write("".join(L[:-3]))' "$T/trunc.s2/operator.jsonl"; ver trunc "$T/trunc.s2"  # expect exit 1
cp_s2 half; python3 -c 'import sys;L=open("artifacts/v1/scenario-2/operator.jsonl").read().splitlines(True);open(sys.argv[1],"w").write("".join(L[:-1])+L[-1][:len(L[-1])//2])' "$T/half.s2/operator.jsonl"; ver half "$T/half.s2"  # expect exit 1
cp_s2 norcpt; rm "$T/norcpt.s2/receipts/$(ls "$T/norcpt.s2/receipts" | head -1)"; ver norcpt "$T/norcpt.s2"  # expect exit 1
d(){ find artifacts/v1/scenario-2 -type f | sort | xargs shasum | shasum | cut -c1-16; }; b=$(d); pnpm v1:offline 2 artifacts/v1/scenario-2 >/dev/null 2>&1; echo "overwrite-existing-dir exit=$? unchanged=$([ "$b" = "$(d)" ] && echo yes || echo NO)"   # expect refusal + unchanged
