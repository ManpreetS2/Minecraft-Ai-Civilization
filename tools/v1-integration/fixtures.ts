import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CivilizationStore } from '../../packages/agent-core/src/index.js';
import { OFFLINE_2V2_ASSIGNMENTS, createInMemoryCitizenSessionStore } from '../../packages/cognition/src/routing/index.js';
import { createMineflayerCraftFixture, createSharedCraftWorld } from '../../packages/skills/src/testing/mineflayer-craft-fixture.js';
import { createNavigationBackend, setNavigationBackend, type MinecraftBody, type NavigationBackend } from '../../packages/minecraft-adapter/src/index.js';
import { loadConfig, ok, type BodyObservation } from '../../packages/shared/src/index.js';
import { createIndependentOfflineRuntime } from '../../apps/orchestrator/src/independent-offline-runtime.js';

/** The public inputs are data only. The sole body factory below is internally constructed. */
export function buildFixture(count: 2 | 4, goal: 'observe' | 'gather_wood') {
  const directory = mkdtempSync(join(tmpdir(), 'v1-scenario-'));
  const databasePath = join(directory, 'fixture.sqlite');
  const store = new CivilizationStore(databasePath);
  const assignments = OFFLINE_2V2_ASSIGNMENTS.filter(a => count === 4 || a.citizenId.endsWith('-a')).map(a => ({ ...a, citizenName: a.citizenName.replaceAll('-', '_') }));
  const audit = { actor: 'orchestrator-config' as const, reason: 'isolated offline fixture' };
  store.upsertCommunity('north', 'North', audit); store.upsertCommunity('south', 'South', audit);
  for (const a of assignments) store.addCommunityMember(a.citizenId.endsWith('-a') ? (a.family === 'gpt' ? 'north' : 'south') : (a.family === 'gpt' ? 'south' : 'north'), a.citizenId, audit);
  const shared = createSharedCraftWorld();
  const bodies = new Map(assignments.map((a, i) => [a.citizenId, createMineflayerCraftFixture({ sharedWorld: shared, start: { x: i * 30 + 0.5, y: 64, z: 0.5 }, trees: [{ x: i * 30 + 6, z: 3, height: 6 }] })] as const));
  const config = loadConfig({ DEMO_PROFILE: 'none', SIM_CITIZEN_COUNT: String(count), SIM_RUN_ID: 'v1-offline-fixture', LLM_ENABLED: 'true', LLM_PROVIDER: 'none', CLOUD_LLM_ENABLED: 'false', LLM_COOLDOWN_MS: '1', CLOUD_MAX_CONCURRENCY: '4', CLOUD_MAX_REQUESTS_PER_RUN: '20', HUMAN_DIRECTIVES_ENABLED: 'false' });
  const createBody = (options: ConstructorParameters<typeof MinecraftBody>[0]) => {
    const fx = bodies.get(options.citizenId ?? '');
    if (!fx) throw new Error('unknown fixture citizen');
    return { connected: true, on: () => undefined, connect: async () => ok({}, 0), disconnect: async () => undefined, isDeceased: () => false, isAwaitingRespawn: () => false, getBot: () => fx.ctx.bot, inventory: () => fx.items, position: () => fx.bot.entity.position, nearbyEntities: () => [], nearbyPlayers: () => [], stopPathfinding: () => undefined, unreachable: { has: () => false, mark: () => undefined }, observe: (): BodyObservation => ({ username: options.username, connected: true, spawned: true, health: 20, food: fx.bot.food, position: fx.bot.entity.position, inventory: fx.items, nearby: [], players: [], gameTime: 1000, isNight: false }) } as unknown as MinecraftBody;
  };
  const nav = { name: 'v1-offline' } as NavigationBackend;
  for (const key of ['navigateToPosition', 'navigateNear', 'navigateToInteractWithBlock', 'navigateToPlaceBlock', 'followEntity', 'escapeFrom', 'probeReachability', 'stop'] as const) Object.assign(nav, { [key]: (bot: unknown, ...args: unknown[]) => {
    const fx = [...bodies.values()].find(f => f.ctx.bot === bot);
    if (!fx) throw new Error('unknown offline bot');
    return Reflect.apply(fx.nav[key], fx.nav, [bot, ...args]);
  } });
  setNavigationBackend(nav);
  const sessionStore = createInMemoryCitizenSessionStore();
  const args: Parameters<typeof createIndependentOfflineRuntime>[0] = { config, store, assignmentsJson: JSON.stringify(assignments), sessionStore, resolveSecret: ref => `synthetic-${ref.env}`, script: () => ({ goal }), createBody };
  try {
    const runtime = createIndependentOfflineRuntime(args);
    return { ...runtime, store, assignments, bodies, args, databasePath, cleanup: () => rmSync(directory, { recursive: true, force: true }), restoreNavigation: () => setNavigationBackend(createNavigationBackend('pathfinder')) };
  } catch (error) { setNavigationBackend(createNavigationBackend('pathfinder')); store.close(); rmSync(directory, { recursive: true, force: true }); throw error; }
}

