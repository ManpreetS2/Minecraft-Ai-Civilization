import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { workspaceRoot } from "@civ/shared";

export function loadEnv(): void {
  loadDotenv({ path: resolve(workspaceRoot(), ".env") });
}
