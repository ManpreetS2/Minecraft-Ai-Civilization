import { curfewWorkInterrupted, type ReturnHomePlan } from "@civ/minecraft-adapter";
import { fail, type ActionFailure } from "@civ/shared";

/**
 * Bedtime is not a work PASS. Call BLUE `curfewWorkInterrupted` and keep the
 * real inventory / partial quota in details. Does not drop items or touch
 * another citizen.
 */
export function optionalWorkInterrupted(input: {
  plan: ReturnHomePlan;
  durationMs: number;
  inventory: Record<string, number>;
  extra?: Record<string, unknown>;
}): ActionFailure {
  const stopped = curfewWorkInterrupted({
    plan: input.plan,
    durationMs: input.durationMs,
    inventory: input.inventory,
  });
  return {
    ...stopped,
    details: {
      ...stopped.details,
      ...input.extra,
      workComplete: false,
      inventoryPreserved: true,
    },
  };
}

export function cancelledThisCitizen(input: {
  durationMs: number;
  inventory: Record<string, number>;
  extra?: Record<string, unknown>;
  error?: string;
}): ActionFailure {
  return fail("CANCELLED", input.error ?? "Task cancelled for this citizen", input.durationMs, false, {
    workComplete: false,
    inventoryPreserved: true,
    inventory: input.inventory,
    ...input.extra,
  });
}
