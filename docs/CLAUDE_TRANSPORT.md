# Claude Messages transport

Status on 2026-11-01: **implemented and contract-tested offline. It has never reached the real API, and nothing in production imports it.** Paid requests remain off until the owner separately approves them.

Tests drive the real `@anthropic-ai/sdk` client and real provider against simulated HTTP responses shaped from the official documentation. That proves how this code uses the SDK, not that the API accepts its requests.

## What must all be true before one request is sent

| # | Requirement | Where it is enforced |
| --- | --- | --- |
| 1 | Code imports `@civ/cognition/routing/claude-live`. The routing package does not export it, and a test fails if production code imports it | Import path |
| 2 | The registry is built with `allowPaidRequests: true` | `CitizenProviderRegistry` |
| 3 | The key has the Claude Console API key prefix. Subscription OAuth (`sk-ant-oat`) and admin (`sk-ant-admin`) tokens are refused, without echoing them | `createClaudeSdkTransport` |
| 4 | A `PaidRequestGate` holds an approval with a reference, run ID, request ceiling and expiry | Every attempt |
| 5 | The `CIV_APPROVE_PAID_RUN` environment variable names that same run | Every attempt |
| 6 | `ANTHROPIC_CUSTOM_HEADERS` is not set | Every attempt |
| 7 | The request targets the Messages endpoint, authenticated by the configured key alone | Final fetch |
| 8 | The cloud budget admits the request and its reservation is saved | Before sending |

The approval reference is recorded, not authenticated. These checks guard against accidents, not against code that deliberately satisfies all of them.

## How it is wired, once approved

CODEX 1 owns this step, and it needs separate owner approval.

```ts
import { liveClaudeTransportFactory } from "@civ/cognition/routing/claude-live";
import { CitizenProviderRegistry, PaidRequestGate } from "@civ/cognition/routing";

const gate = PaidRequestGate.fromApproval({
  ownerApprovalReference, // from the owner, for this run
  runId,
  maxRequests,
  expiresAt,
});
const registry = new CitizenProviderRegistry({
  runId,
  assignments,
  experiment,
  resolveSecret,
  store,
  allowPaidRequests: true,
  claudeTransportFor: liveClaudeTransportFactory(gate),
});
```

The guard test in `claude-sdk-transport.contract.test.ts` must be updated in the same change, so wiring it is a visible decision.

## Fixed client settings

The SDK reads several settings from the environment. Each one is fixed on every request, so a stray variable cannot change behavior.

| SDK default | Setting here | Why |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | A variable must not redirect prompts and keys |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, profiles | The assignment's key only | One citizen, one credential, never a subscription login |
| 2 retries | 0 | The provider charges and saves every attempt |
| `ANTHROPIC_LOG` | Off | Debug logs could contain prompts |
| OpenTelemetry from environment | Off | A traces content mode could export prompts |
| Follows redirects | Refused | Validation must cover where prompts actually go |
| `ANTHROPIC_CUSTOM_HEADERS` | Refuses to send | No client option turns it off |

## Request and response contract

From official documentation checked on 2026-11-01, with `@anthropic-ai/sdk` pinned to `1.3.0`.

- **Endpoint:** `POST https://api.anthropic.com/v1/messages`, with `anthropic-version: 2026-10-21` set by the SDK. A test pins this, so an SDK upgrade is a visible change.
- **Authentication:** `Authorization: Bearer <key>`. `x-api-key` is the documented legacy form.
- **Body:** `model`, `max_tokens`, `system`, `messages`, and `output_config` with `format` and optional `effort`. Thinking, fallbacks, streaming and sampling parameters are not sent.
- **Schema:** separate from the OpenAI one, because Claude rejects `minimum`, `maximum`, `minLength` and `maxLength` with a 400. `validateDecision` enforces those ranges. The schema uses 4 of the 16 allowed unions and has no optional properties.
- **Thinking:** left at the model's default. It counts toward `max_tokens`, so Claude citizens need a much larger limit than the GPT default.

| Outcome | Budget effect | Retried? |
| --- | --- | --- |
| Gate or environment refuses, or nothing was sent | Refund | No |
| 400, 401, 402, 403, 404, 413 | Refund | No |
| 408, 409, or 429 with `retry-after` | Refund | Yes, honoring `retry-after` within the deadline |
| 429 with no `retry-after` | Refund | No. The docs say this can be a spend cap that keeps failing |
| 500, 502, 503, 504, 529 | Hold one attempt | Yes, with backoff |
| Timeout, abort or connection failure | Hold one attempt | No |
| 200 with usage | Charge usage, even if the output is unusable | No |
| 200 with a refusal | Charge reported usage, conservatively | No, and never on another model |
| 200 with missing, invalid or unreadable usage | Hold, and close the budget for the run | No |
| 200 from a different model, or a non-standard tier or speed | Hold, and close the budget for the run | No |

**Refusal billing:** the docs say a refusal before any output is billed only in certain categories, and those categories may change. Charging what is reported can over-count, which is the safe direction.

**Server-side `fallbacks` stay off.** This differs from the provider's general recommendation, because the owner prohibited automatic switching to another paid model.

## Privacy

Errors, ledger records, evidence and session records contain no prompt text, reply text or credentials:

- Error messages are built only from typed fields, because SDK messages can include response bodies.
- Rejected model output is reported without quoting it, because a model can echo its private prompt into a field. This also now applies to the GPT provider.
- Request IDs, error types and refusal categories are dropped unless they match a plain token format.

## What only a separately approved paid check can confirm

1. **The API accepts this exact request and schema.** Grammar compilation limits can only be tested live.
2. **`response.model` equals the requested ID.** If it does not, the budget closes on the first call. That is safe but would stop the run.
3. **The bound holds.** The 1024-token framing allowance covers an injected structured-output prompt of undocumented size. Tokens per UTF-8 byte is also assumed.
4. **`max_tokens` is enough.** How much thinking uses at each effort level for these prompts is unknown. A reply cut off is charged and returns no decision.
5. **Prices.** They come from a list cached on 2026-10-06.
6. **Workspace scope.** A key not scoped to one workspace needs an `anthropic-workspace-id` header, which this transport does not send, and gets a 400. **Use a workspace-scoped key.**
7. **Inference location.** US-only inference costs 1.1 times the listed price. The transport does not set it, but a workspace default was not checked.
8. **Rate limits and real latency** for four citizens.
