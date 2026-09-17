import type { Bot } from "mineflayer";

type PatchableBot = Bot & {
  __civCraftingPatched?: boolean;
  clickWindow: (slot: number, mouseButton: number, mode: number) => Promise<void>;
  putAway: (slot: number) => Promise<void>;
};

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /updateSlot|timed out|Timeout|timeout of/i.test(message);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 1.21.11 often does not emit crafting-result `updateSlot:0` the way Mineflayer 4.39 expects.
 * Unbounded waits then look like "craft succeeded" or hang for 20s. Bound them.
 */
export function patchMineflayerCrafting(bot: Bot): void {
  const target = bot as PatchableBot;
  if (target.__civCraftingPatched) return;
  target.__civCraftingPatched = true;

  const clickWindow = target.clickWindow?.bind(bot);
  if (typeof clickWindow === "function") {
    target.clickWindow = async (slot: number, mouseButton: number, mode: number) => {
      const pending = clickWindow(slot, mouseButton, mode);
      pending.catch(() => undefined);
      try {
        await Promise.race([pending, wait(2_000)]);
      } catch (error) {
        if (!isTimeoutError(error)) throw error;
      }
    };
  }

  const putAway = target.putAway?.bind(bot);
  if (typeof putAway === "function") {
    target.putAway = async (slot: number) => {
      const pending = putAway(slot);
      pending.catch(() => undefined);
      try {
        await Promise.race([pending, wait(2_500)]);
      } catch (error) {
        if (!isTimeoutError(error)) throw error;
      }
    };
  }
}
