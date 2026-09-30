import type { Vec3 } from "@civ/shared";

/**
 * Bounded water / swimming safety logic (cloud unit-testable).
 * NEVER teleports. NEVER fabricates arrival. Does not place blocks unless a
 * separately authorized construction skill allows it (not part of this module).
 *
 * LIVE UNVERIFIED against real Mineflayer/pathfinder water physics.
 */

export type FluidKind = "none" | "water" | "lava" | "other";

export type WaterCell = {
  position: Vec3;
  blockName: string;
  isWater: boolean;
  isLava: boolean;
  isSolidStand: boolean;
  waterDepth: number;
  /** Unusual water (bubble column, etc.) — handled conservatively. */
  unusual?: boolean;
};

export type BodyWaterState = {
  position: Vec3;
  feet: WaterCell;
  head?: WaterCell;
  air?: number;
  connected: boolean;
  cancelled?: boolean;
  /** Intentional fishing / shore activity — do not treat as drowning. */
  fishingActivity?: boolean;
};

export type ShoreCandidate = {
  position: Vec3;
  distance: number;
  reachableEstimate: boolean;
  blocked?: boolean;
};

export type WaterSafetyDecision =
  | {
      action: "none";
      reason: string;
      inWater: boolean;
      submerged: boolean;
      interruptWork?: boolean;
    }
  | {
      action: "avoid_deep_water";
      reason: string;
      inWater: boolean;
      submerged: boolean;
      preferLandRoute: true;
      interruptWork?: boolean;
    }
  | {
      action: "swim_to_shore";
      reason: string;
      inWater: boolean;
      submerged: boolean;
      target: Vec3;
      lowAir: boolean;
      interruptWork: boolean;
      teleported?: false;
      fabricatedArrival?: false;
    }
  | {
      action: "abort";
      reason: string;
      inWater: boolean;
      submerged: boolean;
      code: "WATER_UNSAFE" | "NO_SHORE" | "CANCELLED" | "NOT_CONNECTED" | "NO_PROGRESS" | "MAX_STEPS";
      interruptWork?: boolean;
    };

export type WaterSessionPhase =
  | "idle"
  | "shallow"
  | "deep"
  | "submerged"
  | "escaping"
  | "recovered"
  | "aborted";

export const SHALLOW_WATER_MAX_DEPTH = 1;
export const LOW_AIR_THRESHOLD = 6;
export const MAX_SWIM_STEPS = 24;
export const NO_PROGRESS_STEPS = 4;

export function classifyFluid(blockName: string): FluidKind {
  const name = blockName.toLowerCase();
  if (
    name === "water" ||
    name === "flowing_water" ||
    name === "bubble_column" ||
    name === "kelp" ||
    name === "seagrass" ||
    name === "tall_seagrass"
  ) {
    return "water";
  }
  if (name === "lava" || name === "flowing_lava") return "lava";
  if (name === "air" || name === "cave_air" || name === "void_air") return "none";
  return "other";
}

export function isWaterBlock(blockName: string): boolean {
  return classifyFluid(blockName) === "water";
}

export function isLavaBlock(blockName: string): boolean {
  return classifyFluid(blockName) === "lava";
}

export function detectInWater(state: BodyWaterState): boolean {
  return state.feet.isWater || Boolean(state.head?.isWater);
}

export function detectSubmerged(state: BodyWaterState): boolean {
  return Boolean(state.head?.isWater) || (state.feet.isWater && state.feet.waterDepth >= 2);
}

export function isShallowWater(cell: WaterCell): boolean {
  return cell.isWater && cell.waterDepth > 0 && cell.waterDepth <= SHALLOW_WATER_MAX_DEPTH;
}

export function isDeepWater(cell: WaterCell): boolean {
  return cell.isWater && cell.waterDepth > SHALLOW_WATER_MAX_DEPTH;
}

