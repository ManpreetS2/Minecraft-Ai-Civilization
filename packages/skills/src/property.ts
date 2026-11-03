import { fail, type ActionResult, type Vec3 } from "@civ/shared";

/**
 * Citizen property safety — independent of planner intent.
 * Seeing a block/chest does NOT grant access.
 *
 * Critical invariant: NO destructive path may default to ALLOW because metadata is incomplete.
 * Unknown protected-looking settlement state fails closed / requests replan.
 * Ordinary natural resources (stone, logs) remain gatherable.
 */

export type PropertyKind =
  | "personal_chest"
  | "claimed_bed"
  | "home_structure"
  | "fixture_chest"
  | "communal_storage"
  | "door"
  | "unclaimed_house_chest";

export type PropertyRecord = {
  id: string;
  kind: PropertyKind;
  position: Vec3;
  /** Owner citizen id when personal / claimed. */
  ownerCitizenId?: string;
  /** Fixture tags e.g. fishing, mining. */
  fixtureTag?: "fishing" | "mining" | "farm" | "other";
  /** When true, destruction requires explicit construction authorization. */
  protectFromBreak: boolean;
  /** When true, open/deposit/withdraw requires ownership or communal grant. */
  protectFromAccess: boolean;
  /** Optional staleness marker from persistence layer. */
  stale?: boolean;
};

export type PermissionAction =
  | "access_container"
  | "break_block"
  | "path_dig"
  | "use_bed"
  | "open_door"
  | "destroy_door";

export type PermissionContext = {
  citizenId: string;
  action: PermissionAction;
  target: Vec3;
  blockName?: string;
  /** Explicit construction skill authorization for destructive edits. */
  constructionAuthorized?: boolean;
  /** Optional: allow communal storage for any citizen. */
  allowCommunalStorage?: boolean;
  /** When true, permission evaluation was cancelled mid-check. */
  cancelled?: boolean;
};

export type PermissionDecision = {
  allowed: boolean;
  code?: "ACCESS_DENIED" | "PATH_BLOCKED" | "CANCELLED";
  reason: string;
  matched?: PropertyRecord;
};

const CONTAINER_NAMES = new Set(["chest", "trapped_chest", "barrel", "ender_chest"]);
const BED_SUFFIX = "_bed";
const DOOR_SUFFIX = "_door";
const NATURAL_GATHER = new Set([
  "stone",
  "cobblestone",
  "deepslate",
  "cobbled_deepslate",
  "andesite",
  "diorite",
  "granite",
  "tuff",
  "dirt",
  "grass_block",
  "sand",
  "gravel",
  "coal_ore",
  "iron_ore",
  "copper_ore",
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
  "mangrove_log",
  "cherry_log",
  "pale_oak_log",
  "oak_leaves",
  "birch_leaves",
  "spruce_leaves",
]);

export function sameBlock(a: Vec3, b: Vec3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}

export function looksProtected(blockName?: string): boolean {
  if (!blockName) return false;
  return (
    CONTAINER_NAMES.has(blockName) ||
    blockName.endsWith(BED_SUFFIX) ||
    blockName.endsWith(DOOR_SUFFIX) ||
    blockName === "crafting_table" ||
    blockName === "furnace" ||
    blockName === "blast_furnace" ||
    blockName === "smoker"
  );
}

export function isOrdinaryResource(blockName?: string): boolean {
  return Boolean(blockName && NATURAL_GATHER.has(blockName));
}

export class PropertyRegistry {
  private readonly records: PropertyRecord[] = [];

  clear(): void {
    this.records.length = 0;
  }

  register(record: PropertyRecord): void {
    const idx = this.records.findIndex((r) => r.id === record.id);
    if (idx >= 0) this.records[idx] = record;
    else this.records.push(record);
  }

  list(): PropertyRecord[] {
    return [...this.records];
  }

  findAt(position: Vec3): PropertyRecord | undefined {
    return this.records.find((r) => sameBlock(r.position, position));
  }

  findNearby(position: Vec3, radius = 1): PropertyRecord[] {
    return this.records.filter((r) => {
      const dx = Math.floor(r.position.x) - Math.floor(position.x);
      const dy = Math.floor(r.position.y) - Math.floor(position.y);
      const dz = Math.floor(r.position.z) - Math.floor(position.z);
      return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) <= radius;
    });
  }
}

/**
 * Harden permissions independently of planner intent.
 */
