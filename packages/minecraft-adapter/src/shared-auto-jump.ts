import { CITIZEN_NAMES } from "@civ/shared";
import { jumpApproachTicks, STEP_JUMP_LIMITS } from "./step-jump.js";

/**
 * Mineflayer bodies do not read the human client's Auto-Jump option.
 * Shared one-block ascent (pathfinder getMoveJumpUp + verified stall hop) is the bot equivalent.
 */
export const SHARED_AUTO_JUMP = {
  enabled: true,
  humanClientSettingAffectsBots: false,
  navigator: "mineflayer-pathfinder",
  maxApproachTicks: 2,
  maxJumpAttempts: STEP_JUMP_LIMITS.maxJumpAttempts,
  maxRecoveries: STEP_JUMP_LIMITS.maxRecoveries,
  jumpTicks: STEP_JUMP_LIMITS.jumpTicks,
  refuses: [
    "door",
    "two-block",
    "fence",
    "lava",
    "magma",
    "unsafe drop",
    "unknown landing",
    "blocked headroom",
  ],
} as const;

export function sharedAutoJumpPolicy() {
  return {
    enabled: SHARED_AUTO_JUMP.enabled,
    humanClientSettingAffectsBots: SHARED_AUTO_JUMP.humanClientSettingAffectsBots,
    navigator: SHARED_AUTO_JUMP.navigator,
    citizens: [...CITIZEN_NAMES],
    maxApproachTicks: SHARED_AUTO_JUMP.maxApproachTicks,
    maxJumpAttempts: STEP_JUMP_LIMITS.maxJumpAttempts,
    maxRecoveries: STEP_JUMP_LIMITS.maxRecoveries,
    jumpTicks: STEP_JUMP_LIMITS.jumpTicks,
    approachAtFaceTicks: jumpApproachTicks(0.5),
    recoverByDefault: true,
    refuses: SHARED_AUTO_JUMP.refuses,
  };
}

export function citizenInheritsSharedAutoJump(username: string, backendName: string): boolean {
  return (CITIZEN_NAMES as readonly string[]).includes(username) && backendName === SHARED_AUTO_JUMP.navigator;
}
