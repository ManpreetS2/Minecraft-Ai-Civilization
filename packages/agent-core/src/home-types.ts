import type { Vec3 } from "@civ/shared";

export type StorageAccess = "personal" | "household" | "communal";
export type HomeMembershipStatus = "active" | "displaced" | "left";

export type HomeRecord = {
  id: string;
  dimension: string;
  origin: Vec3;
  /** Reachable doorway / stoop block. */
  entrance?: Vec3;
  /** Optional shared household container BLOCK cell. Not required for starter homes. */
  householdChest?: Vec3;
  createdAt: string;
  updatedAt: string;
};

export type HomeMembership = {
  citizenId: string;
  homeId: string;
  /** Floored bed HEAD block. Not the bed foot and not a standing cell. */
  bed: Vec3;
  /** Floored personal container BLOCK cell (`chest`), not the bot standing cell. */
  personalChest?: Vec3;
  storageAccess: StorageAccess;
  status: HomeMembershipStatus;
  createdAt: string;
};

/** Joined view used for navigation and access checks. */
export type CitizenHome = HomeMembership & {
  dimension: string;
  origin: Vec3;
  entrance?: Vec3;
  householdChest?: Vec3;
  members: string[];
};

export type ClaimHomeRequest = {
  citizenId: string;
  /** Join this household. Omit to create a new home. Never inferred from roster order. */
  homeId?: string;
  /** Defaults to `overworld`. Must match the world the body is in. */
  dimension?: string;
  origin: Vec3;
  entrance?: Vec3;
  bed: Vec3;
  personalChest?: Vec3;
  householdChest?: Vec3;
  storageAccess?: StorageAccess;
  /** Required to replace an existing active/displaced home instead of silently overwriting it. */
  move?: boolean;
};
