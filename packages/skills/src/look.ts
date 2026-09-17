import { Vec3 as Vec3Class } from "vec3";
import type { Vec3 } from "@civ/shared";
import type { SkillContext } from "./context.js";

export async function lookAtPosition(ctx: SkillContext, pos: Vec3): Promise<void> {
  try {
    await ctx.bot.lookAt(new Vec3Class(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5));
  } catch {
    // looking is best-effort before a physical interaction
  }
}
