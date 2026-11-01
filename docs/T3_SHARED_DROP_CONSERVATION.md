# Shared drop conservation

Base #33 / 8389e8ca20a281b3f28b06c25335c1b00d4266e9; child agents/t3-shared-drop-conservation. This fixes the offline Mineflayer fixture, not game physics or a production inventory algorithm.

The fixture discarded an entire dropped stack after a partial pickup. A nearly full body with capacity for one berry could acquire one of a two-berry drop and silently erase the other, undermining contention/missing-drop evidence. Red:1 failed/1 passed. The remainder now stays in the shared world and entity metadata reflects its current count. A second body can collect it; a full first body leaves the entire stack intact. Tests assert total conservation and cleanup, not just successful promises.

Explicit nearly-full inventories are simulated scenario inputs; they are not supplied inventories in an empty-start experiment. Focused shared-drop/craft/manager/normal-startup suites25 passed. Typecheck/lint/build pass. Default suite results are appended at checkpoint. No production executor/adapter/provider/guard edits, live server, real API, production files or merge. Overall release remains NOT READY; the executor global inventory write remains blocked independently.

Final verification: full2034 passed/0 failed/2 skipped (178 files), process exit0; focused25 passed; typecheck/lint/build/diff pass. No production behavior change is claimed from this fixture correction.
