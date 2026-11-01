import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@civ/shared";
import { createCognition } from "./index.js";
import { assertOpenAiConfig } from "./openai-responses.js";

const config = (baseUrl: string, customEndpointHost?: string) => ({
  apiKey: "sk-test-offline",
  model: "gpt-4o-mini",
  baseUrl,
  customEndpointHost,
});

describe("OpenAI base URL host validation", () => {
  it.each([
    "http://example.test/localhost/v1",
    "http://localhost.attacker.test/v1",
    "http://127.0.0.1.attacker.test/v1",
    "http://example.test/?next=127.0.0.1",
    "ftp://localhost/v1",
    "http://example.test:8080/v1",
    "http://localhost@attacker.test/v1",
    "http://127.0.0.1:80@attacker.test/v1",
    "http://[::1].attacker.test/v1",
    "http://[::ffff:8.8.8.8]/v1",
    "http://api.openai.com/v1",
  ])("rejects nonlocal plaintext endpoints even if they contain a loopback-looking substring: %s", (url) => {
    expect(() => assertOpenAiConfig(config(url))).toThrow(/OPENAI_BASE_URL/);
  });

  it.each([
    "https://api.openai.com/v1",
    "https://api.openai.com/v1/",
    "https://API.OPENAI.COM/v1",
    "http://localhost:1234/v1",
    "http://127.0.0.1:1234/v1",
    "http://[::1]:1234/v1",
    "https://localhost:1234/v1",
  ])("allows the official API or an actual local mock endpoint: %s", (url) => {
    expect(() => assertOpenAiConfig(config(url))).not.toThrow();
  });

  it("rejects malformed URLs and embedded URL credentials", () => {
    expect(() => assertOpenAiConfig(config("not a URL"))).toThrow(/OPENAI_BASE_URL/);
    expect(() => assertOpenAiConfig(config("https://name:password@api.openai.com/v1"))).toThrow(/embedded credentials/);
    expect(() => assertOpenAiConfig(config("http://name:password@localhost:1234/v1"))).toThrow(/embedded credentials/);
  });

  it("does not echo a rejected URL's credentials in the error", () => {
    expect(() => assertOpenAiConfig(config("http://name:s3cret@attacker.test/v1"))).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining("s3cret") }),
    );
  });

  it.each(["https://api.openai.com/v1?x=1", "https://api.openai.com/v1#frag", "https://api.openai.com/v1?", "http://localhost:1234/v1#"])(
    "rejects a query or fragment, which would misroute the request: %s",
    (url) => {
      expect(() => assertOpenAiConfig(config(url))).toThrow(/query or fragment/);
    },
  );

  it.each(["https://api.openai.com/", "https://api.openai.com/v2", "https://api.openai.com/proxy/v1"])(
    "requires the /v1 path on the official host: %s",
    (url) => {
      expect(() => assertOpenAiConfig(config(url))).toThrow(/\/v1 path/);
    },
  );
});

describe("custom OpenAI endpoints require separate configuration", () => {
  it.each([
    "https://proxy.example.test/v1",
    "https://api.openai.com.attacker.test/v1",
    "https://api.openai.com:8443/v1",
    "https://api.openai.com./v1",
    "https://evil.test/api.openai.com/v1",
    "https://8.8.8.8/v1",
  ])("never sends the key to %s without it", (url) => {
    expect(() => assertOpenAiConfig(config(url))).toThrow(/OPENAI_CUSTOM_ENDPOINT_HOST/);
    expect(() => assertOpenAiConfig(config(url, "  "))).toThrow(/OPENAI_CUSTOM_ENDPOINT_HOST/);
  });

  it("allows a custom HTTPS endpoint only when its exact host is configured", () => {
    expect(() => assertOpenAiConfig(config("https://proxy.example.test/v1", "proxy.example.test"))).not.toThrow();
    expect(() => assertOpenAiConfig(config("https://PROXY.example.test/v1", "Proxy.Example.Test"))).not.toThrow();
    expect(() => assertOpenAiConfig(config("https://proxy.example.test:8443/v1", "proxy.example.test:8443"))).not.toThrow();
  });

  it.each([
    ["https://proxy.example.test/v1", "other.example.test"],
    ["https://sub.proxy.example.test/v1", "proxy.example.test"],
    ["https://proxy.example.test/v1", "*.example.test"],
    ["https://proxy.example.test/v1", "example.test"],
    ["https://proxy.example.test:8443/v1", "proxy.example.test"],
    ["https://proxy.example.test/v1", "https://proxy.example.test"],
  ])("rejects %s when the allowed host is %s", (url, host) => {
    expect(() => assertOpenAiConfig(config(url, host))).toThrow(/does not match/);
  });

  it("does not let the setting allow plaintext, credentials or a query", () => {
    expect(() => assertOpenAiConfig(config("http://proxy.example.test/v1", "proxy.example.test"))).toThrow(/must be https/);
    expect(() => assertOpenAiConfig(config("https://a:b@proxy.example.test/v1", "proxy.example.test"))).toThrow(/credentials/);
    expect(() => assertOpenAiConfig(config("https://proxy.example.test/v1?k=1", "proxy.example.test"))).toThrow(/query/);
  });

  it("defaults to the official endpoint and threads the setting through the factory", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            output_text: '{"goal":"rest","priority":0.1,"reason":"x"}',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
    );
    const env = { LLM_PROVIDER: "openai", LLM_ENABLED: "true", CLOUD_LLM_ENABLED: "true", OPENAI_API_KEY: "sk-test" };
    const prompt = { citizenName: "A", inventory: [], settlementNeeds: [], memories: [], nearbyCitizens: [] };
    await createCognition(loadConfig(env), { fetchImpl: fetchImpl as unknown as typeof fetch }).decide(prompt);
    expect((fetchImpl.mock.calls as unknown as Array<[string]>)[0]?.[0]).toBe("https://api.openai.com/v1/responses");

    const custom = { ...env, OPENAI_BASE_URL: "https://proxy.example.test/v1" };
    expect(() => createCognition(loadConfig(custom), { fetchImpl: fetchImpl as unknown as typeof fetch })).toThrow(
      /OPENAI_CUSTOM_ENDPOINT_HOST/,
    );
    expect(() =>
      createCognition(loadConfig({ ...custom, OPENAI_CUSTOM_ENDPOINT_HOST: "proxy.example.test" }), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).not.toThrow();
  });
});
