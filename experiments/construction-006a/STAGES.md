# Construction evidence — construction-006a-plan-2026-10-27

- Stage: plan
- liveSession: false
- Note: offline/dry-run rows must never be treated as physical Minecraft proof.

## Stage 1 — One floor block

Atlas places one legitimately held block on the isolated pad via production placeBlock; verify world identity, inventory delta, and optional SQLite note.

Abort:
- Wrong world / port / sqlite (not isolated copy)
- Pad unloaded or within H9 / home exclusion radius
- Navigation failure
- No supporting neighbor
- ITEM_NOT_FOUND / EQUIP_FAILED
- VERIFY_FAILED or wrong block identity
- Inventory delta inconsistent with one consumed item
- Operator cancel

## Stage 2 — Supported wall

Place one wall block atop/adjacent to stage-1 floor using neighbor support + nav.

Abort:
- Stage 1 not operator-verified
- Missing support / PLACE_FAILED
- Nav / equip / verify failures
- clearSite attempts to dig protected furniture

## Stage 3 — Door multiblock

Place oak_door in a framed opening; verify lower+upper identity, facing/half properties, and functional open/enter/exit.

Abort:
- Stage 2 not operator-verified
- PURPOSELESS doorway / freestanding door
- Upper half missing or wrong identity
- Facing/hinge mismatch or properties unavailable (unverified)
- Enter/exit validation failure

## Stage 4 — workshop_cabin_v1

Full executeBuildStructurePlan → advanceBlueprintBuild with legitimate materials, checkpoints, recovery, world+property COMPLETED.

Abort:
- Stages 1–3 not operator-verified
- Site select / claim / shortfall BLOCKED
- Any VERIFY_FAILED / unverified door-bed state
- Persist failure while claiming COMPLETED
- clearSite ACCESS_DENIED near settlement furniture
- Damage to H9 or foreign property
