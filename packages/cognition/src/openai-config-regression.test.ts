import { describe, expect, it } from "vitest";
import { assertOpenAiConfig } from "./openai-responses.js";

const config = (baseUrl: string) => ({
  apiKey: "sk-test-offline",
  model: "gpt-4o-mini",
  baseUrl,
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
  ])("rejects nonlocal plaintext endpoints even if they contain a loopback-looking substring: %s", (url) => {
    expect(() => assertOpenAiConfig(config(url))).toThrow(/OPENAI_BASE_URL/);
  });

  it.each([
    "https://api.openai.com/v1",
    "http://localhost:1234/v1",
    "http://127.0.0.1:1234/v1",
    "http://[::1]:1234/v1",
  ])("allows HTTPS or an actual local mock endpoint: %s", (url) => {
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
});
