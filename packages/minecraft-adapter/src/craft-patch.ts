import type { Bot } from "mineflayer";

type PatchableBot = Bot & {
  __civCraftingPatched?: boolean;
  _syncWindow?: (window: unknown) => Promise<void>;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mineflayer 4.39 craft() waits for crafting-result updateSlot/syncWindow.
 * Paper 1.21.11 often never emits that confirmation. Bound the wait so
 * inventory verification can run; do not swallow clickWindow (that broke shapeless).
 */
export function patchMineflayerCrafting(bot: Bot): void {
  const target = bot as PatchableBot;
  if (target.__civCraftingPatched) return;
  target.__civCraftingPatched = true;
  const sync = target._syncWindow?.bind(bot);
  if (typeof sync !== "function") return;
  target._syncWindow = async (window: unknown) => {
    try {
      await Promise.race([sync(window), wait(1_200)]);
    } catch {
      // confirmation packet missing is normal on 1.21.11
    }
  };
}
