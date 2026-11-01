# 🛠️ ENGINEERING RESEARCHER | Technical Research

# AI-001-SPEC — Per-community model-session isolation (mocked GPT + Claude adapters)

| Field | Value |
|---|---|
| Project | Minecraft AI Civilization (engine repo `/workspace/mc-civ`) |
| Spec type | **Design spec only.** No code was written or committed; `/workspace/mc-civ` was read via `git show 953d61e:<path>` / `git ls-tree` only. |
| Base commit | `953d61e` |
| Implementer | Bug Hunter, branch `agents/ai-AI-001` from `953d61e` |
| Backlog link | MASTER_BACKLOG: AI-001 (routing audit), foundation for AI-002 (per-citizen bindings) and AI-003 (session independence) |
| Status of claims | Everything below is a *design*. Nothing here is a tested result. Mocks prove isolation of *our* session layer only — not provider behaviour. |
| Hard constraints | No real API calls, no network, no paid APIs, no live runs, no merges, no main, no force-push. Do **not** touch `packages/agent-core/src/executor.ts`, `manager.ts`, or `packages/skills/src/collect.ts`. |

---

## 1. Context (what exists at `953d61e` and what AI-001 must align with)

Read from `953d61e`:

| Fact | Path (at 953d61e) | Implication for AI-001 |
|---|---|---|
| Monorepo, pnpm workspaces `apps/*`, `packages/*`; `"type": "module"`; `engines.node >=22` | `package.json`, `pnpm-workspace.yaml` | New dir `packages/session-isolation` is picked up automatically. |
| **Test framework: vitest `^3.2.4`**, root `vitest run`; include globs `packages/**/*.test.ts`, `apps/**/*.test.ts`, env `node` | `vitest.config.ts`, root `package.json` (`"test": "vitest run"`) | Tests are co-located `*.test.ts` in `src/`, imported with `import { describe, it, expect, vi } from "vitest"`. No per-package vitest config needed. |
| TS config: `target ES2022`, `module/moduleResolution NodeNext`, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules` | `tsconfig.base.json`; root `tsconfig.json` includes `packages/**/*.ts` | Use `import type` for types, **`.js` suffix on relative imports** (`./types.js`), index-checked array access. Root `tsc` will typecheck the new package even before per-package wiring. |
| ESLint: `typescript-eslint` recommended, `no-explicit-any: error`, unused vars must be `_`-prefixed | `eslint.config.js` | No `any`; use `unknown` + narrowing. |
| Package convention: `@civ/<name>`, `private`, `main/types/exports` → `./src/index.ts`, scripts `build`/`typecheck` (`tsc -p tsconfig.json [--noEmit]`), per-package `tsconfig.json` extends `../../tsconfig.base.json` with `outDir: dist`, `rootDir: src`, `include: ["src"]` | `packages/cognition/{package.json,tsconfig.json}`, `packages/shared/*`, `packages/society/*` | Copy that shape exactly for `@civ/session-isolation`. |
| Existing provider contract: `CognitionProvider { readonly name; decide(prompt: CognitionPrompt, timeoutMs?): Promise<HighLevelDecision> }`; `HighLevelDecision = { goal, priority(0..1), reason(≤280), targetCitizenId? }` | `packages/cognition/src/schema.ts` | AI-001 does **not** replace this. Sessions are a lower layer (text in / text out + history). A later bridge (out of scope) maps a Session to `CognitionProvider`. |
| Existing real OpenAI adapter: `OpenAiResponsesProvider` — config has `apiKey` **string value**, shared injected `CloudBudgetGate`, `fetchImpl` injection, per-call `AbortController` + `setTimeout`, `inflight` set aborted on `close()`, `assertNoSecretLeak(payload, apiKey)`, model allowlist `isAllowedOpenAiModel`; **no history and no persistence** (each `decide` is stateless; `store:false`) | `packages/cognition/src/openai-responses.ts`, `cloud-prices.ts` (allowlist: `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini`, `gpt-4.1`, dated variants), `cloud-budget.ts` | Reuse the *patterns* (abort+timer, allowlist, secret-leak refusal, no key in logs). Do **not** import or modify these files (`packages/cognition/**` is lead-integrator-owned). |
| Isolation hazard in current design: `createCognition()` builds **one** provider per process from **one** global `AppConfig` (`OPENAI_API_KEY`, one `CloudBudgetGate`); `resolveCognitionConfig` reads a single global key | `packages/cognition/src/index.ts`, `config.ts`, `packages/shared/src/config.ts` L57-59 | This is exactly what AI-001 must *not* copy: one key, one budget, one config for everyone. |
| **No Claude/Anthropic provider and no `ANTHROPIC_*` config exists** | `git ls-tree -r 953d61e \| grep -iE 'claude\|anthropic\|session'` → empty | Claude adapter is new; mock only. Do not add env vars to `.env.example`/`config.ts` (shared, integrator-owned). |
| "Community" is a design-doc concept (A/B/C communities in the same world, separate membership/geography/knowledge; "no global manager secretly chooses…"); there is no `Community` type in code | `docs/master-design-google-doc-mirror.md` §"MULTIPLE COMMUNITIES" | Session identity is keyed by a plain `communityId: string`. Do not introduce a shared `Community` type in `@civ/shared`. |
| Deterministic-test helpers exist: `createIdFactory`, fake clock in `@civ/memory` (`clock.ts`); `withTimeout`, `sleep(ms, signal)` in `@civ/shared/async.ts` | `packages/memory/src/clock.ts`, `packages/shared/src/async.ts` | Re-declare tiny `Clock`/`IdFactory` locally (zero dependency; see §5) rather than import. |
| Ownership | `docs/project-management/FILE_OWNERSHIP.md` | `packages/shared/**`, `packages/cognition/**`, root configs, `pnpm-lock.yaml` belong to the lead integrator. AI-001 touches **only** `packages/session-isolation/**` (+ the one lockfile question in §6). |

---

## 2. Design summary

```
SessionRegistry (instance, no globals)            ← one per process/test; holds adapters + store + secrets + clock
  ├─ open(config) ──► Session (communityId=A, provider=gpt,   apiKeyRef=env:GPT_KEY_A, own history, own memory, own limits)
  ├─ open(config) ──► Session (communityId=B, provider=claude, apiKeyRef=env:CLAUDE_KEY_B, …)
  └─ restore(id)  ──► Session rebuilt from SessionSnapshot in SessionStore
Session.send() ─► ProviderAdapter.complete(ProviderRequest, AbortSignal) ─► (mock) GPT-Responses-shaped / Claude-Messages-shaped reply
```

Principles: **dependency injection everywhere** (adapters, secrets, clock, ids, store), **sessions own all mutable state**, **snapshots contain no secret values**, **adapters are stateless w.r.t. sessions**, **failed turns commit nothing**.

---

## 3. Adapter interface (TypeScript signatures — contract for Bug Hunter)

These are the *required* exported names and shapes. Internals are the implementer's choice. Zero runtime dependencies; no `any`.

```ts
// ---------- src/types.ts ----------
export type ProviderId = "gpt" | "claude";

/** A reference to a secret — NEVER the secret itself. Safe to persist/log. */
export interface SecretRef {
  readonly source: "env" | "mock";
  readonly name: string; // e.g. "CIV_COMMUNITY_A_GPT_KEY"
}

