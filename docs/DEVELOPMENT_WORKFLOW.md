# Development workflow — multiple laptops and coding agents

**Updated November 1, 2026.** This is an **offline-first, private engineering workflow**. The authoritative demo specification is the public [project charter](https://github.com/ManpreetS2/Minecraft-Ai-Civilization/blob/main/project.md); start with the dated [status page](CURRENT_STATUS_2026-11-01.md).

## 1. Clone, verify and install (new Mac, Windows or Linux)

```bash
git clone https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup.git
cd Minecraft-Ai-Civilization-windows-backup
git fetch --all --prune
git status --short
git branch -a
node --version
pnpm --version
pnpm install --frozen-lockfile
```

Node **22+** is the minimum declared in `package.json`. Platform-specific native SQLite dependencies are **reinstalled on each machine**; do not copy `node_modules` across operating systems.

Git moves committed source, **not** ignored `.env` secrets, actual Minecraft worlds, local SQLite/WAL databases, Paper JAR files, OS keychains, CLI chat histories or unknown unpublished Windows Mission 013 changes. Copy personal data or secrets only through deliberate, appropriately protected methods; never add them to this repository.

## 2. Pin the right branch per task

| Task | Starting point | Must not do |
| --- | --- | --- |
| Read-only current code / offline demo integration | `integration/weekly-2026-10-31` @ `17bff2d` | assume SEC-001 was merged |
| SEC-001 manager security integration | `agents/claude-sec001-manager` @ `15804fa` | overwrite Codex QA or the weekly integration |
| Independent SEC-001 regression evidence | `agents/codex-sec001-migration-QA` @ `5df239c` | merge intentionally failing reproduction branches into production |
| Cloud-budget / cognition review | `agents/claude-pr1-review` @ `77b9a9b` | start paid inference; merge Draft PR #1 without review |
| Documentation only | `docs/2026-11-01-readme-alignment` | change source code, `project.md` charter or protected branches |

These SHAs are a **November 1 snapshot**. Verify current refs before relying on them; different agents may have newer unpublished commits.

A safe pattern for parallel work in a cloned repo (do **not** run if the destination path already contains files):

```bash
git fetch --all --prune
git worktree add -b agents/my-new-review ../minecraft-sec001-review origin/agents/claude-sec001-manager
cd ../minecraft-sec001-review
pnpm install --frozen-lockfile
```

Use a new branch name each time. For a separate Claude or T3 Code checkout, open the app in **that worktree's root directory**. Do not open two writable coding agents in one worktree and ask them to edit the same files. Use an isolated checkout for security-reproduction branches and record which production revision each QA run tested.

## 3. Verify before reporting completion

```bash
pnpm test
pnpm typecheck
pnpm lint
git diff --check
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/agents/my-new-review
```

For a new or edited test, first run a focused Vitest command, then the relevant package suite and full workspace suite. Log **pass/fail/skips**, platform, Node and pnpm versions, and commit SHA. The project has documented baseline failures: no report should say “all tests pass” without an actual clean run on the **specified revision**.

**Publishing checkpoint:** commit source + tests + handoff on your own private branch; push; verify exact remote SHA; disclose uncommitted files/stashes and local-only state. For the October 31 laptop migration see [GitHub Issue #2](https://github.com/ManpreetS2/Minecraft-Ai-Civilization-windows-backup/issues/2).

## 4. Change ownership and security review

- **Claude / production owner:** SEC-001 manager audience labels, hearing/direct messages, source-aware fact reads and per-community behavior on private proposal branch.
- **Codex / independent QA:** disposable SQLite migrations, restart/reopen, historical contamination and cross-community regression tests. Negative tests must not be converted into green by weakening assertions.
- **T3 Code / security integration:** replay Codex privacy evidence against Claude production tip on its **own** worktree, review conflicts and implement minimal proven fixes.
- **Claude / separate reliability review:** check and improve Draft PR #1, cloud spend bounds, URL/credential behavior in `packages/cognition`. This work is not a SEC-001 merge.
- **Grok:** previously published integration and WIP QA remain preserved; do not wait for weekly credits just to read committed findings.
- **Documentation:** update dates, links, setup and evidence only; do not assert another agent's current in-progress fix is finished.

A review is **not** a merge. Keep proposals unmerged until an independent reviewer has verified the relevant production path and protected worktree conflicts.

## 5. Running Minecraft is a separate gate

The historic `pnpm atlas` and `pnpm sim:start` scripts are **legacy** local flows. No approved 1v1 or 2v2 public demo has been live verified. Starting Paper, connecting to the actual world, modifying persistent data and using paid GPT/Claude provider APIs require separate owner approval and carefully bounded setup. Normal offline unit tests should not need Minecraft or real keys.

The older local guide describes Paper 1.21.11 build 132; the proposed demo uses Paper 1.21.6 build #48 **only after compatibility/parity checks**. Do not overwrite an existing local world or replace a Jar based on a documentation example.

## 6. Resume order

1. Read [Current status](CURRENT_STATUS_2026-11-01.md), public charter and Issue #2.
2. Fetch private branch refs and read the per-agent continuation document on its own branch.
3. Validate the actual machine's dependencies and baseline tests offline.
4. Reproduce blocked privacy facts and cross-community memory leaks against Claude's pinned security revision; do not erase historical records.
5. Once security passes independent review, plan a controlled integration with the weekly branch and audit unpublished Windows Mission 013 conflicts.
6. Only then propose authorized live 1v1 and later 2v2 experiments.

**Remember:** source code pushed to GitHub means “recoverable,” not “released” or “Minecraft-tested.”
