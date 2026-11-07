import { expect, it } from "vitest";
import { pathsCollideForIsolation } from "./construction-experiment-guard.js";
it("refuses protected-path case collisions independently of host filesystem semantics", () => {
  expect(pathsCollideForIsolation("/workspace/DATA/evidence", "/workspace/data")).toBe(true);
  expect(pathsCollideForIsolation("/workspace/data", "/workspace/DATA/evidence")).toBe(true);
  expect(pathsCollideForIsolation("/workspace/data-isolated/evidence", "/workspace/data")).toBe(false);
  expect(pathsCollideForIsolation("/workspace/artifacts/evidence", "/workspace/data")).toBe(false);
});
