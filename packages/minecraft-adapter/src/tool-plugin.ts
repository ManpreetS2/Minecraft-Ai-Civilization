import { createRequire } from "node:module";
import type { Bot } from "mineflayer";

const require = createRequire(import.meta.url);

type ToolApi = {
  equipForBlock: (block: unknown, options?: { requireHarvest?: boolean; getFromChest?: boolean }) => Promise<void>;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function loadToolPlugin(bot: Bot): void {
  const toolMod = require("mineflayer-tool") as { plugin: (bot: Bot) => void };
  const asPlugins = bot as Bot & { tool?: ToolApi };
  if (!asPlugins.tool) bot.loadPlugin(toolMod.plugin);
}

export async function equipToolForBlock(
  bot: Bot,
  block: unknown,
): Promise<{ equipped: boolean; error?: string }> {
  loadToolPlugin(bot);
  await wait(80);
  const tool = (bot as Bot & { tool?: ToolApi }).tool;
  if (!tool?.equipForBlock) return { equipped: false, error: "tool plugin missing" };
  try {
    await tool.equipForBlock(block, { requireHarvest: true, getFromChest: false });
    return { equipped: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { equipped: false, error: message };
  }
}
