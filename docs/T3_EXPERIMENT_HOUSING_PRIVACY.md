# Experiment housing privacy

Parent #34 / 75202b49a525d90475d83598287316d4e5e50207; child agents/t3-experiment-housing-privacy.

Reproduced: with community isolation enabled, no observed/prepared home in the simulated world and unavailable providers, the real manager/planner selected travelTowardHousing using the old prepared World-Lab global house catalog. This leaks out-of-world coordinates into fallback planning and can silently assume supplied infrastructure. The isolated red command failed on that exact action (five unrelated tests filtered, not waived failures).

The manager now passes an empty unobserved catalog in community mode. Existing caller-owned home records remain available through the separate authenticated personal-home path. A positive planning-only regression preserves an existing home and selects its own claimed bed as the sleep target at curfew; it deliberately omits the bot to avoid claiming travel or sleep at an unmodeled structure. Legacy catalog and planner tests remain intact. No caller gains naturally found housing metadata merely from team membership or a static coordinate list.

This does not implement a full authenticated natural-house observation/claim pipeline. Such discovery must validate actual blocks/world identity and per-citizen source before offering metadata; do not re-enable the global catalog as a shortcut. No new home is assigned, reset or gifted. Prepared homes are still available in legacy single-settlement operation. Protected executor/adapter/guard/provider code is unchanged.

Focused manager/available-home/discovery/planner cases are in artifacts/campaign/housing-privacy-focused-final.log; full/type/lint/build logs use housing-privacy-*. No live server/API/production operations or merge. Overall NOT READY; protected executor aggregate isolation remains a separate failing assertion.

The positive context test initially assumed the walk-only returnHome action; inspection of the existing curfew contract showed legal night uses sleep with routing handled by the executor. The corrected assertions require sleep and the exact owned bed, without a physical success claim. No security assertion was removed.

Final workspace verification2036 passed/0 failed/2 skipped (178 files), process exit0; typecheck/lint/build/diff check pass. Initial full replay had only the positive test's obsolete action expectation; final replay passes the stronger owned-bed target assertions. The reproduced unobserved-catalog failure is fixed by the narrow manager input change.
