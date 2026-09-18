# Minecraft inventory and item transfer

Physical inventory is **Mineflayer state**. Cognition may store ownership beliefs, reservations, promises, and social meaning. It may **not** override what the body carries.

Never let an LLM invent inventory facts.

## Architecture

```
Mineflayer bot.inventory / heldItem / equip / toss / container.deposit|withdraw
        ^
        |  only physical source of truth
        |
InventoryService (@civ/skills inventory-service.ts)
        |
        +-- snapshot, counts, capacity, reservations
        +-- verified drop / pickup / deposit / withdraw / equip
        +-- transferItemToCitizen (drop in world, then pickup)
        |
Planner / cognition compact facts
```

One physical path. Do not add a second inventory implementation.

## Item identity

Primary key: registry **name** (`oak_log`, `oak_planks`, `stone_pickaxe`). Do not treat “planks” as interchangeable. 1.21.11 lists cherry variants before oak; recipe scoring already avoids `recipes[0]`.

Each stack snapshot keeps:

- name, count, slot
- stackSize from the item / minecraft-data (`knowledge.stackSize`, never assume 64)
- durability / NBT / components when present

## Snapshot

`snapshotInventory()` reads Mineflayer high-level inventory APIs:

- storage slots: `inventoryStart`..`inventoryEnd` (main + hotbar)
- `heldItem`, `quickBarSlot`
- equipment via `getEquipmentDestSlot` (head, torso, legs, feet, off-hand)

Armor, crafting grid, craft result, and off-hand are **not** generic storage.

## Capacity

`freeCapacity(itemName)` = room in matching partial stacks + empty storage slots × that item’s `stackSize`.

`canReceive(name, count)` is that value.

`INVENTORY_FULL` is a **report**. The skill does not dump valuables. The planner chooses deposit, go home, discard low-value, finish, or transfer.

Reserved / project / personal items stay protected (`ITEM_RESERVED`).

## Reservations

`ItemReservationBook` is planner state **above** Minecraft. Physical counts stay authoritative.

Before craft, drop, transfer, or deposit: use `availableUnreservedCount`.

Examples: 3 planks for a pickaxe, 12 planks for shelter, 6 bread promised for transfer.

## Drop vs give vs container

| Action | Meaning | API |
| --- | --- | --- |
| DROP / DISCARD | abandon into the world | `dropItem(name, count, purpose)` |
| TRANSFER / GIVE intent | specific recipient should acquire | `transferItemToCitizen` then `ResourceTransferred` **only if both deltas match** |
| DEPOSIT | citizen → container | `depositItem` / `depositItems` |
| WITHDRAW | container → citizen | `withdrawItem` |

Purposes: `DISCARD`, `TRANSFER`, `EMERGENCY_SPACE`, `DEV_TEST`.

`tossStack` only when the intended action is that entire selected stack. Partial counts use `bot.toss`.

Verification: `beforeCount - afterCount === requested`. Nearby item entities are observed when present.

Pickup of a world item is **not** a gift. Another citizen, despawn, or a mob can take it.

## World item entities

```
INVENTORY → DROP → WORLD ITEM ENTITY → PICKUP → INVENTORY
```

A drop may be collected by the intended body, another body, remain, or despawn. Transfers are never instantaneous inventory edits.

## Citizen-to-citizen transfer

`transferItemToCitizen(Atlas, Maya, oak_log, 8)`:

1. Atlas has ≥ 8 unreserved oak_log
2. Maya `canReceive` 8
3. reserve the quantity
4. both walk into range
5. snapshot both inventories
6. Atlas tosses exactly 8 (`purpose: TRANSFER`)
7. Maya picks up the world item
8. success only if Atlas −8 and Maya +8
9. emit `ResourceTransferred` (physical, `gift: false`)

If Atlas lost the items and Maya did not gain them: `TRANSFER_INCOMPLETE` with cause:

`OTHER_ENTITY_PICKED_UP` | `ITEM_NOT_COLLECTED` | `RECIPIENT_FULL` | `RECIPIENT_MOVED` | `ITEM_DESPAWNED` | `DROP_FAILED` | `PICKUP_FAILED`

Social “sharing” is a later interpretation of that objective event.

## Containers

Use `container.deposit` / `container.withdraw`. Promise resolve is not success.

Deposit: citizen decreases **and** container increases.  
Withdraw: container decreases **and** citizen increases. Withdraw refuses with `INVENTORY_FULL` when `canReceive` is false.

## Equipment

`equipItem` / `unequip` / `setQuickBarSlot` go through the same service. Tool skills call `equipItem`. Verify held/equipped name changed.

## Cognition

Do not dump slot arrays. Compact facts:

```
oak_log: 12
cobblestone: 31
cooked_beef: 5
wooden_pickaxe: 1
held: wooden_pickaxe
freeSlots: 9
reserved oak_log: 8 for shelter
```

Plus `foodCarried`, `toolsCarried`, `importantResources`, `inventoryLoad`.

## Death

Dev respawn does not restore Minecraft items. `CitizenDied` / `CitizenBodyDied` include the last inventory snapshot and `droppedByMinecraft: true`. Permadeath/property can interpret those drops later.

## Failure codes

| Code | Meaning |
| --- | --- |
| `INVENTORY_FULL` | no storage room |
| `ITEM_RESERVED` | physical count exists but is reserved |
| `ITEM_NOT_FOUND` | not carried / not in container |
| `DROP_FAILED` | toss threw or count did not fall |
| `PICKUP_FAILED` | walked to drops, inventory unchanged |
| `RECIPIENT_FULL` | receiver capacity |
| `TRANSFER_INCOMPLETE` | giver lost and/or receiver did not gain |
| `DEPOSIT_FAILED` / `WITHDRAW_FAILED` / `VERIFY_FAILED` | one-sided or zero delta |
| `EQUIP_FAILED` | equip/unequip did not stick |

## Upstream bakeoff

| Project | Inventory | Drop / share | Verdict |
| --- | --- | --- | --- |
| Mineflayer | `items()`, `toss`, `tossStack`, `equip`, `openContainer` | physical primitives | **WRAP** |
| minecraft-data | `stackSize` | — | **WRAP** facts |
| Mindcraft | `getInventoryCounts`, craft then log counts | drops via collectblock; no verified peer transfer | REFERENCE |
| Phoenix | `InventoryManager.ensure/countItem`, `DropItem` task, `placeCraftingTable` at feet | DropItem exists; table dump illegal here; `recipesFor()[0]` | REFERENCE patterns only |
| collectblock | auto chest dump | bypasses settlement inventory | Do **not** load plugin |

Phoenix DropItem is a useful *task name*. Our drop still requires purpose + exact delta. Do not copy naive dump-to-make-space.

## Live tests

MechProbe (`pnpm --filter @civ/orchestrator mechanics`):

- `authoritative inventory snapshot/drop/equip/capacity`
- `authoritative probe-to-probe transfer` (MechProbe → MechProbeB)
- existing chest deposit/withdraw

Filter: `MECHANICS_TEST_FILTER=inventory`.

MechProbe / MechProbeB are never citizens.
