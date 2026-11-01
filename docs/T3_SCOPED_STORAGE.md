# Scoped storage authorization

Base: draft #30, 70eafaef9eada159b074af4bbe68dff9462f5a3b. Branch: agents/t3-scoped-storage-authorization.

Actual defect: assertChestAccess authorized any caller, including an unbound caller, from settlement_first.storage even with communities configured. The higher-level property gate inherited this permission. A denied rival personal-storage request could also return the owner's private identity in its payload.

Community-mode communal use now requires a current authenticated citizen, a known dimension and an owned or explicitly granted physical chest asset. A legacy global row and teammate status grant nothing. Personal/household access requires the caller's active matching home and refuses mismatched ownership without exposing another owner. Leaving a home removes this use permission. Fixture control chests stay prohibited. The property gate authenticates before global classification and returns no rival metadata. Original legacy rows and inventory are preserved; access does not invent transfers or communicate inventory contents.

The optional dimension parameter intentionally fails closed for old community-mode callers. Two protected executor communal call sites (currently lines 894 and 935) need a separately reviewed bridge passing ctx.bot.game.dimension after world verification. Executor source remains untouched. This supporting repair does not fix its global inventory aggregates, project/runtime assumptions or complete the community experiment. The old single-settlement path is retained and regression tested.

Red: all seven initial security cases failed. Focused after repair: 31 tests passed across storage/property/homes/workstation suites before the added fixture/abandonment assertions. Eight final storage cases include positive owner/grant/revoke, unknown/rival/no-identity, dimension mismatch, owner payload privacy, abandoned home and fixture controls. Native ownership/grant restart is independently covered by the preceding workstation package. Details of final workspace checks are appended at checkpoint.

No production DB/world, Paper, paid API, protected file edits or merges. No blanket legacy ownership conversion. Overall readiness remains NOT READY; the separate real executor isolation reproducer is still expected red.

Checkpoint: full workspace 1938 passed / 0 failed / 2 skipped (176 files), process exit 0; typecheck/lint/build/diff check pass. Review-only docs/patches/executor-storage-dimension.patch passes git apply --check but is NOT applied; it is only the dimension bridge, not a full executor isolation repair. Expected protected executor blob: db9170536075212338d883643eb914d6cf0bb834. Mission 013 conflict/behavior review is still required before applying it. No other source files are modified by that check.