export function planWaterSafety(
  state: BodyWaterState,
  shores: ShoreCandidate[],
  options: {
    allowDeepWater?: boolean;
    preferLandRoute?: boolean;
    landRouteAvailable?: boolean;
    waterRouteShorter?: boolean;
  } = {},
): WaterSafetyDecision {
  if (!state.connected) {
    return {
      action: "abort",
      reason: "Body disconnected; cannot swim",
      inWater: false,
      submerged: false,
      code: "NOT_CONNECTED",
    };
  }
  if (state.cancelled) {
    return {
      action: "abort",
      reason: "Operation cancelled",
      inWater: detectInWater(state),
      submerged: detectSubmerged(state),
      code: "CANCELLED",
    };
  }

  if (state.feet.isLava || state.head?.isLava) {
    return {
      action: "abort",
      reason: "Lava hazard is not water; water escape logic must not apply",
      inWater: false,
      submerged: false,
      code: "WATER_UNSAFE",
    };
  }

  const inWater = detectInWater(state);
  const submerged = detectSubmerged(state);
  const lowAir = state.air !== undefined && state.air <= LOW_AIR_THRESHOLD;
  const unusual = Boolean(state.feet.unusual || state.head?.unusual);

  // Intentional fishing at shore must not be mistaken for drowning.
  if (state.fishingActivity && inWater && !submerged && !lowAir) {
    return {
      action: "none",
      reason: "Intentional fishing shore activity; not drowning recovery",
      inWater: true,
      submerged: false,
      interruptWork: false,
    };
  }

  if (!inWater) {
    if (options.preferLandRoute !== false && options.landRouteAvailable && options.waterRouteShorter) {
      return {
        action: "avoid_deep_water",
        reason: "Water route shorter but safe land route available; prefer land",
        inWater: false,
        submerged: false,
        preferLandRoute: true,
      };
    }
    if (options.preferLandRoute !== false && isDeepWater(state.feet)) {
      return {
        action: "avoid_deep_water",
        reason: "Deep water ahead; prefer safe land route",
        inWater: false,
        submerged: false,
        preferLandRoute: true,
      };
    }
    return { action: "none", reason: "Not in water", inWater: false, submerged: false };
  }

  // Bot already exited water before recovery begins.
  // (handled by !inWater above when feet/head dry)

  const reachable = shores
    .filter((s) => s.reachableEstimate && !s.blocked)
    .sort((a, b) => a.distance - b.distance);

  if (reachable.length === 0) {
    return {
      action: "abort",
      reason: "No reachable shore/solid standing cell",
      inWater: true,
      submerged,
      code: "NO_SHORE",
      interruptWork: true,
    };
  }

  const target = reachable[0]!;

  if (unusual && (submerged || lowAir)) {
    return {
      action: "swim_to_shore",
      reason: "Unusual water state observed; conservatively escape to shore",
      inWater: true,
      submerged,
      target: target.position,
      lowAir,
      interruptWork: true,
      teleported: false,
      fabricatedArrival: false,
    };
  }

  if (isShallowWater(state.feet) && !submerged && !lowAir && options.allowDeepWater !== true) {
    return {
      action: "none",
      reason: "Shallow water; continue unless submerged or low air",
      inWater: true,
      submerged: false,
      interruptWork: false,
    };
  }

  return {
    action: "swim_to_shore",
    reason: lowAir
      ? "Low air — escape to nearest reachable shore"
      : submerged
        ? "Submerged — swim toward shore"
        : "In water — swim toward reachable shore",
    inWater: true,
    submerged,
    target: target.position,
    lowAir,
    interruptWork: submerged || lowAir,
    teleported: false,
    fabricatedArrival: false,
  };
}

/**
 * Stateful recovery session: enforces no teleport, no fake arrival,
 * bounded steps, and honest cancellation / no-progress failures.
 */
export class WaterRecoverySession {
  phase: WaterSessionPhase = "idle";
  steps = 0;
  noProgress = 0;
  lastPosition?: Vec3;
  lastDecision?: WaterSafetyDecision;
  readonly history: WaterSafetyDecision[] = [];

  step(
    state: BodyWaterState,
    shores: ShoreCandidate[],
    options: Parameters<typeof planWaterSafety>[2] = {},
  ): WaterSafetyDecision {
    this.steps += 1;
    if (this.steps > MAX_SWIM_STEPS) {
      const decision: WaterSafetyDecision = {
        action: "abort",
        reason: "Max swim steps exceeded; refusing infinite swim loop",
        inWater: detectInWater(state),
        submerged: detectSubmerged(state),
        code: "MAX_STEPS",
        interruptWork: true,
      };
      this.phase = "aborted";
      this.lastDecision = decision;
      this.history.push(decision);
      return decision;
    }

    // Already dry before / during recovery.
    if (!detectInWater(state) && this.phase !== "idle") {
      const decision: WaterSafetyDecision = {
        action: "none",
        reason: "Exited water before/during recovery; no fabricated arrival",
        inWater: false,
        submerged: false,
        interruptWork: false,
      };
      this.phase = "recovered";
      this.lastDecision = decision;
      this.history.push(decision);
      this.lastPosition = state.position;
      return decision;
    }

    if (this.lastPosition && detectInWater(state)) {
      const moved =
        Math.hypot(
          state.position.x - this.lastPosition.x,
          state.position.y - this.lastPosition.y,
          state.position.z - this.lastPosition.z,
        ) >= 0.25;
      this.noProgress = moved ? 0 : this.noProgress + 1;
      if (this.noProgress >= NO_PROGRESS_STEPS) {
        const decision: WaterSafetyDecision = {
          action: "abort",
          reason: "Water current caused no positional progress",
          inWater: true,
          submerged: detectSubmerged(state),
          code: "NO_PROGRESS",
          interruptWork: true,
        };
        this.phase = "aborted";
        this.lastDecision = decision;
        this.history.push(decision);
        return decision;
      }
    }

    const decision = planWaterSafety(state, shores, options);
    // Invariant: never teleport / never fabricate arrival.
    if (decision.action === "swim_to_shore") {
      decision.teleported = false;
      decision.fabricatedArrival = false;
      this.phase = decision.submerged || decision.lowAir ? "escaping" : "deep";
    } else if (decision.action === "none" && decision.inWater) {
      this.phase = "shallow";
    } else if (decision.action === "abort") {
      this.phase = "aborted";
    } else if (!decision.inWater) {
      this.phase = this.phase === "idle" ? "idle" : "recovered";
    }

    this.lastDecision = decision;
    this.history.push(decision);
    this.lastPosition = state.position;
    return decision;
  }
}

export function findShoreCandidates(
  origin: Vec3,
  sample: (pos: Vec3) => WaterCell | undefined,
  radius = 6,
): ShoreCandidate[] {
  const out: ShoreCandidate[] = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        const pos = { x: origin.x + dx, y: origin.y + dy, z: origin.z + dz };
        const cell = sample(pos);
        if (!cell || !cell.isSolidStand || cell.isWater || cell.isLava) continue;
        const above = sample({ x: pos.x, y: pos.y + 1, z: pos.z });
        if (above && (above.isSolidStand || above.isLava)) continue;
        const distance = Math.hypot(dx, dy, dz);
        out.push({
          position: pos,
          distance,
          reachableEstimate: !cell.isLava && distance <= radius,
        });
      }
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}