export function checkPropertyPermission(
  registry: PropertyRegistry,
  ctx: PermissionContext,
): PermissionDecision {
  if (ctx.cancelled) {
    return { allowed: false, code: "CANCELLED", reason: "Permission check cancelled" };
  }

  const matched = registry.findAt(ctx.target) ?? inferTransientProtection(registry, ctx);
  const destructive =
    ctx.action === "break_block" || ctx.action === "path_dig" || ctx.action === "destroy_door";

  if (!matched) {
    // Fail closed for protected-looking blocks with missing ownership metadata.
    if (looksProtected(ctx.blockName)) {
      if (ctx.action === "open_door" && isDoorName(ctx.blockName)) {
        return { allowed: true, reason: "Opening unregistered doors is permitted" };
      }
      if (destructive || ctx.action === "access_container" || ctx.action === "use_bed") {
        return {
          allowed: false,
          code: ctx.action === "path_dig" ? "PATH_BLOCKED" : "ACCESS_DENIED",
          reason: "Protected-looking block has missing ownership metadata; refuse and replan",
        };
      }
    }
    // Ordinary natural resources / unknown non-protected blocks: allow gathering.
    if (destructive && isOrdinaryResource(ctx.blockName)) {
      return { allowed: true, reason: "Ordinary natural resource gathering permitted" };
    }
    if (destructive && !ctx.blockName) {
      // Incomplete metadata on a destructive action — fail closed.
      return {
        allowed: false,
        code: "PATH_BLOCKED",
        reason: "Destructive action refused: block metadata incomplete",
      };
    }
    return { allowed: true, reason: "No registered property protection" };
  }

  if (matched.stale) {
    return {
      allowed: false,
      code: destructive && ctx.action === "path_dig" ? "PATH_BLOCKED" : "ACCESS_DENIED",
      reason: "Stale ownership record; refuse until refreshed",
      matched,
    };
  }

  switch (ctx.action) {
    case "access_container":
      return decideContainerAccess(ctx, matched);
    case "use_bed":
      return decideBedUse(ctx, matched);
    case "open_door":
      return { allowed: true, reason: "Opening doors is permitted", matched };
    case "destroy_door":
    case "break_block":
    case "path_dig":
      return decideBreak(ctx, matched);
    default:
      return { allowed: false, code: "ACCESS_DENIED", reason: "Unknown permission action", matched };
  }
}

function decideContainerAccess(ctx: PermissionContext, matched: PropertyRecord): PermissionDecision {
  if (!matched.protectFromAccess) {
    return { allowed: true, reason: "Container is not access-protected", matched };
  }
  if (matched.kind === "communal_storage" && ctx.allowCommunalStorage !== false) {
    return { allowed: true, reason: "Communal storage access granted", matched };
  }
  if (matched.kind === "unclaimed_house_chest") {
    return {
      allowed: false,
      code: "ACCESS_DENIED",
      reason: "Unclaimed house chest is not personal storage for this citizen",
      matched,
    };
  }
  if (matched.kind === "fixture_chest") {
    return {
      allowed: false,
      code: "ACCESS_DENIED",
      reason: `Fixture chest (${matched.fixtureTag ?? "other"}) is not citizen personal storage`,
      matched,
    };
  }
  if (matched.ownerCitizenId && matched.ownerCitizenId === ctx.citizenId) {
    return { allowed: true, reason: "Own container access granted", matched };
  }
  if (matched.ownerCitizenId && matched.ownerCitizenId !== ctx.citizenId) {
    return {
      allowed: false,
      code: "ACCESS_DENIED",
      reason: "Another citizen's personal chest",
      matched,
    };
  }
  // Personal chest without owner id — incomplete metadata, fail closed.
  return {
    allowed: false,
    code: "ACCESS_DENIED",
    reason: "Personal chest missing ownership metadata",
    matched,
  };
}

function decideBedUse(ctx: PermissionContext, matched: PropertyRecord): PermissionDecision {
  if (matched.kind !== "claimed_bed" && matched.kind !== "home_structure") {
    return { allowed: true, reason: "Bed not under personal claim", matched };
  }
  if (matched.ownerCitizenId && matched.ownerCitizenId === ctx.citizenId) {
    return { allowed: true, reason: "Own bed use granted", matched };
  }
  if (matched.ownerCitizenId && matched.ownerCitizenId !== ctx.citizenId) {
    return {
      allowed: false,
      code: "ACCESS_DENIED",
      reason: "Claimed bed belongs to another citizen",
      matched,
    };
  }
  return {
    allowed: false,
    code: "ACCESS_DENIED",
    reason: "Claimed bed missing ownership metadata",
    matched,
  };
}

function decideBreak(ctx: PermissionContext, matched: PropertyRecord): PermissionDecision {
  if (!matched.protectFromBreak) {
    return { allowed: true, reason: "Block is not break-protected", matched };
  }
  if (ctx.constructionAuthorized && matched.kind === "home_structure" && matched.ownerCitizenId === ctx.citizenId) {
    return { allowed: true, reason: "Authorized construction on own home", matched };
  }
  return {
    allowed: false,
    code: ctx.action === "path_dig" ? "PATH_BLOCKED" : "ACCESS_DENIED",
    reason:
      ctx.action === "path_dig"
        ? "Protected property obstructs destructive shortcut; replan required"
        : "Protected property may not be broken",
    matched,
  };
}

function inferTransientProtection(
  registry: PropertyRegistry,
  ctx: PermissionContext,
): PropertyRecord | undefined {
  if (ctx.action === "path_dig" || ctx.action === "break_block") {
    const nearby = registry.findNearby(ctx.target, 1).find((r) => r.protectFromBreak);
    if (nearby) return nearby;
  }
  return undefined;
}

function isDoorName(name?: string): boolean {
  return Boolean(name && name.endsWith(DOOR_SUFFIX));
}

export function permissionFailure(decision: PermissionDecision, durationMs = 0): ActionResult<never> {
  const code = decision.code === "CANCELLED" ? "CANCELLED" : (decision.code ?? "ACCESS_DENIED");
  return fail(code, decision.reason, durationMs, code === "PATH_BLOCKED");
}

export function assertMineAllowed(
  registry: PropertyRegistry,
  citizenId: string,
  target: Vec3,
  blockName?: string,
): PermissionDecision {
  return checkPropertyPermission(registry, {
    citizenId,
    action: "path_dig",
    target,
    blockName,
    constructionAuthorized: false,
  });
}
