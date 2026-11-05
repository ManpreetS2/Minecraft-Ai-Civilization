/**
 * Redaction utility for the evidence validator.
 *
 * Ensures no private prompts, credentials, API keys, or secret citizen memories
 * are ever exposed in validation reports or summaries.
 */

const SECRET_PATTERNS = [
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /Bearer\s+[a-zA-Z0-9_.-]{20,}/gi,
  /(?:api[_-]?key|secret|password|auth[_-]?token|credential)\s*[:=]\s*["']?([a-zA-Z0-9_.-]{8,})["']?/gi,
  /private-token-[a-zA-Z0-9_.-]+/gi,
];

const PROMPT_PATTERNS = [
  /(?:System Prompt|User Prompt|Assistant Reply|Hidden Thought|Internal Monologue):\s*[\s\S]+/gi,
];

export function redactString(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED_SECRET]");
  }
  for (const pattern of PROMPT_PATTERNS) {
    result = result.replace(pattern, "[REDACTED_PROMPT]");
  }
  return result;
}

export function redactSensitiveData<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data === "string") {
    return redactString(data) as unknown as T;
  }
  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item)) as unknown as T;
  }
  if (typeof data === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("key") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("token") ||
        lowerKey.includes("credential") ||
        lowerKey.includes("password")
      ) {
        copy[key] = "[REDACTED_SECRET]";
      } else if (
        lowerKey === "rawprompt" ||
        lowerKey === "systemprompt" ||
        lowerKey === "rawresponse" ||
        lowerKey === "prompt"
      ) {
        copy[key] = "[REDACTED_PROMPT]";
      } else if (lowerKey === "privatememory" || lowerKey === "secretmemory") {
        copy[key] = "[REDACTED_MEMORY]";
      } else {
        copy[key] = redactSensitiveData(value);
      }
    }
    return copy as T;
  }
  return data;
}
