# Independent baseline review and filesystem isolation repair

Reviewed PR #10: https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/pull/10
Exact reviewed/base SHA: 980ea688441bb12f0a26449b5727f7574cc4be5a.
PR #10 parent: 2983c1728a66b8532a85b0f83d9d63b51848dfed (#9 survival stack).
Child branch: agents/codex-cross-platform-isolation. Final revision is recorded in the draft PR and remote branch, since a document cannot contain its own commit hash.

## Independent PR #10 verdict: PASS within baseline scope

Read the private PR and full 17-file diff, then reviewed its source contracts and ran frozen install and all workspace checks on its exact tip in an isolated checkout. Actual host: Windows, Node 22.17.1, pnpm 10.13.1. Results: 158 test files passed; 1523 tests passed, 2 skipped, zero failed. Build, typecheck and lint all passed. No assertions were removed or weakened and no broad type suppressions were added.

- Blueprint repair requests the optional crafting table and maps through concreteBlock, which already resolves the material categories and workstation roles. Skipping implied door upper blocks matches the existing material-count contract: one door item places two blocks. Existing crafting-table and single-door assertions pass unchanged. This remains a legacy placement adapter, not new live building proof.
- The advance mock now declares ActionResult<BuildAdvance>; the settlement fixture includes required identity/needs fields; the directive uses the canonical obtain_item value. These correct fixtures without loosening production validation.
- All three guard failures now return the public allowed:false shape rather than an internal ok:false object. Refusal behavior is preserved.
- Fish verdict assignments exhaust PASS/FAIL/NOT FOUND before the removed unreachable comparison. Earlier UNVERIFIED exits remain. Home logging uses the observed night property and avoids formatting undefined positions; movement/sleep decisions are unchanged.
- Lint changes remove unused bindings/self-assignment, retain initializer evaluation on underscored constants, and use const where values are not reassigned. No intended gameplay change found.

No introduced regression found. Baseline acceptance is not independent acceptance of inherited SEC-001, provider routing or live execution. No transplant of PR #10 onto old weekly history was performed. Review also posted as PR #10 comment 6561623290.

## Ownership

Issue #6 request 6561612288; CODEX 1 explicitly released the guard and tests in acknowledgement 6561627548; child branch creation acknowledged in 6561633893. CODEX 1 continues separate preflight/community work. The five test cases from PR #12 were restored as test-only changes; #12 remains historical evidence. No manager.ts, executor.ts, SEC-001 or provider source modified.

## Verified inherited defects and repairs

The initial 30 new tests produced 21 failures and 9 passes before implementation (isolation-before.txt). They demonstrate trailing separator/root ancestry errors, POSIX case conflation, ambiguous identity acceptance, junction redirection, hard-linked database acceptance and failed canonical lookup acceptance. The earlier #12 experiment also reproduces the Windows-string fixture returning false under node:path.posix and true under node:path.win32; it does not claim execution on macOS/Linux.

1. Lexical comparison selects Windows drive/UNC or POSIX syntax explicitly using node:path.win32/posix, independent of host path.sep. Normalizes dot segments/trailing separators, preserves separator-delimited ancestry and rejects sibling prefixes. Windows comparison folds case conservatively; POSIX comparison preserves case. Mixed/unknown syntax returns possible alias (refuse), never certified isolation. Device namespaces, ADS, incomplete UNC roots, controls and Windows trailing dots/spaces are rejected. Relative paths must first resolve to native, unambiguous absolute paths; foreign Windows paths on POSIX are not silently reinterpreted as local relative paths.
2. Both isolated and protected targets require successful realpath lookup. A failure returns a refusal; lexical fallback is gone. Check both isolated candidates against both protected targets, verify directory/file kinds and compare device/inode identities to detect database hard links. Return the same canonical paths that were checked instead of resolving candidates again after the check.
3. Further QA reproduced two evidence-output failures (evidence-before.txt): a junction could redirect a future log directory under the protected world, and unsupported syntax could throw. Evidence now resolves through its nearest existing ancestor, rejects dangling/unreadable links and non-directory ancestors, and checks the canonical prospective destination against protected targets. Missing future directories remain supported. Public gate failures return allowed:false.

## Validation

Initial repair checkpoint: focused 53/53; full workspace 159 files passed, 1567 tests passed, 2 skipped, zero failed. Frozen install, build, typecheck and lint pass. Exact command transcripts retained here. Tests use only disposable temp directories and mock workspace resolution; actual Windows junctions and database hard links were created and checked. Foreign path tests exercise explicit Windows/POSIX lexical semantics on Windows; no actual Linux/macOS filesystem execution is claimed. No network share was contacted for UNC tests. No Minecraft, paid API or production database access.

## Limits and compatibility

- Foreign absolute syntax, ambiguous root/drive-relative Windows paths, device namespaces and unreadable/missing world/database identities now fail closed. Operators must provide ordinary native absolute or workspace-relative paths, pre-existing isolated world directories and database files. Evidence directories may be created later beneath a verified existing ancestor.
- Windows case folding may conservatively refuse distinct case-sensitive NTFS names. POSIX names retain case; realpath plus file identity protects canonical targets. Actual macOS/Linux and network-share filesystem behavior still needs CI coverage.
- This preflight is a snapshot, not a filesystem sandbox. A trusted caller must use returned canonical paths. Concurrent renaming/reparse-point replacement, descendant links inside an otherwise separate world tree, SQLite sidecar links and filesystem changes after validation require a separate copy/launch-time integrity policy. Nothing here authorizes a live experiment. No recursive production-tree scan or production data read was performed.

## Continued offline QA checkpoint

After publishing the path repair, continued within the handed-off guard. Eight malformed port cases (empty, zero, negative, >65535, NaN, Infinity, fractional and nonnumeric) failed before the correction: the gate incorrectly returned allowed:true with otherwise valid disposable paths. It now requires Paper and RCON ports to be integers in 1..65535. Four additional cases retain production/original port refusals. Before/after transcripts: ports-before.txt, ports-after.txt, qa-focused-final.txt.

Final validation including this follow-on: focused **65/65**; complete workspace **159 files passed, 1579 tests passed, 2 skipped, zero failed**. Build, typecheck and lint all pass. The 56 additional tests relative to PR #10 comprise the five historical #12 cases, 39 new path/canonical cases and 12 port QA cases. This correction changes only malformed-input refusal, not valid isolated ports or live authorization requirements.
