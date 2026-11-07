# Provider Authentication Feasibility & Policy Audit

**Document Date:** 2026-11-06  
**Auditor:** Gemini High  
**Scope:** Gate A 1v1 Minecraft Civilization Provider Integration  
**Status:** Authorized Research Only — No Live Authenticated Requests Made

---

## 1. Objective

This audit investigates the authentication mechanisms supported by OpenAI and Anthropic to establish an authoritative, safe, and compliant pathway for future live 1v1 testing. 

Specifically, this document distinguishes official programmatic developer API access from consumer/tool subscriptions (ChatGPT Plus/Team/Pro and Claude Pro/Claude Code), analyzes why subscription credentials must not be repurposed for runtime inference, and provides an evidence-based recommendation for a low-cost, bounded live 1v1 experiment.

---

## 2. OpenAI Authentication Analysis

### 2.1 Official OpenAI API Access
- **Endpoint Origin:** `https://api.openai.com` (specifically `https://api.openai.com/v1/responses` and `/v1/chat/completions`).
- **Credential Format:** Secret API Keys generated from the OpenAI Developer Platform (`platform.openai.com`):
  - Project API keys: `sk-proj-[A-Za-z0-9_-]+` (recommended; scoped to a specific project).
  - Legacy/User API keys: `sk-[A-Za-z0-9]{32,}`.
- **Header Protocol:** Standard HTTP Authorization Bearer token:
  ```http
  Authorization: Bearer sk-proj-...
  ```
- **Billing Model:** Prepaid credit balance or postpaid monthly usage invoiced against platform billing accounts. Rate limits (Tier 1–5) and usage tiers are determined by cumulative spend.
- **Structured Outputs:** Native JSON Schema enforcement with `strict: true` supported on `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini`, and `gpt-4.1`.

### 2.2 ChatGPT Subscription Integrations (Consumer / Web)
- **Service Domain:** `chatgpt.com` / `chat.openai.com`.
- **Subscription Types:** ChatGPT Free, ChatGPT Plus ($20/month), ChatGPT Team ($25–30/month/user), and ChatGPT Pro ($200/month).
- **Technical Feasibility for Runtime Inference:** **INELIGIBLE & PROHIBITED**.
  1. *Billing Disconnection:* OpenAI documentation explicitly clarifies:
     > *"A ChatGPT Plus or Team subscription does not include access to the OpenAI API, nor does it provide API credits. API usage is billed separately via platform.openai.com based on actual token consumption."*
  2. *Authentication Mechanism:* ChatGPT Web authentication relies on OAuth session tokens, Cloudflare bot-management cookies, and JWT bearer tokens (`session-token`) managed by Auth0/OpenAI web gateways.
  3. *Policy & Security Boundaries:* Extracting browser session tokens, reverse-engineering unofficial reverse proxies, or automating consumer accounts violates Section 2(c) and Section 3 of OpenAI's Business & Consumer Terms of Use (prohibiting scraping, automated extraction, and unauthorized programmatic wrapper access).
  4. *Reliability Risks:* Web session endpoints lack schema guarantees, strict latency SLAs, retry-after headers, or programmatically queryable token usage reports.

---

## 3. Anthropic Authentication Analysis

### 3.1 Official Anthropic API Access
- **Endpoint Origin:** `https://api.anthropic.com` (specifically `https://api.anthropic.com/v1/messages`).
- **Credential Format:** Secret API Keys generated from Anthropic Console (`console.anthropic.com`):
  - Standard Console API key: `sk-ant-api03-[A-Za-z0-9_-]+`.
- **Header Protocol:** 
  ```http
  Authorization: Bearer sk-ant-api03-...
  anthropic-version: 2026-10-21
  ```
  *(Note: `x-api-key` is the legacy form; our pinned `@anthropic-ai/sdk` v1.3.0 and `createClaudeSdkTransport` enforce the documented `Bearer` format).*
- **Billing Model:** Prepaid credits deposited directly into Anthropic Console Workspaces. Requests are metered per million input/output tokens according to model family list prices.
- **Structured Outputs:** JSON schema validation supported via `output_config.format.schema`. (Requires schema without `minimum`, `maximum`, `minLength`, `maxLength`, which are validated client-side in `@civ/cognition`).