/** Injected per registry. Production impl (out of scope) would read process.env; tests use a Map. */
export interface SecretResolver {
  resolve(ref: SecretRef): string | undefined;
}

export interface SessionLimits {
  readonly timeoutMs: number;          // per-send hard timeout (>0)
  readonly maxOutputTokens: number;    // forwarded to adapter (>0)
  readonly maxRequests: number;        // lifetime successful+failed provider calls for THIS session (>0)
  readonly maxHistoryMessages: number; // oldest messages dropped beyond this, in whole user/assistant pairs (>=2)
}

export interface SessionConfig {
  readonly sessionId: string;     // /^[a-z0-9][a-z0-9_-]{0,63}$/  (also used as filename → no path chars)
  readonly communityId: string;   // non-empty, ≤64 chars
  readonly provider: ProviderId;
  readonly model: string;         // must be in adapter.allowedModels
  readonly apiKeyRef: SecretRef;  // per-session key reference
  readonly systemPrompt: string;  // per-session; no global default
  readonly limits: SessionLimits;
  readonly baseUrl?: string;      // informational for the mock; adapters MUST NOT open sockets regardless
}

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly at: string;            // ISO-8601 from injected Clock
}

export interface Usage { readonly inputTokens: number; readonly outputTokens: number }

// ---------- adapter ----------
export interface ProviderRequest {
  readonly model: string;
  readonly apiKey: string;                  // resolved value; adapter must never log/echo/store it
  readonly system: string;                  // systemPrompt + rendered memory notes (see §4 I-7)
  readonly messages: readonly ChatMessage[]; // history + the new user message
  readonly maxOutputTokens: number;
  readonly requestId: string;               // from IdFactory
}

