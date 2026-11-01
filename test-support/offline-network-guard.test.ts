import { spawnSync } from "node:child_process";
import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  OfflineNetworkGuardError,
  blockedAttempts,
  clearBlockedAttempts,
  isLoopbackHost,
} from "./offline-network-guard.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// TEST-NET-3 (RFC 5737) is reserved for documentation. The guard throws before any packet leaves.
const REMOTE = "203.0.113.7";

/** Tests here attempt prohibited traffic on purpose, so they clear the record that setup.ts would fail them for. */
afterEach(() => clearBlockedAttempts());

describe("offline network guard", () => {
  it("blocks a raw socket and records it even when the caller swallows the error", () => {
    let seen: unknown;
    try {
      net.connect(443, REMOTE).on("error", () => undefined);
    } catch (error) {
      seen = error;
    }
    expect(seen).toBeInstanceOf(OfflineNetworkGuardError);
    expect(blockedAttempts()).toEqual([{ transport: "socket connect", target: REMOTE }]);
  });

  it("blocks http, tls and fetch", async () => {
    expect(() => http.get(`http://${REMOTE}/`)).toThrow(OfflineNetworkGuardError);
    expect(() => tls.connect(443, REMOTE)).toThrow(OfflineNetworkGuardError);
    await expect(fetch(`https://${REMOTE}/`)).rejects.toThrow(OfflineNetworkGuardError);
    await expect(fetch("https://api.openai.com/v1/responses")).rejects.toThrow(OfflineNetworkGuardError);
    expect(blockedAttempts().map((a) => a.transport)).toEqual(["socket connect", "socket connect", "fetch", "fetch"]);
  });

  it("blocks UDP and DNS to non-loopback names", async () => {
    const udp = dgram.createSocket("udp4");
    try {
      expect(() => udp.send("x", 53, REMOTE)).toThrow(OfflineNetworkGuardError);
    } finally {
      udp.close();
    }
    expect(() => dns.lookup("api.anthropic.com", () => undefined)).toThrow(OfflineNetworkGuardError);
    await expect(dns.promises.lookup("example.com")).rejects.toThrow(OfflineNetworkGuardError);
    expect(() => dns.resolve4("example.com", () => undefined)).toThrow(OfflineNetworkGuardError);
    expect(blockedAttempts()).toHaveLength(4);
  });

  it("allows loopback HTTP, fetch and a local IPC server", async () => {
    const server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("ok");
      expect(await (await fetch(`http://localhost:${port}/`)).text()).toBe("ok");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    const ipcPath =
      process.platform === "win32" ? `\\\\.\\pipe\\civ-guard-${process.pid}` : path.join(os.tmpdir(), `civ-guard-${process.pid}.sock`);
    const ipc = net.createServer((socket) => socket.end("pong"));
    await new Promise<void>((resolve) => ipc.listen(ipcPath, resolve));
    try {
      const reply = await new Promise<string>((resolve, reject) => {
        const client = net.connect(ipcPath);
        let data = "";
        client.on("data", (chunk) => (data += chunk));
        client.on("end", () => resolve(data));
        client.on("error", reject);
      });
      expect(reply).toBe("pong");
    } finally {
      await new Promise((resolve) => ipc.close(resolve));
    }
    expect(blockedAttempts()).toEqual([]);
  });

  it("classifies loopback hosts strictly", () => {
    for (const host of ["localhost", "127.0.0.1", "127.9.9.9", "::1", "[::1]", "::ffff:127.0.0.1"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
    for (const host of ["0.0.0.0", "10.0.0.1", "192.168.1.1", "127.0.0.1.evil.com", "localhost.evil.com", "api.openai.com", "::"]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });

  it("fails a test that swallows a blocked attempt (checked in a child vitest run)", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "test-support/fixtures/vitest.fixture.config.ts"],
      { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toMatch(/blocked non-loopback network attempt/);
    expect(output).toContain(`fetch -> ${REMOTE}`);
  }, 60_000);
});
