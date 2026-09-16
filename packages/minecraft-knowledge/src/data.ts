import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const DEFAULT_MC_VERSION = "1.21.11";

export type McItem = { id: number; name: string; stackSize?: number };
export type McBlock = {
  id: number;
  name: string;
  hardness?: number | null;
  harvestTools?: Record<string, boolean>;
  boundingBox?: string;
  transparent?: boolean;
  material?: string;
  diggable?: boolean;
};
export type McFood = { name: string; foodPoints: number; saturation: number; stackSize?: number };
export type McEntity = { id?: number; name: string; type?: string; category?: string };

export type McData = {
  version: { minecraftVersion: string };
  itemsByName: Record<string, McItem>;
  items: Record<number | string, McItem>;
  blocksByName: Record<string, McBlock>;
  blocks: Record<number | string, McBlock>;
  foodsByName?: Record<string, McFood>;
  foods?: McFood[];
  recipes?: Record<number | string, unknown>;
  entitiesByName?: Record<string, McEntity>;
  materials?: Record<string, Record<string, number>>;
};

type McDataModule = {
  (version: string): McData;
  versions: Array<{ minecraftVersion: string; version: number; majorVersion?: string }>;
  supportedVersions: { pc: string[] };
};

function loadModule(): McDataModule {
  return require("minecraft-data") as McDataModule;
}

export function resolveMinecraftVersion(requested = DEFAULT_MC_VERSION): string {
  const mod = loadModule();
  const pc = mod.supportedVersions?.pc ?? [];
  if (pc.includes(requested)) return requested;
  const sameMinor = [...pc].reverse().find((version) => version.startsWith("1.21"));
  return sameMinor ?? pc.at(-1) ?? requested;
}

export function loadMinecraftData(requested = DEFAULT_MC_VERSION): McData {
  const mod = loadModule();
  const version = resolveMinecraftVersion(requested);
  return mod(version);
}