export interface ProviderResponse {
  readonly text: string;
  readonly usage: Usage;
  readonly providerRequestId: string;       // "resp_…" (gpt mock) / "msg_…" (claude mock)
  readonly finishReason: "stop" | "length";
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly allowedModels: readonly string[];
  /** Throws SessionError(code "CONFIG_INVALID") on unknown model, bad limits, wrong provider id. */
  validateConfig(config: SessionConfig): void;
  /**
   * MUST reject with SessionError "CANCELLED" or "TIMEOUT" promptly when `signal` aborts
   * (including already-aborted on entry → no work done), MUST NOT retain `req` after settle,
   * MUST NOT perform network I/O.
   */
  complete(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse>;
}

// ---------- session ----------
export type SessionState = "idle" | "busy" | "closed";

export interface SendInput {
  readonly content: string;
  readonly signal?: AbortSignal;   // caller cancellation, composed with session cancel() and timeout
  readonly timeoutMs?: number;     // may only LOWER limits.timeoutMs
}

export interface SendResult {
  readonly sessionId: string;
  readonly turn: number;           // 1-based count of committed turns after this send
  readonly text: string;
  readonly usage: Usage;
  readonly providerRequestId: string;
  readonly finishReason: "stop" | "length";
}

export interface SessionSnapshot {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly communityId: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly apiKeyRef: SecretRef;          // reference only
  readonly systemPrompt: string;
  readonly limits: SessionLimits;
  readonly history: readonly ChatMessage[];
  readonly memory: readonly string[];     // per-session notes, insertion order
  readonly turn: number;
  readonly requestsUsed: number;          // counts toward limits.maxRequests
  readonly usageTotal: Usage;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly integrity: string;             // sha256 hex of canonical JSON of all other fields
}

export interface Session {
  readonly id: string;
  readonly communityId: string;
  readonly provider: ProviderId;
  readonly state: SessionState;
  send(input: SendInput): Promise<SendResult>;
  /** Aborts ONLY this session's in-flight send (rejects it with CANCELLED). No-op if idle. Session stays usable. */
  cancel(reason?: string): void;
  /** Append a per-session memory note (bounded: ≤64 notes, ≤512 chars each → LIMIT_EXCEEDED). */
  remember(note: string): void;
  /** Deep copy; mutating it never affects the session. Contains NO secret value. */
  snapshot(): SessionSnapshot;
  /** Terminal. Cancels in-flight work, clears timers, rejects later sends with SESSION_CLOSED. Idempotent. */
  close(): void;
}

// ---------- store ----------
export interface SessionStore {
  save(snapshot: SessionSnapshot): Promise<void>;                 // atomic: never leaves a partial file
  load(sessionId: string): Promise<SessionSnapshot | undefined>;  // verifies schemaVersion + integrity
  list(): Promise<readonly string[]>;
  delete(sessionId: string): Promise<void>;                       // idempotent
}

// ---------- registry ----------
export interface Clock { now(): Date }
export type IdFactory = () => string;

export interface SessionRegistryOptions {
  readonly adapters: readonly ProviderAdapter[]; // one per ProviderId
  readonly secrets: SecretResolver;
  readonly store: SessionStore;
  readonly clock?: Clock;      // default: system clock
  readonly ids?: IdFactory;    // default: crypto.randomUUID-based
}

export interface SessionRegistry {
  open(config: SessionConfig): Session;                 // throws CONFIG_INVALID / SECRET_MISSING / duplicate id
  restore(sessionId: string): Promise<Session>;         // throws SNAPSHOT_CORRUPT / SNAPSHOT_VERSION / SECRET_MISSING / STORE_ERROR
  persist(sessionId: string): Promise<void>;            // store.save(session.snapshot())
  get(sessionId: string): Session | undefined;
  closeAll(): void;
}

export function createSessionRegistry(options: SessionRegistryOptions): SessionRegistry;

// ---------- adapters & stores (all exported from index.ts) ----------
export interface MockReply { readonly text: string; readonly usage?: Usage; readonly finishReason?: "stop" | "length" }
export interface MockAdapterOptions {
  /** Pure function → deterministic reply. Default: `ack:<sha256(model|system|messages).slice(0,8)>:<messages.length>`. */
  readonly script?: (req: ProviderRequest) => MockReply;
  /** Simulated latency, honoured via abort-aware setTimeout (works with vi.useFakeTimers). Default 0. */
  readonly delayMs?: number;
  /** If set, `complete` rejects AUTH_FAILED when req.apiKey !== expectedApiKey. */
  readonly expectedApiKey?: string;
  /** If set, throw SessionError(PROVIDER_ERROR) with this httpStatus-like number instead of replying. */
  readonly failWithStatus?: number;
}
export interface MockAdapter extends ProviderAdapter {
  /** Every request this adapter instance received, in order (apiKey included — test-only introspection). */
  readonly calls: readonly ProviderRequest[];
}
export function createMockGptAdapter(options?: MockAdapterOptions): MockAdapter;     // id "gpt"; internal wire shape mimics OpenAI Responses (`output_text`, `usage.input_tokens/output_tokens`, id `resp_…`); allowedModels ["gpt-4o-mini","gpt-4.1-mini"]
export function createMockClaudeAdapter(options?: MockAdapterOptions): MockAdapter;  // id "claude"; internal wire shape mimics Anthropic Messages (top-level `system`, `content:[{type:"text"}]`, `stop_reason`, id `msg_…`); allowedModels ["claude-sonnet-4-5","claude-haiku-4-5"] (placeholder names for the *mock* allowlist — not a pricing/availability claim)

export function createInMemorySessionStore(): SessionStore;            // structuredClone on save AND load
export function createJsonFileSessionStore(dir: string): SessionStore; // one `<dir>/<sessionId>.json`; write temp + rename; validates sessionId against the regex above

// ---------- errors ----------
export type SessionErrorCode =
  | "CONFIG_INVALID" | "SECRET_MISSING" | "AUTH_FAILED"
  | "TIMEOUT" | "CANCELLED"
  | "SESSION_BUSY" | "SESSION_CLOSED" | "LIMIT_EXCEEDED"
  | "PROVIDER_ERROR" | "RESPONSE_INVALID"
  | "SNAPSHOT_CORRUPT" | "SNAPSHOT_VERSION" | "STORE_ERROR";

export class SessionError extends Error {
  readonly code: SessionErrorCode;
  readonly sessionId?: string;
  readonly retryable: boolean;      // true only for TIMEOUT, PROVIDER_ERROR(5xx/429)
  constructor(code: SessionErrorCode, message: string, opts?: { sessionId?: string; retryable?: boolean; cause?: unknown });
}
export function isSessionError(e: unknown): e is SessionError;
```

### 3.1 `send()` algorithm (normative)

1. `closed` → `SESSION_CLOSED`. `busy` → `SESSION_BUSY` (**no queueing**; callers serialise). `requestsUsed >= limits.maxRequests` → `LIMIT_EXCEEDED` (adapter not called).
2. Resolve `apiKey = secrets.resolve(config.apiKeyRef)`; missing/blank → `SECRET_MISSING` (message contains the ref *name*, never a value).
3. Create a per-send `AbortController`. Wire three abort sources into it with a *reason marker*: (a) caller `input.signal`, (b) `session.cancel()` / `close()`, (c) a **manual `setTimeout`** at `min(input.timeoutMs ?? ∞, limits.timeoutMs)` (do **not** use `AbortSignal.timeout`, which vitest fake timers do not control). Pre-aborted caller signal → `CANCELLED` without calling the adapter. `requestsUsed` increments only once the adapter is actually invoked.
4. Build `ProviderRequest`: `system = systemPrompt + rendered memory notes` (§4 I-7), `messages = [...history, {user, content}]` trimmed to `maxHistoryMessages`.
5. `await adapter.complete(req, signal)`. Map abort reason → `TIMEOUT` or `CANCELLED`; other failures → `AUTH_FAILED` / `PROVIDER_ERROR` / `RESPONSE_INVALID` (empty/non-string text). Error messages must be passed through a redactor that replaces the session's `apiKey` value with `[REDACTED]`.
6. **Commit atomically only on success** *and only if the signal is still un-aborted*: append the user + assistant messages, `turn++`, add usage, set `updatedAt`. A late reply arriving after abort is discarded.
7. `finally`: clear the timer, remove abort listeners, state back to `idle` (or `closed`).

---

## 4. Isolation invariants

Each invariant maps to acceptance tests in §5.

| ID | Invariant | Tests |
|---|---|---|
| **I-1 No shared history** | A session's `history` array and the `messages` it passes to the adapter contain only messages sent through that session. Two sessions with identical prompts never alias arrays/objects. | AT-01, AT-02, AT-12 |
| **I-2 No shared memory** | `remember()` notes are per-session, are rendered only into that session's `system` field, and survive only in that session's snapshot. | AT-03 |
| **I-3 Separate keys** | Each session resolves its own `apiKeyRef`; the adapter receives that session's key and no other. A wrong key fails only the session that holds it. The key value never appears in snapshot, persisted file, error message, `SessionError` fields, or `JSON.stringify(session)`. | AT-04, AT-05, AT-18 |
| **I-4 Separate config & limits** | `model`, `systemPrompt`, `limits` are per-session. Exhausting one session's `maxRequests`, timeout, or history window never changes another's. Config objects are deep-frozen/copied on `open()` (caller mutation after open has no effect). | AT-06, AT-07, AT-13 |
| **I-5 No global/module-level mutable state** | All state lives in objects returned by factories (`createSessionRegistry`, `createMock*Adapter`, `createInMemorySessionStore`). No module-level `let`/`var`, no top-level `new Map/Set`, no mutable exported arrays/objects, no singleton registry or "default adapter". Two registries in one process are fully independent. | AT-14, AT-15 |
| **I-6 Cancellation is scoped & clean** | `cancel()`, caller `AbortSignal`, and `close()` abort only that session's in-flight request, reject with `CANCELLED`, commit nothing, leave no timers, and leave the session reusable (except `close()`). | AT-08, AT-09, AT-10, AT-11 |
| **I-7 Deterministic request rendering** | `system` sent to the adapter is exactly `systemPrompt` if no notes, else `systemPrompt + "\n\n[memory]\n- " + notes.join("\n- ")`. Same state ⇒ byte-identical `ProviderRequest` (except `requestId`, which comes from the injected `IdFactory`). | AT-12, AT-17 |
| **I-8 Timeout is a hard bound** | Session rejects with `TIMEOUT` at `min(input.timeoutMs, limits.timeoutMs)` even if the adapter ignores the signal; a late reply is discarded; `input.timeoutMs` can only lower, never raise, the limit. | AT-09, AT-10 |
| **I-9 Failed turns are not committed** | Any non-success (`TIMEOUT`, `CANCELLED`, `AUTH_FAILED`, `PROVIDER_ERROR`, `RESPONSE_INVALID`) leaves `history`, `turn`, `usageTotal` unchanged; only `requestsUsed` may increase. | AT-09, AT-10, AT-11, AT-19 |
| **I-10 Persist/restore fidelity** | `restore(persist(s))` yields a session whose `snapshot()` deep-equals the original (all fields, incl. `integrity`), and whose next `ProviderRequest` is byte-identical to the one the original would have sent. Restored sessions never see another session's data. Corruption/tampering/unknown `schemaVersion` is detected, not silently accepted. | AT-16, AT-17, AT-20, AT-21, AT-22 |
| **I-11 No network, deterministic mocks** | Source imports no `node:http/https/net/tls/dns/dgram/child_process` and never calls `fetch`; tests stub `globalThis.fetch` to throw and assert zero calls. Mock replies are a pure function of the request (no `Math.random`, no `Date.now`, no real sleeping — latency via fake timers). | AT-23, AT-24 |
| **I-12 No restricted-file coupling** | Nothing in `packages/session-isolation/**` imports from or edits `executor.ts`, `manager.ts`, `collect.ts`, or any `@civ/agent-core` / `@civ/skills` / `@civ/cognition` module. | AT-25 |

---

## 5. Acceptance tests (Bug Hunter implements these directly in vitest)

**Conventions for all tests**
- Co-located in `packages/session-isolation/src/*.test.ts`; `import { describe, it, expect, vi, afterEach } from "vitest"`.
- Helper `makeRegistry(overrides?)` in `src/test-helpers.ts`: fresh mock GPT + mock Claude adapters, `secrets` backed by a `Map<string,string>` (`{"KEY_A_GPT":"sk-test-A", "KEY_B_CLAUDE":"sk-ant-test-B", "KEY_C_GPT":"sk-test-C", …}`), `createInMemorySessionStore()`, fake `Clock` (starts `2026-01-01T00:00:00.000Z`, +1 s per `now()` call) and counter `IdFactory` (`req_1`, `req_2`, …).
- Helper `cfg(over)` builds a valid `SessionConfig` (`sessionId`, `communityId`, provider, an allowed model, `apiKeyRef:{source:"mock",name:"KEY_…"}`, `systemPrompt`, limits `{timeoutMs:1000,maxOutputTokens:64,maxRequests:10,maxHistoryMessages:20}`).
- "**Both**" means: `describe.each([["gpt", createMockGptAdapter],["claude", createMockClaudeAdapter]])` — run the same assertions against each provider. Cross-provider tests use one GPT and one Claude session in the same registry.
- Time-dependent tests use `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(n)`; `afterEach(() => { vi.useRealTimers(); })`. After each cancel/timeout test assert `vi.getTimerCount() === 0`.
- Never print or assert on real-looking secrets other than the fixed test strings above.

### Isolation of history & memory

| ID | Given / When / Then | Providers |
|---|---|---|
| **AT-01** Independent history | **Given** sessions `s-a` (community A) and `s-b` (community B) on the same adapter type. **When** `s-a.send("A-only: wheat plan")` ×2 then `s-b.send("B-only: iron plan")`. **Then** adapter `calls` for `s-b` contain exactly `[user "B-only: iron plan"]` (no A text anywhere in `JSON.stringify(call)`); `s-a.snapshot().history.length === 4`, `s-b.snapshot().history.length === 2`; no A string appears in `s-b.snapshot()` and vice-versa. | Both |
| **AT-02** Cross-provider history isolation | **Given** GPT session for community A and Claude session for community B. **When** each sends 3 distinct messages interleaved (A,B,A,B,A,B). **Then** each adapter's `calls[i].messages` contain only its own session's messages in order; turn counters are 3 and 3. | GPT+Claude |
| **AT-03** Independent memory | **Given** A and B sessions. **When** `a.remember("A secret-ish note")`, then `b.send("hi")`, then `a.send("hi")`. **Then** B's request `system` has no `[memory]` block and does not contain the note; A's request `system` equals `systemPrompt + "\n\n[memory]\n- A secret-ish note"`; `a.snapshot().memory` has the note, `b.snapshot().memory` is `[]`. | Both |

### Separate keys & config

| ID | Given / When / Then | Providers |
|---|---|---|
| **AT-04** Per-session key delivery | **Given** A with `KEY_A_*`, C with `KEY_C_*` on the same provider type. **When** each sends once. **Then** the adapter saw `apiKey === "sk-test-A"` for A's call and `"sk-test-C"` for C's; never swapped (assert by call index & session). | Both |
| **AT-05** Wrong key isolates failure | **Given** adapter created with `expectedApiKey:"sk-test-A"`; session A uses correct key, session B's ref resolves to a different value. **When** both send. **Then** A succeeds; B rejects `SessionError` code `AUTH_FAILED`; B's history/turn unchanged; A's state unaffected; a subsequent A send still works. | Both |
| **AT-06** Per-session config isolation | **Given** A (`model` m1, `systemPrompt` "SYS-A", `maxOutputTokens 32`) and B (m2, "SYS-B", 64). **When** both send. **Then** requests carry their own `model`, `system`, `maxOutputTokens`; mutating the original `cfg` object (e.g. `limits.timeoutMs = 1`, `systemPrompt = "x"`) after `open()` changes nothing in `snapshot()` or later requests. | Both |
| **AT-07** Per-session limits isolation | **Given** A with `maxRequests: 2`, B with `maxRequests: 10`. **When** A sends 3 times, B sends 3 times. **Then** A's 3rd rejects `LIMIT_EXCEEDED` and the adapter is **not** called for it (`calls` count 2 for A); B all succeed. | Both |
| **AT-13** History window per session | **Given** A `maxHistoryMessages: 4`, B `maxHistoryMessages: 20`; each sends 5 turns. **Then** A's last request has ≤4 messages including the new user message (oldest pairs dropped; first message in window is a `user`), B's has 9 messages; A's `snapshot().history.length ≤ 4`. | Both |

### Cancellation & timeout

| ID | Given / When / Then | Providers |
|---|---|---|
| **AT-08** `cancel()` is scoped | **Given** two sessions on adapters with `delayMs: 500`; both `send` in flight. **When** `a.cancel()`; advance 500 ms. **Then** A's promise rejects `CANCELLED`; B's resolves normally; A `state` returns to `idle` and A can `send` again successfully. | Both |
| **AT-09** Timeout | **Given** adapter `delayMs: 5000`, session `limits.timeoutMs: 1000`. **When** `send` then advance 1000 ms. **Then** rejects `TIMEOUT` (`retryable === true`) at ≥1000 ms and **not** before 999 ms (assert unresolved at 999); history/turn/usageTotal unchanged; `requestsUsed === 1`; advancing a further 4000 ms produces no state change (late reply discarded); `vi.getTimerCount() === 0`. | Both |
| **AT-10** Session-enforced timeout even if adapter ignores abort | **Given** a custom adapter wrapper whose `complete` ignores `signal` and resolves after 5000 ms. **When** `send` with `timeoutMs: 100` (≤ limit) and advance 100 ms. **Then** rejects `TIMEOUT`; a larger `input.timeoutMs: 999999` is clamped to `limits.timeoutMs`. | Both |
| **AT-11** Caller `AbortSignal` | **Given** `AbortController c`. **When** `send({signal:c.signal})`, `c.abort()`. **Then** rejects `CANCELLED`, nothing committed. **And** with an already-aborted signal: rejects `CANCELLED` and `adapter.calls.length` is unchanged and `requestsUsed` is unchanged. | Both |
| **AT-11b** `close()` | **Given** an in-flight send. **When** `session.close()`. **Then** the send rejects `CANCELLED`; later `send` rejects `SESSION_CLOSED`; `close()` twice is safe; `registry.closeAll()` closes every session and clears timers. | Both |
| **AT-19** Busy & provider errors don't corrupt | **Given** a send in flight (`delayMs 500`). **When** a second `send` is issued on the same session. **Then** it rejects `SESSION_BUSY` immediately and the first still completes with `turn === 1`. **And** an adapter with `failWithStatus: 503` yields `PROVIDER_ERROR` (`retryable true`), `failWithStatus: 401` yields `AUTH_FAILED` (`retryable false`); history unchanged in both. Empty-text reply → `RESPONSE_INVALID`. | Both |

### Persistence & restore

| ID | Given / When / Then | Providers |
|---|---|---|
| **AT-16** Snapshot round-trip (memory store) | **Given** a session with 3 turns + 2 memory notes. **When** `registry.persist(id)`; new registry (new adapters, same store) `restore(id)`. **Then** `restored.snapshot()` deep-equals the original snapshot (including `integrity`). | Both |
| **AT-17** Behavioural fidelity | **Given** original and restored sessions fed the same next message with deterministic scripts and fresh `IdFactory`s at the same counter. **Then** the new adapter's `calls[0]` deep-equals the request the original would have produced (same `system`, `messages`, `model`, `maxOutputTokens`, `apiKey`), and mock replies equal. | Both |
| **AT-20** File store round-trip & atomicity | **Given** `createJsonFileSessionStore(mkdtemp(os.tmpdir()+"/civ-sess-"))`. **When** save → load → list → delete → delete again. **Then** loaded deep-equals saved; `list()` returns the id; after delete `load` → `undefined`; second delete does not throw; the directory contains no `*.tmp` leftovers; file content contains **no** `sk-test-` substring (grep the raw file text). Clean up the tmp dir in `afterEach`. | n/a (Both providers' snapshots) |
| **AT-21** Tamper/corruption detection | **Given** a persisted file. **When** (a) one history `content` char edited, (b) file truncated to invalid JSON, (c) `schemaVersion` set to `2`. **Then** `restore` rejects with (a) `SNAPSHOT_CORRUPT`, (b) `SNAPSHOT_CORRUPT`, (c) `SNAPSHOT_VERSION`; no session registered after a failed restore (`registry.get(id) === undefined`). | Both |
| **AT-22** Restore isolation & secrets | **Given** A and B persisted. **When** restore A in a new registry whose `SecretResolver` has no `KEY_A_*`. **Then** `restore` rejects `SECRET_MISSING` (message names the ref, not a value). With keys present, restoring A does not load or expose B (`registry.get(B) === undefined`); restoring a missing id rejects `STORE_ERROR` (or returns per implementer's documented choice — pick one and test it). Path-traversal ids (`"../x"`, `"a/b"`) are rejected `CONFIG_INVALID` by `open()` and by the file store. | Both |

### No leakage / no globals / no network

| ID | Given / When / Then | Providers |
|---|---|---|
| **AT-18** Secret redaction | **Given** an adapter that throws `new Error("bad key sk-test-A")`. **When** `send` fails. **Then** the resulting `SessionError.message`, `.cause` string form, `JSON.stringify(snapshot)`, `JSON.stringify(session)`, `String(error)` and the persisted file contain no `sk-test-A`; message contains `[REDACTED]`. | Both |
| **AT-12** Determinism | **Given** two fresh registries with identical config, ids and clocks. **When** the same message sequence is sent. **Then** `calls` (minus nothing) deep-equal and snapshots deep-equal, run-to-run; the default mock reply is the documented pure function (`ack:<8-hex>:<n>`). | Both |
| **AT-14** Registry independence | **Given** two registries in one process using adapters/stores from separate factory calls, same `sessionId` in both. **When** each opens/sends. **Then** neither sees the other's sessions, calls, or store content; `open()` of a duplicate `sessionId` *within one* registry rejects `CONFIG_INVALID`. | Both |
| **AT-15** No module-level mutable state (static guard) | **When** the test reads every non-test `src/**/*.ts` file with `node:fs`. **Then** no line matches `/^(let|var)\s/m`, `/^(export\s+)?const\s+\w+\s*=\s*new\s+(Map|Set|WeakMap|Array)\b/m`, `/^(export\s+)?const\s+\w+(\s*:\s*[^=]+)?\s*=\s*(\[\]|\{\})\s*;?\s*$/m`. (Intentionally coarse; allow-list `// guard-ok: <reason>` comments if a justified constant is needed, e.g. frozen allowlists via `Object.freeze`.) Also: `Object.isFrozen` true for `allowedModels` arrays. | n/a |
| **AT-23** No network at runtime | **Given** `vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network forbidden") })`. **When** a full flow (open, send, remember, persist, restore, cancel, timeout) runs for both providers. **Then** `fetch` call count is 0 and no test fails due to it. | Both |
| **AT-24** No network (static guard) | **When** scanning non-test `src/**/*.ts`. **Then** none match `/node:(http|https|net|tls|dns|dgram|child_process|worker_threads)|from\s+["'](http|https|net|tls|dns)["']|\bfetch\s*\(|XMLHttpRequest|WebSocket|api\.openai\.com|api\.anthropic\.com/`. (Default `baseUrl` must not be a real vendor URL.) | n/a |
| **AT-25** No restricted-file coupling (static guard) | **When** scanning non-test `src/**/*.ts` and `package.json`. **Then** no occurrence of `executor`, `manager`, `collect` as an import specifier, and no dependency on `@civ/agent-core`, `@civ/skills`, `@civ/cognition`. | n/a |

### Config validation (cheap, add alongside)

| ID | Given / When / Then | Providers |
|---|---|---|
| **AT-26** `validateConfig` | **When** `open()` is called with: unknown model; `provider` ≠ adapter id (e.g. `claude` model on gpt adapter); `timeoutMs ≤ 0`; `maxHistoryMessages < 2`; blank `systemPrompt`; blank `communityId`; invalid `sessionId`. **Then** each throws `SessionError` code `CONFIG_INVALID` synchronously, nothing registered. Missing secret value → `SECRET_MISSING` at `open()`. | Both |
| **AT-27** Provider wire-shape mocks | **Given** the GPT mock and Claude mock exposed an internal `toWire(req)`/`fromWire(raw)` pair (exported only for tests, e.g. from `src/gpt-mock-adapter.ts`). **Then** GPT: output carries `output_text` + `usage.input_tokens/output_tokens` and ids start `resp_`; Claude: system is a top-level field (not a message), `content[0].type === "text"`, ids start `msg_`, `stop_reason` maps to `finishReason`. Round-trip text through each shape equals the script's text. (Purpose: keep the adapters honestly shaped for a later real implementation; not a claim of API conformance.) | GPT, Claude |

**Count:** 28 numbered cases (AT-01…AT-27 incl. AT-11b). With `describe.each` over both providers, expect roughly **45–55 vitest test results**. Suggested final report line: `Test Files N passed, Tests M passed` from `pnpm exec vitest run packages/session-isolation`, plus whole-repo `pnpm test` regression counts before/after.

**Definition of done for AI-001 (checklist for the reviewer)**
1. All AT-xx pass; `pnpm exec vitest run packages/session-isolation` green; whole-repo `pnpm test` pass-count unchanged apart from the new tests.
2. `pnpm typecheck` and `pnpm lint` clean for the new package (`pnpm exec tsc -p packages/session-isolation/tsconfig.json --noEmit`, `pnpm exec eslint packages/session-isolation`).
3. `git diff --stat 953d61e..agents/ai-AI-001` shows **only** `packages/session-isolation/**` (+ lockfile hunk if §6 Q1 answer is "yes").
4. `git diff 953d61e..HEAD -- packages/agent-core/src/executor.ts packages/agent-core/src/manager.ts packages/skills/src/collect.ts` is empty.
5. No `.env*` values, no sqlite files, no `data/` artifacts, no real keys anywhere (`git grep -nE 'sk-(ant-)?[A-Za-z0-9]{20,}'` empty).

---

## 6. Target file paths & wiring

All paths are **new** and under `packages/session-isolation/` (name chosen to match the existing flat `packages/<name>` + `@civ/<name>` convention and the user-requested "session-isolation" area; there is no pre-existing `packages/*/session-isolation`).

```
packages/session-isolation/
  package.json                    # @civ/session-isolation (shape below)
  tsconfig.json                   # identical to packages/cognition/tsconfig.json
  src/
    index.ts                      # public re-exports only (types, errors, factories)
    types.ts                      # all interfaces/types in §3
    errors.ts                     # SessionError, isSessionError, redact(text, secret)
    session.ts                    # Session implementation (send algorithm §3.1, cancel, close, snapshot)
    registry.ts                   # createSessionRegistry (open/restore/persist/get/closeAll)
    snapshot.ts                   # canonical JSON, sha256 integrity, validate/parse snapshot, deepFreeze/clone helpers
    abort.ts                      # composeAbort(callerSignal, sessionSignal, timeoutMs, timers) + abort-reason markers; abort-aware sleep
    mock-gpt-adapter.ts           # createMockGptAdapter (+ test-only toWire/fromWire)
    mock-claude-adapter.ts        # createMockClaudeAdapter (+ test-only toWire/fromWire)
    mock-core.ts                  # shared pure helpers for mocks (default script, hashing, delay) — no state
    store-memory.ts               # createInMemorySessionStore
    store-file.ts                 # createJsonFileSessionStore (node:fs/promises, node:path only)
    test-helpers.ts               # makeRegistry, cfg, fake clock, id factory (not exported from index)
    isolation.test.ts             # AT-01..AT-07, AT-13, AT-14
    cancellation.test.ts          # AT-08..AT-11b, AT-19
    persistence.test.ts           # AT-16, AT-17, AT-20..AT-22
    guards.test.ts                # AT-15, AT-23, AT-24, AT-25
    adapters.test.ts              # AT-05, AT-12, AT-18, AT-26, AT-27
```

`package.json` (mirror of `packages/cognition/package.json`, **no dependencies**):

```json
{
  "name": "@civ/session-isolation",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

**Test wiring:** none required. Root `vitest.config.ts` already includes `packages/**/*.test.ts`; root `tsconfig.json` already includes `packages/**/*.ts`; ESLint is root-level. Imports used: `vitest`, `node:crypto`, `node:fs/promises`, `node:path`, `node:os` (tests only). All resolve from the root `devDependencies`/Node — **so no `pnpm install` is needed to run these tests**, which keeps `pnpm-lock.yaml` (integrator-owned) out of the diff if the integrator allows it (see Q1).

**Do NOT touch** (reviewer will diff-check): `packages/agent-core/src/executor.ts`, `packages/agent-core/src/manager.ts`, `packages/skills/src/collect.ts`, and also not `packages/{shared,cognition,memory,society,psychology}/**`, root configs, `.env.example`, `docs/CONSTRUCTION_*`, `experiments/construction-006a/**`.

Suggested implementation order (so each step is independently testable):
1. `types.ts`, `errors.ts`, `abort.ts`, `snapshot.ts` + AT-15/24/25 guards (cheap, catches drift early).
2. `mock-core.ts`, both mock adapters, AT-27, AT-12.
3. `session.ts` + `registry.ts`; AT-01..AT-07, AT-13, AT-14, AT-26.
4. Cancellation/timeout; AT-08..AT-11b, AT-19, AT-18.
5. Stores + persistence; AT-16, AT-17, AT-20..AT-22. Commit per step (private branch only; no force-push).

---

## 7. Out of scope & open questions

**Out of scope for AI-001**
- Any real HTTP/SDK call to OpenAI or Anthropic; real adapters; pricing tables; spend budgets (the existing `CloudBudgetGate` is not reused — a per-session budget is just `maxRequests` here; cost accounting is a later task).
- Wiring into `createCognition`, `AgentManager`, `executor.ts`, `manager.ts`, `collect.ts`, or `CognitionProvider` (a `Session → CognitionProvider` bridge, plus structured-decision parsing via `validateDecision`, belongs to AI-002/AI-003 and `packages/cognition`, integrator-owned).
- Per-citizen (vs per-community) bindings, persistent citizen identity (AI-004), neutral starting prompts (AI-005).
- Tool/function calling, streaming, retries/backoff, rate limiting, concurrency queues, embeddings, summarisation of old history (history is simply windowed).
- Production `SecretResolver` (env/keychain), encrypted-at-rest snapshots, schema migrations beyond rejecting unknown `schemaVersion`.
- Adding `ANTHROPIC_*` / per-community keys to `.env.example` or `@civ/shared` config.
- Live runs, Minecraft interaction, SQLite persistence (JSON-file store is deliberate to avoid the `better-sqlite3` native dep and `data/*.sqlite` gitignore territory).

**Open questions (need a PM/user/integrator answer; implementer should default as noted and report)**
1. **Lockfile / new workspace member.** A new `packages/session-isolation` is a new pnpm importer; `pnpm install --frozen-lockfile` in CI may fail until `pnpm-lock.yaml` gains an (empty) importer entry. `pnpm-lock.yaml` is integrator-owned. *Default:* don't edit the lockfile on the AI-001 branch; flag it in the hand-off. *Alternative if the lockfile hunk is refused:* put the same files under `packages/cognition/src/session-isolation/` (also integrator-owned, so approval is needed either way). Not verified here — I did not run pnpm.
2. **Naming:** `communityId` as a plain string vs a shared branded type later; `sessionId` regex acceptable? (Default: as specified.)
3. **One session per community?** Spec allows many sessions per `communityId` (the registry doesn't enforce uniqueness of community). Should the registry enforce one-per-community now? (Default: no; AI-002 decides per-citizen binding.)
4. **Mock model allowlists** (`claude-sonnet-4-5`, `claude-haiku-4-5`, `gpt-4o-mini`, `gpt-4.1-mini`) are placeholders; real allowlists and prices need a separate, verified source before any real adapter. (GPT names mirror `cloud-prices.ts` at `953d61e`.)
5. **Node version on the box is v20.19.2 while the repo requires `>=22`.** The spec uses only APIs available in both (`AbortSignal.any`, `structuredClone`, `node:crypto`), but Bug Hunter should confirm `pnpm`/vitest run on the box or note any environment gap. Not tested by me.
6. **`restore` of a missing id:** reject `STORE_ERROR` vs return `undefined`? (Default: reject; document and test whichever is chosen — AT-22.)
7. **Integrity hash is tamper-*evidence*, not authentication** (no secret key). Acceptable for corruption detection; not a security boundary.
8. **Real-adapter fidelity is unproven.** The wire shapes in the mocks reflect my understanding of the OpenAI Responses and Anthropic Messages formats (the former confirmed against the existing `openai-responses.ts`; the Anthropic shape was **not** re-verified against current Anthropic docs). Treat AT-27 as a sanity check, not conformance.

— End of AI-001-SPEC —