### 3.2 Claude Subscriptions & Claude Code Authorization
- **Service Domains:** `claude.ai` (consumer/team subscriptions) and Claude Code CLI.
- **Subscription Types:** Claude Free, Claude Pro ($20/month), Claude Team ($25–30/month/user).
- **Claude Code CLI Token Model:**
  - Claude Code uses a specialized OAuth authentication flow (`sk-ant-oat[0-9]{2}-[A-Za-z0-9_-]+`) tied to user subscription or console access.
- **Technical Feasibility for Runtime Inference:** **INELIGIBLE & PROHIBITED**.
  1. *Codebase Enforcement (`isClaudeApiKeyFormat`):*
     In `packages/cognition/src/routing/paid-request-gate.ts`, the repository strictly enforces:
     ```ts
     const CLAUDE_KEY_PREFIX = /^sk-ant-api\d*-\S+$/;
     export function isClaudeApiKeyFormat(value: string): boolean {
       return CLAUDE_KEY_PREFIX.test(value.trim());
     }
     ```
     Any key beginning with `sk-ant-oat` (OAuth/subscription) or `sk-ant-admin` (Admin key) is immediately rejected at instantiation and never passed to the network.
  2. *Terms of Service Boundary:* Anthropic's Commercial Terms and Claude Code licensing explicitly state that subscription-derived OAuth credentials are provisioned exclusively for personal interactive CLI agent development within Claude Code, not as an unmetered backend provider proxy for third-party automated civilizational multi-agent runtimes.
  3. *Operational Risks:* Repurposing OAuth tokens bypasses per-request token metering, breaks our deterministic `CloudBudgetGate` cost reconciliation, and risks immediate account suspension.

---

## 4. Evidence-Based Recommendation for Live 1v1 Trial

### 4.1 Recommended Model Pairing
For the authorized, controlled live 1v1 trial, we recommend pairing the two lightweight, high-performance survival models:
1. **OpenAI Citizen (`gpt-a`):** `gpt-4o-mini`
   - Input List Price: $0.15 per 1,000,000 tokens ($0.00015 / 1K).
   - Output List Price: $0.60 per 1,000,000 tokens ($0.00060 / 1K).
2. **Claude Citizen (`claude-a`):** `claude-haiku-5-5`
   - Input List Price: $0.10 per 1,000,000 tokens ($0.00010 / 1K).
   - Output List Price: $0.50 per 1,000,000 tokens ($0.00050 / 1K).

### 4.2 Trial Token & Cost Projections
Assuming a standard 10-minute (600-second) 1v1 survival trial:
- **Decision Frequency:** Once every 20 seconds (with `LLM_COOLDOWN_MS = 20_000`), resulting in ~30 decisions per citizen.
- **Average Prompt Size:** ~1,800 tokens input (world observation, inventory, nearby players, filtered memories).
- **Average Decision Output:** ~120 tokens output (goal, priority, short reasoning sentence).

| Citizen | Model | Decisions | Total Input Tokens | Total Output Tokens | Estimated Cost (USD) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **GPT-A** | `gpt-4o-mini` | 30 | 54,000 | 3,600 | **$0.01026** |
| **Claude-A** | `claude-haiku-5-5` | 30 | 54,000 | 3,600 | **$0.00720** |
| **Total Experiment** | — | **60** | **108,000** | **7,200** | **~$0.0175 USD** |

### 4.3 Proposed Safeguard Budget Limits
To guarantee complete financial safety while preventing premature cutoffs:
- **`spendAllowanceUsd`:** `$1.00 USD` (provides a >50× safety buffer over estimated $0.02 spend).
- **`maxRequestsPerRun`:** `80 requests` (covers 60 expected decisions + 20 retries).
- **`maxConcurrency`:** `2` (exactly one concurrent decision per citizen).
- **Approval Expiration:** `2 hours` from test launch.

---

## 5. Security & Operator Rules

1. **Never commit real keys:** Store keys in secure environment variables (`KEY_GPT_A`, `KEY_CLAUDE_A`).
2. **Explicit launch approval variable:** The operator must set `CIV_APPROVE_PAID_RUN=<run-id>` matching the code approval record.
3. **No subscription scraping:** Never attempt to pipe ChatGPT or Claude Pro browser cookies or OAuth tokens.
4. **Offline by default:** All CI and local test suites remain permanently guarded by `vi.stubGlobal("fetch", networkGuard)` to ensure no accidental live inference occurs.
