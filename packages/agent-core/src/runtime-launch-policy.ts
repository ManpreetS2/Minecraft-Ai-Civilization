import { CivilizationStore } from "./store.js";

export class RuntimeLaunchRefusedError extends Error {
  readonly code = "RUNTIME_FILESYSTEM_CONTAINMENT_UNAVAILABLE";
  constructor(detail: string) {
    super(detail);
    this.name = "RuntimeLaunchRefusedError";
  }
}

/**
 * Live launch is deliberately disabled. A checked pathname or read-only FD does not bind better-sqlite3's
 * later filename open or SQLite sidecars, and this process has no verified OS containment/immutable production root.
 * No environment switch, preflight object or free-text approval can certify that missing boundary.
 */
export function assertLiveRuntimeLaunchAllowed(): void {
  throw new RuntimeLaunchRefusedError(
    "Live launch disabled: filesystem containment for world, SQLite filename opens and sidecars is not established",
  );
}

/** Sidecar-free offline default. Explicit disposable file fixtures can still inject an already-open store. */
export function openOfflineRuntimeStore(databasePath: string): CivilizationStore {
  if (databasePath !== ":memory:") {
    throw new RuntimeLaunchRefusedError(
      "Runtime SQLite filename open refused: containment is unavailable; use an explicit disposable offline fixture or :memory:",
    );
  }
  return new CivilizationStore(":memory:");
}
