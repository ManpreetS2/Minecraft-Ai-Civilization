import { afterEach } from "vitest";
import { assertNoBlockedAttempts, installOfflineNetworkGuard } from "./offline-network-guard.js";

installOfflineNetworkGuard();

afterEach(() => {
  assertNoBlockedAttempts();
});
