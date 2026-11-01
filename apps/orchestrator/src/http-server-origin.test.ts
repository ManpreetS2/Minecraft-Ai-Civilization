import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentManager } from "@civ/agent-core";
import { handleDashboardRequest, isForeignBrowserRequest } from "./http-server.js";

/** Loopback only, with a stub manager: this checks the HTTP boundary, not a live simulation. */
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function dashboard() {
  const stopCitizen = vi.fn(() => ({ ok: true as const, citizenId: "ada" }));
  const manager = { stopCitizen } as unknown as AgentManager;
  const server = createServer((req, res) => {
    void handleDashboardRequest(req, res, manager, ".", () => ({ memories: ["PRIVATE-STATE"] }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, stopCitizen };
}

describe("dashboard origin boundary", () => {
  it("a foreign web page cannot read private state", async () => {
    const { base } = await dashboard();
    const response = await fetch(`${base}/api/snapshot`, { headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("PRIVATE-STATE");
  });

  it("a foreign web page cannot stop a citizen, even with a simple no-preflight request", async () => {
    const { base, stopCitizen } = await dashboard();
    const response = await fetch(`${base}/api/citizens/ada/stop`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "text/plain" },
    });
    expect(response.status).toBe(403);
    expect(stopCitizen).not.toHaveBeenCalled();
  });

  it("the dashboard's own origin and non-browser tools still work", async () => {
    const { base, stopCitizen } = await dashboard();
    const sameOrigin = await fetch(`${base}/api/citizens/ada/stop`, { method: "POST", headers: { origin: base } });
    expect(sameOrigin.status).toBe(200);
    expect(stopCitizen).toHaveBeenCalledTimes(1);
    const tool = await fetch(`${base}/api/snapshot`);
    expect(tool.status).toBe(200);
    expect(await tool.text()).toContain("PRIVATE-STATE");
    expect(tool.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("classifies browser request metadata and malformed origins", () => {
    const check = (headers: Record<string, string>) => isForeignBrowserRequest({ headers: { host: "127.0.0.1:3000", ...headers } });
    expect(check({})).toBe(false);
    expect(check({ origin: "http://127.0.0.1:3000" })).toBe(false);
    expect(check({ "sec-fetch-site": "same-origin" })).toBe(false);
    expect(check({ origin: "http://127.0.0.1:9999" })).toBe(true);
    expect(check({ origin: "null" })).toBe(true);
    expect(check({ "sec-fetch-site": "cross-site" })).toBe(true);
    expect(check({ "sec-fetch-site": "same-site" })).toBe(true);
  });
});
