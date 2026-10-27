import { normalizeBlockName } from "./names.js";

export type PropertyBreakDecision =
  | { ok: true }
  | { ok: false; code: "ACCESS_DENIED"; error: string };

/**
 * House furniture that ordinary mining, path-clearing, and placement must not
 * destroy. Seeing the block is not permission to break or overwrite it.
 */
export function isProtectedFurnitureName(name: string | undefined): boolean {
  if (!name) return false;
  const n = normalizeBlockName(name);
  return (
    n === "chest" ||
    n === "trapped_chest" ||
    n === "barrel" ||
    n === "ender_chest" ||
    n.endsWith("_bed") ||
    n.endsWith("_door") ||
    n === "iron_door"
  );
}

export function refuseAccidentalPropertyBreak(name: string | undefined): PropertyBreakDecision {
  if (!isProtectedFurnitureName(name)) return { ok: true };
  const n = normalizeBlockName(name);
  return {
    ok: false,
    code: "ACCESS_DENIED",
    error: `Refusing to break ${n}; discovering a house, chest, bed, or door is not permission to destroy it`,
  };
}

export function refuseAccidentalPropertyReplace(existingName: string | undefined): PropertyBreakDecision {
  if (!isProtectedFurnitureName(existingName)) return { ok: true };
  const n = normalizeBlockName(existingName);
  return {
    ok: false,
    code: "ACCESS_DENIED",
    error: `Refusing to place over ${n}; existing house furniture is not a free cell`,
  };
}
