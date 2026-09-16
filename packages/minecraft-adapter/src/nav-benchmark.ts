/**
 * Offline navigation A/B harness.
 * Does not replace the default backend. Live timings require a spawned bot.
 */
import { createNavigationBackend, type NavigationBackend } from "./navigation.js";

export type NavScenario = {
  name: string;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
};

export const NAV_SCENARIOS: NavScenario[] = [
  { name: "flat ground", from: { x: 0, y: 64, z: 0 }, to: { x: 8, y: 64, z: 0 } },
  { name: "one-block rise", from: { x: 0, y: 64, z: 0 }, to: { x: 6, y: 65, z: 0 } },
  { name: "two-block uneven hill", from: { x: 0, y: 64, z: 0 }, to: { x: 8, y: 66, z: 4 } },
  { name: "dense forest", from: { x: 0, y: 64, z: 0 }, to: { x: 12, y: 64, z: 12 } },
  { name: "small gap", from: { x: 0, y: 64, z: 0 }, to: { x: 3, y: 64, z: 0 } },
  { name: "water", from: { x: 0, y: 64, z: 0 }, to: { x: 10, y: 62, z: 0 } },
  { name: "ladder", from: { x: 0, y: 64, z: 0 }, to: { x: 1, y: 70, z: 0 } },
  { name: "doorway", from: { x: 0, y: 64, z: 0 }, to: { x: 2, y: 64, z: 4 } },
  { name: "construction site", from: { x: 0, y: 64, z: 0 }, to: { x: 5, y: 65, z: 5 } },
  { name: "moving around other citizens", from: { x: 0, y: 64, z: 0 }, to: { x: 4, y: 64, z: 1 } },
];

export type NavBenchmarkRow = {
  backend: string;
  scenario: string;
  success: boolean;
  durationMs: number;
  stuck: boolean;
  reason?: string;
};

export function backendsUnderTest(): NavigationBackend[] {
  return [createNavigationBackend("pathfinder"), createNavigationBackend("baritone")];
}

export function describeHarness(): string {
  return `Default backend: ${createNavigationBackend(undefined).name}. Optional: mineflayer-baritone. Scenarios: ${NAV_SCENARIOS.map((s) => s.name).join(", ")}.`;
}
