/**
 * Generic tracked-entity lifecycle.
 * Death, despawn, and removal are not "out of range".
 */

export type EntityPresence = "PRESENT" | "TARGET_DEAD" | "ENTITY_REMOVED";

export type EntityLike = {
  id?: number;
  name?: string;
  username?: string;
  health?: number;
  isValid?: boolean;
};

export function classifyEntityPresence(
  entities: Record<number, EntityLike | undefined> | undefined,
  entity: EntityLike | null | undefined,
): EntityPresence {
  if (!entity) return "ENTITY_REMOVED";
  if (typeof entity.health === "number" && entity.health <= 0) return "TARGET_DEAD";
  if (entity.isValid === false) return "TARGET_DEAD";
  const id = entity.id;
  if (id == null || !entities) return "ENTITY_REMOVED";
  const live = entities[id];
  if (!live) return "ENTITY_REMOVED";
  if (typeof live.health === "number" && live.health <= 0) return "TARGET_DEAD";
  if (live.isValid === false) return "TARGET_DEAD";
  return "PRESENT";
}

export function isEntityPresent(
  entities: Record<number, EntityLike | undefined> | undefined,
  entity: EntityLike | null | undefined,
): boolean {
  return classifyEntityPresence(entities, entity) === "PRESENT";
}

export function entityGoneMessage(code: Exclude<EntityPresence, "PRESENT">, name?: string): string {
  const who = name || "entity";
  if (code === "TARGET_DEAD") {
    return `TARGET_DEAD: ${who} died or was destroyed, not out of range.`;
  }
  return `ENTITY_REMOVED: ${who} despawned or was removed, not out of range.`;
}
